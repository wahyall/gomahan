import type { BrickSpec, Level, Room, Vec2, Wall } from "@/lib/model/types";

export interface RoomGeometryMetrics {
  room: Room;
  levelIndex: number;
  grossAreaM2: number;
  netAreaM2: number;
  wallDeductionM2: number;
  centroid: Vec2;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; width: number; depth: number };
  tileCount: number;
  tileSizeCm: number;
  isWetRoom: boolean;
  hasOpening: boolean;
  windowAreaM2: number;
}

export interface FloorLevelMetrics {
  levelIndex: number;
  levelName: string;
  grossAreaM2: number;
  netFloorAreaM2: number;
  wallFootprintM2: number;
  reductionPct: number;
  rooms: RoomGeometryMetrics[];
  totalTiles: number;
}

export function polygonArea(poly: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) * 0.5;
}

export function polygonBounds(poly: Vec2[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ, width: Math.max(0, maxX - minX), depth: Math.max(0, maxZ - minZ) };
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const b = polygonBounds(poly);
  return { x: (b.minX + b.maxX) * 0.5, z: (b.minZ + b.maxZ) * 0.5 };
}

export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const zi = poly[i]!.z;
    const xj = poly[j]!.x;
    const zj = poly[j]!.z;
    const intersect =
      zi > pt.z !== zj > pt.z && pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function edgeSharedLengthWithWall(roomPoly: Vec2[], wall: Wall): number {
  let shared = 0;
  for (let i = 0; i < roomPoly.length; i++) {
    const a = roomPoly[i]!;
    const b = roomPoly[(i + 1) % roomPoly.length]!;
    const edX = b.x - a.x;
    const edZ = b.z - a.z;
    const edgeLen = Math.hypot(edX, edZ);
    if (edgeLen < 0.05) continue;

    // Check if wall centerline lies within wall.thickness + 0.06m of this room boundary edge
    const mid: Vec2 = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
    const wLen = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
    if (wLen < 0.05) continue;

    // Dot product of unit vectors to confirm parallel alignment
    const dot = Math.abs((edX / edgeLen) * ((wall.end.x - wall.start.x) / wLen) + (edZ / edgeLen) * ((wall.end.z - wall.start.z) / wLen));
    if (dot < 0.92) continue;

    const dMid = pointToSegmentDist(mid, wall.start, wall.end);
    if (dMid <= wall.thickness * 0.75 + 0.06) {
      // Project wall onto edge
      const ux = edX / edgeLen;
      const uz = edZ / edgeLen;
      const t0 = (wall.start.x - a.x) * ux + (wall.start.z - a.z) * uz;
      const t1 = (wall.end.x - a.x) * ux + (wall.end.z - a.z) * uz;
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(edgeLen, Math.max(t0, t1));
      if (hi > lo) shared += hi - lo;
    }
  }
  return shared;
}

/**
 * Computes exact gross vs net room floor area after deducting real masonry brick wall thickness
 * (so changing custom brick thickness immediately changes room m² and tile grid count!).
 */
export function computeLevelRoomsMetrics(
  level: Level,
  brickSpec: BrickSpec,
  tileSizeCm: 30 | 40 | 60,
): FloorLevelMetrics {
  const rooms: RoomGeometryMetrics[] = [];
  const tileM = tileSizeCm / 100;

  let grossSum = 0;
  let netSum = 0;
  let totalTiles = 0;

  for (const room of level.rooms) {
    const grossArea = polygonArea(room.polygon);
    const bounds = polygonBounds(room.polygon);
    const centroid = polygonCentroid(room.polygon);

    let wallDeduction = 0;
    let hasOpening = room.program === "garden" || room.program === "carport" || room.program === "balcony" || room.program === "void";
    let windowArea = 0;

    if (room.program !== "void") {
      for (const w of level.walls) {
        const effThick = (w.exterior ? brickSpec.outerThicknessMm : brickSpec.innerThicknessMm) / 1000;
        const shared = edgeSharedLengthWithWall(room.polygon, w);
        if (shared > 0.02) {
          // Outer wall sits flush on lot perimeter (half-thickness sits inside room? Wait: wall centerline is at t/2 from boundary, so full thickness or half?
          // For outer walls at edge t/2, full wall thickness t is inside the lot! For interior partition shared between 2 rooms, half thickness t/2 belongs to each room.)
          const factor = w.exterior ? 1.0 : 0.5;
          // Note: avoid double counting outer wall if boundary polygon already touches lot edge (half is already covered by room polygon boundary)
          wallDeduction += shared * effThick * (w.exterior ? 0.92 : factor);
          for (const op of w.openings) {
            if (op.kind === "door" || op.kind === "window" || op.kind === "arch") {
              hasOpening = true;
            }
            if (op.kind === "window" || op.kind === "skylight") {
              windowArea += op.width * op.height;
            }
          }
        }
      }
    }

    const netArea = room.program === "void" ? 0 : Math.max(0.2, grossArea - wallDeduction);
    const isWetRoom = room.program === "bathroom";
    const isTiled =
      room.program !== "garden" &&
      room.program !== "void" &&
      room.program !== "carport";

    const effW = Math.max(0.2, bounds.width - 0.12);
    const effD = Math.max(0.2, bounds.depth - 0.12);
    const nx = Math.max(1, Math.ceil(effW / tileM - 1e-6));
    const nz = Math.max(1, Math.ceil(effD / tileM - 1e-6));
    const tileCount = isTiled ? nx * nz : 0;

    if (room.program !== "void") {
      grossSum += grossArea;
      netSum += netArea;
      totalTiles += tileCount;
    }

    rooms.push({
      room,
      levelIndex: level.index,
      grossAreaM2: grossArea,
      netAreaM2: netArea,
      wallDeductionM2: Math.min(grossArea, wallDeduction),
      centroid,
      bounds,
      tileCount,
      tileSizeCm,
      isWetRoom,
      hasOpening,
      windowAreaM2: windowArea,
    });
  }

  // Exact wall footprint area on this level
  const wallFootprint = level.walls.reduce((s, w) => {
    const effThick = (w.exterior ? brickSpec.outerThicknessMm : brickSpec.innerThicknessMm) / 1000;
    const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
    return s + len * effThick;
  }, 0);

  return {
    levelIndex: level.index,
    levelName: level.name,
    grossAreaM2: grossSum,
    netFloorAreaM2: netSum,
    wallFootprintM2: wallFootprint,
    reductionPct: grossSum > 0 ? ((grossSum - netSum) / grossSum) * 100 : 0,
    rooms,
    totalTiles,
  };
}
