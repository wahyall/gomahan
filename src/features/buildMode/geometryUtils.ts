import type { BuildPoolOverride, Opening, Project, Room, Stair, Vec2, Wall } from "@/lib/model/types";
import {
  getStairObb,
  obbIntersectsObb,
  validateObjectFootprint,
  validateOpeningPlacement2D,
} from "@/features/buildMode/placementValidator";

export interface GridPoint {
  gx: number;
  gz: number;
}

export function worldToGridVertex(x: number, z: number, cellSize: number, cols: number, rows: number): GridPoint {
  return {
    gx: Math.max(0, Math.min(cols, Math.round(x / cellSize))),
    gz: Math.max(0, Math.min(rows, Math.round(z / cellSize))),
  };
}

export function snapWallEndpoint(
  start: GridPoint,
  raw: GridPoint,
  cols: number,
  rows: number,
  allowDiagonal: boolean,
): GridPoint {
  const dx = raw.gx - start.gx;
  const dz = raw.gz - start.gz;
  if (dx === 0 && dz === 0) return { ...start };

  let gx = raw.gx;
  let gz = raw.gz;

  if (!allowDiagonal) {
    if (Math.abs(dx) >= Math.abs(dz)) gz = start.gz;
    else gx = start.gx;
  } else {
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    const ratio = Math.min(adx, adz) / Math.max(1, Math.max(adx, adz));
    if (ratio < 0.4) {
      if (adx >= adz) gz = start.gz;
      else gx = start.gx;
    } else {
      const step = Math.round((adx + adz) * 0.5);
      gx = start.gx + Math.sign(dx) * step;
      gz = start.gz + Math.sign(dz) * step;
    }
  }

  return {
    gx: Math.max(0, Math.min(cols, gx)),
    gz: Math.max(0, Math.min(rows, gz)),
  };
}

export function pointInPolygonXZ(x: number, z: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const zi = poly[i]!.z;
    const xj = poly[j]!.x;
    const zj = poly[j]!.z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findRoomAtPoint(rooms: Room[], worldX: number, worldZ: number): Room | null {
  for (let i = rooms.length - 1; i >= 0; i--) {
    const r = rooms[i]!;
    if (pointInPolygonXZ(worldX, worldZ, r.polygon)) return r;
  }
  return null;
}

function edgeBlockedByProjectWall(walls: Wall[], gx: number, gz: number, nx: number, nz: number, cellSize: number): boolean {
  const bx1 = Math.max(gx, nx) * cellSize;
  const bz1 = Math.max(gz, nz) * cellSize;
  const horizBoundary = nz !== gz; // horizontal wall along Z = bz1 spanning X [gx*cs .. (gx+1)*cs]
  const mx = horizBoundary ? (gx + 0.5) * cellSize : bx1;
  const mz = horizBoundary ? bz1 : (gz + 0.5) * cellSize;

  for (const w of walls) {
    const dx = w.end.x - w.start.x;
    const dz = w.end.z - w.start.z;
    const lenSq = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((mx - w.start.x) * dx + (mz - w.start.z) * dz) / lenSq));
    const px = w.start.x + t * dx;
    const pz = w.start.z + t * dz;
    if (Math.hypot(mx - px, mz - pz) < 0.19) {
      return true;
    }
  }
  return false;
}

/**
 * Flood-fills contiguous tiles bounded by real `Project` walls on a level,
 * excluding blocked regions (void slabs, pools).
 */
export function computeProjectRoomFloodCells(
  walls: Wall[],
  cols: number,
  rows: number,
  cellSize: number,
  startGx: number,
  startGz: number,
  blockedPolys: Vec2[][] = [],
): GridPoint[] {
  if (startGx < 0 || startGx >= cols || startGz < 0 || startGz >= rows) return [];
  const isBlockedCell = (gx: number, gz: number) => {
    if (blockedPolys.length === 0) return false;
    const cx = (gx + 0.5) * cellSize;
    const cz = (gz + 0.5) * cellSize;
    return blockedPolys.some((poly) => pointInPolygonXZ(cx, cz, poly));
  };
  if (isBlockedCell(startGx, startGz)) return [];

  const solidWalls = walls.filter((w) => w.kind !== "fence");
  const visited = new Uint8Array(cols * rows);
  const queue: number[] = [startGx, startGz];
  visited[startGz * cols + startGx] = 1;
  const result: GridPoint[] = [];

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  let head = 0;
  while (head < queue.length) {
    const cx = queue[head++]!;
    const cz = queue[head++]!;
    result.push({ gx: cx, gz: cz });
    for (const [dx, dz] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
      const idx = nz * cols + nx;
      if (visited[idx]) continue;
      if (isBlockedCell(nx, nz)) continue;
      if (edgeBlockedByProjectWall(solidWalls, cx, cz, nx, nz, cellSize)) continue;
      visited[idx] = 1;
      queue.push(nx, nz);
    }
  }
  return result;
}

export interface ProjectOpeningSnap {
  valid: boolean;
  reason?: string;
  wall: Wall;
  offsetM: number;
  worldX: number;
  worldZ: number;
  yaw: number;
}

export function snapOpeningToProjectWalls(
  walls: Wall[],
  worldX: number,
  worldZ: number,
  openingWidth: number,
  ignoreOpeningId?: string,
  openingSill = 0,
  openingHeight = 2.15,
): ProjectOpeningSnap | null {
  const maxSnap = 0.72;
  let best: { wall: Wall; dist: number; offsetM: number; len: number; yaw: number } | null = null;

  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.25) continue;
    const t = Math.max(0, Math.min(1, ((worldX - wall.start.x) * dx + (worldZ - wall.start.z) * dz) / (len * len)));
    const px = wall.start.x + dx * t;
    const pz = wall.start.z + dz * t;
    const dist = Math.hypot(worldX - px, worldZ - pz);
    if (dist <= maxSnap && (!best || dist < best.dist)) {
      best = { wall, dist, offsetM: t * len, len, yaw: -Math.atan2(dz, dx) };
    }
  }
  if (!best) return null;

  const minMargin = 0.08;
  const clampedOff = Math.max(
    openingWidth * 0.5 + minMargin,
    Math.min(Math.max(openingWidth * 0.5 + minMargin, best.len - openingWidth * 0.5 - minMargin), best.offsetM),
  );
  const ux = (best.wall.end.x - best.wall.start.x) / best.len;
  const uz = (best.wall.end.z - best.wall.start.z) / best.len;
  const worldSnapX = best.wall.start.x + ux * clampedOff;
  const worldSnapZ = best.wall.start.z + uz * clampedOff;

  const check2d = validateOpeningPlacement2D(
    best.wall,
    { width: openingWidth, height: openingHeight, sill: openingSill },
    clampedOff,
    ignoreOpeningId,
  );
  if (!check2d.valid) {
    return {
      valid: false,
      reason: check2d.reason,
      wall: best.wall,
      offsetM: clampedOff,
      worldX: worldSnapX,
      worldZ: worldSnapZ,
      yaw: best.yaw,
    };
  }

  return {
    valid: true,
    wall: best.wall,
    offsetM: Number(clampedOff.toFixed(3)),
    worldX: worldSnapX,
    worldZ: worldSnapZ,
    yaw: best.yaw,
  };
}

export function getStairSpan(widthCells: number, lengthCells: number, rotationQuarter: 0 | 1 | 2 | 3) {
  const rot90 = rotationQuarter === 1 || rotationQuarter === 3;
  return {
    spanCols: rot90 ? lengthCells : widthCells,
    spanRows: rot90 ? widthCells : lengthCells,
  };
}

export function validateProjectStairPlacement(
  existingStairs: Stair[],
  levelIndex: number,
  gx: number,
  gz: number,
  widthCells: number,
  lengthCells: number,
  rotationQuarter: 0 | 1 | 2 | 3,
  cols: number,
  rows: number,
  cellSize: number,
  existingWalls: Wall[] = [],
  pools: BuildPoolOverride[] = [],
): { valid: boolean; reason?: string; start: Vec2; end: Vec2; voidPoly: Vec2[] } {
  const { spanCols, spanRows } = getStairSpan(widthCells, lengthCells, rotationQuarter);
  const x0 = gx * cellSize;
  const z0 = gz * cellSize;
  const x1 = (gx + spanCols) * cellSize;
  const z1 = (gz + spanRows) * cellSize;
  const cx = (x0 + x1) * 0.5;
  const cz = (z0 + z1) * 0.5;

  let start: Vec2;
  let end: Vec2;
  if (rotationQuarter === 0) {
    start = { x: cx, z: z0 };
    end = { x: cx, z: z1 };
  } else if (rotationQuarter === 2) {
    start = { x: cx, z: z1 };
    end = { x: cx, z: z0 };
  } else if (rotationQuarter === 1) {
    start = { x: x0, z: cz };
    end = { x: x1, z: cz };
  } else {
    start = { x: x1, z: cz };
    end = { x: x0, z: cz };
  }

  const voidPoly: Vec2[] = [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];

  if (levelIndex !== 0) {
    return { valid: false, reason: "Pasang tangga di Lantai 1 untuk menghubungkan ke Lantai 2", start, end, voidPoly };
  }
  if (gx < 0 || gz < 0 || gx + spanCols > cols || gz + spanRows > rows) {
    return { valid: false, reason: "Keluar batas kavling 5×17 m", start, end, voidPoly };
  }

  const candObb = {
    cx,
    cz,
    sizeX: x1 - x0,
    sizeZ: z1 - z0,
    rotationY: 0,
  };

  for (const st of existingStairs) {
    if (obbIntersectsObb(candObb, getStairObb(st), 0.08)) {
      return { valid: false, reason: "Menumpuk tangga yang sudah ada", start, end, voidPoly };
    }
  }

  for (const w of existingWalls) {
    if (w.height < 1.5) continue;
    const wdx = w.end.x - w.start.x;
    const wdz = w.end.z - w.start.z;
    const wLen = Math.hypot(wdx, wdz);
    if (wLen < 0.1) continue;
    if (
      obbIntersectsObb(
        candObb,
        {
          cx: (w.start.x + w.end.x) * 0.5,
          cz: (w.start.z + w.end.z) * 0.5,
          sizeX: wLen,
          sizeZ: w.thickness,
          rotationY: -Math.atan2(wdz, wdx),
        },
        0.08,
      )
    ) {
      return { valid: false, reason: "Menabrak dinding", start, end, voidPoly };
    }
  }

  for (const pl of pools) {
    const px0 = Math.min(pl.gx1, pl.gx2) * cellSize;
    const px1 = (Math.max(pl.gx1, pl.gx2) + 1) * cellSize;
    const pz0 = Math.min(pl.gz1, pl.gz2) * cellSize;
    const pz1 = (Math.max(pl.gz1, pl.gz2) + 1) * cellSize;
    if (
      obbIntersectsObb(
        candObb,
        { cx: (px0 + px1) * 0.5, cz: (pz0 + pz1) * 0.5, sizeX: px1 - px0, sizeZ: pz1 - pz0, rotationY: 0 },
        0.06,
      )
    ) {
      return { valid: false, reason: "Menimpa area kolam", start, end, voidPoly };
    }
  }

  return { valid: true, start, end, voidPoly };
}

export function applyTerrainBrushToHeights(
  heights: number[],
  cols: number,
  rows: number,
  centerGx: number,
  centerGz: number,
  mode: "raise" | "lower" | "flatten",
  deltaM = 0.2,
  radiusCells = 2.5,
  protectedPolys: Vec2[][] = [],
): number[] {
  const next = heights.length === (cols + 1) * (rows + 1) ? [...heights] : new Array((cols + 1) * (rows + 1)).fill(0);
  const stride = cols + 1;
  for (let z = 0; z <= rows; z++) {
    for (let x = 0; x <= cols; x++) {
      const dist = Math.hypot(x - centerGx, z - centerGz);
      if (dist > radiusCells) continue;
      const wx = x * 0.5;
      const wz = z * 0.5;
      if (protectedPolys.length > 0 && protectedPolys.some((poly) => pointInPolygonXZ(wx, wz, poly))) {
        next[z * stride + x] = Math.min(0, next[z * stride + x] ?? 0);
        continue;
      }
      const falloff = 0.5 * (1 + Math.cos((Math.PI * dist) / radiusCells));
      const idx = z * stride + x;
      const curr = next[idx] ?? 0;
      if (mode === "flatten") next[idx] = Number((curr * (1 - Math.min(1, falloff * 0.9))).toFixed(3));
      else if (mode === "raise") next[idx] = Number(Math.min(1.6, curr + deltaM * falloff).toFixed(3));
      else next[idx] = Number(Math.max(-0.6, curr - deltaM * falloff).toFixed(3));
    }
  }
  return next;
}

export function createOpeningForWall(
  id: string,
  kind: Opening["kind"],
  offset: number,
  width: number,
  height: number,
  sill: number,
  label: string,
): Opening {
  return {
    id,
    kind,
    width,
    height,
    sill,
    offset,
    swing: 1,
    openPct: kind === "door" ? 40 : 60,
    frameMaterialId: kind === "door" || kind === "arch" ? "wood_teak" : kind === "vent" ? "concrete_roster" : "alu_dark",
    glassMaterialId: kind === "window" ? "glass_clear" : undefined,
    label,
  };
}

/**
 * Determine whether a wall should drop to cutaway stub when POV/camera faces it.
 * Evaluates closest point on the wall segment relative to live orbit target along camera look ray.
 */
export function isWallCutawayCandidate(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  camX: number,
  camZ: number,
  targetX: number,
  targetZ: number,
  exterior?: boolean,
): boolean {
  const vx = camX - targetX;
  const vz = camZ - targetZ;
  const vLen = Math.hypot(vx, vz);
  if (vLen < 1e-4) return false;
  const ux = vx / vLen;
  const uz = vz / vLen;

  const wx = endX - startX;
  const wz = endZ - startZ;
  const wLenSq = wx * wx + wz * wz;
  if (wLenSq < 1e-6) return false;
  const wLen = Math.sqrt(wLenSq);
  // Wall normal in XZ: skip nearly edge-on walls so side framing stays intact
  const nx = -wz / wLen;
  const nz = wx / wLen;
  const edgeThreshold = exterior ? 0.18 : 0.28;
  if (Math.abs(nx * ux + nz * uz) <= edgeThreshold) return false;

  const t = Math.max(0, Math.min(1, ((targetX - startX) * wx + (targetZ - startZ) * wz) / wLenSq));
  const cx = startX + wx * t;
  const cz = startZ + wz * t;
  const dot = (cx - targetX) * ux + (cz - targetZ) * uz;
  if (exterior === true) return dot > 0.05;
  return dot > 0.25;
}

/**
 * Validate 2D XZ footprint placement against lot boundaries, walls, LT2 void holes, stairs, pools, and furniture.
 */
export function validateFootprintPlacement(
  project: Project,
  lvIdx: 0 | 1,
  cx: number,
  cz: number,
  sizeX: number,
  sizeZ: number,
  rotationY: number,
  mountKind: "wall" | "ceiling" | "surface",
  elevY = 0,
  excludeEntityId?: string,
  altBypass = false,
): { valid: boolean; reason?: string } {
  return validateObjectFootprint({
    project,
    levelIndex: lvIdx,
    x: cx,
    y: elevY,
    z: cz,
    sizeX,
    sizeZ,
    rotationY,
    mountKind,
    excludeEntityId,
    altBypass,
  });
}
