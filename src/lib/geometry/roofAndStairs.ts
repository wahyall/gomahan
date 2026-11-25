import type { ArchitectureSystemConfig, Level, Project, RoofType, Stair } from "@/lib/model/types";
import { wallLength } from "@/lib/geometry/walls";
import type { FloorLevelMetrics } from "@/lib/geometry/rooms";

export interface RoofDerivedMetrics {
  roofType: RoofType;
  slopeDeg: number;
  pitch: number;
  minX: number;
  maxX: number;
  minZ: number; // includes front overhang
  maxZ: number; // includes back overhang
  eaveElevationM: number; // lowest roof bearing elevation (LT2 top)
  ridgeElevationM: number; // highest roof elevation
  areaM2: number;
  trussCount: number;
  purlinMeters: number;
  coverUnitsCount: number;
  coverUnitLabel: string;
  fasciaMeters: number;
  gutterMeters: number;
  downspoutMeters: number;
  heightAt: (x: number, z: number) => number;
  extraWallHeightAt: (levelIndex: number, x: number, z: number) => number;
}

export interface StairValidation {
  stair: Stair;
  riserHeightM: number;
  totalRunM: number;
  blondelM: number; // 2*R + T (ideal 0.60 - 0.65 m)
  headroomM: number;
  okBlondel: boolean;
  okHeadroom: boolean;
}

export interface ValidationIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  category: "boundary" | "structure" | "opening" | "stair" | "snilight" | "flood" | "cost";
  title: string;
  detail: string;
  levelIndex?: number;
  elementId?: string;
}

export function computeRoofMetrics(project: Project): RoofDerivedMetrics {
  const sys: ArchitectureSystemConfig = project.systems;
  const lt2 = project.levels[1] ?? project.levels[0]!;
  const baseTop = lt2.elevation + lt2.height; // 7.20 m
  const effectiveSlopeDeg = sys.roofType === "flat_deck" ? 2 : sys.roofSlopeDeg;
  const rad = (effectiveSlopeDeg * Math.PI) / 180;
  const pitch = Math.tan(rad);

  const sideOv = project.site.partyWallLeft || project.site.partyWallRight ? 0 : sys.overhangSideM;
  const minX = 0 - (project.site.partyWallLeft ? 0 : sideOv);
  const maxX = project.site.width + (project.site.partyWallRight ? 0 : sideOv);

  // Main upper house starts at Z=4.00 (plus balcony at Z=3.00) to Z=17.00
  const roofStartZ = 3.0;
  const roofEndZ = project.site.depth;
  const minZ = roofStartZ - sys.overhangFrontM;
  const maxZ = roofEndZ + sys.overhangBackM;

  const spanZ = maxZ - minZ;
  const spanX = maxX - minX;

  let ridgeElevationM = baseTop + 0.3;
  const heightAt = (x: number, z: number): number => {
    const zClamped = Math.max(minZ, Math.min(maxZ, z));
    const xClamped = Math.max(minX, Math.min(maxX, x));
    if (sys.roofType === "shed_front") {
      // Lowest at front (minZ), rising toward rear (maxZ)
      return baseTop + (zClamped - roofStartZ) * pitch;
    }
    if (sys.roofType === "shed_back") {
      return baseTop + (roofEndZ - zClamped) * pitch;
    }
    if (sys.roofType === "gable") {
      const halfX = spanX * 0.5;
      const distEdge = halfX - Math.abs(xClamped - (minX + halfX));
      return baseTop + distEdge * pitch;
    }
    if (sys.roofType === "hip") {
      const dx = Math.min(xClamped - minX, maxX - xClamped);
      const dz = Math.min(zClamped - minZ, maxZ - zClamped);
      return baseTop + Math.min(dx, dz) * pitch;
    }
    // flat_deck
    return baseTop + 0.15 + (zClamped - roofStartZ) * pitch;
  };

  if (sys.roofType === "shed_front") {
    ridgeElevationM = baseTop + (maxZ - roofStartZ) * pitch;
  } else if (sys.roofType === "shed_back") {
    ridgeElevationM = baseTop + (roofEndZ - minZ) * pitch;
  } else if (sys.roofType === "gable") {
    ridgeElevationM = baseTop + (spanX * 0.5) * pitch;
  } else if (sys.roofType === "hip") {
    ridgeElevationM = baseTop + Math.min(spanX * 0.5, spanZ * 0.5) * pitch;
  } else {
    ridgeElevationM = baseTop + 0.25;
  }

  // Subtract rear void (1.70..5.00, 15.35..17.00) and stair skylight area from opaque roof cover if open,
  // or keep transparent skylight frame on top
  const slopeFactor = Math.sqrt(1 + pitch * pitch);
  // Main roof + Carport lower shed canopy (Z: -overhangFront..4.5, X: 0..5)
  const mainArea = spanX * spanZ * slopeFactor;
  const carportArea = project.site.width * (4.5 + sys.overhangFrontM) * 1.015;
  const areaM2 = mainArea + carportArea;

  const trussCount = Math.max(6, Math.ceil(spanZ / 1.2) + 1);
  const purlinMeters = trussCount * spanX * 1.15 + Math.ceil(spanZ / 0.45) * spanX;

  let coverUnitsCount = Math.ceil(areaM2);
  let coverUnitLabel = "m² panel";
  if (sys.roofCover === "genteng_beton" || sys.roofCover === "genteng_keramik") {
    coverUnitsCount = Math.ceil(areaM2 * 10.5);
    coverUnitLabel = "pcs genteng";
  } else if (sys.roofCover === "standing_seam") {
    coverUnitsCount = Math.ceil(areaM2 * 1.08);
    coverUnitLabel = "m² standing seam";
  } else {
    coverUnitsCount = Math.ceil(areaM2 * 1.05);
    coverUnitLabel = "m² spandek pasir";
  }

  // Gutter: front eave (5 m) + internal parapet gutters along left/right party walls (2 x 14 m)
  const gutterMeters =
    sys.roofType === "shed_front"
      ? project.site.width + (project.site.partyWallLeft ? spanZ : 0) + (project.site.partyWallRight ? spanZ : 0)
      : project.site.width * 2;
  const downspoutMeters = sys.downspoutCount * (baseTop + 0.6);
  const fasciaMeters = project.site.width * 2 + spanZ * 2;

  const extraWallHeightAt = (levelIndex: number, x: number, z: number): number => {
    if (levelIndex !== lt2.index) return 0;
    const h = heightAt(x, z);
    return Math.max(0, h - baseTop);
  };

  return {
    roofType: sys.roofType,
    slopeDeg: effectiveSlopeDeg,
    pitch,
    minX,
    maxX,
    minZ,
    maxZ,
    eaveElevationM: baseTop,
    ridgeElevationM,
    areaM2,
    trussCount,
    purlinMeters,
    coverUnitsCount,
    coverUnitLabel,
    fasciaMeters,
    gutterMeters,
    downspoutMeters,
    heightAt,
    extraWallHeightAt,
  };
}

export function computeStairValidation(level: Level): StairValidation[] {
  return level.stairs.map((stair) => {
    const riserHeightM = stair.floorHeight / Math.max(1, stair.riserCount);
    const totalRunM = (stair.riserCount - 1) * stair.treadDepth;
    const blondelM = 2 * riserHeightM + stair.treadDepth;
    const headroomM = stair.floorHeight - 0.14 - riserHeightM * 2; // clear height above 2nd step
    return {
      stair,
      riserHeightM,
      totalRunM,
      blondelM,
      headroomM,
      okBlondel: blondelM >= 0.58 && blondelM <= 0.66,
      okHeadroom: headroomM >= 2.05,
    };
  });
}

export function validateProjectModel(
  project: Project,
  floorMetrics: FloorLevelMetrics[],
  roof: RoofDerivedMetrics,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Party wall side checks (left/right neighbor walls)
  for (const level of project.levels) {
    for (const w of level.walls) {
      const len = wallLength(w);
      const isLeftBoundary = project.site.partyWallLeft && w.start.x <= 0.15 && w.end.x <= 0.15;
      const isRightBoundary =
        project.site.partyWallRight &&
        w.start.x >= project.site.width - 0.15 &&
        w.end.x >= project.site.width - 0.15;

      if (isLeftBoundary || isRightBoundary) {
        const hasForbiddenWindow = w.openings.some((o) => o.kind === "window" || o.kind === "door");
        if (hasForbiddenWindow) {
          issues.push({
            id: `party-wall-${w.id}`,
            severity: "critical",
            category: "boundary",
            title: `Bukaan pada dinding batas tetangga (${w.name})`,
            detail: "Sisi kiri/kanan menempel kavling tetangga — dilarang membuka jendela/pintu langsung ke lahan sebelah (PBG/KUHPerdata).",
            levelIndex: level.index,
            elementId: w.id,
          });
        }
      }

      // Opening overlaps or exceeding wall length
      const sorted = [...w.openings].sort((a, b) => a.offset - b.offset);
      for (let i = 0; i < sorted.length; i++) {
        const op = sorted[i]!;
        const lo = op.offset - op.width / 2;
        const hi = op.offset + op.width / 2;
        if (lo < 0.02 || hi > len - 0.02) {
          issues.push({
            id: `op-bounds-${op.id}`,
            severity: "critical",
            category: "opening",
            title: `Bukaan "${op.label}" melebihi panjang dinding`,
            detail: `Panjang dinding ${len.toFixed(2)} m tidak cukup menampung bukaan ${op.width.toFixed(2)} m pada offset ${op.offset.toFixed(2)} m.`,
            levelIndex: level.index,
            elementId: op.id,
          });
        }
        if (op.sill + op.height > w.height - 0.15) {
          issues.push({
            id: `op-head-${op.id}`,
            severity: "warning",
            category: "opening",
            title: `Ambang atas "${op.label}" menabrak ring balk/balok`,
            detail: `Elevasi atas bukaan (${(op.sill + op.height).toFixed(2)} m) terlalu dekat puncak dinding (${w.height.toFixed(2)} m).`,
            levelIndex: level.index,
            elementId: op.id,
          });
        }
        for (let j = 0; j < i; j++) {
          const prev = sorted[j]!;
          const prevLo = prev.offset - prev.width / 2;
          const prevHi = prev.offset + prev.width / 2;
          const horizOverlap = Math.min(hi, prevHi) - Math.max(lo, prevLo) > -0.04;
          const vertOverlap =
            Math.min(op.sill + op.height, prev.sill + prev.height) - Math.max(op.sill, prev.sill) > -0.04;
          if (horizOverlap && vertOverlap) {
            issues.push({
              id: `op-overlap-${op.id}`,
              severity: "critical",
              category: "opening",
              title: `Tabrakan bukaan pada ${w.name}`,
              detail: `"${prev.label}" dan "${op.label}" bertumpukan atau berjarak < 4 cm.`,
              levelIndex: level.index,
              elementId: op.id,
            });
            break;
          }
        }
      }

      // Check if any other wall on the same level intersects an opening (door/window blocked by adjacent wall)
      const wux = (w.end.x - w.start.x) / Math.max(0.01, len);
      const wuz = (w.end.z - w.start.z) / Math.max(0.01, len);
      for (const op of w.openings) {
        if (op.kind !== "door" && op.kind !== "window" && op.kind !== "arch") continue;
        const opLo = op.offset - op.width * 0.5;
        const opHi = op.offset + op.width * 0.5;
        for (const other of level.walls) {
          if (other.id === w.id) continue;
          const odx = other.end.x - other.start.x;
          const odz = other.end.z - other.start.z;
          const olen = Math.hypot(odx, odz);
          if (olen < 0.05) continue;
          // Check endpoints and midpoint of other wall against opening span
          const samples = [0, 0.5, 1];
          let blocked = false;
          for (const st of samples) {
            const px = other.start.x + odx * st;
            const pz = other.start.z + odz * st;
            const proj = (px - w.start.x) * wux + (pz - w.start.z) * wuz;
            const perp = Math.abs((px - w.start.x) * -wuz + (pz - w.start.z) * wux);
            if (proj > opLo + 0.03 && proj < opHi - 0.03 && perp < (w.thickness + other.thickness) * 0.5 + 0.04 && other.height > op.sill + 0.2) {
              blocked = true;
              break;
            }
          }
          if (blocked) {
            issues.push({
              id: `op-wall-block-${op.id}-${other.id}`,
              severity: "critical",
              category: "opening",
              title: `Bukaan "${op.label}" tertutup dinding "${other.name}"`,
              detail: `Dinding "${other.name}" memotong rentang ${op.kind} pada "${w.name}". Geser posisi sekat atau bukaan.`,
              levelIndex: level.index,
              elementId: op.id,
            });
          }
        }
      }

      // Unsupported masonry wall length without intermediate column
      if (len > 4.2) {
        issues.push({
          id: `span-warn-${w.id}`,
          severity: "info",
          category: "structure",
          title: `Dinding "${w.name}" bentang ${len.toFixed(2)} m > 4 m`,
          detail: "Sistem otomatis menyisipkan kolom praktis/utama per jarak ≤ 3,5 m sesuai SNI 2847:2019.",
          levelIndex: level.index,
          elementId: w.id,
        });
      }
    }

    // Stair checks
    for (const sv of computeStairValidation(level)) {
      if (!sv.okBlondel) {
        issues.push({
          id: `stair-blondel-${sv.stair.id}`,
          severity: "warning",
          category: "stair",
          title: `Proporsi anak tangga "${sv.stair.name}" kurang ergonomis`,
          detail: `2×R + T = ${(sv.blondelM * 100).toFixed(1)} cm (ideal 58–66 cm).`,
          levelIndex: level.index,
          elementId: sv.stair.id,
        });
      }
      if (!sv.okHeadroom) {
        issues.push({
          id: `stair-head-${sv.stair.id}`,
          severity: "critical",
          category: "stair",
          title: `Headroom tangga "${sv.stair.name}" < 2,05 m`,
          detail: `Tinggi bebas hanya ${sv.headroomM.toFixed(2)} m — berisiko terbentur balok/pelat LT2.`,
          levelIndex: level.index,
          elementId: sv.stair.id,
        });
      }
    }
  }

  // Roof side overhang check
  if ((project.site.partyWallLeft || project.site.partyWallRight) && project.systems.overhangSideM > 0.01) {
    issues.push({
      id: "roof-neighbor-overhang",
      severity: "warning",
      category: "boundary",
      title: "Overstek atap samping masuk lahan tetangga",
      detail: "Karena kiri/kanan menempel tetangga, atap samping otomatis memakai parapet & talang jurai dalam (overstek samping 0 m).",
    });
  }

  // SNI natural lighting check across enclosed rooms
  const enclosedNet = floorMetrics.reduce(
    (s, lv) =>
      s +
      lv.rooms
        .filter((r) => r.room.program !== "garden" && r.room.program !== "carport" && r.room.program !== "balcony" && r.room.program !== "void")
        .reduce((a, r) => a + r.netAreaM2, 0),
    0,
  );
  const totalWin = floorMetrics.reduce(
    (s, lv) => s + lv.rooms.reduce((a, r) => a + r.windowAreaM2, 0),
    0,
  );
  const ratioPct = enclosedNet > 0 ? (totalWin / enclosedNet) * 100 : 0;
  if (ratioPct < 5) {
    issues.push({
      id: "sni-lighting-low",
      severity: "critical",
      category: "snilight",
      title: `Rasio jendela (${ratioPct.toFixed(1)}%) di bawah minimum SNI 5%`,
      detail: "Tambahkan lebar jendela di fasad depan atau dinding menghadap taman/void belakang.",
    });
  } else if (ratioPct < 10) {
    issues.push({
      id: "sni-lighting-ideal",
      severity: "info",
      category: "snilight",
      title: `Rasio jendela ${ratioPct.toFixed(1)}% (memenuhi min. 5%, di bawah ideal 10%)`,
      detail: "Pertimbangkan memperlebar jendela menghadap void belakang untuk cahaya siang maksimal.",
    });
  }

  // Room access check
  for (const lv of floorMetrics) {
    for (const r of lv.rooms) {
      if (!r.hasOpening && r.room.program !== "living" && r.room.program !== "circulation") {
        issues.push({
          id: `room-no-door-${r.room.id}`,
          severity: "warning",
          category: "opening",
          title: `Ruang "${r.room.name}" belum memiliki pintu/bukaan akses`,
          detail: "Tambahkan pintu pada dinding sekat ruangan ini.",
          levelIndex: lv.levelIndex,
          elementId: r.room.id,
        });
      }
    }
  }

  // Check roof vs top level
  if (roof.slopeDeg < 5 && (project.systems.roofCover === "genteng_beton" || project.systems.roofCover === "genteng_keramik")) {
    issues.push({
      id: "roof-slope-genteng",
      severity: "critical",
      category: "boundary",
      title: `Kemiringan atap ${roof.slopeDeg}° terlalu landai untuk genteng`,
      detail: "Genteng beton/keramik mensyaratkan kemiringan ≥ 25° agar tidak tampias/bocor. Gunakan Standing Seam atau Spandek untuk sudut 10°.",
    });
  }

  return issues;
}
