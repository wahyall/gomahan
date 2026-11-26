import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Shared procedural geometry & batching helpers (`3d-high-poly-models`, `optimize-threejs-games`).
 * Produces real beveled edges so highlights catch corners and merges static batches to reduce draw calls.
 */

export function createChamferBox(
  width: number,
  height: number,
  depth: number,
  radius = 0.014,
  bevelSegments = 2,
): THREE.BufferGeometry {
  const safeR = Math.max(0.002, Math.min(radius, Math.min(width, height, depth) * 0.22));
  const innerW = Math.max(0.004, width - safeR * 2);
  const innerH = Math.max(0.004, height - safeR * 2);
  const innerD = Math.max(0.004, depth - safeR * 2);

  const shape = new THREE.Shape();
  const hw = innerW * 0.5;
  const hh = innerH * 0.5;
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerD,
    bevelEnabled: true,
    bevelThickness: safeR,
    bevelSize: safeR,
    bevelSegments,
    curveSegments: 2,
  });
  geo.center();
  return geo;
}

/**
 * Safely disposes a BufferGeometry along with any attached three-mesh-bvh bounds tree.
 */
export function disposeGeometry(geo: THREE.BufferGeometry | null | undefined): void {
  if (!geo) return;
  (geo as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
  geo.dispose();
}

/**
 * Disposes any Three.js resource (BufferGeometry with BVH, Material, or Texture).
 */
export function disposeResource(r: THREE.BufferGeometry | THREE.Material | THREE.Texture | null | undefined): void {
  if (!r) return;
  if (r instanceof THREE.BufferGeometry) {
    disposeGeometry(r);
  } else {
    r.dispose();
  }
}

/**
 * Normalizes a list of BufferGeometries (matching attributes & non-indexed layout)
 * and merges them into a single BufferGeometry, disposing temporary clones.
 */
export function mergeGeometryBatch(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  if (geos.length === 1) {
    const single = geos[0]!;
    (single as unknown as { computeBoundsTree?: () => void }).computeBoundsTree?.();
    return single;
  }

  let hasUv1 = false;
  let hasBakedAo = false;
  for (const src of geos) {
    if (src.getAttribute("uv1")) hasUv1 = true;
    if (src.getAttribute("aAoDarken")) hasBakedAo = true;
  }

  const normalized: THREE.BufferGeometry[] = [];
  for (const src of geos) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    disposeGeometry(src);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const count = g.getAttribute("position").count;
    if (!g.getAttribute("uv")) {
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (hasUv1 && !g.getAttribute("uv1")) {
      g.setAttribute("uv1", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (hasBakedAo && !g.getAttribute("aAoDarken")) {
      g.setAttribute("aAoDarken", new THREE.BufferAttribute(new Float32Array(count), 1));
    }
    // Strip extra incompatible attributes (like tangent) if not uniform
    for (const key of Object.keys(g.attributes)) {
      if (
        key !== "position" &&
        key !== "normal" &&
        key !== "uv" &&
        !(hasUv1 && key === "uv1") &&
        !(hasBakedAo && key === "aAoDarken")
      ) {
        g.deleteAttribute(key);
      }
    }
    normalized.push(g);
  }

  const merged = mergeGeometries(normalized, false);
  for (const g of normalized) g.dispose();
  if (!merged) return null;
  (merged as unknown as { computeBoundsTree?: () => void }).computeBoundsTree?.();
  return merged;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d")!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, size * 0.08, half, half, half);
  grad.addColorStop(0, "rgba(6, 8, 12, 0.84)");
  grad.addColorStop(0.55, "rgba(6, 8, 12, 0.38)");
  grad.addColorStop(1, "rgba(6, 8, 12, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class StaticBatchCollector {
  private buckets = new Map<
    string,
    {
      mat: THREE.Material;
      partId: string;
      label: string;
      geos: THREE.BufferGeometry[];
      explodeOff?: [number, number, number];
      castShadow: boolean;
      receiveShadow: boolean;
    }
  >();

  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);

  addBox(
    key: string,
    mat: THREE.Material,
    partId: string,
    label: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    opts?: { rotX?: number; rotY?: number; rotZ?: number; explodeOff?: [number, number, number]; castShadow?: boolean; receiveShadow?: boolean },
  ) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    this.e.set(opts?.rotX ?? 0, opts?.rotY ?? 0, opts?.rotZ ?? 0);
    this.q.setFromEuler(this.e);
    this.p.set(x, y, z);
    this.s.set(1, 1, 1);
    this.m4.compose(this.p, this.q, this.s);
    geo.applyMatrix4(this.m4);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        mat,
        partId,
        label,
        geos: [],
        explodeOff: opts?.explodeOff,
        castShadow: opts?.castShadow ?? true,
        receiveShadow: opts?.receiveShadow ?? true,
      };
      this.buckets.set(key, bucket);
    }
    bucket.geos.push(geo);
  }

  addGeo(
    key: string,
    mat: THREE.Material,
    partId: string,
    label: string,
    geo: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rotY = 0,
    explodeOff?: [number, number, number],
    castShadow = true,
    receiveShadow = true,
  ) {
    if (x !== 0 || y !== 0 || z !== 0 || rotY !== 0) {
      this.e.set(0, rotY, 0);
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.s.set(1, 1, 1);
      this.m4.compose(this.p, this.q, this.s);
      geo.applyMatrix4(this.m4);
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { mat, partId, label, geos: [], explodeOff, castShadow, receiveShadow };
      this.buckets.set(key, bucket);
    }
    bucket.geos.push(geo);
  }

  flush(
    parent: THREE.Object3D,
    disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
    onMesh: (mesh: THREE.Mesh, partId: string, label: string, explodeOff?: [number, number, number]) => void,
  ) {
    for (const bucket of this.buckets.values()) {
      const merged = mergeGeometryBatch(bucket.geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, bucket.mat);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      disposables.push(merged);
      onMesh(mesh, bucket.partId, bucket.label, bucket.explodeOff);
    }
    this.buckets.clear();
  }
}
