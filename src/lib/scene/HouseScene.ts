import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { SelectionTarget, ViewState } from "@/lib/store/useStudioStore";
import {
  createEnvironmentMap,
  createMaterialPalette,
  createSkyGradientTexture,
  type MaterialPalette,
} from "@/lib/scene/materials";
import { buildFurnitureMesh, buildHvacMesh, buildLightFixtureMesh } from "@/lib/scene/propsBuilder";
import {
  StaticBatchCollector,
  createChamferBox,
  createContactShadowTexture,
  mergeGeometryBatch,
} from "@/lib/scene/geometryHelpers";

// Enable BVH accelerated raycasting on BufferGeometry
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
  computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree =
  disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type QualityTier = "high" | "medium" | "low";
export type WebGLStatus = "ok" | "lost" | "unsupported";

export interface SceneStatsSnapshot {
  fps: number;
  avgMs: number;
  tier: QualityTier;
  dpr: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface ExplodePiece {
  obj: THREE.Object3D;
  base: THREE.Vector3;
  off: THREE.Vector3;
}

interface ExplodeInstanced {
  im: THREE.InstancedMesh;
  n: number;
  pos: Float32Array;
  off: Float32Array;
  quat: Float32Array;
  scl: Float32Array;
}

export interface SceneCallbacks {
  onSelect: (sel: SelectionTarget) => void;
  onHover: (label: string | null, x: number, y: number) => void;
  onMoveEntity: (sel: NonNullable<SelectionTarget>, x: number, z: number) => void;
  onPlaceAt: (x: number, z: number, levelIndex: 0 | 1) => void;
  onWalkthroughExit?: () => void;
  onWebGLStatus?: (status: WebGLStatus) => void;
  onStats?: (stats: SceneStatsSnapshot) => void;
}

function attachBvh(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  (geo as unknown as { computeBoundsTree?: () => void }).computeBoundsTree?.();
  return geo;
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points || obj instanceof THREE.Sprite) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m?.dispose();
      } else if (mat) {
        if ("map" in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
        mat.dispose();
      }
    }
  });
}

export class HouseScene {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private cameraPersp!: THREE.PerspectiveCamera;
  private cameraOrtho!: THREE.OrthographicCamera;
  private useOrtho = false;
  private disposed = false;
  private webglReady = false;
  private isContextLost = false;
  private isHidden = false;
  private reducedMotion = false;
  private reducedMotionMq: MediaQueryList | null = null;

  private palette!: MaterialPalette;
  private skyMesh!: THREE.Mesh;
  private skyMat!: THREE.MeshBasicMaterial;
  private envTex: THREE.Texture | null = null;
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private lightningLight!: THREE.DirectionalLight;
  private gridHelper!: THREE.GridHelper;
  private contactShadowTex: THREE.CanvasTexture | null = null;
  private contactShadowMat!: THREE.MeshBasicMaterial;

  private houseRoot = new THREE.Group();
  private envGroup = new THREE.Group();
  private simGroup = new THREE.Group();
  private dimsGroup = new THREE.Group();
  private ghostGroup = new THREE.Group();

  private staticDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private dynResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private simResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private envKey = "";
  private lastBuildKey = "";
  private lastSimKey = "";

  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
  private explodePieces: ExplodePiece[] = [];
  private explodeInstanced: ExplodeInstanced[] = [];
  private explodeCurrent = 0;
  private explodeTarget = 0;

  // Picking & Dragging
  private raycaster = new THREE.Raycaster();
  private pickables: THREE.Object3D[] = [];
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private draggingEntity: NonNullable<SelectionTarget> | null = null;
  private dragOffset = new THREE.Vector3();
  private selectedTarget: SelectionTarget = null;
  private selectedRing!: THREE.Mesh;

  // Dynamic Animations
  private animatedFans: THREE.Object3D[] = [];
  private airParticlesMesh: THREE.InstancedMesh | null = null;
  private airParticleStates: { x: number; y: number; z: number; lv: 0 | 1; life: number }[] = [];
  private lastAirflow: AirflowSimulationResult | null = null;
  private rainPoints: THREE.Points | null = null;
  private rainArray: Float32Array | null = null;
  private rainBaseCount = 0;
  private rainActiveCount = 0;
  private lightningTimer = 0;
  private lightningEnergy = 0;
  private lastRainMmH = 0;

  // Orbit & Walkthrough Camera (current + smoothed targets)
  private target = new THREE.Vector3(2.5, 2.5, 8.5);
  private targetDesired = new THREE.Vector3(2.5, 2.5, 8.5);
  private sph = { radius: 19, theta: Math.PI * 0.82, phi: 1.05 };
  private sphDesired = { radius: 19, theta: Math.PI * 0.82, phi: 1.05 };
  private cameraDirty = true;

  private walkthroughActive = false;
  private walkPos = new THREE.Vector3(1.1, 2.15, 2.5);
  private walkYaw = 0;
  private walkPitch = 0;
  private keysPressed = new Set<string>();

  private pointers = new Map<number, { x: number; y: number }>();
  private downInfo: { x: number; y: number; button: number; time: number } | null = null;
  private panMode = false;
  private pinchDist = 0;
  private activeFloorElevation = 0.5;
  private activeLevelIdx: 0 | 1 = 0;
  private activeTool = "select";

  private callbacks: SceneCallbacks;
  private ro: ResizeObserver | null = null;
  private raf = 0;

  // Timing & Adaptive Quality Governor
  private lastFrameMs = performance.now();
  private simElapsedS = 0;
  private qualityOverride: QualityTier | "auto" = "auto";
  private activeTier: QualityTier = "high";
  private activeDpr = 1;
  private frameWindow: number[] = [];
  private lastStatsMs = 0;
  private lastHoverMs = 0;

  // Persistent per-frame scratch math objects (zero allocations in animate & handlers)
  private readonly _m4 = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _e = new THREE.Euler();
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _s1 = new THREE.Vector3(1, 1, 1);
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _col = new THREE.Color();
  private readonly _ndc = new THREE.Vector2();
  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _look = new THREE.Vector3();
  private readonly _hitPt = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    if (typeof window !== "undefined" && window.matchMedia) {
      this.reducedMotionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = this.reducedMotionMq.matches;
    }

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
    } catch {
      this.callbacks.onWebGLStatus?.("unsupported");
      return;
    }

    if (!this.renderer.getContext()) {
      this.renderer.dispose();
      this.callbacks.onWebGLStatus?.("unsupported");
      return;
    }

    this.webglReady = true;
    this.callbacks.onWebGLStatus?.("ok");

    // Pick conservative initial tier on mobile viewports (<768px) to avoid initial hitching
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      this.activeTier = "medium";
    }

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xcbd8e2, 0.006);

    this.cameraPersp = new THREE.PerspectiveCamera(46, 1, 0.12, 260);
    this.cameraOrtho = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.12, 260);

    this.palette = createMaterialPalette();
    this.palette.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.contactShadowTex = createContactShadowTexture();
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: this.contactShadowTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.staticDisposables.push(this.contactShadowTex, this.contactShadowMat);

    this.setupClippingMaterials();
    this.setupLightingAndSky();
    this.setupStaticEnvironment();
    this.setupRainSystem();

    this.scene.add(this.envGroup);
    this.scene.add(this.houseRoot);
    this.scene.add(this.simGroup);
    this.scene.add(this.dimsGroup);
    this.scene.add(this.ghostGroup);

    const ringGeo = new THREE.RingGeometry(0.42, 0.56, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.selectedRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectedRing.visible = false;
    this.selectedRing.renderOrder = 998;
    this.scene.add(this.selectedRing);
    this.staticDisposables.push(ringGeo, ringMat);

    this.applyQualityTier(this.activeTier);

    const observeTarget = canvas.parentElement ?? canvas;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(observeTarget);
    this.resize();
    this.bindEvents();
    this.updateCameraTransform();

    this.lastFrameMs = performance.now();
    this.animate();
  }

  setQualityOverride(tier: QualityTier | "auto") {
    this.qualityOverride = tier;
    if (tier !== "auto") {
      this.applyQualityTier(tier);
    }
  }

  private applyQualityTier(tier: QualityTier) {
    this.activeTier = tier;
    if (!this.webglReady) return;
    const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const maxDpr = tier === "high" ? 2 : tier === "medium" ? 1.5 : 1;
    const targetDpr = Math.min(rawDpr, maxDpr);
    if (Math.abs(targetDpr - this.activeDpr) > 0.05) {
      this.activeDpr = targetDpr;
      this.renderer.setPixelRatio(targetDpr);
    }

    if (this.sunLight) {
      const wantSize = tier === "high" ? 2048 : tier === "medium" ? 1024 : 512;
      if (this.sunLight.shadow.mapSize.x !== wantSize) {
        this.sunLight.shadow.mapSize.set(wantSize, wantSize);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
      this.renderer.shadowMap.enabled = tier !== "low";
    }

    this.syncRainDrawRange();
  }

  private syncRainDrawRange() {
    if (!this.rainPoints) return;
    const densityMult = this.activeTier === "high" ? 1 : this.activeTier === "medium" ? 0.65 : 0.35;
    this.rainActiveCount = Math.round(this.rainBaseCount * densityMult);
    this.rainPoints.geometry.setDrawRange(0, this.rainActiveCount);
  }

  private setupClippingMaterials() {
    const clippable = [
      this.palette.brickOuter,
      this.palette.brickInner,
      this.palette.mortar,
      this.palette.concrete,
      this.palette.rebar,
      this.palette.steelWf,
      this.palette.steelLight,
      this.palette.woodTeak,
      this.palette.woodDeck,
      this.palette.plasterExt,
      this.palette.plasterInt,
      this.palette.tileFloor,
      this.palette.tileWet,
      this.palette.tileWood,
      this.palette.carport,
      this.palette.glass,
      this.palette.aluDark,
      this.palette.roofCover,
      this.palette.lisplank,
      this.palette.ceiling,
    ];
    for (const m of clippable) m.clippingPlanes = [this.clipPlane];
  }

  private setupLightingAndSky() {
    this.hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x6f6859, 0.72);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.35);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    // Tight shadow frustum around 5x17m lot + adjacent eaves for 2.5x texel sharpness
    this.sunLight.shadow.camera.near = 1.5;
    this.sunLight.shadow.camera.far = 56;
    this.sunLight.shadow.camera.left = -10.5;
    this.sunLight.shadow.camera.right = 10.5;
    this.sunLight.shadow.camera.top = 14.5;
    this.sunLight.shadow.camera.bottom = -14.5;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.006;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.sunLight.target.position.set(2.5, 2.4, 8.5);

    this.lightningLight = new THREE.DirectionalLight(0xdce8ff, 0);
    this.lightningLight.position.set(-10, 24, -12);
    this.scene.add(this.lightningLight);

    const skyTex = createSkyGradientTexture(10, "kemarau", 0);
    this.skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 20), this.skyMat);
    this.scene.add(this.skyMesh);
  }

  private setupStaticEnvironment() {
    // Lush neighborhood ground plane
    const groundGeo = new THREE.PlaneGeometry(140, 140);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, this.palette.grass);
    ground.position.set(2.5, -0.055, 8.5);
    ground.receiveShadow = true;
    this.envGroup.add(ground);

    // Textured Asphalt residential street in front of house (Z = -6.8 .. -0.55)
    const roadGeo = new THREE.BoxGeometry(90, 0.06, 6.25);
    const road = new THREE.Mesh(roadGeo, this.palette.road);
    road.position.set(2.5, -0.04, -3.65);
    road.receiveShadow = true;
    this.envGroup.add(road);

    // Subtle road lane divider marks (static batched geometry)
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8d5c9, roughness: 0.85, metalness: 0.0 });
    const stripeGeos: THREE.BufferGeometry[] = [];
    for (let sx = -18; sx <= 22; sx += 3.2) {
      const g = new THREE.BoxGeometry(1.4, 0.008, 0.11);
      g.translate(sx, -0.006, -3.65);
      stripeGeos.push(g);
    }
    const mergedStripes = mergeGeometryBatch(stripeGeos);
    if (mergedStripes) {
      const m = new THREE.Mesh(mergedStripes, stripeMat);
      m.receiveShadow = true;
      this.envGroup.add(m);
    }

    // Surabaya concrete curb (kanstin) & recessed stormwater gutter (got beton) along Z = -0.30
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x7b8087, roughness: 0.88, metalness: 0.02 });
    const grateMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.55, metalness: 0.72 });
    const drainDarkMat = new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.95 });

    const gutterFrontWall = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 0.12), curbMat);
    gutterFrontWall.position.set(2.5, -0.015, -0.52);
    gutterFrontWall.receiveShadow = true;
    this.envGroup.add(gutterFrontWall);

    const gutterBackWall = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 0.12), curbMat);
    gutterBackWall.position.set(2.5, -0.015, -0.06);
    gutterBackWall.receiveShadow = true;
    this.envGroup.add(gutterBackWall);

    const gutterBed = new THREE.Mesh(new THREE.BoxGeometry(28, 0.02, 0.36), drainDarkMat);
    gutterBed.position.set(2.5, -0.045, -0.29);
    gutterBed.receiveShadow = true;
    this.envGroup.add(gutterBed);

    // Driveway bridge slab & slotted steel drain grates over front gutter (Carport entrance)
    const bridgeGeos: THREE.BufferGeometry[] = [];
    const bridge = createChamferBox(3.45, 0.075, 0.56, 0.012, 1);
    bridge.translate(3.25, 0.015, -0.29);
    bridgeGeos.push(bridge);
    const frontApron = new THREE.BoxGeometry(3.5, 0.04, 0.25);
    frontApron.translate(3.25, -0.01, -0.66);
    bridgeGeos.push(frontApron);
    const mergedBridge = mergeGeometryBatch(bridgeGeos);
    if (mergedBridge) {
      const m = new THREE.Mesh(mergedBridge, curbMat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.envGroup.add(m);
    }

    const grateGeos: THREE.BufferGeometry[] = [];
    for (let gx = 0.05; gx <= 1.45; gx += 0.14) {
      const bar = new THREE.BoxGeometry(0.035, 0.02, 0.34);
      bar.translate(gx, 0.022, -0.29);
      grateGeos.push(bar);
    }
    const mergedGrate = mergeGeometryBatch(grateGeos);
    if (mergedGrate) {
      const gm = new THREE.Mesh(mergedGrate, grateMat);
      gm.receiveShadow = true;
      this.envGroup.add(gm);
    }

    // Studio grid
    this.gridHelper = new THREE.GridHelper(30, 30, 0x94a3b8, 0x475569);
    this.gridHelper.position.set(2.5, 0.004, 8.5);
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.25;
    this.envGroup.add(this.gridHelper);

    // Contact shadow material shared for environment planters/trees
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.contactShadowTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.staticDisposables.push(shadowMat);

    // Articulated Surabaya 2-storey neighbor townhomes (left X < 0, right X > 5)
    const addNeighborHouse = (cx: number, labelSide: string) => {
      const grp = new THREE.Group();
      grp.name = `neighbor-${labelSide}`;

      // Main 2-storey mass + front stepped parapet & porch canopy + window recesses
      const wallGeos: THREE.BufferGeometry[] = [];
      const body = createChamferBox(4.92, 6.95, 13.0, 0.03, 1);
      body.translate(cx, 3.48, 10.5);
      wallGeos.push(body);

      const canopy = createChamferBox(4.8, 0.14, 1.45, 0.015, 1);
      canopy.translate(cx, 3.55, 3.35);
      wallGeos.push(canopy);

      const fence = createChamferBox(4.85, 0.95, 0.16, 0.015, 1);
      fence.translate(cx, 0.48, 0.12);
      wallGeos.push(fence);

      const mergedWall = mergeGeometryBatch(wallGeos);
      if (mergedWall) {
        const wm = new THREE.Mesh(mergedWall, this.palette.neighborWall);
        wm.castShadow = true;
        wm.receiveShadow = true;
        grp.add(wm);
      }

      // Sloped terracotta-toned roof + overhanging eave fascia
      const nRoof = createChamferBox(4.96, 0.24, 13.8, 0.025, 1);
      nRoof.rotateX(-0.14);
      nRoof.translate(cx, 7.62, 10.5);
      const rm = new THREE.Mesh(nRoof, this.palette.neighborRoof);
      rm.castShadow = true;
      rm.receiveShadow = true;
      grp.add(rm);

      // Subtle window frame accents on front facade for realistic neighborhood scale
      const winMat = new THREE.MeshStandardMaterial({ color: 0x3b444f, roughness: 0.45, metalness: 0.35 });
      const winGeos: THREE.BufferGeometry[] = [];
      for (const [wy, wz] of [
        [2.05, 3.98],
        [5.25, 3.98],
      ] as [number, number][]) {
        const wFrame = createChamferBox(1.5, 1.55, 0.08, 0.01, 1);
        wFrame.translate(cx + (labelSide === "left" ? -0.4 : 0.4), wy, wz);
        winGeos.push(wFrame);
      }
      const mergedWin = mergeGeometryBatch(winGeos);
      if (mergedWin) grp.add(new THREE.Mesh(mergedWin, winMat));

      // Multi-part Tropical Street Trees on street verge
      const treeZ = -0.82;
      const treeX = cx + (labelSide === "left" ? 1.15 : -1.15);
      const trunkGeo = new THREE.CylinderGeometry(0.085, 0.14, 2.55, 8);
      trunkGeo.translate(treeX, 1.25, treeZ);
      const trunk = new THREE.Mesh(trunkGeo, this.palette.woodTeak);
      trunk.castShadow = true;
      grp.add(trunk);

      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x528044, roughness: 0.86, envMapIntensity: 0.25 });
      const crownGeos: THREE.BufferGeometry[] = [];
      for (const [ox, oy, oz, rad] of [
        [0, 2.85, 0, 0.88],
        [-0.45, 2.58, 0.25, 0.66],
        [0.44, 2.62, -0.22, 0.64],
        [0.05, 3.28, 0.08, 0.56],
      ] as [number, number, number, number][]) {
        const c = new THREE.IcosahedronGeometry(rad, 1);
        c.scale(1.05, 0.82, 1.05);
        c.translate(treeX + ox, oy, treeZ + oz);
        crownGeos.push(c);
      }
      const mergedCrown = mergeGeometryBatch(crownGeos);
      if (mergedCrown) {
        const cm = new THREE.Mesh(mergedCrown, foliageMat);
        cm.castShadow = true;
        cm.receiveShadow = true;
        grp.add(cm);
      }

      // Ground contact shadow under street tree
      const discGeo = new THREE.PlaneGeometry(2.3, 2.3);
      discGeo.rotateX(-Math.PI / 2);
      const disc = new THREE.Mesh(discGeo, shadowMat);
      disc.position.set(treeX, 0.008, treeZ);
      grp.add(disc);

      this.envGroup.add(grp);
    };
    addNeighborHouse(-2.58, "left");
    addNeighborHouse(7.58, "right");
  }

  private setupRainSystem() {
    const count = 2400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18 + 2.5;
      pos[i * 3 + 1] = Math.random() * 14;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 26 + 8.5;
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.Float32BufferAttribute(pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    this.rainArray = attr.array as Float32Array;
    const mat = new THREE.PointsMaterial({
      color: 0xcbe4f5,
      size: 0.1,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  setCameraPreset(preset: ViewState["cameraPreset"]) {
    if (!this.webglReady) return;
    this.walkthroughActive = preset === "walkthrough";
    if (this.walkthroughActive) {
      this.walkPos.set(1.1, this.activeFloorElevation + 1.65, 2.0);
      this.walkYaw = 0;
      this.walkPitch = -0.04;
      this.cameraDirty = true;
      this.updateCameraTransform();
      return;
    }

    this.targetDesired.set(2.5, 2.75, 8.5);
    switch (preset) {
      case "front":
        this.sphDesired = { radius: 18, theta: Math.PI, phi: 1.38 };
        break;
      case "back":
        this.sphDesired = { radius: 18, theta: 0, phi: 1.38 };
        break;
      case "side":
        this.sphDesired = { radius: 22, theta: Math.PI * 0.5, phi: 1.32 };
        break;
      case "top":
        this.sphDesired = { radius: 24, theta: Math.PI, phi: 0.08 };
        break;
      default:
        this.sphDesired = { radius: 19, theta: Math.PI * 0.82, phi: 1.05 };
        break;
    }
    if (this.reducedMotion) {
      this.target.copy(this.targetDesired);
      this.sph = { ...this.sphDesired };
      this.updateCameraTransform();
    } else {
      this.cameraDirty = true;
    }
  }

  update(
    derived: DerivedProjectModel,
    struct: StructuralReport,
    lighting: LightingSimulationResult,
    airflow: AirflowSimulationResult,
    flood: FloodSimulationResult,
    view: ViewState,
    selected: SelectionTarget,
    activeLevelIdx: 0 | 1,
    activeTool: string,
  ) {
    if (!this.webglReady || this.disposed) return;

    this.activeFloorElevation = derived.project.site.peil.floor1PeilM;
    this.activeLevelIdx = activeLevelIdx;
    this.activeTool = activeTool;
    this.selectedTarget = selected;
    this.useOrtho = view.ortho;
    this.explodeTarget = view.explode;
    this.gridHelper.visible = view.showGrid;
    this.lastAirflow = airflow;

    // Neighbor visibility
    for (const ch of this.envGroup.children) {
      if (ch.name.startsWith("neighbor-")) ch.visible = view.showNeighbors;
    }

    // Update palette colors & tile scaling
    const sim = derived.project.simulation;
    this.palette.plasterExt.color.set(sim.paintExtHex);
    this.palette.plasterInt.color.set(sim.paintIntHex);
    this.palette.roofCover.color.set(sim.roofColorHex);
    this.palette.setTileSize(derived.project.systems.tileSizeCm);
    this.lastRainMmH = sim.rainIntensityMmH;

    // Update sky, sun, PMREM only when lighting/weather params change
    const nextEnvKey = `${sim.hourOfDay.toFixed(2)}|${sim.season}|${Math.round(sim.rainIntensityMmH / 5)}`;
    if (nextEnvKey !== this.envKey) {
      this.envKey = nextEnvKey;
      const newSky = createSkyGradientTexture(sim.hourOfDay, sim.season, sim.rainIntensityMmH);
      this.skyMat.map?.dispose();
      this.skyMat.map = newSky;
      this.skyMat.needsUpdate = true;

      const env = createEnvironmentMap(this.renderer, sim.hourOfDay, sim.rainIntensityMmH);
      this.envTex?.dispose();
      this.envTex = env;
      this.scene.environment = env;
      this.scene.environmentIntensity = sim.hourOfDay < 5.5 || sim.hourOfDay > 18.5 ? 0.35 : 0.72;
      this.palette.bindEnvMap(env);

      const [sx, sy, sz] = lighting.solar.sunDir;
      this.sunLight.position.set(2.5 + sx * 24, Math.max(2.5, sy * 24), 8.5 + sz * 24);
      const isNight = !lighting.solar.isDaylight;
      const isStorm = sim.rainIntensityMmH > 20;
      this.sunLight.intensity = isNight ? 0.16 : isStorm ? 0.85 : 2.35;
      this.sunLight.color.set(
        isNight ? 0x6c88b8 : sim.hourOfDay < 7.5 || sim.hourOfDay > 16.5 ? 0xffcb8c : 0xfff5e0,
      );
      this.hemiLight.intensity = isNight ? 0.28 : isStorm ? 0.55 : 0.76;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set(isNight ? 0x0e1628 : isStorm ? 0x6f7c89 : 0xd2e1ec);
        this.scene.fog.density = isStorm ? 0.013 : 0.0055;
      }
    }

    // Rain state
    if (this.rainPoints) {
      this.rainPoints.visible = view.showRain && sim.rainIntensityMmH > 0;
      const density = Math.min(1, sim.rainIntensityMmH / 120);
      this.rainBaseCount = Math.round(2400 * density);
      this.syncRainDrawRange();
    }

    // Cutaway plane
    const cutVal = view.activeLevelView === "lt1" ? this.activeFloorElevation + 3.45 : view.cutH;
    this.clipPlane.constant = cutVal;

    // Rebuild house geometry when structural/architectural/view-layer state changes
    const buildKey = JSON.stringify({
      u: derived.project.updatedAt,
      sys: derived.project.systems,
      peil: derived.project.site.peil,
      fm: derived.project.floodMitigation,
      lvWalls: derived.project.levels.map((l) => [l.walls, l.furniture, l.hvac, l.lights, l.stairs]),
      stage: view.stage,
      bricks: view.showBricks,
      struct: view.showStructure,
      roof: view.showRoof,
      rangka: view.showRangka,
      fin: view.showFinishing,
      rebar: view.xrayRebar,
      air: view.showAir,
      listrik: view.showListrik,
      labels: view.showLabels,
      dims: view.showDims,
      lvView: view.activeLevelView,
      hidden: view.hiddenParts,
    });

    if (buildKey !== this.lastBuildKey) {
      this.lastBuildKey = buildKey;
      this.rebuildHouse(derived, struct, view);
    }

    // Rebuild simulation overlays only when simulation state actually changes (prevents churn!)
    const simKey = JSON.stringify({
      u: derived.project.updatedAt,
      lux: view.showLuxHeatmap,
      airP: view.showAirParticles,
      fldW: view.showFloodWater,
      lvV: view.activeLevelView,
      stFld: flood.streetFloodCm,
      cpFld: flood.carportFloodCm,
      inFld: flood.lt1FloorFloodCm,
      bar: derived.project.floodMitigation.doorFloodBarrier,
      barH: derived.project.floodMitigation.barrierHeightCm,
      hr: Math.round(sim.hourOfDay * 4),
      rn: Math.round(sim.rainIntensityMmH),
    });
    if (simKey !== this.lastSimKey) {
      this.lastSimKey = simKey;
      this.rebuildSimOverlays(derived, lighting, flood, view);
    }

    this.updateSelectionRing(derived, selected);
    this.applyWireframe(view.wireframe);
  }

  private clearDyn() {
    this.houseRoot.clear();
    this.dimsGroup.clear();
    this.pickables = [];
    this.explodePieces = [];
    this.explodeInstanced = [];
    this.animatedFans = [];
    for (const r of this.dynResources) r.dispose();
    this.dynResources = [];
  }

  private clearSim() {
    this.simGroup.clear();
    this.airParticlesMesh = null;
    for (const r of this.simResources) r.dispose();
    this.simResources = [];
  }

  private tagPickable(obj: THREE.Object3D, sel: NonNullable<SelectionTarget>, label: string) {
    obj.userData.sel = sel;
    obj.userData.label = label;
    this.pickables.push(obj);
  }

  /**
   * Builds a sloped ExtrudeGeometry roof slab in world coordinates over [x0..x1, z0..z1],
   * automatically subtracting the Rear Open Void [1.70..maxX, 15.35..maxZ] and optional
   * Skylight holes, then lifting vertices to match roof.heightAt(x, z).
   */
  private buildCutoutRoofGeometry(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    voidCut: { x0: number; x1: number; z0: number; z1: number } | null,
    skylightHole: [number, number, number, number] | null,
    heightAt: (x: number, z: number) => number,
    thickness = 0.085,
  ): THREE.BufferGeometry | null {
    const minW = x1 - x0;
    const minD = z1 - z0;
    if (minW < 0.08 || minD < 0.08) return null;

    // Determine polygon vertices clockwise in XZ -> (x, -z) in 2D shape coordinates
    const pts: [number, number][] = [];
    const voidHitsX =
      voidCut && voidCut.x1 > x0 + 0.04 && voidCut.x0 < x1 - 0.04 && voidCut.z0 < z1 - 0.04 && voidCut.z1 > z0 + 0.04;

    let effectiveZ1 = z1;
    if (voidHitsX && voidCut) {
      const vx0 = Math.max(x0, voidCut.x0);
      const vx1 = Math.min(x1, voidCut.x1);
      const vz0 = Math.max(z0, voidCut.z0);
      if (vx0 <= x0 + 0.04 && vx1 >= x1 - 0.04) {
        // Void cuts across entire width of this roof strip -> stop roof before void
        effectiveZ1 = vz0;
        if (effectiveZ1 - z0 < 0.08) return null;
        pts.push([x0, z0], [x1, z0], [x1, effectiveZ1], [x0, effectiveZ1]);
      } else if (vx1 >= x1 - 0.04) {
        // Void notches back-right corner (standard Rear Taman Belakang right side X: 1.70..5.00)
        pts.push([x0, z0], [x1, z0], [x1, vz0], [vx0, vz0], [vx0, z1], [x0, z1]);
      } else if (vx0 <= x0 + 0.04) {
        pts.push([x0, z0], [x1, z0], [x1, z1], [vx1, z1], [vx1, vz0], [x0, vz0]);
      } else {
        pts.push([x0, z0], [x1, z0], [x1, z1], [x0, z1]);
      }
    } else {
      pts.push([x0, z0], [x1, z0], [x1, z1], [x0, z1]);
    }

    const shape = new THREE.Shape();
    pts.forEach(([px, pz], idx) => {
      if (idx === 0) shape.moveTo(px, -pz);
      else shape.lineTo(px, -pz);
    });
    shape.closePath();

    if (skylightHole) {
      const [hx0, hz0, hx1, hz1] = skylightHole;
      if (hx0 >= x0 + 0.05 && hx1 <= x1 - 0.05 && hz0 >= z0 + 0.05 && hz1 <= effectiveZ1 - 0.05) {
        const hole = new THREE.Path();
        hole.moveTo(hx0, -hz0);
        hole.lineTo(hx1, -hz0);
        hole.lineTo(hx1, -hz1);
        hole.lineTo(hx0, -hz1);
        hole.closePath();
        shape.holes.push(hole);
      }
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      pos.setY(i, vy + heightAt(vx, vz));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return attachBvh(geo);
  }

  private rebuildHouse(derived: DerivedProjectModel, struct: StructuralReport, view: ViewState) {
    this.clearDyn();

    const { project, masonry, roof } = derived;
    const peil = project.site.peil;
    const lt1Y = peil.floor1PeilM;
    const lt2Y = lt1Y + project.levels[0]!.height;
    const stage = view.stage;
    const hidden = new Set(view.hiddenParts);

    // Stage visibility logic (stage 0 = full house; stage 1..10 = construction sequence)
    const showFnd = !hidden.has("pondasi") && (stage === 0 || stage >= 2);
    const showSloofCol = !hidden.has("kolom") && view.showStructure && (stage === 0 || stage >= 3);
    const showLt2Slab = !hidden.has("pelat") && view.showStructure && (stage === 0 || stage >= 4);
    const showBricks = !hidden.has("dinding") && view.showBricks && (stage === 0 || stage >= 5);
    const showOpenings = !hidden.has("pintu") && (stage === 0 || stage >= 5);
    const showTruss = !hidden.has("rangka") && view.showRangka && (stage === 0 || stage >= 6);
    const showRoofCover = !hidden.has("genteng") && view.showRoof && (stage === 0 || stage >= 6);
    const showMep = view.showAir || view.showListrik || stage === 7;
    const showPlasterPaint = !hidden.has("cat") && view.showFinishing && (stage === 0 || stage >= 8);
    const showTileFloor = !hidden.has("lantai") && (stage === 0 || stage >= 8);
    const showProps = stage === 0 || stage >= 9;

    const batch = new StaticBatchCollector();

    // 1. Raised Peil Plinth & Carport / Terrace concrete beds
    if (stage === 0 || stage >= 1) {
      // Front Taman Depan soil bed
      batch.addBox("site:grass", this.palette.grass, "lantai", "Taman Depan", 0.75, 0.04, 1.5, 1.5, 0.08, 3.0);
      // Carport pad at carportPeilM (chamfered curb edge)
      const cpH = Math.max(0.08, peil.carportPeilM);
      batch.addGeo(
        "site:carport",
        this.palette.carport,
        "lantai",
        "Carport",
        createChamferBox(3.5, cpH, 4.5, 0.014, 1),
        3.25,
        cpH * 0.5,
        2.25,
      );
      // Terrace deck at terracePeilM
      const trH = Math.max(0.12, peil.terracePeilM);
      batch.addGeo(
        "site:teras",
        this.palette.woodDeck,
        "lantai",
        "Teras Depan",
        createChamferBox(2.25, trH, 1.0, 0.012, 1),
        1.125,
        trH * 0.5,
        3.5,
      );
      if (lt1Y > trH + 0.03) {
        batch.addGeo(
          "site:entry-step",
          this.palette.tileFloor,
          "lantai",
          "Tangga Masuk Teras",
          createChamferBox(1.12, lt1Y - trH, 0.34, 0.01, 1),
          1.58,
          (lt1Y + trH) * 0.25,
          3.85,
        );
      }
      // Earthfill plinth under main LT1 building (X: 0..5, Z: 4..17)
      batch.addBox(
        "fnd:plinth",
        this.palette.concrete,
        "pondasi",
        "Urugan Peil Lantai",
        2.5,
        lt1Y * 0.5 - 0.05,
        10.5,
        4.96,
        Math.max(0.1, lt1Y - 0.08),
        13.0,
      );
    }

    // 2. Foundations (Footplates, Strauss Piles, Cakar Ayam, Sumur Resapan) — batched into 2 meshes!
    if (showFnd) {
      for (const f of struct.foundations) {
        const fw = project.systems.foundation === "footplate_full" ? 1.2 : 1.0;
        batch.addGeo(
          "fnd:all",
          this.palette.concrete,
          "pondasi",
          `Pondasi (${project.systems.foundation})`,
          createChamferBox(fw, 0.32, fw, 0.015, 1),
          f.x,
          -0.65,
          f.z,
          0,
          [0, -1.4, 0],
        );
        batch.addBox(
          "fnd:all",
          this.palette.concrete,
          "pondasi",
          `Pondasi (${project.systems.foundation})`,
          f.x,
          (lt1Y - 0.65) * 0.5 - 0.1,
          f.z,
          0.26,
          lt1Y + 0.45,
          0.26,
          { explodeOff: [0, -1.4, 0] },
        );
        if (project.systems.foundation === "strauss_pile") {
          const pileGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.4, 10);
          batch.addGeo(
            "fnd:all",
            this.palette.concrete,
            "pondasi",
            "Pondasi Strauss Pile",
            pileGeo,
            f.x,
            -1.9,
            f.z,
            0,
            [0, -1.4, 0],
          );
        }
      }
      // Sumur Resapan SNI 03-2453 in front garden
      for (let i = 0; i < project.floodMitigation.infiltrationWells; i++) {
        const wellGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.5, 14);
        batch.addGeo(
          "fnd:resapan",
          this.palette.concrete,
          "sumurResapan",
          "Sumur Resapan SNI 03-2453",
          wellGeo,
          0.75,
          -0.7,
          1.2 + i * 1.1,
          0,
          [0, -1.2, 0],
        );
      }
    }

    // 3. Structural Frame (Sloof, Columns, Main Beams, Ring Balk) — batched per member role!
    if (showSloofCol) {
      const colMat = project.systems.frame === "steel_wf" ? this.palette.steelWf : this.palette.concrete;
      const maxColLevel = view.activeLevelView === "lt1" ? 1 : 2;
      const colTop = maxColLevel === 1 ? lt2Y : lt2Y + project.levels[1]!.height;
      const colH = colTop - lt1Y + 0.25;

      for (const col of struct.columns) {
        const isCanopy = col.z < 1.0;
        const h = isCanopy ? Math.max(2.2, lt2Y - 0.38 - (4.45 - col.z) * 0.055 - (lt1Y - 0.15)) : colH;
        batch.addGeo(
          "struct:col",
          colMat,
          "kolom",
          `Kolom Utama (${struct.columns.length} titik)`,
          createChamferBox(col.widthM, h, col.depthM, 0.008, 1),
          col.x,
          lt1Y - 0.15 + h * 0.5,
          col.z,
          0,
          [0, 0.45, 0],
        );

        if (view.xrayRebar && col.isMain) {
          batch.addBox(
            "struct:rebar",
            this.palette.rebar,
            "kolom",
            `Tulangan Kolom (${col.rebarSpec})`,
            col.x,
            lt1Y - 0.15 + h * 0.5,
            col.z,
            col.widthM * 0.68,
            h + 0.1,
            col.depthM * 0.68,
            { explodeOff: [0, 0.45, 0] },
          );
        }
      }

      for (const bm of struct.beams) {
        if (bm.levelIndex === 1 && view.activeLevelView === "lt1") continue;
        if (bm.levelIndex === 2 && view.activeLevelView === "lt1") continue;
        const y = bm.levelIndex === 0 ? lt1Y - 0.15 : bm.levelIndex === 1 ? lt2Y - 0.17 : lt2Y + 3.5;
        const cx = (bm.start.x + bm.end.x) * 0.5;
        const cz = (bm.start.z + bm.end.z) * 0.5;
        const ang = -Math.atan2(bm.end.z - bm.start.z, bm.end.x - bm.start.x);
        const partId = bm.kind === "sloof" ? "sloof" : bm.kind === "ring_balk" ? "ringbalk" : "balok";
        const expY = bm.kind === "sloof" ? -0.45 : bm.kind === "ring_balk" ? 2.35 : 1.35;

        batch.addBox(
          `struct:${partId}`,
          colMat,
          partId,
          bm.kind.toUpperCase(),
          cx,
          y,
          cz,
          bm.lengthM,
          bm.heightM,
          bm.widthM,
          { rotY: ang, explodeOff: [0, expY, 0] },
        );
      }
    }

    // 4. Floor Slabs (LT2) & Room Tile Floors (LT1) — batched by material!
    if (showLt2Slab && view.activeLevelView !== "lt1") {
      for (const slab of project.levels[1]!.slabs) {
        if (slab.isVoid) continue;
        const shape = new THREE.Shape();
        slab.polygon.forEach((p, i) => {
          if (i === 0) shape.moveTo(p.x, -p.z);
          else shape.lineTo(p.x, -p.z);
        });
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: slab.thickness, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const matKey = slab.isOverhang ? "woodDeck" : showTileFloor ? "tileFloor" : "concrete";
        const mat = slab.isOverhang ? this.palette.woodDeck : showTileFloor ? this.palette.tileFloor : this.palette.concrete;
        batch.addGeo(`slab:${matKey}`, mat, "pelat", slab.name, geo, 0, lt2Y - slab.thickness, 0, 0, [0, 1.5, 0]);
      }
    }

    if (showTileFloor) {
      // Lush rear courtyard lawn (Taman Belakang X: 1.72..4.92, Z: 15.38..16.92) + teak garden pavers
      batch.addBox("site:grass", this.palette.grass, "lantai", "Taman Belakang", 3.32, lt1Y - 0.015, 16.15, 3.16, 0.04, 1.52);
      for (const px of [2.15, 2.75, 3.35, 3.95]) {
        batch.addGeo(
          "floor1:woodDeck",
          this.palette.woodDeck,
          "lantai",
          "Pijakan Taman Belakang",
          createChamferBox(0.46, 0.03, 0.42, 0.008, 1),
          px,
          lt1Y + 0.01,
          15.85,
        );
      }
      for (const rm of derived.floors[0]!.rooms) {
        if (rm.room.program === "garden" || rm.room.program === "carport" || rm.room.program === "void") continue;
        const shape = new THREE.Shape();
        rm.room.polygon.forEach((p, i) => {
          if (i === 0) shape.moveTo(p.x, -p.z);
          else shape.lineTo(p.x, -p.z);
        });
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const matKey = rm.isWetRoom
          ? "tileWet"
          : rm.room.floorMaterialId === "wood_deck"
            ? "woodDeck"
            : rm.room.floorMaterialId === "tile_wood_warm"
              ? "tileWood"
              : "tileFloor";
        const mat =
          matKey === "tileWet"
            ? this.palette.tileWet
            : matKey === "woodDeck"
              ? this.palette.woodDeck
              : matKey === "tileWood"
                ? this.palette.tileWood
                : this.palette.tileFloor;
        const yOff = rm.room.program === "circulation" ? peil.terracePeilM + 0.005 : lt1Y - 0.025;
        batch.addGeo(`floor1:${matKey}`, mat, "lantai", "Lantai Keramik LT1", geo, 0, yOff, 0, 0, undefined, false, true);
      }
    }

    // 5. Staircase (20 beveled treads + carriage stringers) + Railings (batched!)
    for (const st of project.levels[0]!.stairs) {
      const dx = st.end.x - st.start.x;
      const dz = st.end.z - st.start.z;
      const len = Math.hypot(dx, dz);
      const stepRun = len / st.riserCount;
      const stepRise = st.floorHeight / st.riserCount;
      const ang = -Math.atan2(dz, dx);
      for (let i = 0; i < st.riserCount; i++) {
        const t = (i + 0.5) / st.riserCount;
        const sx = st.start.x + dx * t;
        const sz = st.start.z + dz * t;
        const sy = lt1Y + (i + 0.5) * stepRise;
        // Chamfered teak stair tread + structural steel riser block
        batch.addGeo(
          "stair:tread",
          this.palette.woodTeak,
          "tangga",
          st.name,
          createChamferBox(stepRun + 0.035, 0.042, st.width, 0.008, 2),
          sx,
          sy + stepRise * 0.36,
          sz,
          ang,
        );
        batch.addBox(
          "stair:carriage",
          this.palette.concrete,
          "tangga",
          st.name,
          sx,
          sy - stepRise * 0.08,
          sz,
          stepRun + 0.02,
          stepRise * 0.72,
          st.width * 0.92,
          { rotY: ang },
        );
      }
    }
    if (view.activeLevelView !== "lt1") {
      // Stair railing + Balcony glass & dark-aluminum chamfered rails + stanchion posts
      batch.addBox("rail:glass-stair", this.palette.glass, "tangga", "Railing Tangga", 1.35, lt2Y + 0.5, 10.0, 0.035, 0.98, 4.9);
      batch.addGeo(
        "rail:alu",
        this.palette.aluDark,
        "tangga",
        "Handrail Tangga & Balkon",
        createChamferBox(0.06, 0.045, 4.95, 0.008, 1),
        1.35,
        lt2Y + 1.0,
        10.0,
      );
      for (let pz = 7.6; pz <= 12.45; pz += 1.2) {
        batch.addBox("rail:alu", this.palette.aluDark, "tangga", "Handrail Tangga & Balkon", 1.35, lt2Y + 0.5, pz, 0.04, 1.0, 0.04);
      }
      batch.addBox("rail:glass-balc", this.palette.glass, "pelat", "Railing Balkon", 1.25, lt2Y + 0.5, 3.04, 2.45, 0.98, 0.035);
      batch.addGeo(
        "rail:alu",
        this.palette.aluDark,
        "pelat",
        "Handrail Balkon",
        createChamferBox(2.5, 0.045, 0.06, 0.008, 1),
        1.25,
        lt2Y + 1.0,
        3.04,
      );
      for (const px of [0.06, 0.85, 1.65, 2.44]) {
        batch.addBox("rail:alu", this.palette.aluDark, "pelat", "Handrail Balkon", px, lt2Y + 0.5, 3.04, 0.04, 1.0, 0.04);
      }
    }

    // 6. Brick-by-Brick Masonry InstancedMesh (supports custom dimensions L x H x T!)
    if (showBricks && masonry.bricks.length > 0) {
      const unitGeo = attachBvh(new THREE.BoxGeometry(1, 1, 1));
      this.dynResources.push(unitGeo);
      const visibleBricks =
        view.activeLevelView === "lt1"
          ? masonry.bricks.filter((b) => b.levelIndex === 0)
          : masonry.bricks;

      const outerB = visibleBricks.filter((b) => b.outer);
      const innerB = visibleBricks.filter((b) => !b.outer);

      const buildBrickIM = (list: typeof visibleBricks, mat: THREE.Material, label: string) => {
        if (list.length === 0) return;
        const im = new THREE.InstancedMesh(unitGeo, mat, list.length);
        im.castShadow = true;
        im.receiveShadow = true;
        const off = new Float32Array(list.length * 3);

        for (let i = 0; i < list.length; i++) {
          const b = list[i]!;
          const baseY = b.levelIndex === 0 ? lt1Y : lt2Y;
          this._v1.set(b.x, baseY + b.y + b.hgt * 0.5, b.z);
          this._q.setFromAxisAngle(this._up, b.rotY);
          this._s1.set(b.len, b.hgt, b.thick);
          this._m4.compose(this._v1, this._q, this._s1);
          im.setMatrixAt(i, this._m4);

          off[i * 3] = (b.x - 2.5) * 0.65;
          off[i * 3 + 1] = b.levelIndex * 1.4 + b.y * 0.35;
          off[i * 3 + 2] = (b.z - 8.5) * 0.25;
        }
        im.instanceMatrix.needsUpdate = true;
        this.houseRoot.add(im);
        this.tagPickable(im, { kind: "part", id: "dinding" }, label);
        this.registerExplodeInstanced(im, off);
      };

      buildBrickIM(outerB, this.palette.brickOuter, `Dinding Bata Luar (${project.systems.brick.name})`);
      buildBrickIM(innerB, this.palette.brickInner, `Sekat Bata Dalam (${project.systems.brick.name})`);
    }

    // 7. Plaster & Paint Walls + Openings (batched frame/glass per opening for high detail & low draw calls!)
    for (const lv of project.levels) {
      if (lv.index === 1 && view.activeLevelView === "lt1") continue;
      const baseLvY = lv.index === 0 ? lt1Y : lt2Y;

      for (const w of lv.walls) {
        const dx = w.end.x - w.start.x;
        const dz = w.end.z - w.start.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const ux = dx / len;
        const uz = dz / len;
        const ang = -Math.atan2(dz, dx);

        if (showPlasterPaint) {
          const extra0 =
            lv.index === 1 && w.exterior && w.height >= 2.8 ? roof.extraWallHeightAt(1, w.start.x, w.start.z) : 0;
          const extra1 =
            lv.index === 1 && w.exterior && w.height >= 2.8 ? roof.extraWallHeightAt(1, w.end.x, w.end.z) : 0;
          const wallShape = new THREE.Shape();
          wallShape.moveTo(0, 0);
          wallShape.lineTo(len, 0);
          wallShape.lineTo(len, w.height + extra1);
          wallShape.lineTo(0, w.height + extra0);
          wallShape.closePath();

          for (const op of w.openings) {
            const lo = Math.max(0.02, op.offset - op.width * 0.5);
            const hi = Math.min(len - 0.02, op.offset + op.width * 0.5);
            const top = Math.min(w.height - 0.04, op.sill + op.height);
            if (hi > lo && top > op.sill) {
              const hole = new THREE.Path();
              hole.moveTo(lo, op.sill);
              hole.lineTo(hi, op.sill);
              hole.lineTo(hi, top);
              hole.lineTo(lo, top);
              hole.closePath();
              wallShape.holes.push(hole);
            }
          }

          const skinThickness = w.thickness + 0.022;
          const geo = attachBvh(new THREE.ExtrudeGeometry(wallShape, { depth: skinThickness, bevelEnabled: false }));
          geo.translate(0, 0, -skinThickness * 0.5);
          const mat = w.exterior ? this.palette.plasterExt : this.palette.plasterInt;
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(w.start.x, baseLvY, w.start.z);
          mesh.rotation.y = ang;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.houseRoot.add(mesh);
          this.dynResources.push(geo);
          this.tagPickable(mesh, { kind: "wall", id: w.id, levelIndex: lv.index }, w.name);
          this.explodePieces.push({
            obj: mesh,
            base: mesh.position.clone(),
            off: new THREE.Vector3(((w.start.x + w.end.x) * 0.5 - 2.5) * 0.5, lv.index * 1.3, 0),
          });
        }

        if (showOpenings) {
          for (const op of w.openings) {
            const cx = w.start.x + ux * op.offset;
            const cz = w.start.z + uz * op.offset;
            const opGroup = new THREE.Group();
            opGroup.position.set(cx, baseLvY + op.sill, cz);
            opGroup.rotation.y = ang;

            if (op.kind === "door") {
              const ft = 0.05;
              const fd = w.thickness + 0.036;
              const jambL = createChamferBox(ft, op.height, fd, 0.007, 1);
              jambL.translate(-op.width * 0.5 + ft * 0.5, op.height * 0.5, 0);
              const jambR = createChamferBox(ft, op.height, fd, 0.007, 1);
              jambR.translate(op.width * 0.5 - ft * 0.5, op.height * 0.5, 0);
              const head = createChamferBox(op.width, ft, fd, 0.007, 1);
              head.translate(0, op.height - ft * 0.5, 0);

              const frameGeo = mergeGeometryBatch([jambL, jambR, head]);
              if (frameGeo) {
                const fm = new THREE.Mesh(frameGeo, this.palette.woodTeak);
                fm.castShadow = true;
                fm.receiveShadow = true;
                opGroup.add(fm);
                this.dynResources.push(frameGeo);
              }

              const pivot = new THREE.Group();
              pivot.position.set(-op.width * 0.5 + ft, 0, 0);
              pivot.rotation.y = op.swing * ((op.openPct / 100) * Math.PI * 0.48);
              const leafMat = op.width > 1.3 ? this.palette.glass : this.palette.woodTeak;
              const leafGeo = attachBvh(createChamferBox(op.width - ft * 2, op.height - ft, 0.044, 0.008, 1));
              leafGeo.translate((op.width - ft * 2) * 0.5, (op.height - ft) * 0.5, 0);
              const leafMesh = new THREE.Mesh(leafGeo, leafMat);
              leafMesh.castShadow = true;
              leafMesh.receiveShadow = true;
              pivot.add(leafMesh);

              // Brushed steel lever handle + escutcheon
              const hBase = createChamferBox(0.035, 0.14, 0.02, 0.004, 1);
              hBase.translate(op.width - ft * 3.5, 1.0, 0.028);
              const lever = createChamferBox(0.11, 0.02, 0.028, 0.004, 1);
              lever.translate(op.width - ft * 3.5 - 0.045, 1.03, 0.048);
              const hGeo = mergeGeometryBatch([hBase, lever]);
              if (hGeo) {
                const hMesh = new THREE.Mesh(hGeo, this.palette.steelLight);
                pivot.add(hMesh);
                this.dynResources.push(hGeo);
              }
              this.dynResources.push(leafGeo);
              opGroup.add(pivot);
              this.tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lv.index }, op.label);
            } else if (op.kind === "window") {
              const ft = 0.045;
              const fd = w.thickness + 0.036;
              const fParts: THREE.BufferGeometry[] = [];
              const l = createChamferBox(ft, op.height, fd, 0.006, 1);
              l.translate(-op.width * 0.5 + ft * 0.5, op.height * 0.5, 0);
              const r = createChamferBox(ft, op.height, fd, 0.006, 1);
              r.translate(op.width * 0.5 - ft * 0.5, op.height * 0.5, 0);
              const topF = createChamferBox(op.width, ft, fd, 0.006, 1);
              topF.translate(0, op.height - ft * 0.5, 0);
              const botF = createChamferBox(op.width + 0.04, ft + 0.01, fd + 0.03, 0.007, 1);
              botF.translate(0, ft * 0.5, 0);
              fParts.push(l, r, topF, botF);

              if (op.width > 1.0) {
                const mul = createChamferBox(0.036, op.height - ft * 2, 0.042, 0.004, 1);
                mul.translate(0, op.height * 0.5, 0);
                fParts.push(mul);
              }
              const frameGeo = mergeGeometryBatch(fParts);
              if (frameGeo) {
                const fm = new THREE.Mesh(frameGeo, this.palette.aluDark);
                fm.castShadow = true;
                fm.receiveShadow = true;
                opGroup.add(fm);
                this.dynResources.push(frameGeo);
              }

              const glassGeo = attachBvh(new THREE.BoxGeometry(op.width - ft * 2, op.height - ft * 2, 0.015));
              glassGeo.translate(0, op.height * 0.5, 0);
              const gm = new THREE.Mesh(glassGeo, this.palette.glass);
              opGroup.add(gm);
              this.dynResources.push(glassGeo);
              this.tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lv.index }, op.label);
            } else if (op.kind === "vent") {
              const cells = Math.max(1, Math.round(op.width / 0.2));
              const cw = op.width / cells;
              const vParts: THREE.BufferGeometry[] = [];
              for (let c = 0; c < cells; c++) {
                const lx = -op.width * 0.5 + (c + 0.5) * cw;
                const b = createChamferBox(cw - 0.02, op.height, w.thickness + 0.02, 0.006, 1);
                b.translate(lx, op.height * 0.5, 0);
                vParts.push(b);
              }
              const ventGeo = mergeGeometryBatch(vParts);
              if (ventGeo) {
                const vm = new THREE.Mesh(ventGeo, this.palette.concrete);
                vm.castShadow = true;
                vm.receiveShadow = true;
                opGroup.add(vm);
                this.dynResources.push(ventGeo);
              }
              this.tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lv.index }, op.label);
            }
            this.houseRoot.add(opGroup);
          }
        }
      }
    }

    // 8. Roof Structure (Cutout for Rear Open Void [1.70..5.00, 15.35..maxZ] & Central Stair Skylight)
    if ((showTruss || showRoofCover) && view.activeLevelView !== "lt1") {
      // roof.heightAt() is relative to LT1 floor (lt2.elevation + lt2.height); shift by lt1Y so roof sits flush atop LT2 walls!
      const roofH = (x: number, z: number) => roof.heightAt(x, z) + lt1Y;
      const spanX = roof.maxX - roof.minX;
      const spanZ = roof.maxZ - roof.minZ;
      const midX = (roof.minX + roof.maxX) * 0.5;
      const voidCut = { x0: 1.7, x1: roof.maxX + 0.1, z0: 15.35, z1: roof.maxZ + 0.1 };
      const skylightHole: [number, number, number, number] = [0.14, 8.55, 1.3, 10.95];

      if (showTruss) {
        for (let i = 0; i < roof.trussCount; i++) {
          const z = roof.minZ + (i / Math.max(1, roof.trussCount - 1)) * spanZ;
          // Trusses overlapping rear void only span the roofed WC strip [minX..1.68]
          const tx0 = roof.minX + 0.05;
          const tx1 = z >= 15.35 ? Math.min(roof.maxX - 0.05, 1.68) : roof.maxX - 0.05;
          const tSpan = tx1 - tx0;
          if (tSpan < 0.25) continue;
          const tMidX = (tx0 + tx1) * 0.5;
          const h = roofH(tMidX, z);
          batch.addBox(
            "roof:truss",
            this.palette.steelLight,
            "rangka",
            "Rangka Baja Ringan C75",
            tMidX,
            h - 0.08,
            z,
            tSpan,
            0.06,
            0.05,
            { explodeOff: [0, 2.6, 0] },
          );
        }
      }

      if (showRoofCover) {
        const slopeRad = (roof.slopeDeg * Math.PI) / 180;
        const slopeFactor = 1 / Math.cos(slopeRad);
        const thickness = 0.085 * slopeFactor;
        const roofGeos: THREE.BufferGeometry[] = [];

        if (roof.roofType === "shed_front" || roof.roofType === "shed_back" || roof.roofType === "flat_deck") {
          const g = this.buildCutoutRoofGeometry(
            roof.minX,
            roof.maxX,
            roof.minZ,
            roof.maxZ,
            voidCut,
            skylightHole,
            roofH,
            thickness,
          );
          if (g) roofGeos.push(g);
        } else {
          // Gable or Hip twin panels (split at midX so both slopes stay piecewise planar around Rear Void & Skylight)
          const gLeft = this.buildCutoutRoofGeometry(
            roof.minX,
            midX,
            roof.minZ,
            roof.maxZ,
            voidCut,
            skylightHole,
            roofH,
            thickness,
          );
          const gRight = this.buildCutoutRoofGeometry(
            midX,
            roof.maxX,
            roof.minZ,
            roof.maxZ,
            voidCut,
            skylightHole,
            roofH,
            thickness,
          );
          if (gLeft) roofGeos.push(gLeft);
          if (gRight) roofGeos.push(gRight);
        }

        const mergedRoof = mergeGeometryBatch(roofGeos);
        if (mergedRoof) {
          const roofMesh = new THREE.Mesh(mergedRoof, this.palette.roofCover);
          roofMesh.castShadow = true;
          roofMesh.receiveShadow = true;
          this.houseRoot.add(roofMesh);
          this.dynResources.push(mergedRoof);
          this.tagPickable(roofMesh, { kind: "part", id: "genteng" }, `Atap ${roof.roofType} (${roof.slopeDeg}°)`);
          this.explodePieces.push({ obj: roofMesh, base: roofMesh.position.clone(), off: new THREE.Vector3(0, 3.2, 0) });
        }

        // Fascia / Coping border strips around Void aperture & Stair Skylight Curb
        const voidEdgeY = roofH(3.35, 15.35);
        batch.addGeo(
          "roof:fascia",
          this.palette.lisplank,
          "genteng",
          "Lisplank Void Belakang",
          createChamferBox(roof.maxX - 1.7 + 0.08, 0.14, 0.08, 0.01, 1),
          (1.7 + roof.maxX) * 0.5,
          voidEdgeY + 0.04,
          15.35,
          0,
          [0, 3.2, 0],
        );

        // Central Stair Skylight Aluminum Curb + Mullion + Clear Tempered Glass
        const [hx0, hz0, hx1, hz1] = skylightHole;
        const hMidX = (hx0 + hx1) * 0.5;
        const hMidZ = (hz0 + hz1) * 0.5;
        const hW = hx1 - hx0;
        const hD = hz1 - hz0;
        const skyMinY = roofH(hMidX, hz0);
        const skyMaxY = roofH(hMidX, hz1);
        const skyAvgY = (skyMinY + skyMaxY) * 0.5 + 0.11;
        const skyRotX = Math.atan2(skyMaxY - skyMinY, hD);

        const curbFront = createChamferBox(hW + 0.08, 0.14, 0.05, 0.008, 1);
        curbFront.translate(hMidX, skyMinY + 0.07, hz0);
        const curbBack = createChamferBox(hW + 0.08, 0.14, 0.05, 0.008, 1);
        curbBack.translate(hMidX, skyMaxY + 0.07, hz1);
        batch.addGeo("roof:skycurb", this.palette.aluDark, "plafon", "Rangka Skylight Tangga", curbFront, 0, 0, 0, 0, [0, 3.2, 0]);
        batch.addGeo("roof:skycurb", this.palette.aluDark, "plafon", "Rangka Skylight Tangga", curbBack, 0, 0, 0, 0, [0, 3.2, 0]);

        const skyGlass = new THREE.Mesh(attachBvh(new THREE.BoxGeometry(hW + 0.06, 0.035, hD + 0.06)), this.palette.glass);
        skyGlass.position.set(hMidX, skyAvgY + 0.04, hMidZ);
        skyGlass.rotation.x = -skyRotX;
        skyGlass.castShadow = false;
        this.houseRoot.add(skyGlass);
        this.dynResources.push(skyGlass.geometry);
        this.tagPickable(skyGlass, { kind: "part", id: "plafon" }, "Skylight Tangga Tempered Glass");
        this.explodePieces.push({ obj: skyGlass, base: skyGlass.position.clone(), off: new THREE.Vector3(0, 3.2, 0) });

        // Front Gutter (Talang Depan) + Curved TubeGeometry Downspouts hugging left balcony column (Z=3.04) & right bedroom corner (Z=3.92)
        const eaveY = roofH(midX, roof.minZ) - 0.03;
        batch.addGeo(
          "roof:gutter",
          this.palette.aluDark,
          "talang",
          "Talang Utama Depan",
          createChamferBox(spanX + 0.04, 0.13, 0.17, 0.012, 1),
          midX,
          eaveY,
          roof.minZ + 0.05,
        );
        const pipeTargets: [number, number][] = [
          [0.14, 3.04],
          [project.site.width - 0.14, 3.92],
        ];
        for (const [dx, wallZ] of pipeTargets) {
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(dx, eaveY - 0.05, roof.minZ + 0.06),
            new THREE.Vector3(dx, eaveY - 0.34, roof.minZ + 0.25),
            new THREE.Vector3(dx, eaveY - 0.65, wallZ),
            new THREE.Vector3(dx, 0.25, wallZ),
            new THREE.Vector3(dx, 0.09, wallZ - 0.22),
          ]);
          const tubeGeo = attachBvh(new THREE.TubeGeometry(curve, 22, 0.044, 10, false));
          batch.addGeo("roof:gutter", this.palette.aluDark, "talang", "Pipa Turun Hujan (Downspout)", tubeGeo);
          for (const cy of [1.2, 3.4, 5.6]) {
            const collar = new THREE.CylinderGeometry(0.062, 0.062, 0.045, 10);
            batch.addGeo("roof:gutter", this.palette.aluDark, "talang", "Klem Pipa Talang", collar, dx, cy, wallZ);
          }
        }

        // Carport Canopy (covers Carport X: 1.48..5.00, Z: -0.35..4.45 ONLY; planar slope aligned seamlessly with front steel fascia!)
        const cpMinX = 1.48;
        const cpMaxX = project.site.width;
        const cpW = cpMaxX - cpMinX;
        const cpMidX = (cpMinX + cpMaxX) * 0.5;
        const cpZ0 = -0.35;
        const cpZ1 = 4.45;
        const cpHeightAt = (_x: number, z: number) => lt2Y - 0.34 - (cpZ1 - z) * 0.055; // rear 3.76m (clear under balcony!) -> front 3.49m
        const cpGeo = this.buildCutoutRoofGeometry(cpMinX, cpMaxX, cpZ0, cpZ1, null, null, cpHeightAt, 0.065);
        if (cpGeo) {
          const cpRoof = new THREE.Mesh(cpGeo, this.palette.roofCover);
          cpRoof.castShadow = true;
          cpRoof.receiveShadow = true;
          this.houseRoot.add(cpRoof);
          this.dynResources.push(cpGeo);
          this.tagPickable(cpRoof, { kind: "part", id: "genteng" }, "Kanopi Carport Depan");
          this.explodePieces.push({ obj: cpRoof, base: cpRoof.position.clone(), off: new THREE.Vector3(0, 1.8, 0) });
        }

        // Carport perimeter steel fascia frame aligned flush under the front & inner side edges of canopy
        const cpFrontY = cpHeightAt(cpMidX, cpZ0);
        const cpAvgY = (cpHeightAt(cpMinX, cpZ0) + cpHeightAt(cpMinX, cpZ1)) * 0.5;
        const cpTilt = Math.atan(0.055);
        batch.addBox("roof:cpframe", this.palette.aluDark, "rangka", "Rangka Kanopi Carport", cpMidX, cpFrontY - 0.03, cpZ0 + 0.03, cpW, 0.1, 0.06);
        batch.addBox("roof:cpframe", this.palette.aluDark, "rangka", "Rangka Kanopi Carport", cpMinX + 0.03, cpAvgY - 0.03, (cpZ0 + cpZ1) * 0.5, 0.06, 0.1, cpZ1 - cpZ0, {
          rotX: cpTilt,
        });
      }
    }

    // Flush batched architecture before dynamic hero props
    batch.flush(this.houseRoot, this.dynResources, (mesh, partId, label, explodeOff) => {
      this.tagPickable(mesh, { kind: "part", id: partId as never }, label);
      if (explodeOff) {
        this.explodePieces.push({
          obj: mesh,
          base: mesh.position.clone(),
          off: new THREE.Vector3(...explodeOff),
        });
      }
    });

    // 9. Furniture, Movable HVAC (AC/Fans + Outdoor Condensers), & Lights
    if (showProps) {
      let activePointLights = 0;
      for (const lv of project.levels) {
        if (lv.index === 1 && view.activeLevelView === "lt1") continue;
        const baseY = lv.index === 0 ? lt1Y : lt2Y;
        const lvGrp = new THREE.Group();
        lvGrp.position.y = baseY;

        for (const f of lv.furniture) {
          const mesh = buildFurnitureMesh(f, this.palette, this.dynResources, this.contactShadowMat);
          // Ground exterior vehicles physically on Carport peil & front yard greenery on garden soil bed
          if (lv.index === 0) {
            if (f.category === "vehicle" && f.position.z < 4.5) {
              mesh.position.y += Math.max(0.08, peil.carportPeilM) - lt1Y;
            } else if (f.position.x < 1.5 && f.position.z < 3.0) {
              mesh.position.y += 0.08 - lt1Y;
            } else if (f.position.z >= 3.0 && f.position.z <= 4.0 && f.position.x < 2.25) {
              mesh.position.y += Math.max(0.12, peil.terracePeilM) - lt1Y;
            } else if (f.position.x > 1.7 && f.position.z > 15.35) {
              // Rear Taman Belakang grass level sits right on plinth
              mesh.position.y += 0;
            }
          }
          lvGrp.add(mesh);
          this.tagPickable(mesh, { kind: "furniture", id: f.id, levelIndex: lv.index }, f.name);
        }

        for (const hv of lv.hvac) {
          const mesh = buildHvacMesh(hv, this.palette, this.dynResources, this.animatedFans);
          lvGrp.add(mesh);
          this.tagPickable(mesh, { kind: "hvac", id: hv.id, levelIndex: lv.index }, hv.name);

          // Render realistic Outdoor AC Condenser high on solid facade pier (Front Z=3.84 or Rear Void wall Z=15.42)
          if (hv.type === "ac_split") {
            const isFront = hv.position.z < 9.5;
            const extZ = isFront ? 3.84 : 15.42;
            const extX = isFront ? (hv.position.x > 2.8 ? Math.min(4.45, hv.position.x) : 3.15) : Math.max(2.1, Math.min(4.45, hv.position.x));
            const outUnit = this.buildAcCondenserUnit(extX, 2.72, extZ, isFront ? 0 : Math.PI);
            lvGrp.add(outUnit);
            this.tagPickable(outUnit, { kind: "hvac", id: hv.id, levelIndex: lv.index }, `Outdoor ${hv.name}`);
          }
        }

        for (const l of lv.lights) {
          const mesh = buildLightFixtureMesh(l, this.palette, this.dynResources);
          lvGrp.add(mesh);
          this.tagPickable(mesh, { kind: "light", id: l.id, levelIndex: lv.index }, l.name);
          if (l.on && l.dimmer > 0 && activePointLights < 6) {
            activePointLights++;
            const ptLight = new THREE.PointLight(
              l.colorTempK <= 3200 ? 0xffcb85 : 0xfff3de,
              (l.lumens / 650) * l.dimmer * 1.45,
              7.5,
              1.8,
            );
            ptLight.position.set(l.position.x, l.position.y - 0.14, l.position.z);
            lvGrp.add(ptLight);
          }
        }
        this.houseRoot.add(lvGrp);
      }
    }

    // 10. MEP X-Ray Overlay (Air Bersih, Air Kotor, Listrik, Septic)
    if (showMep) {
      const mepGrp = new THREE.Group();
      for (const lv of project.levels) {
        if (lv.index === 1 && view.activeLevelView === "lt1") continue;
        const baseY = lv.index === 0 ? lt1Y : lt2Y;
        for (const rt of lv.mepRoutes) {
          const isAir = rt.kind === "air_bersih" || rt.kind === "air_kotor" || rt.kind === "air_hujan";
          if (isAir && !view.showAir && stage !== 7) continue;
          if (!isAir && !view.showListrik && stage !== 7) continue;

          const mat =
            rt.kind === "air_bersih"
              ? this.palette.mepWaterClean
              : rt.kind === "air_kotor"
                ? this.palette.mepWaterWaste
                : rt.kind === "air_hujan"
                  ? this.palette.mepRainPipe
                  : rt.kind === "listrik_lampu"
                    ? this.palette.mepElecLamp
                    : rt.kind === "listrik_ac"
                      ? this.palette.mepElecAc
                      : this.palette.mepElecOutlet;

          const vecs = rt.pts.map((p) => new THREE.Vector3(p.x, baseY + p.y, p.z));
          const curve = new THREE.CatmullRomCurve3(vecs, false, "catmullrom", 0.05);
          const tubeGeo = new THREE.TubeGeometry(curve, Math.max(8, vecs.length * 6), rt.kind === "air_kotor" ? 0.045 : 0.025, 8, false);
          const mesh = new THREE.Mesh(tubeGeo, mat);
          mesh.renderOrder = 950;
          mepGrp.add(mesh);
          this.dynResources.push(tubeGeo);
          this.tagPickable(mesh, { kind: "part", id: isAir ? "pipaAirBersih" : "listrikLampu" }, rt.label);
        }
      }
      const bioGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.35, 16);
      const bio = new THREE.Mesh(bioGeo, this.palette.mepWaterWaste);
      bio.position.set(2.8, -0.75, 1.6);
      bio.renderOrder = 951;
      mepGrp.add(bio);
      this.dynResources.push(bioGeo);
      this.tagPickable(bio, { kind: "part", id: "septic" }, "Bio Septic Tank (di bawah Carport)");
      this.houseRoot.add(mepGrp);
    }

    // 11. Room Labels & 3D Dimensions
    if (view.showLabels) {
      for (const fl of derived.floors) {
        if (fl.levelIndex === 1 && view.activeLevelView === "lt1") continue;
        const ly = fl.levelIndex === 0 ? lt1Y + 1.4 : lt2Y + 1.4;
        for (const r of fl.rooms) {
          const sp = this.makeLabelSprite(r.room.name, `${r.netAreaM2.toFixed(1)} m²`);
          sp.position.set(r.centroid.x, ly, r.centroid.z);
          this.dimsGroup.add(sp);
        }
      }
    }
    if (view.showDims) {
      this.build3dDimensions(project.site.width, project.site.depth, roof.ridgeElevationM + lt1Y);
    }

    this.applyExplode(this.explodeCurrent);
  }

  private buildAcCondenserUnit(x: number, y: number, z: number, rotY: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const bodyGeo = createChamferBox(0.76, 0.54, 0.28, 0.012, 2);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe6e7e9, roughness: 0.42, metalness: 0.15 });
    const grilleGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.03, 16);
    grilleGeo.rotateX(Math.PI / 2);
    grilleGeo.translate(-0.1, 0, -0.145);
    const grilleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.48, metalness: 0.68 });
    const mBody = new THREE.Mesh(bodyGeo, bodyMat);
    mBody.castShadow = true;
    const mGrille = new THREE.Mesh(grilleGeo, grilleMat);
    g.add(mBody, mGrille);
    this.dynResources.push(bodyGeo, bodyMat, grilleGeo, grilleMat);
    return g;
  }

  private rebuildSimOverlays(
    derived: DerivedProjectModel,
    lighting: LightingSimulationResult,
    flood: FloodSimulationResult,
    view: ViewState,
  ) {
    this.clearSim();
    const lt1Y = derived.project.site.peil.floor1PeilM;
    const lt2Y = lt1Y + derived.project.levels[0]!.height;

    // 1. Lux Heatmap Overlay
    if (view.showLuxHeatmap) {
      const makeHeatmapPlane = (grid: Float32Array, yPos: number) => {
        const cv = document.createElement("canvas");
        cv.width = lighting.gridWidth;
        cv.height = lighting.gridDepth;
        const ctx = cv.getContext("2d")!;
        const img = ctx.createImageData(lighting.gridWidth, lighting.gridDepth);
        for (let i = 0; i < grid.length; i++) {
          const lux = grid[i] ?? 0;
          const norm = Math.min(1, lux / 800);
          const r = Math.round(norm < 0.5 ? 25 + norm * 180 : 115 + (norm - 0.5) * 280);
          const g = Math.round(norm < 0.4 ? 40 + norm * 320 : 168 + (norm - 0.4) * 145);
          const b = Math.round(norm < 0.35 ? 120 + norm * 260 : Math.max(40, 210 - (norm - 0.35) * 260));
          img.data[i * 4] = Math.min(255, r);
          img.data[i * 4 + 1] = Math.min(255, g);
          img.data[i * 4 + 2] = Math.min(255, b);
          img.data[i * 4 + 3] = 175;
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const geo = new THREE.PlaneGeometry(5, 17);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(2.5, yPos, 8.5);
        mesh.renderOrder = 500;
        this.simGroup.add(mesh);
        this.simResources.push(tex, geo, mat);
      };
      makeHeatmapPlane(lighting.lt1LuxGrid, lt1Y + 0.04);
      if (view.activeLevelView !== "lt1") makeHeatmapPlane(lighting.lt2LuxGrid, lt2Y + 0.04);
    }

    // 2. Airflow 3D Particle Streamlines (advected every frame in animate())
    if (view.showAirParticles) {
      const count = 420;
      const geo = new THREE.ConeGeometry(0.032, 0.22, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.renderOrder = 700;
      this.airParticlesMesh = im;
      this.airParticleStates = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * 4.8 + 0.1,
        y: (i % 2 === 0 ? lt1Y : lt2Y) + 0.8 + Math.random() * 1.8,
        z: Math.random() * 16.5 + 0.2,
        lv: (i % 2 === 0 ? 0 : 1) as 0 | 1,
        life: Math.random(),
      }));
      this.simGroup.add(im);
      this.simResources.push(geo, mat);
    }

    // 3. Realistic 3D Flood Water Surface (subdivided grid driven by GLSL wave shader!)
    if (view.showFloodWater && flood.streetFloodCm > 0) {
      const streetWaterY = flood.streetFloodCm / 100;
      const extGeo = new THREE.PlaneGeometry(24, 11.4, 36, 24);
      extGeo.rotateX(-Math.PI / 2);
      const extMesh = new THREE.Mesh(extGeo, this.palette.floodWater);
      extMesh.position.set(2.5, streetWaterY, -1.0);
      extMesh.renderOrder = 600;
      this.simGroup.add(extMesh);
      this.simResources.push(extGeo);

      if (flood.lt1FloorFloodCm > 0) {
        const insideWaterY = lt1Y + flood.lt1FloorFloodCm / 100;
        const inGeo = new THREE.PlaneGeometry(4.9, 13.0, 16, 28);
        inGeo.rotateX(-Math.PI / 2);
        const inMesh = new THREE.Mesh(inGeo, this.palette.floodWater);
        inMesh.position.set(2.5, insideWaterY, 10.5);
        inMesh.renderOrder = 601;
        this.simGroup.add(inMesh);
        this.simResources.push(inGeo);
      }

      if (derived.project.floodMitigation.doorFloodBarrier) {
        const bh = derived.project.floodMitigation.barrierHeightCm / 100;
        const barMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.35, metalness: 0.65 });
        const barGeo = createChamferBox(1.05, bh, 0.06, 0.008, 1);
        const b1 = new THREE.Mesh(barGeo, barMat);
        b1.position.set(1.58, lt1Y + bh * 0.5, 4.0);
        this.simGroup.add(b1);
        this.simResources.push(barGeo, barMat);
      }
    }
  }

  private build3dDimensions(width: number, depth: number, topY: number) {
    const mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false, transparent: true, opacity: 0.9 });
    this.dynResources.push(mat);
    const addLine = (a: [number, number, number], b: [number, number, number], label: string) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 999;
      this.dimsGroup.add(line);
      this.dynResources.push(geo);
      const sp = this.makeLabelSprite(label, "");
      sp.position.set((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5 + 0.25, (a[2] + b[2]) * 0.5);
      sp.scale.set(1.3, 0.45, 1);
      this.dimsGroup.add(sp);
    };
    addLine([0, 0.1, -0.8], [width, 0.1, -0.8], `${width.toFixed(2)} m`);
    addLine([-0.8, 0.1, 0], [-0.8, 0.1, depth], `${depth.toFixed(2)} m`);
    addLine([width + 0.6, 0, depth], [width + 0.6, topY, depth], `${topY.toFixed(2)} m`);
  }

  private makeLabelSprite(line1: string, line2: string): THREE.Sprite {
    const cv = document.createElement("canvas");
    cv.width = 420;
    cv.height = line2 ? 140 : 88;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "rgba(22, 25, 30, 0.88)";
    ctx.strokeStyle = "rgba(234, 152, 74, 0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(4, 4, cv.width - 8, cv.height - 8, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f4f1ea";
    ctx.textAlign = "center";
    ctx.font = "700 32px sans-serif";
    ctx.fillText(line1, cv.width / 2, line2 ? 56 : 54);
    if (line2) {
      ctx.fillStyle = "#fbbf24";
      ctx.font = "600 28px monospace";
      ctx.fillText(line2, cv.width / 2, 108);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    this.dynResources.push(tex, mat);
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.65, line2 ? 0.55 : 0.36, 1);
    sp.renderOrder = 999;
    return sp;
  }

  private registerExplodeInstanced(im: THREE.InstancedMesh, off: Float32Array) {
    const n = im.count;
    const pos = new Float32Array(n * 3);
    const quat = new Float32Array(n * 4);
    const scl = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, this._m4);
      this._m4.decompose(this._v1, this._q, this._v2);
      pos[i * 3] = this._v1.x;
      pos[i * 3 + 1] = this._v1.y;
      pos[i * 3 + 2] = this._v1.z;
      quat[i * 4] = this._q.x;
      quat[i * 4 + 1] = this._q.y;
      quat[i * 4 + 2] = this._q.z;
      quat[i * 4 + 3] = this._q.w;
      scl[i * 3] = this._v2.x;
      scl[i * 3 + 1] = this._v2.y;
      scl[i * 3 + 2] = this._v2.z;
    }
    this.explodeInstanced.push({ im, n, pos, off, quat, scl });
  }

  private applyExplode(k: number) {
    const e = THREE.MathUtils.clamp(k, 0, 1);
    for (const p of this.explodePieces) {
      p.obj.position.copy(p.base).addScaledVector(p.off, e);
    }
    for (const im of this.explodeInstanced) {
      for (let i = 0; i < im.n; i++) {
        this._q.set(im.quat[i * 4]!, im.quat[i * 4 + 1]!, im.quat[i * 4 + 2]!, im.quat[i * 4 + 3]!);
        this._v1.set(
          im.pos[i * 3]! + im.off[i * 3]! * e,
          im.pos[i * 3 + 1]! + im.off[i * 3 + 1]! * e,
          im.pos[i * 3 + 2]! + im.off[i * 3 + 2]! * e,
        );
        this._v2.set(im.scl[i * 3]!, im.scl[i * 3 + 1]!, im.scl[i * 3 + 2]!);
        this._m4.compose(this._v1, this._q, this._v2);
        im.im.setMatrixAt(i, this._m4);
      }
      im.im.instanceMatrix.needsUpdate = true;
    }
  }

  private applyWireframe(wf: boolean) {
    this.houseRoot.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material instanceof THREE.MeshStandardMaterial || o.material instanceof THREE.MeshPhysicalMaterial)) {
        o.material.wireframe = wf;
      }
    });
  }

  private updateSelectionRing(derived: DerivedProjectModel, sel: SelectionTarget) {
    if (!sel || sel.kind === "part") {
      this.selectedRing.visible = false;
      return;
    }
    const lv = derived.project.levels[sel.levelIndex];
    if (!lv) {
      this.selectedRing.visible = false;
      return;
    }
    const baseY = lv.index === 0 ? derived.project.site.peil.floor1PeilM : derived.project.site.peil.floor1PeilM + lv.height;
    let pt: { x: number; y: number; z: number } | null = null;
    if (sel.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === sel.id);
      if (f) pt = { x: f.position.x, y: baseY + 0.04, z: f.position.z };
    } else if (sel.kind === "hvac") {
      const h = lv.hvac.find((x) => x.id === sel.id);
      if (h) pt = { x: h.position.x, y: baseY + h.position.y - 0.12, z: h.position.z };
    } else if (sel.kind === "light") {
      const l = lv.lights.find((x) => x.id === sel.id);
      if (l) pt = { x: l.position.x, y: baseY + l.position.y - 0.15, z: l.position.z };
    }
    if (pt) {
      this.selectedRing.position.set(pt.x, pt.y, pt.z);
      this.selectedRing.visible = true;
    } else {
      this.selectedRing.visible = false;
    }
  }

  private updateCameraTransform() {
    if (!this.webglReady) return;
    if (this.walkthroughActive) {
      this.cameraPersp.position.copy(this.walkPos);
      this._look.set(
        this.walkPos.x + Math.sin(this.walkYaw) * Math.cos(this.walkPitch),
        this.walkPos.y + Math.sin(this.walkPitch),
        this.walkPos.z + Math.cos(this.walkYaw) * Math.cos(this.walkPitch),
      );
      this.cameraPersp.lookAt(this._look);
      return;
    }

    const { radius, theta, phi } = this.sph;
    const x = this.target.x + radius * Math.sin(phi) * Math.sin(theta);
    const y = this.target.y + radius * Math.cos(phi);
    const z = this.target.z + radius * Math.sin(phi) * Math.cos(theta);

    this.cameraPersp.position.set(x, y, z);
    this.cameraPersp.lookAt(this.target);

    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfH = radius * 0.45;
    this.cameraOrtho.left = -halfH * aspect;
    this.cameraOrtho.right = halfH * aspect;
    this.cameraOrtho.top = halfH;
    this.cameraOrtho.bottom = -halfH;
    this.cameraOrtho.position.copy(this.cameraPersp.position);
    this.cameraOrtho.lookAt(this.target);
    this.cameraOrtho.updateProjectionMatrix();
  }

  private resize() {
    if (!this.webglReady || this.disposed) return;
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    if (this.qualityOverride === "auto") {
      const targetMax = w < 768 ? 1.5 : 2;
      const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, targetMax);
      if (Math.abs(dpr - this.activeDpr) > 0.05) {
        this.activeDpr = dpr;
        this.renderer.setPixelRatio(dpr);
      }
    }
    this.renderer.setSize(w, h, false);
    this.cameraPersp.aspect = w / h;
    this.cameraPersp.updateProjectionMatrix();
    this.updateCameraTransform();
  }

  private getPointerNdc(e: PointerEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this._ndc.set(((e.clientX - r.left) / w) * 2 - 1, -((e.clientY - r.top) / h) * 2 + 1);
    return this._ndc;
  }

  private pickAt(e: PointerEvent): { sel: SelectionTarget; label: string } | null {
    const ndc = this.getPointerNdc(e);
    const cam = this.useOrtho ? this.cameraOrtho : this.cameraPersp;
    this.raycaster.setFromCamera(ndc, cam);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur.userData?.sel) {
          return { sel: cur.userData.sel as SelectionTarget, label: String(cur.userData.label ?? "") };
        }
        cur = cur.parent;
      }
    }
    return null;
  }

  private intersectFloorPlane(e: PointerEvent): THREE.Vector3 | null {
    const ndc = this.getPointerNdc(e);
    const cam = this.useOrtho ? this.cameraOrtho : this.cameraPersp;
    this.raycaster.setFromCamera(ndc, cam);
    const yFloor = this.activeFloorElevation + (this.activeLevelIdx === 1 ? 3.6 : 0);
    this.dragPlane.set(this._up, -yFloor);
    return this.raycaster.ray.intersectPlane(this.dragPlane, this._hitPt);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.downInfo = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
    this.panMode = e.button === 1 || e.button === 2 || e.shiftKey;

    if (e.button === 0 && !this.panMode) {
      const picked = this.pickAt(e);
      if (
        picked?.sel &&
        (picked.sel.kind === "furniture" || picked.sel.kind === "hvac" || picked.sel.kind === "light") &&
        this.selectedTarget &&
        picked.sel.id === this.selectedTarget.id
      ) {
        this.draggingEntity = picked.sel;
        const floorPt = this.intersectFloorPlane(e);
        if (floorPt) this.dragOffset.copy(floorPt);
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.draggingEntity) {
      const pt = this.intersectFloorPlane(e);
      if (pt) {
        const clampedX = Math.max(0.25, Math.min(4.75, Math.round(pt.x * 10) / 10));
        const clampedZ = Math.max(0.25, Math.min(16.75, Math.round(pt.z * 10) / 10));
        this.callbacks.onMoveEntity(this.draggingEntity, clampedX, clampedZ);
      }
      return;
    }

    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (this.pinchDist > 0) {
        this.sphDesired.radius = THREE.MathUtils.clamp(this.sphDesired.radius * (this.pinchDist / d), 4, 55);
        this.cameraDirty = true;
      }
      this.pinchDist = d;
      return;
    }

    if (prev && this.downInfo) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;

      if (this.walkthroughActive) {
        this.walkYaw -= dx * 0.005;
        this.walkPitch = THREE.MathUtils.clamp(this.walkPitch - dy * 0.004, -0.9, 0.9);
        this.updateCameraTransform();
        return;
      }

      if (this.panMode) {
        this.cameraPersp.getWorldDirection(this._fwd);
        this._fwd.y = 0;
        this._fwd.normalize();
        this._right.crossVectors(this._fwd, this._up).normalize();
        const scale = this.sphDesired.radius * 0.0014;
        this.targetDesired.addScaledVector(this._right, -dx * scale);
        this.targetDesired.addScaledVector(this._fwd, dy * scale);
      } else {
        this.sphDesired.theta -= dx * 0.007;
        this.sphDesired.phi = THREE.MathUtils.clamp(this.sphDesired.phi - dy * 0.007, 0.06, Math.PI * 0.48);
      }
      this.cameraDirty = true;
      return;
    }

    // Throttled hover raycast (~45ms) so mouse move never drops frames
    const now = performance.now();
    if (now - this.lastHoverMs < 45) return;
    this.lastHoverMs = now;
    const picked = this.pickAt(e);
    const rect = this.canvas.getBoundingClientRect();
    this.callbacks.onHover(picked ? picked.label : null, e.clientX - rect.left, e.clientY - rect.top);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinchDist = 0;

    if (this.draggingEntity) {
      this.draggingEntity = null;
      this.downInfo = null;
      return;
    }

    if (this.downInfo && e.button === 0) {
      const moved = Math.hypot(e.clientX - this.downInfo.x, e.clientY - this.downInfo.y);
      if (moved < 6) {
        if (this.activeTool !== "select" && this.activeTool !== "demolish" && this.activeTool !== "paint") {
          const floorPt = this.intersectFloorPlane(e);
          if (floorPt) {
            this.callbacks.onPlaceAt(
              Math.max(0.2, Math.min(4.8, Math.round(floorPt.x * 10) / 10)),
              Math.max(0.2, Math.min(16.8, Math.round(floorPt.z * 10) / 10)),
              this.activeLevelIdx,
            );
          }
        } else {
          const picked = this.pickAt(e);
          this.callbacks.onSelect(picked ? picked.sel : null);
        }
      }
    }
    this.downInfo = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.sphDesired.radius = THREE.MathUtils.clamp(this.sphDesired.radius * (1 + e.deltaY * 0.001), 4, 58);
    this.cameraDirty = true;
  };

  private onContextMenu = (e: MouseEvent) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    this.keysPressed.add(e.key.toLowerCase());
    if (e.key === "Escape" && this.walkthroughActive) {
      this.walkthroughActive = false;
      this.callbacks.onWalkthroughExit?.();
      this.setCameraPreset("3d");
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysPressed.delete(e.key.toLowerCase());
  };

  private onVisibilityChange = () => {
    this.isHidden = typeof document !== "undefined" ? document.hidden : false;
    if (!this.isHidden) {
      this.lastFrameMs = performance.now();
    }
  };

  private onWebGLContextLost = (e: Event) => {
    e.preventDefault();
    this.isContextLost = true;
    this.callbacks.onWebGLStatus?.("lost");
  };

  private onWebGLContextRestored = () => {
    this.isContextLost = false;
    this.callbacks.onWebGLStatus?.("ok");
    this.lastFrameMs = performance.now();
  };

  private onReducedMotionChange = (e: MediaQueryListEvent) => {
    this.reducedMotion = e.matches;
  };

  private bindEvents() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("webglcontextlost", this.onWebGLContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onWebGLContextRestored);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.reducedMotionMq?.addEventListener("change", this.onReducedMotionChange);
  }

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);

    if (this.isHidden || this.isContextLost || !this.webglReady) return;

    const nowMs = performance.now();
    const rawDtMs = nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;
    const dt = Math.min(1 / 30, Math.max(0.0005, rawDtMs * 0.001));
    this.simElapsedS += dt;

    // Telemetry + Adaptive Quality Governor
    if (rawDtMs > 0 && rawDtMs < 250) {
      this.frameWindow.push(rawDtMs);
      if (this.frameWindow.length > 45) this.frameWindow.shift();
    }
    if (nowMs - this.lastStatsMs > 500 && this.frameWindow.length > 4) {
      this.lastStatsMs = nowMs;
      let sum = 0;
      for (let i = 0; i < this.frameWindow.length; i++) sum += this.frameWindow[i]!;
      const avgMs = sum / this.frameWindow.length;
      const fps = Math.min(120, Math.round(1000 / Math.max(1, avgMs)));

      if (this.qualityOverride === "auto" && this.frameWindow.length >= 30) {
        if (avgMs > 28 && this.activeTier === "high") this.applyQualityTier("medium");
        else if (avgMs > 34 && this.activeTier === "medium") this.applyQualityTier("low");
      }

      const info = this.renderer.info;
      const snap: SceneStatsSnapshot = {
        fps,
        avgMs: Number(avgMs.toFixed(1)),
        tier: this.activeTier,
        dpr: Number(this.activeDpr.toFixed(2)),
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      };
      (window as unknown as { __RUMAH_STATS__?: SceneStatsSnapshot }).__RUMAH_STATS__ = snap;
      this.callbacks.onStats?.(snap);
    }

    // Smooth Camera Damping
    if (this.cameraDirty && !this.walkthroughActive) {
      const k = this.reducedMotion ? 1 : 1 - Math.exp(-16 * dt);
      this.sph.radius += (this.sphDesired.radius - this.sph.radius) * k;
      this.sph.theta += (this.sphDesired.theta - this.sph.theta) * k;
      this.sph.phi += (this.sphDesired.phi - this.sph.phi) * k;
      this.target.lerp(this.targetDesired, k);
      this.updateCameraTransform();
      if (
        Math.abs(this.sphDesired.radius - this.sph.radius) < 0.002 &&
        Math.abs(this.sphDesired.theta - this.sph.theta) < 0.0005 &&
        Math.abs(this.sphDesired.phi - this.sph.phi) < 0.0005 &&
        this.target.distanceToSquared(this.targetDesired) < 0.0001
      ) {
        this.cameraDirty = false;
      }
    }

    // Smooth Exploded View interpolation (snaps immediately when prefers-reduced-motion is set)
    if (Math.abs(this.explodeCurrent - this.explodeTarget) > 0.001) {
      if (this.reducedMotion) this.explodeCurrent = this.explodeTarget;
      else this.explodeCurrent += (this.explodeTarget - this.explodeCurrent) * Math.min(1, dt * 8);
      this.applyExplode(this.explodeCurrent);
    }

    // Walkthrough WASD movement
    if (this.walkthroughActive) {
      const spd = 3.2 * dt;
      const fx = Math.sin(this.walkYaw);
      const fz = Math.cos(this.walkYaw);
      const rx = Math.cos(this.walkYaw);
      const rz = -Math.sin(this.walkYaw);
      if (this.keysPressed.has("w") || this.keysPressed.has("arrowup")) {
        this.walkPos.x += fx * spd;
        this.walkPos.z += fz * spd;
      }
      if (this.keysPressed.has("s") || this.keysPressed.has("arrowdown")) {
        this.walkPos.x -= fx * spd;
        this.walkPos.z -= fz * spd;
      }
      if (this.keysPressed.has("a") || this.keysPressed.has("arrowleft")) {
        this.walkPos.x += rx * spd;
        this.walkPos.z += rz * spd;
      }
      if (this.keysPressed.has("d") || this.keysPressed.has("arrowright")) {
        this.walkPos.x -= rx * spd;
        this.walkPos.z -= rz * spd;
      }
      if (this.keysPressed.has("e")) this.walkPos.y = Math.min(8, this.walkPos.y + spd);
      if (this.keysPressed.has("q")) this.walkPos.y = Math.max(1.2, this.walkPos.y - spd);
      this.updateCameraTransform();
    }

    // Spin fans
    if (!this.reducedMotion) {
      for (let i = 0; i < this.animatedFans.length; i++) {
        this.animatedFans[i]!.rotation.y += dt * 7.5;
      }
    }

    // Zero-allocation Airflow Particle Advection
    if (this.airParticlesMesh && this.lastAirflow && this.airParticleStates.length > 0 && !this.reducedMotion) {
      const af = this.lastAirflow;
      const lt1Y = this.activeFloorElevation;
      const lt2Y = lt1Y + 3.6;

      for (let i = 0; i < this.airParticleStates.length; i++) {
        const p = this.airParticleStates[i]!;
        const gx = Math.max(0, Math.min(af.gridW - 1, Math.floor(p.x / 0.2)));
        const gz = Math.max(0, Math.min(af.gridD - 1, Math.floor(p.z / 0.2)));
        const idx = gz * af.gridW + gx;
        const vx = (p.lv === 0 ? af.lt1VelX[idx] : af.lt2VelX[idx]) ?? 0;
        const vz = (p.lv === 0 ? af.lt1VelZ[idx] : af.lt2VelZ[idx]) ?? 0.2;
        const temp = (p.lv === 0 ? af.lt1Temp[idx] : af.lt2Temp[idx]) ?? 30;

        p.x += vx * dt * 1.4;
        p.z += vz * dt * 1.4;
        if ((p.x > 1.7 && p.z > 15.3) || (p.x < 1.35 && p.z > 7.5 && p.z < 12.5)) {
          p.y += dt * 0.9;
        }
        p.life += dt * 0.35;

        if (p.life > 1 || p.x < 0.05 || p.x > 4.95 || p.z < 0.05 || p.z > 16.95 || p.y > 7.2) {
          p.x = 0.2 + Math.random() * 4.6;
          p.z = 0.2 + Math.random() * 16.4;
          p.lv = i % 2 === 0 ? 0 : 1;
          p.y = (p.lv === 0 ? lt1Y : lt2Y) + 0.6 + Math.random() * 1.8;
          p.life = 0;
        }

        this._v1.set(p.x, p.y, p.z);
        const yaw = Math.atan2(vx, vz);
        this._q.setFromAxisAngle(this._up, yaw);
        this._m4.compose(this._v1, this._q, this._s1);
        this.airParticlesMesh.setMatrixAt(i, this._m4);

        const tNorm = Math.max(0, Math.min(1, (temp - 23) / 10));
        this._col.setRGB(0.2 + tNorm * 0.78, 0.76 - tNorm * 0.25, 0.96 - tNorm * 0.72);
        this.airParticlesMesh.setColorAt(i, this._col);
      }
      this.airParticlesMesh.instanceMatrix.needsUpdate = true;
      if (this.airParticlesMesh.instanceColor) this.airParticlesMesh.instanceColor.needsUpdate = true;
    }

    // Animate Rain & subtle Lightning
    if (this.rainPoints && this.rainPoints.visible && this.rainArray && !this.reducedMotion) {
      const speed = 13.5 * dt;
      const slant = 2.6 * dt;
      for (let i = 0; i < this.rainActiveCount; i++) {
        let y = this.rainArray[i * 3 + 1]! - speed;
        let z = this.rainArray[i * 3 + 2]! + slant;
        if (y < 0) {
          y = 13.5;
          z = (Math.random() - 0.5) * 26 + 8.5;
        }
        this.rainArray[i * 3 + 1] = y;
        this.rainArray[i * 3 + 2] = z;
      }
      (this.rainPoints.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

      if (this.rainActiveCount > 1200) {
        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
          this.lightningTimer = 4 + Math.random() * 7;
          this.lightningEnergy = 2.8;
        }
      }
    }
    if (this.lightningEnergy > 0.01 && !this.reducedMotion) {
      this.lightningEnergy *= Math.exp(-dt * 10);
      this.lightningLight.intensity = this.lightningEnergy;
    } else {
      this.lightningLight.intensity = 0;
    }

    // Live Capillary & Raindrop Wave Uniforms for Flood Water Shader
    this.palette.floodUniforms.uTime.value = this.reducedMotion ? 0 : this.simElapsedS;
    this.palette.floodUniforms.uRain.value = Math.min(1, this.lastRainMmH / 100);

    const cam = this.useOrtho ? this.cameraOrtho : this.cameraPersp;
    this.renderer.render(this.scene, cam);
  };

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();

    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("webglcontextlost", this.onWebGLContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onWebGLContextRestored);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.reducedMotionMq?.removeEventListener("change", this.onReducedMotionChange);

    if (!this.webglReady) return;

    this.clearDyn();
    this.clearSim();
    disposeObjectTree(this.envGroup);
    this.envGroup.clear();
    for (const r of this.staticDisposables) r.dispose();
    this.staticDisposables = [];

    this.envTex?.dispose();
    this.skyMat.map?.dispose();
    this.skyMat.dispose();
    this.skyMesh.geometry.dispose();
    this.rainPoints?.geometry.dispose();
    (this.rainPoints?.material as THREE.Material)?.dispose();
    this.palette.dispose();
    this.renderer.dispose();
  }
}
