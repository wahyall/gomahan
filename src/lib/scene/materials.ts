import * as THREE from "three";

/**
 * High-resolution procedural PBR textures & materials guided by:
 * - `3d-high-resolution-textures` (sRGB albedo vs NoColorSpace data maps, mipmaps, dynamic anisotropy)
 * - `3d-wood-material` (grain pores/rings, clearcoat/oil roughness modulation, low envMapIntensity to preserve shadows)
 * - `3d-metal-material` (conductor metalness 1.0, LinearSRGBColorSpace F0, brushed roughness, PMREM cards + explicit envMap)
 * - `3d-harbour-water` (animated capillary ripples & rain impact rings via onBeforeCompile with distinct cache key)
 */

function makeSeededCanvas(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  srgb = true,
): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (ctx) draw(ctx);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a linear tangent-space Normal Map (`NoColorSpace`) from a grayscale height canvas.
 */
function normalMapFromHeight(heightCanvas: HTMLCanvasElement, strength = 2.2): THREE.CanvasTexture {
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
  const tex = new THREE.CanvasTexture(outCv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function createWoodTextures(baseHex: string, darkHex: string) {
  const S = 512;
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

export function createPlasterTextures(hex: string) {
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

export function createTileTextures(tileCm: number, baseHex: string, groutHex: string) {
  const S = 512;
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
      ctx.fillStyle = "#484848"; // glossy/satin glazed tile center
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = "#e0e0e0"; // matte grout line
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
  hCtx.fillStyle = "#767676";
  hCtx.fillRect(0, 0, S, S);

  const albedo = makeSeededCanvas(
    S,
    S,
    (ctx) => {
      ctx.fillStyle = "#5c8647";
      ctx.fillRect(0, 0, S, S);
      // Sims 4 subtle mown bands
      ctx.fillStyle = "rgba(128, 175, 92, 0.14)";
      ctx.fillRect(0, 0, S * 0.5, S);
      for (let i = 0; i < 4200; i++) {
        const x = (i * 139) % S;
        const y = (i * 251) % S;
        const shade = i % 4 === 0 ? "#476a37" : i % 3 === 0 ? "#77a55b" : "#5e8b48";
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, 2, 4 + (i % 4));
        hCtx.fillStyle = i % 2 === 0 ? "#b0b0b0" : "#555555";
        hCtx.fillRect(x, y, 2, 4);
      }
    },
    true,
  );
  albedo.repeat.set(8, 8);
  const normal = normalMapFromHeight(heightCv, 2.0);
  normal.repeat.set(8, 8);
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
  const cv = document.createElement("canvas");
  cv.width = 8;
  cv.height = 512;
  const ctx = cv.getContext("2d")!;

  const isStorm = rainMmH > 20;
  const isNight = hourOfDay < 5.2 || hourOfDay > 18.8;
  const isGolden = (hourOfDay >= 5.2 && hourOfDay <= 7.5) || (hourOfDay >= 16.5 && hourOfDay <= 18.8);

  let stops: string[];
  if (isNight) {
    stops = ["#0a1020", "#111b32", "#1a2844", "#243554", "#273852", "#1e2a3f"];
  } else if (isStorm) {
    stops = ["#39424e", "#4b5764", "#647180", "#7f8c9b", "#929ea9", "#78828d"];
  } else if (isGolden) {
    stops = ["#2f4e78", "#5b799d", "#c78b6b", "#ebb67c", "#f3cfa0", "#e6c39b"];
  } else if (season === "hujan") {
    stops = ["#4f78a4", "#7299bf", "#9cb9d4", "#bed2e2", "#d8e3eb", "#c7d4dd"];
  } else {
    stops = ["#2b6cb0", "#4b8cc6", "#7cb6e0", "#b3d7ee", "#dfeaf2", "#cfdce4"];
  }

  const grd = ctx.createLinearGradient(0, 0, 0, 512);
  const pos = [0, 0.28, 0.5, 0.68, 0.85, 1];
  pos.forEach((p, i) => grd.addColorStop(p, stops[i]!));
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 8, 512);

  const tex = new THREE.CanvasTexture(cv);
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
    addCard(9, 7, [7, 11, 6], 0xfff3dc, isStorm ? 1.4 : 3.6);
    addCard(10, 5, [-8, 6, -5], 0xa4d0f7, isStorm ? 0.9 : 1.7);
    addCard(7, 4, [0, 5, -9], 0xffe4b8, isStorm ? 0.6 : 1.9);
    addCard(14, 14, [0, -6, 0], 0x7b6f5c, 0.35);
  } else {
    addCard(6, 6, [0, 8, 0], 0x3f5e8f, 0.9);
    addCard(8, 5, [0, 2, 7], 0xffd59e, 0.85);
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

export interface FloodWaterUniforms {
  uTime: { value: number };
  uRain: { value: number };
}

export interface MaterialPalette {
  brickOuter: THREE.MeshStandardMaterial;
  brickInner: THREE.MeshStandardMaterial;
  mortar: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
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
  dispose: () => void;
}

export function createMaterialPalette(): MaterialPalette {
  const woodMain = createWoodTextures("#9c6b42", "#58351c");
  const woodDeckTex = createWoodTextures("#b28558", "#6d4827");
  const plasterTex = createPlasterTextures("#f4f0e7");
  const tileCream = createTileTextures(40, "#dfd9cd", "#b4aba0");
  const tileGrey = createTileTextures(30, "#8f959c", "#63686f");
  const grassTex = createGrassTextures();
  const roadTex = createRoadTextures();
  const brushedRough = createMetalBrushedRoughness();
  const roofTex = createStandingSeamBumpTexture();

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
    roofTex.bump,
    roofTex.normal,
  ];

  const brickOuter = new THREE.MeshStandardMaterial({
    color: 0xefede6,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.3,
  });
  const brickInner = new THREE.MeshStandardMaterial({
    color: 0xe6e3da,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.28,
  });
  const mortar = new THREE.MeshStandardMaterial({ color: 0x999890, roughness: 0.95, envMapIntensity: 0.25 });
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x92969a,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.84,
    metalness: 0.02,
    envMapIntensity: 0.32,
  });
  const rebar = new THREE.MeshStandardMaterial({
    color: 0xd96b38,
    roughness: 0.42,
    metalness: 0.85,
    transparent: true,
    opacity: 0.94,
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
    normalScale: new THREE.Vector2(0.55, 0.55),
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
    normalScale: new THREE.Vector2(0.65, 0.65),
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
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: 0xf2ece1,
    roughness: 0.74,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  const plasterInt = new THREE.MeshStandardMaterial({
    map: plasterTex.albedo,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    color: 0xf7f5ef,
    roughness: 0.7,
    metalness: 0,
    envMapIntensity: 0.32,
  });

  const tileFloor = new THREE.MeshStandardMaterial({
    map: tileCream.albedo,
    roughnessMap: tileCream.rough,
    normalMap: tileCream.normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.42,
    metalness: 0.02,
    envMapIntensity: 0.65,
  });
  const tileWet = new THREE.MeshStandardMaterial({
    map: tileGrey.albedo,
    roughnessMap: tileGrey.rough,
    normalMap: tileGrey.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.78,
    metalness: 0.02,
    envMapIntensity: 0.42,
  });
  const tileWood = new THREE.MeshStandardMaterial({
    map: woodDeckTex.albedo,
    normalMap: woodDeckTex.normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
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
    opacity: 0.34,
    roughness: 0.05,
    metalness: 0.0,
    ior: 1.52,
    reflectivity: 0.92,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.35,
    depthWrite: false,
  });

  const roofCover = new THREE.MeshStandardMaterial({
    color: 0x3a4046,
    bumpMap: roofTex.bump,
    bumpScale: 0.035,
    normalMap: roofTex.normal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: brushedRough,
    roughness: 0.42,
    metalness: 0.82,
    envMapIntensity: 0.85,
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

  const neighborWall = new THREE.MeshStandardMaterial({
    color: 0xd4cec2,
    normalMap: plasterTex.normal,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.86,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    envMapIntensity: 0.25,
  });
  const neighborRoof = new THREE.MeshStandardMaterial({
    color: 0x7b5241,
    roughness: 0.78,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    envMapIntensity: 0.3,
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
    roughness: 0.09,
    metalness: 0.04,
    ior: 1.333,
    reflectivity: 0.9,
    clearcoat: 0.92,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.4,
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

  const envBoundMats: THREE.MeshStandardMaterial[] = [
    brickOuter,
    brickInner,
    mortar,
    concrete,
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
    floodWater,
  ];

  return {
    brickOuter,
    brickInner,
    mortar,
    concrete,
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
    },
    dispose: () => {
      allMats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
