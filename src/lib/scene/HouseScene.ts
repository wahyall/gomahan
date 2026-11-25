import * as THREE from "three";
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
import {
  createChamferBox,
  createContactShadowTexture,
} from "@/lib/scene/geometryHelpers";
import { buildProjectHouse, buildStaticNeighborhood } from "@/lib/scene/projectHouseBuilder";

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
  onWebGLStatus?: (status: WebGLStatus) => void;
  onStats?: (stats: SceneStatsSnapshot) => void;
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

  // Picking
  private raycaster = new THREE.Raycaster();
  private pickables: THREE.Object3D[] = [];
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

  // Orbit Camera (current + smoothed targets)
  private target = new THREE.Vector3(2.5, 2.5, 8.5);
  private targetDesired = new THREE.Vector3(2.5, 2.5, 8.5);
  private sph = { radius: 19, theta: Math.PI * 0.82, phi: 1.05 };
  private sphDesired = { radius: 19, theta: Math.PI * 0.82, phi: 1.05 };
  private cameraDirty = true;

  private pointers = new Map<number, { x: number; y: number }>();
  private downInfo: { x: number; y: number; button: number; time: number } | null = null;
  private panMode = false;
  private pinchDist = 0;
  private activeFloorElevation = 0.5;

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
    const neighborsGroup = new THREE.Group();
    neighborsGroup.name = "neighbor-group";
    buildStaticNeighborhood(
      this.envGroup,
      neighborsGroup,
      this.palette,
      this.contactShadowTex,
      this.staticDisposables,
    );
    this.envGroup.add(neighborsGroup);

    this.gridHelper = new THREE.GridHelper(30, 30, 0x94a3b8, 0x475569);
    this.gridHelper.position.set(2.5, 0.004, 8.5);
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.25;
    this.envGroup.add(this.gridHelper);
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
  ) {
    if (!this.webglReady || this.disposed) return;

    this.activeFloorElevation = derived.project.site.peil.floor1PeilM;
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
      ws: Math.round(sim.windSpeedMs * 10),
      wd: Math.round(sim.windDirectionDeg),
      at: Math.round(sim.ambientTempC * 2),
      rh: Math.round(sim.humidityPct),
      lg: derived.project.levels.map((l) => l.lights.map((x) => `${x.id}:${x.on}:${x.lumens}:${x.position.x.toFixed(1)},${x.position.z.toFixed(1)}`)),
      hv: derived.project.levels.map((l) => l.hvac.map((x) => `${x.id}:${x.on}:${x.speedLevel}:${x.rotationY.toFixed(2)}:${x.position.x.toFixed(1)},${x.position.z.toFixed(1)}`)),
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
  private rebuildHouse(derived: DerivedProjectModel, struct: StructuralReport, view: ViewState) {
    this.clearDyn();

    const { project, roof } = derived;
    const lt1Y = project.site.peil.floor1PeilM;
    const lt2Y = lt1Y + project.levels[0]!.height;

    const built = buildProjectHouse(derived, struct, this.palette, this.contactShadowMat, {
      stage: view.stage,
      showBricks: view.showBricks,
      showStructure: view.showStructure,
      showRoof: view.showRoof,
      showRangka: view.showRangka,
      showFinishing: view.showFinishing,
      xrayRebar: view.xrayRebar,
      showAir: view.showAir,
      showListrik: view.showListrik,
      hiddenParts: new Set(view.hiddenParts),
      activeLevelView: view.activeLevelView,
      supportWallCutaway: false,
      onExplodePiece: (obj, off) => {
        this.explodePieces.push({ obj, base: obj.position.clone(), off });
      },
      onExplodeInstanced: (im, off) => {
        this.registerExplodeInstanced(im, off);
      },
    });

    this.houseRoot.add(built.houseRoot);
    this.dynResources.push(...built.resources);
    this.pickables.push(...built.pickables);
    this.animatedFans.push(...built.animatedFans);

    // Room Labels & 3D Dimensions
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

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.downInfo = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
    this.panMode = e.button === 1 || e.button === 2 || e.shiftKey;
  };

  private onPointerMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

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

    if (this.downInfo && e.button === 0) {
      const moved = Math.hypot(e.clientX - this.downInfo.x, e.clientY - this.downInfo.y);
      if (moved < 6) {
        const picked = this.pickAt(e);
        this.callbacks.onSelect(picked ? picked.sel : null);
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
    if (this.cameraDirty) {
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
