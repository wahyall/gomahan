import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { pointInPolygon, type RoomGeometryMetrics } from "@/lib/geometry/rooms";
import { WallSpatialGrid, type WallGate } from "@/lib/simulation/wallGrid";

// OPT-15: gate sets replicate the original inline loop semantics bit-for-bit.
const LIGHT_GATE: WallGate = {
  tLo: 0.02,
  tHi: 1.001,
  tHiInclusive: true,
  uLo: -0.005,
  uLoInclusive: true,
  uHi: 1.005,
  uHiInclusive: true,
  windowPasses: true,
  clampHitAlong: true,
};
const LIGHT_GATE_IGNORE: WallGate = { ...LIGHT_GATE, tLo: 0.04 };

function segmentBlockedByWalls(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  grid: WallSpatialGrid,
  ignoreWallId?: string,
): boolean {
  if (Math.hypot(bx - ax, bz - az) < 0.12) return false;
  return grid.segmentBlocked(
    ax,
    az,
    bx,
    bz,
    ignoreWallId ? LIGHT_GATE_IGNORE : LIGHT_GATE,
    ignoreWallId,
  );
}

export interface SolarPosition {
  altitudeDeg: number;
  azimuthDeg: number; // clockwise from north (+Z)
  sunDir: [number, number, number]; // normalized unit vector pointing toward sun
  skyIrradianceLux: number;
  isDaylight: boolean;
}

export interface RoomLightingResult {
  roomId: string;
  levelIndex: number;
  roomName: string;
  program: string;
  netAreaM2: number;
  windowAreaM2: number;
  daylightFactorPct: number;
  naturalLux: number;
  artificialLux: number;
  totalLux: number;
  targetLux: number;
  glareRisk: boolean;
  status: "TERANG" | "CUKUP" | "GELAP";
}

export interface LightingSimulationResult {
  solar: SolarPosition;
  rooms: RoomLightingResult[];
  gridWidth: number;
  gridDepth: number;
  lt1LuxGrid: Float32Array; // 25 x 85 cells (0.2m res)
  lt2LuxGrid: Float32Array;
  avgHouseLux: number;
  sniCompliancePct: number;
  daylightScore: number; // 0..100
  recommendations: string[];
  methodologyNote: string;
}

const TARGET_LUX: Record<string, number> = {
  living: 150,
  dining: 150,
  kitchen: 250,
  bedroom: 120,
  bathroom: 150,
  service: 150,
  circulation: 100,
  garden: 100,
  carport: 100,
  balcony: 100,
  void: 100,
};

export function computeSolarPosition(
  hourOfDay: number,
  latitudeDeg: number,
  season: "kemarau" | "hujan",
  orientationDeg: number,
): SolarPosition {
  // Surabaya seasonal declination (~ +18 deg dry / -18 deg rainy)
  const declDeg = season === "kemarau" ? 16 : -14;
  const latRad = (latitudeDeg * Math.PI) / 180;
  const declRad = (declDeg * Math.PI) / 180;
  const hourAngleRad = ((hourOfDay - 12) * 15 * Math.PI) / 180;

  const sinAlt =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const altitudeDeg = (altRad * 180) / Math.PI;

  const cosAz =
    (Math.sin(declRad) - Math.sin(latRad) * Math.sin(altRad)) /
    Math.max(1e-4, Math.cos(latRad) * Math.cos(altRad));
  let azRad = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (hourOfDay > 12) azRad = 2 * Math.PI - azRad;
  const azimuthDeg = ((azRad * 180) / Math.PI + orientationDeg) % 360;

  const effAzRad = (azimuthDeg * Math.PI) / 180;
  const clampedAlt = Math.max(0.05, altRad);
  const sx = Math.sin(effAzRad) * Math.cos(clampedAlt);
  const sy = Math.sin(clampedAlt);
  const sz = Math.cos(effAzRad) * Math.cos(clampedAlt);

  const isDaylight = altitudeDeg > 1;
  const cloudFactor = season === "hujan" ? 0.55 : 0.92;
  const skyIrradianceLux = isDaylight
    ? Math.round((12000 + 68000 * Math.pow(Math.max(0, Math.sin(altRad)), 0.85)) * cloudFactor)
    : 4;

  return {
    altitudeDeg,
    azimuthDeg,
    sunDir: [sx, sy, sz],
    skyIrradianceLux,
    isDaylight,
  };
}

export function runLightingSimulation(derived: DerivedProjectModel): LightingSimulationResult {
  const { project, floors, roof } = derived;
  const sim = project.simulation;
  const solar = computeSolarPosition(sim.hourOfDay, project.site.latitude, sim.season, project.site.orientationDeg);

  const gridW = 25; // 5m / 0.2m
  const gridD = 85; // 17m / 0.2m
  const lt1NatGrid = new Float32Array(gridW * gridD);
  const lt1ArtGrid = new Float32Array(gridW * gridD);
  const lt1Grid = new Float32Array(gridW * gridD);
  const lt2NatGrid = new Float32Array(gridW * gridD);
  const lt2ArtGrid = new Float32Array(gridW * gridD);
  const lt2Grid = new Float32Array(gridW * gridD);

  const rooms: RoomLightingResult[] = [];
  const recommendations: string[] = [];

  const collectOpenings = (lvIdx: number) => {
    const lv = project.levels[lvIdx];
    if (!lv) return [];
    const out: { wallId: string; x: number; z: number; area: number; dirZ: number; dirX: number }[] = [];
    for (const w of lv.walls) {
      const dx = w.end.x - w.start.x;
      const dz = w.end.z - w.start.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      for (const op of w.openings) {
        if (op.kind === "window" || op.kind === "skylight" || (op.kind === "door" && op.width > 1.2)) {
          const t = op.offset / len;
          out.push({
            wallId: w.id,
            x: w.start.x + dx * t,
            z: w.start.z + dz * t,
            area: op.width * op.height,
            dirX: -dz / len,
            dirZ: dx / len,
          });
        }
      }
    }
    return out;
  };

  const lt1Openings = collectOpenings(0);
  const lt2Openings = project.levels[1] ? collectOpenings(1) : [];

  const fillGrid = (
    natGrid: Float32Array,
    artGrid: Float32Array,
    totGrid: Float32Array,
    lvIdx: number,
    openings: ReturnType<typeof collectOpenings>,
  ) => {
    const lv = project.levels[lvIdx];
    if (!lv) return;
    const rainAtten = sim.rainIntensityMmH > 10 ? 0.55 : 1.0;
    // OPT-15: build the 1 m wall spatial grid once per level — every ray below
    // only visits the walls in the cells it actually crosses.
    const wallGrid = new WallSpatialGrid(lv.walls, project.site.width, project.site.depth);

    for (let gz = 0; gz < gridD; gz++) {
      for (let gx = 0; gx < gridW; gx++) {
        const px = (gx + 0.5) * 0.2;
        const pz = (gz + 0.5) * 0.2;

        const isOutdoorLt1 = lvIdx === 0 && (pz < 4.0 || (pz > 15.35 && px > 1.7));
        const isVoidArea = pz > 15.35 && px > 1.7;
        const isStairSkylight = (project.levels[0]?.stairs.length ?? 0) > 0 && px < 1.35 && pz >= 7.5 && pz <= 12.5;
        const isBalconyLt2 = lvIdx === 1 && px < 2.5 && pz >= 3.0 && pz < 4.0;

        let natLux = 0;
        if (solar.isDaylight) {
          if (isOutdoorLt1 || isVoidArea || isBalconyLt2) {
            natLux += solar.skyIrradianceLux * 0.38 * rainAtten;
          } else {
            for (const op of openings) {
              // OPT-15: squared distance gate — sqrt only for survivors.
              const dxo = px - op.x;
              const dzo = pz - op.z;
              if (dxo * dxo + dzo * dzo > 49) continue;
              if (segmentBlockedByWalls(op.x, op.z, px, pz, wallGrid, op.wallId)) continue;
              const dist = Math.hypot(dxo, dzo);
              const orientFactor = 0.45 + 0.55 * Math.abs(op.dirX * solar.sunDir[0] + op.dirZ * solar.sunDir[2]);
              const shading = pz < 5.0 ? Math.max(0.45, 1 - project.systems.overhangFrontM * 0.35) : 0.85;
              const falloff = 1 / (1 + dist * dist * 0.42);
              natLux += solar.skyIrradianceLux * 0.052 * op.area * falloff * shading * rainAtten * orientFactor;
            }
            if (isStairSkylight) {
              natLux += solar.skyIrradianceLux * 0.14 * rainAtten;
            } else if (lvIdx === 0 && (project.levels[0]?.stairs.length ?? 0) > 0 && pz >= 7.5 && pz <= 12.5) {
              const dSkylight = Math.hypot(px - 0.7, pz - 10.0);
              natLux += (solar.skyIrradianceLux * 0.05 * rainAtten) / (1 + dSkylight * dSkylight * 0.35);
            }
            if (lv.rooms.length > 0 && pz >= 12.5 && pz <= 15.35) {
              const dVoid = Math.max(0.5, 15.35 - pz);
              natLux += (solar.skyIrradianceLux * 0.032 * rainAtten) / (1 + dVoid * dVoid * 0.3);
            }
          }
        }

        let artLux = 0;
        for (const l of lv.lights) {
          if (!l.on || l.dimmer <= 0) continue;
          // OPT-15: squared distance gate — sqrt only for survivors.
          const dxl = px - l.position.x;
          const dzl = pz - l.position.z;
          if (dxl * dxl + dzl * dzl > 42.25) continue;
          if (segmentBlockedByWalls(l.position.x, l.position.z, px, pz, wallGrid)) continue;
          const dHoriz = Math.hypot(dxl, dzl);
          const dVert = Math.max(0.65, l.position.y - 0.75);
          const d3 = Math.hypot(dHoriz, dVert);
          const cosTheta = dVert / d3;
          const beamHalf = ((l.beamAngleDeg * 0.5) * Math.PI) / 180;
          const angle = Math.acos(Math.min(1, cosTheta));
          const beamAtten = angle <= beamHalf ? 1.0 : Math.max(0.18, Math.exp(-Math.pow((angle - beamHalf) * 2.2, 2)));
          artLux += ((l.lumens * l.dimmer * cosTheta) / (Math.PI * d3 * d3)) * beamAtten * 1.65;
        }

        const idx = gz * gridW + gx;
        natGrid[idx] = Math.min(25000, natLux);
        artGrid[idx] = Math.min(25000, artLux);
        totGrid[idx] = Math.min(25000, natLux + artLux);
      }
    }
  };

  fillGrid(lt1NatGrid, lt1ArtGrid, lt1Grid, 0, lt1Openings);
  fillGrid(lt2NatGrid, lt2ArtGrid, lt2Grid, 1, lt2Openings);

  const sampleRoom = (rm: RoomGeometryMetrics, natGrid: Float32Array, artGrid: Float32Array, totGrid: Float32Array) => {
    const { minX, maxX, minZ, maxZ } = rm.bounds;
    const x0 = Math.max(0, Math.floor(minX / 0.2));
    const x1 = Math.min(gridW - 1, Math.floor(maxX / 0.2));
    const z0 = Math.max(0, Math.floor(minZ / 0.2));
    const z1 = Math.min(gridD - 1, Math.floor(maxZ / 0.2));
    let sumTot = 0;
    let sumNat = 0;
    let sumArt = 0;
    let cnt = 0;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const cx = (x + 0.5) * 0.2;
        const cz = (z + 0.5) * 0.2;
        if (!pointInPolygon({ x: cx, z: cz }, rm.room.polygon)) continue;
        const idx = z * gridW + x;
        sumNat += natGrid[idx] ?? 0;
        sumArt += artGrid[idx] ?? 0;
        sumTot += totGrid[idx] ?? 0;
        cnt++;
      }
    }
    const naturalLux = Math.round(cnt > 0 ? sumNat / cnt : 0);
    const artificialLux = Math.round(cnt > 0 ? sumArt / cnt : 0);
    const totalLux = Math.round(cnt > 0 ? sumTot / cnt : 0);
    const daylightFactorPct =
      solar.isDaylight && solar.skyIrradianceLux > 100
        ? Math.min(12, (naturalLux / solar.skyIrradianceLux) * 100)
        : 0;

    const targetLux = TARGET_LUX[rm.room.program] ?? 150;
    const status: RoomLightingResult["status"] =
      totalLux >= targetLux ? "TERANG" : totalLux >= targetLux * 0.6 ? "CUKUP" : "GELAP";

    return {
      roomId: rm.room.id,
      levelIndex: rm.levelIndex,
      roomName: rm.room.name,
      program: rm.room.program,
      netAreaM2: rm.netAreaM2,
      windowAreaM2: rm.windowAreaM2,
      daylightFactorPct,
      naturalLux,
      artificialLux,
      totalLux,
      targetLux,
      glareRisk: naturalLux > 3500 && rm.room.program !== "garden" && rm.room.program !== "carport",
      status,
    };
  };

  for (const fl of floors) {
    const isLt2 = fl.levelIndex === 1;
    const natG = isLt2 ? lt2NatGrid : lt1NatGrid;
    const artG = isLt2 ? lt2ArtGrid : lt1ArtGrid;
    const totG = isLt2 ? lt2Grid : lt1Grid;
    for (const rm of fl.rooms) {
      if (rm.room.program === "void") continue;
      rooms.push(sampleRoom(rm, natG, artG, totG));
    }
  }

  const enclosed = rooms.filter(
    (r) => r.program !== "garden" && r.program !== "carport" && r.program !== "balcony",
  );
  const passing = enclosed.filter((r) => r.totalLux >= r.targetLux).length;
  const sniCompliancePct = enclosed.length > 0 ? Math.round((passing / enclosed.length) * 100) : 0;
  const avgHouseLux =
    enclosed.length > 0 ? Math.round(enclosed.reduce((s, r) => s + r.totalLux, 0) / enclosed.length) : 0;

  const darkRooms = enclosed.filter((r) => r.status === "GELAP");
  if (darkRooms.length > 0) {
    recommendations.push(
      `${darkRooms.map((d) => d.roomName).join(", ")} masih kurang cahaya (${darkRooms[0]!.totalLux} lux < target ${darkRooms[0]!.targetLux} lux). Nyalakan lampu LED atau perbesar bukaan ke taman/void.`,
    );
  }
  if (enclosed.length > 0 && roof.slopeDeg >= 8 && project.systems.roofType === "shed_front") {
    recommendations.push(
      "Atap shed roof 10° miring ke depan menciptakan bukaan tinggi di sisi belakang — ideal untuk jendela clerestory/void agar cahaya siang masuk jauh ke ruang keluarga.",
    );
  }

  const daylightPassCount = enclosed.filter((r) => r.naturalLux >= r.targetLux).length;
  const daylightPassPct = enclosed.length > 0 ? (daylightPassCount / enclosed.length) * 100 : 0;
  const daylightScore =
    enclosed.length === 0 || !solar.isDaylight
      ? 0
      : Math.min(100, Math.round(daylightPassPct * 0.7 + Math.min(30, derived.lightingRatioPct * 2.5)));

  return {
    solar,
    rooms,
    gridWidth: gridW,
    gridDepth: gridD,
    lt1LuxGrid: lt1Grid,
    lt2LuxGrid: lt2Grid,
    avgHouseLux,
    sniCompliancePct,
    daylightScore,
    recommendations,
    methodologyNote:
      "Model analitik berbasis posisi matahari Surabaya, rasio bukaan/orientasi/overstek, void/skylight, serta lumens lampu (indikatif SNI 03-2396 & 03-6575; bukan Radiance raytracing penuh).",
  };
}
