import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { SelectionTarget, ViewState } from "@/lib/store/useStudioStore";
import { createEnvironmentMap, createMaterialPalette, createSkyGradientTexture, type MaterialPalette } from "@/lib/scene/materials";
import { buildFurnitureMesh, buildHvacMesh, buildLightFixtureMesh } from "@/lib/scene/propsBuilder";

// Enable BVH accelerated raycasting on BufferGeometry
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

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
}

export class HouseScene {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraPersp: THREE.PerspectiveCamera;
  private cameraOrtho: THREE.OrthographicCamera;
  private useOrtho = false;

  private palette: MaterialPalette;
  private skyMesh!: THREE.Mesh;
  private skyMat!: THREE.MeshBasicMaterial;
  private envTex: THREE.Texture | null = null;
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private lightningLight!: THREE.DirectionalLight;
  private gridHelper!: THREE.GridHelper;

  private houseRoot = new THREE.Group();
  private envGroup = new THREE.Group();
  private simGroup = new THREE.Group();
  private dimsGroup = new THREE.Group();
  private ghostGroup = new THREE.Group();

  private dynResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private simResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private envKey = "";

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
  private rainActiveCount = 0;
  private floodWaterMesh: THREE.Mesh | null = null;
  private lightningTimer = 0;
  private lightningEnergy = 0;

  // Orbit & Walkthrough Camera
  private target = new THREE.Vector3(2.5, 2.2, 8.5);
  private sph = { radius: 19, theta: Math.PI * 0.22, phi: 1.06 };
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
  private ro: ResizeObserver;
  private raf = 0;
  private clock = new THREE.Clock();
  private lastBuildKey = "";

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xcbd8e2, 0.008);

    this.cameraPersp = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
    this.cameraOrtho = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 300);

    this.palette = createMaterialPalette();
    this.setupClippingMaterials();
    this.setupLightingAndSky();
    this.setupStaticEnvironment();
    this.setupRainSystem();

    this.scene.add(this.envGroup);
    this.scene.add(this.houseRoot);
    this.scene.add(this.simGroup);
    this.scene.add(this.dimsGroup);
    this.scene.add(this.ghostGroup);

    const ringGeo = new THREE.RingGeometry(0.45, 0.58, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthTest: false });
    this.selectedRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectedRing.visible = false;
    this.selectedRing.renderOrder = 998;
    this.scene.add(this.selectedRing);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bindEvents();
    this.updateCameraTransform();
    this.animate();
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

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.3);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 70;
    this.sunLight.shadow.camera.left = -16;
    this.sunLight.shadow.camera.right = 16;
    this.sunLight.shadow.camera.top = 16;
    this.sunLight.shadow.camera.bottom = -16;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.sunLight.target.position.set(2.5, 2, 8.5);

    this.lightningLight = new THREE.DirectionalLight(0xdce8ff, 0);
    this.lightningLight.position.set(-10, 24, -12);
    this.scene.add(this.lightningLight);

    const skyTex = createSkyGradientTexture(10, "kemarau", 0);
    this.skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 20), this.skyMat);
    this.scene.add(this.skyMesh);
  }

  private setupStaticEnvironment() {
    // Lush Sims 4 neighborhood terrain
    const groundGeo = new THREE.PlaneGeometry(140, 140);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, this.palette.grass);
    ground.position.set(2.5, -0.05, 8.5);
    ground.receiveShadow = true;
    this.envGroup.add(ground);

    // Asphalt residential street in front of house (Z = -6.0 .. 0.0)
    const roadGeo = new THREE.BoxGeometry(90, 0.06, 6.2);
    const road = new THREE.Mesh(roadGeo, this.palette.road);
    road.position.set(2.5, -0.03, -3.2);
    road.receiveShadow = true;
    this.envGroup.add(road);

    // Drainage gutter (got depan Surabaya) along Z = -0.25
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.9 });
    const gutter = new THREE.Mesh(new THREE.BoxGeometry(20, 0.08, 0.45), gutterMat);
    gutter.position.set(2.5, -0.02, -0.25);
    gutter.receiveShadow = true;
    this.envGroup.add(gutter);

    // Studio grid
    this.gridHelper = new THREE.GridHelper(30, 30, 0x94a3b8, 0x475569);
    this.gridHelper.position.set(2.5, 0.004, 8.5);
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.28;
    this.envGroup.add(this.gridHelper);

    // Sims 4 stylized neighbor silhouettes (left X < 0, right X > 5)
    const addNeighborHouse = (cx: number, labelSide: string) => {
      const grp = new THREE.Group();
      grp.name = `neighbor-${labelSide}`;
      const body = new THREE.Mesh(new THREE.BoxGeometry(5, 7.2, 13), this.palette.neighborWall);
      body.position.set(cx, 3.6, 10.5);
      grp.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 13.8), this.palette.neighborWall);
      roof.position.set(cx, 7.45, 10.5);
      roof.rotation.x = -0.14;
      grp.add(roof);
      // Trees on street verge
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.8, 8), this.palette.woodTeak);
      trunk.position.set(cx, 1.4, -0.7);
      trunk.castShadow = true;
      grp.add(trunk);
      const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 1), this.palette.grass);
      crown.position.set(cx, 3.2, -0.7);
      crown.castShadow = true;
      grp.add(crown);
      this.envGroup.add(grp);
    };
    addNeighborHouse(-2.6, "left");
    addNeighborHouse(7.6, "right");
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
      size: 0.11,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  setCameraPreset(preset: ViewState["cameraPreset"]) {
    this.walkthroughActive = preset === "walkthrough";
    if (this.walkthroughActive) {
      this.walkPos.set(1.1, this.activeFloorElevation + 1.65, 2.0);
      this.walkYaw = 0;
      this.walkPitch = -0.04;
      this.updateCameraTransform();
      return;
    }

    this.target.set(2.5, 2.8, 8.5);
    switch (preset) {
      case "front":
        this.sph = { radius: 18, theta: Math.PI, phi: 1.38 };
        break;
      case "back":
        this.sph = { radius: 18, theta: 0, phi: 1.38 };
        break;
      case "side":
        this.sph = { radius: 22, theta: Math.PI * 0.5, phi: 1.32 };
        break;
      case "top":
        this.sph = { radius: 24, theta: Math.PI, phi: 0.08 };
        break;
      default:
        this.sph = { radius: 19, theta: Math.PI * 0.82, phi: 1.05 };
        break;
    }
    this.updateCameraTransform();
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
    this.palette.plasterExt.color.set(derived.project.simulation.paintExtHex);
    this.palette.plasterInt.color.set(derived.project.simulation.paintIntHex);
    this.palette.roofCover.color.set(derived.project.simulation.roofColorHex);
    const tileRepeat = 100 / derived.project.systems.tileSizeCm;
    this.palette.tileFloor.map?.repeat.set(tileRepeat, tileRepeat);

    // Update sky, sun, PMREM only when lighting/weather params change
    const sim = derived.project.simulation;
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

      const [sx, sy, sz] = lighting.solar.sunDir;
      this.sunLight.position.set(2.5 + sx * 28, Math.max(2, sy * 28), 8.5 + sz * 28);
      const isNight = !lighting.solar.isDaylight;
      const isStorm = sim.rainIntensityMmH > 20;
      this.sunLight.intensity = isNight ? 0.15 : isStorm ? 0.85 : 2.35;
      this.sunLight.color.set(
        isNight ? 0x6c88b8 : sim.hourOfDay < 7.5 || sim.hourOfDay > 16.5 ? 0xffcb8c : 0xfff5e0,
      );
      this.hemiLight.intensity = isNight ? 0.25 : isStorm ? 0.55 : 0.78;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set(isNight ? 0x101829 : isStorm ? 0x6f7c89 : 0xd2e1ec);
        this.scene.fog.density = isStorm ? 0.015 : 0.006;
      }
    }

    // Rain state
    if (this.rainPoints) {
      this.rainPoints.visible = view.showRain && sim.rainIntensityMmH > 0;
      const density = Math.min(1, sim.rainIntensityMmH / 120);
      this.rainActiveCount = Math.round(2400 * density);
      this.rainPoints.geometry.setDrawRange(0, this.rainActiveCount);
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

    // Rebuild simulation overlays (Lux heatmap, Airflow particles, Flood water)
    this.rebuildSimOverlays(derived, lighting, airflow, flood, view);
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
    this.floodWaterMesh = null;
    for (const r of this.simResources) r.dispose();
    this.simResources = [];
  }

  private tagPickable(obj: THREE.Object3D, sel: NonNullable<SelectionTarget>, label: string) {
    obj.userData.sel = sel;
    obj.userData.label = label;
    this.pickables.push(obj);
  }

  private addBox(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material,
    sel?: NonNullable<SelectionTarget>,
    label?: string,
    explodeOff?: [number, number, number],
  ) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.dynResources.push(geo);
    if (sel) this.tagPickable(mesh, sel, label ?? sel.id);
    if (explodeOff) {
      this.explodePieces.push({
        obj: mesh,
        base: mesh.position.clone(),
        off: new THREE.Vector3(...explodeOff),
      });
    }
    return mesh;
  }

  private rebuildHouse(derived: DerivedProjectModel, struct: StructuralReport, view: ViewState) {
    this.clearDyn();

    const { project, masonry, roof } = derived;
    const peil = project.site.peil;
    const lt1Y = peil.floor1PeilM; // e.g. +0.50m above street
    const lt2Y = lt1Y + project.levels[0]!.height;
    const stage = view.stage;
    const hidden = new Set(view.hiddenParts);

    // Stage visibility logic (stage 0 = full house; stage 1..10 = construction sequence!)
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

    // 1. Raised Peil Plinth & Carport / Terrace concrete beds
    if (stage === 0 || stage >= 1) {
      // Front Taman Depan soil bed
      this.addBox(this.houseRoot, 0.75, 0.04, 1.5, 1.5, 0.08, 3.0, this.palette.grass);
      // Carport pad at carportPeilM
      const cpH = Math.max(0.08, peil.carportPeilM);
      this.addBox(this.houseRoot, 3.25, cpH * 0.5, 2.25, 3.5, cpH, 4.5, this.palette.carport, { kind: "part", id: "lantai" }, "Carport");
      // Terrace at terracePeilM
      const trH = Math.max(0.12, peil.terracePeilM);
      this.addBox(this.houseRoot, 1.125, trH * 0.5, 3.5, 2.25, trH, 1.0, this.palette.woodDeck, { kind: "part", id: "lantai" }, "Teras Depan");
      // Entry steps from Terrace to Front Door
      if (lt1Y > trH + 0.03) {
        this.addBox(this.houseRoot, 1.58, (lt1Y + trH) * 0.25, 3.85, 1.1, (lt1Y - trH), 0.3, this.palette.tileFloor);
      }
      // Earthfill plinth under main LT1 building (X: 0..5, Z: 4..17)
      this.addBox(this.houseRoot, 2.5, lt1Y * 0.5 - 0.05, 10.5, 4.96, Math.max(0.1, lt1Y - 0.08), 13.0, this.palette.concrete, { kind: "part", id: "pondasi" }, "Urugan Peil Lantai");
    }

    // 2. Foundations (Footplates, Strauss Piles, Cakar Ayam, Batu Kali)
    if (showFnd) {
      for (const f of struct.foundations) {
        const fw = project.systems.foundation === "footplate_full" ? 1.2 : 1.0;
        this.addBox(
          this.houseRoot,
          f.x,
          -0.65,
          f.z,
          fw,
          0.32,
          fw,
          this.palette.concrete,
          { kind: "part", id: "pondasi" },
          `Pondasi ${f.id}`,
          [0, -1.6, 0],
        );
        // Pedestal neck up to sloof
        this.addBox(
          this.houseRoot,
          f.x,
          (lt1Y - 0.65) * 0.5 - 0.1,
          f.z,
          0.26,
          lt1Y + 0.45,
          0.26,
          this.palette.concrete,
          { kind: "part", id: "pondasi" },
          `Pedestal ${f.id}`,
          [0, -1.2, 0],
        );
        if (project.systems.foundation === "strauss_pile") {
          const pileGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.4, 12);
          const pile = new THREE.Mesh(pileGeo, this.palette.concrete);
          pile.position.set(f.x, -1.9, f.z);
          this.houseRoot.add(pile);
          this.dynResources.push(pileGeo);
          this.tagPickable(pile, { kind: "part", id: "pondasi" }, `Strauss Pile ${f.id}`);
        }
      }
      // Sumur Resapan SNI 03-2453 in front garden
      for (let i = 0; i < project.floodMitigation.infiltrationWells; i++) {
        const wellGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.5, 16);
        const well = new THREE.Mesh(wellGeo, this.palette.concrete);
        well.position.set(0.75, -0.7, 1.2 + i * 1.1);
        this.houseRoot.add(well);
        this.dynResources.push(wellGeo);
        this.tagPickable(well, { kind: "part", id: "sumurResapan" }, "Sumur Resapan SNI 03-2453");
      }
    }

    // 3. Structural Frame (Sloof, Columns, Main Beams, LT2 Slab, Stairs, Ring Balk)
    if (showSloofCol) {
      const colMat = project.systems.frame === "steel_wf" ? this.palette.steelWf : this.palette.concrete;
      const maxColLevel = view.activeLevelView === "lt1" ? 1 : 2;
      const colTop = maxColLevel === 1 ? lt2Y : lt2Y + project.levels[1]!.height;
      const colH = colTop - lt1Y + 0.25;

      for (const col of struct.columns) {
        const isCanopy = col.z < 1.0;
        const h = isCanopy ? lt2Y - lt1Y + 0.1 : colH;
        this.addBox(
          this.houseRoot,
          col.x,
          lt1Y - 0.15 + h * 0.5,
          col.z,
          col.widthM,
          h,
          col.depthM,
          colMat,
          { kind: "part", id: "kolom" },
          `Kolom ${col.id}`,
          [(col.x - 2.5) * 0.45, 0.5, (col.z - 8.5) * 0.15],
        );

        if (view.xrayRebar && col.isMain) {
          this.addBox(
            this.houseRoot,
            col.x,
            lt1Y - 0.15 + h * 0.5,
            col.z,
            col.widthM * 0.68,
            h + 0.1,
            col.depthM * 0.68,
            this.palette.rebar,
            { kind: "part", id: "kolom" },
            `Tulangan ${col.id} (${col.rebarSpec})`,
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
        const geo = new THREE.BoxGeometry(bm.lengthM, bm.heightM, bm.widthM);
        const mesh = new THREE.Mesh(geo, colMat);
        mesh.position.set(cx, y, cz);
        mesh.rotation.y = ang;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.houseRoot.add(mesh);
        this.dynResources.push(geo);
        this.tagPickable(mesh, { kind: "part", id: bm.kind === "sloof" ? "sloof" : bm.kind === "ring_balk" ? "ringbalk" : "balok" }, bm.kind.toUpperCase());
        this.explodePieces.push({
          obj: mesh,
          base: mesh.position.clone(),
          off: new THREE.Vector3((cx - 2.5) * 0.4, bm.levelIndex * 1.4, (cz - 8.5) * 0.15),
        });
      }
    }

    // 4. Floor Slabs (LT1 & LT2) with Void & Stair Cutouts
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
        const mat = slab.isOverhang ? this.palette.woodDeck : showTileFloor ? this.palette.tileFloor : this.palette.concrete;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = lt2Y - slab.thickness;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.houseRoot.add(mesh);
        this.dynResources.push(geo);
        this.tagPickable(mesh, { kind: "part", id: "pelat" }, slab.name);
        this.explodePieces.push({ obj: mesh, base: mesh.position.clone(), off: new THREE.Vector3(0, 1.5, 0) });
      }
    }

    // LT1 Tile Floor per room
    if (showTileFloor) {
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
        const mat = rm.isWetRoom
          ? this.palette.tileWet
          : rm.room.floorMaterialId === "wood_deck"
            ? this.palette.woodDeck
            : rm.room.floorMaterialId === "tile_wood_warm"
              ? this.palette.tileWood
              : this.palette.tileFloor;
        const yOff = rm.room.program === "circulation" ? peil.terracePeilM + 0.005 : lt1Y - 0.025;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = yOff;
        mesh.receiveShadow = true;
        this.houseRoot.add(mesh);
        this.dynResources.push(geo);
        this.tagPickable(mesh, { kind: "part", id: "lantai" }, `Lantai ${rm.room.name}`);
      }
    }

    // 5. Staircase (20 steps LT1 -> LT2) + Safety Glass/Steel Railings (Stair, Balcony, Void)
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
        const stepGeo = new THREE.BoxGeometry(stepRun + 0.02, stepRise, st.width);
        const step = new THREE.Mesh(stepGeo, this.palette.woodTeak);
        step.position.set(sx, sy, sz);
        step.rotation.y = ang;
        step.castShadow = true;
        step.receiveShadow = true;
        this.houseRoot.add(step);
        this.dynResources.push(stepGeo);
        this.tagPickable(step, { kind: "part", id: "tangga" }, st.name);
      }
    }
    if (view.activeLevelView !== "lt1") {
      // Stair railing (X = 1.35, Z = 7.5..12.5) + Balcony railing + Rear Void railing
      this.addBox(this.houseRoot, 1.35, lt2Y + 0.5, 10.0, 0.04, 1.0, 4.9, this.palette.glass, { kind: "part", id: "tangga" }, "Railing Tangga");
      this.addBox(this.houseRoot, 1.35, lt2Y + 1.0, 10.0, 0.06, 0.05, 4.95, this.palette.aluDark);
      this.addBox(this.houseRoot, 1.25, lt2Y + 0.5, 3.04, 2.45, 1.0, 0.04, this.palette.glass, { kind: "part", id: "pelat" }, "Railing Balkon");
      this.addBox(this.houseRoot, 1.25, lt2Y + 1.0, 3.04, 2.5, 0.05, 0.06, this.palette.aluDark);
    }

    // 6. Brick-by-Brick Masonry InstancedMesh (Supports custom dimensions L x H x T!)
    if (showBricks && masonry.bricks.length > 0) {
      const unitGeo = new THREE.BoxGeometry(1, 1, 1);
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
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        const off = new Float32Array(list.length * 3);

        list.forEach((b, i) => {
          const baseY = b.levelIndex === 0 ? lt1Y : lt2Y;
          pos.set(b.x, baseY + b.y + b.hgt * 0.5, b.z);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotY);
          scl.set(b.len, b.hgt, b.thick);
          m4.compose(pos, q, scl);
          im.setMatrixAt(i, m4);

          off[i * 3] = (b.x - 2.5) * 0.65;
          off[i * 3 + 1] = b.levelIndex * 1.4 + (b.y * 0.35);
          off[i * 3 + 2] = (b.z - 8.5) * 0.25;
        });
        im.instanceMatrix.needsUpdate = true;
        this.houseRoot.add(im);
        this.tagPickable(im, { kind: "part", id: "dinding" }, label);
        this.registerExplodeInstanced(im, off);
      };

      buildBrickIM(outerB, this.palette.brickOuter, `Dinding Bata Luar (${project.systems.brick.name})`);
      buildBrickIM(innerB, this.palette.brickInner, `Sekat Bata Dalam (${project.systems.brick.name})`);
    }

    // 7. Plaster & Paint Facade Walls + Openings (Doors, Windows, Roster Vents)
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

        // Plaster/Paint wall skin (using ExtrudeGeometry with opening holes!)
        if (showPlasterPaint) {
          const extra0 = lv.index === 1 && w.exterior && w.height >= 2.8 ? roof.extraWallHeightAt(1, w.start.x, w.start.z) : 0;
          const extra1 = lv.index === 1 && w.exterior && w.height >= 2.8 ? roof.extraWallHeightAt(1, w.end.x, w.end.z) : 0;
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
          const geo = new THREE.ExtrudeGeometry(wallShape, { depth: skinThickness, bevelEnabled: false });
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

        // Openings (Kusen, Door Panels, Window Glass, Roster Vents)
        if (showOpenings) {
          for (const op of w.openings) {
            const cx = w.start.x + ux * op.offset;
            const cz = w.start.z + uz * op.offset;
            const opGroup = new THREE.Group();
            opGroup.position.set(cx, baseLvY + op.sill, cz);
            opGroup.rotation.y = ang;

            if (op.kind === "door") {
              // Door frame + teak leaf rotated by openPct
              const ft = 0.05;
              const fd = w.thickness + 0.03;
              this.addBox(opGroup, -op.width * 0.5 + ft * 0.5, op.height * 0.5, 0, ft, op.height, fd, this.palette.woodTeak);
              this.addBox(opGroup, op.width * 0.5 - ft * 0.5, op.height * 0.5, 0, ft, op.height, fd, this.palette.woodTeak);
              this.addBox(opGroup, 0, op.height - ft * 0.5, 0, op.width, ft, fd, this.palette.woodTeak);

              const pivot = new THREE.Group();
              pivot.position.set(-op.width * 0.5 + ft, 0, 0);
              pivot.rotation.y = op.swing * ((op.openPct / 100) * Math.PI * 0.48);
              const leafMat = op.width > 1.3 ? this.palette.glass : this.palette.woodTeak;
              this.addBox(pivot, (op.width - ft * 2) * 0.5, (op.height - ft) * 0.5, 0, op.width - ft * 2, op.height - ft, 0.04, leafMat);
              this.addBox(pivot, op.width - ft * 3.5, 1.0, 0.03, 0.03, 0.14, 0.04, this.palette.steelLight);
              opGroup.add(pivot);
              this.tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lv.index }, op.label);
            } else if (op.kind === "window") {
              const ft = 0.045;
              const fd = w.thickness + 0.03;
              this.addBox(opGroup, -op.width * 0.5 + ft * 0.5, op.height * 0.5, 0, ft, op.height, fd, this.palette.aluDark);
              this.addBox(opGroup, op.width * 0.5 - ft * 0.5, op.height * 0.5, 0, ft, op.height, fd, this.palette.aluDark);
              this.addBox(opGroup, 0, op.height - ft * 0.5, 0, op.width, ft, fd, this.palette.aluDark);
              this.addBox(opGroup, 0, ft * 0.5, 0, op.width, ft, fd, this.palette.aluDark);
              // Mullion & glass pane
              if (op.width > 1.0) this.addBox(opGroup, 0, op.height * 0.5, 0, 0.035, op.height - ft * 2, 0.04, this.palette.aluDark);
              this.addBox(opGroup, 0, op.height * 0.5, 0, op.width - ft * 2, op.height - ft * 2, 0.015, this.palette.glass);
              this.tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lv.index }, op.label);
            } else if (op.kind === "vent") {
              const cells = Math.max(1, Math.round(op.width / 0.2));
              const cw = op.width / cells;
              for (let c = 0; c < cells; c++) {
                const lx = -op.width * 0.5 + (c + 0.5) * cw;
                this.addBox(opGroup, lx, op.height * 0.5, 0, cw - 0.02, op.height, w.thickness + 0.015, this.palette.concrete);
              }
              this.tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lv.index }, op.label);
            }
            this.houseRoot.add(opGroup);
          }
        }
      }
    }

    // 8. Roof Structure (Shed 10° Forward / Shed Back / Gable / Hip / Flat Deck) + Carport Canopy + Gutter + Downspouts
    if ((showTruss || showRoofCover) && view.activeLevelView !== "lt1") {
      const spanX = roof.maxX - roof.minX;
      const spanZ = roof.maxZ - roof.minZ;
      const midX = (roof.minX + roof.maxX) * 0.5;
      const midZ = (roof.minZ + roof.maxZ) * 0.5;
      const slopeRad = (roof.slopeDeg * Math.PI) / 180;

      if (showTruss) {
        for (let i = 0; i < roof.trussCount; i++) {
          const z = roof.minZ + (i / Math.max(1, roof.trussCount - 1)) * spanZ;
          const h = roof.heightAt(midX, z);
          this.addBox(this.houseRoot, midX, h - 0.08, z, spanX - 0.1, 0.06, 0.05, this.palette.steelLight, { kind: "part", id: "rangka" }, "Rangka Baja Ringan C75", [0, 2.2, 0]);
        }
      }

      if (showRoofCover) {
        // Main upper roof planes (left/main section excluding rear open void 1.7..5.0, 15.35..17.0)
        if (roof.roofType === "shed_front" || roof.roofType === "shed_back" || roof.roofType === "flat_deck") {
          const sign = roof.roofType === "shed_front" ? -1 : 1;
          const avgY = (roof.heightAt(midX, roof.minZ) + roof.heightAt(midX, roof.maxZ)) * 0.5 + 0.08;
          const lenSloped = spanZ / Math.cos(slopeRad);
          const geo = new THREE.BoxGeometry(spanX, 0.07, lenSloped);
          const roofMesh = new THREE.Mesh(geo, this.palette.roofCover);
          roofMesh.position.set(midX, avgY, midZ);
          roofMesh.rotation.x = sign * slopeRad;
          roofMesh.castShadow = true;
          roofMesh.receiveShadow = true;
          this.houseRoot.add(roofMesh);
          this.dynResources.push(geo);
          this.tagPickable(roofMesh, { kind: "part", id: "genteng" }, `Atap ${roof.roofType} (${roof.slopeDeg}°)`);
          this.explodePieces.push({ obj: roofMesh, base: roofMesh.position.clone(), off: new THREE.Vector3(0, 3.0, 0) });
        } else {
          // Gable / Hip twin slope
          const halfX = spanX * 0.5;
          const slopeLen = halfX / Math.cos(slopeRad);
          for (const sgn of [-1, 1]) {
            const g = new THREE.BoxGeometry(slopeLen, 0.07, spanZ);
            const m = new THREE.Mesh(g, this.palette.roofCover);
            m.position.set(midX + sgn * halfX * 0.5, lt2Y + 3.6 + halfX * 0.5 * roof.pitch + 0.08, midZ);
            m.rotation.z = -sgn * slopeRad;
            m.castShadow = true;
            this.houseRoot.add(m);
            this.dynResources.push(g);
            this.tagPickable(m, { kind: "part", id: "genteng" }, `Bidang Atap ${roof.roofType}`);
          }
        }

        // Central Stair Skylight Glass Box (X: 0.1..1.35, Z: 8.5..11.0)
        const skyY = roof.heightAt(0.7, 9.8) + 0.16;
        this.addBox(this.houseRoot, 0.72, skyY, 9.75, 1.15, 0.06, 2.2, this.palette.glass, { kind: "part", id: "plafon" }, "Skylight Tangga");

        // Front Gutter (Talang Depan at minZ) + 2 Downspouts
        const eaveY = roof.heightAt(midX, roof.minZ) - 0.04;
        this.addBox(this.houseRoot, midX, eaveY, roof.minZ + 0.05, spanX, 0.14, 0.18, this.palette.aluDark, { kind: "part", id: "talang" }, "Talang Utama Depan");
        for (const dx of [0.16, project.site.width - 0.16]) {
          const pipeGeo = new THREE.CylinderGeometry(0.045, 0.045, eaveY, 10);
          const pipe = new THREE.Mesh(pipeGeo, this.palette.aluDark);
          pipe.position.set(dx, eaveY * 0.5, roof.minZ + 0.25);
          this.houseRoot.add(pipe);
          this.dynResources.push(pipeGeo);
          this.tagPickable(pipe, { kind: "part", id: "talang" }, "Pipa Turun Hujan (Downspout)");
        }

        // Carport + Terrace Lower Tropical Shed Canopy (Z: -0.4 .. 4.5, sloping forward)
        const cpAvgY = lt2Y - 0.35;
        const cpGeo = new THREE.BoxGeometry(project.site.width, 0.07, 4.95);
        const cpRoof = new THREE.Mesh(cpGeo, this.palette.roofCover);
        cpRoof.position.set(2.5, cpAvgY, 2.05);
        cpRoof.rotation.x = -0.14;
        cpRoof.castShadow = true;
        cpRoof.receiveShadow = true;
        this.houseRoot.add(cpRoof);
        this.dynResources.push(cpGeo);
        this.tagPickable(cpRoof, { kind: "part", id: "genteng" }, "Kanopi Carport & Teras");
      }
    }

    // 9. Furniture, Movable HVAC (AC/Fans), & Lights
    if (showProps) {
      for (const lv of project.levels) {
        if (lv.index === 1 && view.activeLevelView === "lt1") continue;
        const baseY = lv.index === 0 ? lt1Y : lt2Y;
        const lvGrp = new THREE.Group();
        lvGrp.position.y = baseY;

        for (const f of lv.furniture) {
          const mesh = buildFurnitureMesh(f, this.palette, this.dynResources);
          lvGrp.add(mesh);
          this.tagPickable(mesh, { kind: "furniture", id: f.id, levelIndex: lv.index }, f.name);
        }

        for (const hv of lv.hvac) {
          const mesh = buildHvacMesh(hv, this.palette, this.dynResources, this.animatedFans);
          lvGrp.add(mesh);
          this.tagPickable(mesh, { kind: "hvac", id: hv.id, levelIndex: lv.index }, hv.name);
        }

        for (const l of lv.lights) {
          const mesh = buildLightFixtureMesh(l, this.palette, this.dynResources);
          lvGrp.add(mesh);
          this.tagPickable(mesh, { kind: "light", id: l.id, levelIndex: lv.index }, l.name);
          if (l.on && l.dimmer > 0) {
            const ptLight = new THREE.PointLight(
              l.colorTempK <= 3200 ? 0xffcb85 : 0xfff3de,
              (l.lumens / 700) * l.dimmer * 1.4,
              7.5,
              1.6,
            );
            ptLight.position.set(l.position.x, l.position.y - 0.12, l.position.z);
            lvGrp.add(ptLight);
          }
        }
        this.houseRoot.add(lvGrp);
      }
    }

    // 10. MEP X-Ray Overlay (Air Bersih, Air Kotor, Listrik, Septic, Resapan)
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
          this.tagPickable(
            mesh,
            { kind: "part", id: isAir ? "pipaAirBersih" : "listrikLampu" },
            rt.label,
          );
        }
      }
      // Bio Septic Tank under Carport
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

  private rebuildSimOverlays(
    derived: DerivedProjectModel,
    lighting: LightingSimulationResult,
    airflow: AirflowSimulationResult,
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
          // dark indigo -> teal -> warm amber -> bright white-yellow
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

    // 3. Realistic 3D Flood Water Surface (street + carport + inside LT1 if breached)
    if (view.showFloodWater && flood.streetFloodCm > 0) {
      const streetWaterY = flood.streetFloodCm / 100;
      // Exterior street + front yard + carport water plane (Z = -6.5 .. 4.5)
      const extGeo = new THREE.PlaneGeometry(24, 11.2, 24, 16);
      extGeo.rotateX(-Math.PI / 2);
      const extMesh = new THREE.Mesh(extGeo, this.palette.floodWater);
      extMesh.position.set(2.5, streetWaterY, -1.0);
      extMesh.renderOrder = 600;
      this.floodWaterMesh = extMesh;
      this.simGroup.add(extMesh);
      this.simResources.push(extGeo);

      // Rear garden water level if drainage backed up
      if (flood.lt1FloorFloodCm > 0 || flood.carportFloodCm > 5) {
        const insideWaterY = lt1Y + flood.lt1FloorFloodCm / 100;
        if (flood.lt1FloorFloodCm > 0) {
          const inGeo = new THREE.PlaneGeometry(4.9, 13.0, 12, 20);
          inGeo.rotateX(-Math.PI / 2);
          const inMesh = new THREE.Mesh(inGeo, this.palette.floodWater);
          inMesh.position.set(2.5, insideWaterY, 10.5);
          inMesh.renderOrder = 601;
          this.simGroup.add(inMesh);
          this.simResources.push(inGeo);
        }
      }

      // Visual door flood barrier board at front door & rear sliding door if active
      if (derived.project.floodMitigation.doorFloodBarrier) {
        const bh = derived.project.floodMitigation.barrierHeightCm / 100;
        const barMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.35, metalness: 0.65 });
        const barGeo = new THREE.BoxGeometry(1.05, bh, 0.06);
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
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, m4);
      m4.decompose(v, q, s);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      quat[i * 4] = q.x;
      quat[i * 4 + 1] = q.y;
      quat[i * 4 + 2] = q.z;
      quat[i * 4 + 3] = q.w;
      scl[i * 3] = s.x;
      scl[i * 3 + 1] = s.y;
      scl[i * 3 + 2] = s.z;
    }
    this.explodeInstanced.push({ im, n, pos, off, quat, scl });
  }

  private applyExplode(k: number) {
    const e = THREE.MathUtils.clamp(k, 0, 1);
    for (const p of this.explodePieces) {
      p.obj.position.copy(p.base).addScaledVector(p.off, e);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const im of this.explodeInstanced) {
      for (let i = 0; i < im.n; i++) {
        q.set(im.quat[i * 4]!, im.quat[i * 4 + 1]!, im.quat[i * 4 + 2]!, im.quat[i * 4 + 3]!);
        v.set(im.pos[i * 3]! + im.off[i * 3]! * e, im.pos[i * 3 + 1]! + im.off[i * 3 + 1]! * e, im.pos[i * 3 + 2]! + im.off[i * 3 + 2]! * e);
        s.set(im.scl[i * 3]!, im.scl[i * 3 + 1]!, im.scl[i * 3 + 2]!);
        m4.compose(v, q, s);
        im.im.setMatrixAt(i, m4);
      }
      im.im.instanceMatrix.needsUpdate = true;
    }
  }

  private applyWireframe(wf: boolean) {
    this.houseRoot.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
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
    if (this.walkthroughActive) {
      this.cameraPersp.position.copy(this.walkPos);
      const look = new THREE.Vector3(
        this.walkPos.x + Math.sin(this.walkYaw) * Math.cos(this.walkPitch),
        this.walkPos.y + Math.sin(this.walkPitch),
        this.walkPos.z + Math.cos(this.walkYaw) * Math.cos(this.walkPitch),
      );
      this.cameraPersp.lookAt(look);
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
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.cameraPersp.aspect = w / h;
    this.cameraPersp.updateProjectionMatrix();
    this.updateCameraTransform();
  }

  private getPointerNdc(e: PointerEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
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
    this.dragPlane.set(new THREE.Vector3(0, 1, 0), -yFloor);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.dragPlane, pt);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.downInfo = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
    this.panMode = e.button === 1 || e.button === 2 || e.shiftKey;

    if (e.button === 0 && !this.panMode) {
      // Check if clicking an already-selected movable entity (Sims 4 drag-to-move!)
      const picked = this.pickAt(e);
      if (
        picked?.sel &&
        (picked.sel.kind === "furniture" || picked.sel.kind === "hvac" || picked.sel.kind === "light") &&
        this.selectedTarget &&
        picked.sel.id === this.selectedTarget.id
      ) {
        this.draggingEntity = picked.sel;
        const floorPt = this.intersectFloorPlane(e);
        if (floorPt) {
          this.dragOffset.copy(floorPt);
        }
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Dragging movable furniture / AC / fan / light in 3D
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
        this.sph.radius = THREE.MathUtils.clamp(this.sph.radius * (this.pinchDist / d), 4, 55);
        this.updateCameraTransform();
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
        const forward = new THREE.Vector3();
        this.cameraPersp.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const scale = this.sph.radius * 0.0014;
        this.target.addScaledVector(right, -dx * scale);
        this.target.addScaledVector(forward, dy * scale);
      } else {
        this.sph.theta -= dx * 0.007;
        this.sph.phi = THREE.MathUtils.clamp(this.sph.phi - dy * 0.007, 0.06, Math.PI * 0.48);
      }
      this.updateCameraTransform();
      return;
    }

    // Hover feedback
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
    this.sph.radius = THREE.MathUtils.clamp(this.sph.radius * (1 + e.deltaY * 0.001), 4, 58);
    this.updateCameraTransform();
  };

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

  private bindEvents() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());

    // Smooth Exploded View interpolation
    if (Math.abs(this.explodeCurrent - this.explodeTarget) > 0.001) {
      this.explodeCurrent += (this.explodeTarget - this.explodeCurrent) * Math.min(1, dt * 8);
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
    for (const rotor of this.animatedFans) {
      rotor.rotation.y += dt * 7.5;
    }

    // Advect Airflow Particles
    if (this.airParticlesMesh && this.lastAirflow && this.airParticleStates.length > 0) {
      const af = this.lastAirflow;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const s = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
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
        // Stack effect lift at rear void & stair
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

        v.set(p.x, p.y, p.z);
        const yaw = Math.atan2(vx, vz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        m4.compose(v, q, s);
        this.airParticlesMesh.setMatrixAt(i, m4);

        // Color by temperature: cool AC blue (#38bdf8) -> fresh cyan (#34d399) -> warm orange (#fb923c)
        const tNorm = Math.max(0, Math.min(1, (temp - 23) / 10));
        col.setRGB(0.2 + tNorm * 0.78, 0.76 - tNorm * 0.25, 0.96 - tNorm * 0.72);
        this.airParticlesMesh.setColorAt(i, col);
      }
      this.airParticlesMesh.instanceMatrix.needsUpdate = true;
      if (this.airParticlesMesh.instanceColor) this.airParticlesMesh.instanceColor.needsUpdate = true;
    }

    // Animate Rain & Lightning
    if (this.rainPoints && this.rainPoints.visible && this.rainArray) {
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
          this.lightningEnergy = 3.2;
        }
      }
    }
    if (this.lightningEnergy > 0.01) {
      this.lightningEnergy *= Math.exp(-dt * 10);
      this.lightningLight.intensity = this.lightningEnergy;
    } else {
      this.lightningLight.intensity = 0;
    }

    // Subtle flood water ripple
    if (this.floodWaterMesh) {
      const t = this.clock.elapsedTime;
      this.floodWaterMesh.rotation.z = Math.sin(t * 1.4) * 0.002;
    }

    const cam = this.useOrtho ? this.cameraOrtho : this.cameraPersp;
    this.renderer.render(this.scene, cam);
  };

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.clearDyn();
    this.clearSim();
    this.envTex?.dispose();
    this.skyMat.map?.dispose();
    this.skyMat.dispose();
    this.skyMesh.geometry.dispose();
    this.selectedRing.geometry.dispose();
    (this.selectedRing.material as THREE.Material).dispose();
    this.rainPoints?.geometry.dispose();
    (this.rainPoints?.material as THREE.Material)?.dispose();
    this.palette.dispose();
    this.renderer.dispose();
  }
}
