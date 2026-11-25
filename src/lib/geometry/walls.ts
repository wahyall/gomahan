import type { Opening, Vec2, Wall } from "@/lib/model/types";

export interface WallMetrics {
  wall: Wall;
  length: number;
  dx: number;
  dz: number;
  ux: number; // unit direction X
  uz: number; // unit direction Z
  nx: number; // unit normal X
  nz: number; // unit normal Z
  angleRad: number;
  footprint: [Vec2, Vec2, Vec2, Vec2];
  grossArea: number;
  openingArea: number;
  netArea: number;
  netVolume: number;
  footprintArea: number;
}

export function wallLength(w: Wall): number {
  return Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
}

export function computeWallMetrics(w: Wall, slopeExtraAt?: (x: number, z: number) => number): WallMetrics {
  const dx = w.end.x - w.start.x;
  const dz = w.end.z - w.start.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const ux = dx / length;
  const uz = dz / length;
  const nx = -uz;
  const nz = ux;
  const angleRad = Math.atan2(dz, dx);
  const ht = w.thickness / 2;

  const footprint: [Vec2, Vec2, Vec2, Vec2] = [
    { x: w.start.x + nx * ht, z: w.start.z + nz * ht },
    { x: w.end.x + nx * ht, z: w.end.z + nz * ht },
    { x: w.end.x - nx * ht, z: w.end.z - nz * ht },
    { x: w.start.x - nx * ht, z: w.start.z - nz * ht },
  ];

  // Average extra height from roof slope if on top storey exterior wall
  let extraArea = 0;
  if (slopeExtraAt) {
    const h0 = Math.max(0, slopeExtraAt(w.start.x, w.start.z));
    const h1 = Math.max(0, slopeExtraAt(w.end.x, w.end.z));
    extraArea = ((h0 + h1) * 0.5) * length;
  }

  const grossArea = w.height * length + extraArea;
  const openingArea = w.openings.reduce((acc, o) => acc + openingCutArea(w, o), 0);
  const netArea = Math.max(0, grossArea - openingArea);
  const netVolume = netArea * w.thickness;
  const footprintArea = length * w.thickness;

  return {
    wall: w,
    length,
    dx,
    dz,
    ux,
    uz,
    nx,
    nz,
    angleRad,
    footprint,
    grossArea,
    openingArea,
    netArea,
    netVolume,
    footprintArea,
  };
}

export function openingCutArea(w: Wall, o: Opening): number {
  const len = wallLength(w);
  const start = Math.max(0, o.offset - o.width / 2);
  const end = Math.min(len, o.offset + o.width / 2);
  const effW = Math.max(0, end - start);
  const effTop = Math.min(w.height, o.sill + o.height);
  const effH = Math.max(0, effTop - o.sill);
  return effW * effH;
}

export function openingBoundsAlongWall(w: Wall, o: Opening): { lo: number; hi: number; sill: number; top: number } {
  const len = wallLength(w);
  const lo = Math.max(0, o.offset - o.width / 2);
  const hi = Math.min(len, o.offset + o.width / 2);
  return {
    lo,
    hi,
    sill: Math.max(0, o.sill),
    top: Math.min(w.height, o.sill + o.height),
  };
}

export function wallPointAt(w: Wall, distAlong: number): Vec2 {
  const len = wallLength(w);
  const t = len > 0 ? distAlong / len : 0;
  return {
    x: w.start.x + (w.end.x - w.start.x) * t,
    z: w.start.z + (w.end.z - w.start.z) * t,
  };
}
