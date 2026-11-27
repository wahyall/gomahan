import * as THREE from "three";

/**
 * Shared "Hybrid RT Look" uniforms (`GR-08` / `PLAN_GRAPHIC.md`).
 *
 * Every material hook (Baked GI, PCSS-Lite, BPCEM reflections, Fresnel glass,
 * Foliage SSS, Aerial fog) references these module-level uniform objects, so the
 * scenes can flip the entire photographic stack with a single assignment —
 * uniform values never trigger a GLSL recompile, which is what keeps the
 * RT ON ↔ OFF toggle instant (0 ms shader stutter).
 */

export interface RtSharedUniforms {
  /** Master switch: 0.0 = RT OFF (clean raster), 1.0 = RT ON (hybrid photorealistic). */
  uRtEnabled: { value: number };
  /** PCSS-Lite variable-penumbra shadow filter switch (GR-03). */
  uRtPcss: { value: number };
  /** Baked GI single-bounce strength multiplier (GR-01), calibrated per time preset. */
  uRtGiStrength: { value: number };
  /** BPCEM box-projected reflection enable (GR-02). */
  uRtBpce: { value: number };
  /** Fresnel architectural glass enable (GR-04). */
  uRtFresnel: { value: number };
  /** Foliage backlit SSS enable (GR-04). */
  uRtSss: { value: number };
  /** Height aerial perspective + Mie sun in-scattering enable (GR-07). */
  uRtAerial: { value: number };
  /** Sun direction in VIEW space (feeds foliage SSS + Mie scattering + SSCS). */
  uSunDirView: { value: THREE.Vector3 };
  /** Sun radiance tint used by the foliage SSS glow (linear, roughly [0..1]). */
  uSunTint: { value: THREE.Color };
  /** Camera world-space Y (feeds exponential height fog). */
  uCamWorldY: { value: number };
  /** Cool (anti-sun) aerial perspective color. */
  uAerialCool: { value: THREE.Color };
  /** Warm (toward-sun / Mie) aerial perspective color. */
  uAerialWarm: { value: THREE.Color };
}

export const rtLookUniforms: RtSharedUniforms = {
  uRtEnabled: { value: 0 },
  uRtPcss: { value: 0 },
  uRtGiStrength: { value: 0.85 },
  uRtBpce: { value: 0 },
  uRtFresnel: { value: 0 },
  uRtSss: { value: 0 },
  uRtAerial: { value: 0 },
  uSunDirView: { value: new THREE.Vector3(0.45, 0.78, -0.42) },
  uSunTint: { value: new THREE.Color(1.0, 0.95, 0.86) },
  uCamWorldY: { value: 1.6 },
  uAerialCool: { value: new THREE.Color(0.71, 0.8, 0.89) },
  uAerialWarm: { value: new THREE.Color(1.0, 0.83, 0.62) },
};

/** Flip the whole uniform-driven RT stack on or off (no shader recompiles). */
export function setRtLookUniforms(on: boolean, giStrength = 0.85): void {
  const v = on ? 1 : 0;
  rtLookUniforms.uRtEnabled.value = v;
  rtLookUniforms.uRtPcss.value = v;
  rtLookUniforms.uRtBpce.value = v;
  rtLookUniforms.uRtFresnel.value = v;
  rtLookUniforms.uRtSss.value = v;
  rtLookUniforms.uRtAerial.value = v;
  rtLookUniforms.uRtGiStrength.value = on ? giStrength : 0;
}

/** Per-probe BPCEM box uniforms — the ReflectionProbeRig writes these on every bake. */
export interface BpceProbeUniforms {
  uProbePos: { value: THREE.Vector3 };
  uProbeBoxMin: { value: THREE.Vector3 };
  uProbeBoxMax: { value: THREE.Vector3 };
}

function makeProbeUniforms(pos: [number, number, number], boxMin: [number, number, number], boxMax: [number, number, number]): BpceProbeUniforms {
  return {
    uProbePos: { value: new THREE.Vector3(...pos) },
    uProbeBoxMin: { value: new THREE.Vector3(...boxMin) },
    uProbeBoxMax: { value: new THREE.Vector3(...boxMax) },
  };
}

/**
 * Exterior probe box: the whole site parcel (halaman, fasad, tetangga, langit).
 * Default positions mirror the hero lot; the rig re-centers them on bake.
 */
export const exteriorProbeUniforms: BpceProbeUniforms = makeProbeUniforms(
  [2.5, 2.8, 1.5],
  [-8, 0, -14],
  [13, 24, 31],
);

/**
 * Interior probe box: ruang utama LT1 (living/keluarga) — reflection surfaces
 * inside see walls, bright openings and lit fixtures, not the sky dome.
 */
export const interiorProbeUniforms: BpceProbeUniforms = makeProbeUniforms(
  [2.8, 1.8, 8.2],
  [0.2, 0.1, 5.6],
  [5.3, 3.4, 11.0],
);
