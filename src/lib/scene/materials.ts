import * as THREE from "three";
import { attachBakedAoShader } from "@/lib/scene/bakedAo";
import { attachPcssShadow } from "@/lib/scene/pcssShadow";
import { attachBpceReflection } from "@/lib/scene/reflectionProbes";
import { exteriorProbeUniforms, interiorProbeUniforms, rtLookUniforms } from "@/lib/scene/rtUniforms";

/**
 * High-resolution procedural PBR textures & materials guided by:
 * - `3d-high-resolution-textures` (sRGB albedo vs NoColorSpace data maps, mipmaps, dynamic anisotropy)
 * - `3d-wood-material` (grain pores/rings, clearcoat/oil roughness modulation, low envMapIntensity to preserve shadows)
 * - `3d-metal-material` (conductor metalness 1.0, LinearSRGBColorSpace F0, brushed roughness, PMREM cards + explicit envMap)
 * - `3d-harbour-water` (animated capillary ripples & rain impact rings via onBeforeCompile with distinct cache key)
 */

function makeCanvasOnly(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (ctx) draw(ctx);
  return cv;
}

function wrapCanvasTexture(
  cv: HTMLCanvasElement,
  srgb = true,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  if (repeatX !== 1 || repeatY !== 1) tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a linear tangent-space Normal Map canvas from a grayscale height canvas.
 */
function normalCanvasFromHeight(heightCanvas: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const hCtx = heightCanvas.getContext("2d")!;
  const src = hCtx.getImageData(0, 0, w, h).data;

  const outCv = document.createElement("canvas");
  outCv.width = w;
  outCv.height = h;
  const oCtx = outCv.getContext("2d")!;
  const dst = oCtx.createImageData(w, h);

  const sample = (x: number, y: number) => {
    const xx = ((x % w) + w) % w;
    const yy = ((y % h) + h) % h;
    return src[(yy * w + xx) * 4]! / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hL = sample(x - 1, y);
      const hR = sample(x + 1, y);
      const hU = sample(x, y - 1);
      const hD = sample(x, y + 1);
      const nx = (hL - hR) * strength;
      const ny = (hU - hD) * strength;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      const idx = (y * w + x) * 4;
      dst.data[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      dst.data[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      dst.data[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      dst.data[idx + 3] = 255;
    }
  }
  oCtx.putImageData(dst, 0, 0);
  return outCv;
}

function normalMapFromHeight(heightCanvas: HTMLCanvasElement, strength = 2.2): THREE.CanvasTexture {
  return wrapCanvasTexture(normalCanvasFromHeight(heightCanvas, strength), false);
}

interface CachedCanvasTriple {
  albedo: HTMLCanvasElement;
  rough?: HTMLCanvasElement;
  normal: HTMLCanvasElement;
}

interface CachedCanvasPalette {
  woodMain: CachedCanvasTriple;
  woodDeck: CachedCanvasTriple;
  plaster: { albedo: HTMLCanvasElement; normal: HTMLCanvasElement };
  tileCream: CachedCanvasTriple;
  tileGrey: CachedCanvasTriple;
  grass: { albedo: HTMLCanvasElement; normal: HTMLCanvasElement };
  road: { albedo: HTMLCanvasElement; normal: HTMLCanvasElement };
  brushedRough: HTMLCanvasElement;
  roofNormal: HTMLCanvasElement;
}

const cachedCanvasSets = new Map<number, CachedCanvasPalette>();

function getOrBuildCanvasPalette(texScale: number): CachedCanvasPalette {
  const key = Math.max(1, Math.round(texScale));
  const existing = cachedCanvasSets.get(key);
  if (existing) return existing;

  const S = Math.min(1024, 512 * key);

  const buildWoodCanvases = (baseHex: string, darkHex: string): CachedCanvasTriple => {
    const heightCv = document.createElement("canvas");
    heightCv.width = S;
    heightCv.height = S;
    const hCtx = heightCv.getContext("2d")!;
    hCtx.fillStyle = "#888888";
    hCtx.fillRect(0, 0, S, S);
    const albedo = makeCanvasOnly(S, S, (ctx) => {
      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) {
        const y = (i / 260) * S;
        const tVal = (Math.sin(i * 1.43) + 1) * 0.5;
        ctx.strokeStyle = darkHex;
        ctx.globalAlpha = 0.05 + tVal * 0.16;
        ctx.lineWidth = 1 + (i % 3);
        ctx.beginPath();
        hCtx.strokeStyle = tVal > 0.55 ? "#5a5a5a" : "#9c9c9c";
        hCtx.lineWidth = ctx.lineWidth;
        hCtx.beginPath();
        for (let x = 0; x <= S; x += 16) {
          const wave = Math.sin(x * 0.025 + i * 0.19) * 5.2 + Math.cos(x * 0.055 - i * 0.07) * 1.8;
          if (x === 0) {
            ctx.moveTo(0, y + wave);
            hCtx.moveTo(0, y + wave);
          } else {
            ctx.lineTo(x, y + wave);
            hCtx.lineTo(x, y + wave);
          }
        }
        ctx.stroke();
        hCtx.stroke();
      }
      for (let p = 0; p < 1400; p++) {
        const px = (p * 173) % S;
        const py = (p * 89) % S;
        ctx.fillStyle = p % 3 === 0 ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.04)";
        ctx.fillRect(px, py, 8 + (p % 10), 1);
        hCtx.fillStyle = "#484848";
        hCtx.fillRect(px, py, 8 + (p % 10), 1);
      }
      ctx.globalAlpha = 1;
    });
    const rough = makeCanvasOnly(S, S, (ctx) => {
      ctx.fillStyle = "#8a8a8a";
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = i % 3 === 0 ? "#a8a8a8" : i % 2 === 0 ? "#7a7a7a" : "#909090";
        ctx.fillRect(0, (i / 260) * S, S, 2);
      }
    });
    const normal = normalCanvasFromHeight(heightCv, 1.8);
    return { albedo, rough, normal };
  };

  const buildPlasterCanvases = () => {
    const heightCv = document.createElement("canvas");
    heightCv.width = S;
    heightCv.height = S;
    const hCtx = heightCv.getContext("2d")!;
    hCtx.fillStyle = "#808080";
    hCtx.fillRect(0, 0, S, S);
    const albedo = makeCanvasOnly(S, S, (ctx) => {
      ctx.fillStyle = "#f4f0e7";
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 3600; i++) {
        const x = (i * 107) % S;
        const y = (i * 211) % S;
        const sz = 1 + (i % 3);
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.038)";
        ctx.fillRect(x, y, sz, sz);
        hCtx.fillStyle = i % 2 === 0 ? "#919191" : "#6f6f6f";
        hCtx.fillRect(x, y, sz, sz);
      }
    });
    return { albedo, normal: normalCanvasFromHeight(heightCv, 1.3) };
  };

  const buildTileCanvases = (baseHex: string, groutHex: string): CachedCanvasTriple => {
    const heightCv = document.createElement("canvas");
    heightCv.width = S;
    heightCv.height = S;
    const hCtx = heightCv.getContext("2d")!;
    hCtx.fillStyle = "#d8d8d8";
    hCtx.fillRect(0, 0, S, S);
    hCtx.strokeStyle = "#303030";
    hCtx.lineWidth = 8;
    hCtx.strokeRect(4, 4, S - 8, S - 8);
    const albedo = makeCanvasOnly(S, S, (ctx) => {
      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 1100; i++) {
        const x = (i * 193) % S;
        const y = (i * 97) % S;
        ctx.fillStyle = i % 3 === 0 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)";
        ctx.fillRect(x, y, 2 + (i % 3), 2 + (i % 3));
      }
      ctx.strokeStyle = "rgba(0,0,0,0.30)";
      ctx.lineWidth = 12;
      ctx.strokeRect(3.5, 3.5, S - 7, S - 7);
      ctx.strokeStyle = groutHex;
      ctx.lineWidth = 7;
      ctx.strokeRect(3.5, 3.5, S - 7, S - 7);
    });
    const rough = makeCanvasOnly(S, S, (ctx) => {
      // GR-04 glazed ceramic body 0.14–0.21 (mirror-wet reflections) with subtle
      // mineral mottling so window reflections stay faintly organic, grout 0.96.
      ctx.fillStyle = "#232323"; // ≈0.137 glazed centre
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 24; i++) {
        const gx = (i * 137) % S;
        const gy = (i * 289) % S;
        const grad = ctx.createRadialGradient(gx, gy, 2, gx, gy, S * 0.22);
        grad.addColorStop(0, i % 2 === 0 ? "rgba(56,56,56,0.5)" : "rgba(26,26,26,0.5)");
        grad.addColorStop(1, "rgba(40,40,40,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(gx - S * 0.22, gy - S * 0.22, S * 0.44, S * 0.44);
      }
      ctx.strokeStyle = "#f5f5f5"; // matte grout ≈ 0.96
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, S - 8, S - 8);
    });
    return { albedo, rough, normal: normalCanvasFromHeight(heightCv, 2.0) };
  };

  const buildGrassCanvases = () => {
    const GS = 512;
    const heightCv = document.createElement("canvas");
    heightCv.width = GS;
    heightCv.height = GS;
    const hCtx = heightCv.getContext("2d")!;
    hCtx.fillStyle = "#7e7e7e";
    hCtx.fillRect(0, 0, GS, GS);
    let seed = 0x5f3759df;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const albedo = makeCanvasOnly(GS, GS, (ctx) => {
      ctx.fillStyle = "#5c8c46";
      ctx.fillRect(0, 0, GS, GS);
      for (let i = 0; i < 42; i++) {
        const cx = rand() * GS;
        const cy = rand() * GS;
        const rad = 28 + rand() * 52;
        const warm = i % 2 === 0;
        for (const ox of [-GS, 0, GS]) {
          for (const oy of [-GS, 0, GS]) {
            const g = ctx.createRadialGradient(cx + ox, cy + oy, 2, cx + ox, cy + oy, rad);
            g.addColorStop(0, warm ? "rgba(130, 174, 86, 0.14)" : "rgba(68, 108, 49, 0.13)");
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
          }
        }
      }
      ctx.fillStyle = "rgba(148, 192, 104, 0.08)";
      ctx.fillRect(0, 0, GS * 0.5, GS);
      for (let i = 0; i < 6500; i++) {
        const x = rand() * GS;
        const y = rand() * GS;
        const r = rand();
        ctx.fillStyle =
          r < 0.32 ? "rgba(72, 114, 52, 0.28)" : r < 0.68 ? "rgba(122, 168, 86, 0.26)" : "rgba(92, 138, 68, 0.24)";
        ctx.fillRect(x, y, 1.4, 3.2 + rand() * 3.5);
        hCtx.fillStyle = r > 0.5 ? "rgba(142,142,142,0.45)" : "rgba(110,110,110,0.45)";
        hCtx.fillRect(x, y, 1.5, 3.5);
      }
    });
    return { albedo, normal: normalCanvasFromHeight(heightCv, 1.0) };
  };

  const buildRoadCanvases = () => {
    const RS = 512;
    const heightCv = document.createElement("canvas");
    heightCv.width = RS;
    heightCv.height = RS;
    const hCtx = heightCv.getContext("2d")!;
    hCtx.fillStyle = "#808080";
    hCtx.fillRect(0, 0, RS, RS);
    const albedo = makeCanvasOnly(RS, RS, (ctx) => {
      ctx.fillStyle = "#3c4147";
      ctx.fillRect(0, 0, RS, RS);
      for (let i = 0; i < 4800; i++) {
        const x = (i * 157) % RS;
        const y = (i * 229) % RS;
        ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
        ctx.fillRect(x, y, 2, 2);
        hCtx.fillStyle = i % 2 === 0 ? "#9e9e9e" : "#626262";
        hCtx.fillRect(x, y, 2, 2);
      }
    });
    return { albedo, normal: normalCanvasFromHeight(heightCv, 1.8) };
  };

  const brushedRough = makeCanvasOnly(512, 512, (ctx) => {
    ctx.fillStyle = "#4c4c4c";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 600; i++) {
      const y = (i * 37) % 512;
      ctx.fillStyle = i % 2 === 0 ? "#6a6a6a" : "#3a3a3a";
      ctx.fillRect(0, y, 512, 1);
    }
  });

  const roofHeightCv = makeCanvasOnly(512, 512, (ctx) => {
    ctx.fillStyle = "#767676";
    ctx.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 42) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, 0, 5, 512);
      ctx.fillStyle = "#525252";
      ctx.fillRect(x + 5, 0, 3, 512);
    }
  });

  const built: CachedCanvasPalette = {
    woodMain: buildWoodCanvases("#9c6b42", "#58351c"),
    woodDeck: buildWoodCanvases("#b28558", "#6d4827"),
    plaster: buildPlasterCanvases(),
    tileCream: buildTileCanvases("#dfd9cd", "#b4aba0"),
    tileGrey: buildTileCanvases("#8f959c", "#63686f"),
    grass: buildGrassCanvases(),
    road: buildRoadCanvases(),
    brushedRough,
    roofNormal: normalCanvasFromHeight(roofHeightCv, 3.0),
  };
  cachedCanvasSets.set(key, built);
  return built;
}

function makeSeededCanvas(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  srgb = true,
): THREE.CanvasTexture {
  return wrapCanvasTexture(makeCanvasOnly(width, height, draw), srgb);
}

/**
 * `texScale` multiplies the hero canvas resolution (`3d-high-resolution-textures`: choose
 * resolution from the closest intended camera view). Desktop build scenes pass 2 (1024px),
 * mobile keeps 512px to stay inside GPU memory budgets.
 */
export function createWoodTextures(baseHex: string, darkHex: string, texScale = 1) {
  const S = Math.min(1024, 512 * Math.max(1, Math.round(texScale)));
  const heightCv = document.createElement("canvas");
  heightCv.width = S;
  heightCv.height = S;
  const hCtx = heightCv.getContext("2d")!;
  hCtx.fillStyle = "#888888";
  hCtx.fillRect(0, 0, S, S);

  const albedo = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, S, S);
      // Organic growth rings + medullary cathedral waves
      for (let i = 0; i < 260; i++) {
        const y = (i / 260) * S;
        const tVal = (Math.sin(i * 1.43) + 1) * 0.5;
        ctx.strokeStyle = darkHex;
        ctx.globalAlpha = 0.05 + tVal * 0.16;
        ctx.lineWidth = 1 + (i % 3);
        ctx.beginPath();
        hCtx.strokeStyle = tVal > 0.55 ? "#5a5a5a" : "#9c9c9c";
        hCtx.lineWidth = ctx.lineWidth;
        hCtx.beginPath();
        for (let x = 0; x <= S; x += 16) {
          const wave = Math.sin(x * 0.025 + i * 0.19) * 5.2 + Math.cos(x * 0.055 - i * 0.07) * 1.8;
          if (x === 0) {
            ctx.moveTo(0, y + wave);
            hCtx.moveTo(0, y + wave);
          } else {
            ctx.lineTo(x, y + wave);
            hCtx.lineTo(x, y + wave);
          }
        }
        ctx.stroke();
        hCtx.stroke();
      }
      // Fine vessel pores & fibers
      for (let p = 0; p < 1400; p++) {
        const px = (p * 173) % S;
        const py = (p * 89) % S;
        ctx.fillStyle = p % 3 === 0 ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.04)";
        ctx.fillRect(px, py, 8 + (p % 10), 1);
        hCtx.fillStyle = "#484848";
        hCtx.fillRect(px, py, 8 + (p % 10), 1);
      }
      ctx.globalAlpha = 1;
    },
    true,
  );

  const rough = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = "#8a8a8a";
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = i % 3 === 0 ? "#a8a8a8" : i % 2 === 0 ? "#7a7a7a" : "#909090";
        ctx.fillRect(0, (i / 260) * S, S, 2);
      }
    },
    false,
  );

  const normal = normalMapFromHeight(heightCv, 1.8);
  return { albedo, rough, normal };
}

export function createPlasterTextures(hex: string, texScale = 1) {
  const S = Math.min(1024, 512 * Math.max(1, Math.round(texScale)));
  const heightCv = document.createElement("canvas");
  heightCv.width = S;
  heightCv.height = S;
  const hCtx = heightCv.getContext("2d")!;
  hCtx.fillStyle = "#808080";
  hCtx.fillRect(0, 0, S, S);

  const albedo = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 3600; i++) {
        const x = (i * 107) % S;
        const y = (i * 211) % S;
        const sz = 1 + (i % 3);
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.038)";
        ctx.fillRect(x, y, sz, sz);
        hCtx.fillStyle = i % 2 === 0 ? "#919191" : "#6f6f6f";
        hCtx.fillRect(x, y, sz, sz);
      }
    },
    true,
  );
  const normal = normalMapFromHeight(heightCv, 1.3);
  return { albedo, normal };
}

export function createTileTextures(tileCm: number, baseHex: string, groutHex: string, texScale = 1) {
  const S = Math.min(1024, 512 * Math.max(1, Math.round(texScale)));
  const heightCv = document.createElement("canvas");
  heightCv.width = S;
  heightCv.height = S;
  const hCtx = heightCv.getContext("2d")!;
  hCtx.fillStyle = "#d8d8d8";
  hCtx.fillRect(0, 0, S, S);
  hCtx.strokeStyle = "#303030";
  hCtx.lineWidth = 8;
  hCtx.strokeRect(4, 4, S - 8, S - 8);

  const albedo = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, S, S);
      // Subtle mineral veining / granite flecks
      for (let i = 0; i < 1100; i++) {
        const x = (i * 193) % S;
        const y = (i * 97) % S;
        ctx.fillStyle = i % 3 === 0 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)";
        ctx.fillRect(x, y, 2 + (i % 3), 2 + (i % 3));
      }
      // Layer 4 Baked AO: subtle micro-cavity darkening in tile grout joints
      ctx.strokeStyle = "rgba(0,0,0,0.30)";
      ctx.lineWidth = 12;
      ctx.strokeRect(3.5, 3.5, S - 7, S - 7);
      ctx.strokeStyle = groutHex;
      ctx.lineWidth = 7;
      ctx.strokeRect(3.5, 3.5, S - 7, S - 7);
    },
    true,
  );

  const rough = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      // GR-04 glazed ceramic: body 0.14–0.21, grout 0.96 (plan §1.3).
      ctx.fillStyle = "#232323"; // glazed tile centre
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 24; i++) {
        const gx = (i * 137) % S;
        const gy = (i * 289) % S;
        const grad = ctx.createRadialGradient(gx, gy, 2, gx, gy, S * 0.22);
        grad.addColorStop(0, i % 2 === 0 ? "rgba(56,56,56,0.5)" : "rgba(26,26,26,0.5)");
        grad.addColorStop(1, "rgba(40,40,40,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(gx - S * 0.22, gy - S * 0.22, S * 0.44, S * 0.44);
      }
      ctx.strokeStyle = "#f5f5f5"; // matte grout line
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, S - 8, S - 8);
    },
    false,
  );

  const normal = normalMapFromHeight(heightCv, 2.0);
  const perM = 100 / tileCm;
  albedo.repeat.set(perM, perM);
  rough.repeat.set(perM, perM);
  normal.repeat.set(perM, perM);
  return { albedo, rough, normal };
}

export function createGrassTextures() {
  const S = 512;
  const heightCv = document.createElement("canvas");
  heightCv.width = S;
  heightCv.height = S;
  const hCtx = heightCv.getContext("2d")!;
  hCtx.fillStyle = "#7e7e7e";
  hCtx.fillRect(0, 0, S, S);

  // Deterministic PRNG (`3d-high-resolution-textures`) avoids periodic modulo dot lattices at grazing angles
  let seed = 0x5f3759df;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const albedo = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = "#5c8c46";
      ctx.fillRect(0, 0, S, S);
      // Soft painterly lawn tonal clouds (wrapped smoothly for tileability)
      for (let i = 0; i < 42; i++) {
        const cx = rand() * S;
        const cy = rand() * S;
        const rad = 28 + rand() * 52;
        const warm = i % 2 === 0;
        for (const ox of [-S, 0, S]) {
          for (const oy of [-S, 0, S]) {
            const g = ctx.createRadialGradient(cx + ox, cy + oy, 2, cx + ox, cy + oy, rad);
            g.addColorStop(0, warm ? "rgba(130, 174, 86, 0.14)" : "rgba(68, 108, 49, 0.13)");
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
          }
        }
      }
      // Subtle lawn mowing sheen bands
      ctx.fillStyle = "rgba(148, 192, 104, 0.08)";
      ctx.fillRect(0, 0, S * 0.5, S);

      // Fine organic grass blades without high-contrast dot aliasing
      for (let i = 0; i < 6500; i++) {
        const x = rand() * S;
        const y = rand() * S;
        const r = rand();
        ctx.fillStyle =
          r < 0.32 ? "rgba(72, 114, 52, 0.28)" : r < 0.68 ? "rgba(122, 168, 86, 0.26)" : "rgba(92, 138, 68, 0.24)";
        ctx.fillRect(x, y, 1.4, 3.2 + rand() * 3.5);
        hCtx.fillStyle = r > 0.5 ? "rgba(142,142,142,0.45)" : "rgba(110,110,110,0.45)";
        hCtx.fillRect(x, y, 1.5, 3.5);
      }
    },
    true,
  );
  albedo.repeat.set(14, 14);
  const normal = normalMapFromHeight(heightCv, 1.0);
  normal.repeat.set(14, 14);
  return { albedo, normal };
}

export function createRoadTextures() {
  const S = 512;
  const heightCv = document.createElement("canvas");
  heightCv.width = S;
  heightCv.height = S;
  const hCtx = heightCv.getContext("2d")!;
  hCtx.fillStyle = "#808080";
  hCtx.fillRect(0, 0, S, S);

  const albedo = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = "#3c4147";
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 4800; i++) {
        const x = (i * 157) % S;
        const y = (i * 229) % S;
        ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
        ctx.fillRect(x, y, 2, 2);
        hCtx.fillStyle = i % 2 === 0 ? "#9e9e9e" : "#626262";
        hCtx.fillRect(x, y, 2, 2);
      }
    },
    true,
  );
  albedo.repeat.set(14, 2);
  const normal = normalMapFromHeight(heightCv, 1.8);
  normal.repeat.set(14, 2);
  return { albedo, normal };
}

export function createMetalBrushedRoughness() {
  return makeSeededCanvas(
    512,
    512,
    (ctx) => {
      ctx.fillStyle = "#4c4c4c";
      ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 600; i++) {
        const y = (i * 37) % 512;
        ctx.fillStyle = i % 2 === 0 ? "#6a6a6a" : "#3a3a3a";
        ctx.fillRect(0, y, 512, 1);
      }
    },
    false,
  );
}

export function createStandingSeamBumpTexture() {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#767676";
  ctx.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 42) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, 0, 5, S);
    ctx.fillStyle = "#525252";
    ctx.fillRect(x + 5, 0, 3, S);
  }
  const bump = new THREE.CanvasTexture(cv);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.colorSpace = THREE.NoColorSpace;
  bump.generateMipmaps = true;
  bump.anisotropy = 4;
  bump.needsUpdate = true;
  const normal = normalMapFromHeight(cv, 3.0);
  bump.repeat.set(3, 3);
  normal.repeat.set(3, 3);
  return { bump, normal };
}

export function createSkyGradientTexture(hourOfDay: number, season: "kemarau" | "hujan", rainMmH: number): THREE.CanvasTexture {
  // Seamless 360-degree equirectangular atmospheric sky dome (`3d-sky-background`)
  // upgraded with photographic atmosphere (PH-05): solar aureole, horizon haze band
  // and gentle Rayleigh-like vertical falloff — all baked once per envKey (0 ms/frame).
  const W = 512;
  const H = 256;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;

  const isStorm = rainMmH > 20;
  const isNight = hourOfDay < 5.2 || hourOfDay > 18.8;
  const isGolden = (hourOfDay >= 5.2 && hourOfDay <= 7.5) || (hourOfDay >= 16.5 && hourOfDay <= 18.8);

  let stops: string[];
  if (isNight) {
    stops = ["#0a1020", "#111b32", "#1a2844", "#243554", "#273852", "#1e2a3f"];
  } else if (isStorm) {
    stops = ["#3d4754", "#4f5c6b", "#6a7888", "#8794a3", "#98a4af", "#7d8894"];
  } else if (isGolden) {
    stops = ["#284c7c", "#5278a4", "#c98b69", "#f0b97b", "#f6d4a4", "#e6c39b"];
  } else if (season === "hujan") {
    stops = ["#4474a8", "#6593c2", "#92b8da", "#bad3e6", "#d8e4ee", "#c5d3de"];
  } else {
    stops = ["#1f62aa", "#3e85c6", "#6fb0e0", "#a6d1ee", "#dcebf4", "#ccdae4"];
  }

  const grd = ctx.createLinearGradient(0, 0, 0, H);
  const pos = [0, 0.26, 0.48, 0.68, 0.84, 1];
  pos.forEach((p, i) => grd.addColorStop(p, stops[i]!));
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // PH-05 — soft horizon haze band (aerial perspective cue at the dome's equator).
  if (!isStorm) {
    const hazeAlpha = isNight ? 0.05 : isGolden ? 0.3 : 0.16;
    const hazeCol = isNight ? "41, 58, 92" : isGolden ? "246, 196, 138" : "236, 244, 250";
    const haze = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.62);
    haze.addColorStop(0, `rgba(${hazeCol},0)`);
    haze.addColorStop(0.55, `rgba(${hazeCol},${hazeAlpha})`);
    haze.addColorStop(1, `rgba(${hazeCol},0)`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, H * 0.4, W, H * 0.22);
  }

  // PH-05 — solar aureole around the true sun position (feeds CubeCamera reflections).
  if (!isNight && !isStorm) {
    const sunAz = ((hourOfDay - 12) / 6) * 0.9; // matches the BuildScene fallback formula
    const sunElev = Math.max(0.12, Math.sin(((hourOfDay - 5.5) / 13) * Math.PI));
    const sunU = ((Math.atan2(Math.sin(sunAz), Math.cos(sunAz)) / (Math.PI * 2)) + 0.5) % 1;
    const sunV = Math.max(0.04, Math.min(0.96, 0.5 - Math.asin(Math.min(1, sunElev)) / Math.PI));
    const cx = sunU * W;
    const cy = sunV * H;
    const aureoleR = isGolden ? W * 0.42 : W * 0.26;
    const coreCol = isGolden ? "255, 214, 150" : "255, 248, 232";
    const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, aureoleR);
    halo.addColorStop(0, `rgba(${coreCol},${isGolden ? 0.55 : 0.34})`);
    halo.addColorStop(0.35, `rgba(${coreCol},${isGolden ? 0.2 : 0.12})`);
    halo.addColorStop(1, `rgba(${coreCol},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
  }

  if (!isStorm) {
    // Periodic harmonic cirrus / cumulus bands along azimuth so longitude wrap at x=0/W is 100% seam-free
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = Math.floor(H * 0.1); y < Math.floor(H * 0.62); y++) {
      const elev = 1 - Math.abs((y - H * 0.38) / (H * 0.25));
      const bandWeight = Math.max(0, elev) * (isNight ? 0.08 : isGolden ? 0.22 : 0.26);
      for (let x = 0; x < W; x++) {
        const theta = (x / W) * Math.PI * 2;
        const sx = Math.cos(theta);
        const sz = Math.sin(theta);
        const f1 = Math.sin(sx * 2.4 + y * 0.065) * Math.cos(sz * 2.1 - y * 0.04);
        const f2 = Math.sin(sx * 5.2 - sz * 4.3 + y * 0.13) * 0.5;
        const wisp = Math.max(0, (f1 + f2) * 0.55 - 0.18) * bandWeight;
        if (wisp > 0.005) {
          const idx = (y * W + x) * 4;
          const targetR = isNight ? 58 : isGolden ? 255 : 252;
          const targetG = isNight ? 84 : isGolden ? 216 : 254;
          const targetB = isNight ? 124 : isGolden ? 174 : 255;
          d[idx] = Math.min(255, Math.round(d[idx]! * (1 - wisp) + targetR * wisp));
          d[idx + 1] = Math.min(255, Math.round(d[idx + 1]! * (1 - wisp) + targetG * wisp));
          d[idx + 2] = Math.min(255, Math.round(d[idx + 2]! * (1 - wisp) + targetB * wisp));
        }
      }
    }
    if (isNight) {
      let sSeed = 918273;
      for (let i = 0; i < 240; i++) {
        sSeed = (sSeed * 1664525 + 1013904223) >>> 0;
        const sx = sSeed % W;
        const sy = ((sSeed >>> 12) % Math.floor(H * 0.45));
        const idx = (sy * W + sx) * 4;
        d[idx] = 235;
        d[idx + 1] = 242;
        d[idx + 2] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createEnvironmentMap(renderer: THREE.WebGLRenderer, hourOfDay: number, rainMmH: number): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const isNight = hourOfDay < 5.5 || hourOfDay > 18.5;
  const isStorm = rainMmH > 20;

  // Low ambient backdrop with crisp HDR bright cards so metals/glass pop (`3d-metal-material`)
  envScene.background = new THREE.Color(isNight ? 0x0b1220 : isStorm ? 0x3b444f : 0x6c8ca8);

  const addCard = (w: number, h: number, pos: [number, number, number], col: THREE.ColorRepresentation, intensity: number) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const c = new THREE.Color(col).multiplyScalar(intensity);
    const mat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };

  if (!isNight) {
    addCard(9, 7, [7, 11, 6], 0xfff3dc, isStorm ? 1.05 : 1.85);
    addCard(10, 5, [-8, 6, -5], 0xa4d0f7, isStorm ? 0.75 : 1.15);
    addCard(7, 4, [0, 5, -9], 0xffe4b8, isStorm ? 0.55 : 1.25);
    addCard(14, 14, [0, -6, 0], 0x7b6f5c, 0.35);
  } else {
    addCard(6, 6, [0, 8, 0], 0x3f5e8f, 0.75);
    addCard(8, 5, [0, 2, 7], 0xffd59e, 0.65);
  }

  const rt = pmrem.fromScene(envScene, 0.02);
  envScene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();
  return rt.texture;
}

/** Soft radial sprite texture for the HDR sun core / halo billboards (shared by Build & Walk viewports). */
export function makeSunSpriteTexture(coreAlpha: number, falloff: number): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(255,255,255,${coreAlpha})`);
  g.addColorStop(falloff, `rgba(255,255,255,${coreAlpha * 0.42})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface FloodWaterUniforms {
  uTime: { value: number };
  uRain: { value: number };
}

export interface MaterialPalette {
  brickOuter: THREE.MeshStandardMaterial;
  brickInner: THREE.MeshStandardMaterial;
  mortar: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  concreteXray: THREE.MeshStandardMaterial;
  rebar: THREE.MeshStandardMaterial;
  steelWf: THREE.MeshStandardMaterial;
  steelLight: THREE.MeshStandardMaterial;
  woodTeak: THREE.MeshPhysicalMaterial;
  woodDeck: THREE.MeshPhysicalMaterial;
  plasterExt: THREE.MeshStandardMaterial;
  plasterInt: THREE.MeshStandardMaterial;
  tileFloor: THREE.MeshStandardMaterial;
  tileWet: THREE.MeshStandardMaterial;
  tileWood: THREE.MeshStandardMaterial;
  carport: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  aluDark: THREE.MeshStandardMaterial;
  roofCover: THREE.MeshStandardMaterial;
  lisplank: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  neighborWall: THREE.MeshStandardMaterial;
  neighborRoof: THREE.MeshStandardMaterial;
  floodWater: THREE.MeshPhysicalMaterial;
  floodUniforms: FloodWaterUniforms;
  mepWaterClean: THREE.MeshStandardMaterial;
  mepWaterWaste: THREE.MeshStandardMaterial;
  mepRainPipe: THREE.MeshStandardMaterial;
  mepElecLamp: THREE.MeshStandardMaterial;
  mepElecOutlet: THREE.MeshStandardMaterial;
  mepElecAc: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
  setTileSize: (tileCm: number) => void;
  setAnisotropy: (maxAniso: number) => void;
  bindEnvMap: (env: THREE.Texture | null) => void;
  getCachedMaterial: (hex: string, roughness: number) => THREE.MeshStandardMaterial;
  getPropMaterial: <T extends THREE.Material>(key: string, factory: () => T) => T;
  dispose: () => void;
}

/* ------------------------------------------------------------------ *
 * GR-04 / GR-07 / PH — photographic material shader hooks.            *
 * All hooks are uniform-gated (rtLookUniforms): RT OFF compiles the   *
 * exact stock shader path; RT ON activates the injection in-place.    *
 * ------------------------------------------------------------------ */

const RT_AA_CACHE_KEY = "-rt-spec-aa-v1";
const RT_AERIAL_CACHE_KEY = "-rt-aerial-v1";
const RT_GLASS_CACHE_KEY = "-rt-fresnel-glass-v1";
const RT_SSS_CACHE_KEY = "-rt-foliage-sss-v1";

/**
 * GR-04 — Toksvig/Kaplanyan specular anti-aliasing: derives extra roughness
 * from the per-pixel normal variance so window mullions, metal roof seams and
 * tile grout stop shimmering while the camera moves. 3 lines of GLSL.
 */
export function attachSpecularAa<T extends THREE.MeshStandardMaterial>(mat: T): T {
  const ud = mat.userData as { _rtSpecAa?: boolean };
  if (ud._rtSpecAa) return mat;
  ud._rtSpecAa = true;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : mat.type}${RT_AA_CACHE_KEY}`;
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    if (shader.fragmentShader.includes("rtSpecAa")) return;
    shader.uniforms.uRtEnabled = rtLookUniforms.uRtEnabled;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
#ifndef FLAT_SHADED
  float rtSpecAa = length( fwidth( vNormal ) ) * 0.55 * uRtEnabled;
  roughnessFactor = clamp( roughnessFactor + rtSpecAa, 0.045, 1.0 );
#endif`,
    );
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * GR-07 — Height-based aerial perspective + Mie sun in-scattering fused into
 * `fog_fragment` (visible from 100% of camera angles, not just toward the sun):
 * distant neighbours gain a warm glow toward the sun and cool blue depth away
 * from it, while ground-level air thickens via an exponential height falloff.
 */
export function attachAerialFog<T extends THREE.MeshStandardMaterial>(mat: T): T {
  const ud = mat.userData as { _rtAerial?: boolean };
  if (ud._rtAerial) return mat;
  ud._rtAerial = true;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : mat.type}${RT_AERIAL_CACHE_KEY}`;
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    if (shader.fragmentShader.includes("vRtWorldY")) return;
    shader.uniforms.uRtAerial = rtLookUniforms.uRtAerial;
    shader.uniforms.uSunDirView = rtLookUniforms.uSunDirView;
    shader.uniforms.uCamWorldY = rtLookUniforms.uCamWorldY;
    shader.uniforms.uAerialCool = rtLookUniforms.uAerialCool;
    shader.uniforms.uAerialWarm = rtLookUniforms.uAerialWarm;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vRtWorldY;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vRtWorldY = ( modelMatrix * (
#ifdef USE_INSTANCING
  instanceMatrix *
#endif
  vec4( transformed, 1.0 ) ) ).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vRtWorldY;
uniform float uRtAerial;
uniform vec3 uSunDirView;
uniform float uCamWorldY;
uniform vec3 uAerialCool;
uniform vec3 uAerialWarm;`,
      )
      .replace(
        "#include <fog_fragment>",
        `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float rtFogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float rtFogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 rtFogColor = fogColor;
  if ( uRtAerial > 0.5 ) {
    // GR-07: exponential height fog — air thickens toward the ground plane.
    float rtHeightAtten = exp( - max( 0.0, uCamWorldY - vRtWorldY ) * 0.055 );
    float rtAerialFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * 2.1 * rtHeightAtten );
    rtFogFactor = max( rtFogFactor, rtAerialFactor * 0.9 );
    // Mie forward scattering (warm when the camera looks TOWARD the sun: the
    // view ray is -vViewPosition, the sun is +uSunDirView) vs Rayleigh depth.
    vec3 rtViewDir = -normalize( vViewPosition );
    float rtMie = pow( clamp( dot( rtViewDir, uSunDirView ), 0.0, 1.0 ), 6.0 );
    rtFogColor = mix( uAerialCool, uAerialWarm, rtMie );
    rtFogColor = mix( fogColor, rtFogColor, 0.68 );
  }
  gl_FragColor.rgb = mix( gl_FragColor.rgb, rtFogColor, clamp( rtFogFactor, 0.0, 1.0 ) );
#endif`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * GR-04 — Schlick Fresnel architectural glass: crystal-clear when looked
 * through head-on (opacity ~0.12), a sharp sky/tree mirror at grazing angles
 * (opacity ~0.86 + 2.2× stronger probe reflections) with a low-iron edge tint.
 */
export function attachFresnelGlass<T extends THREE.MeshPhysicalMaterial>(mat: T): T {
  const ud = mat.userData as { _rtFresnelGlass?: boolean };
  if (ud._rtFresnelGlass) return mat;
  ud._rtFresnelGlass = true;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : mat.type}${RT_GLASS_CACHE_KEY}`;
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    if (shader.fragmentShader.includes("rtFres")) return;
    shader.uniforms.uRtFresnel = rtLookUniforms.uRtFresnel;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uRtFresnel;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
float rtFres = pow( 1.0 - abs( dot( normalize( vViewPosition ), normal ) ), 4.0 );`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
if ( uRtFresnel > 0.5 ) {
  // Clear head-on, mirror-like at grazing angles (Schlick).
  diffuseColor.a = clamp( mix( 0.12, 0.86, rtFres ), 0.06, 0.94 );
  // Low-iron green-blue edge tint toward grazing.
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.83, 0.93, 0.92 ), rtFres * 0.45 );
  material.roughness = min( material.roughness, 0.045 + rtFres * 0.03 );
}`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
reflectedLight.indirectSpecular *= ( 1.0 + 1.2 * rtFres * uRtFresnel );`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * GR-04 — Foliage backlit subsurface scattering: view-dependent wrap
 * translucency so canopies and hedges glow warm green-gold when the sun sits
 * behind them, instead of reading as opaque plastic.
 */
export function attachFoliageSss<T extends THREE.MeshStandardMaterial>(mat: T): T {
  const ud = mat.userData as { _rtFoliageSss?: boolean };
  if (ud._rtFoliageSss) return mat;
  ud._rtFoliageSss = true;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : mat.type}${RT_SSS_CACHE_KEY}`;
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(mat, shader, renderer);
    if (shader.fragmentShader.includes("rtBackLit")) return;
    shader.uniforms.uRtSss = rtLookUniforms.uRtSss;
    shader.uniforms.uSunDirView = rtLookUniforms.uSunDirView;
    shader.uniforms.uSunTint = rtLookUniforms.uSunTint;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uRtSss;
uniform vec3 uSunDirView;
uniform vec3 uSunTint;`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
{
  float rtBackLit = pow( clamp( dot( normalize( vViewPosition ), -uSunDirView + normal * 0.4 ), 0.0, 1.0 ), 3.0 );
  reflectedLight.directDiffuse += rtBackLit * uSunTint * diffuseColor.rgb * 0.55 * uRtSss;
}`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

export function createMaterialPalette(texScale = 1): MaterialPalette {
  const cached = getOrBuildCanvasPalette(texScale);
  const woodMain = {
    albedo: wrapCanvasTexture(cached.woodMain.albedo, true),
    rough: wrapCanvasTexture(cached.woodMain.rough!, false),
    normal: wrapCanvasTexture(cached.woodMain.normal, false),
  };
  const woodDeckTex = {
    albedo: wrapCanvasTexture(cached.woodDeck.albedo, true),
    rough: wrapCanvasTexture(cached.woodDeck.rough!, false),
    normal: wrapCanvasTexture(cached.woodDeck.normal, false),
  };
  const plasterTex = {
    albedo: wrapCanvasTexture(cached.plaster.albedo, true),
    normal: wrapCanvasTexture(cached.plaster.normal, false),
  };
  const perM40 = 100 / 40;
  const tileCream = {
    albedo: wrapCanvasTexture(cached.tileCream.albedo, true, perM40, perM40),
    rough: wrapCanvasTexture(cached.tileCream.rough!, false, perM40, perM40),
    normal: wrapCanvasTexture(cached.tileCream.normal, false, perM40, perM40),
  };
  const perM30 = 100 / 30;
  const tileGrey = {
    albedo: wrapCanvasTexture(cached.tileGrey.albedo, true, perM30, perM30),
    rough: wrapCanvasTexture(cached.tileGrey.rough!, false, perM30, perM30),
    normal: wrapCanvasTexture(cached.tileGrey.normal, false, perM30, perM30),
  };
  const grassTex = {
    albedo: wrapCanvasTexture(cached.grass.albedo, true, 14, 14),
    normal: wrapCanvasTexture(cached.grass.normal, false, 14, 14),
  };
  const roadTex = {
    albedo: wrapCanvasTexture(cached.road.albedo, true, 14, 2),
    normal: wrapCanvasTexture(cached.road.normal, false, 14, 2),
  };
  const brushedRough = wrapCanvasTexture(cached.brushedRough, false);
  const roofTex = {
    normal: wrapCanvasTexture(cached.roofNormal, false, 3, 3),
  };

  const textures = [
    woodMain.albedo,
    woodMain.rough,
    woodMain.normal,
    woodDeckTex.albedo,
    woodDeckTex.rough,
    woodDeckTex.normal,
    plasterTex.albedo,
    plasterTex.normal,
    tileCream.albedo,
    tileCream.rough,
    tileCream.normal,
    tileGrey.albedo,
    tileGrey.rough,
    tileGrey.normal,
    grassTex.albedo,
    grassTex.normal,
    roadTex.albedo,
    roadTex.normal,
    brushedRough,
    roofTex.normal,
  ];

  const brickOuter = new THREE.MeshStandardMaterial({
    color: 0xefede6,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.48, 0.48),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.3,
  });
  const brickInner = new THREE.MeshStandardMaterial({
    color: 0xe6e3da,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.48, 0.48),
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.28,
  });
  const mortar = new THREE.MeshStandardMaterial({ color: 0x999890, roughness: 0.95, envMapIntensity: 0.25 });
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x92969a,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.84,
    metalness: 0.02,
    envMapIntensity: 0.32,
  });
  const concreteXray = new THREE.MeshStandardMaterial({
    color: 0x7b93ab,
    roughness: 0.65,
    metalness: 0.05,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    envMapIntensity: 0.25,
  });
  const rebar = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0x7c2d12,
    emissiveIntensity: 0.45,
    roughness: 0.38,
    metalness: 0.85,
    transparent: true,
    opacity: 0.96,
    envMapIntensity: 0.8,
  });

  // Conductor Metals (`3d-metal-material`: metalness 1.0, LinearSRGBColorSpace F0, brushed roughness)
  const steelWf = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.28, 0.31, 0.35, THREE.LinearSRGBColorSpace),
    roughnessMap: brushedRough,
    roughness: 0.38,
    metalness: 1.0,
    envMapIntensity: 0.85,
  });
  const steelLight = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.58, 0.6, 0.63, THREE.LinearSRGBColorSpace),
    roughnessMap: brushedRough,
    roughness: 0.28,
    metalness: 1.0,
    envMapIntensity: 0.95,
  });
  const aluDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.16, 0.18, 0.21, THREE.LinearSRGBColorSpace),
    roughnessMap: brushedRough,
    roughness: 0.32,
    metalness: 1.0,
    envMapIntensity: 0.9,
  });

  // Timber (`3d-wood-material`: IOR 1.43, low envMapIntensity so dark shadow grain survives)
  const woodTeak = new THREE.MeshPhysicalMaterial({
    map: woodMain.albedo,
    roughnessMap: woodMain.rough,
    normalMap: woodMain.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.5,
    metalness: 0,
    ior: 1.43,
    clearcoat: 0.24,
    clearcoatRoughness: 0.36,
    envMapIntensity: 0.45,
  });

  const woodDeck = new THREE.MeshPhysicalMaterial({
    map: woodDeckTex.albedo,
    roughnessMap: woodDeckTex.rough,
    normalMap: woodDeckTex.normal,
    normalScale: new THREE.Vector2(0.78, 0.78),
    roughness: 0.62,
    metalness: 0,
    ior: 1.43,
    clearcoat: 0.1,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.38,
  });

  const plasterExt = new THREE.MeshStandardMaterial({
    map: plasterTex.albedo,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.58, 0.58),
    color: 0xf2ece1,
    roughness: 0.74,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  const plasterInt = new THREE.MeshStandardMaterial({
    map: plasterTex.albedo,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    color: 0xf7f5ef,
    roughness: 0.7,
    metalness: 0,
    envMapIntensity: 0.32,
  });

  const tileFloor = new THREE.MeshStandardMaterial({
    map: tileCream.albedo,
    roughnessMap: tileCream.rough,
    normalMap: tileCream.normal,
    normalScale: new THREE.Vector2(0.62, 0.62),
    // GR-04: roughness 1.0 lets the glazed map (body 0.14–0.21 / grout 0.96) drive
    // the final factor; envMapIntensity lifted so BPCEM window reflections pop.
    roughness: 1.0,
    metalness: 0.02,
    envMapIntensity: 0.9,
  });
  const tileWet = new THREE.MeshStandardMaterial({
    map: tileGrey.albedo,
    roughnessMap: tileGrey.rough,
    normalMap: tileGrey.normal,
    normalScale: new THREE.Vector2(0.66, 0.66),
    roughness: 0.78,
    metalness: 0.02,
    envMapIntensity: 0.42,
  });
  const tileWood = new THREE.MeshStandardMaterial({
    map: woodDeckTex.albedo,
    normalMap: woodDeckTex.normal,
    normalScale: new THREE.Vector2(0.58, 0.58),
    color: 0xd8c3a8,
    roughness: 0.46,
    metalness: 0.02,
    envMapIntensity: 0.48,
  });
  const carport = new THREE.MeshStandardMaterial({
    map: tileGrey.albedo,
    normalMap: tileGrey.normal,
    color: 0x8d9196,
    roughness: 0.88,
    metalness: 0.02,
    envMapIntensity: 0.32,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xdcf0f7,
    transparent: true,
    opacity: 0.32, // RT OFF base; GR-04 Fresnel drives alpha when RT is ON
    roughness: 0.08,
    metalness: 0.0,
    ior: 1.52,
    reflectivity: 0.78,
    clearcoat: 0.55,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.05,
    depthWrite: false,
  });

  const roofCover = new THREE.MeshStandardMaterial({
    color: 0x3a4046,
    normalMap: roofTex.normal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: brushedRough,
    roughness: 0.48,
    metalness: 0.18,
    envMapIntensity: 0.95,
  });

  const lisplank = new THREE.MeshStandardMaterial({ color: 0xe6dac5, roughness: 0.68, envMapIntensity: 0.35 });
  const ceiling = new THREE.MeshStandardMaterial({ color: 0xf5f4f0, roughness: 0.92, envMapIntensity: 0.25 });
  const grass = new THREE.MeshStandardMaterial({
    map: grassTex.albedo,
    normalMap: grassTex.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.22,
  });
  const road = new THREE.MeshStandardMaterial({
    map: roadTex.albedo,
    normalMap: roadTex.normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.85,
    metalness: 0.02,
    envMapIntensity: 0.38,
  });

  // Neighbours are architectural context, not a ghost overlay. Keep them opaque and muted so
  // they read as real houses while the hero lot still owns the contrast and saturation.
  const neighborWall = new THREE.MeshStandardMaterial({
    color: 0xc7c1b5,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.18,
  });
  const neighborRoof = new THREE.MeshStandardMaterial({
    color: 0x5c4b40,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.18, 0.18),
    roughness: 0.82,
    metalness: 0.04,
    envMapIntensity: 0.22,
  });

  // Realistic animated Surabaya flood water surface shader (`3d-harbour-water` / `3d-ultra-realistic-water`)
  const floodUniforms: FloodWaterUniforms = {
    uTime: { value: 0 },
    uRain: { value: 0 },
  };
  const floodWater = new THREE.MeshPhysicalMaterial({
    color: 0x456968,
    transparent: true,
    opacity: 0.78,
    roughness: 0.12,
    metalness: 0.04,
    ior: 1.333,
    reflectivity: 0.8,
    clearcoat: 0.65,
    clearcoatRoughness: 0.16,
    envMapIntensity: 0.85,
    depthWrite: false,
  });
  floodWater.customProgramCacheKey = () => "rumah-flood-water-v1";
  floodWater.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = floodUniforms.uTime;
    shader.uniforms.uRain = floodUniforms.uRain;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWaterWorld;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform float uRain;
        varying vec3 vWaterWorld;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        float wA = sin(vWaterWorld.x * 5.2 + uTime * 2.1) * cos(vWaterWorld.z * 4.4 - uTime * 1.6);
        float wB = sin((vWaterWorld.x + vWaterWorld.z) * 11.5 - uTime * 3.4);
        /* Rain drop expanding ring ripples */
        vec2 cell = floor(vWaterWorld.xz * 2.3);
        vec2 local = fract(vWaterWorld.xz * 2.3) - 0.5;
        float hSeed = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
        float phase = fract(uTime * 1.35 + hSeed);
        float distR = length(local);
        float ring = sin((distR - phase * 0.45) * 48.0) * exp(-abs(distR - phase * 0.45) * 18.0) * (1.0 - phase) * uRain;
        vec3 ripple = normalize(vec3(wA * 0.04 + wB * 0.025 + ring * 0.18, 1.0, wB * 0.04 - wA * 0.02 + ring * 0.18));
        normal = normalize(normal + vec3(ripple.x, 0.0, ripple.z));`,
      );
  };

  const mepWaterClean = new THREE.MeshStandardMaterial({ color: 0x3ea2f4, roughness: 0.35, transparent: true, opacity: 0.92, depthTest: false });
  const mepWaterWaste = new THREE.MeshStandardMaterial({ color: 0x33a88d, roughness: 0.35, transparent: true, opacity: 0.92, depthTest: false });
  const mepRainPipe = new THREE.MeshStandardMaterial({ color: 0x738699, roughness: 0.4, transparent: true, opacity: 0.92, depthTest: false });
  const mepElecLamp = new THREE.MeshStandardMaterial({ color: 0xf5c442, emissive: 0x5a4208, emissiveIntensity: 0.4, transparent: true, opacity: 0.95, depthTest: false });
  const mepElecOutlet = new THREE.MeshStandardMaterial({ color: 0xe65549, transparent: true, opacity: 0.95, depthTest: false });
  const mepElecAc = new THREE.MeshStandardMaterial({ color: 0xb768f0, transparent: true, opacity: 0.95, depthTest: false });

  const allMats: THREE.Material[] = [
    brickOuter,
    brickInner,
    mortar,
    concrete,
    concreteXray,
    rebar,
    steelWf,
    steelLight,
    woodTeak,
    woodDeck,
    plasterExt,
    plasterInt,
    tileFloor,
    tileWet,
    tileWood,
    carport,
    glass,
    aluDark,
    roofCover,
    lisplank,
    ceiling,
    grass,
    road,
    neighborWall,
    neighborRoof,
    floodWater,
    mepWaterClean,
    mepWaterWaste,
    mepRainPipe,
    mepElecLamp,
    mepElecOutlet,
    mepElecAc,
  ];

  // Layer 2 Baked AO: attach indirect-only vertex crease AO shader to structural/architectural materials
  for (const m of [
    brickOuter,
    brickInner,
    mortar,
    concrete,
    plasterExt,
    plasterInt,
    woodTeak,
    woodDeck,
    lisplank,
    ceiling,
  ]) {
    attachBakedAoShader(m);
  }

  // GR-03 + GR-07 + GR-04 hooks — uniform-gated, one program serves RT ON & OFF.
  // PCSS-Lite + aerial fog + specular AA on every opaque shadow receiver.
  for (const m of [
    brickOuter,
    brickInner,
    mortar,
    concrete,
    plasterExt,
    plasterInt,
    tileFloor,
    tileWet,
    tileWood,
    carport,
    woodTeak,
    woodDeck,
    roofCover,
    lisplank,
    ceiling,
    grass,
    road,
    neighborWall,
    neighborRoof,
  ]) {
    attachPcssShadow(m);
    attachAerialFog(m);
    attachSpecularAa(m);
  }
  // GR-02 BPCEM probes: glass & flood water read the exterior probe (sky, sun,
  // neighbours); interior furniture timber reads the interior room probe.
  attachBpceReflection(glass, exteriorProbeUniforms, "exterior");
  attachFresnelGlass(glass);
  attachBpceReflection(floodWater, exteriorProbeUniforms, "exterior");
  attachBpceReflection(woodTeak, interiorProbeUniforms, "interior");
  attachPcssShadow(floodWater);

  const envBoundMats: THREE.MeshStandardMaterial[] = [
    brickOuter,
    brickInner,
    mortar,
    concrete,
    concreteXray,
    rebar,
    steelWf,
    steelLight,
    aluDark,
    woodTeak,
    woodDeck,
    plasterExt,
    plasterInt,
    tileFloor,
    tileWet,
    tileWood,
    carport,
    glass,
    roofCover,
    lisplank,
    ceiling,
    grass,
    road,
    neighborWall,
    neighborRoof,
    floodWater,
  ];

  const customCache = new Map<string, THREE.MeshStandardMaterial>();
  const propCache = new Map<string, THREE.Material>();

  return {
    brickOuter,
    brickInner,
    mortar,
    concrete,
    concreteXray,
    rebar,
    steelWf,
    steelLight,
    woodTeak,
    woodDeck,
    plasterExt,
    plasterInt,
    tileFloor,
    tileWet,
    tileWood,
    carport,
    glass,
    aluDark,
    roofCover,
    lisplank,
    ceiling,
    grass,
    road,
    neighborWall,
    neighborRoof,
    floodWater,
    floodUniforms,
    mepWaterClean,
    mepWaterWaste,
    mepRainPipe,
    mepElecLamp,
    mepElecOutlet,
    mepElecAc,
    textures,
    setTileSize: (tileCm: number) => {
      const rep = 100 / Math.max(10, tileCm);
      tileCream.albedo.repeat.set(rep, rep);
      tileCream.rough.repeat.set(rep, rep);
      tileCream.normal.repeat.set(rep, rep);
    },
    setAnisotropy: (maxAniso: number) => {
      const capped = Math.max(1, Math.min(8, maxAniso));
      for (const t of textures) {
        t.anisotropy = capped;
        t.needsUpdate = true;
      }
    },
    bindEnvMap: (env: THREE.Texture | null) => {
      for (const m of envBoundMats) {
        m.envMap = env;
      }
      for (const m of customCache.values()) {
        m.envMap = env;
      }
    },
    getCachedMaterial: (hex: string, roughness: number) => {
      const key = `${hex.toLowerCase()}|${roughness.toFixed(2)}`;
      let mat = customCache.get(key);
      if (!mat) {
        mat = attachBakedAoShader(
          new THREE.MeshStandardMaterial({
            color: hex,
            roughness,
            envMapIntensity: 0.42,
            clippingPlanes: plasterInt.clippingPlanes,
          }),
        );
        customCache.set(key, mat);
      }
      return mat;
    },
    getPropMaterial: <T extends THREE.Material>(key: string, factory: () => T): T => {
      const existing = propCache.get(key);
      if (existing) return existing as T;
      const created = factory();
      propCache.set(key, created);
      return created;
    },
    dispose: () => {
      allMats.forEach((m) => m.dispose());
      customCache.forEach((m) => m.dispose());
      customCache.clear();
      propCache.forEach((m) => m.dispose());
      propCache.clear();
      textures.forEach((t) => t.dispose());
    },
  };
}
