import * as THREE from "three";
import type { Level, Project } from "@/lib/model/types";
import type { StructuralColumnNode } from "@/lib/structure/sniEngine";
import { rtLookUniforms } from "@/lib/scene/rtUniforms";

/**
 * 4-Layer Fast Deterministic CPU Baked AO System (`PF-00`) upgraded to a
 * **4-channel RGBA Baked GI + Sky Occlusion map** (`GR-01`):
 *
 * 1. Floor & Ceiling 2D Distance-Field AO Map (`uv1` + `material.aoMap`) — now RGBA:
 *    `R` crease AO · `G` **sky visibility** (interiors 0.24, open yard 1.0,
 *    soft gradient toward openings) · `B` **single-bounce GI / colour-bleeding
 *    intensity** (sun pools through openings + active night fixtures) ·
 *    `A` warm↔cool GI tint blend.
 * 2. Analytical Vertex Crease AO (`aAoDarken` attribute + `onBeforeCompile` indirect-only multiplier)
 * 3. Instanced Contact AO Decals (1 `InstancedMesh` per floor)
 * 4. Procedural Micro-Cavity AO (applied once at texture generation in `materials.ts`)
 *
 * The GI channels are injected in `attachBakedAoShader` behind the shared
 * `uRtEnabled` uniform: RT OFF reproduces the pre-GR-01 look bit-for-bit;
 * RT ON unlocks interior sky occlusion + warm colour bleeding — ~0.05 ms/frame.
 */

const BAKED_AO_ATTR = "aAoDarken";
const BAKED_AO_CACHE_KEY_SUFFIX = "-baked-ao-v3";

/** Deterministic sun direction used by the CPU GI bake (mirrors BuildScene's fallback). */
export function computeBakeSunDir(hourOfDay: number): { x: number; y: number; z: number } {
  const sunElev = Math.max(0.12, Math.sin(((hourOfDay - 5.5) / 13) * Math.PI));
  const sunAz = ((hourOfDay - 12) / 6) * 0.9;
  const x = Math.sin(sunAz);
  const y = sunElev;
  const z = -Math.cos(sunAz) * 0.6;
  const inv = 1 / Math.hypot(x, y, z);
  return { x: x * inv, y: y * inv, z: z * inv };
}

/** Simplified light fixture context for the GI bake. */
export interface GiBakeLight {
  x: number;
  y: number;
  z: number;
  on: boolean;
  dimmer: number;
  lumens: number;
  colorTempK: number;
}

export interface GiBakeContext {
  hourOfDay: number;
  rainIntensityMmH: number;
  lights: GiBakeLight[];
}

/**
 * Ensures `uv1` exists on a floor/ceiling geometry by projecting world XZ coordinates
 * onto `[0..1]` across the site footprint `[0..siteWidth] × [0..siteDepth]`.
 */
export function applyFloorWorldUv1(
  geo: THREE.BufferGeometry,
  siteWidth: number,
  siteDepth: number,
  offsetX = 0,
  offsetZ = 0,
): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return geo;
  const invW = 1 / Math.max(0.1, siteWidth);
  const invD = 1 / Math.max(0.1, siteDepth);
  const uv1 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + offsetX;
    const wz = pos.getZ(i) + offsetZ;
    uv1[i * 2] = Math.max(0, Math.min(1, wx * invW));
    // DataTexture flipY is false by default; map Z directly to V in [0..1].
    uv1[i * 2 + 1] = Math.max(0, Math.min(1, wz * invD));
  }
  geo.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  return geo;
}

function distPointToSegmentSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) {
    const ex = px - ax;
    const ez = pz - az;
    return ex * ex + ez * ez;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const cx = ax + dx * t;
  const cz = az + dz * t;
  const ex = px - cx;
  const ez = pz - cz;
  return ex * ex + ez * ez;
}

interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function boxContains(b: Box2, x: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

function polygonBoundsLocal(points: { x: number; z: number }[]): Box2 | null {
  if (points.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Generates the 4-channel RGBA baked GI + AO DataTexture (<2 ms CPU) for a floor level:
 *
 * - `R` crease AO (walls, corners, columns, stairs, overhang slabs — unchanged math)
 * - `G` sky visibility (enclosed rooms 0.24 · carport 0.55 · overhang 0.42 · open 1.0,
 *   lifted toward 0.85 within 1.8 m of an open window/door)
 * - `B` GI bounce intensity (halo around sun pools through openings + night fixture
 *   glow — the *secondary* bounce, the direct pool itself comes from the shadow map)
 * - `A` warm↔cool GI tint (1 = tungsten/wood bounce, 0 = blue-hour ambient)
 */
export function generateFloorGiAoTexture(
  level: Level | undefined,
  project: Project,
  columns: StructuralColumnNode[],
  levelIndex: 0 | 1,
  gi: GiBakeContext,
): THREE.DataTexture {
  const siteW = Math.max(1, project.site.width);
  const siteD = Math.max(1, project.site.depth);
  const texW = 128;
  const texH = Math.max(128, Math.min(512, Math.round((texW * siteD) / siteW)));
  const pxCount = texW * texH;
  const data = new Uint8Array(pxCount * 4);

  const walls = level?.walls ?? [];
  const stairs = levelIndex === 0 ? (project.levels[0]?.stairs ?? []) : [];
  const lt2Slabs = levelIndex === 0 ? (project.levels[1]?.slabs ?? []) : [];
  const lvCols = columns.filter((c) => (levelIndex === 0 ? c.minLevel === 0 : c.maxLevel >= 1));

  const wallRadius = 0.62;
  const wallRadiusSq = wallRadius * wallRadius;
  const cornerRadiusSq = 0.45 * 0.45;
  const colRadius = 0.48;
  const colRadiusSq = colRadius * colRadius;

  // --- Pass 1: per-segment wall distance-field rasterization (OPT-10) ---
  const minWallDistSq = new Float32Array(pxCount).fill(wallRadiusSq);
  const nearCount = new Uint8Array(pxCount);

  const pxPerMeterX = texW / siteW;
  const pxPerMeterZ = texH / siteD;

  for (let wi = 0; wi < walls.length; wi++) {
    const w = walls[wi]!;
    const loX = Math.min(w.start.x, w.end.x) - wallRadius;
    const hiX = Math.max(w.start.x, w.end.x) + wallRadius;
    const loZ = Math.min(w.start.z, w.end.z) - wallRadius;
    const hiZ = Math.max(w.start.z, w.end.z) + wallRadius;
    const px0 = Math.max(0, Math.floor(loX * pxPerMeterX - 0.5) - 1);
    const px1 = Math.min(texW - 1, Math.ceil(hiX * pxPerMeterX - 0.5) + 1);
    const py0 = Math.max(0, Math.floor(loZ * pxPerMeterZ - 0.5) - 1);
    const py1 = Math.min(texH - 1, Math.ceil(hiZ * pxPerMeterZ - 0.5) + 1);
    for (let py = py0; py <= py1; py++) {
      const wz = ((py + 0.5) / texH) * siteD;
      const row = py * texW;
      for (let px = px0; px <= px1; px++) {
        const wx = ((px + 0.5) / texW) * siteW;
        const dSq = distPointToSegmentSq(wx, wz, w.start.x, w.start.z, w.end.x, w.end.z);
        if (dSq < wallRadiusSq) {
          const idx = row + px;
          if (dSq < minWallDistSq[idx]!) minWallDistSq[idx] = dSq;
          if (dSq < cornerRadiusSq) nearCount[idx]!++;
        }
      }
    }
  }

  // --- Hoisted stair / overhang / room AABBs (OPT-10) ---
  const stairBoxes: Box2[] = [];
  for (let i = 0; i < stairs.length; i++) {
    const st = stairs[i]!;
    stairBoxes.push({
      minX: Math.min(st.start.x, st.end.x) - st.width * 0.5,
      maxX: Math.max(st.start.x, st.end.x) + st.width * 0.5,
      minZ: Math.min(st.start.z, st.end.z) - st.width * 0.5,
      maxZ: Math.max(st.start.z, st.end.z) + st.width * 0.5,
    });
  }
  const slabBoxes: Box2[] = [];
  for (let i = 0; i < lt2Slabs.length; i++) {
    const sl = lt2Slabs[i]!;
    if (!sl.isOverhang || sl.polygon.length < 3) continue;
    const b = polygonBoundsLocal(sl.polygon);
    if (b) slabBoxes.push(b);
  }

  // Enclosed-room boxes (sky occlusion): interior programs only — gardens,
  // carports, the LT1 teras (circulation) and LT2 balconies stay sky-open.
  // On LT2 every enclosed room sits under the roof.
  const rooms = level?.rooms ?? [];
  const enclosedRoomBoxes: Box2[] = [];
  const openPrograms = levelIndex === 0 ? ["garden", "carport", "void", "circulation"] : ["garden", "void", "balcony"];
  for (const r of rooms) {
    if (openPrograms.includes(r.program)) continue;
    const b = polygonBoundsLocal(r.polygon);
    if (b) enclosedRoomBoxes.push(b);
  }
  const carportBoxes: Box2[] =
    levelIndex === 0
      ? rooms.filter((r) => r.program === "carport").map((r) => polygonBoundsLocal(r.polygon)).filter((b): b is Box2 => b !== null)
      : [];

  // --- GI bake inputs ---------------------------------------------------------
  const isDay = gi.hourOfDay >= 5.6 && gi.hourOfDay <= 18.4;
  const sunDir = computeBakeSunDir(gi.hourOfDay);
  const rainFactor = Math.min(1, gi.rainIntensityMmH / 60);
  const sunPower = isDay ? Math.max(0, 1 - rainFactor * 0.75) : 0;

  interface GiBlob {
    x: number;
    z: number;
    r: number;
    intensity: number;
    warm: number;
  }
  const blobs: GiBlob[] = [];

  // Sun pools through light-passing openings (secondary bounce halo).
  if (sunPower > 0.02) {
    for (const w of walls) {
      const wLen = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      if (wLen < 0.2 || w.height < 1.6) continue;
      const dx = (w.end.x - w.start.x) / wLen;
      const dz = (w.end.z - w.start.z) / wLen;
      for (const op of w.openings) {
        const lightPasses = op.kind === "arch" || op.kind === "window" || op.openPct > 15;
        if (!lightPasses) continue;
        const opX = w.start.x + dx * op.offset;
        const opZ = w.start.z + dz * op.offset;
        const opY = op.sill + op.height * 0.5;
        // Ray from the opening along the sun direction down to this level's floor.
        const floorY =
          levelIndex === 0 ? project.site.peil.floor1PeilM : project.site.peil.floor1PeilM + (project.levels[0]?.height ?? 3.6);
        if (sunDir.y <= 0.05) continue;
        const t = (opY - floorY) / sunDir.y;
        if (t <= 0 || t > 40) continue;
        const poolX = opX - sunDir.x * t;
        const poolZ = opZ - sunDir.z * t;
        const spread = 0.55 * op.width + 0.5 * Math.min(6, t);
        blobs.push({
          x: poolX,
          z: poolZ,
          r: spread * 2.1, // halo is wider than the direct pool — it is the bounce
          intensity: 0.3 * sunPower * Math.min(1, op.width / 1.1),
          warm: 1,
        });
      }
    }
    // Soft sky bounce base inside enclosed rooms (through openings, indirect).
    if (levelIndex === 0) {
      for (const b of enclosedRoomBoxes) {
        blobs.push({
          x: (b.minX + b.maxX) * 0.5,
          z: (b.minZ + b.maxZ) * 0.5,
          r: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.75,
          intensity: 0.05 * sunPower,
          warm: 0.7,
        });
      }
    }
  }

  // Night fixture glow (warm pools under downlights/wall/garden lamps).
  const nightFactor = isDay ? 0.25 : 1;
  for (const l of gi.lights) {
    if (!l.on || l.dimmer <= 0) continue;
    const lumens = Math.max(0, Math.min(1200, l.lumens));
    const power = (lumens / 650) * l.dimmer * 0.42 * nightFactor;
    if (power <= 0.01) continue;
    blobs.push({
      x: l.x,
      z: l.z,
      r: 1.1 + Math.min(2.4, l.y * 0.55),
      intensity: power,
      warm: l.colorTempK <= 3200 ? 1 : 0.22,
    });
  }

  // --- Pass 2: combine the distance field with columns/stairs/slabs + GI ------
  const giB = new Float32Array(pxCount);
  const giA = new Float32Array(pxCount);

  for (let py = 0; py < texH; py++) {
    const wz = ((py + 0.5) / texH) * siteD;
    for (let px = 0; px < texW; px++) {
      const wx = ((px + 0.5) / texW) * siteW;
      const pidx = py * texW + px;
      let ao = 1.0;

      // 1. Wall-floor crease + corner darkening
      if (minWallDistSq[pidx]! < wallRadiusSq) {
        const t = Math.sqrt(minWallDistSq[pidx]!) / wallRadius;
        const smooth = t * t * (3 - 2 * t);
        const wallAo = 0.36 + 0.64 * smooth;
        ao = Math.min(ao, wallAo);
        if (nearCount[pidx]! >= 2) {
          ao *= 0.70;
        }
      }

      // 2. Column base AO
      for (let i = 0; i < lvCols.length; i++) {
        const c = lvCols[i]!;
        const dx = wx - c.x;
        const dz = wz - c.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < colRadiusSq) {
          const t = Math.sqrt(dSq) / colRadius;
          const colAo = 0.40 + 0.60 * (t * t * (3 - 2 * t));
          if (colAo < ao) ao = colAo;
        }
      }

      // 3. LT1 under-stair & overhang AO
      if (levelIndex === 0) {
        for (let i = 0; i < stairBoxes.length; i++) {
          if (boxContains(stairBoxes[i]!, wx, wz)) ao = Math.min(ao, 0.48);
        }
        for (let i = 0; i < slabBoxes.length; i++) {
          if (boxContains(slabBoxes[i]!, wx, wz)) ao = Math.min(ao, 0.62);
        }
      }

      // --- Sky visibility (G) ---
      let skyVis = 1.0;
      for (let i = 0; i < enclosedRoomBoxes.length; i++) {
        if (boxContains(enclosedRoomBoxes[i]!, wx, wz)) {
          skyVis = 0.24;
          break;
        }
      }
      if (skyVis > 0.9) {
        for (let i = 0; i < carportBoxes.length; i++) {
          if (boxContains(carportBoxes[i]!, wx, wz)) {
            skyVis = 0.55;
            break;
          }
        }
      }
      if (skyVis > 0.9 && levelIndex === 0) {
        for (let i = 0; i < slabBoxes.length; i++) {
          if (boxContains(slabBoxes[i]!, wx, wz)) {
            skyVis = 0.42;
            break;
          }
        }
      }
      if (skyVis < 0.9) {
        // Openings pull sky visibility back up within 1.8 m (soft window gradient).
        const openBoost = openingSkyBoost(walls, wx, wz);
        if (openBoost > 0) {
          skyVis = Math.min(1, skyVis + (0.85 - skyVis) * openBoost);
        }
      }

      // --- GI bounce accumulation (B/A) ---
      let bAcc = 0;
      let aWeight = 0;
      let aAcc = 0;
      for (let i = 0; i < blobs.length; i++) {
        const bl = blobs[i]!;
        const d = Math.hypot(wx - bl.x, wz - bl.z);
        if (d >= bl.r) continue;
        const f = 1 - d / bl.r;
        const wgt = f * f * bl.intensity;
        bAcc += wgt;
        aAcc += wgt * bl.warm;
        aWeight += wgt;
      }
      const aoGate = 0.4 + 0.6 * ao;
      giB[pidx] = Math.min(0.5, bAcc * aoGate);
      giA[pidx] = aWeight > 1e-4 ? Math.min(1, aAcc / aWeight) : 0.75;

      const v = Math.max(68, Math.min(255, Math.round(ao * 255)));
      const p4 = pidx * 4;
      data[p4] = v;
      data[p4 + 2] = 0;
      data[p4 + 3] = 0;
      // G channel filled below (needs the blurred B context? no — direct write):
      data[p4 + 1] = Math.max(0, Math.min(255, Math.round(skyVis * 255)));
    }
  }

  // --- Pass 3: 2× separable 3-tap blur on the GI channels (organic pools) -----
  blurChannel(giB, texW, texH);
  blurChannel(giA, texW, texH);
  for (let i = 0; i < pxCount; i++) {
    const p4 = i * 4;
    data[p4 + 2] = Math.max(0, Math.min(255, Math.round(giB[i]! * 2 * 255)));
    data[p4 + 3] = Math.max(0, Math.min(255, Math.round(giA[i]! * 255)));
  }

  const tex = new THREE.DataTexture(data, texW, texH, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Sky-visibility lift near light-passing openings (max 1.0 at the frame, 0 beyond 1.8 m). */
function openingSkyBoost(walls: Level["walls"], wx: number, wz: number): number {
  let best = 0;
  for (const w of walls) {
    if (w.height < 1.6) continue;
    const wLen = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
    if (wLen < 0.2) continue;
    const dx = (w.end.x - w.start.x) / wLen;
    const dz = (w.end.z - w.start.z) / wLen;
    for (const op of w.openings) {
      const lightPasses = op.kind === "arch" || op.kind === "window" || op.openPct > 15;
      if (!lightPasses) continue;
      const opX = w.start.x + dx * op.offset;
      const opZ = w.start.z + dz * op.offset;
      const d = Math.hypot(wx - opX, wz - opZ);
      const reach = 0.35 + op.width * 0.5 + 1.8;
      if (d < reach) {
        const f = 1 - d / reach;
        best = Math.max(best, f);
        if (best >= 0.999) return 1;
      }
    }
  }
  return best;
}

/** In-place 3-tap separable blur (two axis passes), adequate for soft GI pools. */
function blurChannel(ch: Float32Array, w: number, h: number): void {
  const tmp = new Float32Array(ch.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const c = ch[row + x]!;
      const l = x > 0 ? ch[row + x - 1]! : c;
      const r = x < w - 1 ? ch[row + x + 1]! : c;
      tmp[row + x] = (l + 2 * c + r) * 0.25;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const idx = y * w + x;
      const c = tmp[idx]!;
      const u = y > 0 ? tmp[idx - w]! : c;
      const d = y < h - 1 ? tmp[idx + w]! : c;
      ch[idx] = (u + 2 * c + d) * 0.25;
    }
  }
}

/**
 * Back-compat wrapper: AO-only bake (neutral mid-day, no fixtures) — callers that
 * only need the crease field (tests, legacy paths) keep working.
 */
export function generateFloorAoTexture(
  level: Level | undefined,
  project: Project,
  columns: StructuralColumnNode[],
  levelIndex: 0 | 1,
): THREE.DataTexture {
  return generateFloorGiAoTexture(level, project, columns, levelIndex, {
    hourOfDay: 10,
    rainIntensityMmH: 0,
    lights: [],
  });
}

/**
 * Layer 2: Analytical Vertex Crease AO (`aAoDarken` = 1 - ao).
 * Storing `1 - ao` guarantees unbound attributes default to 0.0 (= 1.0 AO) in WebGL!
 */
export function applyWallVertexAo(
  geo: THREE.BufferGeometry,
  wallLen: number,
  wallHeight: number,
  hasStartCorner: boolean,
  hasEndCorner: boolean,
  openingBounds: { lo: number; hi: number; sill: number; top: number }[] = [],
): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return geo;
  const darken = new Float32Array(pos.count);
  const floorBand = 0.56;
  const ceilBand = 0.46;
  const cornerBand = 0.44;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    let ao = 1.0;

    // Wall-floor contact crease
    if (y < floorBand) {
      const t = Math.max(0, y / floorBand);
      const s = t * t * (3 - 2 * t);
      ao = Math.min(ao, 0.42 + 0.58 * s);
    }

    // Wall-ceiling / beam contact crease
    if (wallHeight > 1.2 && y > wallHeight - ceilBand) {
      const t = Math.max(0, (wallHeight - y) / ceilBand);
      const s = t * t * (3 - 2 * t);
      ao = Math.min(ao, 0.54 + 0.46 * s);
    }

    // Wall-wall corner junction crease
    if (hasStartCorner && x < cornerBand) {
      const t = Math.max(0, x / cornerBand);
      const s = t * t * (3 - 2 * t);
      ao *= 0.48 + 0.52 * s;
    }
    if (hasEndCorner && x > wallLen - cornerBand) {
      const t = Math.max(0, (wallLen - x) / cornerBand);
      const s = t * t * (3 - 2 * t);
      ao *= 0.48 + 0.52 * s;
    }

    // Opening frame reveal crease
    for (let o = 0; o < openingBounds.length; o++) {
      const op = openingBounds[o]!;
      if (x >= op.lo - 0.09 && x <= op.hi + 0.09 && y >= op.sill - 0.09 && y <= op.top + 0.09) {
        const dx = Math.max(0, Math.min(Math.abs(x - op.lo), Math.abs(x - op.hi)));
        const dy = Math.max(0, Math.min(Math.abs(y - op.sill), Math.abs(y - op.top)));
        if (dx < 0.08 || dy < 0.08) {
          ao = Math.min(ao, 0.58);
        }
      }
    }

    darken[i] = Math.max(0, Math.min(0.78, 1.0 - ao));
  }

  geo.setAttribute(BAKED_AO_ATTR, new THREE.BufferAttribute(darken, 1));
  return geo;
}

/**
 * Applies uniform or vertical-gradient crease AO (`aAoDarken`) to columns, beams, soffits, or stairs.
 */
export function applyGradientVertexAo(
  geo: THREE.BufferGeometry,
  bottomDarken: number,
  topDarken: number,
): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return geo;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1e-4, maxY - minY);
  const darken = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span;
    darken[i] = bottomDarken + (topDarken - bottomDarken) * t;
  }
  geo.setAttribute(BAKED_AO_ATTR, new THREE.BufferAttribute(darken, 1));
  return geo;
}

/**
 * Attaches indirect-only Baked Vertex AO (`aAoDarken`) + RGBA Baked GI / Sky
 * Occlusion injection to a PBR material (GR-01). Uses `customProgramCacheKey`
 * so Three.js shares compiled WebGL programs cleanly. When `uRtEnabled = 0` the
 * injected math collapses to the exact pre-GR-01 behaviour.
 */
export function attachBakedAoShader<T extends THREE.MeshStandardMaterial>(mat: T): T {
  const ud = mat.userData as { _bakedAoAttached?: boolean };
  if (ud._bakedAoAttached) return mat;
  ud._bakedAoAttached = true;

  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : mat.type}${BAKED_AO_CACHE_KEY_SUFFIX}`;

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    if (!shader.vertexShader.includes(BAKED_AO_ATTR)) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float ${BAKED_AO_ATTR};
varying float vBakedAo;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vBakedAo = 1.0 - clamp(${BAKED_AO_ATTR}, 0.0, 0.78);`,
        );
    }
    if (!shader.fragmentShader.includes("vBakedAo")) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vBakedAo;
uniform float uRtEnabled;
uniform float uRtGiStrength;`,
        )
        .replace(
          "#include <aomap_fragment>",
          `#ifdef USE_AOMAP
  // GR-01 RGBA baked map: R crease AO · G sky visibility · B GI intensity · A warm/cool tint.
  vec4 giAoSample = texture2D( aoMap, vAoMapUv );
  float bakedCreaseAo = clamp( giAoSample.r, 0.0, 1.0 );
  float bakedSkyVis = clamp( giAoSample.g, 0.0, 1.0 );
  float ambientOcclusion = ( bakedCreaseAo - 1.0 ) * aoMapIntensity + 1.0;
  float skyOcclusion = mix( 1.0, 0.22 + 0.78 * bakedSkyVis, uRtEnabled );
  reflectedLight.indirectDiffuse *= ambientOcclusion * skyOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion * skyOcclusion;
  #endif
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion * skyOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness ) * mix( 1.0, skyOcclusion, 0.6 );
  #endif
  float floorMapAo = clamp( bakedCreaseAo, 0.25, 1.0 );
  reflectedLight.directDiffuse *= mix( 1.0, floorMapAo, 0.42 );
  // Single-bounce colour bleeding: warm halo around sun pools / night fixtures.
  vec3 giTint = mix( vec3( 0.62, 0.70, 0.88 ), vec3( 1.0, 0.84, 0.62 ), clamp( giAoSample.a, 0.0, 1.0 ) );
  reflectedLight.indirectDiffuse += giAoSample.b * 0.5 * giTint * diffuseColor.rgb * uRtEnabled * uRtGiStrength * 0.85;
#endif
reflectedLight.directDiffuse *= mix(1.0, vBakedAo, 0.36);
reflectedLight.indirectDiffuse *= vBakedAo;
reflectedLight.indirectSpecular *= mix(1.0, vBakedAo, 0.75);`,
        );
    }
    shader.uniforms.uRtEnabled = rtLookUniforms.uRtEnabled;
    shader.uniforms.uRtGiStrength = rtLookUniforms.uRtGiStrength;
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * Computes a set of wall IDs that meet at least one other wall at their start or end vertex (<= 120° or T-junction).
 */
export function computeWallCornerFlags(walls: Level["walls"]): Map<string, { startCorner: boolean; endCorner: boolean }> {
  const out = new Map<string, { startCorner: boolean; endCorner: boolean }>();
  const thrSq = 0.22 * 0.22;

  for (let i = 0; i < walls.length; i++) {
    const a = walls[i]!;
    let startCorner = false;
    let endCorner = false;
    for (let j = 0; j < walls.length; j++) {
      if (i === j) continue;
      const b = walls[j]!;
      if (
        !startCorner &&
        (distPointToSegmentSq(a.start.x, a.start.z, b.start.x, b.start.z, b.end.x, b.end.z) < thrSq)
      ) {
        startCorner = true;
      }
      if (
        !endCorner &&
        (distPointToSegmentSq(a.end.x, a.end.z, b.start.x, b.start.z, b.end.x, b.end.z) < thrSq)
      ) {
        endCorner = true;
      }
      if (startCorner && endCorner) break;
    }
    out.set(a.id, { startCorner, endCorner });
  }
  return out;
}

export interface ContactDecalSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  rotY: number;
}

/**
 * Builds a single InstancedMesh for all contact AO decals on a floor level (Layer 3).
 */
export function buildInstancedContactDecals(
  specs: ContactDecalSpec[],
  contactShadowMat: THREE.Material,
  resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const unitGeo = new THREE.PlaneGeometry(1, 1);
  unitGeo.rotateX(-Math.PI / 2);
  resources.push(unitGeo);

  const im = new THREE.InstancedMesh(unitGeo, contactShadowMat, specs.length);
  im.castShadow = false;
  im.receiveShadow = false;
  im.renderOrder = 1;
  im.frustumCulled = false;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i]!;
    p.set(sp.x, sp.y + 0.008, sp.z);
    q.setFromAxisAngle(up, sp.rotY);
    s.set(sp.w * 1.24, 1, sp.d * 1.22);
    m4.compose(p, q, s);
    im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  im.matrixAutoUpdate = false;
  im.updateMatrix();
  return im;
}
