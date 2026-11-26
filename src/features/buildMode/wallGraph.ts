import type { Level, Opening, Room, Site, Slab, Vec2, Wall } from "@/lib/model/types";
import { pointInPolygon, polygonArea, polygonBounds, polygonCentroid } from "@/lib/geometry/rooms";

const EPS = 0.04;
const MIN_WALL_LEN = 0.25;
const MIN_ROOM_AREA = 0.5;

function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function signedAreaXZ(poly: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum * 0.5;
}

function projectOnSeg(p: Vec2, a: Vec2, b: Vec2): { along: number; len: number; dist: number; proj: Vec2 } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { along: 0, len: 0, dist: dist2(p, a), proj: { ...a } };
  const ux = dx / len;
  const uz = dz / len;
  const along = (p.x - a.x) * ux + (p.z - a.z) * uz;
  const t = Math.max(0, Math.min(len, along));
  const px = a.x + ux * t;
  const pz = a.z + uz * t;
  return { along, len, dist: Math.hypot(p.x - px, p.z - pz), proj: { x: px, z: pz } };
}

function segSegmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { tA: number; tB: number; pt: Vec2 } | null {
  const rX = a2.x - a1.x;
  const rZ = a2.z - a1.z;
  const sX = b2.x - b1.x;
  const sZ = b2.z - b1.z;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-6) return null;
  const qpx = b1.x - a1.x;
  const qpz = b1.z - a1.z;
  const tA = (qpx * sZ - qpz * sX) / denom;
  const tB = (qpx * rZ - qpz * rX) / denom;
  if (tA > 0.015 && tA < 0.985 && tB > 0.015 && tB < 0.985) {
    return {
      tA,
      tB,
      pt: { x: roundCoord(a1.x + tA * rX), z: roundCoord(a1.z + tA * rZ) },
    };
  }
  return null;
}

function estimatePolyOverlapM2(polyA: Vec2[], polyB: Vec2[]): number {
  const ba = polygonBounds(polyA);
  const bb = polygonBounds(polyB);
  const x0 = Math.max(ba.minX, bb.minX);
  const x1 = Math.min(ba.maxX, bb.maxX);
  const z0 = Math.max(ba.minZ, bb.minZ);
  const z1 = Math.min(ba.maxZ, bb.maxZ);
  if (x1 <= x0 + 0.01 || z1 <= z0 + 0.01) return 0;

  const w = x1 - x0;
  const d = z1 - z0;
  const step = Math.min(0.15, Math.max(0.06, Math.min(w, d) / 8));
  const nx = Math.max(4, Math.ceil(w / step));
  const nz = Math.max(4, Math.ceil(d / step));
  const dx = w / nx;
  const dz = d / nz;
  let hits = 0;
  for (let ix = 0; ix < nx; ix++) {
    const px = x0 + (ix + 0.5) * dx;
    for (let iz = 0; iz < nz; iz++) {
      const pz = z0 + (iz + 0.5) * dz;
      if (pointInPolygon({ x: px, z: pz }, polyA) && pointInPolygon({ x: px, z: pz }, polyB)) {
        hits++;
      }
    }
  }
  return hits * dx * dz;
}

function sameMaterialProfile(a: Wall, b: Wall): boolean {
  return (
    (a.kind ?? "wall") === (b.kind ?? "wall") &&
    Math.abs(a.height - b.height) < 0.02 &&
    Math.abs(a.thickness - b.thickness) < 0.01 &&
    (a.frontMaterialId ?? a.materialId) === (b.frontMaterialId ?? b.materialId) &&
    (a.backMaterialId ?? a.materialId) === (b.backMaterialId ?? b.materialId) &&
    (a.partyWallSide ?? null) === (b.partyWallSide ?? null)
  );
}

function sameSegmentEndpoints(a: Wall, b: Wall): boolean {
  return (
    (dist2(a.start, b.start) < EPS && dist2(a.end, b.end) < EPS) ||
    (dist2(a.start, b.end) < EPS && dist2(a.end, b.start) < EPS)
  );
}

/**
 * Snap endpoints within EPS, split walls at T-junctions & X-crossings while migrating openings,
 * deduplicate coincident walls, and merge degree-2 collinear segments with identical attributes.
 */
export function normalizeAndSplitWalls(rawWalls: Wall[]): {
  walls: Wall[];
  warnings: string[];
  blockedByOpening?: string;
} {
  const warnings: string[] = [];
  const fences = rawWalls.filter((w) => w.kind === "fence").map((w) => ({ ...w, openings: [] }));
  const inputStruct = rawWalls
    .filter((w) => w.kind !== "fence" && dist2(w.start, w.end) >= MIN_WALL_LEN)
    .map((w) => ({
      ...w,
      start: { x: roundCoord(w.start.x), z: roundCoord(w.start.z) },
      end: { x: roundCoord(w.end.x), z: roundCoord(w.end.z) },
      openings: w.openings.map((o) => ({ ...o })),
    }));

  if (inputStruct.length === 0) {
    return { walls: fences, warnings };
  }

  // 1. Canonicalize close vertices so near endpoints share exact coordinates
  const canonicalVerts: Vec2[] = [];
  const snapPt = (p: Vec2): Vec2 => {
    for (const v of canonicalVerts) {
      if (dist2(p, v) <= EPS) return { ...v };
    }
    const clean = { x: roundCoord(p.x), z: roundCoord(p.z) };
    canonicalVerts.push(clean);
    return { ...clean };
  };
  for (const w of inputStruct) {
    w.start = snapPt(w.start);
    w.end = snapPt(w.end);
  }

  // 2. Gather split distances along each wall from T-junctions, X-crossings, and collinear overlaps
  const splitMarks = new Map<string, number[]>();
  for (const w of inputStruct) splitMarks.set(w.id, []);

  for (let i = 0; i < inputStruct.length; i++) {
    const w = inputStruct[i]!;
    const len = dist2(w.start, w.end);
    const marks = splitMarks.get(w.id)!;

    for (let j = 0; j < inputStruct.length; j++) {
      if (i === j) continue;
      const other = inputStruct[j]!;
      for (const pt of [other.start, other.end]) {
        const pr = projectOnSeg(pt, w.start, w.end);
        if (pr.dist <= EPS && pr.along > EPS && pr.along < len - EPS) {
          marks.push(pr.along);
        }
      }
      if (j > i) {
        const hit = segSegmentIntersection(w.start, w.end, other.start, other.end);
        if (hit) {
          const otherLen = dist2(other.start, other.end);
          marks.push(hit.tA * len);
          splitMarks.get(other.id)!.push(hit.tB * otherLen);
        }
      }
    }
  }

  // 3. Split walls & migrate openings cleanly to child segments
  let splitWalls: Wall[] = [];
  for (const w of inputStruct) {
    const len = dist2(w.start, w.end);
    const ux = (w.end.x - w.start.x) / len;
    const uz = (w.end.z - w.start.z) / len;
    const rawMarks = (splitMarks.get(w.id) ?? []).sort((a, b) => a - b);
    const pts: number[] = [0];
    for (const m of rawMarks) {
      if (m - pts[pts.length - 1]! > EPS && len - m > EPS) {
        pts.push(m);
      }
    }
    pts.push(len);

    if (pts.length <= 2) {
      splitWalls.push(w);
      continue;
    }

    // Check if any split cuts directly through an opening body
    for (let k = 1; k < pts.length - 1; k++) {
      const sSplit = pts[k]!;
      for (const op of w.openings) {
        if (sSplit > op.offset - op.width * 0.5 + 0.03 && sSplit < op.offset + op.width * 0.5 - 0.03) {
          const msg = `Pemotongan T-junction memotong bukaan "${op.label}" pada ${w.name}`;
          warnings.push(msg);
          return { walls: rawWalls, warnings, blockedByOpening: msg };
        }
      }
    }

    let longestIdx = 0;
    let longestSpan = -1;
    for (let k = 0; k < pts.length - 1; k++) {
      const sp = pts[k + 1]! - pts[k]!;
      if (sp > longestSpan) {
        longestSpan = sp;
        longestIdx = k;
      }
    }

    for (let k = 0; k < pts.length - 1; k++) {
      const s0 = pts[k]!;
      const s1 = pts[k + 1]!;
      const segLen = s1 - s0;
      if (segLen < MIN_WALL_LEN) continue;
      const subStart: Vec2 = { x: roundCoord(w.start.x + ux * s0), z: roundCoord(w.start.z + uz * s0) };
      const subEnd: Vec2 = { x: roundCoord(w.start.x + ux * s1), z: roundCoord(w.start.z + uz * s1) };
      const migratedOps: Opening[] = [];
      for (const op of w.openings) {
        if (op.offset >= s0 - 0.02 && op.offset <= s1 + 0.02) {
          const nextOff = Math.max(op.width * 0.5 + 0.04, Math.min(segLen - op.width * 0.5 - 0.04, op.offset - s0));
          if (op.width <= segLen - 0.05) {
            migratedOps.push({ ...op, offset: Number(nextOff.toFixed(3)) });
          }
        }
      }
      splitWalls.push({
        ...w,
        id: k === longestIdx ? w.id : `${w.id}-s${k}`,
        start: subStart,
        end: subEnd,
        openings: migratedOps,
      });
    }
  }

  // 4. Deduplicate coincident segments (keep openings & custom paint)
  const deduped: Wall[] = [];
  for (const w of splitWalls) {
    const existingIdx = deduped.findIndex((ex) => sameSegmentEndpoints(ex, w));
    if (existingIdx >= 0) {
      const ex = deduped[existingIdx]!;
      if (ex.openings.length === 0 && w.openings.length > 0) {
        deduped[existingIdx] = { ...ex, openings: w.openings };
      }
      continue;
    }
    deduped.push(w);
  }
  splitWalls = deduped;

  // 5. Merge degree-2 collinear segments sharing identical physical attributes
  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    const vertMap = new Map<string, { pt: Vec2; walls: Wall[] }>();
    const vKey = (p: Vec2) => {
      for (const [k, entry] of vertMap.entries()) {
        if (dist2(p, entry.pt) <= EPS) return k;
      }
      const k = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
      vertMap.set(k, { pt: { ...p }, walls: [] });
      return k;
    };
    for (const w of splitWalls) {
      const k1 = vKey(w.start);
      const k2 = vKey(w.end);
      vertMap.get(k1)!.walls.push(w);
      if (k2 !== k1) vertMap.get(k2)!.walls.push(w);
    }

    for (const entry of vertMap.values()) {
      if (entry.walls.length !== 2) continue;
      const [a, b] = entry.walls as [Wall, Wall];
      if (a.id === b.id || !sameMaterialProfile(a, b)) continue;

      const pt = entry.pt;
      const aOther = dist2(a.start, pt) <= EPS ? a.end : a.start;
      const bOther = dist2(b.start, pt) <= EPS ? b.end : b.start;
      const vaX = pt.x - aOther.x;
      const vaZ = pt.z - aOther.z;
      const vbX = bOther.x - pt.x;
      const vbZ = bOther.z - pt.z;
      const la = Math.hypot(vaX, vaZ);
      const lb = Math.hypot(vbX, vbZ);
      if (la < 0.05 || lb < 0.05) continue;
      const dot = (vaX / la) * (vbX / lb) + (vaZ / la) * (vbZ / lb);
      if (dot < 0.996) continue;

      // Also verify front/back winding direction if wall has asymmetric materials
      const aForward = dist2(a.end, pt) <= EPS;
      const bForward = dist2(b.start, pt) <= EPS;
      const sameDir = aForward === bForward;
      if (!sameDir && (a.frontMaterialId ?? a.materialId) !== (a.backMaterialId ?? a.materialId)) {
        continue;
      }

      const newStart = aOther;
      const newEnd = bOther;
      const mapOps = (w: Wall, flipped: boolean, shift: number): Opening[] => {
        const wl = dist2(w.start, w.end);
        return w.openings.map((op) => ({
          ...op,
          offset: Number((shift + (flipped ? wl - op.offset : op.offset)).toFixed(3)),
          swing: flipped ? ((op.swing === 1 ? -1 : 1) as 1 | -1) : op.swing,
        }));
      };
      const aOps = mapOps(a, !aForward, 0);
      const bOps = mapOps(b, !bForward, la);
      const mergedWall: Wall = {
        ...a,
        start: { ...newStart },
        end: { ...newEnd },
        openings: [...aOps, ...bOps],
      };

      splitWalls = splitWalls.filter((w) => w.id !== a.id && w.id !== b.id);
      splitWalls.push(mergedWall);
      mergedAny = true;
      break;
    }
  }

  return { walls: [...splitWalls, ...fences], warnings };
}

interface HalfEdge {
  id: number;
  u: number;
  v: number;
  angle: number;
  twin: number;
  next: number;
  visited: boolean;
  wall: Wall;
}

/**
 * Extracts minimal CCW planar cycles (rooms) from structural walls.
 */
export function extractMinimalCycles(walls: Wall[]): { polygon: Vec2[]; boundaryWalls: Wall[] }[] {
  const struct = walls.filter((w) => w.kind !== "fence" && dist2(w.start, w.end) >= MIN_WALL_LEN);
  if (struct.length < 3) return [];

  const verts: Vec2[] = [];
  const getVid = (p: Vec2): number => {
    for (let i = 0; i < verts.length; i++) {
      if (dist2(verts[i]!, p) <= EPS) return i;
    }
    verts.push({ x: roundCoord(p.x), z: roundCoord(p.z) });
    return verts.length - 1;
  };

  let edgeWalls = struct.map((w) => ({
    wall: w,
    u: getVid(w.start),
    v: getVid(w.end),
  })).filter((e) => e.u !== e.v);

  // Iteratively strip degree-1 dangling stubs so only cyclic graph remains
  let pruned = true;
  while (pruned) {
    pruned = false;
    const deg = new Map<number, number>();
    for (const e of edgeWalls) {
      deg.set(e.u, (deg.get(e.u) ?? 0) + 1);
      deg.set(e.v, (deg.get(e.v) ?? 0) + 1);
    }
    const next = edgeWalls.filter((e) => (deg.get(e.u) ?? 0) >= 2 && (deg.get(e.v) ?? 0) >= 2);
    if (next.length !== edgeWalls.length) {
      edgeWalls = next;
      pruned = true;
    }
  }

  if (edgeWalls.length < 3) return [];

  const halfEdges: HalfEdge[] = [];
  const outgoing = new Map<number, HalfEdge[]>();
  const addOut = (u: number, he: HalfEdge) => {
    let list = outgoing.get(u);
    if (!list) {
      list = [];
      outgoing.set(u, list);
    }
    list.push(he);
  };

  for (const ew of edgeWalls) {
    const pu = verts[ew.u]!;
    const pv = verts[ew.v]!;
    const fwdId = halfEdges.length;
    const revId = fwdId + 1;
    const fwd: HalfEdge = {
      id: fwdId,
      u: ew.u,
      v: ew.v,
      angle: Math.atan2(pv.z - pu.z, pv.x - pu.x),
      twin: revId,
      next: -1,
      visited: false,
      wall: ew.wall,
    };
    const rev: HalfEdge = {
      id: revId,
      u: ew.v,
      v: ew.u,
      angle: Math.atan2(pu.z - pv.z, pu.x - pv.x),
      twin: fwdId,
      next: -1,
      visited: false,
      wall: ew.wall,
    };
    halfEdges.push(fwd, rev);
    addOut(ew.u, fwd);
    addOut(ew.v, rev);
  }

  for (const list of outgoing.values()) {
    list.sort((a, b) => a.angle - b.angle);
  }

  // Link next half-edge by taking predecessor of twin in CCW-sorted outgoing list around v
  for (const he of halfEdges) {
    const list = outgoing.get(he.v);
    if (!list || list.length === 0) continue;
    const twinEdge = halfEdges[he.twin]!;
    const idx = list.indexOf(twinEdge);
    if (idx < 0) continue;
    const nextIdx = (idx - 1 + list.length) % list.length;
    he.next = list[nextIdx]!.id;
  }

  const cycles: { polygon: Vec2[]; boundaryWalls: Wall[] }[] = [];
  for (const startEdge of halfEdges) {
    if (startEdge.visited || startEdge.next < 0) continue;
    const polyVerts: Vec2[] = [];
    const bWalls = new Set<Wall>();
    let curr: HalfEdge | undefined = startEdge;
    let guard = 0;
    while (curr && !curr.visited && guard++ <= halfEdges.length + 2) {
      curr.visited = true;
      polyVerts.push({ ...verts[curr.u]! });
      bWalls.add(curr.wall);
      curr = curr.next >= 0 ? halfEdges[curr.next] : undefined;
      if (curr === startEdge) break;
    }

    if (curr === startEdge && polyVerts.length >= 3) {
      const sArea = signedAreaXZ(polyVerts);
      if (sArea >= MIN_ROOM_AREA) {
        cycles.push({ polygon: polyVerts, boundaryWalls: [...bWalls] });
      }
    }
  }

  return cycles;
}

function wereSeparatedByPrevWall(rA: Room, rB: Room, prevWalls: Wall[]): boolean {
  const cA = polygonCentroid(rA.polygon);
  const cB = polygonCentroid(rB.polygon);
  for (const w of prevWalls) {
    if (w.kind === "fence") continue;
    const hit = segSegmentIntersection(cA, cB, w.start, w.end);
    if (hit) return true;
  }
  return false;
}

/**
 * Full Planar Wall-Graph reconciliation for a Level:
 * 1. Normalizes & splits walls at T-junctions / crossings while preserving openings
 * 2. Extracts minimal closed cycles and preserves room names/programs/materials across splits & merges
 * 3. Derives `wall.exterior` automatically from adjacent indoor cycles
 * 4. For LT2 (`levelIndex === 1`), regenerates solid floor slabs while preserving void & overhang slabs
 */
export function reconcileLevelTopology(
  level: Level,
  levelIndex: 0 | 1,
  prevWalls?: Wall[],
): { level: Level; warnings: string[]; blockedByOpening?: string } {
  const norm = normalizeAndSplitWalls(level.walls);
  if (norm.blockedByOpening) {
    return { level, warnings: norm.warnings, blockedByOpening: norm.blockedByOpening };
  }

  const nextWalls = norm.walls;
  const cycles = extractMinimalCycles(nextWalls);
  const prevRooms = level.rooms;

  const isOutdoorProgram = (p: Room["program"]) =>
    p === "garden" || p === "carport" || p === "void" || p === "balcony";

  const cycleRecords = cycles.map((c, idx) => {
    const area = polygonArea(c.polygon);
    const hasLowBoundary = c.boundaryWalls.some((w) => w.height < 2.8);
    const matches = prevRooms
      .map((r) => {
        const ov = estimatePolyOverlapM2(c.polygon, r.polygon);
        const rArea = Math.max(0.1, polygonArea(r.polygon));
        return { room: r, ov, ratioToCycle: ov / Math.max(0.1, area), ratioToRoom: ov / rArea };
      })
      .filter((m) => m.ov > 0.15 && (m.ratioToRoom >= 0.35 || m.ratioToCycle >= 0.35))
      .sort((a, b) => b.ov - a.ov);

    const isOutdoorGardenOrVoid =
      hasLowBoundary &&
      matches.length > 0 &&
      (matches[0]!.room.program === "garden" || matches[0]!.room.program === "void");

    return {
      idx,
      polygon: c.polygon,
      area,
      isOutdoor: isOutdoorGardenOrVoid,
      matches,
    };
  });

  // Track how many cycles each previous room maps to (detect splits vs merges vs open-plan)
  const roomToCycleCount = new Map<string, number>();
  for (const cr of cycleRecords) {
    for (const m of cr.matches) {
      roomToCycleCount.set(m.room.id, (roomToCycleCount.get(m.room.id) ?? 0) + 1);
    }
  }

  const nextRooms: Room[] = [];
  const claimedPrevRoomIds = new Set<string>();
  let newRoomCounter = 1;

  for (const cr of cycleRecords) {
    const indoorMatches = cr.matches.filter((m) => !isOutdoorProgram(m.room.program));

    // Preserve pre-existing open-plan rooms if they were NOT separated by a removed wall
    if (!cr.isOutdoor && indoorMatches.length >= 2) {
      const separatedByDeletedWall =
        prevWalls !== undefined &&
        indoorMatches.some((a, i) =>
          indoorMatches.slice(i + 1).some((b) => wereSeparatedByPrevWall(a.room, b.room, prevWalls)),
        );
      const anySplit = indoorMatches.some((m) => (roomToCycleCount.get(m.room.id) ?? 0) > 1);
      if (!separatedByDeletedWall && !anySplit) {
        const combinedPrevArea = indoorMatches.reduce((s, m) => s + polygonArea(m.room.polygon), 0);
        if (Math.abs(combinedPrevArea - cr.area) < Math.max(1.2, cr.area * 0.25)) {
          for (const m of indoorMatches) {
            if (!claimedPrevRoomIds.has(m.room.id)) {
              claimedPrevRoomIds.add(m.room.id);
              nextRooms.push(m.room);
            }
          }
          continue;
        }
      }
    }

    const bestMatch = cr.matches.find((m) => !claimedPrevRoomIds.has(m.room.id));
    if (bestMatch) {
      claimedPrevRoomIds.add(bestMatch.room.id);
      nextRooms.push({
        ...bestMatch.room,
        polygon: cr.polygon,
      });
    } else {
      // Split child or brand new closed cycle
      const parentTemplate = cr.matches[0]?.room;
      nextRooms.push({
        id: `room-${Date.now().toString(36)}-${levelIndex}-${newRoomCounter}`,
        name: `Ruang Baru ${newRoomCounter++}`,
        program: parentTemplate && !isOutdoorProgram(parentTemplate.program) ? parentTemplate.program : "living",
        polygon: cr.polygon,
        floorMaterialId: parentTemplate?.floorMaterialId ?? "tile_40_cream",
        ceilingHeight: parentTemplate?.ceilingHeight ?? level.height,
      });
    }
  }

  // Keep outdoor/unwalled zones (garden, carport, balcony, teras) unless covered by new indoor cycle
  for (const r of prevRooms) {
    if (claimedPrevRoomIds.has(r.id)) continue;
    const isUnwalledOutdoor = isOutdoorProgram(r.program) || r.program === "circulation";
    if (!isUnwalledOutdoor) continue;
    const coveredByNewIndoor = cycleRecords
      .filter((c) => !c.isOutdoor)
      .reduce((s, c) => s + estimatePolyOverlapM2(c.polygon, r.polygon), 0);
    if (coveredByNewIndoor < polygonArea(r.polygon) * 0.6) {
      nextRooms.push(r);
    }
  }

  // Derive wall.exterior automatically from indoor cycles
  const indoorPolys = cycleRecords.filter((c) => !c.isOutdoor).map((c) => c.polygon);
  const pointInIndoorCycle = (pt: Vec2) => indoorPolys.some((poly) => pointInPolygon(pt, poly));

  const finalWalls = nextWalls.map((w) => {
    if (w.kind === "fence") return { ...w, exterior: true };
    const dx = w.end.x - w.start.x;
    const dz = w.end.z - w.start.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const mx = (w.start.x + w.end.x) * 0.5;
    const mz = (w.start.z + w.end.z) * 0.5;
    const inLeft = pointInIndoorCycle({ x: mx + nx * 0.22, z: mz + nz * 0.22 });
    const inRight = pointInIndoorCycle({ x: mx - nx * 0.22, z: mz - nz * 0.22 });
    return {
      ...w,
      exterior: !(inLeft && inRight),
    };
  });

  // Regenerate LT2 solid slabs cleanly from LT2 rooms while keeping void/overhang slabs intact
  let nextSlabs: Slab[] = level.slabs;
  if (levelIndex === 1) {
    const preserved = level.slabs.filter((s) => s.isVoid || s.isOverhang);
    const dynamicSolids: Slab[] = nextRooms
      .filter((r) => r.program !== "void" && r.program !== "balcony" && r.program !== "garden" && r.program !== "carport")
      .map((r, idx) => ({
        id: `slab-lt2-${r.id}-${idx}`,
        name: `Pelat ${r.name}`,
        polygon: r.polygon,
        thickness: 0.12,
        materialId: r.floorMaterialId || "tile_40_cream",
      }));
    nextSlabs = [...preserved, ...dynamicSolids];
  }

  return {
    level: {
      ...level,
      walls: finalWalls,
      rooms: nextRooms,
      slabs: nextSlabs,
    },
    warnings: norm.warnings,
  };
}

/**
 * Push-Pull a wall perpendicularly along its normal while stretching/shrinking connected walls,
 * preserving openings, enforcing site bounds, and reconciling room/slab topology.
 */
export function pushPullWall(
  level: Level,
  levelIndex: 0 | 1,
  wallId: string,
  deltaNormalM: number,
  site: Site,
  altFree = false,
): { ok: boolean; reason?: string; level?: Level } {
  const target = level.walls.find((w) => w.id === wallId);
  if (!target) return { ok: false, reason: "Dinding tidak ditemukan" };

  const dx = target.end.x - target.start.x;
  const dz = target.end.z - target.start.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return { ok: false, reason: "Dinding terlalu pendek" };

  const snappedDelta = altFree ? deltaNormalM : Math.round(deltaNormalM * 4) / 4;
  if (Math.abs(snappedDelta) < 0.04) {
    return { ok: false, reason: "Belum digeser" };
  }

  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;

  const oldStart = { ...target.start };
  const oldEnd = { ...target.end };
  const newStart = { x: roundCoord(oldStart.x + nx * snappedDelta), z: roundCoord(oldStart.z + nz * snappedDelta) };
  const newEnd = { x: roundCoord(oldEnd.x + nx * snappedDelta), z: roundCoord(oldEnd.z + nz * snappedDelta) };

  const inSite = (p: Vec2) => p.x >= -0.01 && p.x <= site.width + 0.01 && p.z >= -0.01 && p.z <= site.depth + 0.01;
  if (!inSite(newStart) || !inSite(newEnd)) {
    return { ok: false, reason: "Di luar batas kavling" };
  }
  newStart.x = Math.max(0, Math.min(site.width, newStart.x));
  newStart.z = Math.max(0, Math.min(site.depth, newStart.z));
  newEnd.x = Math.max(0, Math.min(site.width, newEnd.x));
  newEnd.z = Math.max(0, Math.min(site.depth, newEnd.z));

  const nextWalls: Wall[] = [];
  const bridgeWalls: Wall[] = [];

  for (const w of level.walls) {
    if (w.id === wallId) {
      nextWalls.push({ ...w, start: newStart, end: newEnd });
      continue;
    }

    const hitsStartAtOldS = dist2(w.start, oldStart) <= EPS;
    const hitsEndAtOldS = dist2(w.end, oldStart) <= EPS;
    const hitsStartAtOldE = dist2(w.start, oldEnd) <= EPS;
    const hitsEndAtOldE = dist2(w.end, oldEnd) <= EPS;

    if (!hitsStartAtOldS && !hitsEndAtOldS && !hitsStartAtOldE && !hitsEndAtOldE) {
      nextWalls.push(w);
      continue;
    }

    const wdx = w.end.x - w.start.x;
    const wdz = w.end.z - w.start.z;
    const wLen = Math.hypot(wdx, wdz) || 1;
    const wux = wdx / wLen;
    const wuz = wdz / wLen;
    const collinear = Math.abs(wux * ux + wuz * uz) > 0.96;

    if (collinear) {
      // Keep collinear adjacent wall in place and add perpendicular return wall(s)
      nextWalls.push(w);
      if (hitsStartAtOldS || hitsEndAtOldS) {
        bridgeWalls.push({
          ...target,
          id: `${target.id}-ext-s-${Date.now().toString(36)}`,
          name: "Dinding Sambungan",
          start: { ...oldStart },
          end: { ...newStart },
          openings: [],
        });
      }
      if (hitsStartAtOldE || hitsEndAtOldE) {
        bridgeWalls.push({
          ...target,
          id: `${target.id}-ext-e-${Date.now().toString(36)}`,
          name: "Dinding Sambungan",
          start: { ...oldEnd },
          end: { ...newEnd },
          openings: [],
        });
      }
      continue;
    }

    let ws = { ...w.start };
    let we = { ...w.end };
    if (hitsStartAtOldS) ws = { ...newStart };
    else if (hitsStartAtOldE) ws = { ...newEnd };
    if (hitsEndAtOldS) we = { ...newStart };
    else if (hitsEndAtOldE) we = { ...newEnd };

    const newWLen = dist2(ws, we);
    if (newWLen < 0.45) {
      return { ok: false, reason: "Dinding terhubung terlalu pendek (< 0.5 m)" };
    }

    // Preserve opening world positions along stretched/shrunk connected wall
    const nux = (we.x - ws.x) / newWLen;
    const nuz = (we.z - ws.z) / newWLen;
    const shiftedOps: Opening[] = [];
    for (const op of w.openings) {
      const worldX = w.start.x + wux * op.offset;
      const worldZ = w.start.z + wuz * op.offset;
      const nextOff = (worldX - ws.x) * nux + (worldZ - ws.z) * nuz;
      if (nextOff - op.width * 0.5 < 0.04 || nextOff + op.width * 0.5 > newWLen - 0.04) {
        return { ok: false, reason: `Bukaan "${op.label}" tidak muat setelah geser dinding` };
      }
      shiftedOps.push({ ...op, offset: Number(nextOff.toFixed(3)) });
    }

    nextWalls.push({ ...w, start: ws, end: we, openings: shiftedOps });
  }

  const candidate: Level = {
    ...level,
    walls: [...nextWalls, ...bridgeWalls],
  };
  const rec = reconcileLevelTopology(candidate, levelIndex, level.walls);
  if (rec.blockedByOpening) {
    return { ok: false, reason: rec.blockedByOpening };
  }
  return { ok: true, level: rec.level };
}
