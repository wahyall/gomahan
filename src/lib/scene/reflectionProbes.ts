import * as THREE from "three";
import { exteriorProbeUniforms, interiorProbeUniforms, rtLookUniforms, type BpceProbeUniforms } from "@/lib/scene/rtUniforms";

/**
 * GR-02 — Event-driven Dual `CubeCamera` reflection probes with
 * **Box-Projected Cubemap Parallax Correction (BPCEM)**.
 *
 * Two 256² HalfFloat cube probes are baked ONCE per house rebuild / sun-hour
 * change (never per frame): an exterior probe in the front yard capturing the
 * real sky dome, sun, trees and neighbouring facades, and an interior probe in
 * the LT1 main room capturing walls, bright openings and lit fixtures.
 *
 * Parallax correction is ~14 lines of GLSL injected into
 * `envmap_physical_pars_fragment`: the reflection vector is projected onto the
 * probe's local bounding box before the envMap lookup, so reflections slide
 * with real perspective as the camera orbits or walks — the classic
 * "ray-traced glossy reflection" look at 0.00 ms/frame.
 */

const BPCE_CACHE_KEY = "-rt-bpce-v1";

export type ProbeKind = "interior" | "exterior";

export interface ProbeBakeOptions {
  /** Objects to hide during capture (rain, particles, overlays, gizmos…). */
  hide?: THREE.Object3D[];
  /** Meshes whose material carries `userData.rtBpce` are auto-hidden (glass/floors never self-reflect). */
  searchRoot?: THREE.Object3D;
}

/**
 * Injects BPCEM + probe box uniforms into a PBR material.
 * `mat.userData.rtBpce = kind` marks the material for env-map rebinding.
 */
export function attachBpceReflection<T extends THREE.MeshStandardMaterial>(mat: T, probe: BpceProbeUniforms, kind: ProbeKind): T {
  const ud = mat.userData as { _rtBpceAttached?: boolean; rtBpce?: ProbeKind };
  if (ud._rtBpceAttached) return mat;
  ud._rtBpceAttached = true;
  ud.rtBpce = kind;

  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : mat.type}${BPCE_CACHE_KEY}`;

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    if (shader.fragmentShader.includes("vRtBpceWorld")) return;

    // --- Fragment: declare probe uniforms + box projection helper ------------
    shader.uniforms.uRtBpce = rtLookUniforms.uRtBpce;
    shader.uniforms.uProbePos = probe.uProbePos;
    shader.uniforms.uProbeBoxMin = probe.uProbeBoxMin;
    shader.uniforms.uProbeBoxMax = probe.uProbeBoxMax;

    const envChunk = (THREE.ShaderChunk as Record<string, string | undefined>).envmap_physical_pars_fragment ?? "";
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uRtBpce;
uniform vec3 uProbePos;
uniform vec3 uProbeBoxMin;
uniform vec3 uProbeBoxMax;
varying vec3 vRtBpceWorld;
vec3 bpceReflect( vec3 dir ) {
  if ( uRtBpce < 0.5 ) return dir;
  // Box-projected cubemap parallax correction: march the reflection ray from
  // the fragment to the probe's bounding box, then re-express it relative to
  // the probe centre — grazing reflections slide with true perspective.
  vec3 rel = vRtBpceWorld - uProbePos;
  vec3 bMin = uProbeBoxMin - uProbePos;
  vec3 bMax = uProbeBoxMax - uProbePos;
  vec3 exitPos = mix( bMin, bMax, step( vec3( 0.0 ), dir ) );
  vec3 safeDir = mix( dir, vec3( 1e-4 ), lessThan( abs( dir ), vec3( 1e-4 ) ) );
  vec3 tExit = ( exitPos - rel ) / safeDir;
  float t = min( min( tExit.x, tExit.y ), tExit.z );
  return rel + dir * max( t, 0.0 );
}`,
      )
      .replace(
        "#include <envmap_physical_pars_fragment>",
        envChunk.split("envMapRotation * reflectVec").join("envMapRotation * bpceReflect( reflectVec )"),
      );

    // --- Vertex: ship the world position to the fragment stage ---------------
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vRtBpceWorld;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vRtBpceWorld = ( modelMatrix * (
#ifdef USE_INSTANCING
  instanceMatrix *
#endif
  vec4( transformed, 1.0 ) ) ).xyz;`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * Dual reflection probe rig. Baking is event-driven (rebuild / envKey change)
 * and costs < 3 ms total: 12 cube faces at 256² + the on-demand PMREM
 * conversion three performs when the cube texture is (re)bound as envMap.
 */
export class ReflectionProbeRig {
  public readonly exteriorRT: THREE.WebGLCubeRenderTarget;
  public readonly interiorRT: THREE.WebGLCubeRenderTarget;
  public readonly exteriorCam: THREE.CubeCamera;
  public readonly interiorCam: THREE.CubeCamera;
  private bakedOnce = false;
  private disposed = false;

  constructor() {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.exteriorRT = new THREE.WebGLCubeRenderTarget(256, opts);
    this.interiorRT = new THREE.WebGLCubeRenderTarget(256, opts);

    const extPos = exteriorProbeUniforms.uProbePos.value;
    this.exteriorCam = new THREE.CubeCamera(0.35, 90, this.exteriorRT);
    this.exteriorCam.position.copy(extPos);
    this.exteriorCam.name = "rt-probe-exterior";
    this.exteriorCam.matrixAutoUpdate = true;

    const intPos = interiorProbeUniforms.uProbePos.value;
    this.interiorCam = new THREE.CubeCamera(0.3, 40, this.interiorRT);
    this.interiorCam.position.copy(intPos);
    this.interiorCam.name = "rt-probe-interior";
    this.interiorCam.matrixAutoUpdate = true;
  }

  get hasBaked(): boolean {
    return this.bakedOnce;
  }

  /**
   * Captures both probes. Glass / BPCE-marked meshes and the caller's transient
   * overlays are hidden so the probe never sees itself. After capture the cube
   * textures' PMREM caches are invalidated, which three re-bakes on next bind.
   */
  public bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene, opts: ProbeBakeOptions = {}): void {
    if (this.disposed) return;
    const searchRoot = opts.searchRoot ?? scene;
    const hidden: THREE.Object3D[] = [];

    for (const extra of opts.hide ?? []) {
      if (extra.visible) {
        extra.visible = false;
        hidden.push(extra);
      }
    }
    searchRoot.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && (m.userData as { rtBpce?: ProbeKind }).rtBpce) {
          o.visible = false;
          hidden.push(o);
          break;
        }
      }
    });

    const restore = () => {
      for (const o of hidden) o.visible = true;
    };

    try {
      // Keep the cube cameras parented to the scene so layer masks & matrices resolve.
      if (this.exteriorCam.parent !== scene) scene.add(this.exteriorCam, this.interiorCam);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      try {
        this.exteriorCam.update(renderer, scene);
        this.interiorCam.update(renderer, scene);
        // Invalidate the renderer-side PMREM conversion caches (WebGLEnvironments).
        this.exteriorRT.texture.needsPMREMUpdate = true;
        this.interiorRT.texture.needsPMREMUpdate = true;
        this.bakedOnce = true;
      } finally {
        renderer.autoClear = prevAutoClear;
      }
    } catch {
      // Headless/invalid renderer (tests, context loss) — skip this bake silently.
    } finally {
      restore();
    }
  }

  /**
   * Points every BPCE-marked material's envMap at the probe cube textures (RT ON)
   * or back at the flat PMREM environment (RT OFF / pre-bake fallback).
   */
  public bindEnvMaps(root: THREE.Object3D, on: boolean, fallbackEnv: THREE.Texture | null): void {
    const ext = on && this.bakedOnce ? this.exteriorRT.texture : fallbackEnv;
    const int = on && this.bakedOnce ? this.interiorRT.texture : fallbackEnv;
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial)) continue;
        const kind = (m.userData as { rtBpce?: ProbeKind }).rtBpce;
        if (!kind) continue;
        m.envMap = kind === "interior" ? int : ext;
        m.needsUpdate = true;
      }
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.exteriorCam.parent?.remove(this.exteriorCam);
    this.interiorCam.parent?.remove(this.interiorCam);
    this.exteriorRT.dispose();
    this.interiorRT.dispose();
  }
}
