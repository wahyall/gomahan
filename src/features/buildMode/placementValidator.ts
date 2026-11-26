import { pointInPolygon } from "@/lib/geometry/rooms";
import type { FurnitureCategory, FurnitureItem, Project, Room, Stair, Vec2, Wall } from "@/lib/model/types";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const STACKABLE_FURNITURE_CATEGORIES = new Set<FurnitureCategory>(["decor", "plant"]);
const SURFACE_HOST_CATALOG_IDS = new Set(["coffee_table", "dining_table", "desk", "tv_console", "kitchen_l"]);
const SURFACE_HOST_CATEGORIES = new Set<FurnitureCategory>(["table", "kitchen"]);

export function getRotatedObbCorners(cx: number, cz: number, sizeX: number, sizeZ: number, rotationY: number): Vec2[] {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const hx = sizeX * 0.5;
  const hz = sizeZ * 0.5;
  return [
    { x: cx + (-hx * c + -hz * s), z: cz + (-hx * s + -hz * c) }, // note Three.js rotY: x' = x*cos + z*sin, z' = -x*sin + z*cos
    { x: cx + (hx * c + -hz * s), z: cz + (hx * s + -hz * c) },
    { x: cx + (hx * c + hz * s), z: cz + (hx * s + hz * c) },
    { x: cx + (-hx * c + hz * s), z: cz + (-hx * s + hz * c) },
  ];
}

function getObbAxes(rotationY: number): [Vec2, Vec2] {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return [
    { x: c, z: -s },
    { x: s, z: c },
  ];
}

function projectCornersOnAxis(corners: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const v = p.x * axis.x + p.z * axis.z;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

export function obbIntersectsObb(
  a: { cx: number; cz: number; sizeX: number; sizeZ: number; rotationY: number },
  b: { cx: number; cz: number; sizeX: number; sizeZ: number; rotationY: number },
  margin = -0.02,
): boolean {
  const cA = getRotatedObbCorners(a.cx, a.cz, a.sizeX, a.sizeZ, a.rotationY);
  const cB = getRotatedObbCorners(b.cx, b.cz, b.sizeX, b.sizeZ, b.rotationY);
  const axes = [...getObbAxes(a.rotationY), ...getObbAxes(b.rotationY)];
  for (const ax of axes) {
    const [aMin, aMax] = projectCornersOnAxis(cA, ax);
    const [bMin, bMax] = projectCornersOnAxis(cB, ax);
    if (Math.min(aMax, bMax) - Math.max(aMin, bMin) <= -margin) {
      return false;
    }
  }
  return true;
}

export function getStairObb(st: Stair): { cx: number; cz: number; sizeX: number; sizeZ: number; rotationY: number } {
  const dx = st.end.x - st.start.x;
  const dz = st.end.z - st.start.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    cx: (st.start.x + st.end.x) * 0.5,
    cz: (st.start.z + st.end.z) * 0.5,
    sizeX: len,
    sizeZ: st.width,
    rotationY: -Math.atan2(dz, dx),
  };
}

/**
 * Pure 2D opening placement validator (rejects fences, validates wall height, and checks 2D H×V overlap).
 */
export function validateOpeningPlacement2D(
  wall: Wall,
  opSpec: { width: number; height: number; sill: number },
  offsetM: number,
  ignoreOpeningId?: string,
): ValidationResult {
  if (wall.kind === "fence") {
    return { valid: false, reason: "Pintu/jendela tidak bisa dipasang di pagar" };
  }
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
  const minMargin = 0.08;
  if (len < opSpec.width + minMargin * 2) {
    return { valid: false, reason: `Dinding terlalu pendek (${len.toFixed(1)} m < ${opSpec.width.toFixed(1)} m)` };
  }
  if (offsetM - opSpec.width * 0.5 < minMargin - 0.005 || offsetM + opSpec.width * 0.5 > len - minMargin + 0.005) {
    return { valid: false, reason: "Terlalu dekat ujung dinding" };
  }
  if (opSpec.sill + opSpec.height > wall.height - 0.05) {
    return {
      valid: false,
      reason: `Melebihi tinggi dinding (${(opSpec.sill + opSpec.height).toFixed(2)} m > ${wall.height.toFixed(2)} m)`,
    };
  }

  const cStart = offsetM - opSpec.width * 0.5;
  const cEnd = offsetM + opSpec.width * 0.5;
  const cBottom = opSpec.sill;
  const cTop = opSpec.sill + opSpec.height;
  for (const sib of wall.openings) {
    if (sib.id === ignoreOpeningId) continue;
    const sStart = sib.offset - sib.width * 0.5;
    const sEnd = sib.offset + sib.width * 0.5;
    const horizOverlap = Math.min(cEnd, sEnd) - Math.max(cStart, sStart) > -0.05;
    const vertOverlap = Math.min(cTop, sib.sill + sib.height) - Math.max(cBottom, sib.sill) > -0.03;
    if (horizOverlap && vertOverlap) {
      return { valid: false, reason: "Bertabrakan dengan bukaan lain" };
    }
  }
  return { valid: true };
}

export function canStackOnFurniture(
  item: {
    tool: "furniture" | "light" | "hvac";
    category?: FurnitureCategory;
    catalogId?: string;
    sizeX: number;
    sizeZ: number;
  },
  host: FurnitureItem,
): ValidationResult {
  const isHostAllowed =
    SURFACE_HOST_CATALOG_IDS.has(host.catalogId) || SURFACE_HOST_CATEGORIES.has(host.category);
  if (!isHostAllowed) {
    return { valid: false, reason: "Objek tidak bisa ditumpuk di atas furnitur ini" };
  }
  if (item.tool === "light") {
    return item.sizeX <= 0.6 && item.sizeZ <= 0.6
      ? { valid: true }
      : { valid: false, reason: "Objek terlalu besar untuk ditaruh di atas furnitur ini" };
  }
  if (item.tool === "furniture") {
    const stackable =
      (item.category !== undefined && STACKABLE_FURNITURE_CATEGORIES.has(item.category)) ||
      (item.sizeX <= 0.55 && item.sizeZ <= 0.55 && item.category !== "sanitary" && item.category !== "seating" && item.category !== "bed");
    if (!stackable) {
      return { valid: false, reason: "Objek terlalu besar untuk ditaruh di atas furnitur ini" };
    }
  }
  return { valid: true };
}

export interface ObjectFootprintValidationParams {
  project: Project;
  levelIndex: 0 | 1;
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeZ: number;
  rotationY: number;
  mountKind: "wall" | "ceiling" | "surface";
  tool?: "furniture" | "light" | "hvac";
  catalogId?: string;
  category?: FurnitureCategory;
  hostFurniture?: FurnitureItem | null;
  wallSnap?: { valid: boolean; wall?: Wall; offsetM?: number } | null;
  excludeEntityId?: string;
  altBypass?: boolean;
}

/**
 * Full Sims 4 style oriented footprint validation against lot boundaries, LT2 voids/slabs,
 * walls, stairs, pools, other floor furniture, surface-stacking whitelist, and wall openings.
 */
export function validateObjectFootprint(params: ObjectFootprintValidationParams): ValidationResult {
  const {
    project,
    levelIndex,
    x,
    y,
    z,
    sizeX,
    sizeZ,
    rotationY,
    mountKind,
    tool = "furniture",
    catalogId,
    category,
    hostFurniture,
    wallSnap,
    excludeEntityId,
    altBypass = false,
  } = params;

  const corners = getRotatedObbCorners(x, z, sizeX, sizeZ, rotationY);
  const margin = 0;
  for (const pt of corners) {
    if (pt.x < margin || pt.x > project.site.width - margin || pt.z < margin || pt.z > project.site.depth - margin) {
      return { valid: false, reason: "Di luar batas kavling" };
    }
  }

  const lv = project.levels[levelIndex];
  if (!lv) return { valid: false, reason: "Lantai tidak tersedia" };

  if (mountKind === "wall") {
    if (wallSnap && !wallSnap.valid) {
      return { valid: false, reason: "Arahkan ke permukaan dinding" };
    }
    if (wallSnap?.wall && wallSnap.offsetM !== undefined) {
      const halfSpan = Math.max(0.15, sizeX * 0.45);
      for (const op of wallSnap.wall.openings) {
        if (op.kind === "vent") continue;
        const opLo = op.offset - op.width * 0.5;
        const opHi = op.offset + op.width * 0.5;
        if (
          wallSnap.offsetM + halfSpan > opLo + 0.03 &&
          wallSnap.offsetM - halfSpan < opHi - 0.03 &&
          y + 0.15 > op.sill &&
          y - 0.15 < op.sill + op.height
        ) {
          return { valid: false, reason: "Menghalangi jendela/pintu" };
        }
      }
    }
    return { valid: true };
  }

  if (mountKind !== "surface") return { valid: true };

  // LT2 void & unsupported air checks
  if (levelIndex === 1) {
    const voids = lv.slabs.filter((sl) => sl.isVoid);
    const probes = [{ x, z }, ...corners.map((c) => ({ x: x + (c.x - x) * 0.68, z: z + (c.z - z) * 0.68 }))];
    for (const v of voids) {
      if (probes.some((p) => pointInPolygon(p, v.polygon))) {
        return { valid: false, reason: `Tidak bisa ditaruh di lubang void / udara` };
      }
    }
    const solidSlabs = lv.slabs.filter((sl) => !sl.isVoid);
    if (solidSlabs.length > 0 && !solidSlabs.some((sl) => pointInPolygon({ x, z }, sl.polygon))) {
      return { valid: false, reason: "Tidak bisa ditaruh di lubang void / udara" };
    }
  }

  // Surface stacking whitelist
  if (hostFurniture && y >= 0.08) {
    return canStackOnFurniture({ tool, category, catalogId, sizeX, sizeZ }, hostFurniture);
  }

  if (altBypass) return { valid: true };

  // Floor collision checks (walls, stairs, pools, other floor furniture)
  if (y < 0.08) {
    const itemObb = { cx: x, cz: z, sizeX, sizeZ, rotationY };

    for (const w of lv.walls) {
      if (w.height < 0.6) continue;
      const wdx = w.end.x - w.start.x;
      const wdz = w.end.z - w.start.z;
      const wLen = Math.hypot(wdx, wdz);
      if (wLen < 0.1) continue;
      const wallObb = {
        cx: (w.start.x + w.end.x) * 0.5,
        cz: (w.start.z + w.end.z) * 0.5,
        sizeX: wLen,
        sizeZ: w.thickness,
        rotationY: -Math.atan2(wdz, wdx),
      };
      // Allow flush contact and up to 2.6 cm plaster tolerance so wardrobes/cabinets press cleanly against walls
      if (obbIntersectsObb(itemObb, wallObb, -0.026)) {
        return { valid: false, reason: "Bertabrakan dengan dinding" };
      }
    }

    for (const st of lv.stairs) {
      if (obbIntersectsObb(itemObb, getStairObb(st), 0)) {
        return { valid: false, reason: "Menghalangi tangga" };
      }
    }

    if (levelIndex === 0) {
      for (const pl of project.buildExtras?.pools ?? []) {
        const x1 = Math.min(pl.gx1, pl.gx2) * 0.5;
        const x2 = (Math.max(pl.gx1, pl.gx2) + 1) * 0.5;
        const z1 = Math.min(pl.gz1, pl.gz2) * 0.5;
        const z2 = (Math.max(pl.gz1, pl.gz2) + 1) * 0.5;
        const poolObb = {
          cx: (x1 + x2) * 0.5,
          cz: (z1 + z2) * 0.5,
          sizeX: x2 - x1,
          sizeZ: z2 - z1,
          rotationY: 0,
        };
        if (obbIntersectsObb(itemObb, poolObb, 0)) {
          return { valid: false, reason: "Menimpa area kolam" };
        }
      }
    }

    for (const other of lv.furniture) {
      if (other.id === excludeEntityId) continue;
      if (other.position.y >= 0.08) continue;
      const otherObb = {
        cx: other.position.x,
        cz: other.position.z,
        sizeX: other.size.x,
        sizeZ: other.size.z,
        rotationY: other.rotationY,
      };
      // Allow side-by-side flush contact (up to 1 cm tolerance) between neighboring furniture items
      if (obbIntersectsObb(itemObb, otherObb, -0.01)) {
        return { valid: false, reason: "Bertabrakan dengan furnitur lain" };
      }
    }
  }

  return { valid: true };
}

/**
 * Validate pool placement on LT1 (outside enclosed indoor rooms, away from walls/stairs/other pools).
 */
export function validatePoolPlacement(
  project: Project,
  gx1: number,
  gz1: number,
  gx2: number,
  gz2: number,
  cellSize = 0.5,
): ValidationResult {
  const minX = Math.min(gx1, gx2);
  const maxX = Math.max(gx1, gx2);
  const minZ = Math.min(gz1, gz2);
  const maxZ = Math.max(gz1, gz2);
  const cols = Math.round(project.site.width / cellSize);
  const rows = Math.round(project.site.depth / cellSize);
  if (minX < 0 || minZ < 0 || maxX >= cols || maxZ >= rows) {
    return { valid: false, reason: "Di luar batas kavling" };
  }
  if (maxX - minX < 1 || maxZ - minZ < 1) {
    return { valid: false, reason: "Kolam minimal 1.0 × 1.0 m" };
  }

  const x0 = minX * cellSize;
  const x1 = (maxX + 1) * cellSize;
  const z0 = minZ * cellSize;
  const z1 = (maxZ + 1) * cellSize;
  const poolObb = { cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5, sizeX: x1 - x0, sizeZ: z1 - z0, rotationY: 0 };

  const lv0 = project.levels[0];
  if (lv0) {
    const indoorRooms: Room[] = lv0.rooms.filter(
      (r) => r.program !== "garden" && r.program !== "carport" && r.program !== "void" && r.program !== "balcony",
    );
    const probes: Vec2[] = [
      { x: poolObb.cx, z: poolObb.cz },
      { x: x0 + 0.15, z: z0 + 0.15 },
      { x: x1 - 0.15, z: z0 + 0.15 },
      { x: x1 - 0.15, z: z1 - 0.15 },
      { x: x0 + 0.15, z: z1 - 0.15 },
    ];
    for (const r of indoorRooms) {
      if (probes.some((p) => pointInPolygon(p, r.polygon))) {
        return { valid: false, reason: "Kolam hanya untuk area halaman/taman" };
      }
    }
    for (const w of lv0.walls) {
      const wdx = w.end.x - w.start.x;
      const wdz = w.end.z - w.start.z;
      const wLen = Math.hypot(wdx, wdz);
      if (wLen < 0.1) continue;
      if (
        obbIntersectsObb(
          poolObb,
          {
            cx: (w.start.x + w.end.x) * 0.5,
            cz: (w.start.z + w.end.z) * 0.5,
            sizeX: wLen,
            sizeZ: w.thickness,
            rotationY: -Math.atan2(wdz, wdx),
          },
          0.04,
        )
      ) {
        return { valid: false, reason: "Menabrak dinding" };
      }
    }
    for (const st of lv0.stairs) {
      if (obbIntersectsObb(poolObb, getStairObb(st), 0.04)) {
        return { valid: false, reason: "Menghalangi tangga" };
      }
    }
  }

  for (const pl of project.buildExtras?.pools ?? []) {
    const px1 = Math.min(pl.gx1, pl.gx2) * cellSize;
    const px2 = (Math.max(pl.gx1, pl.gx2) + 1) * cellSize;
    const pz1 = Math.min(pl.gz1, pl.gz2) * cellSize;
    const pz2 = (Math.max(pl.gz1, pl.gz2) + 1) * cellSize;
    if (
      obbIntersectsObb(
        poolObb,
        { cx: (px1 + px2) * 0.5, cz: (pz1 + pz2) * 0.5, sizeX: px2 - px1, sizeZ: pz2 - pz1, rotationY: 0 },
        0.04,
      )
    ) {
      return { valid: false, reason: "Menumpuk kolam lain" };
    }
  }

  return { valid: true };
}
