import * as THREE from "three";
import type { Level, Project } from "@/lib/model/types";
import type { StructuralColumnNode } from "@/lib/structure/sniEngine";

/**
 * 4-Layer Fast Deterministic CPU Baked AO System (`PF-00`):
 * 1. Floor & Ceiling 2D Distance-Field AO Map (`uv1` + `material.aoMap`)
 * 2. Analytical Vertex Crease AO (`aAoDarken` attribute + `onBeforeCompile` indirect-only multiplier)
 * 3. Instanced Contact AO Decals (1 `InstancedMesh` per floor)
 * 4. Procedural Micro-Cavity AO (applied once at texture generation in `materials.ts`)
 */

const BAKED_AO_ATTR = "aAoDarken";
const BAKED_AO_CACHE_KEY_SUFFIX = "-baked-ao-v2";

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

/**
 * Generates a fast 2D soft distance-field AO DataTexture (<3 ms) for a floor level:
 * darkens smoothly along walls, wall corners, columns, and stair/overhang projections.
 *
 * OPT-10: rasterizes each wall segment only over its ±wallRadius pixel footprint
 * (instead of testing every pixel against every wall) and hoists stair/slab AABBs
 * out of the pixel loop. The per-pixel math is unchanged, so the output is
 * bit-identical to the brute-force version (~55× fewer distance evaluations).
 * The texture is single-channel `THREE.RedFormat` — the aoMap shader reads `.r`
 * only, so grayscale RGBA was 4× the VRAM and upload bandwidth for nothing.
 */
export function generateFloorAoTexture(
  level: Level | undefined,
  project: Project,
  columns: StructuralColumnNode[],
  levelIndex: 0 | 1,
): THREE.DataTexture {
  const siteW = Math.max(1, project.site.width);
  const siteD = Math.max(1, project.site.depth);
  // ~256×512 proportion for 5×17m, capped for fast <3ms CPU generation
  const texW = 128;
  const texH = Math.max(128, Math.min(512, Math.round((texW * siteD) / siteW)));
  const data = new Uint8Array(texW * texH);

  const walls = level?.walls ?? [];
  const stairs = project.levels[0]?.stairs ?? [];
  const lt2Slabs = levelIndex === 0 ? (project.levels[1]?.slabs ?? []) : [];
  const lvCols = columns.filter((c) => (levelIndex === 0 ? c.minLevel === 0 : c.maxLevel >= 1));

  const wallRadius = 0.62;
  const wallRadiusSq = wallRadius * wallRadius;
  const cornerRadiusSq = 0.45 * 0.45;
  const colRadius = 0.48;
  const colRadiusSq = colRadius * colRadius;

  // --- Pass 1: per-segment wall distance-field rasterization (OPT-10) ---
  // A pixel only ever sees wall influence when it lies within `wallRadius` of
  // the segment, so each wall only visits the pixels of its own footprint.
  const minWallDistSq = new Float32Array(texW * texH).fill(wallRadiusSq);
  const nearCount = new Uint8Array(texW * texH);

  const pxPerMeterX = texW / siteW;
  const pxPerMeterZ = texH / siteD;

  for (let wi = 0; wi < walls.length; wi++) {
    const w = walls[wi]!;
    const loX = Math.min(w.start.x, w.end.x) - wallRadius;
    const hiX = Math.max(w.start.x, w.end.x) + wallRadius;
    const loZ = Math.min(w.start.z, w.end.z) - wallRadius;
    const hiZ = Math.max(w.start.z, w.end.z) + wallRadius;
    // Pixel centers are ((px + 0.5) / texW) * siteW; add ±1px of safety margin.
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

  // --- OPT-10: hoist stair & overhang-slab AABBs out of the pixel loop ---
  const stairBoxes: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (let i = 0; i < stairs.length; i++) {
    const st = stairs[i]!;
    stairBoxes.push({
      minX: Math.min(st.start.x, st.end.x) - st.width * 0.5,
      maxX: Math.max(st.start.x, st.end.x) + st.width * 0.5,
      minZ: Math.min(st.start.z, st.end.z) - st.width * 0.5,
      maxZ: Math.max(st.start.z, st.end.z) + st.width * 0.5,
    });
  }
  const slabBoxes: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (let i = 0; i < lt2Slabs.length; i++) {
    const sl = lt2Slabs[i]!;
    if (!sl.isOverhang || sl.polygon.length < 3) continue;
    let sMinX = Infinity;
    let sMaxX = -Infinity;
    let sMinZ = Infinity;
    let sMaxZ = -Infinity;
    for (const pt of sl.polygon) {
      if (pt.x < sMinX) sMinX = pt.x;
      if (pt.x > sMaxX) sMaxX = pt.x;
      if (pt.z < sMinZ) sMinZ = pt.z;
      if (pt.z > sMaxZ) sMaxZ = pt.z;
    }
    slabBoxes.push({ minX: sMinX, maxX: sMaxX, minZ: sMinZ, maxZ: sMaxZ });
  }

  // --- Pass 2: combine the distance field with columns/stairs/slabs ---
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
          const b = stairBoxes[i]!;
          if (wx >= b.minX && wx <= b.maxX && wz >= b.minZ && wz <= b.maxZ) {
            ao = Math.min(ao, 0.48);
          }
        }
        for (let i = 0; i < slabBoxes.length; i++) {
          const b = slabBoxes[i]!;
          if (wx >= b.minX && wx <= b.maxX && wz >= b.minZ && wz <= b.maxZ) {
            ao = Math.min(ao, 0.62);
          }
        }
      }

      const v = Math.max(68, Math.min(255, Math.round(ao * 255)));
      data[pidx] = v;
    }
  }

  const tex = new THREE.DataTexture(data, texW, texH, THREE.RedFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
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
 * Attaches indirect-only Baked Vertex AO (`aAoDarken`) to a PBR material.
 * Uses `customProgramCacheKey` so Three.js shares compiled WebGL programs cleanly.
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
varying float vBakedAo;`,
        )
        .replace(
          "#include <aomap_fragment>",
          `#include <aomap_fragment>
#ifdef USE_AOMAP
float floorMapAo = clamp(ambientOcclusion, 0.25, 1.0);
reflectedLight.directDiffuse *= mix(1.0, floorMapAo, 0.42);
#endif
reflectedLight.directDiffuse *= mix(1.0, vBakedAo, 0.36);
reflectedLight.indirectDiffuse *= vBakedAo;
reflectedLight.indirectSpecular *= mix(1.0, vBakedAo, 0.75);`,
        );
    }
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
