import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BuildCameraController } from "@/features/buildMode/BuildCameraController";
import { AtmospherePass } from "@/features/buildMode/AtmospherePass";
import {
  applyTerrainBrushToHeights,
  computeProjectRoomFloodCells,
  createOpeningForWall,
  findRoomAtPoint,
  getStairSpan,
  isWallCutawayCandidate,
  snapOpeningToProjectWalls,
  snapWallEndpoint,
  validateProjectStairPlacement,
  worldToGridVertex,
  type GridPoint,
} from "@/features/buildMode/geometryUtils";
import { validateObjectFootprint, validatePoolPlacement } from "@/features/buildMode/placementValidator";
import { UNIFIED_BUILD_CATALOG } from "@/features/buildMode/projectCatalog";
import type { FloorBrushMode, TerrainBrushMode, WallPaintMode } from "@/features/buildMode/store";
import type {
  BuildCatalogEntry,
  BuildToolId,
  RoofVisibilityMode,
  WallVisibilityMode,
} from "@/features/buildMode/types";
import { simsAudio } from "@/lib/audio/simsAudio";
import { AdaptiveRenderGovernor } from "@/lib/scene/adaptiveQuality";
import { isIndoorRoomProgram, pointInPolygon } from "@/lib/geometry/rooms";
import { computeRoofMetrics } from "@/lib/geometry/roofAndStairs";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type {
  FurnitureCategory,
  FurnitureItem,
  HvacType,
  HvacUnit,
  LightFixture,
  LightType,
  Opening,
  RoofType,
  Room,
  Stair,
  Vec2,
  Wall,
} from "@/lib/model/types";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import { createChamferBox, createContactShadowTexture, mergeGeometryBatch } from "@/lib/scene/geometryHelpers";
import { createEnvironmentMap, createMaterialPalette, createSkyGradientTexture, makeSunSpriteTexture, type MaterialPalette } from "@/lib/scene/materials";
import {
  buildProjectFurnitureObject,
  buildProjectHouse,
  buildProjectHvacObject,
  buildProjectLightObject,
  buildStaticNeighborhood,
  type BrickWallBatch,
  type ColumnCutawayRecord,
  type WallCutawayRecord,
} from "@/lib/scene/projectHouseBuilder";
import { buildFurnitureMesh, buildHvacMesh, buildLightFixtureMesh } from "@/lib/scene/propsBuilder";
import type { SelectionTarget, ViewState } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";

export type BuildQualityTier = "auto" | "high" | "medium" | "low";

export interface BuildSceneStats {
  fps: number;
  tier: "high" | "medium" | "low";
  dpr: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface BuildSceneActions {
  onSelect: (sel: SelectionTarget) => void;
  onHoverCell: (gx: number, gz: number, worldX: number, worldZ: number, inBounds: boolean) => void;
  onHoverPart?: (label: string | null, x: number, y: number) => void;
  onPreviewHud: (hud: { label: string; valid: boolean } | null) => void;
  onEyedropCatalog: (catalogId: string, swatchHex?: string | null) => void;
  onStats?: (stats: BuildSceneStats) => void;
  // Direct Single-Source-of-Truth Project Mutations
  onAddWall: (lv: 0 | 1, wall: Wall) => void;
  onAddRoomAndWalls: (lv: 0 | 1, walls: Wall[], room?: Room) => void;
  onUpdateWall: (lv: 0 | 1, wallId: string, patch: Partial<Wall>) => void;
  onPushPullWall?: (lv: 0 | 1, wallId: string, deltaNormalM: number, altFree?: boolean) => void;
  onPaintRoomWalls?: (lv: 0 | 1, roomId: string, materialId: string) => void;
  onDeleteWall: (lv: 0 | 1, wallId: string) => void;
  onDeleteWallsBatch?: (lv: 0 | 1, wallIds: string[]) => void;
  onAddOpening: (lv: 0 | 1, wallId: string, op: ReturnType<typeof createOpeningForWall>) => void;
  onUpdateOpening?: (lv: 0 | 1, wallId: string, opId: string, patch: Partial<Opening>) => void;
  onDeleteOpening: (lv: 0 | 1, wallId: string, opId: string) => void;
  onPaintRoomFloor: (lv: 0 | 1, roomId: string, matId: string) => void;
  onDeleteRoom?: (lv: 0 | 1, roomId: string) => void;
  onSetFloorTiles: (tiles: { levelIndex: number; gx: number; gz: number; materialId: string }[]) => void;
  onDeleteFloorTile?: (lv: 0 | 1, gx: number, gz: number) => void;
  onDeleteFloorTilesBatch?: (tiles: { levelIndex: number; gx: number; gz: number }[]) => void;
  onAddStair: (lv: 0 | 1, stair: Stair, voidPoly: { x: number; z: number }[]) => void;
  onDeleteStair: (lv: 0 | 1, stairId: string) => void;
  onAddFurniture: (lv: 0 | 1, item: FurnitureItem) => void;
  onMoveFurniture: (lv: 0 | 1, id: string, pos: { x: number; y: number; z: number }, rotationY?: number) => void;
  onDeleteFurniture: (lv: 0 | 1, id: string) => void;
  onAddHvac: (lv: 0 | 1, item: HvacUnit) => void;
  onMoveHvac: (lv: 0 | 1, id: string, pos: { x: number; y: number; z: number }, rotationY?: number) => void;
  onDeleteHvac: (lv: 0 | 1, id: string) => void;
  onAddLight: (lv: 0 | 1, light: LightFixture) => void;
  onMoveLight: (lv: 0 | 1, id: string, pos: { x: number; y: number; z: number }, rotationY?: number) => void;
  onDeleteLight: (lv: 0 | 1, id: string) => void;
  onAddPool: (pool: { id: string; gx1: number; gz1: number; gx2: number; gz2: number; depth: number }) => void;
  onDeletePool: (poolId: string) => void;
  onSetTerrainHeights: (heights: number[]) => void;
  onPlacementCommitted?: (tool: BuildToolId, keepTool: boolean) => void;
}

export interface BuildViewOptions {
  activeLevel: 0 | 1 | 2;
  wallVisibility: WallVisibilityMode;
  roofVisibility: RoofVisibilityMode;
  gridVisible: boolean;
  snap90Enabled: boolean;
  edgeScrollEnabled: boolean;
  neighborsVisible: boolean;
  showBricksOverlay: boolean;
  activeTool: BuildToolId;
  selectedCatalogId: string;
  selectedSwatchHex?: string | null;
  floorBrushMode: FloorBrushMode;
  terrainBrushMode: TerrainBrushMode;
  wallPaintMode?: WallPaintMode;
  placementRotationStep: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  placementFlipSwing?: 1 | -1;
  pendingRoofType?: RoofType | null;
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

/**
 * Full-Fidelity PBR Sims 4 Build Mode Viewport backed strictly by the shared `Project` single source of truth.
 */
export class BuildScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly actions: BuildSceneActions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  public readonly cameraCtrl: BuildCameraController;

  private readonly palette: MaterialPalette;
  private readonly skyMesh: THREE.Mesh;
  private readonly skyMat: THREE.MeshBasicMaterial;
  private envTex: THREE.Texture | null = null;
  private readonly contactShadowTex: THREE.CanvasTexture;
  private readonly contactShadowMat: THREE.MeshBasicMaterial;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly lightningLight: THREE.DirectionalLight;

  private readonly envGroup = new THREE.Group();
  private readonly neighborsGroup = new THREE.Group();
  private readonly houseContainer = new THREE.Group();
  private readonly propsContainer = new THREE.Group();
  private readonly propLevelRoots: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  private readonly simGroup = new THREE.Group();
  private readonly dimsGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly previewGroup = new THREE.Group();
  private readonly selectedRing: THREE.Mesh;
  private readonly pushPullGizmoGroup = new THREE.Group();
  private roomOutlineLoop: THREE.LineLoop | null = null;
  private liveTerrainTempMesh: THREE.Mesh | null = null;

  private staticDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private dynResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private simResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private propEntries = new Map<
    string,
    {
      sig: string;
      lvIdx: 0 | 1;
      root: THREE.Object3D;
      resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[];
      fanBlades: THREE.Object3D[];
    }
  >();
  private ghostCache = new Map<
    string,
    { group: THREE.Group; tintMeshes: THREE.Mesh[]; disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] }
  >();
  private levelRoots: [THREE.Group, THREE.Group] | null = null;
  private lt2StructuralGroup: THREE.Group | null = null;
  private roofGroup: THREE.Group | null = null;
  private wallCutawayRecords: WallCutawayRecord[] = [];
  private columnCutawayRecords: ColumnCutawayRecord[] = [];
  private brickBatches: BrickWallBatch[] = [];
  private brickExplodeMap = new Map<THREE.InstancedMesh, { n: number; pos: Float32Array; quat: Float32Array; scl: Float32Array }>();
  private houseAnimatedFans: THREE.Object3D[] = [];
  private animatedFans: THREE.Object3D[] = [];
  private airParticlesMesh: THREE.InstancedMesh | null = null;
  private airParticleStates: { x: number; y: number; z: number; lv: 0 | 1; life: number }[] = [];

  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
  private explodePieces: { obj: THREE.Object3D; base: THREE.Vector3; off: THREE.Vector3 }[] = [];
  private explodeInstanced: { im: THREE.InstancedMesh; n: number; pos: Float32Array; off: Float32Array; quat: Float32Array; scl: Float32Array }[] = [];
  private explodeCurrent = 0;
  private explodeTarget = 0;

  private rainPoints: THREE.Points | null = null;
  private rainTex: THREE.CanvasTexture | null = null;
  private rainArray: Float32Array | null = null;
  private rainActiveCount = 0;
  private lightningTimer = 0;
  private lightningEnergy = 0;
  private simElapsedS = 0;
  private lastRainMmH = 0;

  private gridMesh: THREE.LineSegments | null = null;
  private hoverTileMesh: THREE.Mesh | null = null;

  private derived: DerivedProjectModel | null = null;
  private struct: StructuralReport | null = null;
  private lighting: LightingSimulationResult | null = null;
  private airflow: AirflowSimulationResult | null = null;
  private flood: FloodSimulationResult | null = null;
  private studioView: ViewState | null = null;
  private selected: SelectionTarget = null;
  private envKey = "";
  private buildSignature = "";
  private propsSignature = "";
  private simSignature = "";
  private lastCutawayYaw = Number.NaN;
  private lastCutawayKey = "";

  private readonly _m4 = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _v1 = new THREE.Vector3();
  private readonly _s1 = new THREE.Vector3(1, 1, 1);
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _col = new THREE.Color();
  private readonly _tmpNorm = new THREE.Vector3();
  private readonly _hoverBox = new THREE.Box3();
  private readonly _hoverSize = new THREE.Vector3();
  private readonly _hoverCenter = new THREE.Vector3();
  private readonly hoverBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  private hoverHighlightMesh: THREE.Mesh;

  private viewOpts: BuildViewOptions = {
    activeLevel: 0,
    wallVisibility: "cutaway",
    roofVisibility: "auto",
    gridVisible: true,
    snap90Enabled: false,
    edgeScrollEnabled: false,
    neighborsVisible: true,
    showBricksOverlay: false,
    activeTool: "select",
    selectedCatalogId: "tool_select",
    selectedSwatchHex: null,
    floorBrushMode: "fill",
    terrainBrushMode: "raise",
    wallPaintMode: "side",
    placementRotationStep: 0,
    placementFlipSwing: 1,
    pendingRoofType: null,
  };

  // Interactive Tool Drag / Move State
  private dragStartVertex: GridPoint | null = null;
  private dragStartCell: GridPoint | null = null;
  private sledgeDragStart: { x: number; z: number } | null = null;
  private brushStrokeCells = new Map<string, { levelIndex: number; gx: number; gz: number; materialId: string }>();
  private terrainScratch: number[] | null = null;
  private isBrushDown = false;
  private draggingEntity: SelectionTarget = null;
  private draggingMesh: THREE.Object3D | null = null;
  private dragPendingCommit: {
    kind: "furniture" | "hvac" | "light";
    lvIdx: 0 | 1;
    id: string;
    label: string;
    pos: { x: number; y: number; z: number };
    rotationY?: number;
    origPos: { x: number; y: number; z: number };
    origRotY?: number;
    origMeshPos: THREE.Vector3;
    origMeshRotY: number;
    yRenderOffset: number;
  } | null = null;
  private pushPullDragState: {
    lvIdx: 0 | 1;
    wallId: string;
    startWorldX: number;
    startWorldZ: number;
    midX: number;
    midZ: number;
    nx: number;
    nz: number;
    len: number;
    height: number;
    thickness: number;
    baseY: number;
    deltaM: number;
  } | null = null;
  private openingDragState: {
    lvIdx: 0 | 1;
    wallId: string;
    opId: string;
    width: number;
    height: number;
    sill: number;
    label: string;
    origOffset: number;
    nextWallId: string;
    nextOffset: number;
    nextWorldX: number;
    nextWorldZ: number;
    nextYaw: number;
    valid: boolean;
    reason?: string;
  } | null = null;
  private qualityOverride: BuildQualityTier = "auto";
  private activeTier: "high" | "medium" | "low" = "high";
  private readonly mobileViewport: boolean;
  /** True when the WebGL renderer is a software rasterizer (SwiftShader/llvmpipe): cinematic stack stays off. */
  private readonly softwareGpu: boolean;
  private baseDpr = 1;
  private currentDpr = 1;
  private lastDprCheckMs = 0;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private gtaoPass: GTAOPass | null = null;
  private atmospherePass: AtmospherePass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private postActive = false;
  /** Cinematic "ray-traced look" stack: HDR MSAA → GTAO → sun shafts → bloom → ACES. */
  private rayTracingEnabled = true;
  /**
   * Hysteresis governor for the auto quality tier. The naive threshold logic
   * ping-ponged high↔medium on GPUs that sit between 34 and 54fps with the stack
   * on, and every switch reset `canvas.width` → black flicker.
   */
  private readonly tierGovernor = new AdaptiveRenderGovernor({
    lowFps: 34,
    highFps: 54,
    downWindows: 2,
    upWindows: 3,
    downCooldownMs: 8_000,
    upCooldownMs: 30_000,
  });
  /** Last size/DPR actually pushed to the renderer — redundant setSize calls reset the canvas to black. */
  private lastAppliedSize = { w: 0, h: 0, dpr: 0 };
  /** Set once the first frame has been painted; lets handleResize repaint synchronously after a real resize. */
  private hasRenderedOnce = false;
  private godRayStrength = 0;
  private sunCore: THREE.Sprite | null = null;
  private sunHalo: THREE.Sprite | null = null;
  private readonly sunDir = new THREE.Vector3(0.45, 0.78, -0.42);
  private lastHoverMs = 0;
  private contextLost = false;
  private readonly reducedMotion =
    typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  private altHeld = false;
  private lastWorldPos = { x: 2.5, z: 8.5, inBounds: false };
  private pointerDownPos = { x: 0, y: 0 };
  private rightDownPos: { x: number; y: number } | null = null;

  private readonly validMat = new THREE.MeshBasicMaterial({ color: "#2ed68d", transparent: true, opacity: 0.45, depthWrite: false });
  private readonly invalidMat = new THREE.MeshBasicMaterial({ color: "#ef5350", transparent: true, opacity: 0.52, depthWrite: false });
  private readonly cyanMat = new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.45, depthWrite: false });
  private readonly ghostValidMat = new THREE.MeshStandardMaterial({
    color: "#2ed68d",
    emissive: "#15803d",
    emissiveIntensity: 0.42,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    roughness: 0.55,
  });
  private readonly ghostInvalidMat = new THREE.MeshStandardMaterial({
    color: "#ef5350",
    emissive: "#991b1b",
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    roughness: 0.55,
  });

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();
  private readonly activeFloorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);

  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private lastFrameMs = performance.now();
  private fpsSamples: number[] = [];
  private disposed = false;

  private readonly onResizeBound = () => this.handleResize();
  private readonly onVisibilityBound = () => this.handleVisibility();
  private readonly onPointerMoveBound = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerDownBound = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerUpBound = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onPointerLeaveBound = () => {
    this.hoverHighlightMesh.visible = false;
    if (this.hoverTileMesh) this.hoverTileMesh.visible = false;
    this.actions.onHoverPart?.(null, 0, 0);
    this.actions.onHoverCell(0, 0, 0, 0, false);
  };
  private readonly onContextLostBound = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestoredBound = () => {
    this.contextLost = false;
    this.lastFrameMs = performance.now();
  };
  private readonly onKeyDownBound = (e: KeyboardEvent) => {
    this.altHeld = e.altKey;
    if (e.key === "Escape") this.cancelActivePreview();
  };
  private readonly onKeyUpBound = (e: KeyboardEvent) => {
    this.altHeld = e.altKey;
  };

  constructor(canvas: HTMLCanvasElement, actions: BuildSceneActions) {
    this.canvas = canvas;
    this.actions = actions;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    const mobileViewport = typeof window !== "undefined" && window.innerWidth < 768;
    this.mobileViewport = mobileViewport;
    // Software rasterizers (SwiftShader / llvmpipe) must never receive the cinematic stack:
    // detect them once so CI containers and VMs stay responsive instead of wedging on frame one.
    let softwareGpu = false;
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      softwareGpu = /swiftshader|llvmpipe|softpipe|software|basic render|angle \(google/i.test(gpuName);
    } catch {
      softwareGpu = false;
    }
    this.softwareGpu = softwareGpu;
    this.activeTier = softwareGpu ? "low" : mobileViewport ? "medium" : "high";
    const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.baseDpr = softwareGpu ? Math.min(1, rawDpr) : mobileViewport ? Math.min(1.5, rawDpr) : Math.min(2, Math.max(1.5, rawDpr));
    this.currentDpr = this.baseDpr;
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.shadowMap.enabled = true;
    // three r187 removed PCFSoftShadowMap — PCF now carries the soft kernel itself.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd9e8f4, 0.0046);

    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    this.cameraCtrl = new BuildCameraController(canvas, aspect);

    // Hero PBR maps render at 1024² on desktop, 512² on mobile (`3d-high-resolution-textures`)
    this.palette = createMaterialPalette(mobileViewport ? 1 : 2);
    this.palette.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.setupClippingMaterials();
    this.setupRainSystem();

    this.hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x6f6859, 0.68);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff4de, 2.45);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.castShadow = true;
    // 4096² shadow map on desktop high tier: eaves, rebar and brick courses keep crisp contact shadows
    this.sunLight.shadow.mapSize.set(mobileViewport ? 1024 : 4096, mobileViewport ? 1024 : 4096);
    this.sunLight.shadow.camera.near = 1.5;
    this.sunLight.shadow.camera.far = 56;
    this.sunLight.shadow.camera.left = -10.5;
    this.sunLight.shadow.camera.right = 10.5;
    this.sunLight.shadow.camera.top = 14.5;
    this.sunLight.shadow.camera.bottom = -14.5;
    // normalBias scaled to the map resolution (`3d-wood-lighting-scorecard`: 0.0045 @4096, 0.0085 @2048)
    this.sunLight.shadow.bias = mobileViewport ? -0.00035 : -0.00018;
    this.sunLight.shadow.normalBias = mobileViewport ? 0.012 : 0.0048;
    this.sunLight.target.position.set(2.5, 2.4, 8.5);
    this.scene.add(this.sunLight, this.sunLight.target);

    // Cool sky shadow-side fill light keeps unlit brickwork crisp without flat ambient (`3d-wood-lighting-scorecard`)
    this.fillLight = new THREE.DirectionalLight(0xb2cff0, 0.45);
    this.fillLight.position.set(-14, 12, 20);
    this.scene.add(this.fillLight);

    this.lightningLight = new THREE.DirectionalLight(0xdce8ff, 0);
    this.lightningLight.position.set(-10, 24, -12);
    this.scene.add(this.lightningLight);

    const skyTex = createSkyGradientTexture(10, "kemarau", 0);
    this.skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 20), this.skyMat);
    this.scene.add(this.skyMesh);

    // HDR sun billboards: a hot core that blooms and feeds the god-ray march, plus a wide soft halo
    const sunCoreTex = makeSunSpriteTexture(0.5, 0.86);
    const sunHaloTex = makeSunSpriteTexture(0.14, 0.3);
    this.sunCore = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunCoreTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.sunCore.scale.set(11, 11, 1);
    this.sunHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunHaloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.sunHalo.scale.set(42, 42, 1);
    this.sunCore.material.color.setRGB(5.6, 5.0, 4.3);
    this.sunHalo.material.color.setRGB(1.05, 1.0, 0.92);
    this.scene.add(this.sunCore, this.sunHalo);
    this.staticDisposables.push(sunCoreTex, sunHaloTex, this.sunCore.material, this.sunHalo.material);

    const initEnv = createEnvironmentMap(this.renderer, 10, 0);
    this.envTex = initEnv;
    this.scene.environment = initEnv;
    this.scene.environmentIntensity = 0.72;
    this.palette.bindEnvMap(initEnv);

    this.contactShadowTex = createContactShadowTexture();
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: this.contactShadowTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.staticDisposables.push(skyTex, this.skyMat, this.skyMesh.geometry, this.contactShadowTex, this.contactShadowMat);

    buildStaticNeighborhood(this.envGroup, this.neighborsGroup, this.palette, this.contactShadowTex, this.staticDisposables);

    this.hoverHighlightMesh = new THREE.Mesh(this.hoverBoxGeo, this.cyanMat);
    this.hoverHighlightMesh.visible = false;
    this.scene.add(this.hoverHighlightMesh);

    const ringGeo = new THREE.RingGeometry(0.42, 0.56, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    this.selectedRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectedRing.visible = false;
    this.selectedRing.renderOrder = 998;
    this.staticDisposables.push(ringGeo, ringMat);

    const hoverGeo = new THREE.PlaneGeometry(0.25, 0.25);
    hoverGeo.rotateX(-Math.PI / 2);
    const hoverMat = new THREE.MeshBasicMaterial({
      color: "#3bc48d",
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.hoverTileMesh = new THREE.Mesh(hoverGeo, hoverMat);
    this.hoverTileMesh.visible = false;
    this.overlayGroup.add(this.hoverTileMesh);
    this.staticDisposables.push(hoverGeo, hoverMat);

    // Sims 4 Wall Push-Pull double-arrow gizmo handle
    const shaftGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.72, 10);
    shaftGeo.rotateX(Math.PI / 2);
    const coneFwdGeo = new THREE.ConeGeometry(0.095, 0.22, 12);
    coneFwdGeo.rotateX(Math.PI / 2);
    coneFwdGeo.translate(0, 0, 0.43);
    const coneBackGeo = new THREE.ConeGeometry(0.095, 0.22, 12);
    coneBackGeo.rotateX(-Math.PI / 2);
    coneBackGeo.translate(0, 0, -0.43);
    const hitSphereGeo = new THREE.SphereGeometry(0.36, 10, 8);
    const gizmoMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false, transparent: true, opacity: 0.95 });
    const hitGizmoMat = new THREE.MeshBasicMaterial({ visible: false });
    const shaftM = new THREE.Mesh(shaftGeo, gizmoMat);
    const fwdM = new THREE.Mesh(coneFwdGeo, gizmoMat);
    const backM = new THREE.Mesh(coneBackGeo, gizmoMat);
    const hitM = new THREE.Mesh(hitSphereGeo, hitGizmoMat);
    for (const gm of [shaftM, fwdM, backM, hitM]) {
      gm.userData.isPushPullGizmo = true;
      gm.renderOrder = 999;
      this.pushPullGizmoGroup.add(gm);
    }
    this.pushPullGizmoGroup.visible = false;
    this.overlayGroup.add(this.pushPullGizmoGroup);
    this.staticDisposables.push(shaftGeo, coneFwdGeo, coneBackGeo, hitSphereGeo, gizmoMat, hitGizmoMat);

    this.propsContainer.add(this.propLevelRoots[0], this.propLevelRoots[1]);
    this.scene.add(
      this.envGroup,
      this.neighborsGroup,
      this.houseContainer,
      this.propsContainer,
      this.simGroup,
      this.dimsGroup,
      this.overlayGroup,
      this.previewGroup,
      this.selectedRing,
    );

    this.handleResize();
    this.setupPostPipeline();
    this.configurePostPipeline();
    window.addEventListener("resize", this.onResizeBound);
    if (canvas.parentElement && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener("keydown", this.onKeyDownBound);
    window.addEventListener("keyup", this.onKeyUpBound);
    document.addEventListener("visibilitychange", this.onVisibilityBound);
    canvas.addEventListener("pointermove", this.onPointerMoveBound);
    canvas.addEventListener("pointerdown", this.onPointerDownBound);
    canvas.addEventListener("pointerup", this.onPointerUpBound);
    canvas.addEventListener("pointerleave", this.onPointerLeaveBound);
    canvas.addEventListener("webglcontextlost", this.onContextLostBound);
    canvas.addEventListener("webglcontextrestored", this.onContextRestoredBound);

    this.startLoop();
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResizeBound);
    this.resizeObserver?.disconnect();
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("keyup", this.onKeyUpBound);
    document.removeEventListener("visibilitychange", this.onVisibilityBound);
    this.canvas.removeEventListener("pointermove", this.onPointerMoveBound);
    this.canvas.removeEventListener("pointerdown", this.onPointerDownBound);
    this.canvas.removeEventListener("pointerup", this.onPointerUpBound);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeaveBound);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLostBound);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestoredBound);
    this.cameraCtrl.dispose();

    this.postActive = false;
    this.gtaoPass?.dispose();
    this.atmospherePass?.dispose();
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.gtaoPass = null;
    this.atmospherePass = null;
    this.bloomPass = null;
    this.outputPass = null;

    this.scene.remove(this.hoverHighlightMesh);
    this.hoverBoxGeo.dispose();
    this.envGroup.clear();
    this.neighborsGroup.clear();
    this.houseContainer.clear();
    this.propsContainer.clear();
    this.dimsGroup.clear();
    for (const ent of this.propEntries.values()) {
      for (const r of ent.resources) r.dispose();
    }
    this.propEntries.clear();
    for (const g of this.ghostCache.values()) {
      for (const r of g.disposables) r.dispose();
    }
    this.ghostCache.clear();
    if (this.roomOutlineLoop) {
      this.roomOutlineLoop.geometry.dispose();
      (this.roomOutlineLoop.material as THREE.Material).dispose();
      this.roomOutlineLoop = null;
    }
    if (this.liveTerrainTempMesh) {
      this.liveTerrainTempMesh.geometry.dispose();
      this.liveTerrainTempMesh = null;
    }
    for (const r of this.dynResources) r.dispose();
    for (const r of this.simResources) r.dispose();
    for (const r of this.staticDisposables) r.dispose();
    this.rainPoints?.geometry.dispose();
    (this.rainPoints?.material as THREE.Material | undefined)?.dispose();
    this.rainTex?.dispose();
    this.validMat.dispose();
    this.invalidMat.dispose();
    this.cyanMat.dispose();
    this.ghostValidMat.dispose();
    this.ghostInvalidMat.dispose();
    this.envTex?.dispose();
    this.palette.dispose();
    this.renderer.dispose();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public setQualityOverride(tier: BuildQualityTier): void {
    this.qualityOverride = tier;
    // Explicit user pick resets the adaptive memory so auto logic cannot fight it.
    this.tierGovernor.reset();
    const effective: "high" | "medium" | "low" =
      tier === "auto"
        ? this.softwareGpu
          ? "low"
          : typeof window !== "undefined" && window.innerWidth < 768
            ? "medium"
            : "high"
        : tier;
    this.applyQualityTier(effective, tier === "high");
  }

  /** Toggle the cinematic ray-traced-look stack (GTAO + sun shafts + bloom + MSAA HDR). */
  public setRayTracingLook(enabled: boolean): void {
    this.rayTracingEnabled = enabled;
    this.configurePostPipeline();
  }

  /**
   * Cinematic "ray-tracing like" real-time pipeline (`3d-sky-rays` + GTAO + HDR bloom):
   * linear HDR MSAA buffer → GTAO ambient occlusion → screen-space sun shafts with
   * vignette/dither → UnrealBloom → single ACES tone-map + sRGB in OutputPass.
   */
  private setupPostPipeline(): void {
    if (this.composer || this.disposed) return;
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    const target = new THREE.WebGLRenderTarget(Math.round(w * this.currentDpr), Math.round(h * this.currentDpr), {
      type: THREE.HalfFloatType,
      // MSAA resolve on HalfFloat targets wedges software rasterizers (SwiftShader) into
      // ghost-white frames — real GPUs keep 4x AA, software falls back to a clean resolve.
      samples: this.softwareGpu ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.cameraCtrl.activeCamera);
    this.gtaoPass = new GTAOPass(this.scene, this.cameraCtrl.activeCamera, w, h);
    // OUTPUT.Default = scene + denoised AO blended on top. (Denoise would REPLACE the
    // frame with the raw AO buffer — a near-white ghost screen on every "Tinggi" tier.)
    this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    this.gtaoPass.updateGtaoMaterial({
      radius: 1.15,
      distanceExponent: 1.4,
      thickness: 1.4,
      scale: 1.0,
      samples: 14,
      distanceFallOff: 0.7,
      screenSpaceRadius: false,
    });
    this.gtaoPass.blendIntensity = 1.1;
    this.atmospherePass = new AtmospherePass();
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.7, 1.45);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtaoPass);
    this.composer.addPass(this.atmospherePass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    // Custom-target composers start with _width/_height in *pixels*; setSize must run
    // before setPixelRatio or the targets transiently resize to w·dpr² (~4x the VRAM).
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.currentDpr);
    this.lastAppliedSize = { w, h, dpr: this.currentDpr };
    this.atmospherePass.atmosphereUniforms.uAspect.value = w / h;
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      (window as unknown as { __RT_DEBUG__?: unknown }).__RT_DEBUG__ = {
        composer: this.composer,
        gtao: this.gtaoPass,
        atmo: this.atmospherePass,
        bloom: this.bloomPass,
      };
    }
  }

  /** Enable / disable passes per quality tier; low tier falls back to the direct render. */
  private configurePostPipeline(): void {
    if (!this.composer) {
      this.postActive = false;
      return;
    }
    if (!this.rayTracingEnabled || this.activeTier === "low") {
      this.postActive = false;
      return;
    }
    this.postActive = true;
    // GTAO's depth/normal gbuffer wedges software rasterizers into empty frames — hardware only.
    if (this.gtaoPass) this.gtaoPass.enabled = this.activeTier === "high" && !this.softwareGpu;
    if (this.atmospherePass) {
      this.atmospherePass.atmosphereUniforms.uSamples.value = this.activeTier === "high" ? 40 : 22;
    }
  }

  /** Project the sun into screen space and drive the god-ray uniforms every frame. */
  private updateAtmosphere(cam: THREE.Camera): void {
    const ap = this.atmospherePass;
    if (!ap) return;
    cam.updateMatrixWorld();
    this._v1.copy(this.sunLight.position).applyMatrix4(cam.matrixWorldInverse);
    if (this._v1.z > -1) {
      // Sun sits behind the camera: no shafts, no mirrored source flash.
      ap.atmosphereUniforms.uSunFade.value = 0;
      return;
    }
    this._v1.copy(this.sunLight.position).project(cam);
    const ux = this._v1.x * 0.5 + 0.5;
    const uy = this._v1.y * 0.5 + 0.5;
    ap.atmosphereUniforms.uSunUv.value.set(ux, uy);
    const aspect = ap.atmosphereUniforms.uAspect.value;
    // Overscan margin: keep a little energy while the sun is just outside the frame
    const d = Math.hypot((ux - 0.5) * aspect, uy - 0.5);
    ap.atmosphereUniforms.uSunFade.value = THREE.MathUtils.clamp(1 - (d - 0.85) / 0.95, 0, 1);
    ap.atmosphereUniforms.uIntensity.value = this.godRayStrength;
    ap.atmosphereUniforms.uSunColor.value.copy(this.sunLight.color);
    ap.atmosphereUniforms.uTime.value = this.simElapsedS;
  }

  private applyQualityTier(tier: "high" | "medium" | "low", explicitHigh = false): void {
    this.activeTier = tier;
    const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // High deliberately supersamples on standard 1x displays (`3d-retina-resolution`): the
    // house silhouette, rebar and window mullions stay crisp instead of looking like a game preview.
    const targetDpr =
      tier === "high"
        ? this.softwareGpu
          ? 1
          : Math.min(2, Math.max(1.5, rawDpr))
        : tier === "medium"
          ? Math.min(rawDpr, 1.35)
          : 1;
    if (Math.abs(targetDpr - this.currentDpr) > 0.04) {
      this.currentDpr = targetDpr;
      // handleResize applies pixelRatio + size exactly once (guarded) and repaints
      // immediately, so a tier switch never flashes a reset (black) canvas.
      this.handleResize();
    }
    const wantShadow = tier === "high" ? (this.mobileViewport ? 2048 : 4096) : tier === "medium" ? 1024 : 512;
    this.renderer.shadowMap.enabled = tier !== "low";
    if (this.sunLight.shadow.mapSize.x !== wantShadow) {
      this.sunLight.shadow.mapSize.set(wantShadow, wantShadow);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
      this.sunLight.shadow.bias = wantShadow >= 4096 ? -0.00018 : wantShadow >= 2048 ? -0.00025 : -0.00035;
      this.sunLight.shadow.normalBias = wantShadow >= 4096 ? 0.0048 : wantShadow >= 2048 ? 0.0085 : 0.012;
    }
    this.configurePostPipeline();
    if (explicitHigh) this.lastDprCheckMs = performance.now();
  }

  private setupClippingMaterials(): void {
    const clippable = [
      this.palette.brickOuter,
      this.palette.brickInner,
      this.palette.mortar,
      this.palette.concrete,
      this.palette.concreteXray,
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

  private setupRainSystem(): void {
    const count = 1800;
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

    const rCan = document.createElement("canvas");
    rCan.width = 16;
    rCan.height = 64;
    const rCtx = rCan.getContext("2d");
    if (rCtx) {
      const grad = rCtx.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, "rgba(210, 234, 252, 0)");
      grad.addColorStop(0.25, "rgba(218, 238, 255, 0.72)");
      grad.addColorStop(0.7, "rgba(232, 244, 255, 0.92)");
      grad.addColorStop(1, "rgba(232, 244, 255, 0)");
      rCtx.fillStyle = grad;
      rCtx.fillRect(6, 2, 3, 60);
    }
    this.rainTex = new THREE.CanvasTexture(rCan);

    const mat = new THREE.PointsMaterial({
      color: 0xd9ecfb,
      map: this.rainTex,
      size: 0.24,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      alphaTest: 0.02,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  public cancelActivePreview(): void {
    if (this.dragPendingCommit && this.draggingMesh) {
      this.draggingMesh.position.copy(this.dragPendingCommit.origMeshPos);
      this.draggingMesh.rotation.y = this.dragPendingCommit.origMeshRotY;
    }
    this.dragStartVertex = null;
    this.dragStartCell = null;
    this.sledgeDragStart = null;
    this.pushPullDragState = null;
    this.openingDragState = null;
    this.draggingEntity = null;
    this.draggingMesh = null;
    this.dragPendingCommit = null;
    this.isBrushDown = false;
    this.brushStrokeCells.clear();
    this.terrainScratch = null;
    if (this.liveTerrainTempMesh) {
      this.overlayGroup.remove(this.liveTerrainTempMesh);
      this.liveTerrainTempMesh.geometry.dispose();
      this.liveTerrainTempMesh = null;
    }
    this.clearPreviewMeshes();
    this.actions.onPreviewHud(null);
  }

  private clearPreviewMeshes(): void {
    this.hoverHighlightMesh.visible = false;
    for (const c of [...this.previewGroup.children]) {
      this.previewGroup.remove(c);
      if (c.userData?.isCachedGhost) continue;
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) c.geometry.dispose();
    }
  }

  public setSelected(selected: SelectionTarget): void {
    this.selected = selected;
    if (this.derived) {
      this.updateSelectionRing(this.derived, selected);
    }
  }

  public rotateActiveDrag(deltaStep: -1 | 1): boolean {
    if (!this.draggingEntity || !this.dragPendingCommit || !this.draggingMesh) return false;
    const stepRad = (deltaStep > 0 ? 1 : -1) * (Math.PI / 4);
    const nextRot = (this.dragPendingCommit.rotationY ?? this.dragPendingCommit.origMeshRotY) + stepRad;
    this.dragPendingCommit.rotationY = nextRot;
    this.draggingMesh.rotation.y = nextRot;
    return true;
  }

  public updateProjectData(
    derived: DerivedProjectModel,
    struct: StructuralReport,
    selected: SelectionTarget,
    studioView?: ViewState,
    lighting?: LightingSimulationResult,
    airflow?: AirflowSimulationResult,
    flood?: FloodSimulationResult,
  ): void {
    this.derived = derived;
    this.struct = struct;
    this.selected = selected;
    if (studioView) this.studioView = studioView;
    if (lighting) this.lighting = lighting;
    if (airflow) this.airflow = airflow;
    if (flood) this.flood = flood;

    const { project } = derived;
    const sim = project.simulation;
    this.lastRainMmH = sim.rainIntensityMmH;

    // Sync Structural & Terrain viewport flags
    const wasExploded = this.explodeTarget > 0.05;
    const showTerrain = this.studioView?.showTerrain ?? true;
    for (const ch of this.envGroup.children) {
      if (ch.userData?.isTerrain) ch.visible = showTerrain;
    }
    this.neighborsGroup.visible = this.viewOpts.neighborsVisible && (this.studioView?.showNeighbors ?? true);
    this.cameraCtrl.setAllowUnderground(!showTerrain);
    this.cameraCtrl.setOrtho(this.studioView?.ortho ?? false);
    this.explodeTarget = this.studioView?.explode ?? 0;
    this.clipPlane.constant = this.studioView?.cutH ?? 100;
    if (wasExploded !== (this.explodeTarget > 0.05)) {
      this.applyLevelAndWallVisibility();
    }

    // Sync PBR materials cleanly to Project Settings
    this.palette.plasterExt.color.set(sim.paintExtHex);
    this.palette.plasterInt.color.set(sim.paintIntHex);
    this.palette.roofCover.color.set(sim.roofColorHex);
    this.palette.setTileSize(project.systems.tileSizeCm);

    const nextEnvKey = `${sim.hourOfDay.toFixed(2)}|${sim.season}|${Math.round(sim.rainIntensityMmH / 5)}|${project.site.orientationDeg}`;
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
      const isNight = sim.hourOfDay < 5.5 || sim.hourOfDay > 18.5;
      const isStorm = sim.rainIntensityMmH > 20;
      this.scene.environmentIntensity = isNight ? 0.35 : isStorm ? 0.82 : 0.62;
      this.palette.bindEnvMap(env);

      // Sun angle + cool opposite sky fill (`3d-wood-lighting-scorecard`)
      let sx = 0.45;
      let sy = 0.78;
      let sz = -0.42;
      if (lighting) {
        [sx, sy, sz] = lighting.solar.sunDir;
        this.sunLight.position.set(2.5 + sx * 24, Math.max(2.5, sy * 24), 8.5 + sz * 24);
      } else {
        const sunElev = Math.max(0.15, Math.sin(((sim.hourOfDay - 5.5) / 13) * Math.PI));
        const sunAz = ((sim.hourOfDay - 12) / 6) * 0.9;
        sx = Math.sin(sunAz);
        sy = sunElev;
        sz = -Math.cos(sunAz) * 0.6;
        this.sunLight.position.set(2.5 + sx * 24, Math.max(3, sy * 24), 8.5 + sz * 24);
      }
      this.fillLight.position.set(2.5 - sx * 18, 12, 8.5 - sz * 18);
      this.fillLight.intensity = isNight ? 0.14 : isStorm ? 0.35 : 0.4;
      this.sunLight.intensity = isNight ? 0.18 : isStorm ? 1.15 : 2.75;
      this.sunLight.color.set(isNight ? 0x6c88b8 : sim.hourOfDay < 7.5 || sim.hourOfDay > 16.5 ? 0xffcb8c : 0xfff4de);
      this.hemiLight.intensity = isNight ? 0.26 : isStorm ? 0.7 : 0.5;

      // HDR sun billboards ride the true solar direction; halo warms up at golden hour
      this.sunDir.set(sx, sy, sz).normalize();
      const isGolden =
        !isNight && ((sim.hourOfDay >= 5.2 && sim.hourOfDay <= 7.5) || (sim.hourOfDay >= 16.5 && sim.hourOfDay <= 18.8));
      const sunUp = sy > 0.03;
      if (this.sunCore) {
        this.sunCore.visible = !isNight && sunUp;
        this.sunCore.position.set(2.5 + sx * 132, sy * 132, 8.5 + sz * 132);
        this.sunCore.material.color.setRGB(isGolden ? 6.0 : 5.6, isGolden ? 3.6 : 5.0, isGolden ? 2.0 : 4.3);
      }
      if (this.sunHalo) {
        this.sunHalo.visible = !isNight && sunUp && !isStorm;
        this.sunHalo.position.set(2.5 + sx * 132, sy * 132, 8.5 + sz * 132);
        this.sunHalo.material.color.setRGB(isGolden ? 1.2 : 0.9, isGolden ? 0.75 : 0.86, isGolden ? 0.46 : 0.78);
      }

      // Screen-space sun shaft strength (`3d-sky-rays`): strongest at a low golden sun, subtle at noon
      this.godRayStrength = isNight ? 0 : isStorm ? 0.12 : isGolden ? 0.95 : 0.5;
      this.godRayStrength *= THREE.MathUtils.lerp(1.3, 0.75, THREE.MathUtils.clamp(this.sunDir.y, 0, 1));

      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set(isNight ? 0x0e1628 : isStorm ? 0x647280 : 0xd9e8f4);
        this.scene.fog.density = isStorm ? 0.011 : isNight ? 0.0052 : 0.0046;
      }
    }

    if (this.rainPoints) {
      this.rainPoints.visible = Boolean(this.studioView?.showRain) && sim.rainIntensityMmH > 0;
      const density = Math.min(1, sim.rainIntensityMmH / 120);
      this.rainActiveCount = Math.round(1800 * density);
      this.rainPoints.geometry.setDrawRange(0, this.rainActiveCount);
    }

    const vFlags = this.studioView
      ? {
          stg: this.studioView.stage,
          sb: this.studioView.showBricks,
          ss: this.studioView.showStructure,
          st: this.studioView.showTerrain,
          sr: this.studioView.showRoof,
          srk: this.studioView.showRangka,
          sf: this.studioView.showFinishing,
          xr: this.studioView.xrayRebar,
          sa: this.studioView.showAir,
          sl: this.studioView.showListrik,
          lb: this.studioView.showLabels,
          dm: this.studioView.showDims,
          hp: this.studioView.hiddenParts,
        }
      : null;

    const previewRoofType =
      this.viewOpts.pendingRoofType && this.viewOpts.pendingRoofType !== project.systems.roofType
        ? this.viewOpts.pendingRoofType
        : null;

    const sig = JSON.stringify({
      sys: previewRoofType ? { ...project.systems, roofType: previewRoofType } : project.systems,
      peil: project.site.peil,
      sp: project.structuralParams,
      soil: project.site.soil,
      fm: project.floodMitigation,
      lv: project.levels.map((l) => [l.id, l.index, l.name, l.height, l.walls, l.rooms, l.slabs, l.stairs]),
      ext: project.buildExtras,
      brk: this.viewOpts.showBricksOverlay,
      vf: vFlags,
      pr: previewRoofType,
    });

    if (sig !== this.buildSignature) {
      this.buildSignature = sig;
      if (previewRoofType) {
        const previewProject = {
          ...project,
          systems: { ...project.systems, roofType: previewRoofType },
        };
        const previewRoof = computeRoofMetrics(previewProject);
        this.rebuildFromProject({ ...derived, project: previewProject, roof: previewRoof }, struct);
      } else {
        this.rebuildFromProject(derived, struct);
      }
    }

    const pSig = JSON.stringify({
      lv: project.levels.map((l) => [l.index, l.height, l.furniture, l.lights, l.hvac]),
      peil: project.site.peil,
      stg: this.studioView?.stage ?? 0,
    });
    if (pSig !== this.propsSignature) {
      this.propsSignature = pSig;
      this.syncPropsIncremental(derived);
    }

    const simSig = JSON.stringify({
      al: this.viewOpts.activeLevel,
      lux: this.studioView?.showLuxHeatmap ?? false,
      air: this.studioView?.showAirParticles ?? false,
      fldW: this.studioView?.showFloodWater ?? false,
      stFld: this.flood?.streetFloodCm ?? 0,
      cpFld: this.flood?.carportFloodCm ?? 0,
      inFld: this.flood?.lt1FloorFloodCm ?? 0,
      bar: project.floodMitigation.doorFloodBarrier,
      barH: project.floodMitigation.barrierHeightCm,
      hr: Math.round(sim.hourOfDay * 4),
      rn: Math.round(sim.rainIntensityMmH),
      ws: Math.round(sim.windSpeedMs * 10),
      wd: Math.round(sim.windDirectionDeg),
      at: Math.round(sim.ambientTempC * 2),
      lg: project.levels.map((l) => l.lights.map((x) => `${x.id}:${x.on}:${x.lumens}:${x.position.x.toFixed(2)},${x.position.z.toFixed(2)}`)),
      hv: project.levels.map((l) => l.hvac.map((x) => `${x.id}:${x.on}:${x.speedLevel}:${x.rotationY.toFixed(2)}:${x.position.x.toFixed(2)},${x.position.z.toFixed(2)}`)),
    });
    if (simSig !== this.simSignature) {
      this.simSignature = simSig;
      this.rebuildSimOverlays();
    }

    this.applyWireframe(this.studioView?.wireframe ?? false);
    this.updateSelectionRing(derived, selected);
  }

  public setViewOptions(opts: BuildViewOptions): void {
    const levelChanged = this.viewOpts.activeLevel !== opts.activeLevel;
    const bricksChanged = this.viewOpts.showBricksOverlay !== opts.showBricksOverlay;
    const roofPreviewChanged = (this.viewOpts.pendingRoofType ?? null) !== (opts.pendingRoofType ?? null);
    const toolChanged =
      this.viewOpts.activeTool !== opts.activeTool ||
      this.viewOpts.selectedCatalogId !== opts.selectedCatalogId ||
      (this.viewOpts.selectedSwatchHex ?? null) !== (opts.selectedSwatchHex ?? null);

    this.viewOpts = opts;
    this.neighborsGroup.visible = opts.neighborsVisible && (this.studioView?.showNeighbors ?? true);
    if (this.gridMesh) this.gridMesh.visible = opts.gridVisible;
    this.cameraCtrl.setSnap90Enabled(opts.snap90Enabled);
    this.cameraCtrl.setEdgeScrollEnabled(opts.edgeScrollEnabled);

    if (toolChanged) {
      this.cancelActivePreview();
      if (this.derived) this.updateSelectionRing(this.derived, this.selected);
    }
    if ((bricksChanged || roofPreviewChanged) && this.derived && this.struct) {
      const previewRoofType =
        opts.pendingRoofType && opts.pendingRoofType !== this.derived.project.systems.roofType ? opts.pendingRoofType : null;
      if (previewRoofType) {
        const previewProject = {
          ...this.derived.project,
          systems: { ...this.derived.project.systems, roofType: previewRoofType },
        };
        this.rebuildFromProject(
          { ...this.derived, project: previewProject, roof: computeRoofMetrics(previewProject) },
          this.struct,
        );
      } else {
        this.rebuildFromProject(this.derived, this.struct);
      }
      this.buildSignature = "";
    }

    if (levelChanged) {
      const y = this.getActiveFloorY();
      this.cameraCtrl.setTargetElevation(y);
      this.activeFloorPlane.constant = -y;
      this.rebuildGridOverlay();
      this.rebuildSimOverlays();
    }
    this.applyLevelAndWallVisibility();
  }

  private getActiveFloorY(): number {
    if (!this.derived) return 0.5;
    const lt1 = this.derived.project.site.peil.floor1PeilM;
    const h0 = this.derived.project.levels[0]?.height ?? 3.6;
    const h1 = this.derived.project.levels[1]?.height ?? 3.6;
    if (this.viewOpts.activeLevel === 0) return lt1;
    if (this.viewOpts.activeLevel === 1) return lt1 + h0;
    return lt1 + h0 + h1;
  }

  private rebuildFromProject(derived: DerivedProjectModel, struct: StructuralReport): void {
    this.houseContainer.clear();
    this.dimsGroup.clear();
    for (const r of this.dynResources) r.dispose();
    this.dynResources = [];
    this.animatedFans = [];
    this.houseAnimatedFans = [];
    this.explodePieces = [];
    this.explodeInstanced = [];
    this.brickExplodeMap.clear();
    this.brickBatches = [];
    this.columnCutawayRecords = [];
    if (this.liveTerrainTempMesh) {
      this.overlayGroup.remove(this.liveTerrainTempMesh);
      this.liveTerrainTempMesh.geometry.dispose();
      this.liveTerrainTempMesh = null;
    }

    const showBricksOverlay = this.viewOpts.showBricksOverlay;
    const sv = this.studioView;
    const showFinishing = showBricksOverlay ? false : (sv?.showFinishing ?? true);
    const showBricks = showBricksOverlay || (sv?.showBricks ?? true);
    const built = buildProjectHouse(derived, struct, this.palette, this.contactShadowMat, {
      stage: sv?.stage ?? 0,
      showBricks,
      showStructure: sv?.showStructure ?? true,
      showTerrain: sv?.showTerrain ?? true,
      showRoof: (sv?.showRoof ?? true) || Boolean(this.viewOpts.pendingRoofType),
      showRangka: sv?.showRangka ?? true,
      showFinishing,
      xrayRebar: sv?.xrayRebar ?? false,
      showAir: sv?.showAir ?? false,
      showListrik: sv?.showListrik ?? false,
      hiddenParts: new Set(sv?.hiddenParts ?? []),
      activeLevelView: "all",
      supportWallCutaway: true,
      skipProps: true,
      onExplodePiece: (obj, off) => {
        this.explodePieces.push({ obj, base: obj.position.clone(), off });
      },
      onExplodeInstanced: (im, off) => {
        this.registerExplodeInstanced(im, off);
      },
    });

    this.houseContainer.add(built.houseRoot);
    this.dynResources.push(...built.resources);
    this.levelRoots = built.levelRoots;
    this.lt2StructuralGroup = built.lt2StructuralGroup;
    this.roofGroup = built.roofGroup;
    this.wallCutawayRecords = built.wallCutawayRecords;
    this.columnCutawayRecords = built.columnCutawayRecords;
    this.brickBatches = built.brickBatches;
    this.houseAnimatedFans = built.animatedFans;
    this.rebuildAnimatedFanList();
    this.lastCutawayYaw = Number.NaN;
    this.lastCutawayKey = "";

    const { project, roof } = derived;
    const lt1Y = project.site.peil.floor1PeilM;
    const lt2Y = lt1Y + (project.levels[0]?.height ?? 3.6);
    if (sv?.showLabels) {
      for (const fl of derived.floors) {
        if (fl.levelIndex === 1 && this.viewOpts.activeLevel === 0) continue;
        const ly = fl.levelIndex === 0 ? lt1Y + 1.4 : lt2Y + 1.4;
        for (const r of fl.rooms) {
          const sp = this.makeLabelSprite(r.room.name, `${r.netAreaM2.toFixed(1)} m²`);
          sp.position.set(r.centroid.x, ly, r.centroid.z);
          this.dimsGroup.add(sp);
        }
      }
    }
    if (sv?.showDims) {
      this.build3dDimensions(project.site.width, project.site.depth, roof.ridgeElevationM + lt1Y);
    }

    this.applyExplode(this.explodeCurrent);
    this.cameraCtrl.setBounds({
      minX: -4.5,
      maxX: derived.project.site.width + 4.5,
      minZ: -5.5,
      maxZ: derived.project.site.depth + 5.5,
    });
    this.rebuildGridOverlay();
    this.applyLevelAndWallVisibility();
  }

  private build3dDimensions(width: number, depth: number, topY: number): void {
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

  private registerExplodeInstanced(im: THREE.InstancedMesh, off: Float32Array): void {
    const n = im.count;
    const pos = new Float32Array(n * 3);
    const quat = new Float32Array(n * 4);
    const scl = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, this._m4);
      this._m4.decompose(this._v1, this._q, this._s1);
      pos[i * 3] = this._v1.x;
      pos[i * 3 + 1] = this._v1.y;
      pos[i * 3 + 2] = this._v1.z;
      quat[i * 4] = this._q.x;
      quat[i * 4 + 1] = this._q.y;
      quat[i * 4 + 2] = this._q.z;
      quat[i * 4 + 3] = this._q.w;
      scl[i * 3] = this._s1.x;
      scl[i * 3 + 1] = this._s1.y;
      scl[i * 3 + 2] = this._s1.z;
    }
    const entry = { im, n, pos, off, quat, scl };
    this.explodeInstanced.push(entry);
    this.brickExplodeMap.set(im, entry);
  }

  private applyExplode(k: number): void {
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
        this._s1.set(im.scl[i * 3]!, im.scl[i * 3 + 1]!, im.scl[i * 3 + 2]!);
        this._m4.compose(this._v1, this._q, this._s1);
        im.im.setMatrixAt(i, this._m4);
      }
      im.im.instanceMatrix.needsUpdate = true;
    }
    this._s1.set(1, 1, 1);
  }

  private rebuildAnimatedFanList(): void {
    const combined: THREE.Object3D[] = [...this.houseAnimatedFans];
    for (const ent of this.propEntries.values()) {
      for (const f of ent.fanBlades) combined.push(f);
    }
    this.animatedFans = combined;
  }

  private syncPropsIncremental(derived: DerivedProjectModel): void {
    const { project } = derived;
    const peil = project.site.peil;
    const lt1Y = peil.floor1PeilM;
    const lt2Y = lt1Y + (project.levels[0]?.height ?? 3.6);
    this.propLevelRoots[0].position.y = lt1Y;
    this.propLevelRoots[1].position.y = lt2Y;

    const stage = this.studioView?.stage ?? 0;
    const showProps = stage === 0 || stage >= 9;
    this.propsContainer.visible = showProps;

    const desiredKeys = new Set<string>();

    const disposePropKey = (key: string) => {
      const existing = this.propEntries.get(key);
      if (!existing) return;
      this.propLevelRoots[existing.lvIdx].remove(existing.root);
      for (const r of existing.resources) r.dispose();
      this.propEntries.delete(key);
    };

    if (showProps) {
      const peilKey = `${peil.floor1PeilM.toFixed(3)}:${peil.carportPeilM.toFixed(3)}:${peil.terracePeilM.toFixed(3)}`;
      for (const lv of project.levels) {
        const lvIdx = (lv.index === 1 ? 1 : 0) as 0 | 1;
        const targetGroup = this.propLevelRoots[lvIdx];

        for (const f of lv.furniture) {
          const key = `furn:${lvIdx}:${f.id}`;
          desiredKeys.add(key);
          const sig = `${f.catalogId}|${f.name}|${f.colorHex}|${f.accentHex ?? ""}|${f.position.x.toFixed(3)},${f.position.y.toFixed(3)},${f.position.z.toFixed(3)}|${f.rotationY.toFixed(4)}|${f.size.x.toFixed(3)},${f.size.y.toFixed(3)},${f.size.z.toFixed(3)}|${peilKey}`;
          const prev = this.propEntries.get(key);
          if (prev && prev.sig === sig) continue;
          if (prev) disposePropKey(key);
          const res: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
          const root = buildProjectFurnitureObject(f, lvIdx, peil, this.palette, res, this.contactShadowMat);
          targetGroup.add(root);
          this.propEntries.set(key, { sig, lvIdx, root, resources: res, fanBlades: [] });
        }

        for (const hv of lv.hvac) {
          const key = `hvac:${lvIdx}:${hv.id}`;
          desiredKeys.add(key);
          const sig = `${hv.type}|${hv.name}|${hv.on}|${hv.speedLevel}|${hv.position.x.toFixed(3)},${hv.position.y.toFixed(3)},${hv.position.z.toFixed(3)}|${hv.rotationY.toFixed(4)}`;
          const prev = this.propEntries.get(key);
          if (prev && prev.sig === sig) continue;
          if (prev) disposePropKey(key);
          const res: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
          const fans: THREE.Object3D[] = [];
          const root = buildProjectHvacObject(hv, lvIdx, this.palette, res, fans);
          targetGroup.add(root);
          this.propEntries.set(key, { sig, lvIdx, root, resources: res, fanBlades: fans });
        }

        const activeLights = lv.lights.filter((x) => x.on && x.dimmer > 0);
        const activeIdSet = new Set(activeLights.slice(-7).map((x) => x.id));
        for (const l of lv.lights) {
          const key = `light:${lvIdx}:${l.id}`;
          desiredKeys.add(key);
          const isDyn = activeIdSet.has(l.id);
          const sig = `${l.type}|${l.name}|${l.on}|${isDyn}|${l.lumens}|${l.colorTempK}|${l.dimmer}|${lv.height.toFixed(2)}|${l.position.x.toFixed(3)},${l.position.y.toFixed(3)},${l.position.z.toFixed(3)}|${(l.rotationY ?? 0).toFixed(4)}`;
          const prev = this.propEntries.get(key);
          if (prev && prev.sig === sig) continue;
          if (prev) disposePropKey(key);
          const res: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
          const root = buildProjectLightObject(l, lvIdx, lv.height, this.palette, res, isDyn);
          targetGroup.add(root);
          this.propEntries.set(key, { sig, lvIdx, root, resources: res, fanBlades: [] });
        }
      }
    }

    for (const key of [...this.propEntries.keys()]) {
      if (!desiredKeys.has(key)) disposePropKey(key);
    }

    this.rebuildAnimatedFanList();
    this.applyLevelAndWallVisibility();
  }

  private applyWireframe(wf: boolean): void {
    const applyOn = (root: THREE.Object3D) => {
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
            m.wireframe = wf;
          }
        }
      });
    };
    applyOn(this.houseContainer);
    applyOn(this.propsContainer);
  }

  private rebuildGridOverlay(): void {
    if (this.gridMesh) {
      this.overlayGroup.remove(this.gridMesh);
      this.gridMesh.geometry.dispose();
      (this.gridMesh.material as THREE.Material).dispose();
      this.gridMesh = null;
    }
    const wM = this.derived?.project.site.width ?? 5;
    const dM = this.derived?.project.site.depth ?? 17;
    const gridCs = 0.25;
    const cols = Math.round(wM / gridCs);
    const rows = Math.round(dM / gridCs);
    const y = this.getActiveFloorY() + 0.025;

    const positions: number[] = [];
    const colors: number[] = [];
    const majorCol = new THREE.Color("#dbe7f2");
    const midCol = new THREE.Color("#95abc0");
    const fineCol = new THREE.Color("#63778b");
    const borderCol = new THREE.Color("#f09b4b");

    for (let gx = 0; gx <= cols; gx++) {
      const x = gx * gridCs;
      const c =
        gx === 0 || gx === cols
          ? borderCol
          : gx % 4 === 0
            ? majorCol
            : gx % 2 === 0
              ? midCol
              : fineCol;
      positions.push(x, y, 0, x, y, dM);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let gz = 0; gz <= rows; gz++) {
      const z = gz * gridCs;
      const c =
        gz === 0 || gz === rows
          ? borderCol
          : gz % 4 === 0
            ? majorCol
            : gz % 2 === 0
              ? midCol
              : fineCol;
      positions.push(0, y, z, wM, y, z);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false });
    this.gridMesh = new THREE.LineSegments(geo, mat);
    this.gridMesh.visible = this.viewOpts.gridVisible;
    this.overlayGroup.add(this.gridMesh);
  }

  private applyLevelAndWallVisibility(): void {
    const exploded = this.explodeTarget > 0.05;
    const lv = exploded ? 2 : this.viewOpts.activeLevel;
    const hasRoofPreview = Boolean(
      this.viewOpts.pendingRoofType &&
        this.derived &&
        this.viewOpts.pendingRoofType !== this.derived.project.systems.roofType,
    );
    if (this.levelRoots) {
      this.levelRoots[0].visible = true;
      this.levelRoots[1].visible = lv >= 1;
    }
    this.propLevelRoots[0].visible = true;
    this.propLevelRoots[1].visible = lv >= 1;
    if (this.lt2StructuralGroup) {
      this.lt2StructuralGroup.visible = lv >= 1;
    }
    if (this.roofGroup) {
      if (hasRoofPreview) this.roofGroup.visible = true;
      else if (exploded || this.viewOpts.roofVisibility === "show") this.roofGroup.visible = true;
      else if (this.viewOpts.roofVisibility === "hide") this.roofGroup.visible = false;
      else this.roofGroup.visible = lv >= 2;
    }
    this.updateWallCutawayVisibility(true);
  }

  private updateWallCutawayVisibility(force = false): void {
    const camPos = this.cameraCtrl.activeCamera.position;
    const tgt = this.cameraCtrl.getCurrentTarget();
    const lotCX = (this.derived?.project.site.width ?? 5) * 0.5;
    const lotCZ = (this.derived?.project.site.depth ?? 17) * 0.5;
    let dx = camPos.x - tgt.x;
    let dz = camPos.z - tgt.z;
    if (Math.hypot(dx, dz) < 0.2) {
      dx = camPos.x - lotCX;
      dz = camPos.z - lotCZ;
    }
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const viewAngle = Math.atan2(ux, uz);
    const exploded = this.explodeTarget > 0.05 || this.explodeCurrent > 0.005;
    const showBricksOverlay = this.viewOpts.showBricksOverlay;
    const showFinishing = showBricksOverlay ? false : (this.studioView?.showFinishing ?? true);
    const showBrickMeshes = exploded || showBricksOverlay || !showFinishing;
    const key = `${this.viewOpts.wallVisibility}:${this.viewOpts.activeLevel}:${exploded ? 1 : 0}:${showBrickMeshes ? 1 : 0}:${Math.round(tgt.x * 10)},${Math.round(tgt.z * 10)}`;
    if (!force && key === this.lastCutawayKey && Math.abs(viewAngle - this.lastCutawayYaw) < 0.04) return;
    this.lastCutawayYaw = viewAngle;
    this.lastCutawayKey = key;

    for (const ch of this.neighborsGroup.children) {
      if (exploded || this.viewOpts.wallVisibility === "up") {
        ch.visible = true;
      } else if (ch.name === "neighbor-left") {
        ch.visible = camPos.x >= 1.2;
      } else if (ch.name === "neighbor-right") {
        ch.visible = camPos.x <= 3.8;
      }
    }

    const hiddenWallIds = new Set<string>();
    const hiddenWalls: WallCutawayRecord[] = [];
    for (const rec of this.wallCutawayRecords) {
      if (exploded || this.viewOpts.wallVisibility === "up") {
        rec.fullGroup.visible = true;
        rec.cutawayGroup.visible = false;
        rec.downGroup.visible = false;
      } else if (this.viewOpts.wallVisibility === "down") {
        rec.fullGroup.visible = false;
        rec.cutawayGroup.visible = false;
        rec.downGroup.visible = true;
        hiddenWallIds.add(rec.wallId);
        hiddenWalls.push(rec);
      } else {
        const isFront = isWallCutawayCandidate(
          rec.startX,
          rec.startZ,
          rec.endX,
          rec.endZ,
          camPos.x,
          camPos.z,
          tgt.x,
          tgt.z,
          rec.exterior,
        );
        rec.fullGroup.visible = !isFront;
        rec.cutawayGroup.visible = isFront;
        rec.downGroup.visible = false;
        if (isFront) {
          hiddenWallIds.add(rec.wallId);
          hiddenWalls.push(rec);
        }
      }
    }

    // Keep structural column heights synced with Cutaway / Down mode (BM-04)
    for (const colRec of this.columnCutawayRecords) {
      if (exploded || this.viewOpts.wallVisibility === "up") {
        colRec.fullObj.visible = true;
        colRec.cutawayObj.visible = false;
        colRec.downObj.visible = false;
      } else if (this.viewOpts.wallVisibility === "down") {
        colRec.fullObj.visible = false;
        colRec.cutawayObj.visible = false;
        colRec.downObj.visible = true;
      } else {
        let onCutawayWall = false;
        for (const hw of hiddenWalls) {
          if (hw.levelIndex !== colRec.levelIndex) continue;
          const wdx = hw.endX - hw.startX;
          const wdz = hw.endZ - hw.startZ;
          const wLenSq = wdx * wdx + wdz * wdz;
          if (wLenSq < 1e-6) continue;
          const t = Math.max(0, Math.min(1, ((colRec.x - hw.startX) * wdx + (colRec.z - hw.startZ) * wdz) / wLenSq));
          const px = hw.startX + wdx * t;
          const pz = hw.startZ + wdz * t;
          if (Math.hypot(colRec.x - px, colRec.z - pz) < 0.35) {
            onCutawayWall = true;
            break;
          }
        }
        colRec.fullObj.visible = !onCutawayWall;
        colRec.cutawayObj.visible = onCutawayWall;
        colRec.downObj.visible = false;
      }
    }

    // Keep masonry brick instances strictly synchronized with Cutaway/Rendah state so full-height
    // bricks never block open cutaway walls even when "Bata" or unfinished view is active.
    for (const batch of this.brickBatches) {
      batch.im.visible = showBrickMeshes;
      if (showBrickMeshes && !exploded) {
        const entry = this.brickExplodeMap.get(batch.im);
        if (!entry) continue;
        for (const [wallId, indices] of batch.wallIndices) {
          const hideWall = hiddenWallIds.has(wallId);
          for (const i of indices) {
            this._q.set(entry.quat[i * 4]!, entry.quat[i * 4 + 1]!, entry.quat[i * 4 + 2]!, entry.quat[i * 4 + 3]!);
            this._v1.set(entry.pos[i * 3]!, entry.pos[i * 3 + 1]!, entry.pos[i * 3 + 2]!);
            if (hideWall) {
              this._s1.set(0, 0, 0);
            } else {
              this._s1.set(entry.scl[i * 3]!, entry.scl[i * 3 + 1]!, entry.scl[i * 3 + 2]!);
            }
            this._m4.compose(this._v1, this._q, this._s1);
            batch.im.setMatrixAt(i, this._m4);
          }
        }
        batch.im.instanceMatrix.needsUpdate = true;
      }
    }
    this._s1.set(1, 1, 1);
  }

  private updateSelectionRing(derived: DerivedProjectModel, sel: SelectionTarget): void {
    this.pushPullGizmoGroup.visible = false;
    if (this.roomOutlineLoop) {
      this.roomOutlineLoop.visible = false;
    }
    if (!sel || sel.kind === "part") {
      this.selectedRing.visible = false;
      return;
    }
    const lv = derived.project.levels[sel.levelIndex];
    if (!lv) {
      this.selectedRing.visible = false;
      return;
    }
    const baseY =
      sel.levelIndex === 0
        ? derived.project.site.peil.floor1PeilM
        : derived.project.site.peil.floor1PeilM + (derived.project.levels[0]?.height ?? 3.6);
    let pt: { x: number; y: number; z: number } | null = null;
    if (sel.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === sel.id);
      if (f) pt = { x: f.position.x, y: baseY + 0.04, z: f.position.z };
    } else if (sel.kind === "hvac") {
      const h = lv.hvac.find((x) => x.id === sel.id);
      if (h) pt = { x: h.position.x, y: baseY + Math.max(0.05, h.position.y - 0.1), z: h.position.z };
    } else if (sel.kind === "light") {
      const l = lv.lights.find((x) => x.id === sel.id);
      if (l) pt = { x: l.position.x, y: baseY + 0.06, z: l.position.z };
    } else if (sel.kind === "wall") {
      const w = lv.walls.find((x) => x.id === sel.id);
      if (w) {
        const midX = (w.start.x + w.end.x) * 0.5;
        const midZ = (w.start.z + w.end.z) * 0.5;
        pt = { x: midX, y: baseY + 0.05, z: midZ };
        const dx = w.end.x - w.start.x;
        const dz = w.end.z - w.start.z;
        const len = Math.hypot(dx, dz);
        if (len >= 0.25 && this.viewOpts.activeTool === "select") {
          const nx = -dz / len;
          const nz = dx / len;
          this.pushPullGizmoGroup.position.set(midX, baseY + Math.min(1.05, Math.max(0.45, w.height * 0.42)), midZ);
          this.pushPullGizmoGroup.rotation.y = Math.atan2(nx, nz);
          this.pushPullGizmoGroup.visible = true;
        }
      }
    } else if (sel.kind === "opening") {
      const w = lv.walls.find((x) => x.id === sel.wallId);
      const op = w?.openings.find((o) => o.id === sel.id);
      if (w && op) {
        const dx = w.end.x - w.start.x;
        const dz = w.end.z - w.start.z;
        const len = Math.hypot(dx, dz) || 1;
        pt = {
          x: w.start.x + (dx / len) * op.offset,
          y: baseY + op.sill + 0.05,
          z: w.start.z + (dz / len) * op.offset,
        };
      }
    } else if (sel.kind === "room") {
      const r = lv.rooms.find((x) => x.id === sel.id);
      if (r && r.polygon.length >= 3) {
        const pts = r.polygon.map((p) => new THREE.Vector3(p.x, baseY + 0.045, p.z));
        if (!this.roomOutlineLoop) {
          const g = new THREE.BufferGeometry().setFromPoints(pts);
          const m = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.92, depthTest: false });
          this.roomOutlineLoop = new THREE.LineLoop(g, m);
          this.roomOutlineLoop.renderOrder = 997;
          this.overlayGroup.add(this.roomOutlineLoop);
        } else {
          this.roomOutlineLoop.geometry.dispose();
          this.roomOutlineLoop.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        }
        this.roomOutlineLoop.visible = true;
      }
      this.selectedRing.visible = false;
      return;
    } else if (sel.kind === "floorTile") {
      pt = { x: (sel.gx + 0.5) * 0.5, y: baseY + 0.035, z: (sel.gz + 0.5) * 0.5 };
    } else if (sel.kind === "stair") {
      const st = lv.stairs.find((x) => x.id === sel.id);
      if (st) pt = { x: (st.start.x + st.end.x) * 0.5, y: baseY + 0.08, z: (st.start.z + st.end.z) * 0.5 };
    } else if (sel.kind === "pool") {
      const pl = (derived.project.buildExtras?.pools ?? []).find((p) => p.id === sel.id);
      if (pl) {
        const x1 = Math.min(pl.gx1, pl.gx2) * 0.5;
        const x2 = (Math.max(pl.gx1, pl.gx2) + 1) * 0.5;
        const z1 = Math.min(pl.gz1, pl.gz2) * 0.5;
        const z2 = (Math.max(pl.gz1, pl.gz2) + 1) * 0.5;
        pt = { x: (x1 + x2) * 0.5, y: 0.05, z: (z1 + z2) * 0.5 };
      }
    }
    if (pt) {
      this.selectedRing.position.set(pt.x, pt.y, pt.z);
      this.selectedRing.visible = true;
    } else {
      this.selectedRing.visible = false;
    }
  }

  private getActiveCatalogItem(): BuildCatalogEntry {
    return UNIFIED_BUILD_CATALOG.find((c) => c.id === this.viewOpts.selectedCatalogId) ?? UNIFIED_BUILD_CATALOG[0]!;
  }

  private clearSim(): void {
    this.simGroup.clear();
    this.airParticlesMesh = null;
    this.airParticleStates = [];
    for (const r of this.simResources) r.dispose();
    this.simResources = [];
  }

  private rebuildSimOverlays(): void {
    this.clearSim();
    if (!this.derived || !this.studioView) return;
    const { project } = this.derived;
    const lt1Y = project.site.peil.floor1PeilM;
    const lt2Y = lt1Y + (project.levels[0]?.height ?? 3.6);
    const activeLv = this.viewOpts.activeLevel;

    if (this.studioView.showLuxHeatmap && this.lighting) {
      const lighting = this.lighting;
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
        const geo = new THREE.PlaneGeometry(project.site.width, project.site.depth);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(project.site.width * 0.5, yPos, project.site.depth * 0.5);
        mesh.renderOrder = 500;
        this.simGroup.add(mesh);
        this.simResources.push(tex, geo, mat);
      };
      if (activeLv === 0 || activeLv === 2) makeHeatmapPlane(lighting.lt1LuxGrid, lt1Y + 0.045);
      if (activeLv >= 1) makeHeatmapPlane(lighting.lt2LuxGrid, lt2Y + 0.045);
    }

    if (this.studioView.showAirParticles && this.airflow) {
      const count = 320;
      const geo = new THREE.ConeGeometry(0.032, 0.22, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.renderOrder = 700;
      this.airParticlesMesh = im;
      this.airParticleStates = Array.from({ length: count }, (_, i) => {
        const lv: 0 | 1 = activeLv === 0 ? 0 : activeLv === 1 ? 1 : i % 2 === 0 ? 0 : 1;
        return {
          x: Math.random() * (project.site.width - 0.2) + 0.1,
          y: (lv === 0 ? lt1Y : lt2Y) + 0.8 + Math.random() * 1.7,
          z: Math.random() * (project.site.depth - 0.4) + 0.2,
          lv,
          life: Math.random(),
        };
      });
      this.simGroup.add(im);
      this.simResources.push(geo, mat);
    }

    if (this.studioView.showFloodWater && this.flood && this.flood.streetFloodCm > 0) {
      const streetWaterY = this.flood.streetFloodCm / 100;
      const extW = Math.max(24, project.site.width + 18);
      const extGeo = new THREE.PlaneGeometry(extW, 11.4, 36, 24);
      extGeo.rotateX(-Math.PI / 2);
      const extMesh = new THREE.Mesh(extGeo, this.palette.floodWater);
      extMesh.position.set(project.site.width * 0.5, streetWaterY, -1.0);
      extMesh.renderOrder = 600;
      this.simGroup.add(extMesh);
      this.simResources.push(extGeo);

      if (this.flood.lt1FloorFloodCm > 0) {
        const insideWaterY = lt1Y + this.flood.lt1FloorFloodCm / 100;
        const inW = Math.max(2, project.site.width - 0.1);
        const inD = Math.max(4, project.site.depth - 4.0);
        const inGeo = new THREE.PlaneGeometry(inW, inD, 16, 28);
        inGeo.rotateX(-Math.PI / 2);
        const inMesh = new THREE.Mesh(inGeo, this.palette.floodWater);
        inMesh.position.set(project.site.width * 0.5, insideWaterY, 4.0 + inD * 0.5);
        inMesh.renderOrder = 601;
        this.simGroup.add(inMesh);
        this.simResources.push(inGeo);
      }

      if (project.floodMitigation.doorFloodBarrier) {
        const bh = project.floodMitigation.barrierHeightCm / 100;
        const barMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.35, metalness: 0.65 });
        const barGeo = createChamferBox(1.05, bh, 0.06, 0.008, 1);
        const b1 = new THREE.Mesh(barGeo, barMat);
        b1.position.set(Math.min(project.site.width - 0.6, 1.58), lt1Y + bh * 0.5, 4.0);
        this.simGroup.add(b1);
        this.simResources.push(barGeo, barMat);
      }
    }
  }

  private raycastHit(
    e: PointerEvent,
    ignoreParts = true,
  ): {
    sel: NonNullable<SelectionTarget>;
    label: string;
    obj: THREE.Object3D;
    point: THREE.Vector3;
    faceNormalWorld?: THREE.Vector3;
  } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.activeCamera);
    const hits = this.raycaster.intersectObjects([this.propsContainer, this.houseContainer], true);
    const project = this.derived?.project;
    const lt2BaseY = project ? project.site.peil.floor1PeilM + (project.levels[0]?.height ?? 3.6) - 0.12 : 4.0;

    for (const h of hits) {
      let cur: THREE.Object3D | null = h.object;
      let vis = true;
      while (cur) {
        if (!cur.visible) {
          vis = false;
          break;
        }
        cur = cur.parent;
      }
      if (!vis) continue;

      const faceNormalWorld = h.face
        ? new THREE.Vector3().copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize()
        : undefined;

      const customTileMeta = h.object.userData?.customTileMeta as { levelIndex: 0 | 1; materialId: string } | undefined;
      if (customTileMeta) {
        const gx = Math.floor(h.point.x / 0.5);
        const gz = Math.floor(h.point.z / 0.5);
        return {
          sel: {
            kind: "floorTile",
            id: `${customTileMeta.levelIndex}:${gx}:${gz}`,
            levelIndex: customTileMeta.levelIndex,
            gx,
            gz,
          },
          label: `Ubin Lantai (${gx}, ${gz})`,
          obj: h.object,
          point: h.point.clone(),
          faceNormalWorld,
        };
      }

      cur = h.object;
      while (cur) {
        if (cur.userData?.sel) {
          const sel = cur.userData.sel as NonNullable<SelectionTarget>;
          if (sel.kind === "part" && ignoreParts) {
            if (sel.id === "lantai" && project) {
              const hitLv = (h.point.y >= lt2BaseY ? 1 : 0) as 0 | 1;
              const gx = Math.floor(h.point.x / 0.5);
              const gz = Math.floor(h.point.z / 0.5);
              const hasTile = (project.buildExtras?.floorTiles ?? []).some(
                (ct) => ct.levelIndex === hitLv && ct.gx === gx && ct.gz === gz,
              );
              if (hasTile) {
                return {
                  sel: { kind: "floorTile", id: `${hitLv}:${gx}:${gz}`, levelIndex: hitLv, gx, gz },
                  label: `Ubin Lantai (${gx}, ${gz})`,
                  obj: cur,
                  point: h.point.clone(),
                  faceNormalWorld,
                };
              }
              const rm = findRoomAtPoint(project.levels[hitLv]?.rooms ?? [], h.point.x, h.point.z);
              if (rm) {
                return {
                  sel: { kind: "room", id: rm.id, levelIndex: hitLv },
                  label: `Ruangan ${rm.name}`,
                  obj: cur,
                  point: h.point.clone(),
                  faceNormalWorld,
                };
              }
            }
            break;
          }
          return { sel, label: String(cur.userData.label ?? "Elemen"), obj: cur, point: h.point.clone(), faceNormalWorld };
        }
        cur = cur.parent;
      }
    }
    return null;
  }

  private getBlockedPolysForLevel(lvIdx: 0 | 1): Vec2[][] {
    const project = this.derived?.project;
    if (!project) return [];
    const polys: Vec2[][] = [];
    if (lvIdx === 1) {
      for (const sl of project.levels[1]?.slabs ?? []) {
        if (sl.isVoid && sl.polygon.length >= 3) polys.push(sl.polygon);
      }
    } else {
      for (const pl of project.buildExtras?.pools ?? []) {
        const x1 = Math.min(pl.gx1, pl.gx2) * 0.5;
        const x2 = (Math.max(pl.gx1, pl.gx2) + 1) * 0.5;
        const z1 = Math.min(pl.gz1, pl.gz2) * 0.5;
        const z2 = (Math.max(pl.gz1, pl.gz2) + 1) * 0.5;
        polys.push([
          { x: x1, z: z1 },
          { x: x2, z: z1 },
          { x: x2, z: z2 },
          { x: x1, z: z2 },
        ]);
      }
    }
    return polys;
  }

  private isCellBlocked(lvIdx: 0 | 1, gx: number, gz: number): boolean {
    const blocked = this.getBlockedPolysForLevel(lvIdx);
    if (blocked.length === 0) return false;
    const pt = { x: (gx + 0.5) * 0.5, z: (gz + 0.5) * 0.5 };
    return blocked.some((poly) => pointInPolygon(pt, poly));
  }

  private getIndoorProtectedPolys(): Vec2[][] {
    const lv0 = this.derived?.project.levels[0];
    if (!lv0) return [];
    return lv0.rooms.filter((r) => isIndoorRoomProgram(r.program) && r.polygon.length >= 3).map((r) => r.polygon);
  }

  private updateLiveTerrainMesh(heights: number[]): void {
    const project = this.derived?.project;
    const cols = Math.round((project?.site.width ?? 5) / 0.5);
    const rows = Math.round((project?.site.depth ?? 17) / 0.5);
    let targetMesh: THREE.Mesh | null = null;
    this.houseContainer.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData?.isTerrainMesh) {
        targetMesh = o;
      }
    });
    if (!targetMesh) {
      if (!this.liveTerrainTempMesh) {
        const tGeo = new THREE.PlaneGeometry((project?.site.width ?? 5) + 0.4, (project?.site.depth ?? 17) + 0.4, cols, rows);
        tGeo.rotateX(-Math.PI / 2);
        tGeo.translate((project?.site.width ?? 5) * 0.5, 0.02, (project?.site.depth ?? 17) * 0.5);
        this.liveTerrainTempMesh = new THREE.Mesh(tGeo, this.palette.grass);
        this.liveTerrainTempMesh.receiveShadow = true;
        this.overlayGroup.add(this.liveTerrainTempMesh);
      }
      targetMesh = this.liveTerrainTempMesh;
    }
    const pos = targetMesh.geometry.getAttribute("position");
    const stride = cols + 1;
    for (let iz = 0; iz <= rows; iz++) {
      for (let ix = 0; ix <= cols; ix++) {
        const idx = iz * stride + ix;
        if (idx < pos.count) {
          pos.setY(idx, 0.02 + (heights[idx] ?? 0));
        }
      }
    }
    pos.needsUpdate = true;
    targetMesh.geometry.computeVertexNormals();
  }

  private getOrCreatePreviewGhost(item: BuildCatalogEntry, valid: boolean, swatchHex: string | null): THREE.Group {
    const hex = swatchHex ?? item.swatchHex;
    const key = `${item.id}:${hex}`;
    let entry = this.ghostCache.get(key);
    if (!entry) {
      const group = new THREE.Group();
      group.userData.isCachedGhost = true;
      const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
      const tintMeshes: THREE.Mesh[] = [];
      let inner: THREE.Object3D;
      const sz = item.sizeM ?? [0.6, 0.6, 0.6];
      if (item.toolId === "furniture") {
        inner = buildFurnitureMesh(
          {
            id: "__ghost__",
            catalogId: item.materialId ?? "sofa_l",
            name: item.name,
            category: item.furnitureCategory ?? "seating",
            position: { x: 0, y: 0, z: 0 },
            size: { x: sz[0], y: sz[1], z: sz[2] },
            rotationY: 0,
            colorHex: hex,
            accentHex: item.accentHex,
          },
          this.palette,
          disposables,
        );
      } else if (item.toolId === "hvac" && item.hvacMeta) {
        inner = buildHvacMesh(
          {
            id: "__ghost__",
            name: item.name,
            type: item.hvacMeta.type,
            position: { x: 0, y: 0, z: 0 },
            rotationY: 0,
            pkRating: item.hvacMeta.pkRating,
            flowRateM3h: item.hvacMeta.flowRateM3h,
            coolingCapacityW: item.hvacMeta.coolingCapacityW,
            powerW: item.hvacMeta.powerW,
            setpointC: item.hvacMeta.setpointC,
            speedLevel: 2,
            on: true,
          },
          this.palette,
          disposables,
          [],
        );
      } else if (item.toolId === "light" && item.lightMeta) {
        inner = buildLightFixtureMesh(
          {
            id: "__ghost__",
            name: item.name,
            type: item.lightMeta.type,
            position: { x: 0, y: 0, z: 0 },
            rotationY: 0,
            lumens: item.lightMeta.lumens,
            colorTempK: item.lightMeta.colorTempK,
            beamAngleDeg: item.lightMeta.beamAngleDeg,
            dimmer: 1,
            on: true,
          },
          this.palette,
          disposables,
        );
      } else {
        const g = new THREE.BoxGeometry(sz[0], sz[1], sz[2]);
        disposables.push(g);
        inner = new THREE.Mesh(g, this.ghostValidMat);
      }
      inner.position.set(0, 0, 0);
      inner.rotation.set(0, 0, 0);
      inner.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (o.geometry.type === "PlaneGeometry" && o.rotation.x < -1.4) {
            o.visible = false;
            return;
          }
          o.castShadow = false;
          o.receiveShadow = false;
          tintMeshes.push(o);
        }
      });
      const arrowGeo = new THREE.ConeGeometry(0.1, 0.24, 10);
      arrowGeo.rotateX(Math.PI / 2);
      arrowGeo.translate(0, 0.08, sz[2] * 0.5 + 0.16);
      disposables.push(arrowGeo);
      const arrowMesh = new THREE.Mesh(arrowGeo, this.ghostValidMat);
      tintMeshes.push(arrowMesh);

      group.add(inner, arrowMesh);
      entry = { group, tintMeshes, disposables };
      this.ghostCache.set(key, entry);
    }
    const mat = valid ? this.ghostValidMat : this.ghostInvalidMat;
    for (const m of entry.tintMeshes) {
      m.material = mat;
    }
    return entry.group;
  }

  private resolveWallPaintTarget(
    hitRes: NonNullable<ReturnType<BuildScene["raycastHit"]>>,
    shiftHeld: boolean,
  ): {
    wall: Wall;
    lvIdx: 0 | 1;
    sideKey: "frontMaterialId" | "backMaterialId";
    room: Room | null;
  } | null {
    if (!this.derived || hitRes.sel.kind !== "wall") return null;
    const lvIdx = hitRes.sel.levelIndex as 0 | 1;
    const lv = this.derived.project.levels[lvIdx];
    const w = lv?.walls.find((x) => x.id === hitRes.sel.id);
    if (!lv || !w) return null;
    const dx = w.end.x - w.start.x;
    const dz = w.end.z - w.start.z;
    const len = Math.hypot(dx, dz) || 1;
    const rnx = -dz / len;
    const rnz = dx / len;
    let dot = 1;
    if (hitRes.faceNormalWorld) {
      dot = hitRes.faceNormalWorld.x * rnx + hitRes.faceNormalWorld.z * rnz;
    } else {
      const camPos = this.cameraCtrl.activeCamera.position;
      dot = (camPos.x - hitRes.point.x) * rnx + (camPos.z - hitRes.point.z) * rnz;
    }
    const sideKey: "frontMaterialId" | "backMaterialId" = dot >= 0 ? "frontMaterialId" : "backMaterialId";
    const sgn = dot >= 0 ? 1 : -1;
    let room: Room | null = null;
    if (this.viewOpts.wallPaintMode === "room" || shiftHeld) {
      room =
        findRoomAtPoint(lv.rooms, hitRes.point.x + rnx * sgn * 0.35, hitRes.point.z + rnz * sgn * 0.35) ??
        findRoomAtPoint(lv.rooms, (w.start.x + w.end.x) * 0.5 + rnx * sgn * 0.35, (w.start.z + w.end.z) * 0.5 + rnz * sgn * 0.35);
    }
    return { wall: w, lvIdx, sideKey, room };
  }

  private resolveEyedropper(hitRes: NonNullable<ReturnType<BuildScene["raycastHit"]>>): { catalogId: string; swatchHex?: string | null } | null {
    if (!this.derived) return null;
    const project = this.derived.project;
    const s = hitRes.sel;
    if (s.kind === "furniture") {
      const f = project.levels[s.levelIndex]?.furniture.find((x) => x.id === s.id);
      if (f) return { catalogId: `furn_${f.catalogId}`, swatchHex: f.colorHex };
    } else if (s.kind === "hvac") {
      const h = project.levels[s.levelIndex]?.hvac.find((x) => x.id === s.id);
      if (h) {
        const cands = UNIFIED_BUILD_CATALOG.filter((c) => c.hvacMeta?.type === h.type);
        cands.sort((a, b) => Math.abs((a.hvacMeta?.coolingCapacityW ?? 0) - h.coolingCapacityW) - Math.abs((b.hvacMeta?.coolingCapacityW ?? 0) - h.coolingCapacityW));
        if (cands[0]) return { catalogId: cands[0].id };
      }
    } else if (s.kind === "light") {
      const l = project.levels[s.levelIndex]?.lights.find((x) => x.id === s.id);
      if (l) {
        const cands = UNIFIED_BUILD_CATALOG.filter((c) => c.lightMeta?.type === l.type);
        cands.sort((a, b) => Math.abs((a.lightMeta?.lumens ?? 0) - l.lumens) - Math.abs((b.lightMeta?.lumens ?? 0) - l.lumens));
        if (cands[0]) return { catalogId: cands[0].id };
      }
    } else if (s.kind === "wall") {
      const w = project.levels[s.levelIndex]?.walls.find((x) => x.id === s.id);
      if (w?.kind === "fence") return { catalogId: "tool_fence" };
      const ptTarget = this.resolveWallPaintTarget(hitRes, false);
      const sideMatId = ptTarget ? w?.[ptTarget.sideKey] ?? w?.materialId : w?.materialId;
      const match = UNIFIED_BUILD_CATALOG.find((c) => c.toolId === "wall_paint" && c.materialId === sideMatId);
      return { catalogId: match?.id ?? "tool_wall_straight" };
    } else if (s.kind === "opening") {
      const w = project.levels[s.levelIndex]?.walls.find((x) => x.id === s.wallId);
      const op = w?.openings.find((o) => o.id === s.id);
      if (op) {
        const cands = UNIFIED_BUILD_CATALOG.filter((c) => c.toolId === "opening" && c.openingKind === op.kind);
        cands.sort((a, b) => Math.abs((a.sizeM?.[0] ?? 0.9) - op.width) - Math.abs((b.sizeM?.[0] ?? 0.9) - op.width));
        if (cands[0]) return { catalogId: cands[0].id };
      }
    } else if (s.kind === "floorTile") {
      const tile = (project.buildExtras?.floorTiles ?? []).find((t) => t.levelIndex === s.levelIndex && t.gx === s.gx && t.gz === s.gz);
      const match = UNIFIED_BUILD_CATALOG.find((c) => c.toolId === "floor_tile" && c.materialId === tile?.materialId);
      if (match) return { catalogId: match.id };
    } else if (s.kind === "room") {
      const rm = project.levels[s.levelIndex]?.rooms.find((r) => r.id === s.id);
      const match = UNIFIED_BUILD_CATALOG.find((c) => c.toolId === "floor_tile" && c.materialId === rm?.floorMaterialId);
      if (match) return { catalogId: match.id };
    } else if (s.kind === "stair") {
      return { catalogId: "stair_straight" };
    } else if (s.kind === "pool") {
      return { catalogId: "outdoor_pool" };
    }
    return null;
  }

  private getMountKind(
    tool: BuildToolId,
    hvacType?: HvacType,
    lightType?: LightType,
  ): "wall" | "ceiling" | "surface" {
    if (
      (tool === "hvac" && (hvacType === "ac_split" || hvacType === "wall_fan" || hvacType === "exhaust_fan")) ||
      (tool === "light" && lightType === "wall")
    ) {
      return "wall";
    }
    if (
      (tool === "hvac" && hvacType === "ceiling_fan") ||
      (tool === "light" && (lightType === "ceiling" || lightType === "pendant" || lightType === "spot" || lightType === "strip"))
    ) {
      return "ceiling";
    }
    return "surface";
  }

  private raycastSurfaceForPlacement(
    e: PointerEvent,
    lvIdx: 0 | 1,
    mountKind: "wall" | "ceiling" | "surface",
    wallOffset: number,
    defaultElev: number,
    excludeEntityId?: string,
  ): {
    x: number;
    y: number;
    z: number;
    rotationY?: number;
    valid: boolean;
    surfaceLabel: string;
    hostFurniture?: FurnitureItem;
    wallSnap?: ReturnType<typeof snapOpeningToProjectWalls>;
    altBypass: boolean;
  } {
    const altBypass = e.altKey || this.altHeld;
    if (!this.derived) {
      return { x: 2.5, y: defaultElev, z: 8.5, valid: false, surfaceLabel: "Luar area", altBypass };
    }
    const project = this.derived.project;
    const baseY =
      lvIdx === 0
        ? project.site.peil.floor1PeilM
        : project.site.peil.floor1PeilM + (project.levels[0]?.height ?? 3.6);
    const lv = project.levels[lvIdx];
    if (!lv) {
      return { x: 2.5, y: defaultElev, z: 8.5, valid: false, surfaceLabel: "Lantai tidak tersedia", altBypass };
    }

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.activeCamera);
    }

    const targets: THREE.Object3D[] = [];
    if (this.levelRoots) targets.push(this.levelRoots[lvIdx]);
    if (mountKind === "surface") targets.push(this.propLevelRoots[lvIdx]);
    if (lvIdx === 1 && this.lt2StructuralGroup && mountKind === "surface") targets.push(this.lt2StructuralGroup);

    const hits = targets.length > 0 ? this.raycaster.intersectObjects(targets, true) : [];

    const isVisibleAndNotExcluded = (obj: THREE.Object3D): { ok: boolean; selKind?: string; selId?: string } => {
      let cur: THREE.Object3D | null = obj;
      let selKind: string | undefined;
      let selId: string | undefined;
      while (cur) {
        if (!cur.visible) return { ok: false };
        if (cur.userData?.sel) {
          const s = cur.userData.sel as NonNullable<SelectionTarget>;
          if (excludeEntityId && "id" in s && s.id === excludeEntityId) return { ok: false };
          if (!selKind) {
            selKind = s.kind;
            if ("id" in s) selId = s.id;
          }
        }
        cur = cur.parent;
      }
      return { ok: true, selKind, selId };
    };

    if (mountKind === "wall") {
      for (const h of hits) {
        const check = isVisibleAndNotExcluded(h.object);
        if (!check.ok || !h.face) continue;
        this._tmpNorm.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize();
        const isVertical = Math.abs(this._tmpNorm.y) < 0.35;
        if (check.selKind === "wall" || isVertical) {
          let nx = this._tmpNorm.x;
          let nz = this._tmpNorm.z;
          const nLen = Math.hypot(nx, nz);
          if (nLen < 1e-4) continue;
          nx /= nLen;
          nz /= nLen;
          // Ensure normal points toward camera side of wall
          const camPos = this.cameraCtrl.activeCamera.position;
          const toCamX = camPos.x - h.point.x;
          const toCamZ = camPos.z - h.point.z;
          if (nx * toCamX + nz * toCamZ < 0) {
            nx = -nx;
            nz = -nz;
          }
          const px = h.point.x + nx * wallOffset;
          const pz = h.point.z + nz * wallOffset;
          const rawLocalY = h.point.y - baseY;
          const py = rawLocalY >= 0.35 && rawLocalY <= lv.height - 0.15 ? rawLocalY : defaultElev;
          const rotY = Math.atan2(nx, nz);
          const inBounds = px >= 0.02 && px <= project.site.width - 0.02 && pz >= 0.02 && pz <= project.site.depth - 0.02;
          const wallSnap = snapOpeningToProjectWalls(lv.walls, h.point.x, h.point.z, 0.45);
          return { x: px, y: py, z: pz, rotationY: rotY, valid: inBounds, surfaceLabel: "Permukaan Dinding", wallSnap, altBypass };
        }
      }

      // Fallback: snap to nearest wall near floor cursor when walls are in cutaway/down mode
      const wallSnap = snapOpeningToProjectWalls(lv.walls, this.lastWorldPos.x, this.lastWorldPos.z, 0.35);
      if (wallSnap) {
        const w = wallSnap.wall;
        const wdx = w.end.x - w.start.x;
        const wdz = w.end.z - w.start.z;
        const wLen = Math.max(0.01, Math.hypot(wdx, wdz));
        let nx = -wdz / wLen;
        let nz = wdx / wLen;
        const camPos = this.cameraCtrl.activeCamera.position;
        const toCamX = camPos.x - wallSnap.worldX;
        const toCamZ = camPos.z - wallSnap.worldZ;
        if (nx * toCamX + nz * toCamZ < 0) {
          nx = -nx;
          nz = -nz;
        }
        return {
          x: wallSnap.worldX + nx * wallOffset,
          y: defaultElev,
          z: wallSnap.worldZ + nz * wallOffset,
          rotationY: Math.atan2(nx, nz),
          valid: true,
          surfaceLabel: `Dinding (${w.name})`,
          wallSnap,
          altBypass,
        };
      }
      return {
        x: this.lastWorldPos.x,
        y: defaultElev,
        z: this.lastWorldPos.z,
        valid: false,
        surfaceLabel: "Arahkan ke permukaan dinding",
        altBypass,
      };
    }

    const snapCoord = (v: number) => (altBypass ? v : Math.round(v * 20) / 20);

    if (mountKind === "surface") {
      for (const h of hits) {
        const check = isVisibleAndNotExcluded(h.object);
        if (!check.ok || !h.face) continue;
        if (check.selKind === "wall") continue;
        this._tmpNorm.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize();
        if (this._tmpNorm.y < 0.65) continue;
        const rawLocalY = h.point.y - baseY;
        const hostFurniture =
          check.selKind === "furniture" && check.selId && rawLocalY >= 0.08
            ? lv.furniture.find((f) => f.id === check.selId)
            : undefined;
        const px = snapCoord(h.point.x);
        const pz = snapCoord(h.point.z);
        const py = rawLocalY < 0.08 ? 0 : Math.min(lv.height - 0.3, rawLocalY);
        const inBounds = px >= 0.08 && px <= project.site.width - 0.08 && pz >= 0.08 && pz <= project.site.depth - 0.08;
        const label = hostFurniture ? `Atas ${hostFurniture.name}` : "Permukaan Lantai";
        return { x: px, y: py, z: pz, valid: inBounds, surfaceLabel: label, hostFurniture, altBypass };
      }
    }

    // Fallback or ceiling mount: default 0.5m grid snap unless Alt held
    const px = snapCoord(this.lastWorldPos.x);
    const pz = snapCoord(this.lastWorldPos.z);
    const inBounds = px >= 0.08 && px <= project.site.width - 0.08 && pz >= 0.08 && pz <= project.site.depth - 0.08;
    return {
      x: px,
      y: mountKind === "ceiling" ? defaultElev : 0,
      z: pz,
      valid: inBounds,
      surfaceLabel: mountKind === "ceiling" ? "Plafon Ruangan" : "Permukaan Lantai",
      altBypass,
    };
  }

  private updateToolPreview(e: PointerEvent): void {
    if (!this.derived) return;
    this.clearPreviewMeshes();

    const project = this.derived.project;
    const cs = 0.5;
    const cols = Math.round(project.site.width / cs);
    const rows = Math.round(project.site.depth / cs);
    const baseY = this.getActiveFloorY();
    const lvIdx = Math.min(1, this.viewOpts.activeLevel) as 0 | 1;
    const lv = project.levels[lvIdx]!;
    const lvH = lv.height;
    const tool = this.viewOpts.activeTool;
    const item = this.getActiveCatalogItem();

    const interiorEditTool =
      tool === "wall_straight" ||
      tool === "wall_room" ||
      tool === "wall_diagonal" ||
      tool === "wall_paint" ||
      tool === "fence" ||
      tool === "floor_tile" ||
      tool === "opening" ||
      tool === "stair" ||
      tool === "pool" ||
      tool === "furniture" ||
      tool === "hvac" ||
      tool === "light";
    if (this.viewOpts.activeLevel === 2 && interiorEditTool) {
      this.actions.onPreviewHud({ label: "Pilih LT 1 / LT 2 untuk memasang elemen", valid: false });
      return;
    }

    if (tool === "sledgehammer" && this.sledgeDragStart) {
      const wx = this.lastWorldPos.x;
      const wz = this.lastWorldPos.z;
      const minX = Math.max(0, Math.min(this.sledgeDragStart.x, wx));
      const maxX = Math.min(project.site.width, Math.max(this.sledgeDragStart.x, wx));
      const minZ = Math.max(0, Math.min(this.sledgeDragStart.z, wz));
      const maxZ = Math.min(project.site.depth, Math.max(this.sledgeDragStart.z, wz));
      const wM = Math.max(0.25, maxX - minX);
      const dM = Math.max(0.25, maxZ - minZ);
      const box = new THREE.Mesh(new THREE.BoxGeometry(wM, 0.25, dM), this.invalidMat);
      box.position.set((minX + maxX) * 0.5, baseY + 0.14, (minZ + maxZ) * 0.5);
      this.previewGroup.add(box);
      const tileCount = (project.buildExtras?.floorTiles ?? []).filter((t) => {
        const cx = (t.gx + 0.5) * cs;
        const cz = (t.gz + 0.5) * cs;
        return t.levelIndex === lvIdx && cx >= minX && cx <= maxX && cz >= minZ && cz <= maxZ;
      }).length;
      const wallCount = lv.walls.filter((w) => {
        const mx = (w.start.x + w.end.x) * 0.5;
        const mz = (w.start.z + w.end.z) * 0.5;
        return mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ;
      }).length;
      this.actions.onPreviewHud({
        label: `Hapus Area: ${tileCount} ubin · ${wallCount} dinding`,
        valid: tileCount + wallCount > 0,
      });
      return;
    }

    if (tool === "select" || tool === "sledgehammer" || tool === "eyedropper" || tool === "wall_paint") {
      const hitRes = this.raycastHit(e, true);
      if (tool === "wall_paint") {
        if (hitRes?.sel.kind === "wall") {
          const target = this.resolveWallPaintTarget(hitRes, e.shiftKey);
          this._hoverBox.setFromObject(hitRes.obj);
          this._hoverBox.getSize(this._hoverSize);
          this._hoverBox.getCenter(this._hoverCenter);
          this.hoverHighlightMesh.material = this.validMat;
          this.hoverHighlightMesh.scale.set(
            Math.max(0.18, this._hoverSize.x + 0.06),
            Math.max(0.18, this._hoverSize.y + 0.06),
            Math.max(0.18, this._hoverSize.z + 0.06),
          );
          this.hoverHighlightMesh.position.copy(this._hoverCenter);
          this.hoverHighlightMesh.visible = true;
          const sideText = target?.room
            ? `1 Ruangan (${target.room.name})`
            : target?.sideKey === "frontMaterialId"
              ? "Sisi Depan/Luar"
              : "Sisi Belakang/Dalam";
          this.actions.onPreviewHud({ label: `Cat ${sideText}: ${item.name}`, valid: true });
        } else {
          this.actions.onPreviewHud({ label: "Arahkan ke permukaan dinding untuk mengecat", valid: false });
        }
        return;
      }

      if (hitRes) {
        if (hitRes.sel.kind === "room") {
          const rm = lv.rooms.find((r) => r.id === hitRes.sel.id);
          if (rm && rm.polygon.length >= 3) {
            const xs = rm.polygon.map((p) => p.x);
            const zs = rm.polygon.map((p) => p.z);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minZ = Math.min(...zs);
            const maxZ = Math.max(...zs);
            this.hoverHighlightMesh.material = tool === "sledgehammer" ? this.invalidMat : this.cyanMat;
            this.hoverHighlightMesh.scale.set(Math.max(0.4, maxX - minX), 0.12, Math.max(0.4, maxZ - minZ));
            this.hoverHighlightMesh.position.set((minX + maxX) * 0.5, baseY + 0.07, (minZ + maxZ) * 0.5);
            this.hoverHighlightMesh.visible = true;
          }
        } else {
          this._hoverBox.setFromObject(hitRes.obj);
          this._hoverBox.getSize(this._hoverSize);
          this._hoverBox.getCenter(this._hoverCenter);
          this.hoverHighlightMesh.material = tool === "sledgehammer" ? this.invalidMat : this.cyanMat;
          this.hoverHighlightMesh.scale.set(
            Math.max(0.18, this._hoverSize.x + 0.06),
            Math.max(0.18, this._hoverSize.y + 0.06),
            Math.max(0.18, this._hoverSize.z + 0.06),
          );
          this.hoverHighlightMesh.position.copy(this._hoverCenter);
          this.hoverHighlightMesh.visible = true;
        }
        this.actions.onPreviewHud({
          label:
            tool === "sledgehammer"
              ? `Hapus: ${hitRes.label}`
              : tool === "eyedropper"
                ? `Salin: ${hitRes.label}`
                : `Pilih / Seret: ${hitRes.label}`,
          valid: true,
        });
      } else {
        this.actions.onPreviewHud(null);
      }
      return;
    }

    const wx = this.lastWorldPos.x;
    const wz = this.lastWorldPos.z;
    const gx = Math.max(0, Math.min(cols - 1, Math.floor(wx / cs)));
    const gz = Math.max(0, Math.min(rows - 1, Math.floor(wz / cs)));
    const wallCs = 0.25;
    const wallCols = Math.round(project.site.width / wallCs);
    const wallRows = Math.round(project.site.depth / wallCs);
    const curWallVert = worldToGridVertex(wx, wz, wallCs, wallCols, wallRows);

    if ((tool === "wall_straight" || tool === "wall_diagonal" || tool === "fence") && this.dragStartVertex) {
      const endV = snapWallEndpoint(
        this.dragStartVertex,
        curWallVert,
        wallCols,
        wallRows,
        tool === "wall_diagonal" || e.altKey || this.altHeld,
      );
      const dx = (endV.gx - this.dragStartVertex.gx) * wallCs;
      const dz = (endV.gz - this.dragStartVertex.gz) * wallCs;
      const len = Math.hypot(dx, dz);
      const valid = len >= 0.24;
      if (valid) {
        const h = tool === "fence" ? 1.2 : lvH;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.12, h, 0.14), this.validMat);
        m.position.set(this.dragStartVertex.gx * wallCs + dx * 0.5, baseY + h * 0.5, this.dragStartVertex.gz * wallCs + dz * 0.5);
        m.rotation.y = -Math.atan2(dz, dx);
        this.previewGroup.add(m);
      }
      this.actions.onPreviewHud({
        label: valid ? `${tool === "fence" ? "Pagar" : "Dinding"} ${len.toFixed(2)} m` : "Minimal panjang 0.25 m",
        valid,
      });
      return;
    }

    if (tool === "wall_room" && this.dragStartVertex) {
      const x1 = Math.min(this.dragStartVertex.gx, curWallVert.gx);
      const x2 = Math.max(this.dragStartVertex.gx, curWallVert.gx);
      const z1 = Math.min(this.dragStartVertex.gz, curWallVert.gz);
      const z2 = Math.max(this.dragStartVertex.gz, curWallVert.gz);
      const wM = (x2 - x1) * wallCs;
      const dM = (z2 - z1) * wallCs;
      const valid = x2 - x1 >= 2 && z2 - z1 >= 2;
      if (wM >= 0.25 && dM >= 0.25) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(wM, 0.14, dM), valid ? this.validMat : this.invalidMat);
        m.position.set((x1 + x2) * 0.5 * wallCs, baseY + 0.08, (z1 + z2) * 0.5 * wallCs);
        this.previewGroup.add(m);
      }
      this.actions.onPreviewHud({
        label: valid ? `Ruangan ${wM.toFixed(2)} × ${dM.toFixed(2)} m` : "Ruangan minimal 0.50 × 0.50 m",
        valid,
      });
      return;
    }

    if (tool === "floor_tile") {
      const blocked = this.getBlockedPolysForLevel(lvIdx);
      if (this.viewOpts.floorBrushMode === "fill") {
        if (!this.lastWorldPos.inBounds) {
          this.actions.onPreviewHud({ label: "Di luar batas kavling", valid: false });
          return;
        }
        const cells = computeProjectRoomFloodCells(lv.walls, cols, rows, cs, gx, gz, blocked);
        const geos = cells.slice(0, 500).map((c) => {
          const g = new THREE.BoxGeometry(cs, 0.03, cs);
          g.translate((c.gx + 0.5) * cs, baseY + 0.035, (c.gz + 0.5) * cs);
          return g;
        });
        const merged = mergeGeometryBatch(geos);
        if (merged) this.previewGroup.add(new THREE.Mesh(merged, this.validMat));
        this.actions.onPreviewHud({
          label: cells.length > 0 ? `Isi Ruangan: ${(cells.length * cs * cs).toFixed(1)} m²` : "Area diblokir void / kolam",
          valid: cells.length > 0,
        });
        return;
      }
      if (this.viewOpts.floorBrushMode === "rect" && this.dragStartCell) {
        const minX = Math.min(this.dragStartCell.gx, gx);
        const maxX = Math.max(this.dragStartCell.gx, gx);
        const minZ = Math.min(this.dragStartCell.gz, gz);
        const maxZ = Math.max(this.dragStartCell.gz, gz);
        const wM = (maxX - minX + 1) * cs;
        const dM = (maxZ - minZ + 1) * cs;
        const m = new THREE.Mesh(new THREE.BoxGeometry(wM, 0.03, dM), this.validMat);
        m.position.set((minX + maxX + 1) * 0.5 * cs, baseY + 0.035, (minZ + maxZ + 1) * 0.5 * cs);
        this.previewGroup.add(m);
        this.actions.onPreviewHud({ label: `Lantai ${wM.toFixed(1)} × ${dM.toFixed(1)} m`, valid: true });
        return;
      }
      if (this.brushStrokeCells.size > 0) {
        const geos = [...this.brushStrokeCells.values()].map((c) => {
          const g = new THREE.BoxGeometry(cs, 0.03, cs);
          g.translate((c.gx + 0.5) * cs, baseY + 0.035, (c.gz + 0.5) * cs);
          return g;
        });
        const merged = mergeGeometryBatch(geos);
        if (merged) this.previewGroup.add(new THREE.Mesh(merged, this.validMat));
        this.actions.onPreviewHud({ label: `Kuas Lantai: ${this.brushStrokeCells.size} petak`, valid: true });
      }
      return;
    }

    if (tool === "opening") {
      const [ow, oh] = item.sizeM ?? [0.9, 2.15, 0.14];
      const sill = item.openingKind === "window" ? 0.9 : item.openingKind === "vent" ? 2.45 : 0;
      const snap = snapOpeningToProjectWalls(lv.walls, wx, wz, ow, undefined, sill, oh);
      if (!snap) {
        this.actions.onPreviewHud({ label: `Dekatkan ke dinding (${item.name})`, valid: false });
        return;
      }
      const swing = this.viewOpts.placementFlipSwing ?? 1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, 0.22), snap.valid ? this.validMat : this.invalidMat);
      m.position.set(snap.worldX, baseY + sill + oh * 0.5, snap.worldZ);
      m.rotation.y = snap.yaw;
      const dirArrow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 10), snap.valid ? this.validMat : this.invalidMat);
      dirArrow.rotation.x = swing >= 0 ? Math.PI / 2 : -Math.PI / 2;
      dirArrow.position.set(0, -oh * 0.25, swing >= 0 ? 0.28 : -0.28);
      m.add(dirArrow);
      this.previewGroup.add(m);
      this.actions.onPreviewHud({
        label: snap.valid ? `${item.name} (Klik Pasang · R flip arah)` : snap.reason ?? "Tidak muat",
        valid: snap.valid,
      });
      return;
    }

    if (tool === "stair") {
      const [wC, lC] = item.footprintCells ?? [2, 8];
      const rq = (this.viewOpts.placementRotationStep % 4) as 0 | 1 | 2 | 3;
      const res = validateProjectStairPlacement(
        lv.stairs,
        lvIdx,
        gx,
        gz,
        wC,
        lC,
        rq,
        cols,
        rows,
        cs,
        lv.walls,
        project.buildExtras?.pools ?? [],
      );
      const fp = getStairSpan(wC, lC, rq);
      const m = new THREE.Mesh(new THREE.BoxGeometry(fp.spanCols * cs, 1.4, fp.spanRows * cs), res.valid ? this.validMat : this.invalidMat);
      m.position.set((gx + fp.spanCols * 0.5) * cs, baseY + 0.7, (gz + fp.spanRows * 0.5) * cs);
      this.previewGroup.add(m);
      this.actions.onPreviewHud({ label: res.valid ? `${item.name} (${rq * 90}° · R putar)` : res.reason ?? "Tak valid", valid: res.valid });
      return;
    }

    if (tool === "pool" && this.dragStartCell) {
      const minX = Math.min(this.dragStartCell.gx, gx);
      const maxX = Math.max(this.dragStartCell.gx, gx);
      const minZ = Math.min(this.dragStartCell.gz, gz);
      const maxZ = Math.max(this.dragStartCell.gz, gz);
      const wM = (maxX - minX + 1) * cs;
      const dM = (maxZ - minZ + 1) * cs;
      const check =
        this.viewOpts.activeLevel === 0
          ? validatePoolPlacement(project, minX, minZ, maxX, maxZ, cs)
          : { valid: false, reason: "Kolam hanya untuk Lantai 1" };
      const m = new THREE.Mesh(new THREE.BoxGeometry(wM, 0.22, dM), check.valid ? this.cyanMat : this.invalidMat);
      m.position.set((minX + maxX + 1) * 0.5 * cs, baseY + 0.08, (minZ + maxZ + 1) * 0.5 * cs);
      this.previewGroup.add(m);
      this.actions.onPreviewHud({
        label: check.valid ? `Kolam ${wM.toFixed(1)} × ${dM.toFixed(1)} m` : check.reason ?? "Kolam tidak valid",
        valid: check.valid,
      });
      return;
    }

    if (tool === "terrain" && this.lastWorldPos.inBounds) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.25, 24), this.validMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(wx, baseY + 0.06, wz);
      this.previewGroup.add(ring);
      const map = { raise: "Naikkan Tanah", lower: "Turunkan Tanah", flatten: "Ratakan Tanah" } as const;
      this.actions.onPreviewHud({ label: map[this.viewOpts.terrainBrushMode], valid: true });
      return;
    }

    if (tool === "furniture" || tool === "hvac" || tool === "light") {
      const [sx, , sz] =
        tool === "furniture"
          ? item.sizeM ?? [0.8, 0.8, 0.8]
          : tool === "hvac"
            ? item.hvacMeta?.type === "ac_split"
              ? [0.85, 0.28, 0.22]
              : item.hvacMeta?.type === "wall_fan"
                ? [0.44, 0.44, 0.28]
                : [0.55, 0.45, 0.55]
            : [0.35, 0.3, 0.35];
      const mountKind = this.getMountKind(tool, item.hvacMeta?.type, item.lightMeta?.type);
      const wallOffset =
        item.hvacMeta?.type === "ac_split" ? 0.12 : item.hvacMeta?.type === "wall_fan" ? 0.03 : 0.05;
      const defaultElev =
        tool === "hvac" ? item.hvacMeta?.defaultElevationM ?? 0 : tool === "light" ? item.lightMeta?.defaultElevationM ?? 2.9 : 0;
      const placed = this.raycastSurfaceForPlacement(e, lvIdx, mountKind, wallOffset, defaultElev);
      const rot = placed.rotationY !== undefined ? placed.rotationY : this.viewOpts.placementRotationStep * (Math.PI / 4);
      const fpCheck = placed.valid
        ? validateObjectFootprint({
            project,
            levelIndex: lvIdx,
            x: placed.x,
            y: placed.y,
            z: placed.z,
            sizeX: sx,
            sizeZ: sz,
            rotationY: rot,
            mountKind,
            tool,
            catalogId: item.materialId,
            category: item.furnitureCategory,
            hostFurniture: placed.hostFurniture,
            wallSnap: placed.wallSnap,
            altBypass: placed.altBypass,
          })
        : { valid: false, reason: placed.surfaceLabel };
      const isValid = placed.valid && fpCheck.valid;
      const ghost = this.getOrCreatePreviewGhost(item, isValid, this.viewOpts.selectedSwatchHex ?? null);
      ghost.position.set(placed.x, baseY + placed.y, placed.z);
      ghost.rotation.y = rot;
      this.previewGroup.add(ghost);
      this.actions.onPreviewHud({
        label: isValid
          ? `${item.name} (${this.viewOpts.placementRotationStep * 45}°) · ${placed.surfaceLabel} (R putar · Alt bebas · Shift+Klik beruntun)`
          : fpCheck.reason ?? placed.surfaceLabel,
        valid: isValid,
      });
      return;
    }

    this.actions.onPreviewHud(null);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.derived || !this.hoverTileMesh) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.activeCamera);
    const hit = this.raycaster.ray.intersectPlane(this.activeFloorPlane, this.hitPoint);
    if (!hit) {
      this.hoverTileMesh.visible = false;
      return;
    }

    const cs = 0.5;
    const fineCs = 0.25;
    const fineCols = Math.round(this.derived.project.site.width / fineCs);
    const fineRows = Math.round(this.derived.project.site.depth / fineCs);
    const fineGx = Math.floor(hit.x / fineCs);
    const fineGz = Math.floor(hit.z / fineCs);
    const inBounds = fineGx >= 0 && fineGx < fineCols && fineGz >= 0 && fineGz < fineRows;
    const cols = Math.round(this.derived.project.site.width / cs);
    const rows = Math.round(this.derived.project.site.depth / cs);
    const gx = Math.floor(hit.x / cs);
    const gz = Math.floor(hit.z / cs);
    this.lastWorldPos = { x: hit.x, z: hit.z, inBounds };

    const showGridHover = inBounds && this.viewOpts.activeTool !== "select" && !this.draggingEntity;
    this.hoverTileMesh.visible = showGridHover;
    if (showGridHover) {
      this.hoverTileMesh.position.set((fineGx + 0.5) * fineCs, this.getActiveFloorY() + 0.03, (fineGz + 0.5) * fineCs);
    }

    // 1. Live Wall Push-Pull Arrow Drag
    if (this.pushPullDragState) {
      const pp = this.pushPullDragState;
      const rawProj = (hit.x - pp.startWorldX) * pp.nx + (hit.z - pp.startWorldZ) * pp.nz;
      const snapped = e.altKey || this.altHeld ? Math.round(rawProj * 20) / 20 : Math.round(rawProj * 4) / 4;
      pp.deltaM = snapped;
      this.clearPreviewMeshes();
      const prevBox = new THREE.Mesh(
        new THREE.BoxGeometry(pp.len + pp.thickness, pp.height, pp.thickness),
        Math.abs(snapped) >= 0.05 ? this.validMat : this.cyanMat,
      );
      prevBox.position.set(
        pp.midX + pp.nx * snapped,
        pp.baseY + pp.height * 0.5,
        pp.midZ + pp.nz * snapped,
      );
      prevBox.rotation.y = -Math.atan2(pp.nx, -pp.nz) + Math.PI * 0.5;
      // Align preview along wall tangent
      const wObj = this.derived.project.levels[pp.lvIdx]?.walls.find((x) => x.id === pp.wallId);
      if (wObj) {
        prevBox.rotation.y = -Math.atan2(wObj.end.z - wObj.start.z, wObj.end.x - wObj.start.x);
      }
      this.previewGroup.add(prevBox);
      this.actions.onPreviewHud({
        label: `Geser Dinding ${snapped >= 0 ? "+" : ""}${snapped.toFixed(2)} m · Lepas untuk terapkan`,
        valid: true,
      });
      return;
    }

    // 2. Live Opening Slide Drag along Wall (BM-08)
    if (this.openingDragState) {
      const od = this.openingDragState;
      const lv = this.derived.project.levels[od.lvIdx];
      if (lv) {
        const baseY = this.getActiveFloorY();
        const snap = snapOpeningToProjectWalls(lv.walls, hit.x, hit.z, od.width, od.opId, od.sill, od.height);
        this.clearPreviewMeshes();
        if (snap) {
          od.nextWallId = snap.wall.id;
          od.nextOffset = snap.offsetM;
          od.nextWorldX = snap.worldX;
          od.nextWorldZ = snap.worldZ;
          od.nextYaw = snap.yaw;
          od.valid = snap.valid;
          od.reason = snap.reason;
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(od.width, od.height, 0.24),
            snap.valid ? this.validMat : this.invalidMat,
          );
          m.position.set(snap.worldX, baseY + od.sill + od.height * 0.5, snap.worldZ);
          m.rotation.y = snap.yaw;
          this.previewGroup.add(m);
          this.actions.onPreviewHud({
            label: snap.valid ? `Geser ${od.label} (Lepas simpan)` : snap.reason ?? "Tidak muat",
            valid: snap.valid,
          });
        } else {
          od.valid = false;
          od.reason = "Arahkan ke dinding";
          this.actions.onPreviewHud({ label: "Arahkan bukaan ke dinding terdekat", valid: false });
        }
      }
      return;
    }

    // 3. Drag moving an already-selected Furniture / HVAC / Light item directly along surfaces (walls/floors/tables)
    if (this.draggingEntity) {
      const lotW = this.derived.project.site.width;
      const lotD = this.derived.project.site.depth;
      if (this.dragPendingCommit) {
        const pending = this.dragPendingCommit;
        const lvIdx = pending.lvIdx;
        const lv = this.derived.project.levels[lvIdx];
        if (!lv) return;
        let nextPlaced: ReturnType<BuildScene["raycastSurfaceForPlacement"]> | null = null;
        let sx = 0.45;
        let sz = 0.45;
        let mountK: "wall" | "ceiling" | "surface" = "surface";
        let fCat: FurnitureCategory | undefined;
        let catId: string | undefined;
        let toolKind: BuildToolId = "furniture";
        if (pending.kind === "furniture") {
          const curF = lv.furniture.find((x) => x.id === pending.id);
          if (curF) {
            sx = curF.size.x;
            sz = curF.size.z;
            fCat = curF.category;
            catId = curF.catalogId;
          }
          nextPlaced = this.raycastSurfaceForPlacement(e, lvIdx, "surface", 0, pending.origPos.y, pending.id);
        } else if (pending.kind === "hvac") {
          toolKind = "hvac";
          const cur = lv.hvac.find((x) => x.id === pending.id);
          if (cur) {
            mountK = this.getMountKind("hvac", cur.type, undefined);
            const wallOff = cur.type === "ac_split" ? 0.12 : cur.type === "wall_fan" ? 0.03 : 0.05;
            nextPlaced = this.raycastSurfaceForPlacement(e, lvIdx, mountK, wallOff, pending.origPos.y, pending.id);
          }
        } else if (pending.kind === "light") {
          toolKind = "light";
          const cur = lv.lights.find((x) => x.id === pending.id);
          if (cur) {
            mountK = this.getMountKind("light", undefined, cur.type);
            nextPlaced = this.raycastSurfaceForPlacement(e, lvIdx, mountK, 0.05, pending.origPos.y, pending.id);
          }
        }

        const dragRot = nextPlaced?.rotationY ?? pending.rotationY ?? 0;
        const fpOk = nextPlaced?.valid
          ? validateObjectFootprint({
              project: this.derived.project,
              levelIndex: lvIdx,
              x: nextPlaced.x,
              y: nextPlaced.y,
              z: nextPlaced.z,
              sizeX: sx,
              sizeZ: sz,
              rotationY: dragRot,
              mountKind: mountK,
              tool: toolKind,
              catalogId: catId,
              category: fCat,
              hostFurniture: nextPlaced.hostFurniture,
              wallSnap: nextPlaced.wallSnap,
              excludeEntityId: pending.id,
              altBypass: nextPlaced.altBypass,
            })
          : { valid: false, reason: nextPlaced?.surfaceLabel ?? "Area tidak valid" };

        if (nextPlaced && nextPlaced.valid && fpOk.valid) {
          const cx = THREE.MathUtils.clamp(nextPlaced.x, 0.05, lotW - 0.05);
          const cz = THREE.MathUtils.clamp(nextPlaced.z, 0.05, lotD - 0.05);
          pending.pos = { x: cx, y: nextPlaced.y, z: cz };
          if (nextPlaced.rotationY !== undefined) pending.rotationY = nextPlaced.rotationY;
          if (this.draggingMesh) {
            this.draggingMesh.position.set(cx, nextPlaced.y + pending.yRenderOffset, cz);
            if (nextPlaced.rotationY !== undefined) this.draggingMesh.rotation.y = nextPlaced.rotationY;
            this._hoverBox.setFromObject(this.draggingMesh);
            this._hoverBox.getSize(this._hoverSize);
            this._hoverBox.getCenter(this._hoverCenter);
            this.hoverHighlightMesh.material = this.validMat;
            this.hoverHighlightMesh.scale.set(
              Math.max(0.18, this._hoverSize.x + 0.06),
              Math.max(0.18, this._hoverSize.y + 0.06),
              Math.max(0.18, this._hoverSize.z + 0.06),
            );
            this.hoverHighlightMesh.position.copy(this._hoverCenter);
            this.hoverHighlightMesh.visible = true;
          }
          this.actions.onPreviewHud({
            label: `Geser ${pending.label} (${cx.toFixed(1)}m, ${cz.toFixed(1)}m · R putar · Lepas simpan)`,
            valid: true,
          });
        } else {
          this.actions.onPreviewHud({
            label: fpOk.reason ?? nextPlaced?.surfaceLabel ?? "Area tidak valid",
            valid: false,
          });
        }
      }
      return;
    }

    if (this.isBrushDown && inBounds) {
      const tool = this.viewOpts.activeTool;
      const item = this.getActiveCatalogItem();
      const lvIdx = Math.min(1, this.viewOpts.activeLevel) as 0 | 1;
      if (tool === "floor_tile" && this.viewOpts.floorBrushMode === "tile" && !this.isCellBlocked(lvIdx, gx, gz)) {
        this.brushStrokeCells.set(`${lvIdx}:${gx}:${gz}`, {
          levelIndex: lvIdx,
          gx,
          gz,
          materialId: item.materialId ?? "granite_warm",
        });
      } else if (tool === "terrain" && this.terrainScratch) {
        const v = worldToGridVertex(hit.x, hit.z, cs, cols, rows);
        this.terrainScratch = applyTerrainBrushToHeights(
          this.terrainScratch,
          cols,
          rows,
          v.gx,
          v.gz,
          this.viewOpts.terrainBrushMode,
          0.12,
          2.5,
          this.getIndoorProtectedPolys(),
        );
        this.updateLiveTerrainMesh(this.terrainScratch);
      }
    }

    this.actions.onHoverCell(fineGx, fineGz, hit.x, hit.z, inBounds);
    if (this.viewOpts.activeTool === "select" && !this.dragPendingCommit && this.actions.onHoverPart) {
      const nowMs = performance.now();
      if (nowMs - this.lastHoverMs > 70) {
        this.lastHoverMs = nowMs;
        const hPart = this.raycastHit(e, false);
        this.actions.onHoverPart(hPart ? hPart.label : null, e.clientX - rect.left, e.clientY - rect.top);
      }
    } else {
      this.actions.onHoverPart?.(null, 0, 0);
    }
    this.updateToolPreview(e);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      this.rightDownPos = { x: e.clientX, y: e.clientY };
      if (
        this.dragStartVertex ||
        this.dragStartCell ||
        this.sledgeDragStart ||
        this.isBrushDown ||
        this.draggingEntity ||
        this.pushPullDragState ||
        this.openingDragState
      ) {
        this.cancelActivePreview();
      }
      return;
    }
    if (e.button !== 0 || !this.derived) return;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };

    const cs = 0.5;
    const cols = Math.round(this.derived.project.site.width / cs);
    const rows = Math.round(this.derived.project.site.depth / cs);
    const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
    const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
    const curVert = worldToGridVertex(this.lastWorldPos.x, this.lastWorldPos.z, cs, cols, rows);
    const tool = this.viewOpts.activeTool;

    if (tool === "select") {
      // Check Push-Pull Arrow Gizmo first when a wall is selected
      if (this.pushPullGizmoGroup.visible && this.selected?.kind === "wall") {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
          this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.activeCamera);
          const gHits = this.raycaster.intersectObject(this.pushPullGizmoGroup, true);
          if (gHits.length > 0) {
            const lvIdx = this.selected.levelIndex as 0 | 1;
            const w = this.derived.project.levels[lvIdx]?.walls.find((x) => x.id === this.selected?.id);
            if (w) {
              const dx = w.end.x - w.start.x;
              const dz = w.end.z - w.start.z;
              const len = Math.hypot(dx, dz) || 1;
              const nx = -dz / len;
              const nz = dx / len;
              const baseY =
                lvIdx === 0
                  ? this.derived.project.site.peil.floor1PeilM
                  : this.derived.project.site.peil.floor1PeilM + (this.derived.project.levels[0]?.height ?? 3.6);
              this.pushPullDragState = {
                lvIdx,
                wallId: w.id,
                startWorldX: this.lastWorldPos.x,
                startWorldZ: this.lastWorldPos.z,
                midX: (w.start.x + w.end.x) * 0.5,
                midZ: (w.start.z + w.end.z) * 0.5,
                nx,
                nz,
                len,
                height: w.height,
                thickness: w.thickness,
                baseY,
                deltaM: 0,
              };
              try {
                this.canvas.setPointerCapture?.(e.pointerId);
              } catch {
                // ignore
              }
              return;
            }
          }
        }
      }

      const hitRes = this.raycastHit(e, true);
      if (hitRes && hitRes.sel.kind === "opening") {
        const sel = hitRes.sel;
        const lvIdx = sel.levelIndex as 0 | 1;
        const w = this.derived.project.levels[lvIdx]?.walls.find((x) => x.id === sel.wallId);
        const op = w?.openings.find((o) => o.id === sel.id);
        if (w && op) {
          this.openingDragState = {
            lvIdx,
            wallId: w.id,
            opId: op.id,
            width: op.width,
            height: op.height,
            sill: op.sill,
            label: op.label,
            origOffset: op.offset,
            nextWallId: w.id,
            nextOffset: op.offset,
            nextWorldX: hitRes.point.x,
            nextWorldZ: hitRes.point.z,
            nextYaw: 0,
            valid: true,
          };
          try {
            this.canvas.setPointerCapture?.(e.pointerId);
          } catch {
            // ignore
          }
          this.actions.onSelect(sel);
          return;
        }
      }

      if (hitRes && (hitRes.sel.kind === "furniture" || hitRes.sel.kind === "hvac" || hitRes.sel.kind === "light")) {
        const sel = hitRes.sel;
        const lvIdx = sel.levelIndex as 0 | 1;
        const lv = this.derived.project.levels[lvIdx];
        const curItem =
          sel.kind === "furniture"
            ? lv?.furniture.find((x) => x.id === sel.id)
            : sel.kind === "hvac"
              ? lv?.hvac.find((x) => x.id === sel.id)
              : lv?.lights.find((x) => x.id === sel.id);
        this.draggingEntity = sel;
        this.draggingMesh = hitRes.obj;
        if (curItem) {
          const origRotY = "rotationY" in curItem ? curItem.rotationY : undefined;
          this.dragPendingCommit = {
            kind: sel.kind,
            lvIdx,
            id: sel.id,
            label: hitRes.label,
            pos: { ...curItem.position },
            rotationY: origRotY,
            origPos: { ...curItem.position },
            origRotY,
            origMeshPos: hitRes.obj.position.clone(),
            origMeshRotY: hitRes.obj.rotation.y,
            yRenderOffset: hitRes.obj.position.y - curItem.position.y,
          };
          try {
            this.canvas.setPointerCapture?.(e.pointerId);
          } catch {
            // ignore
          }
        }
        this.actions.onSelect(sel);
      } else {
        const fallback = hitRes ?? this.raycastHit(e, false);
        this.actions.onSelect(fallback ? fallback.sel : null);
      }
      return;
    }

    if (tool === "sledgehammer") {
      this.sledgeDragStart = { x: this.lastWorldPos.x, z: this.lastWorldPos.z };
      return;
    }

    if (tool === "wall_straight" || tool === "wall_room" || tool === "wall_diagonal" || tool === "fence") {
      if (this.viewOpts.activeLevel === 2) {
        simsAudio.play("warning");
        return;
      }
      const wallCs = 0.25;
      const wallCols = Math.round(this.derived.project.site.width / wallCs);
      const wallRows = Math.round(this.derived.project.site.depth / wallCs);
      this.dragStartVertex = worldToGridVertex(this.lastWorldPos.x, this.lastWorldPos.z, wallCs, wallCols, wallRows);
    } else if (tool === "floor_tile") {
      if (this.viewOpts.activeLevel === 2) {
        simsAudio.play("warning");
        return;
      }
      const lvIdx = Math.min(1, this.viewOpts.activeLevel) as 0 | 1;
      if (this.viewOpts.floorBrushMode === "rect") {
        this.dragStartCell = { gx, gz };
      } else if (this.viewOpts.floorBrushMode === "tile" && this.lastWorldPos.inBounds && !this.isCellBlocked(lvIdx, gx, gz)) {
        this.isBrushDown = true;
        const item = this.getActiveCatalogItem();
        this.brushStrokeCells.set(`${lvIdx}:${gx}:${gz}`, {
          levelIndex: lvIdx,
          gx,
          gz,
          materialId: item.materialId ?? "granite_warm",
        });
      }
    } else if (tool === "pool") {
      if (this.viewOpts.activeLevel !== 0) {
        simsAudio.play("warning");
        return;
      }
      this.dragStartCell = { gx, gz };
    } else if (tool === "terrain" && this.lastWorldPos.inBounds) {
      this.isBrushDown = true;
      const base = this.derived.project.buildExtras?.terrainHeights ?? [];
      this.terrainScratch = applyTerrainBrushToHeights(
        base,
        cols,
        rows,
        curVert.gx,
        curVert.gz,
        this.viewOpts.terrainBrushMode,
        0.2,
        2.5,
        this.getIndoorProtectedPolys(),
      );
      this.updateLiveTerrainMesh(this.terrainScratch);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    try {
      if (this.canvas.hasPointerCapture?.(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    // Brief right-click cancels tool or deselects without moving camera (BM-16)
    if (e.button === 2 && this.rightDownPos) {
      const distR = Math.hypot(e.clientX - this.rightDownPos.x, e.clientY - this.rightDownPos.y);
      this.rightDownPos = null;
      if (distR <= 5) {
        if (this.viewOpts.activeTool !== "select") {
          this.cancelActivePreview();
          this.actions.onPlacementCommitted?.(this.viewOpts.activeTool, false);
        } else if (this.selected !== null) {
          this.actions.onSelect(null);
        }
      }
      return;
    }

    if (e.button !== 0 || !this.derived) return;

    if (this.pushPullDragState) {
      const pp = this.pushPullDragState;
      this.pushPullDragState = null;
      this.clearPreviewMeshes();
      this.actions.onPreviewHud(null);
      if (Math.abs(pp.deltaM) >= 0.05) {
        this.actions.onPushPullWall?.(pp.lvIdx, pp.wallId, pp.deltaM, e.altKey || this.altHeld);
        simsAudio.play("place");
      }
      return;
    }

    if (this.openingDragState) {
      const od = this.openingDragState;
      this.openingDragState = null;
      this.clearPreviewMeshes();
      this.actions.onPreviewHud(null);
      const changed = od.nextWallId !== od.wallId || Math.abs(od.nextOffset - od.origOffset) >= 0.02;
      if (changed && od.valid) {
        if (od.nextWallId === od.wallId) {
          this.actions.onUpdateOpening?.(od.lvIdx, od.wallId, od.opId, { offset: od.nextOffset });
        } else {
          const origOp = this.derived.project.levels[od.lvIdx]?.walls
            .find((w) => w.id === od.wallId)
            ?.openings.find((o) => o.id === od.opId);
          if (origOp) {
            this.actions.onDeleteOpening(od.lvIdx, od.wallId, od.opId);
            this.actions.onAddOpening(od.lvIdx, od.nextWallId, { ...origOp, offset: od.nextOffset });
          }
        }
        simsAudio.play("place");
      } else if (!od.valid) {
        simsAudio.play("warning");
      }
      return;
    }

    if (this.draggingEntity) {
      const pending = this.dragPendingCommit;
      this.draggingEntity = null;
      this.draggingMesh = null;
      this.dragPendingCommit = null;
      this.hoverHighlightMesh.visible = false;
      this.actions.onPreviewHud(null);
      if (pending) {
        const moved =
          Math.hypot(pending.pos.x - pending.origPos.x, pending.pos.y - pending.origPos.y, pending.pos.z - pending.origPos.z) > 0.002 ||
          Math.abs((pending.rotationY ?? 0) - (pending.origRotY ?? 0)) > 0.002;
        if (moved) {
          if (pending.kind === "furniture") {
            this.actions.onMoveFurniture(pending.lvIdx, pending.id, pending.pos, pending.rotationY);
          } else if (pending.kind === "hvac") {
            this.actions.onMoveHvac(pending.lvIdx, pending.id, pending.pos, pending.rotationY);
          } else {
            this.actions.onMoveLight(pending.lvIdx, pending.id, pending.pos, pending.rotationY);
          }
          simsAudio.play("place");
        }
      }
      return;
    }

    const project = this.derived.project;
    const cs = 0.5;
    const cols = Math.round(project.site.width / cs);
    const rows = Math.round(project.site.depth / cs);
    const lvIdx = Math.min(1, this.viewOpts.activeLevel) as 0 | 1;
    const lv = project.levels[lvIdx]!;
    const tool = this.viewOpts.activeTool;
    const item = this.getActiveCatalogItem();
    const brickThick = project.systems.brick.outerThicknessMm / 1000;

    if (
      this.viewOpts.activeLevel === 2 &&
      (tool === "wall_straight" ||
        tool === "wall_room" ||
        tool === "wall_diagonal" ||
        tool === "wall_paint" ||
        tool === "fence" ||
        tool === "floor_tile" ||
        tool === "opening" ||
        tool === "stair" ||
        tool === "pool" ||
        tool === "furniture" ||
        tool === "hvac" ||
        tool === "light")
    ) {
      simsAudio.play("warning");
      this.cancelActivePreview();
      return;
    }

    // Dragged straight/diagonal/fence wall (0.25m precision grid)
    const wallCs = 0.25;
    const wallCols = Math.round(project.site.width / wallCs);
    const wallRows = Math.round(project.site.depth / wallCs);
    if ((tool === "wall_straight" || tool === "wall_diagonal" || tool === "fence") && this.dragStartVertex) {
      const endV = snapWallEndpoint(
        this.dragStartVertex,
        worldToGridVertex(this.lastWorldPos.x, this.lastWorldPos.z, wallCs, wallCols, wallRows),
        wallCols,
        wallRows,
        tool === "wall_diagonal" || e.altKey,
      );
      if (endV.gx !== this.dragStartVertex.gx || endV.gz !== this.dragStartVertex.gz) {
        const isFence = tool === "fence";
        this.actions.onAddWall(lvIdx, {
          id: uid(isFence ? "fence" : "wall"),
          name: isFence ? "Pagar Baru" : "Dinding Baru",
          kind: isFence ? "fence" : "wall",
          start: { x: this.dragStartVertex.gx * wallCs, z: this.dragStartVertex.gz * wallCs },
          end: { x: endV.gx * wallCs, z: endV.gz * wallCs },
          thickness: isFence ? 0.08 : brickThick,
          height: isFence ? 1.2 : lv.height,
          materialId: isFence ? "wall_andesit" : "wall_ext_ivory",
          exterior: true,
          openings: [],
        });
      }
      this.cancelActivePreview();
      return;
    }

    // Dragged rectangle Room (4 walls + interior slab Room)
    if (tool === "wall_room" && this.dragStartVertex) {
      const curVert = worldToGridVertex(this.lastWorldPos.x, this.lastWorldPos.z, wallCs, wallCols, wallRows);
      const x1 = Math.min(this.dragStartVertex.gx, curVert.gx) * wallCs;
      const x2 = Math.max(this.dragStartVertex.gx, curVert.gx) * wallCs;
      const z1 = Math.min(this.dragStartVertex.gz, curVert.gz) * wallCs;
      const z2 = Math.max(this.dragStartVertex.gz, curVert.gz) * wallCs;
      if (x2 - x1 >= 0.5 && z2 - z1 >= 0.5) {
        const mkW = (ax: number, az: number, bx: number, bz: number): Wall => ({
          id: uid("rmwall"),
          name: "Dinding Ruangan",
          kind: "wall",
          start: { x: ax, z: az },
          end: { x: bx, z: bz },
          thickness: brickThick,
          height: lv.height,
          materialId: "wall_int_ivory",
          exterior: false,
          openings: [],
        });
        this.actions.onAddRoomAndWalls(
          lvIdx,
          [mkW(x1, z1, x2, z1), mkW(x2, z1, x2, z2), mkW(x2, z2, x1, z2), mkW(x1, z2, x1, z1)],
          {
            id: uid("room"),
            name: `Ruang Baru LT${lvIdx + 1}`,
            program: "living",
            polygon: [
              { x: x1, z: z1 },
              { x: x2, z: z1 },
              { x: x2, z: z2 },
              { x: x1, z: z2 },
            ],
            floorMaterialId: "tile_ivory_60",
            ceilingHeight: lv.height,
          },
        );
      }
      this.cancelActivePreview();
      return;
    }

    if (tool === "floor_tile" && this.brushStrokeCells.size > 0) {
      this.actions.onSetFloorTiles([...this.brushStrokeCells.values()]);
      this.cancelActivePreview();
      return;
    }
    if (tool === "floor_tile" && this.dragStartCell) {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
      const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
      const tiles: { levelIndex: number; gx: number; gz: number; materialId: string }[] = [];
      for (let x = Math.min(this.dragStartCell.gx, gx); x <= Math.max(this.dragStartCell.gx, gx); x++) {
        for (let z = Math.min(this.dragStartCell.gz, gz); z <= Math.max(this.dragStartCell.gz, gz); z++) {
          if (!this.isCellBlocked(lvIdx, x, z)) {
            tiles.push({ levelIndex: lvIdx, gx: x, gz: z, materialId: item.materialId ?? "granite_warm" });
          }
        }
      }
      if (tiles.length > 0) this.actions.onSetFloorTiles(tiles);
      this.cancelActivePreview();
      return;
    }

    if (tool === "pool" && this.dragStartCell) {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
      const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
      const gx1 = Math.min(this.dragStartCell.gx, gx);
      const gx2 = Math.max(this.dragStartCell.gx, gx);
      const gz1 = Math.min(this.dragStartCell.gz, gz);
      const gz2 = Math.max(this.dragStartCell.gz, gz);
      const poolOk = this.viewOpts.activeLevel === 0 && validatePoolPlacement(project, gx1, gz1, gx2, gz2, cs).valid;
      if (poolOk) {
        this.actions.onAddPool({ id: uid("pool"), gx1, gz1, gx2, gz2, depth: 1.25 });
        this.cancelActivePreview();
        this.actions.onPlacementCommitted?.(tool, e.shiftKey);
      } else {
        simsAudio.play("warning");
        this.cancelActivePreview();
      }
      return;
    }

    if (tool === "terrain" && this.terrainScratch) {
      this.actions.onSetTerrainHeights(this.terrainScratch);
      this.cancelActivePreview();
      return;
    }

    if (tool === "sledgehammer" && this.sledgeDragStart) {
      const sx0 = this.sledgeDragStart.x;
      const sz0 = this.sledgeDragStart.z;
      const sx1 = this.lastWorldPos.x;
      const sz1 = this.lastWorldPos.z;
      this.sledgeDragStart = null;
      const dragSpan = Math.hypot(sx1 - sx0, sz1 - sz0);
      if (dragSpan > 0.4 && Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 8) {
        const minX = Math.min(sx0, sx1);
        const maxX = Math.max(sx0, sx1);
        const minZ = Math.min(sz0, sz1);
        const maxZ = Math.max(sz0, sz1);
        const rmTiles = (project.buildExtras?.floorTiles ?? []).filter((t) => {
          const cx = (t.gx + 0.5) * cs;
          const cz = (t.gz + 0.5) * cs;
          return t.levelIndex === lvIdx && cx >= minX && cx <= maxX && cz >= minZ && cz <= maxZ;
        });
        const rmWalls = lv.walls
          .filter((w) => {
            const mx = (w.start.x + w.end.x) * 0.5;
            const mz = (w.start.z + w.end.z) * 0.5;
            return mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ;
          })
          .map((w) => w.id);
        if (rmTiles.length > 0) this.actions.onDeleteFloorTilesBatch?.(rmTiles);
        if (rmWalls.length > 0) this.actions.onDeleteWallsBatch?.(lvIdx, rmWalls);
        if (rmTiles.length > 0 || rmWalls.length > 0) simsAudio.play("demolish");
        this.cancelActivePreview();
        return;
      }
    }

    const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dist > 6) return;

    // Room floor flood fill click
    if (tool === "floor_tile" && this.viewOpts.floorBrushMode === "fill") {
      const blocked = this.getBlockedPolysForLevel(lvIdx);
      const roomHit = findRoomAtPoint(lv.rooms, this.lastWorldPos.x, this.lastWorldPos.z);
      if (roomHit) {
        this.actions.onPaintRoomFloor(lvIdx, roomHit.id, item.materialId ?? "granite_warm");
      } else if (this.lastWorldPos.inBounds) {
        const cells = computeProjectRoomFloodCells(
          lv.walls,
          cols,
          rows,
          cs,
          Math.floor(this.lastWorldPos.x / cs),
          Math.floor(this.lastWorldPos.z / cs),
          blocked,
        );
        if (cells.length > 0) {
          this.actions.onSetFloorTiles(
            cells.map((c) => ({ levelIndex: lvIdx, gx: c.gx, gz: c.gz, materialId: item.materialId ?? "granite_warm" })),
          );
        } else {
          simsAudio.play("warning");
        }
      }
      return;
    }

    // Snap Opening to Project Wall
    if (tool === "opening") {
      const [ow, oh] = item.sizeM ?? [0.9, 2.15, 0.14];
      const kind = item.openingKind ?? "door";
      const sill = kind === "window" ? 0.9 : kind === "vent" ? 2.45 : 0;
      const snap = snapOpeningToProjectWalls(lv.walls, this.lastWorldPos.x, this.lastWorldPos.z, ow, undefined, sill, oh);
      if (!snap || !snap.valid) {
        simsAudio.play("warning");
        return;
      }
      const created = createOpeningForWall(uid("op"), kind, snap.offsetM, ow, oh, sill, item.name);
      created.swing = this.viewOpts.placementFlipSwing ?? 1;
      this.actions.onAddOpening(lvIdx, snap.wall.id, created);
      simsAudio.play("place");
      return;
    }

    // Place Stair + Auto Void Slab
    if (tool === "stair") {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
      const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
      const [wC, lC] = item.footprintCells ?? [2, 8];
      const rq = (this.viewOpts.placementRotationStep % 4) as 0 | 1 | 2 | 3;
      const check = validateProjectStairPlacement(
        lv.stairs,
        lvIdx,
        gx,
        gz,
        wC,
        lC,
        rq,
        cols,
        rows,
        cs,
        lv.walls,
        project.buildExtras?.pools ?? [],
      );
      if (!check.valid) {
        simsAudio.play("warning");
        return;
      }
      this.actions.onAddStair(
        lvIdx,
        {
          id: uid("stair"),
          name: item.name,
          start: check.start,
          end: check.end,
          width: wC * cs,
          floorHeight: lv.height,
          riserCount: 18,
          treadDepth: 0.25,
          shape: "straight",
          landingDepth: 1.0,
        },
        check.voidPoly,
      );
      simsAudio.play("place");
      this.actions.onPlacementCommitted?.(tool, e.shiftKey);
      return;
    }

    // Place Furniture / HVAC / Light on real 3D surfaces (wall, ceiling, floor, or tabletop)
    if (tool === "furniture" || tool === "hvac" || tool === "light") {
      const mountKind = this.getMountKind(tool, item.hvacMeta?.type, item.lightMeta?.type);
      const wallOffset =
        item.hvacMeta?.type === "ac_split" ? 0.12 : item.hvacMeta?.type === "wall_fan" ? 0.03 : 0.05;
      const defaultElev =
        tool === "hvac" ? item.hvacMeta?.defaultElevationM ?? 0 : tool === "light" ? item.lightMeta?.defaultElevationM ?? 2.9 : 0;
      const placed = this.raycastSurfaceForPlacement(e, lvIdx, mountKind, wallOffset, defaultElev);
      const [sx, , sz] = item.sizeM ?? [0.5, 0.5, 0.5];
      const rot = placed.rotationY !== undefined ? placed.rotationY : this.viewOpts.placementRotationStep * (Math.PI / 4);
      const fpCheck = placed.valid
        ? validateObjectFootprint({
            project,
            levelIndex: lvIdx,
            x: placed.x,
            y: placed.y,
            z: placed.z,
            sizeX: sx,
            sizeZ: sz,
            rotationY: rot,
            mountKind,
            tool,
            catalogId: item.materialId,
            category: item.furnitureCategory,
            hostFurniture: placed.hostFurniture,
            wallSnap: placed.wallSnap,
            altBypass: placed.altBypass,
          })
        : { valid: false };
      if (!placed.valid || !fpCheck.valid) {
        simsAudio.play("warning");
        return;
      }
      if (tool === "furniture") {
        const [fx, fy, fz] = item.sizeM ?? [1.0, 0.8, 0.8];
        this.actions.onAddFurniture(lvIdx, {
          id: uid("furn"),
          catalogId: item.materialId ?? "sofa_l",
          name: item.name,
          category: item.furnitureCategory ?? "seating",
          position: { x: placed.x, y: placed.y, z: placed.z },
          size: { x: fx, y: fy, z: fz },
          rotationY: rot,
          colorHex: this.viewOpts.selectedSwatchHex ?? item.swatchHex,
          accentHex: item.accentHex,
        });
      } else if (tool === "hvac" && item.hvacMeta) {
        this.actions.onAddHvac(lvIdx, {
          id: uid("hv"),
          name: item.name,
          type: item.hvacMeta.type,
          position: { x: placed.x, y: placed.y, z: placed.z },
          rotationY: rot,
          pkRating: item.hvacMeta.pkRating,
          flowRateM3h: item.hvacMeta.flowRateM3h,
          coolingCapacityW: item.hvacMeta.coolingCapacityW,
          powerW: item.hvacMeta.powerW,
          setpointC: item.hvacMeta.setpointC,
          speedLevel: 2,
          on: true,
        });
      } else if (tool === "light" && item.lightMeta) {
        this.actions.onAddLight(lvIdx, {
          id: uid("lgt"),
          name: item.name,
          type: item.lightMeta.type,
          position: { x: placed.x, y: placed.y, z: placed.z },
          rotationY: placed.rotationY !== undefined ? placed.rotationY : rot,
          lumens: item.lightMeta.lumens,
          colorTempK: item.lightMeta.colorTempK,
          beamAngleDeg: item.lightMeta.beamAngleDeg,
          dimmer: 1,
          on: true,
        });
      }
      simsAudio.play("place");
      this.actions.onPlacementCommitted?.(tool, e.shiftKey);
      return;
    }

    // Wall Paint / Sledgehammer / Eyedropper / Select
    const hitRes = this.raycastHit(e, true);
    if (tool === "wall_paint") {
      if (hitRes?.sel.kind === "wall") {
        const target = this.resolveWallPaintTarget(hitRes, e.shiftKey);
        const matId = item.materialId ?? "wall_ext_ivory";
        if (target?.room && this.actions.onPaintRoomWalls) {
          this.actions.onPaintRoomWalls(target.lvIdx, target.room.id, matId);
        } else if (target) {
          this.actions.onUpdateWall(target.lvIdx, target.wall.id, { [target.sideKey]: matId });
        }
        simsAudio.play("place");
      }
      return;
    }
    if (tool === "sledgehammer") {
      if (!hitRes) return;
      const s = hitRes.sel;
      if (s.kind === "wall") this.actions.onDeleteWall(s.levelIndex as 0 | 1, s.id);
      else if (s.kind === "opening") this.actions.onDeleteOpening(s.levelIndex as 0 | 1, s.wallId, s.id);
      else if (s.kind === "furniture") this.actions.onDeleteFurniture(s.levelIndex as 0 | 1, s.id);
      else if (s.kind === "hvac") this.actions.onDeleteHvac(s.levelIndex as 0 | 1, s.id);
      else if (s.kind === "light") this.actions.onDeleteLight(s.levelIndex as 0 | 1, s.id);
      else if (s.kind === "stair") this.actions.onDeleteStair(s.levelIndex as 0 | 1, s.id);
      else if (s.kind === "pool") this.actions.onDeletePool(s.id);
      else if (s.kind === "floorTile") this.actions.onDeleteFloorTile?.(s.levelIndex as 0 | 1, s.gx, s.gz);
      else if (s.kind === "room") this.actions.onDeleteRoom?.(s.levelIndex as 0 | 1, s.id);
      simsAudio.play("demolish");
      return;
    }
    if (tool === "eyedropper") {
      const eyeHit = hitRes ?? this.raycastHit(e, false);
      if (eyeHit) {
        const res = this.resolveEyedropper(eyeHit);
        if (res) {
          this.actions.onEyedropCatalog(res.catalogId, res.swatchHex);
          simsAudio.play("select");
        }
      }
      return;
    }

    const finalHit = hitRes ?? (tool === "select" ? this.raycastHit(e, false) : null);
    this.actions.onSelect(finalHit ? finalHit.sel : null);
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    const dprChanged = Math.abs(this.currentDpr - this.lastAppliedSize.dpr) > 0.001;
    const sizeChanged = w !== this.lastAppliedSize.w || h !== this.lastAppliedSize.h;
    if (!dprChanged && !sizeChanged) return; // same-value setSize still wipes the canvas to black
    this.lastAppliedSize = { w, h, dpr: this.currentDpr };
    if (dprChanged) this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.setSize(w, h, false);
    this.cameraCtrl.setAspect(w / h);
    if (this.composer) {
      if (dprChanged) this.composer.setPixelRatio(this.currentDpr);
      if (sizeChanged || dprChanged) this.composer.setSize(w, h);
    }
    if (this.atmospherePass) this.atmospherePass.atmosphereUniforms.uAspect.value = w / h;
    // A real resize just reset the drawing buffer; paint one frame right now so the
    // user never sees the cleared (black) canvas waiting for the next RAF.
    if (this.hasRenderedOnce && !this.contextLost && !this.disposed) {
      const cam = this.cameraCtrl.activeCamera;
      if (this.postActive && this.composer) {
        if (this.renderPass) this.renderPass.camera = cam;
        if (this.gtaoPass) this.gtaoPass.camera = cam;
        this.updateAtmosphere(cam);
        this.composer.render();
      } else {
        this.renderer.render(this.scene, cam);
      }
    }
  }

  private handleVisibility(): void {
    if (document.hidden) {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    } else {
      this.lastFrameMs = performance.now();
      this.startLoop();
    }
  }

  private startLoop(): void {
    if (this.rafId !== null || this.disposed) return;
    const tick = (now: number) => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);
      if (document.hidden || this.contextLost) return;

      const dt = (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;
      const clampedDt = Math.min(0.05, Math.max(0.001, dt));
      this.simElapsedS += clampedDt;

      if (Math.abs(this.explodeCurrent - this.explodeTarget) > 0.001) {
        this.explodeCurrent += (this.explodeTarget - this.explodeCurrent) * (this.reducedMotion ? 1 : Math.min(1, dt * 10));
        if (Math.abs(this.explodeCurrent - this.explodeTarget) <= 0.001) {
          this.explodeCurrent = this.explodeTarget;
        }
        this.applyExplode(this.explodeCurrent);
        if (this.explodeCurrent <= 0.005 && this.explodeTarget <= 0.005) {
          this.updateWallCutawayVisibility(true);
        }
      }

      if (!this.reducedMotion) {
        for (const fan of this.animatedFans) {
          fan.rotation.y += dt * 7.5;
        }
      }

      if (this.rainPoints && this.rainPoints.visible && this.rainArray && !this.reducedMotion) {
        const speed = 13.5 * clampedDt;
        const slant = 2.6 * clampedDt;
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
          this.lightningTimer -= clampedDt;
          if (this.lightningTimer <= 0) {
            this.lightningTimer = 4 + Math.random() * 7;
            this.lightningEnergy = 2.8;
          }
        }
      }
      if (this.lightningEnergy > 0.01 && !this.reducedMotion) {
        this.lightningEnergy *= Math.exp(-clampedDt * 10);
        this.lightningLight.intensity = this.lightningEnergy;
      } else {
        this.lightningLight.intensity = 0;
      }

      this.palette.floodUniforms.uTime.value = this.reducedMotion ? 0 : this.simElapsedS;
      this.palette.floodUniforms.uRain.value = Math.min(1, this.lastRainMmH / 100);

      if (this.airParticlesMesh && this.airflow && this.airParticleStates.length > 0 && this.derived) {
        const af = this.airflow;
        const proj = this.derived.project;
        const lt1Y = proj.site.peil.floor1PeilM;
        const lt2Y = lt1Y + (proj.levels[0]?.height ?? 3.6);
        const clampedDt = Math.min(0.05, Math.max(0.001, dt));
        for (let i = 0; i < this.airParticleStates.length; i++) {
          const p = this.airParticleStates[i]!;
          const gx = Math.max(0, Math.min(af.gridW - 1, Math.floor(p.x / 0.2)));
          const gz = Math.max(0, Math.min(af.gridD - 1, Math.floor(p.z / 0.2)));
          const idx = gz * af.gridW + gx;
          const vx = (p.lv === 0 ? af.lt1VelX[idx] : af.lt2VelX[idx]) ?? 0;
          const vz = (p.lv === 0 ? af.lt1VelZ[idx] : af.lt2VelZ[idx]) ?? 0.2;
          const temp = (p.lv === 0 ? af.lt1Temp[idx] : af.lt2Temp[idx]) ?? 30;

          p.x += vx * clampedDt * 1.4;
          p.z += vz * clampedDt * 1.4;
          p.life += clampedDt * 0.35;
          if (p.life > 1 || p.x < 0.05 || p.x > proj.site.width - 0.05 || p.z < 0.05 || p.z > proj.site.depth - 0.05) {
            p.x = 0.2 + Math.random() * (proj.site.width - 0.4);
            p.z = 0.2 + Math.random() * (proj.site.depth - 0.4);
            p.lv = this.viewOpts.activeLevel === 0 ? 0 : this.viewOpts.activeLevel === 1 ? 1 : i % 2 === 0 ? 0 : 1;
            p.y = (p.lv === 0 ? lt1Y : lt2Y) + 0.7 + Math.random() * 1.7;
            p.life = 0;
          }
          this._v1.set(p.x, p.y, p.z);
          this._q.setFromAxisAngle(this._up, Math.atan2(vx, vz));
          this._m4.compose(this._v1, this._q, this._s1);
          this.airParticlesMesh.setMatrixAt(i, this._m4);
          const tNorm = Math.max(0, Math.min(1, (temp - 23) / 10));
          this._col.setRGB(0.2 + tNorm * 0.78, 0.76 - tNorm * 0.25, 0.96 - tNorm * 0.72);
          this.airParticlesMesh.setColorAt(i, this._col);
        }
        this.airParticlesMesh.instanceMatrix.needsUpdate = true;
        if (this.airParticlesMesh.instanceColor) this.airParticlesMesh.instanceColor.needsUpdate = true;
      }

      this.cameraCtrl.update(dt);
      this.updateWallCutawayVisibility(false);
      // Lock sky dome center to camera (`3d-sky-background`) so orbiting never introduces dome translation parallax
      this.skyMesh.position.copy(this.cameraCtrl.activeCamera.position);
      const cam = this.cameraCtrl.activeCamera;
      if (this.postActive && this.composer) {
        if (this.renderPass) this.renderPass.camera = cam;
        if (this.gtaoPass && this.gtaoPass.camera !== cam) {
          this.gtaoPass.camera = cam;
          // GTAO bakes PERSPECTIVE_CAMERA into its shader defines at construction;
          // switching to the orthographic plan/elevation views without refreshing it
          // evaluates AO with the wrong projection and smears the frame.
          const gm = (this.gtaoPass as unknown as { gtaoMaterial?: THREE.ShaderMaterial }).gtaoMaterial;
          if (gm) {
            gm.defines.PERSPECTIVE_CAMERA = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? 1 : 0;
            gm.needsUpdate = true;
          }
        }
        // Skip GTAO while the section cut or rain streaks would write ghosts into the AO gbuffer
        if (this.gtaoPass) {
          const cutActive = (this.studioView?.cutH ?? 100) < 9.15;
          const rainActive = Boolean(this.studioView?.showRain) && this.lastRainMmH > 0;
          this.gtaoPass.enabled = this.activeTier === "high" && !this.softwareGpu && !cutActive && !rainActive;
        }
        this.updateAtmosphere(cam);
        this.composer.render();
      } else {
        this.renderer.render(this.scene, cam);
      }
      this.hasRenderedOnce = true;

      if (dt > 0 && dt < 0.25) {
        this.fpsSamples.push(1 / dt);
        if (this.fpsSamples.length >= 24) {
          const avg = Math.round(this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length);
          this.fpsSamples = [];
          if (this.qualityOverride === "auto" && now - this.lastDprCheckMs > 2000) {
            this.lastDprCheckMs = now;
            // Hysteresis governor: consecutive windows + cooldowns, so a GPU hovering
            // between tiers settles instead of thrashing tiers (and black-flashing).
            const decision = this.tierGovernor.sample(avg, now);
            if (decision === "downgrade" && this.activeTier === "high") {
              this.applyQualityTier("medium");
            } else if (decision === "upgrade" && this.activeTier === "medium") {
              this.applyQualityTier("high");
            }
          }
          const info = this.renderer.info;
          const snap: BuildSceneStats = {
            fps: avg,
            tier: this.activeTier,
            dpr: Number(this.currentDpr.toFixed(2)),
            calls: info.render.calls,
            triangles: info.render.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
          };
          (window as unknown as { __RUMAH_BUILD_STATS__?: BuildSceneStats }).__RUMAH_BUILD_STATS__ = snap;
          this.actions.onStats?.(snap);
        }
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
