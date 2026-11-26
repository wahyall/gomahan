import { WALK_CONFIG } from "@/features/walkMode/walkConfig";
import type { WalkSurfaceMaterial } from "@/lib/audio/simsAudio";
import type { Project, Room, Slab, Vec2 } from "@/lib/model/types";

export type WalkColliderKind =
  | "wall"
  | "window"
  | "closed_door"
  | "fence"
  | "railing"
  | "furniture"
  | "neighbor"
  | "pool_rim"
  | "lot_bound";

export interface WalkColliderBox {
  id: string;
  kind: WalkColliderKind;
  label: string;
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  rotY: number;
  yMin: number;
  yMax: number;
  levelIndex: 0 | 1;
  blocksCamera: boolean;
  wallId?: string;
  furnitureId?: string;
}

export interface WalkDoorInteractable {
  wallId: string;
  opId: string;
  levelIndex: 0 | 1;
  label: string;
  cx: number;
  cz: number;
  width: number;
  openPct: number;
}

export interface WalkStairSpan {
  id: string;
  name: string;
  levelIndex: 0 | 1;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  dirX: number;
  dirZ: number;
  len: number;
  halfWidth: number;
  baseY: number;
  topY: number;
  slopeTan: number;
}

export interface WalkFloorPolygon {
  id: string;
  name: string;
  polygon: Vec2[];
  y: number;
  surface: WalkSurfaceMaterial;
  isOutdoor: boolean;
}

export interface WalkSurfaceSample {
  y: number;
  surface: WalkSurfaceMaterial;
  levelIndex: 0 | 1;
  onStairId: string | null;
  roomName: string;
  supported: boolean;
}

export class SpatialHashGrid {
  public readonly cellSize: number;
  private readonly cells = new Map<number, number[]>();

  constructor(cellSize = WALK_CONFIG.spatialCellSize) {
    this.cellSize = cellSize;
  }

  private key(gx: number, gz: number): number {
    return ((gx + 32768) << 16) | ((gz + 32768) & 0xffff);
  }

  public insertBox(index: number, minX: number, maxX: number, minZ: number, maxZ: number): void {
    const gx0 = Math.floor(minX / this.cellSize);
    const gx1 = Math.floor(maxX / this.cellSize);
    const gz0 = Math.floor(minZ / this.cellSize);
    const gz1 = Math.floor(maxZ / this.cellSize);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const k = this.key(gx, gz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(index);
      }
    }
  }

  public queryAabb(minX: number, maxX: number, minZ: number, maxZ: number, seenStamp: Uint32Array, stampId: number, out: number[]): void {
    out.length = 0;
    const gx0 = Math.floor(minX / this.cellSize);
    const gx1 = Math.floor(maxX / this.cellSize);
    const gz0 = Math.floor(minZ / this.cellSize);
    const gz1 = Math.floor(maxZ / this.cellSize);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const list = this.cells.get(this.key(gx, gz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const idx = list[i]!;
          if (seenStamp[idx] !== stampId) {
            seenStamp[idx] = stampId;
            out.push(idx);
          }
        }
      }
    }
  }
}

export interface WalkCollisionWorld {
  colliders: WalkColliderBox[];
  spatial: SpatialHashGrid;
  doors: WalkDoorInteractable[];
  stairs: WalkStairSpan[];
  lt1Zones: WalkFloorPolygon[];
  lt2Slabs: Slab[];
  lt2VoidSlabs: Slab[];
  lt1Y: number;
  lt2Y: number;
  carportY: number;
  terasY: number;
  streetY: number;
  terrainHeights: number[];
  floorTileMap: Map<string, string>;
  pools: { x1: number; x2: number; z1: number; z2: number }[];
}

export function pointInPoly2D(px: number, pz: number, poly: Vec2[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const zi = poly[i]!.z;
    const xj = poly[j]!.x;
    const zj = poly[j]!.z;
    const intersect = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function floorMaterialToWalkSurface(materialId: string | undefined, program?: Room["program"]): WalkSurfaceMaterial {
  if (materialId === "garden_grass" || program === "garden" || materialId === "grass_tropical") return "grass";
  if (
    materialId === "concrete_carport" ||
    program === "carport" ||
    materialId === "carport_stone" ||
    materialId === "concrete"
  ) {
    return "stone";
  }
  if (
    materialId === "wood_oak" ||
    materialId === "terrace_deck" ||
    materialId === "wood_deck" ||
    materialId === "tile_wood_warm" ||
    materialId === "custom_parquet_oak"
  ) {
    return "wood";
  }
  return "tile";
}

function sampleTerrainOffset(x: number, z: number, heights: number[]): number {
  if (heights.length < 11 * 35) return 0;
  const segW = 10;
  const segD = 34;
  const u = Math.max(0, Math.min(segW, ((x + 0.2) / 5.4) * segW));
  const v = Math.max(0, Math.min(segD, ((z + 0.2) / 17.4) * segD));
  const ix = Math.min(segW - 1, Math.floor(u));
  const iz = Math.min(segD - 1, Math.floor(v));
  const fx = u - ix;
  const fz = v - iz;
  const stride = segW + 1;
  const h00 = heights[iz * stride + ix] ?? 0;
  const h10 = heights[iz * stride + ix + 1] ?? 0;
  const h01 = heights[(iz + 1) * stride + ix] ?? 0;
  const h11 = heights[(iz + 1) * stride + ix + 1] ?? 0;
  const h0 = h00 + (h10 - h00) * fx;
  const h1 = h01 + (h11 - h01) * fx;
  return h0 + (h1 - h0) * fz;
}

function addObbToWorld(
  colliders: WalkColliderBox[],
  spatial: SpatialHashGrid,
  box: WalkColliderBox,
): void {
  const idx = colliders.length;
  colliders.push(box);
  const c = Math.abs(Math.cos(box.rotY));
  const s = Math.abs(Math.sin(box.rotY));
  const ex = box.halfW * c + box.halfD * s;
  const ez = box.halfW * s + box.halfD * c;
  spatial.insertBox(idx, box.cx - ex, box.cx + ex, box.cz - ez, box.cz + ez);
}

/**
 * Pure Data-to-Collider compiler strictly driven by shared `Project` data.
 * Zero dependency on Three.js render meshes — single architectural source of truth.
 */
export function buildWalkCollisionWorld(project: Project): WalkCollisionWorld {
  const peil = project.site.peil;
  const streetY = peil.streetLevelM;
  const carportY = Math.max(0.08, peil.carportPeilM);
  const terasY = Math.max(0.12, peil.terracePeilM);
  const lt1Y = peil.floor1PeilM;
  const lt2Y = lt1Y + (project.levels[0]?.height ?? 3.6);
  const terrainHeights = project.buildExtras?.terrainHeights ?? [];

  const colliders: WalkColliderBox[] = [];
  const spatial = new SpatialHashGrid(WALK_CONFIG.spatialCellSize);
  const doors: WalkDoorInteractable[] = [];
  const stairs: WalkStairSpan[] = [];

  // 1. Walls & Openings on LT1 and LT2
  for (const lvIdx of [0, 1] as const) {
    const level = project.levels[lvIdx];
    if (!level) continue;
    const floorBaseY = lvIdx === 0 ? lt1Y : lt2Y;

    for (const wall of level.walls) {
      const dx = wall.end.x - wall.start.x;
      const dz = wall.end.z - wall.start.z;
      const wallLen = Math.hypot(dx, dz);
      if (wallLen < 0.08) continue;

      const ux = dx / wallLen;
      const uz = dz / wallLen;
      const rotY = -Math.atan2(dz, dx);
      const halfT = Math.max(0.04, wall.thickness * 0.5);
      const yMin = floorBaseY;
      const yMax = floorBaseY + wall.height;

      const passGaps: { start: number; end: number }[] = [];

      for (const op of wall.openings) {
        const opCx = wall.start.x + ux * op.offset;
        const opCz = wall.start.z + uz * op.offset;
        const gapStart = Math.max(0, op.offset - op.width * 0.5);
        const gapEnd = Math.min(wallLen, op.offset + op.width * 0.5);

        if (op.kind === "door") {
          doors.push({
            wallId: wall.id,
            opId: op.id,
            levelIndex: lvIdx,
            label: op.label,
            cx: opCx,
            cz: opCz,
            width: op.width,
            openPct: op.openPct,
          });
          const canPass = op.width >= WALK_CONFIG.minDoorClearanceM && op.openPct > WALK_CONFIG.doorOpenPassPct;
          if (canPass) {
            passGaps.push({ start: gapStart, end: gapEnd });
            // Lintel piece overhead (blocks tall spring-arm camera above door frame, clears walking human cleanly)
            const lintelMinY = floorBaseY + op.sill + op.height;
            if (yMax > lintelMinY + 0.08) {
              const segLen = gapEnd - gapStart;
              const segMid = (gapStart + gapEnd) * 0.5;
              addObbToWorld(colliders, spatial, {
                id: `${wall.id}:lintel:${op.id}`,
                kind: "wall",
                label: `${wall.name} (Lintel)`,
                cx: wall.start.x + ux * segMid,
                cz: wall.start.z + uz * segMid,
                halfW: segLen * 0.5,
                halfD: halfT,
                rotY,
                yMin: lintelMinY,
                yMax,
                levelIndex: lvIdx,
                blocksCamera: true,
                wallId: wall.id,
              });
            }
          } else {
            // Closed or overly narrow door acts as solid blocker across opening span
            const segLen = Math.max(0.05, gapEnd - gapStart);
            const segMid = (gapStart + gapEnd) * 0.5;
            addObbToWorld(colliders, spatial, {
              id: `${wall.id}:door-closed:${op.id}`,
              kind: "closed_door",
              label: `${op.label} (Tertutup)`,
              cx: wall.start.x + ux * segMid,
              cz: wall.start.z + uz * segMid,
              halfW: segLen * 0.5,
              halfD: halfT + 0.015,
              rotY,
              yMin,
              yMax: floorBaseY + op.sill + op.height,
              levelIndex: lvIdx,
              blocksCamera: true,
              wallId: wall.id,
            });
            passGaps.push({ start: gapStart, end: gapEnd });
          }
        } else if (op.kind === "arch") {
          if (op.width >= WALK_CONFIG.minDoorClearanceM) {
            passGaps.push({ start: gapStart, end: gapEnd });
          }
        }
        // Windows & vents do NOT open a walk gap — they stay solid barriers
      }

      passGaps.sort((a, b) => a.start - b.start);
      let cursor = 0;
      const emitWallSegment = (a: number, b: number, segIdx: number) => {
        const segLen = b - a;
        if (segLen < 0.04) return;
        const segMid = (a + b) * 0.5;
        const segCx = wall.start.x + ux * segMid;
        const segCz = wall.start.z + uz * segMid;
        const hasWin = wall.openings.some(
          (op) => op.kind === "window" && op.offset + op.width * 0.5 >= a && op.offset - op.width * 0.5 <= b,
        );
        const kind: WalkColliderKind =
          wall.kind === "fence" || wall.height <= 1.45 ? "fence" : hasWin ? "window" : "wall";

        // Clamp under-stair interior partition tops below stair soffit so upper stair treads remain walkable
        let segYMax = yMax;
        if (lvIdx === 0 && !wall.exterior && (project.levels[0]?.stairs.length ?? 0) > 0) {
          for (const st of project.levels[0]!.stairs) {
            const sdx = st.end.x - st.start.x;
            const sdz = st.end.z - st.start.z;
            const slen = Math.hypot(sdx, sdz) || 1;
            const sux = sdx / slen;
            const suz = sdz / slen;
            const rx = segCx - st.start.x;
            const rz = segCz - st.start.z;
            const proj = rx * sux + rz * suz;
            const perp = Math.abs(-rx * suz + rz * sux);
            if (proj >= 0.05 && proj <= slen + 0.05 && perp <= st.width * 0.5 + halfT + 0.25) {
              const t = Math.max(0, Math.min(1, proj / slen));
              const stairSurfaceY = lt1Y + t * st.floorHeight;
              if (stairSurfaceY > lt1Y + 0.55) {
                segYMax = Math.min(segYMax, stairSurfaceY - 0.16);
              }
            }
          }
        }
        if (segYMax <= yMin + 0.1) return;

        addObbToWorld(colliders, spatial, {
          id: `${wall.id}:seg:${segIdx}`,
          kind,
          label: wall.name,
          cx: segCx,
          cz: segCz,
          halfW: segLen * 0.5,
          halfD: halfT,
          rotY,
          yMin,
          yMax: segYMax,
          levelIndex: lvIdx,
          blocksCamera: wall.height > 1.35,
          wallId: wall.id,
        });
      };

      let segCounter = 0;
      for (const gap of passGaps) {
        if (gap.start > cursor + 0.03) {
          emitWallSegment(cursor, gap.start, segCounter++);
        }
        cursor = Math.max(cursor, gap.end);
      }
      if (cursor < wallLen - 0.03) {
        emitWallSegment(cursor, wallLen, segCounter++);
      }
    }
  }

  // 2. Stair Ramps + Built Railings
  for (const st of project.levels[0]?.stairs ?? []) {
    const dx = st.end.x - st.start.x;
    const dz = st.end.z - st.start.z;
    const len = Math.hypot(dx, dz) || 1;
    const baseY = lt1Y;
    const topY = lt1Y + st.floorHeight;
    stairs.push({
      id: st.id,
      name: st.name,
      levelIndex: 0,
      startX: st.start.x,
      startZ: st.start.z,
      endX: st.end.x,
      endZ: st.end.z,
      dirX: dx / len,
      dirZ: dz / len,
      len,
      halfWidth: st.width * 0.5,
      baseY,
      topY,
      slopeTan: st.floorHeight / len,
    });
  }

  // Dynamic Railings matching projectHouseBuilder.ts LT2 stairwell voids & balconies
  const lt2VoidSlabs = (project.levels[1]?.slabs ?? []).filter((s) => s.isVoid && s.polygon.length >= 3);
  const lt2SolidSlabs = (project.levels[1]?.slabs ?? []).filter((s) => !s.isVoid);
  const lt2Walls = project.levels[1]?.walls ?? [];
  const hasLt2WallNearEdge = (ax: number, az: number, bx: number, bz: number) => {
    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    const edgeLen = Math.hypot(bx - ax, bz - az) || 1;
    const eux = (bx - ax) / edgeLen;
    const euz = (bz - az) / edgeLen;
    for (const w of lt2Walls) {
      const wdx = w.end.x - w.start.x;
      const wdz = w.end.z - w.start.z;
      const wLen = Math.hypot(wdx, wdz) || 1;
      if (Math.abs(eux * (wdx / wLen) + euz * (wdz / wLen)) < 0.85) continue;
      const t = Math.max(0, Math.min(wLen, (mx - w.start.x) * (wdx / wLen) + (mz - w.start.z) * (wdz / wLen)));
      const px = w.start.x + (wdx / wLen) * t;
      const pz = w.start.z + (wdz / wLen) * t;
      if (Math.hypot(mx - px, mz - pz) < 0.16) return true;
    }
    return false;
  };
  const emitRailCollider = (id: string, label: string, ax: number, az: number, bx: number, bz: number, yBase: number) => {
    const rLen = Math.hypot(bx - ax, bz - az);
    if (rLen < 0.3) return;
    addObbToWorld(colliders, spatial, {
      id,
      kind: "railing",
      label,
      cx: (ax + bx) * 0.5,
      cz: (az + bz) * 0.5,
      halfW: rLen * 0.5,
      halfD: 0.04,
      rotY: -Math.atan2(bz - az, bx - ax),
      yMin: yBase,
      yMax: lt2Y + 1.15,
      levelIndex: 1,
      blocksCamera: false,
    });
  };

  for (const st of project.levels[0]?.stairs ?? []) {
    const vSlab = lt2VoidSlabs.find((s) => s.linkedStairId === st.id || s.id === `slab-void-${st.id}`);
    if (!vSlab) continue;
    for (let i = 0; i < vSlab.polygon.length; i++) {
      const a = vSlab.polygon[i]!;
      const b = vSlab.polygon[(i + 1) % vSlab.polygon.length]!;
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      if (Math.hypot(mx - st.end.x, mz - st.end.z) < st.width * 0.65) continue;
      if (hasLt2WallNearEdge(a.x, a.z, b.x, b.z)) continue;
      const edx = b.x - a.x;
      const edz = b.z - a.z;
      const elen = Math.hypot(edx, edz) || 1;
      const enx = -edz / elen;
      const enz = edx / elen;
      const pPos = { x: mx + enx * 0.25, z: mz + enz * 0.25 };
      const pNeg = { x: mx - enx * 0.25, z: mz - enz * 0.25 };
      const outPt = pointInPoly2D(pPos.x, pPos.z, vSlab.polygon) ? pNeg : pPos;
      if (lt2SolidSlabs.some((sl) => pointInPoly2D(outPt.x, outPt.z, sl.polygon))) {
        emitRailCollider(`rail:stair-${st.id}-${i}`, "Railing Kaca Tangga", a.x, a.z, b.x, b.z, lt2Y + 0.02);
      }
    }
  }
  for (const r of project.levels[1]?.rooms ?? []) {
    if (r.program !== "balcony" || r.polygon.length < 3) continue;
    for (let i = 0; i < r.polygon.length; i++) {
      const a = r.polygon[i]!;
      const b = r.polygon[(i + 1) % r.polygon.length]!;
      if (!hasLt2WallNearEdge(a.x, a.z, b.x, b.z)) {
        emitRailCollider(`rail:balc-${r.id}-${i}`, `Railing ${r.name}`, a.x, a.z, b.x, b.z, lt2Y);
      }
    }
  }

  // 3. Furniture, Floor HVAC, Trees & Outdoor AC Condensers
  const lt1FurnitureBaseY = (x: number, z: number, cat: string): number => {
    if (z < 3.05 && x < 1.5) return 0.05;
    if (cat === "vehicle" || (z < 4.5 && x >= 1.5 && !(x < 2.25 && z >= 3.0))) return carportY;
    if (z >= 3.0 && z <= 4.0 && x < 2.25) return terasY;
    return lt1Y;
  };

  for (const lvIdx of [0, 1] as const) {
    const level = project.levels[lvIdx];
    if (!level) continue;
    for (const f of level.furniture) {
      if (f.position.y > WALK_CONFIG.tabletopSkipElevationM) continue;
      if (f.size.y < WALK_CONFIG.flatRugMaxHeightM) continue;
      const baseY = lvIdx === 0 ? lt1FurnitureBaseY(f.position.x, f.position.z, f.category) : lt2Y;
      addObbToWorld(colliders, spatial, {
        id: `furn:${f.id}`,
        kind: "furniture",
        label: f.name,
        cx: f.position.x,
        cz: f.position.z,
        halfW: Math.max(0.14, f.size.x * 0.47),
        halfD: Math.max(0.14, f.size.z * 0.47),
        rotY: f.rotationY,
        yMin: baseY + f.position.y,
        yMax: baseY + f.position.y + f.size.y,
        levelIndex: lvIdx,
        blocksCamera: f.size.y > 1.35,
        furnitureId: f.id,
      });
    }

    for (const h of level.hvac) {
      if (h.type === "stand_fan" && h.position.y <= 0.6) {
        const baseY = lvIdx === 0 ? lt1Y : lt2Y;
        addObbToWorld(colliders, spatial, {
          id: `hvac:${h.id}`,
          kind: "furniture",
          label: h.name,
          cx: h.position.x,
          cz: h.position.z,
          halfW: 0.22,
          halfD: 0.22,
          rotY: 0,
          yMin: baseY,
          yMax: baseY + 1.35,
          levelIndex: lvIdx,
          blocksCamera: false,
        });
      }
    }

    // Outdoor AC condenser colliders mapped from outdoor_ac points if defined
    for (const mp of level.mepPoints) {
      if (mp.kind === "outdoor_ac") {
        const baseY = lvIdx === 0 ? lt1Y : lt2Y;
        addObbToWorld(colliders, spatial, {
          id: `ac-out:${mp.id}`,
          kind: "furniture",
          label: mp.label || "Outdoor Unit AC",
          cx: mp.x,
          cz: mp.z,
          halfW: 0.38,
          halfD: 0.18,
          rotY: 0,
          yMin: baseY + mp.y - 0.3,
          yMax: baseY + mp.y + 0.45,
          levelIndex: lvIdx,
          blocksCamera: false,
        });
      }
    }
  }

  // Front & rear garden tree trunk colliders when gardens exist in LT1
  const lt1RoomsForTrees = project.levels[0]?.rooms ?? [];
  if (lt1RoomsForTrees.some((r) => r.program === "garden" && r.polygon.some((p) => p.z < 3.5))) {
    addObbToWorld(colliders, spatial, {
      id: "tree:front",
      kind: "furniture",
      label: "Pohon Taman Depan",
      cx: 0.48,
      cz: 1.32,
      halfW: 0.2,
      halfD: 0.2,
      rotY: 0,
      yMin: 0.05,
      yMax: 2.8,
      levelIndex: 0,
      blocksCamera: true,
    });
  }
  if (lt1RoomsForTrees.some((r) => r.program === "garden" && r.polygon.some((p) => p.z > 14.5))) {
    addObbToWorld(colliders, spatial, {
      id: "tree:rear",
      kind: "furniture",
      label: "Pohon Taman Belakang",
      cx: 3.95,
      cz: 16.15,
      halfW: 0.18,
      halfD: 0.18,
      rotY: 0,
      yMin: lt1Y - 0.05,
      yMax: lt1Y + 2.5,
      levelIndex: 0,
      blocksCamera: true,
    });
  }

  // 4. Neighbor Lot Boundaries & Outer Walk Bounds
  // Left neighbor house footprint (X <= -0.02, Z in 0..17.2)
  addObbToWorld(colliders, spatial, {
    id: "neighbor:left-house",
    kind: "neighbor",
    label: "Rumah Tetangga Kiri",
    cx: -1.4,
    cz: 8.6,
    halfW: 1.38,
    halfD: 8.6,
    rotY: 0,
    yMin: 0,
    yMax: 8.5,
    levelIndex: 0,
    blocksCamera: true,
  });
  // Right neighbor house footprint (X >= 5.02, Z in 0..17.2)
  addObbToWorld(colliders, spatial, {
    id: "neighbor:right-house",
    kind: "neighbor",
    label: "Rumah Tetangga Kanan",
    cx: 6.4,
    cz: 8.6,
    halfW: 1.38,
    halfD: 8.6,
    rotY: 0,
    yMin: 0,
    yMax: 8.5,
    levelIndex: 0,
    blocksCamera: true,
  });

  // 5. Build Mode Pools (optional)
  const pools: { x1: number; x2: number; z1: number; z2: number }[] = [];
  for (const pool of project.buildExtras?.pools ?? []) {
    const x1 = Math.min(pool.gx1, pool.gx2) * 0.5;
    const x2 = (Math.max(pool.gx1, pool.gx2) + 1) * 0.5;
    const z1 = Math.min(pool.gz1, pool.gz2) * 0.5;
    const z2 = (Math.max(pool.gz1, pool.gz2) + 1) * 0.5;
    pools.push({ x1, x2, z1, z2 });
  }

  // 6. Floor Zones LT1 (in priority order: Teras -> Carport -> Gardens -> Interior LT1 rooms)
  const lt1Zones: WalkFloorPolygon[] = [];
  const lt1Rooms = project.levels[0]?.rooms ?? [];
  for (const r of lt1Rooms) {
    if (r.polygon.length < 3 || r.program === "void") continue;
    let y = lt1Y;
    let isOutdoor = false;
    if (r.program === "circulation") {
      y = terasY;
      isOutdoor = true;
    } else if (r.program === "carport") {
      y = carportY;
      isOutdoor = true;
    } else if (r.program === "garden") {
      y = r.id.includes("belakang") ? lt1Y - 0.01 : 0.05;
      isOutdoor = true;
    }
    lt1Zones.push({
      id: r.id,
      name: r.name,
      polygon: r.polygon,
      y,
      surface: floorMaterialToWalkSurface(r.floorMaterialId, r.program),
      isOutdoor,
    });
  }

  const lt2Slabs = (project.levels[1]?.slabs ?? []).filter((s) => !s.isVoid && s.polygon.length >= 3);

  const floorTileMap = new Map<string, string>();
  for (const ct of project.buildExtras?.floorTiles ?? []) {
    floorTileMap.set(`${ct.levelIndex}:${ct.gx}:${ct.gz}`, ct.materialId);
  }

  return {
    colliders,
    spatial,
    doors,
    stairs,
    lt1Zones,
    lt2Slabs,
    lt2VoidSlabs,
    lt1Y,
    lt2Y,
    carportY,
    terasY,
    streetY,
    terrainHeights,
    floorTileMap,
    pools,
  };
}

function resolveTileOverrideSurface(world: WalkCollisionWorld, levelIndex: number, x: number, z: number, fallback: WalkSurfaceMaterial): WalkSurfaceMaterial {
  if (world.floorTileMap.size === 0) return fallback;
  const gx = Math.floor(x / 0.5);
  const gz = Math.floor(z / 0.5);
  const mat = world.floorTileMap.get(`${levelIndex}:${gx}:${gz}`);
  return mat ? floorMaterialToWalkSurface(mat) : fallback;
}

/**
 * Computes exact floor elevation, surface material, active floor index, and whether
 * a horizontal `(x, z)` coordinate has valid standing support from current elevation `currentY`.
 */
export function sampleWalkSurface(world: WalkCollisionWorld, x: number, z: number, currentY: number): WalkSurfaceSample {
  // 1. Check staircase ramps first if within vertical reach
  for (const st of world.stairs) {
    const rx = x - st.startX;
    const rz = z - st.startZ;
    const proj = rx * st.dirX + rz * st.dirZ;
    const perp = Math.abs(-rx * st.dirZ + rz * st.dirX);
    if (
      proj >= -0.35 &&
      proj <= st.len + 0.35 &&
      perp <= st.halfWidth + WALK_CONFIG.stairLateralMarginM
    ) {
      const t = Math.max(0, Math.min(1, proj / st.len));
      const stairY = st.baseY + t * (st.topY - st.baseY);
      if (Math.abs(stairY - currentY) <= WALK_CONFIG.stepHeight + WALK_CONFIG.stairSnapMarginM) {
        return {
          y: stairY,
          surface: "wood",
          levelIndex: t >= 0.65 ? 1 : 0,
          onStairId: st.id,
          roomName: st.name,
          supported: true,
        };
      }
    }
  }

  // 2. If already elevated near LT2, stay supported by LT2 slabs (and exclude LT2 void holes!)
  if (currentY >= world.lt2Y - WALK_CONFIG.stepHeight - 0.15) {
    const inVoid = world.lt2VoidSlabs.some((vs) => pointInPoly2D(x, z, vs.polygon));
    if (!inVoid) {
      for (const slab of world.lt2Slabs) {
        if (pointInPoly2D(x, z, slab.polygon)) {
          return {
            y: world.lt2Y,
            surface: resolveTileOverrideSurface(world, 1, x, z, floorMaterialToWalkSurface(slab.materialId)),
            levelIndex: 1,
            onStairId: null,
            roomName: slab.name,
            supported: true,
          };
        }
      }
    }
    return {
      y: world.lt2Y,
      surface: "tile",
      levelIndex: 1,
      onStairId: null,
      roomName: "Batas Lantai 2",
      supported: false,
    };
  }

  // 3. Outside front street / sidewalk (Z < 0)
  if (z < 0) {
    return {
      y: world.streetY,
      surface: "stone",
      levelIndex: 0,
      onStairId: null,
      roomName: "Jalan & Trotoar Depan",
      supported: true,
    };
  }

  // 4. LT1 Interior Rooms & Exterior Zones
  for (const zone of world.lt1Zones) {
    if (pointInPoly2D(x, z, zone.polygon)) {
      const terrainOff = zone.surface === "grass" ? sampleTerrainOffset(x, z, world.terrainHeights) : 0;
      const inPool = world.pools.some((p) => x >= p.x1 && x <= p.x2 && z >= p.z1 && z <= p.z2);
      const surf = resolveTileOverrideSurface(world, 0, x, z, inPool ? "tile" : zone.surface);
      return {
        y: zone.y + terrainOff + (inPool ? 0.05 : 0),
        surface: surf,
        levelIndex: 0,
        onStairId: null,
        roomName: inPool ? "Kolam Renang" : zone.name,
        supported: true,
      };
    }
  }

  // Fallback inside 5x17 building slab footprint
  if (x >= 0 && x <= 5.0 && z >= 4.0 && z <= 17.0) {
    return {
      y: world.lt1Y,
      surface: "tile",
      levelIndex: 0,
      onStairId: null,
      roomName: "Lantai 1",
      supported: true,
    };
  }

  return {
    y: world.streetY,
    surface: "grass",
    levelIndex: 0,
    onStairId: null,
    roomName: "Luar Kavling",
    supported: true,
  };
}

/**
 * 2D minimum-translation vector between a circle `(px, pz, r)` and a rotated 2D OBB `(box)`.
 * Returns `[pushX, pushZ]` to push circle outside box, or `null` if no overlap.
 */
export function resolveCircleVsObb2D(
  px: number,
  pz: number,
  r: number,
  box: WalkColliderBox,
): [number, number] | null {
  const vx = px - box.cx;
  const vz = pz - box.cz;
  const cos = Math.cos(box.rotY);
  const sin = Math.sin(box.rotY);

  // Transform point into OBB local frame
  const lx = vx * cos - vz * sin;
  const lz = vx * sin + vz * cos;

  const clx = Math.max(-box.halfW, Math.min(box.halfW, lx));
  const clz = Math.max(-box.halfD, Math.min(box.halfD, lz));
  const dx = lx - clx;
  const dz = lz - clz;
  const distSq = dx * dx + dz * dz;

  let plx = 0;
  let plz = 0;

  if (distSq > 1e-10) {
    if (distSq >= r * r) return null;
    const dist = Math.sqrt(distSq);
    const pen = r - dist;
    plx = (dx / dist) * pen;
    plz = (dz / dist) * pen;
  } else {
    // Circle center is inside OBB: eject along shortest face normal
    const penX = box.halfW - Math.abs(lx) + r;
    const penZ = box.halfD - Math.abs(lz) + r;
    if (penX < penZ) {
      plx = lx >= 0 ? penX : -penX;
    } else {
      plz = lz >= 0 ? penZ : -penZ;
    }
  }

  // Transform MTV back into world XZ
  return [plx * cos + plz * sin, -plx * sin + plz * cos];
}

/**
 * Ray-vs-OBB slab intersection in 3D `(t in [0, 1])` for spring-arm camera anti-clipping.
 */
export function intersectRayObb3D(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: WalkColliderBox,
  pad: number,
): number | null {
  const cos = Math.cos(box.rotY);
  const sin = Math.sin(box.rotY);
  const rx = ox - box.cx;
  const rz = oz - box.cz;

  const lox = rx * cos - rz * sin;
  const loz = rx * sin + rz * cos;
  const ldx = dx * cos - dz * sin;
  const ldz = dx * sin + dz * cos;

  let tMin = 0;
  let tMax = 1;

  const checkSlab = (origin: number, dir: number, minB: number, maxB: number): boolean => {
    if (Math.abs(dir) < 1e-8) {
      return origin >= minB && origin <= maxB;
    }
    let t1 = (minB - origin) / dir;
    let t2 = (maxB - origin) / dir;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    return tMin <= tMax;
  };

  if (!checkSlab(lox, ldx, -(box.halfW + pad), box.halfW + pad)) return null;
  if (!checkSlab(loz, ldz, -(box.halfD + pad), box.halfD + pad)) return null;
  if (!checkSlab(oy, dy, box.yMin, box.yMax)) return null;

  return tMin > 0 && tMin <= 1 ? tMin : null;
}

export function isWallOverlappingVerticalSpan(box: WalkColliderBox, feetY: number, stepHeight: number, capsuleHeight: number): boolean {
  const spanMin = feetY + stepHeight;
  const spanMax = feetY + capsuleHeight - 0.04;
  return box.yMax > spanMin && box.yMin < spanMax;
}
