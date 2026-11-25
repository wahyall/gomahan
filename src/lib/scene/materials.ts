import * as THREE from "three";

/**
 * Procedural PBR textures & materials guided by `3d-wood-material`,
 * `3d-metal-material`, `3d-cloth-material`, and `3d-high-resolution-textures`.
 */

function makeSeededCanvas(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (ctx) draw(ctx);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function createWoodTextures(baseHex: string, darkHex: string) {
  const albedo = makeSeededCanvas(256, 256, (ctx) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) {
      const y = (i / 160) * 256;
      const alpha = 0.06 + ((Math.sin(i * 1.7) + 1) * 0.5) * 0.14;
      ctx.strokeStyle = darkHex;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 256; x += 16) {
        const wave = Math.sin(x * 0.03 + i * 0.25) * 3.5;
        ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, true);

  const rough = makeSeededCanvas(256, 256, (ctx) => {
    ctx.fillStyle = "#888888";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#a4a4a4" : "#6c6c6c";
      ctx.fillRect(0, (i / 120) * 256, 256, 2);
    }
  }, false);

  return { albedo, rough };
}

export function createPlasterTexture(hex: string) {
  return makeSeededCanvas(256, 256, (ctx) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const x = (i * 73) % 256;
      const y = (i * 137) % 256;
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)";
      ctx.fillRect(x, y, 3, 3);
    }
  }, true);
}

export function createTileTexture(tileCm: number, baseHex: string, groutHex: string) {
  const tex = makeSeededCanvas(256, 256, (ctx) => {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);
    // subtle natural stone flecks
    for (let i = 0; i < 320; i++) {
      const x = (i * 97) % 256;
      const y = (i * 53) % 256;
      ctx.fillStyle = i % 3 === 0 ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = groutHex;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 252);
  }, true);
  const perM = 100 / tileCm;
  tex.repeat.set(perM, perM);
  return tex;
}

export function createStandingSeamBumpTexture() {
  return makeSeededCanvas(256, 256, (ctx) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, 0, 4, 256);
      ctx.fillStyle = "#606060";
      ctx.fillRect(x + 4, 0, 2, 256);
    }
  }, false);
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
    stops = ["#3d4652", "#515c69", "#697584", "#828f9d", "#95a1ad", "#7b8590"];
  } else if (isGolden) {
    stops = ["#2f4e78", "#5b799d", "#c78b6b", "#ebb67c", "#f3cfa0", "#e6c39b"];
  } else if (season === "hujan") {
    stops = ["#4f78a4", "#7299bf", "#9cb9d4", "#bed2e2", "#d8e3eb", "#c7d4dd"];
  } else {
    // Sunny Surabaya tropical sky
    stops = ["#2f6fb3", "#4e8ec8", "#7db6df", "#b2d6ed", "#dfeaf2", "#d0dce4"];
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

  envScene.background = new THREE.Color(isNight ? 0x0e1526 : isStorm ? 0x454f5b : 0x89a8c4);

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
    addCard(8, 8, [6, 10, 6], 0xfff3dc, isStorm ? 1.2 : 3.2);
    addCard(10, 5, [-8, 5, -4], 0x9ec8f2, isStorm ? 0.8 : 1.4);
    addCard(14, 14, [0, -6, 0], 0x8a7d68, 0.45);
  } else {
    addCard(6, 6, [0, 8, 0], 0x4a6b9e, 0.8);
    addCard(8, 5, [0, 2, 6], 0xffd59e, 0.65);
  }

  const rt = pmrem.fromScene(envScene, 0.04);
  envScene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();
  return rt.texture;
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
  floodWater: THREE.MeshPhysicalMaterial;
  mepWaterClean: THREE.MeshStandardMaterial;
  mepWaterWaste: THREE.MeshStandardMaterial;
  mepRainPipe: THREE.MeshStandardMaterial;
  mepElecLamp: THREE.MeshStandardMaterial;
  mepElecOutlet: THREE.MeshStandardMaterial;
  mepElecAc: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
  dispose: () => void;
}

export function createMaterialPalette(): MaterialPalette {
  const woodMain = createWoodTextures("#9c6b42", "#5d3b21");
  const woodDeckTex = createWoodTextures("#b28558", "#6f4a28");
  const plasterTex = createPlasterTexture("#f4f0e7");
  const tileCreamTex = createTileTexture(40, "#dfd9cd", "#b8b0a3");
  const tileGreyTex = createTileTexture(30, "#8f959c", "#676c72");
  const roofBump = createStandingSeamBumpTexture();

  const textures = [
    woodMain.albedo,
    woodMain.rough,
    woodDeckTex.albedo,
    woodDeckTex.rough,
    plasterTex,
    tileCreamTex,
    tileGreyTex,
    roofBump,
  ];

  const brickOuter = new THREE.MeshStandardMaterial({ color: 0xefede6, roughness: 0.9, metalness: 0.0 });
  const brickInner = new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.92, metalness: 0.0 });
  const mortar = new THREE.MeshStandardMaterial({ color: 0x999890, roughness: 0.95 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8f9295, roughness: 0.85, metalness: 0.04 });
  const rebar = new THREE.MeshStandardMaterial({ color: 0xd96b38, roughness: 0.45, metalness: 0.72, transparent: true, opacity: 0.94 });
  const steelWf = new THREE.MeshStandardMaterial({ color: 0x3b444d, roughness: 0.35, metalness: 0.85 });
  const steelLight = new THREE.MeshStandardMaterial({ color: 0xaab6c0, roughness: 0.32, metalness: 0.78 });

  const woodTeak = new THREE.MeshPhysicalMaterial({
    map: woodMain.albedo,
    roughnessMap: woodMain.rough,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.38,
  });

  const woodDeck = new THREE.MeshPhysicalMaterial({
    map: woodDeckTex.albedo,
    roughnessMap: woodDeckTex.rough,
    roughness: 0.65,
    metalness: 0,
    clearcoat: 0.08,
  });

  const plasterExt = new THREE.MeshStandardMaterial({
    map: plasterTex,
    color: 0xf2ece1,
    roughness: 0.72,
    metalness: 0,
  });
  const plasterInt = new THREE.MeshStandardMaterial({
    map: plasterTex,
    color: 0xf7f5ef,
    roughness: 0.68,
    metalness: 0,
  });

  const tileFloor = new THREE.MeshStandardMaterial({
    map: tileCreamTex,
    roughness: 0.32,
    metalness: 0.04,
  });
  const tileWet = new THREE.MeshStandardMaterial({
    map: tileGreyTex,
    roughness: 0.78,
    metalness: 0.02,
  });
  const tileWood = new THREE.MeshStandardMaterial({
    map: woodDeckTex.albedo,
    color: 0xd8c3a8,
    roughness: 0.46,
    metalness: 0.02,
  });
  const carport = new THREE.MeshStandardMaterial({
    color: 0x767a7d,
    roughness: 0.92,
    metalness: 0.02,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xd9eef5,
    transparent: true,
    opacity: 0.36,
    roughness: 0.08,
    metalness: 0.05,
    ior: 1.5,
    reflectivity: 0.8,
    depthWrite: false,
  });

  const aluDark = new THREE.MeshStandardMaterial({
    color: 0x2a2f35,
    roughness: 0.32,
    metalness: 0.82,
  });

  const roofCover = new THREE.MeshStandardMaterial({
    color: 0x363b40,
    bumpMap: roofBump,
    bumpScale: 0.03,
    roughness: 0.38,
    metalness: 0.68,
  });

  const lisplank = new THREE.MeshStandardMaterial({ color: 0xdfd3be, roughness: 0.72 });
  const ceiling = new THREE.MeshStandardMaterial({ color: 0xf5f4f0, roughness: 0.92 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x628b4d, roughness: 0.95 });
  const road = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.88 });
  const neighborWall = new THREE.MeshStandardMaterial({
    color: 0xc2bcb0,
    roughness: 0.88,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });

  const floodWater = new THREE.MeshPhysicalMaterial({
    color: 0x5c7c7a,
    transparent: true,
    opacity: 0.72,
    roughness: 0.14,
    metalness: 0.08,
    ior: 1.33,
    reflectivity: 0.75,
    depthWrite: false,
  });

  const mepWaterClean = new THREE.MeshStandardMaterial({ color: 0x3ea2f4, roughness: 0.35, transparent: true, opacity: 0.92, depthTest: false });
  const mepWaterWaste = new THREE.MeshStandardMaterial({ color: 0x33a88d, roughness: 0.35, transparent: true, opacity: 0.92, depthTest: false });
  const mepRainPipe = new THREE.MeshStandardMaterial({ color: 0x738699, roughness: 0.4, transparent: true, opacity: 0.92, depthTest: false });
  const mepElecLamp = new THREE.MeshStandardMaterial({ color: 0xf5c442, emissive: 0x5a4208, emissiveIntensity: 0.4, transparent: true, opacity: 0.95, depthTest: false });
  const mepElecOutlet = new THREE.MeshStandardMaterial({ color: 0xe65549, transparent: true, opacity: 0.95, depthTest: false });
  const mepElecAc = new THREE.MeshStandardMaterial({ color: 0xb768f0, transparent: true, opacity: 0.95, depthTest: false });

  const allMats = [
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
    floodWater,
    mepWaterClean,
    mepWaterWaste,
    mepRainPipe,
    mepElecLamp,
    mepElecOutlet,
    mepElecAc,
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
    floodWater,
    mepWaterClean,
    mepWaterWaste,
    mepRainPipe,
    mepElecLamp,
    mepElecOutlet,
    mepElecAc,
    textures,
    dispose: () => {
      allMats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
