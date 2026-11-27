import * as THREE from "three";
import { rtLookUniforms } from "@/lib/scene/rtUniforms";

/**
 * GR-03 + GR-05 — PCSS-Lite shadow injection & IES photometric spot profile.
 *
 * `attachPcssShadow` swaps three r187's fixed-radius 5-tap PCF kernel for a
 * **variable-penumbra PCSS-Lite**: a 4-tap blocker probe at receiver depth
 * estimates occlusion coverage, then an 8-tap Vogel disk (rotated per pixel by
 * Interleaved Gradient Noise) widens with occlusion × light-distance — razor
 * sharp at contact, naturally soft away from the caster. The whole filter is
 * gated by the shared `uRtPcss` uniform: 0 reproduces the stock kernel exactly,
 * 1 enables PCSS — one compiled program serves both RT modes (zero hitch).
 */

const PCSS_CACHE_KEY = "-rt-pcss-v1";

/** Text replaced inside `shadowmap_pars_fragment` (unique to the PCF sampler2DShadow path). */
const PCF_KERNEL_START = "vec2 texelSize = vec2( 1.0 ) / shadowMapSize;";
const PCF_KERNEL_END = ") * 0.2;";

const PCSS_KERNEL_BODY = /* glsl */ `
vec2 texelSize = vec2( 1.0 ) / shadowMapSize;

                        // PCSS-Lite variable penumbra (GR-03) — uniform-gated, no recompile.
                        if ( uRtPcss > 0.5 ) {

                                // Base filter is wider than stock PCF for area-light sun softness (~0.5 deg),
                                // while bounded enough to prevent grazing-wall shadow acne banding.
                                vec2 radius = shadowRadius * texelSize * 1.85;

                                // Use IGN to rotate sampling patterns per pixel (grid-artifact free).
                                float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;

                                // 4-tap blocker probe: compare taps return the LIT factor, so
                                // occlusion coverage = 1 - average(lit).
                                vec2 probeR = radius * 1.05;
                                float litProbe = 0.0;
                                litProbe += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 4, phi ) * probeR, shadowCoord.z ) );
                                litProbe += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 4, phi ) * probeR, shadowCoord.z ) );
                                litProbe += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 4, phi ) * probeR, shadowCoord.z ) );
                                litProbe += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 4, phi ) * probeR, shadowCoord.z ) );
                                float blocked = 1.0 - litProbe * 0.25;

                                // Receiver depth grows with distance from the sun → wider penumbra
                                // (physical area-light behaviour without a depth readback).
                                float depthFactor = clamp( shadowCoord.z, 0.0, 1.0 );
                                float spread = 1.0 + blocked * ( 0.6 + 2.6 * depthFactor );
                                vec2 pcssR = radius * spread;

                                shadow = (
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 8, phi ) * pcssR, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 8, phi ) * pcssR, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 8, phi ) * pcssR, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 8, phi ) * pcssR, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 8, phi ) * pcssR, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 5, 8, phi ) * pcssR, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 6, 8, phi ) * pcssR, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 7, 8, phi ) * pcssR, shadowCoord.z ) )
                                ) * 0.125;

                        } else {

                                // Stock three r187 kernel (RT OFF — bit-compatible fallback).
                                vec2 radius = shadowRadius * texelSize;
                                float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;

                                shadow = (
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
                                        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
                                ) * 0.2;

                        }
`;

/**
 * Installs the PCSS-Lite kernel + shared `uRtPcss` uniform on a shadow-receiving
 * material. Idempotent; chains any pre-existing `onBeforeCompile`.
 */
export function attachPcssShadow<T extends THREE.Material>(mat: T): T {
  const ud = mat.userData as { _rtPcssAttached?: boolean };
  if (ud._rtPcssAttached) return mat;
  ud._rtPcssAttached = true;

  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : mat.type}${PCSS_CACHE_KEY}`;

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    if (shader.fragmentShader.includes("uRtPcss")) return;
    const chunk = (THREE.ShaderChunk as Record<string, string>).shadowmap_pars_fragment;
    if (!chunk || !chunk.includes(PCF_KERNEL_START)) return;
    const start = chunk.indexOf(PCF_KERNEL_START);
    const end = chunk.indexOf(PCF_KERNEL_END, start);
    if (end < 0) return;
    // `uniform` declarations must sit at global scope — prepend to the chunk,
    // never inside `getShadow()` where the kernel body is swapped.
    const patched =
      `uniform float uRtPcss;\n` +
      chunk.slice(0, start) +
      PCSS_KERNEL_BODY +
      chunk.slice(end + PCF_KERNEL_END.length);
    shader.uniforms.uRtPcss = rtLookUniforms.uRtPcss;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <shadowmap_pars_fragment>",
      patched,
    );
  };
  mat.needsUpdate = true;
  return mat;
}

/* ------------------------------------------------------------------ *
 * GR-05 — 64×64 procedural IES photometric spot profile (spot.map).  *
 * ------------------------------------------------------------------ */

export const IES_TEXTURE_SIZE = 64;

/**
 * Deterministic IES-like radial profile sampler (pure, unit-testable):
 * soft bright core → gentle falloff → wall-wash scallop ring → zero at edge.
 * `u`/`v` are the projected texture coordinates in [0, 1].
 */
export function sampleIesProfile(u: number, v: number): number {
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.5) * 2;
  const r = Math.min(1.001, Math.hypot(dx, dy)); // 0 at centre, ~1 at corner
  if (r >= 1) return 0;
  // Soft core (0 … 0.38): wide bright pool under the fixture.
  const core = Math.max(0, 1 - r / 0.38);
  const coreTerm = Math.pow(core, 1.35) * 0.92;
  // Scallop ring around 0.55: the wall-wash arc real architectural IES files show.
  const ringDist = Math.abs(r - 0.55);
  const ring = Math.max(0, 1 - ringDist / 0.18);
  const ringTerm = Math.pow(ring, 2.2) * 0.34;
  // Smooth outer cutoff (0.78 … 1.0).
  const cutoff = Math.max(0, 1 - Math.max(0, (r - 0.78) / 0.22));
  return Math.min(1, (coreTerm + ringTerm) * cutoff);
}

/**
 * Builds the IES spot cookie as a `DataTexture` (no canvas dependency — works
 * in jsdom/CI). Assigned to `SpotLight.map` for photometric scallop patterns.
 */
export function createIesSpotTexture(): THREE.DataTexture {
  const S = IES_TEXTURE_SIZE;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const intensity = sampleIesProfile(u, v);
      const g = Math.round(intensity * 255);
      const i = (y * S + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Computes how many `SpotLight`s per level may bind a `spot.map` IES cookie
 * without exceeding the GPU's `MAX_TEXTURE_IMAGE_UNITS` limit when all levels
 * are visible simultaneously (LT2 / Atap).
 *
 * Each `spot.map` reserves one fragment sampler slot (`spotLightMap[i]`).
 * Reserving 8 slots covers albedo, normal, roughness, aoMap, envMap, sun
 * shadow map, plus 2 headroom slots on a 16-unit WebGL2 baseline GPU.
 */
export function computeIesSpotBudgetPerLevel(
  maxFragmentTextures: number,
  spotsPerLevel: number,
  levelCount: number,
  reservedMaterialSamplers = 8,
): number {
  const safeMax = Number.isFinite(maxFragmentTextures) && maxFragmentTextures > 0 ? maxFragmentTextures : 16;
  const available = Math.max(0, safeMax - reservedMaterialSamplers);
  const perLevel = Math.floor(available / Math.max(1, levelCount));
  return Math.max(0, Math.min(spotsPerLevel, perLevel));
}
