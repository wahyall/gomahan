/**
 * Photographic camera pipeline calibration (`PH-01` … `PH-05`, `PLAN_GRAPHIC.md`).
 *
 * Per-time-of-day presets tuned so every hour reads like an ArchDaily / Dezeen
 * editorial photograph: Auto-Exposure EV100, Kelvin white balance, GI bounce
 * strength, bloom strength and aerial-perspective character. The EV controller
 * adapts smoothly (camera-iris feel, `1 - exp(-dt * 2.5)`) with zero GPU cost.
 */

export interface PhotographicPreset {
  id: "pagi" | "siang" | "golden" | "malam" | "hujan";
  label: string;
  /** Representative hour (only used for docs/tests — resolution is continuous). */
  hour: number;
  /** EV100-style exposure multiplier applied before tone mapping. */
  exposure: number;
  /** Correlated color temperature (Kelvin) of the white-balance target. */
  kelvin: number;
  /** Green-magenta tint shift (−1 … +1, small values only). */
  tint: number;
  /** Baked GI single-bounce strength (GR-01). */
  giBounce: number;
  /** Dual-Kawase bloom composite strength. */
  bloomStrength: number;
  /** Bloom prefilter threshold (HDR linear). */
  bloomThreshold: number;
  /** Aerial fog density multiplier (GR-07). */
  aerialDensity: number;
  /** Sun shaft (AtmospherePass) intensity boost. */
  godRayBoost: number;
}

/** Kalibrasi per waktu — the five editorial "looks" (PLAN §4). */
export const PHOTOGRAPHIC_PRESETS: Record<PhotographicPreset["id"], PhotographicPreset> = {
  pagi: {
    id: "pagi",
    label: "Pagi Cerah",
    hour: 7,
    exposure: 1.06,
    kelvin: 5200,
    tint: 0.02,
    giBounce: 0.9,
    bloomStrength: 0.26,
    bloomThreshold: 1.05,
    aerialDensity: 1.15,
    godRayBoost: 1.1,
  },
  siang: {
    id: "siang",
    label: "Siang Tropis",
    hour: 10.5,
    exposure: 0.96,
    kelvin: 5700,
    tint: 0,
    giBounce: 0.85,
    bloomStrength: 0.22,
    bloomThreshold: 1.08,
    aerialDensity: 0.9,
    godRayBoost: 0.85,
  },
  golden: {
    id: "golden",
    label: "Golden Hour",
    hour: 17.25,
    exposure: 1.1,
    kelvin: 4600,
    tint: 0.03,
    giBounce: 1.05,
    bloomStrength: 0.34,
    bloomThreshold: 1.0,
    aerialDensity: 1.35,
    godRayBoost: 1.3,
  },
  malam: {
    id: "malam",
    label: "Malam / Blue Hour",
    hour: 20,
    exposure: 1.22,
    kelvin: 3900,
    tint: -0.01,
    giBounce: 0.95,
    bloomStrength: 0.36,
    bloomThreshold: 0.98,
    aerialDensity: 1.0,
    godRayBoost: 0.4,
  },
  hujan: {
    id: "hujan",
    label: "Hujan / Badai",
    hour: 14,
    exposure: 1.04,
    kelvin: 6200,
    tint: 0.01,
    giBounce: 0.65,
    bloomStrength: 0.2,
    bloomThreshold: 1.02,
    aerialDensity: 1.15,
    godRayBoost: 0.5,
  },
};

export const PHOTOGRAPHIC_EXPOSURE_MIN = 0.85;
export const PHOTOGRAPHIC_EXPOSURE_MAX = 1.45;
/** Iris adaptation speed: `1 - exp(-dt * EV_SMOOTH_RATE)`. */
export const EV_SMOOTH_RATE = 2.5;

/** Blended preset for an arbitrary hour / rain state (deterministic, pure). */
export function resolvePhotographicPreset(hourOfDay: number, rainIntensityMmH: number): PhotographicPreset {
  const isStorm = rainIntensityMmH > 20;
  const rainy = rainIntensityMmH > 4;
  if (isStorm) return { ...PHOTOGRAPHIC_PRESETS.hujan, exposure: PHOTOGRAPHIC_PRESETS.hujan.exposure + 0.04 };
  if (rainy) return { ...PHOTOGRAPHIC_PRESETS.hujan, aerialDensity: 1.08, bloomStrength: 0.22 };

  // Continuous piecewise-lerp between editorial anchors (wraps at midnight):
  // malam ─ pagi ─ siang ─ golden ─ malam
  const segs: { lo: number; hi: number; a: PhotographicPreset; b: PhotographicPreset }[] = [
    { lo: 5.5, hi: 6.4, a: PHOTOGRAPHIC_PRESETS.malam, b: PHOTOGRAPHIC_PRESETS.pagi },
    { lo: 6.4, hi: 11.5, a: PHOTOGRAPHIC_PRESETS.pagi, b: PHOTOGRAPHIC_PRESETS.siang },
    { lo: 11.5, hi: 17.25, a: PHOTOGRAPHIC_PRESETS.siang, b: PHOTOGRAPHIC_PRESETS.golden },
    { lo: 17.25, hi: 20.5, a: PHOTOGRAPHIC_PRESETS.golden, b: PHOTOGRAPHIC_PRESETS.malam },
  ];
  for (const s of segs) {
    if (hourOfDay >= s.lo && hourOfDay < s.hi) {
      const t = THREEishLerpT(s.lo, s.hi, hourOfDay);
      const a = s.a;
      const b = s.b;
      return {
        id: t < 0.5 ? a.id : b.id,
        label: t < 0.5 ? a.label : b.label,
        hour: a.hour + (b.hour - a.hour) * t,
        exposure: lerp(a.exposure, b.exposure, t),
        kelvin: lerp(a.kelvin, b.kelvin, t),
        tint: lerp(a.tint, b.tint, t),
        giBounce: lerp(a.giBounce, b.giBounce, t),
        bloomStrength: lerp(a.bloomStrength, b.bloomStrength, t),
        bloomThreshold: lerp(a.bloomThreshold, b.bloomThreshold, t),
        aerialDensity: lerp(a.aerialDensity, b.aerialDensity, t),
        godRayBoost: lerp(a.godRayBoost, b.godRayBoost, t),
      };
    }
  }
  return PHOTOGRAPHIC_PRESETS.malam; // 20:30–24:00 and 00:00–05:30
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function THREEishLerpT(a: number, b: number, x: number): number {
  return Math.max(0, Math.min(1, (x - a) / Math.max(1e-5, b - a)));
}

/**
 * Target EV for the current state. Interior views (Walk Mode inside the house)
 * push the "camera iris" open a bit — exterior closes down — exactly like a
 * photographer stepping through the front door.
 */
export function computeTargetExposure(hourOfDay: number, rainIntensityMmH: number, isInterior: boolean): number {
  const preset = resolvePhotographicPreset(hourOfDay, rainIntensityMmH);
  let ev = preset.exposure;
  if (isInterior) {
    // Interior is several stops darker: open the iris (capped so highlights survive).
    ev *= 1.18;
  }
  return Math.max(PHOTOGRAPHIC_EXPOSURE_MIN, Math.min(PHOTOGRAPHIC_EXPOSURE_MAX, ev));
}

/**
 * Smooth camera-iris adaptation (PH-01): exponentially approaches the target EV
 * so stepping luar → dalam feels like a real lens, never a brightness snap.
 * Pure function — the caller owns the current value.
 */
export function computeAutoExposure(
  current: number,
  hourOfDay: number,
  rainIntensityMmH: number,
  isInterior: boolean,
  dtSeconds: number,
): number {
  const target = computeTargetExposure(hourOfDay, rainIntensityMmH, isInterior);
  if (!Number.isFinite(current) || current <= 0) return target;
  const dt = Math.max(0, Math.min(0.25, dtSeconds));
  const k = 1 - Math.exp(-dt * EV_SMOOTH_RATE);
  return current + (target - current) * k;
}

/**
 * Tanner Helland's Kelvin → linear-RGB approximation (2800K … 10000K),
 * normalized so D65 (~6500K) lands at white. Returns components in [0..~1.2].
 */
export function kelvinToRgb(kelvin: number): { r: number; g: number; b: number } {
  const t = Math.max(2000, Math.min(12000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }

  const clamp01 = (x: number) => Math.max(0, Math.min(255, x)) / 255;
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

/**
 * White-balance gain (linear) for a camera set to `kelvin`, relative to the
 * working D65 space: warm sources get their blue channel lifted etc. Also
 * applies a small green/magenta `tint` nudge. Safe 3×3 matrix for the shader.
 */
export function whiteBalanceMatrix(kelvin: number, tint: number): number[] {
  const src = kelvinToRgb(kelvin);
  // Gains that re-map the illuminant to neutral.
  const invMax = 1 / Math.max(1e-4, Math.max(src.r, src.g, src.b));
  const gR = src.r * invMax;
  const gG = src.g * invMax;
  const gB = src.b * invMax;
  const tintG = 1 + Math.max(-0.12, Math.min(0.12, tint));
  // Row-major 3×3 (three.js Matrix3.set is row-major).
  return [
    gR, 0, 0,
    0, gG * tintG, 0,
    0, 0, gB,
  ];
}
