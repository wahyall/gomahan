import type { Wall } from "@/lib/model/types";

/**
 * OPT-15 — uniform 1 m wall spatial grid + Amanatides–Woo DDA ray traversal.
 *
 * The lighting/airflow engines used to test every ray against every wall
 * (O(rays × walls) — over 150k segment-segment tests per run). With the grid,
 * each ray only visits the walls registered in the cells it actually passes
 * through, and each wall is tested at most once per query.
 *
 * The per-wall intersection math is byte-identical to the original inline
 * loops (same gates, same openings pass-through rule, same hitAlong clamp),
 * so simulation results are numerically identical — only the iteration order
 * changes, and the boolean OR over walls is order-independent.
 */
const CELL_SIZE = 1;

/** Gate parameters of the per-engine wall kernels (exact original semantics). */
export interface WallGate {
  tLo: number;
  tHi: number;
  tHiInclusive: boolean;
  uLo: number;
  uLoInclusive: boolean;
  uHi: number;
  uHiInclusive: boolean;
  windowPasses: boolean;
  clampHitAlong: boolean;
}

/** Liang–Barsky slab test: does segment a→b intersect the axis-aligned cell rect? */
function segmentHitsCellRect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - minX, maxX - ax, az - minZ, maxZ - az];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return false;
    } else {
      const r = qi / pi;
      if (pi < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export class WallSpatialGrid {
  private readonly walls: Wall[];
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: number[][] = [];
  /** Per-wall visited stamps so each wall is tested at most once per query. */
  private readonly wallStamp: Uint32Array;
  private stamp = 0;

  constructor(walls: Wall[], siteWidth: number, siteDepth: number) {
    this.walls = walls;
    this.cols = Math.max(1, Math.ceil(siteWidth / CELL_SIZE));
    this.rows = Math.max(1, Math.ceil(siteDepth / CELL_SIZE));
    const cellCount = this.cols * this.rows;
    for (let i = 0; i < cellCount; i++) this.cells.push([]);
    this.wallStamp = new Uint32Array(walls.length);

    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi]!;
      // Insert only walls the engine kernels would ever test (same height/length gates).
      if (w.height < 1.6) continue;
      const wx = w.end.x - w.start.x;
      const wz = w.end.z - w.start.z;
      if (Math.hypot(wx, wz) < 0.1) continue;

      const minX = Math.min(w.start.x, w.end.x);
      const maxX = Math.max(w.start.x, w.end.x);
      const minZ = Math.min(w.start.z, w.end.z);
      const maxZ = Math.max(w.start.z, w.end.z);
      const cx0 = Math.max(0, Math.min(this.cols - 1, Math.floor(minX / CELL_SIZE)));
      const cx1 = Math.max(0, Math.min(this.cols - 1, Math.floor(maxX / CELL_SIZE)));
      const cz0 = Math.max(0, Math.min(this.rows - 1, Math.floor(minZ / CELL_SIZE)));
      const cz1 = Math.max(0, Math.min(this.rows - 1, Math.floor(maxZ / CELL_SIZE)));
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const rectMinX = cx * CELL_SIZE;
          const rectMinZ = cz * CELL_SIZE;
          // Conservative exact test: touching counts (extra cells only add
          // candidate walls, which the exact kernel rejects anyway).
          if (
            segmentHitsCellRect(
              w.start.x,
              w.start.z,
              w.end.x,
              w.end.z,
              rectMinX,
              rectMinZ,
              rectMinX + CELL_SIZE,
              rectMinZ + CELL_SIZE,
            )
          ) {
            this.cells[cz * this.cols + cx]!.push(wi);
          }
        }
      }
    }
  }

  /** Exact per-wall kernel — byte-identical to the original engine loops. */
  private testWall(
    w: Wall,
    ax: number,
    az: number,
    dx: number,
    dz: number,
    gate: WallGate,
    ignoreWallId: string | undefined,
  ): boolean {
    if (ignoreWallId && w.id === ignoreWallId) return false;
    const wx = w.end.x - w.start.x;
    const wz = w.end.z - w.start.z;
    const wLen = Math.hypot(wx, wz);
    if (wLen < 0.1) return false;
    const denom = dx * wz - dz * wx;
    if (Math.abs(denom) < 1e-6) return false;
    const t = ((w.start.x - ax) * wz - (w.start.z - az) * wx) / denom;
    const u = ((w.start.x - ax) * dz - (w.start.z - az) * dx) / denom;
    const tOk = t > gate.tLo && (gate.tHiInclusive ? t <= gate.tHi : t < gate.tHi);
    const uOk =
      (gate.uLoInclusive ? u >= gate.uLo : u > gate.uLo) &&
      (gate.uHiInclusive ? u <= gate.uHi : u < gate.uHi);
    if (tOk && uOk) {
      const hitAlong = gate.clampHitAlong
        ? Math.max(0, Math.min(wLen, u * wLen))
        : u * wLen;
      const passesOpening = w.openings.some(
        (op) =>
          Math.abs(hitAlong - op.offset) <= op.width * 0.5 &&
          (gate.windowPasses
            ? op.kind === "arch" || op.kind === "window" || op.openPct > 15
            : op.kind === "arch" || op.openPct > 15),
      );
      if (!passesOpening) return true;
    }
    return false;
  }

  private testCell(
    cx: number,
    cz: number,
    ax: number,
    az: number,
    dx: number,
    dz: number,
    gate: WallGate,
    ignoreWallId: string | undefined,
  ): boolean {
    const bucket = this.cells[cz * this.cols + cx];
    if (!bucket || bucket.length === 0) return false;
    for (let i = 0; i < bucket.length; i++) {
      const wi = bucket[i]!;
      if (this.wallStamp[wi] === this.stamp) continue;
      this.wallStamp[wi] = this.stamp;
      if (this.testWall(this.walls[wi]!, ax, az, dx, dz, gate, ignoreWallId)) return true;
    }
    return false;
  }

  /**
   * Amanitides–Woo DDA traversal from (ax, az) to (bx, bz): visits exactly the
   * cells the segment passes through (corner-exact steps visit the diagonal
   * cell too, which is always safe — extra candidate walls cannot false-block
   * because the per-wall kernel is exact).
   */
  segmentBlocked(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    gate: WallGate,
    ignoreWallId?: string,
  ): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    let cx = Math.max(0, Math.min(this.cols - 1, Math.floor(ax / CELL_SIZE)));
    let cz = Math.max(0, Math.min(this.rows - 1, Math.floor(az / CELL_SIZE)));
    const endCx = Math.max(0, Math.min(this.cols - 1, Math.floor(bx / CELL_SIZE)));
    const endCz = Math.max(0, Math.min(this.rows - 1, Math.floor(bz / CELL_SIZE)));

    let tMaxX: number;
    let tDeltaX: number;
    if (stepX > 0) {
      tMaxX = ((cx + 1) * CELL_SIZE - ax) / dx;
      tDeltaX = CELL_SIZE / dx;
    } else if (stepX < 0) {
      tMaxX = (cx * CELL_SIZE - ax) / dx;
      tDeltaX = CELL_SIZE / -dx;
    } else {
      tMaxX = Infinity;
      tDeltaX = Infinity;
    }
    let tMaxZ: number;
    let tDeltaZ: number;
    if (stepZ > 0) {
      tMaxZ = ((cz + 1) * CELL_SIZE - az) / dz;
      tDeltaZ = CELL_SIZE / dz;
    } else if (stepZ < 0) {
      tMaxZ = (cz * CELL_SIZE - az) / dz;
      tDeltaZ = CELL_SIZE / -dz;
    } else {
      tMaxZ = Infinity;
      tDeltaZ = Infinity;
    }

    this.stamp++;
    if (this.testCell(cx, cz, ax, az, dx, dz, gate, ignoreWallId)) return true;
    // Safety: stamps wrap at 2^32 queries; reset marks when wrapping.
    if (this.stamp === 0xffffffff) {
      this.wallStamp.fill(0);
      this.stamp = 1;
    }

    let guard = this.cols + this.rows + 2;
    while (guard-- > 0) {
      if (cx === endCx && cz === endCz) break;
      if (tMaxX === tMaxZ) {
        // Diagonal corner crossing — visit the diagonal cell as well.
        if (tMaxX > 1) break;
        cx += stepX;
        cz += stepZ;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        if (tMaxX > 1) break;
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        if (tMaxZ > 1) break;
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (cx < 0 || cx >= this.cols || cz < 0 || cz >= this.rows) break;
      if (this.testCell(cx, cz, ax, az, dx, dz, gate, ignoreWallId)) return true;
    }
    return false;
  }
}
