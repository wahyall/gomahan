import type { Opening, Room, Stair, Vec2, Wall } from "@/lib/model/types";

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
 * Flood-fills contiguous tiles bounded by real `Project` walls on a level.
 */
export function computeProjectRoomFloodCells(
  walls: Wall[],
  cols: number,
  rows: number,
  cellSize: number,
  startGx: number,
  startGz: number,
): GridPoint[] {
  if (startGx < 0 || startGx >= cols || startGz < 0 || startGz >= rows) return [];
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
      if (edgeBlockedByProjectWall(walls, cx, cz, nx, nz, cellSize)) continue;
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
  if (best.len < openingWidth + minMargin * 2) {
    return {
      valid: false,
      reason: `Dinding terlalu pendek (${best.len.toFixed(1)} m < ${openingWidth.toFixed(1)} m)`,
      wall: best.wall,
      offsetM: best.len * 0.5,
      worldX: (best.wall.start.x + best.wall.end.x) * 0.5,
      worldZ: (best.wall.start.z + best.wall.end.z) * 0.5,
      yaw: best.yaw,
    };
  }

  const clampedOff = Math.max(openingWidth * 0.5 + minMargin, Math.min(best.len - openingWidth * 0.5 - minMargin, best.offsetM));
  const ux = (best.wall.end.x - best.wall.start.x) / best.len;
  const uz = (best.wall.end.z - best.wall.start.z) / best.len;
  const worldSnapX = best.wall.start.x + ux * clampedOff;
  const worldSnapZ = best.wall.start.z + uz * clampedOff;

  const cStart = clampedOff - openingWidth * 0.5;
  const cEnd = clampedOff + openingWidth * 0.5;
  for (const sib of best.wall.openings) {
    if (sib.id === ignoreOpeningId) continue;
    const sStart = sib.offset - sib.width * 0.5;
    const sEnd = sib.offset + sib.width * 0.5;
    if (Math.min(cEnd, sEnd) - Math.max(cStart, sStart) > -0.05) {
      return {
        valid: false,
        reason: "Bertabrakan dengan pintu/jendela lain",
        wall: best.wall,
        offsetM: clampedOff,
        worldX: worldSnapX,
        worldZ: worldSnapZ,
        yaw: best.yaw,
      };
    }
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

  for (const st of existingStairs) {
    const sxMin = Math.min(st.start.x, st.end.x) - st.width * 0.5;
    const sxMax = Math.max(st.start.x, st.end.x) + st.width * 0.5;
    const szMin = Math.min(st.start.z, st.end.z) - st.width * 0.5;
    const szMax = Math.max(st.start.z, st.end.z) + st.width * 0.5;
    if (x0 < sxMax - 0.1 && x1 > sxMin + 0.1 && z0 < szMax - 0.1 && z1 > szMin + 0.1) {
      return { valid: false, reason: "Menumpuk tangga yang sudah ada", start, end, voidPoly };
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
): number[] {
  const next = heights.length === (cols + 1) * (rows + 1) ? [...heights] : new Array((cols + 1) * (rows + 1)).fill(0);
  const stride = cols + 1;
  for (let z = 0; z <= rows; z++) {
    for (let x = 0; x <= cols; x++) {
      const dist = Math.hypot(x - centerGx, z - centerGz);
      if (dist > radiusCells) continue;
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
