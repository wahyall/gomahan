import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { DualKawaseBloomPass } from "@/features/buildMode/DualKawaseBloomPass";
import { PhotographicOutputPass } from "@/features/buildMode/PhotographicOutputPass";
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
import { createChamferBox, createContactShadowTexture, disposeGeometry, disposeResource } from "@/lib/scene/geometryHelpers";
import { buildInstancedContactDecals, type ContactDecalSpec } from "@/lib/scene/bakedAo";
import { createEnvironmentMap, createMaterialPalette, createSkyGradientTexture, makeSunSpriteTexture, type MaterialPalette } from "@/lib/scene/materials";
import { createIesSpotTexture } from "@/lib/scene/pcssShadow";
import { ReflectionProbeRig } from "@/lib/scene/reflectionProbes";
import { rtLookUniforms, setRtLookUniforms } from "@/lib/scene/rtUniforms";
import {
  computeAutoExposure,
  resolvePhotographicPreset,
  whiteBalanceMatrix,
  type PhotographicPreset,
} from "@/lib/scene/photographicPresets";
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
  freePlacementEnabled?: boolean;
  multiPlaceEnabled?: boolean;
  mobilePlacementActive?: boolean;
  mobileDrawMode?: "draw" | "orbit";
  mobileMoveEntityArmed?: boolean;
}

type PointerCoords = {
  clientX: number;
  clientY: number;
  altKey?: boolean;
  shiftKey?: boolean;
};

const POINT_PLACEMENT_TOOLS = new Set<BuildToolId>(["opening", "stair", "furniture", "hvac", "light"]);

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
  // OPT-05: lightning energy rides `fillLight` — no permanent third DirectionalLight
  private fillLightBase = 0.45;
  private fillLightTinted = false;

  private readonly envGroup = new THREE.Group();
  private readonly neighborsGroup = new THREE.Group();
  private readonly houseContainer = new THREE.Group();
  private readonly propsContainer = new THREE.Group();
  private readonly propLevelRoots: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  private readonly lightPoolLevelRoots: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  private spotLightPools: [THREE.SpotLight[], THREE.SpotLight[]] = [[], []];
  private pointLightPools: [THREE.PointLight[], THREE.PointLight[]] = [[], []];
  private housePickables: THREE.Object3D[] = [];
  private readonly _pickTargets: THREE.Object3D[] = [];
  private canvasRect: DOMRect | null = null;
  private readonly simGroup = new THREE.Group();
  private readonly dimsGroup = new THREE.Group();
  /** OPT-08: labels live in their own always-built group — toggling `showLabels`
   * flips `.visible` in O(1) instead of a full 40–150 ms `rebuildFromProject()`. */
  private readonly labelsGroup = new THREE.Group();
  private readonly labelsLt1Group = new THREE.Group();
  private readonly labelsLt2Group = new THREE.Group();
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
  // OPT-02/OPT-05/OPT-09/OPT-18: prewarm state, fan frustum culling, blur gating, capture bridge
  private poolLitState = false;
  private shaderPrewarmDone = false;
  private rawToDataURL: HTMLCanvasElement["toDataURL"] | null = null;
  private readonly _frustum = new THREE.Frustum();
  private readonly _pm = new THREE.Matrix4();
  private body3dActive = false;
  private last3dActiveAt = 0;
  private explodePieces: { obj: THREE.Object3D; base: THREE.Vector3; off: THREE.Vector3 }[] = [];
  private explodeInstanced: { im: THREE.InstancedMesh; n: number; pos: Float32Array; off: Float32Array; quat: Float32Array; scl: Float32Array }[] = [];
  private explodeCurrent = 0;
  private explodeTarget = 0;

  private rainPoints: THREE.Points | null = null;
  private rainTex: THREE.CanvasTexture | null = null;
  private rainArray: Float32Array | null = null;
  private rainActiveCount = 0;
  /** OPT-12: shared uniform driving the GPU rain fall cycle in the vertex shader. */
  private readonly rainTime = { value: 0 };
  // OPT-22: dev-only GPU/CPU pass profiler (`?perf=1` or development) — publishes
  // window.__GOMAHAN_PERF__ (frame CPU ms, GPU ms via EXT_disjoint_timer_query_webgl2,
  // calls, programs, and memory counters).
  private readonly perfEnabled: boolean;
  private perfGpuExt: { TIME_ELAPSED_EXT: number } | null = null;
  private perfGpuQuery: WebGLQuery | null = null;
  private perfCpuMs = 0;
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
  private skyKey = "";
  private envStateKey: "day" | "night" | "storm" | "" = "";
  private readonly pmremCache = new Map<"day" | "night" | "storm", THREE.Texture>();
  private envKey = "";
  private prevBuildRefs: {
    systems: unknown;
    peil: unknown;
    structuralParams: unknown;
    soil: unknown;
    floodMitigation: unknown;
    buildExtras: unknown;
    levelsMeta: { id: string; index: number; name: string; height: number; walls: unknown; rooms: unknown; slabs: unknown; stairs: unknown }[];
    showBricksOverlay: boolean;
    previewRoofType: RoofType | null;
    stage: number;
    showBricks: boolean;
    showStructure: boolean;
    showTerrain: boolean;
    showRoof: boolean;
    showRangka: boolean;
    showFinishing: boolean;
    xrayRebar: boolean;
    showAir: boolean;
    showListrik: boolean;
    hiddenParts: string[];
  } | null = null;
  private prevPropsRefs: {
    peil: unknown;
    stage: number;
    levels: { index: number; height: number; furniture: unknown; lights: unknown; hvac: unknown }[];
  } | null = null;
  private prevSimRefs: {
    activeLevel: number;
    showLuxHeatmap: boolean;
    showAirParticles: boolean;
    showFloodWater: boolean;
    flood: unknown;
    doorFloodBarrier: boolean;
    barrierHeightCm: number;
    hr: number;
    rn: number;
    ws: number;
    wd: number;
    at: number;
    lights: unknown[];
    hvac: unknown[];
  } | null = null;
  private lastWireframe: boolean | null = null;
  private needsRender = true;
  private contactDecalMeshes: [THREE.InstancedMesh | null, THREE.InstancedMesh | null] = [null, null];
  private contactDecalResources: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
  private contactDecalIndexMap = new Map<string, { lvIdx: 0 | 1; index: number; w: number; d: number; yRenderOffset: number }>();
  private lastCutawayYaw = Number.NaN;
  // OPT-12: cutaway gating now compares primitive fields — the old 7-segment
  // template-string key allocated a fresh string on every orbit frame.
  private lastCutVis = "";
  private lastCutLevel = -1;
  private lastCutExploded = -1;
  private lastCutBrickMeshes = -1;
  private lastCutActive = -1;
  private lastCutTx = Number.NaN;
  private lastCutTz = Number.NaN;

  private readonly _m4 = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
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
    freePlacementEnabled: false,
    multiPlaceEnabled: false,
    mobilePlacementActive: false,
    mobileDrawMode: "draw",
    mobileMoveEntityArmed: false,
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
  private atmospherePass: AtmospherePass | null = null;
  private bloomPass: DualKawaseBloomPass | null = null;
  private photoOutputPass: PhotographicOutputPass | null = null;
  private sceneDepthTex: THREE.DepthTexture | null = null;
  /** GR-02: dual CubeCamera reflection probe rig (event-driven bake). */
  private probeRig: ReflectionProbeRig | null = null;
  /** GR-05: shared IES cookie for the SpotLight pool. */
  private iesTex: THREE.DataTexture | null = null;
  /** PH-01 smooth auto-exposure state (camera iris). */
  private currentExposure = 1.0;
  private photoPreset: PhotographicPreset = resolvePhotographicPreset(10, 0);
  private postActive = false;
  /** Cinematic "ray-traced look" stack: HDR MSAA → Baked AO → sun shafts → bloom → ACES. */
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
  private mobileGhostDragging = false;
  private stagedClientPos: { x: number; y: number } | null = null;

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
  private readonly floorPreviewGeo = new THREE.BoxGeometry(0.5, 0.03, 0.5);
  private readonly floorPreviewPool = new THREE.InstancedMesh(this.floorPreviewGeo, this.validMat, 500);
  /** OPT-11: static unit-primitive preview pool — the 12 tool previews rescale / rotate /
   * re-material these instead of allocating + disposing Box/Cone/Ring geometries on
   * every pointermove (zero geometry allocation, zero GC, zero GPU buffer churn). */
  private readonly previewUnitBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.validMat);
  private readonly previewUnitCone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 10), this.validMat);
  private readonly previewUnitRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.25, 24), this.validMat);
  /** OPT-14: scratch face normal for raycast hits — was `new THREE.Vector3()` per candidate. */
  private readonly _hitNormal = new THREE.Vector3();
  private previewRafId: number | null = null;
  private pendingPreviewEvent: PointerCoords | null = null;
  private pendingPreviewHits: THREE.Intersection[] | undefined = undefined;

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
    this.requestRender();
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

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false });
    const mobileViewport = typeof window !== "undefined" && window.innerWidth < 768;
    this.mobileViewport = mobileViewport;
    // Software rasterizers (SwiftShader/llvmpipe) must never receive the cinematic stack:
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
    this.perfEnabled =
      !softwareGpu &&
      typeof window !== "undefined" &&
      (process.env.NODE_ENV === "development" || new URLSearchParams(window.location.search).has("perf"));
    if (this.perfEnabled) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      this.perfGpuExt = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number } | null;
    }
    this.activeTier = softwareGpu ? "low" : mobileViewport ? "medium" : "high";
    const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.baseDpr = softwareGpu ? Math.min(1, rawDpr) : mobileViewport ? Math.min(1.5, rawDpr) : Math.min(2, Math.max(1.5, rawDpr));
    this.currentDpr = this.baseDpr;
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    // three r187 removed PCFSoftShadowMap — PCF now carries the soft kernel itself.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // OPT-02: clipping is enabled on demand only when a real section cut is active
    // (updateProjectData drives it) — Early-Z stays on for ~95% of the session.

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

    // OPT-01 (2026-11): `preserveDrawingBuffer: false` restores the zero-copy swapchain
    // page-flip; snapshot/export paths read the canvas through `captureDataUrl()`, which
    // renders one synchronous frame immediately before the read.
    this.rawToDataURL = this.canvas.toDataURL.bind(this.canvas);
    this.canvas.toDataURL = ((type?: string, quality?: number) => {
      if (this.disposed || this.contextLost) return this.rawToDataURL!(type, quality);
      return this.captureDataUrl(type ?? "image/jpeg", quality ?? 0.92);
    }) as HTMLCanvasElement["toDataURL"];

    this.skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
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

    // Defer initial PMREM generation to first updateProjectData() so PMREMGenerator isn't run twice on boot
    this.scene.environmentIntensity = 0.72;

    this.contactShadowTex = createContactShadowTexture();
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: this.contactShadowTex,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.staticDisposables.push(this.skyMat, this.skyMesh.geometry, this.contactShadowTex, this.contactShadowMat);

    // Pre-allocate fixed hardware light pool per level (max 7 Spot + 7 Point slots, at most 7 active per level)
    this.iesTex = createIesSpotTexture();
    this.staticDisposables.push(this.iesTex);
    for (const lvIdx of [0, 1] as const) {
      for (let i = 0; i < 7; i++) {
        const spot = new THREE.SpotLight(0xfff3de, 0, 4.4, 0.7, 0.82, 0.45);
        spot.visible = false;
        // GR-05: photometric IES cookie — soft core + wall-wash scallop ring.
        spot.map = this.iesTex;
        this.lightPoolLevelRoots[lvIdx].add(spot, spot.target);
        this.spotLightPools[lvIdx].push(spot);

        const pt = new THREE.PointLight(0xffcb85, 0, 3.0, 0.6);
        pt.visible = false;
        this.lightPoolLevelRoots[lvIdx].add(pt);
        this.pointLightPools[lvIdx].push(pt);
      }
    }

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

    this.propsContainer.add(
      this.propLevelRoots[0],
      this.propLevelRoots[1],
      this.lightPoolLevelRoots[0],
      this.lightPoolLevelRoots[1],
    );
    this.floorPreviewPool.userData.isPooledPreview = true;
    this.floorPreviewPool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.floorPreviewPool.visible = false;
    this.floorPreviewPool.frustumCulled = false;
    // OPT-11: unit-primitive preview pool — cone and ring ride alongside the box;
    // clearPreviewMeshes detaches without disposing (userData.isPooledPreview).
    for (const pm of [this.previewUnitBox, this.previewUnitCone, this.previewUnitRing]) {
      pm.userData.isPooledPreview = true;
      pm.visible = false;
      pm.frustumCulled = false;
    }
    // Swing arrow cone composes yaw*tilt through a YXZ euler (OPT-11 sibling setup).
    this.previewUnitCone.rotation.order = "YXZ";
    (this.raycaster as unknown as { firstHitOnly?: boolean }).firstHitOnly = true;
    this.labelsGroup.add(this.labelsLt1Group, this.labelsLt2Group);
    this.scene.add(
      this.envGroup,
      this.neighborsGroup,
      this.houseContainer,
      this.propsContainer,
      this.simGroup,
      this.dimsGroup,
      this.labelsGroup,
      this.overlayGroup,
      this.previewGroup,
      this.selectedRing,
    );

    this.handleResize();
    this.setupPostPipeline();
    this.configurePostPipeline();
    // GR-08: shared RT uniforms + probe env-map binding follow the store default.
    this.applyRtStack();
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
    canvas.addEventListener("pointercancel", this.onPointerUpBound);
    canvas.addEventListener("pointerleave", this.onPointerLeaveBound);
    canvas.addEventListener("webglcontextlost", this.onContextLostBound);
    canvas.addEventListener("webglcontextrestored", this.onContextRestoredBound);

    this.startLoop();
  }

  public requestRender(): void {
    this.needsRender = true;
  }

  private markShadowDirty(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    // OPT-18: never leave the body attribute latched after the scene is gone.
    if (this.body3dActive) {
      this.body3dActive = false;
      document.body.removeAttribute("data-3d-active");
    }
    // OPT-01: restore the native toDataURL once the override is no longer needed.
    if (this.rawToDataURL) {
      this.canvas.toDataURL = this.rawToDataURL;
      this.rawToDataURL = null;
    }
    if (this.previewRafId !== null) {
      cancelAnimationFrame(this.previewRafId);
      this.previewRafId = null;
    }
    this.pendingPreviewEvent = null;
    this.pendingPreviewHits = undefined;
    window.removeEventListener("resize", this.onResizeBound);
    this.resizeObserver?.disconnect();
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("keyup", this.onKeyUpBound);
    document.removeEventListener("visibilitychange", this.onVisibilityBound);
    this.canvas.removeEventListener("pointermove", this.onPointerMoveBound);
    this.canvas.removeEventListener("pointerdown", this.onPointerDownBound);
    this.canvas.removeEventListener("pointerup", this.onPointerUpBound);
    this.canvas.removeEventListener("pointercancel", this.onPointerUpBound);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeaveBound);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLostBound);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestoredBound);
    this.cameraCtrl.dispose();

    this.postActive = false;
    this.atmospherePass?.dispose();
    this.bloomPass?.dispose();
    this.photoOutputPass?.dispose();
    this.probeRig?.dispose();
    this.probeRig = null;
    this.sceneDepthTex?.dispose();
    this.sceneDepthTex = null;
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.atmospherePass = null;
    this.bloomPass = null;
    this.photoOutputPass = null;

    if (typeof window !== "undefined") {
      delete (window as unknown as { __RT_DEBUG__?: unknown }).__RT_DEBUG__;
    }

    this.scene.remove(this.hoverHighlightMesh);
    disposeGeometry(this.hoverBoxGeo);
    this.clearPreviewMeshes();
    this.clearSim();
    if (this.gridMesh) {
      this.overlayGroup.remove(this.gridMesh);
      disposeGeometry(this.gridMesh.geometry);
      (this.gridMesh.material as THREE.Material).dispose();
      this.gridMesh = null;
    }
    this.overlayGroup.clear();
    this.previewGroup.clear();
    this.simGroup.clear();
    this.envGroup.clear();
    this.neighborsGroup.clear();
    this.houseContainer.clear();
    this.propsContainer.clear();
    this.dimsGroup.clear();

    for (const batch of this.brickBatches) {
      batch.im.dispose();
    }
    this.brickBatches = [];
    for (const lvIdx of [0, 1] as const) {
      const dm = this.contactDecalMeshes[lvIdx];
      if (dm) {
        this.propLevelRoots[lvIdx].remove(dm);
        dm.dispose();
        this.contactDecalMeshes[lvIdx] = null;
      }
      for (const g of this.contactDecalResources[lvIdx]) disposeGeometry(g);
      this.contactDecalResources[lvIdx] = [];
    }
    this.contactDecalIndexMap.clear();

    for (const ent of this.propEntries.values()) {
      for (const r of ent.resources) disposeResource(r);
    }
    this.propEntries.clear();
    for (const g of this.ghostCache.values()) {
      for (const r of g.disposables) disposeResource(r);
    }
    this.ghostCache.clear();
    if (this.roomOutlineLoop) {
      disposeGeometry(this.roomOutlineLoop.geometry);
      (this.roomOutlineLoop.material as THREE.Material).dispose();
      this.roomOutlineLoop = null;
    }
    if (this.liveTerrainTempMesh) {
      disposeGeometry(this.liveTerrainTempMesh.geometry);
      this.liveTerrainTempMesh = null;
    }
    for (const r of this.dynResources) disposeResource(r);
    for (const r of this.simResources) disposeResource(r);
    for (const r of this.staticDisposables) disposeResource(r);
    this.dynResources = [];
    this.simResources = [];
    this.staticDisposables = [];

    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null;
    }
    disposeGeometry(this.rainPoints?.geometry);
    (this.rainPoints?.material as THREE.Material | undefined)?.dispose();
    this.rainTex?.dispose();
    this.validMat.dispose();
    this.invalidMat.dispose();
    this.cyanMat.dispose();
    this.ghostValidMat.dispose();
    this.ghostInvalidMat.dispose();
    this.floorPreviewPool.dispose();
    disposeGeometry(this.floorPreviewGeo);
    this.skyMat.map?.dispose();
    this.skyMat.map = null;
    for (const tex of this.pmremCache.values()) tex.dispose();
    this.pmremCache.clear();
    this.envTex = null;
    for (const lvIdx of [0, 1] as const) {
      for (const s of this.spotLightPools[lvIdx]) s.dispose();
      for (const p of this.pointLightPools[lvIdx]) p.dispose();
      this.spotLightPools[lvIdx] = [];
      this.pointLightPools[lvIdx] = [];
    }
    this.housePickables = [];
    this._pickTargets.length = 0;
    this.palette.dispose();
    this.renderer.dispose();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** OPT-01: render one synchronous frame, then read the canvas in the same microtask. */
  public captureDataUrl(mime = "image/jpeg", quality = 0.92): string {
    if (this.disposed || this.contextLost) return this.rawToDataURL?.(mime, quality) ?? "";
    const cam = this.cameraCtrl.activeCamera;
    if (this.postActive && this.composer) {
      if (this.renderPass) this.renderPass.camera = cam;
      this.updateAtmosphere(cam);
      this.composer.render();
    } else {
      this.renderer.render(this.scene, cam);
    }
    return this.rawToDataURL!(mime, quality);
  }

  /** OPT-09: a fan only keeps the loop alive while it is on-screen and effectively visible. */
  private anyFanVisibleInFrustum(): boolean {
    if (this.animatedFans.length === 0 || this.reducedMotion) return false;
    const cam = this.cameraCtrl.activeCamera;
    cam.updateMatrixWorld();
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    for (const fan of this.animatedFans) {
      let o: THREE.Object3D | null = fan;
      let effectivelyVisible = true;
      while (o) {
        if (!o.visible) {
          effectivelyVisible = false;
          break;
        }
        o = o.parent;
      }
      if (!effectivelyVisible) continue;
      fan.getWorldPosition(this._v1);
      if (this._frustum.containsPoint(this._v1)) return true;
    }
    return false;
  }

  /** OPT-18: mark <body> as 3d-active so `.studio-glass` drops its compositor blur
   * while the camera is actually moving; released ~150 ms after it rests. */
  private update3dActiveFlag(active: boolean, now: number): void {
    if (active) {
      this.last3dActiveAt = now;
      if (!this.body3dActive) {
        this.body3dActive = true;
        document.body.setAttribute("data-3d-active", "1");
      }
    } else if (this.body3dActive && now - this.last3dActiveAt > 150) {
      this.body3dActive = false;
      document.body.removeAttribute("data-3d-active");
    }
  }

  /**
   * OPT-02 + OPT-05 prewarm: compile both macro shader variants up front —
   * (clipped + lit pool) and (unclipped + day pool) — via `compileAsync` so the
   * first section-cut slider drag and the first light toggle never hitch.
   */
  private prewarmShaderVariants(): void {
    if (this.shaderPrewarmDone || this.disposed) return;
    this.shaderPrewarmDone = true;
    const cam = this.cameraCtrl.activeCamera;
    const clipWas = this.renderer.localClippingEnabled;
    const poolWas = this.poolLitState;
    const spots = [...this.spotLightPools[0], ...this.spotLightPools[1]];
    const points = [...this.pointLightPools[0], ...this.pointLightPools[1]];
    try {
      this.renderer.localClippingEnabled = true;
      for (const l of spots) l.visible = true;
      for (const l of points) l.visible = true;
      void this.renderer.compileAsync(this.scene, cam).catch(() => {});
      this.renderer.localClippingEnabled = false;
      for (const l of spots) l.visible = false;
      for (const l of points) l.visible = false;
      void this.renderer.compileAsync(this.scene, cam).catch(() => {});
    } catch {
      // best-effort prewarm only — a missed variant compiles on first use as before
    } finally {
      this.renderer.localClippingEnabled = clipWas;
      for (const l of spots) l.visible = poolWas;
      for (const l of points) l.visible = poolWas;
    }
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

  /** Toggle the hybrid photorealistic RT stack (GI + BPCEM + PCSS + Fresnel +
   *  IES + Dual-Kawase bloom + AgX photographic output). Uniform-gated: instant. */
  public setRayTracingLook(enabled: boolean): void {
    this.rayTracingEnabled = enabled;
    this.applyRtStack();
    this.configurePostPipeline();
    this.requestRender();
  }

  /** GR-08: flip shared RT uniforms, rebind probe env-maps, bake probes on demand. */
  private applyRtStack(): void {
    const on = this.rayTracingEnabled && !this.softwareGpu;
    setRtLookUniforms(on, this.photoPreset.giBounce);
    if (this.probeRig) {
      if (on && !this.probeRig.hasBaked && this.hasRenderedOnce) {
        this.bakeReflectionProbes();
      }
      this.probeRig.bindEnvMaps(this.houseContainer, on, this.envTex);
      this.probeRig.bindEnvMaps(this.propsContainer, on, this.envTex);
    }
  }

  /** GR-02: capture both probes once per rebuild / sun-hour change (<3 ms GPU). */
  private bakeReflectionProbes(): void {
    if (!this.probeRig || !this.renderer || this.disposed || this.softwareGpu) return;
    const hide: THREE.Object3D[] = [
      this.overlayGroup,
      this.previewGroup,
      this.dimsGroup,
      this.labelsGroup,
    ];
    if (this.rainPoints) hide.push(this.rainPoints);
    this.probeRig.bake(this.renderer, this.scene, {
      searchRoot: this.scene,
      hide,
    });
    this.probeRig.bindEnvMaps(this.houseContainer, this.rayTracingEnabled, this.envTex);
    this.probeRig.bindEnvMaps(this.propsContainer, this.rayTracingEnabled, this.envTex);
  }

  /**
   * Hybrid photorealistic RT pipeline (`PLAN_GRAPHIC.md` §1): linear HDR MSAA
   * buffer (with a resolved depth texture for SSCS) → screen-space sun shafts →
   * progressive Dual-Kawase HDR bloom (half-res pyramid, OPT-04) → fused
   * `PhotographicOutputPass` (SSCS contact shadows + bloom composite + EV100
   * auto-exposure + Kelvin white balance + AgX Punchy + RCAS sharpening +
   * cos⁴ vignette + edge CA + film grain + dither, GR-06 / PH-01–PH-04).
   */
  private setupPostPipeline(): void {
    if (this.composer || this.disposed) return;
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    const target = new THREE.WebGLRenderTarget(Math.round(w * this.currentDpr), Math.round(h * this.currentDpr), {
      type: THREE.HalfFloatType,
      // OPT-21: no stencil pass exists in this app — dropping the stencil plane
      // saves depth-stencil bandwidth on every composer buffer clear.
      stencilBuffer: false,
      // MSAA resolve on HalfFloat targets wedges software rasterizers (SwiftShader) into
      // ghost-white frames — real GPUs keep 4x AA, software falls back to a clean resolve.
      samples: this.softwareGpu ? 0 : 4,
    });
    // GR-06: the depth plane is resolved alongside colour (r187 blit) and feeds
    // the SSCS raymarch in the fused output pass. Attached to renderTarget1 —
    // the only buffer the RenderPass ever writes depth into.
    if (!this.softwareGpu) {
      this.sceneDepthTex = new THREE.DepthTexture(Math.round(w * this.currentDpr), Math.round(h * this.currentDpr));
      target.depthTexture = this.sceneDepthTex;
    }
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.cameraCtrl.activeCamera);
    this.atmospherePass = new AtmospherePass();
    this.bloomPass = new DualKawaseBloomPass(new THREE.Vector2(w, h), this.photoPreset.bloomThreshold, 0.5, 2.2, 0.65);
    this.photoOutputPass = new PhotographicOutputPass();
    this.photoOutputPass.photoUniforms.tBloom.value = this.bloomPass.bloomTexture;
    this.photoOutputPass.photoUniforms.tDepth.value = this.sceneDepthTex;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.atmospherePass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.photoOutputPass);
    // Custom-target composers start with _width/_height in *pixels*; setSize must run
    // before setPixelRatio or the targets transiently resize to w·dpr² (~4x the VRAM).
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.currentDpr);
    this.photoOutputPass.setSize(Math.round(w * this.currentDpr), Math.round(h * this.currentDpr));
    this.lastAppliedSize = { w, h, dpr: this.currentDpr };
    this.atmospherePass.atmosphereUniforms.uAspect.value = w / h;
    this.photoOutputPass.photoUniforms.uAspect.value = w / h;
    // GR-02: probe rig lives for the lifetime of the scene; baking is event-driven.
    this.probeRig = new ReflectionProbeRig();
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      (window as unknown as { __RT_DEBUG__?: unknown }).__RT_DEBUG__ = {
        composer: this.composer,
        atmo: this.atmospherePass,
        bloom: this.bloomPass,
        photo: this.photoOutputPass,
        probes: this.probeRig,
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
    if (this.atmospherePass) {
      this.atmospherePass.atmosphereUniforms.uSamples.value = this.activeTier === "high" ? 40 : 22;
    }
    if (this.photoOutputPass) {
      // GR-03: SSCS only on the high tier — medium keeps the fused output but skips
      // the 6-step depth march; software/low tiers never reach this path.
      this.photoOutputPass.photoUniforms.uSscs.value = this.activeTier === "high" && !this.softwareGpu ? 1 : 0;
    }
  }

  /** Project the sun into screen space and drive the god-ray uniforms every frame,
   * then gate the pass chain: OPT-03 kills the whole atmosphere pass when the sun
   * is off-screen/behind the camera, OPT-04 skips the bloom pyramid when no HDR
   * source exists (sun down, interior lights off, no lightning strike).
   * GR-06/PH-01: also advances the smooth EV100 iris and feeds the fused
   * photographic pass (sun dir in view space, projection, SSCS gating). */
  private updateAtmosphere(cam: THREE.Camera): void {
    const ap = this.atmospherePass;
    if (!ap) return;
    cam.updateMatrixWorld();
    this._v1.copy(this.sunLight.position).applyMatrix4(cam.matrixWorldInverse);
    if (this._v1.z > -1) {
      // Sun sits behind the camera: no shafts, no mirrored source flash.
      ap.atmosphereUniforms.uSunFade.value = 0;
    } else {
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

    // OPT-03: no shafts → no full-resolution HalfFloat read/write at all.
    ap.enabled = ap.atmosphereUniforms.uSunFade.value > 0.001;

    // OPT-04 early bypass: with the sun below the horizon, every interior light off
    // and no lightning strike, no pixel can pass the photographic bloom threshold —
    // the whole 7-pass bloom pyramid is skipped for free.
    if (this.bloomPass) {
      this.bloomPass.enabled =
        Boolean(this.sunCore?.visible) || this.poolLitState || this.lightningEnergy > 0.02;
    }
    if (this.photoOutputPass) {
      const pu = this.photoOutputPass.photoUniforms;
      pu.uTime.value = this.simElapsedS;
      pu.uBloomStrength.value = this.bloomPass?.enabled ? this.photoPreset.bloomStrength : 0;
      // PH-01 smooth iris (Build viewport is always exterior).
      this.currentExposure = computeAutoExposure(
        this.currentExposure,
        this.derived?.project.simulation.hourOfDay ?? 10,
        this.lastRainMmH,
        false,
        1 / 60,
      );
      pu.uExposure.value = this.currentExposure;
      (pu.uWhiteBalance.value as THREE.Matrix3).set(
        this.wbMatrix[0]!, this.wbMatrix[1]!, this.wbMatrix[2]!,
        this.wbMatrix[3]!, this.wbMatrix[4]!, this.wbMatrix[5]!,
        this.wbMatrix[6]!, this.wbMatrix[7]!, this.wbMatrix[8]!,
      );
      // Projection pair for SSCS view-space reconstruction.
      const proj = cam.projectionMatrix;
      (pu.uProj.value as THREE.Matrix4).copy(proj);
      (pu.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      // Shared view-space sun direction (foliage SSS, Mie scattering, SSCS).
      rtLookUniforms.uSunDirView.value.copy(this.sunDir).transformDirection(cam.matrixWorldInverse);
      rtLookUniforms.uCamWorldY.value = cam.getWorldPosition(this._v2).y;
      // SSCS is pointless at night / with the sun below the horizon.
      pu.uSscs.value =
        this.activeTier === "high" && !this.softwareGpu && this.sunLight.intensity > 0.4 ? 1 : 0;
      pu.uSunDirView.value.copy(rtLookUniforms.uSunDirView.value);
    }
  }

  /** PH-03 cached white-balance matrix for the current photographic preset. */
  private get wbMatrix(): number[] {
    return whiteBalanceMatrix(this.photoPreset.kelvin, this.photoPreset.tint);
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
      this.markShadowDirty();
    }
    this.configurePostPipeline();
    this.requestRender();
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
    // OPT-12: rain is 100% vertex-shader driven — the old loop advanced ~1800
    // particles on the CPU and re-uploaded the whole position buffer every frame.
    // y = mod(baseY - uRainTime * 13.5, 13.5) reproduces the fall + wrap exactly;
    // z rides the same cycle with the same 2.6 m slant per fall.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRainTime = this.rainTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uRainTime;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float rainY = mod(transformed.y - uRainTime * 13.5, 13.5);
transformed.z += 2.6 * (13.5 - rainY) / 13.5;
transformed.y = rainY;`,
        );
    };
    mat.customProgramCacheKey = () => "rain-gpu-v1";
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  public cancelActivePreview(): void {
    if (this.previewRafId !== null) {
      cancelAnimationFrame(this.previewRafId);
      this.previewRafId = null;
    }
    this.pendingPreviewEvent = null;
    this.pendingPreviewHits = undefined;
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
    this.mobileGhostDragging = false;
    this.stagedClientPos = null;
    this.cameraCtrl.setCameraLocked(false);
    this.brushStrokeCells.clear();
    this.terrainScratch = null;
    if (this.liveTerrainTempMesh) {
      this.overlayGroup.remove(this.liveTerrainTempMesh);
      disposeGeometry(this.liveTerrainTempMesh.geometry);
      this.liveTerrainTempMesh = null;
    }
    this.clearPreviewMeshes();
    this.actions.onPreviewHud(null);
    this.requestRender();
  }

  private clearPreviewMeshes(): void {
    this.hoverHighlightMesh.visible = false;
    this.floorPreviewPool.visible = false;
    // OPT-11: pooled unit primitives hide, never dispose.
    this.previewUnitBox.visible = false;
    this.previewUnitCone.visible = false;
    this.previewUnitRing.visible = false;
    for (const c of [...this.previewGroup.children]) {
      this.previewGroup.remove(c);
      if (c.userData?.isCachedGhost || c.userData?.isPooledPreview) continue;
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) disposeGeometry(c.geometry);
    }
  }

  private scheduleToolPreview(e: PointerCoords, precomputedHits?: THREE.Intersection[]): void {
    this.pendingPreviewEvent = e;
    this.pendingPreviewHits = precomputedHits;
    if (this.previewRafId !== null) return;
    this.previewRafId = requestAnimationFrame(() => {
      this.previewRafId = null;
      if (this.disposed || !this.pendingPreviewEvent) return;
      const ev = this.pendingPreviewEvent;
      const hits = this.pendingPreviewHits;
      this.pendingPreviewEvent = null;
      this.pendingPreviewHits = undefined;
      this.updateToolPreview(ev, hits);
      this.requestRender();
    });
  }

  private getDefaultMobileStageClientPos(): PointerCoords {
    const rect = this.getCanvasRect();
    if (this.stagedClientPos) {
      return {
        clientX: this.stagedClientPos.x,
        clientY: this.stagedClientPos.y,
        altKey: Boolean(this.viewOpts.freePlacementEnabled),
        shiftKey: Boolean(this.viewOpts.multiPlaceEnabled),
      };
    }
    const tgt = this.cameraCtrl.getCurrentTarget();
    this._v1.set(tgt.x, this.getActiveFloorY(), tgt.z).project(this.cameraCtrl.activeCamera);
    const clientX = rect.left + (this._v1.x * 0.5 + 0.5) * rect.width;
    const clientY = rect.top + (-this._v1.y * 0.5 + 0.5) * rect.height;
    return {
      clientX: THREE.MathUtils.clamp(clientX, rect.left + 24, rect.right - 24),
      clientY: THREE.MathUtils.clamp(clientY, rect.top + 24, rect.bottom - 24),
      altKey: Boolean(this.viewOpts.freePlacementEnabled),
      shiftKey: Boolean(this.viewOpts.multiPlaceEnabled),
    };
  }

  private syncLastWorldPosFromClient(clientX: number, clientY: number): void {
    if (!this.derived) return;
    const rect = this.getCanvasRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.activeCamera);
    const hit = this.raycaster.ray.intersectPlane(this.activeFloorPlane, this.hitPoint);
    if (!hit) return;
    const fineCs = 0.25;
    const fineCols = Math.round(this.derived.project.site.width / fineCs);
    const fineRows = Math.round(this.derived.project.site.depth / fineCs);
    const fineGx = Math.floor(hit.x / fineCs);
    const fineGz = Math.floor(hit.z / fineCs);
    const inBounds = fineGx >= 0 && fineGx < fineCols && fineGz >= 0 && fineGz < fineRows;
    this.lastWorldPos = { x: hit.x, z: hit.z, inBounds };
  }

  public startMobilePlacement(): void {
    if (!this.derived || !POINT_PLACEMENT_TOOLS.has(this.viewOpts.activeTool)) return;
    this.stagedClientPos = null;
    const pos = this.getDefaultMobileStageClientPos();
    this.stagedClientPos = { x: pos.clientX, y: pos.clientY };
    this.syncLastWorldPosFromClient(pos.clientX, pos.clientY);
    this.updateToolPreview(pos);
    this.requestRender();
  }

  public refreshMobilePlacement(): void {
    if (!this.derived || !this.viewOpts.mobilePlacementActive || !POINT_PLACEMENT_TOOLS.has(this.viewOpts.activeTool)) return;
    const pos = this.getDefaultMobileStageClientPos();
    this.stagedClientPos = { x: pos.clientX, y: pos.clientY };
    this.syncLastWorldPosFromClient(pos.clientX, pos.clientY);
    this.updateToolPreview(pos);
    this.requestRender();
  }

  public confirmMobilePlacement(): boolean {
    if (!this.derived || !POINT_PLACEMENT_TOOLS.has(this.viewOpts.activeTool)) return false;
    const pos = this.getDefaultMobileStageClientPos();
    this.syncLastWorldPosFromClient(pos.clientX, pos.clientY);
    const placed = this.commitPointPlacement(pos, Boolean(this.viewOpts.multiPlaceEnabled));
    if (placed && this.viewOpts.multiPlaceEnabled) {
      const rect = this.getCanvasRect();
      const nextX = Math.min(rect.right - 28, pos.clientX + 26);
      const nextPos: PointerCoords = { ...pos, clientX: nextX };
      this.stagedClientPos = { x: nextX, y: pos.clientY };
      this.syncLastWorldPosFromClient(nextX, pos.clientY);
      this.updateToolPreview(nextPos);
      this.requestRender();
    }
    return placed;
  }

  public setSelected(selected: SelectionTarget): void {
    this.selected = selected;
    if (this.derived) {
      this.updateSelectionRing(this.derived, selected);
    }
    this.requestRender();
  }

  public rotateActiveDrag(deltaStep: -1 | 1): boolean {
    if (!this.draggingEntity || !this.dragPendingCommit || !this.draggingMesh) return false;
    const stepRad = (deltaStep > 0 ? 1 : -1) * (Math.PI / 4);
    const nextRot = (this.dragPendingCommit.rotationY ?? this.dragPendingCommit.origMeshRotY) + stepRad;
    this.dragPendingCommit.rotationY = nextRot;
    this.draggingMesh.rotation.y = nextRot;
    this.markShadowDirty();
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
    // OPT-08: `showLabels`/`showDims` toggle group visibility — never a house rebuild.
    this.updateLabelsDimsVisibility();

    const { project } = derived;
    const sim = project.simulation;
    this.lastRainMmH = sim.rainIntensityMmH;

    // Sync Structural & Terrain viewport flags
    const wasExploded = this.explodeTarget > 0.05;
    const prevCutActive = this.clipPlane.constant < 10;
    const showTerrain = this.studioView?.showTerrain ?? true;
    let envVisChanged = false;
    for (const ch of this.envGroup.children) {
      if (ch.userData?.isTerrain && ch.visible !== showTerrain) {
        ch.visible = showTerrain;
        envVisChanged = true;
      }
    }
    const nextNeighborsVis = this.viewOpts.neighborsVisible && (this.studioView?.showNeighbors ?? true);
    if (this.neighborsGroup.visible !== nextNeighborsVis) {
      this.neighborsGroup.visible = nextNeighborsVis;
      envVisChanged = true;
    }
    this.cameraCtrl.setAllowUnderground(!showTerrain);
    this.cameraCtrl.setOrtho(this.studioView?.ortho ?? false);
    this.explodeTarget = this.studioView?.explode ?? 0;
    const nextCutH = this.studioView?.cutH ?? 100;
    const cutChanged = Math.abs(this.clipPlane.constant - nextCutH) > 1e-4;
    this.clipPlane.constant = nextCutH;
    // OPT-02: per-material clipping runs only while a real section cut is active —
    // `discard` in the fragment shader otherwise disables hardware Early-Z for
    // every opaque house pixel (~95% of the session).
    this.renderer.localClippingEnabled = nextCutH < 11.9;
    if (wasExploded !== (this.explodeTarget > 0.05)) {
      this.applyLevelAndWallVisibility();
    } else if (prevCutActive !== (nextCutH < 10)) {
      this.updateWallCutawayVisibility(true);
    }
    if (envVisChanged || cutChanged) {
      this.markShadowDirty();
    }

    // Sync PBR materials cleanly to Project Settings
    this.palette.plasterExt.color.set(sim.paintExtHex);
    this.palette.plasterInt.color.set(sim.paintIntHex);
    this.palette.roofCover.color.set(sim.roofColorHex);
    this.palette.setTileSize(project.systems.tileSizeCm);

    // Sky gradient updates continuously per time/season/rain, while PMREM env map caches 3 discrete states (day/night/storm)
    const isNight = sim.hourOfDay < 5.5 || sim.hourOfDay > 18.5;
    const isStorm = sim.rainIntensityMmH > 20;
    const nextSkyKey = `${Math.round(sim.hourOfDay * 4)}|${sim.season}|${Math.round(sim.rainIntensityMmH / 5)}`;
    if (nextSkyKey !== this.skyKey) {
      this.skyKey = nextSkyKey;
      const newSky = createSkyGradientTexture(sim.hourOfDay, sim.season, sim.rainIntensityMmH);
      this.skyMat.map?.dispose();
      this.skyMat.map = newSky;
      this.skyMat.needsUpdate = true;
    }

    const nextEnvState: "day" | "night" | "storm" = isStorm ? "storm" : isNight ? "night" : "day";
    if (nextEnvState !== this.envStateKey) {
      this.envStateKey = nextEnvState;
      let env = this.pmremCache.get(nextEnvState);
      if (!env) {
        const repHour = nextEnvState === "night" ? 22 : 10;
        const repRain = nextEnvState === "storm" ? 45 : 0;
        env = createEnvironmentMap(this.renderer, repHour, repRain);
        this.pmremCache.set(nextEnvState, env);
      }
      this.envTex = env;
      this.scene.environment = env;
      this.scene.environmentIntensity = isNight ? 0.35 : isStorm ? 0.82 : 0.62;
      this.palette.bindEnvMap(env);
    }

    const nextEnvKey = `${sim.hourOfDay.toFixed(2)}|${sim.season}|${Math.round(sim.rainIntensityMmH / 5)}|${project.site.orientationDeg}`;
    if (nextEnvKey !== this.envKey) {
      this.envKey = nextEnvKey;

      // PH-01/PH-03/GR-06: resolve the photographic calibration for this hour and
      // push it into the shared uniforms + bloom + aerial colors (0 GPU cost).
      this.photoPreset = resolvePhotographicPreset(sim.hourOfDay, sim.rainIntensityMmH);
      rtLookUniforms.uRtGiStrength.value = this.rayTracingEnabled ? this.photoPreset.giBounce : 0;
      this.bloomPass?.setThreshold(this.photoPreset.bloomThreshold);
      {
        const isNightP = sim.hourOfDay < 5.5 || sim.hourOfDay > 18.5;
        const isGoldenP = (sim.hourOfDay >= 16.5 && sim.hourOfDay <= 18.8) || (sim.hourOfDay >= 5.2 && sim.hourOfDay <= 7.5);
        rtLookUniforms.uAerialWarm.value.setRGB(
          isNightP ? 0.3 : isGoldenP ? 1.0 : 0.92,
          isNightP ? 0.36 : isGoldenP ? 0.8 : 0.87,
          isNightP ? 0.52 : isGoldenP ? 0.55 : 0.72,
        );
        rtLookUniforms.uAerialCool.value.setRGB(
          isNightP ? 0.18 : 0.66,
          isNightP ? 0.25 : 0.76,
          isNightP ? 0.4 : 0.88,
        );
        rtLookUniforms.uSunTint.value.setRGB(
          isNightP ? 0.18 : isGoldenP ? 1.0 : 0.99,
          isNightP ? 0.22 : isGoldenP ? 0.83 : 0.95,
          isNightP ? 0.34 : isGoldenP ? 0.6 : 0.87,
        );
      }
      // GR-02: reflection probes re-capture on sun-hour change (event-driven).
      if (this.rayTracingEnabled && this.probeRig?.hasBaked) {
        this.bakeReflectionProbes();
      }

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
      this.fillLightBase = isNight ? 0.14 : isStorm ? 0.35 : 0.4;
      this.fillLight.intensity = this.fillLightBase;
      this.fillLight.color.setHex(0xb2cff0);
      this.fillLightTinted = false;
      this.sunLight.intensity = isNight ? 0.18 : isStorm ? 0.95 : 2.4;
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
      // PH-05: preset character rides on top (pagi lembut, golden sinematik).
      this.godRayStrength *= this.photoPreset.godRayBoost;

      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set(isNight ? 0x0e1628 : isStorm ? 0x647280 : 0xd9e8f4);
        this.scene.fog.density = isStorm ? 0.011 : isNight ? 0.0052 : 0.0046;
        this.scene.fog.density *= this.photoPreset.aerialDensity;
      }
      this.markShadowDirty();
    }

    if (this.rainPoints) {
      // OPT-12: GPU rain hides entirely under prefers-reduced-motion (the CPU loop
      // used to freeze the particles in place instead).
      this.rainPoints.visible = Boolean(this.studioView?.showRain) && sim.rainIntensityMmH > 0 && !this.reducedMotion;
      const density = Math.min(1, sim.rainIntensityMmH / 120);
      this.rainActiveCount = Math.round(1800 * density);
      this.rainPoints.geometry.setDrawRange(0, this.rainActiveCount);
    }

    const previewRoofType =
      this.viewOpts.pendingRoofType && this.viewOpts.pendingRoofType !== project.systems.roofType
        ? this.viewOpts.pendingRoofType
        : null;

    const svStage = this.studioView?.stage ?? 0;
    const svBricks = this.studioView?.showBricks ?? true;
    const svStruct = this.studioView?.showStructure ?? true;
    const svTerrain = this.studioView?.showTerrain ?? true;
    const svRoof = this.studioView?.showRoof ?? true;
    const svRangka = this.studioView?.showRangka ?? true;
    const svFinish = this.studioView?.showFinishing ?? true;
    const svXray = this.studioView?.xrayRebar ?? false;
    const svAir = this.studioView?.showAir ?? false;
    const svListrik = this.studioView?.showListrik ?? false;
    const svHidden = this.studioView?.hiddenParts ?? [];

    const pb = this.prevBuildRefs;
    const levelsChanged =
      !pb ||
      pb.levelsMeta.length !== project.levels.length ||
      project.levels.some((l, i) => {
        const prevL = pb.levelsMeta[i]!;
        return (
          prevL.id !== l.id ||
          prevL.index !== l.index ||
          prevL.name !== l.name ||
          prevL.height !== l.height ||
          prevL.walls !== l.walls ||
          prevL.rooms !== l.rooms ||
          prevL.slabs !== l.slabs ||
          prevL.stairs !== l.stairs
        );
      });
    const hiddenChanged =
      !pb ||
      pb.hiddenParts.length !== svHidden.length ||
      svHidden.some((h, i) => pb.hiddenParts[i] !== h);
    const buildChanged =
      !pb ||
      pb.systems !== project.systems ||
      pb.peil !== project.site.peil ||
      pb.structuralParams !== project.structuralParams ||
      pb.soil !== project.site.soil ||
      pb.floodMitigation !== project.floodMitigation ||
      pb.buildExtras !== project.buildExtras ||
      levelsChanged ||
      pb.showBricksOverlay !== this.viewOpts.showBricksOverlay ||
      pb.previewRoofType !== previewRoofType ||
      pb.stage !== svStage ||
      pb.showBricks !== svBricks ||
      pb.showStructure !== svStruct ||
      pb.showTerrain !== svTerrain ||
      pb.showRoof !== svRoof ||
      pb.showRangka !== svRangka ||
      pb.showFinishing !== svFinish ||
      pb.xrayRebar !== svXray ||
      pb.showAir !== svAir ||
      pb.showListrik !== svListrik ||
      hiddenChanged;

    if (buildChanged) {
      this.prevBuildRefs = Object.assign(
        {
          systems: project.systems,
          peil: project.site.peil,
          structuralParams: project.structuralParams,
          soil: project.site.soil,
          floodMitigation: project.floodMitigation,
          buildExtras: project.buildExtras,
          levelsMeta: project.levels.map((l) => ({
            id: l.id,
            index: l.index,
            name: l.name,
            height: l.height,
            walls: l.walls,
            rooms: l.rooms,
            slabs: l.slabs,
            stairs: l.stairs,
          })),
          showBricksOverlay: this.viewOpts.showBricksOverlay,
          previewRoofType,
          stage: svStage,
          showBricks: svBricks,
          showStructure: svStruct,
          showTerrain: svTerrain,
          showRoof: svRoof,
          showRangka: svRangka,
          showFinishing: svFinish,
          xrayRebar: svXray,
          showAir: svAir,
          showListrik: svListrik,
          hiddenParts: svHidden,
        },
      );
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
      this.lastWireframe = null;
    }

    const pp = this.prevPropsRefs;
    const propsChanged =
      !pp ||
      pp.peil !== project.site.peil ||
      pp.stage !== svStage ||
      pp.levels.length !== project.levels.length ||
      project.levels.some((l, i) => {
        const pl = pp.levels[i]!;
        return (
          pl.index !== l.index ||
          pl.height !== l.height ||
          pl.furniture !== l.furniture ||
          pl.lights !== l.lights ||
          pl.hvac !== l.hvac
        );
      });
    if (propsChanged) {
      this.prevPropsRefs = {
        peil: project.site.peil,
        stage: svStage,
        levels: project.levels.map((l) => ({
          index: l.index,
          height: l.height,
          furniture: l.furniture,
          lights: l.lights,
          hvac: l.hvac,
        })),
      };
      this.syncPropsIncremental(derived);
      this.lastWireframe = null;
    }

    const ps = this.prevSimRefs;
    const simLux = Boolean(this.studioView?.showLuxHeatmap);
    const simAir = Boolean(this.studioView?.showAirParticles);
    const simFlood = Boolean(this.studioView?.showFloodWater);
    const simHr = Math.round(sim.hourOfDay * 4);
    const simRn = Math.round(sim.rainIntensityMmH);
    const simWs = Math.round(sim.windSpeedMs * 10);
    const simWd = Math.round(sim.windDirectionDeg);
    const simAt = Math.round(sim.ambientTempC * 2);
    const simChanged =
      !ps ||
      ps.activeLevel !== this.viewOpts.activeLevel ||
      ps.showLuxHeatmap !== simLux ||
      ps.showAirParticles !== simAir ||
      ps.showFloodWater !== simFlood ||
      ps.flood !== this.flood ||
      ps.doorFloodBarrier !== project.floodMitigation.doorFloodBarrier ||
      ps.barrierHeightCm !== project.floodMitigation.barrierHeightCm ||
      ps.hr !== simHr ||
      ps.rn !== simRn ||
      ps.ws !== simWs ||
      ps.wd !== simWd ||
      ps.at !== simAt ||
      ps.lights.length !== project.levels.length ||
      project.levels.some((l, i) => ps.lights[i] !== l.lights || ps.hvac[i] !== l.hvac);
    if (simChanged) {
      this.prevSimRefs = {
        activeLevel: this.viewOpts.activeLevel,
        showLuxHeatmap: simLux,
        showAirParticles: simAir,
        showFloodWater: simFlood,
        flood: this.flood,
        doorFloodBarrier: project.floodMitigation.doorFloodBarrier,
        barrierHeightCm: project.floodMitigation.barrierHeightCm,
        hr: simHr,
        rn: simRn,
        ws: simWs,
        wd: simWd,
        at: simAt,
        lights: project.levels.map((l) => l.lights),
        hvac: project.levels.map((l) => l.hvac),
      };
      this.rebuildSimOverlays();
    }

    const wf = this.studioView?.wireframe ?? false;
    if (wf !== this.lastWireframe) {
      this.lastWireframe = wf;
      this.applyWireframe(wf);
    }
    this.updateSelectionRing(derived, selected);
    this.requestRender();
  }

  public setViewOptions(opts: BuildViewOptions): void {
    const levelChanged = this.viewOpts.activeLevel !== opts.activeLevel;
    const bricksChanged = this.viewOpts.showBricksOverlay !== opts.showBricksOverlay;
    const roofPreviewChanged = (this.viewOpts.pendingRoofType ?? null) !== (opts.pendingRoofType ?? null);
    const toolChanged =
      this.viewOpts.activeTool !== opts.activeTool ||
      this.viewOpts.selectedCatalogId !== opts.selectedCatalogId ||
      (this.viewOpts.selectedSwatchHex ?? null) !== (opts.selectedSwatchHex ?? null);
    const placementVisualChanged =
      this.viewOpts.placementRotationStep !== opts.placementRotationStep ||
      this.viewOpts.placementFlipSwing !== opts.placementFlipSwing ||
      Boolean(this.viewOpts.freePlacementEnabled) !== Boolean(opts.freePlacementEnabled);

    this.viewOpts = opts;
    this.neighborsGroup.visible = opts.neighborsVisible && (this.studioView?.showNeighbors ?? true);
    if (this.gridMesh) this.gridMesh.visible = opts.gridVisible;
    this.cameraCtrl.setSnap90Enabled(opts.snap90Enabled);
    this.cameraCtrl.setEdgeScrollEnabled(opts.edgeScrollEnabled);

    if (toolChanged) {
      this.cancelActivePreview();
      if (this.derived) this.updateSelectionRing(this.derived, this.selected);
      if (opts.mobilePlacementActive && POINT_PLACEMENT_TOOLS.has(opts.activeTool)) {
        queueMicrotask(() => {
          if (!this.disposed) this.startMobilePlacement();
        });
      }
    } else if (placementVisualChanged && opts.mobilePlacementActive && POINT_PLACEMENT_TOOLS.has(opts.activeTool)) {
      queueMicrotask(() => {
        if (!this.disposed) this.refreshMobilePlacement();
      });
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
      this.prevBuildRefs = null;
    }

    if (levelChanged) {
      const y = this.getActiveFloorY();
      this.cameraCtrl.setTargetElevation(y);
      this.activeFloorPlane.constant = -y;
      this.rebuildGridOverlay();
      this.rebuildSimOverlays();
    }
    this.applyLevelAndWallVisibility();
    this.requestRender();
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

  /** OPT-08 visibility-only fast path for `showLabels` / `showDims`: O(1) group
   * flips (LT2 labels follow the same level gating as the house level roots). */
  private updateLabelsDimsVisibility(): void {
    const sv = this.studioView;
    const showLabels = sv?.showLabels ?? false;
    const showDims = sv?.showDims ?? false;
    const lv = this.explodeTarget > 0.05 ? 2 : this.viewOpts.activeLevel;
    const labelsChanged = this.labelsGroup.visible !== showLabels || this.dimsGroup.visible !== showDims;
    this.labelsGroup.visible = showLabels;
    this.labelsLt1Group.visible = true;
    this.labelsLt2Group.visible = lv >= 1;
    this.dimsGroup.visible = showDims;
    if (labelsChanged && !this.disposed) this.requestRender();
  }

  private rebuildFromProject(derived: DerivedProjectModel, struct: StructuralReport): void {
    this.houseContainer.clear();
    this.dimsGroup.clear();
    this.labelsLt1Group.clear();
    this.labelsLt2Group.clear();
    for (const batch of this.brickBatches) {
      batch.im.dispose();
    }
    for (const r of this.dynResources) disposeResource(r);
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
      disposeGeometry(this.liveTerrainTempMesh.geometry);
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
    this.housePickables = built.pickables;
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
    this.lastCutVis = "";
    this.lastCutLevel = -1;
    this.lastCutExploded = -1;
    this.lastCutBrickMeshes = -1;
    this.lastCutActive = -1;
    this.lastCutTx = Number.NaN;
    this.lastCutTz = Number.NaN;

    const { project, roof } = derived;
    const lt1Y = project.site.peil.floor1PeilM;
    const lt2Y = lt1Y + (project.levels[0]?.height ?? 3.6);
    // OPT-08: labels & dims are ALWAYS built — the `showLabels`/`showDims` toggles
    // now flip group visibility in O(1) (updateLabelsDimsVisibility) instead of
    // triggering a full 40–150 ms house rebuild + BVH + Baked AO regeneration.
    for (const fl of derived.floors) {
      const ly = fl.levelIndex === 0 ? lt1Y + 1.4 : lt2Y + 1.4;
      for (const r of fl.rooms) {
        const sp = this.makeLabelSprite(r.room.name, `${r.netAreaM2.toFixed(1)} m²`);
        sp.position.set(r.centroid.x, ly, r.centroid.z);
        (fl.levelIndex === 0 ? this.labelsLt1Group : this.labelsLt2Group).add(sp);
      }
    }
    this.build3dDimensions(project.site.width, project.site.depth, roof.ridgeElevationM + lt1Y);
    this.updateLabelsDimsVisibility();

    this.applyExplode(this.explodeCurrent);
    this.cameraCtrl.setBounds({
      minX: -4.5,
      maxX: derived.project.site.width + 4.5,
      minZ: -5.5,
      maxZ: derived.project.site.depth + 5.5,
    });
    this.rebuildGridOverlay();
    this.applyLevelAndWallVisibility();
    // GR-02: fresh meshes carry cloned materials — re-point BPCEM env-maps at the
    // probes (or the flat PMREM env while RT is off) and re-capture so the
    // reflection content matches the new build.
    if (this.probeRig) {
      if (this.rayTracingEnabled && this.hasRenderedOnce) {
        this.bakeReflectionProbes();
      } else {
        this.probeRig.bindEnvMaps(this.houseContainer, false, this.envTex);
        this.probeRig.bindEnvMaps(this.propsContainer, false, this.envTex);
      }
    }
    this.markShadowDirty();
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
      p.obj.updateMatrix();
    }
    // OPT-12: explode only translates instances — write the X/Y/Z elements of each
    // column-major matrix directly instead of Quaternion+Matrix4.compose per instance
    // (~6x faster on the ~15k brick instances during the explode animation).
    for (const im of this.explodeInstanced) {
      const arr = im.im.instanceMatrix.array as Float32Array;
      for (let i = 0; i < im.n; i++) {
        const mi = i * 16;
        arr[mi + 12] = im.pos[i * 3]! + im.off[i * 3]! * e;
        arr[mi + 13] = im.pos[i * 3 + 1]! + im.off[i * 3 + 1]! * e;
        arr[mi + 14] = im.pos[i * 3 + 2]! + im.off[i * 3 + 2]! * e;
      }
      im.im.instanceMatrix.needsUpdate = true;
    }
    this.markShadowDirty();
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
    this.lightPoolLevelRoots[0].position.y = lt1Y;
    this.lightPoolLevelRoots[1].position.y = lt2Y;

    const stage = this.studioView?.stage ?? 0;
    const showProps = stage === 0 || stage >= 9;
    this.propsContainer.visible = showProps;

    const desiredKeys = new Set<string>();
    let propsMutated = false;

    const disposePropKey = (key: string) => {
      const existing = this.propEntries.get(key);
      if (!existing) return;
      this.propLevelRoots[existing.lvIdx].remove(existing.root);
      for (const r of existing.resources) disposeResource(r);
      this.propEntries.delete(key);
      propsMutated = true;
    };

    const decalSpecsByLevel: [ContactDecalSpec[], ContactDecalSpec[]] = [[], []];

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
          if (prev && prev.sig === sig) {
            decalSpecsByLevel[lvIdx].push({
              id: f.id,
              x: prev.root.position.x,
              y: prev.root.position.y,
              z: prev.root.position.z,
              w: f.catalogId === "motorbike" ? 0.65 : f.size.x,
              d: f.size.z,
              rotY: f.rotationY,
            });
            continue;
          }
          if (prev) disposePropKey(key);
          const res: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
          const root = buildProjectFurnitureObject(f, lvIdx, peil, this.palette, res);
          targetGroup.add(root);
          this.propEntries.set(key, { sig, lvIdx, root, resources: res, fanBlades: [] });
          propsMutated = true;
          decalSpecsByLevel[lvIdx].push({
            id: f.id,
            x: root.position.x,
            y: root.position.y,
            z: root.position.z,
            w: f.catalogId === "motorbike" ? 0.65 : f.size.x,
            d: f.size.z,
            rotY: f.rotationY,
          });
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
          propsMutated = true;
        }

        for (const l of lv.lights) {
          const key = `light:${lvIdx}:${l.id}`;
          desiredKeys.add(key);
          const sig = `${l.type}|${l.name}|${l.on}|${l.lumens}|${l.colorTempK}|${l.dimmer}|${lv.height.toFixed(2)}|${l.position.x.toFixed(3)},${l.position.y.toFixed(3)},${l.position.z.toFixed(3)}|${(l.rotationY ?? 0).toFixed(4)}`;
          const prev = this.propEntries.get(key);
          if (prev && prev.sig === sig) continue;
          if (prev) disposePropKey(key);
          const res: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
          const root = buildProjectLightObject(l, lvIdx, lv.height, this.palette, res, false);
          targetGroup.add(root);
          this.propEntries.set(key, { sig, lvIdx, root, resources: res, fanBlades: [] });
          propsMutated = true;
        }
      }
    }

    this.updateLightPool(derived);

    for (const key of [...this.propEntries.keys()]) {
      if (!desiredKeys.has(key)) disposePropKey(key);
    }

    // Layer 3 Baked AO: Rebuild 1 instanced contact AO decal mesh per level when props changed
    if (propsMutated || !this.contactDecalMeshes[0] && decalSpecsByLevel[0].length > 0) {
      this.contactDecalIndexMap.clear();
      for (const lvIdx of [0, 1] as const) {
        const old = this.contactDecalMeshes[lvIdx];
        if (old) {
          this.propLevelRoots[lvIdx].remove(old);
          old.dispose();
          this.contactDecalMeshes[lvIdx] = null;
        }
        for (const g of this.contactDecalResources[lvIdx]) disposeGeometry(g);
        this.contactDecalResources[lvIdx] = [];

        const specs = decalSpecsByLevel[lvIdx];
        const im = buildInstancedContactDecals(specs, this.contactShadowMat, this.contactDecalResources[lvIdx]);
        if (im) {
          this.propLevelRoots[lvIdx].add(im);
          this.contactDecalMeshes[lvIdx] = im;
          specs.forEach((sp, idx) => {
            const ent = this.propEntries.get(`furn:${lvIdx}:${sp.id}`);
            const fItem = project.levels[lvIdx]?.furniture.find((x) => x.id === sp.id);
            const yRenderOffset = ent && fItem ? ent.root.position.y - fItem.position.y : 0;
            this.contactDecalIndexMap.set(sp.id, { lvIdx, index: idx, w: sp.w, d: sp.d, yRenderOffset });
          });
        }
      }
      this.markShadowDirty();
    }

    this.rebuildAnimatedFanList();
    this.applyLevelAndWallVisibility();
    // OPT-02/OPT-05: once the full house exists, pre-compile both macro shader
    // variants (clipped/lit and unclipped/day) so later toggles never hitch.
    this.prewarmShaderVariants();
  }

  private updateLightPool(derived: DerivedProjectModel): void {
    const stage = this.studioView?.stage ?? 0;
    const enabled = stage === 0 || stage >= 9;
    for (const lvIdx of [0, 1] as const) {
      const lv = derived.project.levels[lvIdx];
      const spots = this.spotLightPools[lvIdx];
      const points = this.pointLightPools[lvIdx];
      let spotIdx = 0;
      let pointIdx = 0;

      if (enabled && lv) {
        const activeLights = lv.lights.filter((x) => x.on && x.dimmer > 0).slice(-7);
        for (const l of activeLights) {
          const lightHex = l.colorTempK <= 3200 ? 0xffcb85 : 0xfff3de;
          const clampedY = Math.min(lv.height - 0.25, Math.max(0.25, l.position.y));
          if (l.type === "garden") {
            const pt = points[pointIdx++];
            if (!pt) continue;
            pt.color.setHex(lightHex);
            pt.intensity = (l.lumens / 600) * l.dimmer * 1.0;
            pt.position.set(l.position.x, clampedY, l.position.z);
          } else {
            const spot = spots[spotIdx++];
            if (!spot) continue;
            const halfAngle = Math.min(Math.PI * 0.42, Math.max(0.35, ((l.beamAngleDeg * 0.5) * Math.PI) / 180));
            const rotY = l.rotationY ?? 0;
            const fwdOff = l.type === "wall" ? 1.15 : 0;
            spot.color.setHex(lightHex);
            spot.intensity = (l.lumens / 650) * l.dimmer * 1.15;
            spot.distance = Math.min(4.4, lv.height + 0.6);
            spot.angle = halfAngle;
            spot.position.set(
              l.position.x + Math.sin(rotY) * (l.type === "wall" ? 0.24 : 0),
              clampedY - 0.04,
              l.position.z + Math.cos(rotY) * (l.type === "wall" ? 0.24 : 0),
            );
            spot.target.position.set(
              l.position.x + Math.sin(rotY) * fwdOff,
              0,
              l.position.z + Math.cos(rotY) * fwdOff,
            );
            spot.target.updateMatrixWorld();
          }
        }
      }

      // OPT-05: unused slots park at `intensity = 0` but keep `visible` managed by
      // the single Day/Lit macro below — per-slot visible toggling changed
      // NUM_SPOT_LIGHTS/NUM_POINT_LIGHTS and recompiled every shader on each toggle.
      for (let i = spotIdx; i < spots.length; i++) spots[i]!.intensity = 0;
      for (let i = pointIdx; i < points.length; i++) points[i]!.intensity = 0;
    }

    // OPT-05 macro states: Day (all pool lights hidden — zero BRDF iterations while
    // the house is unlit) vs Lit (fixed pool visible — NUM_* constants, no recompile).
    // Both variants are pre-compiled by prewarmShaderVariants(), so the transition
    // only swaps an already-cached program.
    const anyActive =
      enabled && derived.project.levels.some((lv) => lv?.lights.some((l) => l.on && l.dimmer > 0));
    if (anyActive !== this.poolLitState) {
      this.poolLitState = anyActive;
      for (const lvIdx of [0, 1] as const) {
        for (const s of this.spotLightPools[lvIdx]) s.visible = anyActive;
        for (const p of this.pointLightPools[lvIdx]) p.visible = anyActive;
      }
    }
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
      disposeGeometry(this.gridMesh.geometry);
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
    // OPT-08: keep always-built labels in sync with level/explode visibility too.
    this.updateLabelsDimsVisibility();
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
    this.lightPoolLevelRoots[0].visible = true;
    this.lightPoolLevelRoots[1].visible = lv >= 1;
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
    const cutActive = this.clipPlane.constant < 10;
    const showBricksOverlay = this.viewOpts.showBricksOverlay;
    const showFinishing = showBricksOverlay ? false : (this.studioView?.showFinishing ?? true);
    const showBrickMeshes = exploded || showBricksOverlay || !showFinishing || cutActive;
    // OPT-12: primitive-field gating — the old 7-segment template string allocated
    // a fresh key on EVERY orbit frame just to early-out of this function.
    const cutVis = this.viewOpts.wallVisibility;
    const cutLevel = this.viewOpts.activeLevel;
    const explodedI = exploded ? 1 : 0;
    const brickMeshesI = showBrickMeshes ? 1 : 0;
    const cutActiveI = cutActive ? 1 : 0;
    const tx = Math.round(tgt.x * 10);
    const tz = Math.round(tgt.z * 10);
    if (
      !force &&
      cutVis === this.lastCutVis &&
      cutLevel === this.lastCutLevel &&
      explodedI === this.lastCutExploded &&
      brickMeshesI === this.lastCutBrickMeshes &&
      cutActiveI === this.lastCutActive &&
      tx === this.lastCutTx &&
      tz === this.lastCutTz &&
      Math.abs(viewAngle - this.lastCutawayYaw) < 0.04
    ) {
      return;
    }
    this.lastCutawayYaw = viewAngle;
    this.lastCutVis = cutVis;
    this.lastCutLevel = cutLevel;
    this.lastCutExploded = explodedI;
    this.lastCutBrickMeshes = brickMeshesI;
    this.lastCutActive = cutActiveI;
    this.lastCutTx = tx;
    this.lastCutTz = tz;

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
      if (!showBrickMeshes) continue;
      if (!exploded) {
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
    this.markShadowDirty();
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
          disposeGeometry(this.roomOutlineLoop.geometry);
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
    this.airParticlesMesh?.dispose();
    this.airParticlesMesh = null;
    this.airParticleStates = [];
    for (const r of this.simResources) disposeResource(r);
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

  private getCanvasRect(): DOMRect {
    if (!this.canvasRect || this.canvasRect.width <= 0 || this.canvasRect.height <= 0) {
      this.canvasRect = this.canvas.getBoundingClientRect();
    }
    return this.canvasRect;
  }

  private collectRayHits(e: PointerCoords): THREE.Intersection[] {
    const rect = this.getCanvasRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.activeCamera);

    const targets = this._pickTargets;
    targets.length = 0;
    if (this.propsContainer.visible) {
      if (this.propLevelRoots[0].visible) targets.push(this.propLevelRoots[0]);
      if (this.propLevelRoots[1].visible) targets.push(this.propLevelRoots[1]);
    }
    if (this.houseContainer.visible) {
      if (this.housePickables.length > 0) {
        for (const p of this.housePickables) targets.push(p);
      } else {
        targets.push(this.houseContainer);
      }
    }
    return targets.length > 0 ? this.raycaster.intersectObjects(targets, true) : [];
  }

  private raycastHit(
    e: PointerCoords,
    ignoreParts = true,
    precomputedHits?: THREE.Intersection[],
  ): {
    sel: NonNullable<SelectionTarget>;
    label: string;
    obj: THREE.Object3D;
    point: THREE.Vector3;
    faceNormalWorld?: THREE.Vector3;
  } | null {
    const hits = precomputedHits ?? this.collectRayHits(e);
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
        ? this._hitNormal.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize()
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
    e: PointerCoords,
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
    const altBypass = Boolean(e.altKey || this.altHeld || this.viewOpts.freePlacementEnabled);
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

    const rect = this.getCanvasRect();
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

  private updateToolPreview(e: PointerCoords, precomputedHits?: THREE.Intersection[]): void {
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
      // OPT-11: rescale the pooled unit box instead of allocating a BoxGeometry.
      const box = this.previewUnitBox;
      box.material = this.invalidMat;
      box.scale.set(wM, 0.25, dM);
      box.rotation.y = 0;
      box.position.set((minX + maxX) * 0.5, baseY + 0.14, (minZ + maxZ) * 0.5);
      box.visible = true;
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
      const hitRes = this.raycastHit(e, true, precomputedHits);
      if (tool === "wall_paint") {
        if (hitRes?.sel.kind === "wall") {
          const target = this.resolveWallPaintTarget(hitRes, Boolean(e.shiftKey));
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
        // OPT-11: pooled unit box — no per-move BoxGeometry allocation.
        const m = this.previewUnitBox;
        m.material = this.validMat;
        m.scale.set(len + 0.12, h, 0.14);
        m.position.set(this.dragStartVertex.gx * wallCs + dx * 0.5, baseY + h * 0.5, this.dragStartVertex.gz * wallCs + dz * 0.5);
        m.rotation.y = -Math.atan2(dz, dx);
        m.visible = true;
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
        // OPT-11: pooled unit box — no per-move BoxGeometry allocation.
        const m = this.previewUnitBox;
        m.material = valid ? this.validMat : this.invalidMat;
        m.scale.set(wM, 0.14, dM);
        m.rotation.y = 0;
        m.position.set((x1 + x2) * 0.5 * wallCs, baseY + 0.08, (z1 + z2) * 0.5 * wallCs);
        m.visible = true;
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
      const fillPooledPreview = (cells: Iterable<{ gx: number; gz: number }>) => {
        let count = 0;
        for (const c of cells) {
          if (count >= 500) break;
          this._m4.makeTranslation((c.gx + 0.5) * cs, baseY + 0.035, (c.gz + 0.5) * cs);
          this.floorPreviewPool.setMatrixAt(count++, this._m4);
        }
        if (count > 0) {
          this.floorPreviewPool.count = count;
          this.floorPreviewPool.instanceMatrix.needsUpdate = true;
          this.floorPreviewPool.visible = true;
          this.previewGroup.add(this.floorPreviewPool);
        }
      };

      if (this.viewOpts.floorBrushMode === "fill") {
        if (!this.lastWorldPos.inBounds) {
          this.actions.onPreviewHud({ label: "Di luar batas kavling", valid: false });
          return;
        }
        const cells = computeProjectRoomFloodCells(lv.walls, cols, rows, cs, gx, gz, blocked);
        fillPooledPreview(cells);
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
        // OPT-11: pooled unit box — no per-move BoxGeometry allocation.
        const m = this.previewUnitBox;
        m.material = this.validMat;
        m.scale.set(wM, 0.03, dM);
        m.rotation.y = 0;
        m.position.set((minX + maxX + 1) * 0.5 * cs, baseY + 0.035, (minZ + maxZ + 1) * 0.5 * cs);
        m.visible = true;
        this.previewGroup.add(m);
        this.actions.onPreviewHud({ label: `Lantai ${wM.toFixed(1)} × ${dM.toFixed(1)} m`, valid: true });
        return;
      }
      if (this.brushStrokeCells.size > 0) {
        fillPooledPreview(this.brushStrokeCells.values());
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
      // OPT-11: pooled unit box + swing-arrow cone (siblings; the cone composes
      // yaw*tilt through its YXZ euler and offsets into the box's rotated frame).
      const m = this.previewUnitBox;
      m.material = snap.valid ? this.validMat : this.invalidMat;
      m.scale.set(ow, oh, 0.22);
      m.rotation.y = snap.yaw;
      m.position.set(snap.worldX, baseY + sill + oh * 0.5, snap.worldZ);
      m.visible = true;
      const swingZ = swing >= 0 ? 0.28 : -0.28;
      const arrow = this.previewUnitCone;
      arrow.material = snap.valid ? this.validMat : this.invalidMat;
      arrow.scale.set(1, 1, 1);
      arrow.rotation.set(swing >= 0 ? Math.PI / 2 : -Math.PI / 2, snap.yaw, 0);
      arrow.position.set(
        snap.worldX + swingZ * Math.sin(snap.yaw),
        baseY + sill + oh * 0.5 - oh * 0.25,
        snap.worldZ + swingZ * Math.cos(snap.yaw),
      );
      arrow.visible = true;
      this.previewGroup.add(m, arrow);
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
      // OPT-11: pooled unit box — no per-move BoxGeometry allocation.
      const m = this.previewUnitBox;
      m.material = res.valid ? this.validMat : this.invalidMat;
      m.scale.set(fp.spanCols * cs, 1.4, fp.spanRows * cs);
      m.rotation.y = 0;
      m.position.set((gx + fp.spanCols * 0.5) * cs, baseY + 0.7, (gz + fp.spanRows * 0.5) * cs);
      m.visible = true;
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
      // OPT-11: pooled unit box — no per-move BoxGeometry allocation.
      const m = this.previewUnitBox;
      m.material = check.valid ? this.cyanMat : this.invalidMat;
      m.scale.set(wM, 0.22, dM);
      m.rotation.y = 0;
      m.position.set((minX + maxX + 1) * 0.5 * cs, baseY + 0.08, (minZ + maxZ + 1) * 0.5 * cs);
      m.visible = true;
      this.previewGroup.add(m);
      this.actions.onPreviewHud({
        label: check.valid ? `Kolam ${wM.toFixed(1)} × ${dM.toFixed(1)} m` : check.reason ?? "Kolam tidak valid",
        valid: check.valid,
      });
      return;
    }

    if (tool === "terrain" && this.lastWorldPos.inBounds) {
      // OPT-11: pooled unit ring — no per-move RingGeometry allocation.
      const ring = this.previewUnitRing;
      ring.material = this.validMat;
      ring.rotation.set(-Math.PI / 2, 0, 0);
      ring.position.set(wx, baseY + 0.06, wz);
      ring.visible = true;
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

  private commitPointPlacement(e: PointerCoords, keepTool: boolean): boolean {
    if (!this.derived) return false;
    const project = this.derived.project;
    const cs = 0.5;
    const cols = Math.round(project.site.width / cs);
    const rows = Math.round(project.site.depth / cs);
    const lvIdx = Math.min(1, this.viewOpts.activeLevel) as 0 | 1;
    const lv = project.levels[lvIdx];
    if (!lv || this.viewOpts.activeLevel === 2) {
      simsAudio.play("warning");
      return false;
    }
    const tool = this.viewOpts.activeTool;
    const item = this.getActiveCatalogItem();

    if (tool === "opening") {
      const [ow, oh] = item.sizeM ?? [0.9, 2.15, 0.14];
      const kind = item.openingKind ?? "door";
      const sill = kind === "window" ? 0.9 : kind === "vent" ? 2.45 : 0;
      const snap = snapOpeningToProjectWalls(lv.walls, this.lastWorldPos.x, this.lastWorldPos.z, ow, undefined, sill, oh);
      if (!snap || !snap.valid) {
        simsAudio.play("warning");
        return false;
      }
      const created = createOpeningForWall(uid("op"), kind, snap.offsetM, ow, oh, sill, item.name);
      created.swing = this.viewOpts.placementFlipSwing ?? 1;
      this.actions.onAddOpening(lvIdx, snap.wall.id, created);
      simsAudio.play("place");
      this.actions.onPlacementCommitted?.(tool, keepTool);
      return true;
    }

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
        return false;
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
      this.actions.onPlacementCommitted?.(tool, keepTool);
      return true;
    }

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
        return false;
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
      this.actions.onPlacementCommitted?.(tool, keepTool);
      return true;
    }

    return false;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.derived || !this.hoverTileMesh) return;
    const rect = this.getCanvasRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (e.pointerType === "touch") {
      if (this.cameraCtrl.activeTouchCount >= 2) {
        if (
          this.dragStartVertex ||
          this.dragStartCell ||
          this.sledgeDragStart ||
          this.isBrushDown ||
          this.mobileGhostDragging ||
          this.pushPullDragState ||
          this.openingDragState ||
          this.draggingEntity
        ) {
          this.cancelActivePreview();
        }
        return;
      }
      if (this.mobileGhostDragging && this.viewOpts.mobilePlacementActive && POINT_PLACEMENT_TOOLS.has(this.viewOpts.activeTool)) {
        const stageY = Math.max(rect.top + 24, e.clientY - 44);
        this.stagedClientPos = { x: e.clientX, y: stageY };
        this.syncLastWorldPosFromClient(e.clientX, stageY);
        this.scheduleToolPreview({
          clientX: e.clientX,
          clientY: stageY,
          altKey: Boolean(this.viewOpts.freePlacementEnabled),
          shiftKey: Boolean(this.viewOpts.multiPlaceEnabled),
        });
        this.requestRender();
        return;
      }
    }

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
      const snapped = e.altKey || this.altHeld || this.viewOpts.freePlacementEnabled ? Math.round(rawProj * 20) / 20 : Math.round(rawProj * 4) / 4;
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
            if (pending.kind === "furniture") {
              const decalInfo = this.contactDecalIndexMap.get(pending.id);
              const decalIm = decalInfo ? this.contactDecalMeshes[decalInfo.lvIdx] : null;
              if (decalInfo && decalIm) {
                this._v1.set(cx, nextPlaced.y + decalInfo.yRenderOffset + 0.008, cz);
                this._q.setFromAxisAngle(this._up, nextPlaced.rotationY ?? pending.rotationY ?? 0);
                this._s1.set(decalInfo.w * 1.18, 1, decalInfo.d * 1.15);
                this._m4.compose(this._v1, this._q, this._s1);
                decalIm.setMatrixAt(decalInfo.index, this._m4);
                decalIm.instanceMatrix.needsUpdate = true;
                this._s1.set(1, 1, 1);
              }
            }
            this.markShadowDirty();
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
    let sharedHits: THREE.Intersection[] | undefined;
    if (this.viewOpts.activeTool === "select" && !this.dragPendingCommit && this.actions.onHoverPart && e.pointerType !== "touch") {
      const nowMs = performance.now();
      if (nowMs - this.lastHoverMs > 70) {
        this.lastHoverMs = nowMs;
        sharedHits = this.collectRayHits(e);
        const hPart = this.raycastHit(e, false, sharedHits);
        this.actions.onHoverPart(hPart ? hPart.label : null, e.clientX - rect.left, e.clientY - rect.top);
      }
    } else {
      this.actions.onHoverPart?.(null, 0, 0);
    }
    if (e.pointerType === "touch" && this.viewOpts.activeTool === "select" && !this.draggingEntity) {
      return;
    }
    this.scheduleToolPreview(e, sharedHits);
    this.requestRender();
  }

  private handlePointerDown(e: PointerEvent): void {
    this.requestRender();
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

    const isTouch = e.pointerType === "touch";
    const tool = this.viewOpts.activeTool;

    if (isTouch) {
      if (this.cameraCtrl.activeTouchCount >= 2) {
        this.cancelActivePreview();
        return;
      }
      if (this.viewOpts.mobilePlacementActive && POINT_PLACEMENT_TOOLS.has(tool)) {
        const rect = this.getCanvasRect();
        const stageY = Math.max(rect.top + 24, e.clientY - 44);
        this.mobileGhostDragging = true;
        this.cameraCtrl.setCameraLocked(true);
        this.stagedClientPos = { x: e.clientX, y: stageY };
        this.syncLastWorldPosFromClient(e.clientX, stageY);
        this.updateToolPreview({
          clientX: e.clientX,
          clientY: stageY,
          altKey: Boolean(this.viewOpts.freePlacementEnabled),
          shiftKey: Boolean(this.viewOpts.multiPlaceEnabled),
        });
        return;
      }
      this.syncLastWorldPosFromClient(e.clientX, e.clientY);
    }

    const cs = 0.5;
    const cols = Math.round(this.derived.project.site.width / cs);
    const rows = Math.round(this.derived.project.site.depth / cs);
    const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
    const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
    const curVert = worldToGridVertex(this.lastWorldPos.x, this.lastWorldPos.z, cs, cols, rows);

    if (tool === "select") {
      // Check Push-Pull Arrow Gizmo first when a wall is selected
      if (this.pushPullGizmoGroup.visible && this.selected?.kind === "wall") {
        const rect = this.getCanvasRect();
        if (rect.width > 0 && rect.height > 0) {
          this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
          this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.activeCamera);
          const gHits = this.raycaster.intersectObject(this.pushPullGizmoGroup, true);
          if (gHits.length > 0) {
            const lvIdx = this.selected.levelIndex as 0 | 1;
            const w = this.derived.project.levels[lvIdx]?.walls.find((x) => x.id === this.selected?.id);
            if (w) {
              this.pushPullDragState = {
                lvIdx,
                wallId: w.id,
                startWorldX: this.lastWorldPos.x,
                startWorldZ: this.lastWorldPos.z,
                midX: (w.start.x + w.end.x) * 0.5,
                midZ: (w.start.z + w.end.z) * 0.5,
                nx: -(w.end.z - w.start.z) / (Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) || 1),
                nz: (w.end.x - w.start.x) / (Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) || 1),
                len: Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) || 1,
                height: w.height,
                thickness: w.thickness,
                baseY:
                  lvIdx === 0
                    ? this.derived.project.site.peil.floor1PeilM
                    : this.derived.project.site.peil.floor1PeilM + (this.derived.project.levels[0]?.height ?? 3.6),
                deltaM: 0,
              };
              if (isTouch) this.cameraCtrl.setCameraLocked(true);
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
        const alreadySelected = this.selected?.kind === "opening" && this.selected.id === sel.id;
        if (isTouch && !this.viewOpts.mobileMoveEntityArmed && !alreadySelected) {
          return;
        }
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
          if (isTouch) this.cameraCtrl.setCameraLocked(true);
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
        const alreadySelected =
          this.selected !== null && "id" in this.selected && this.selected.kind === sel.kind && this.selected.id === sel.id;
        if (isTouch && !this.viewOpts.mobileMoveEntityArmed && !alreadySelected) {
          return;
        }
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
          if (isTouch) this.cameraCtrl.setCameraLocked(true);
          try {
            this.canvas.setPointerCapture?.(e.pointerId);
          } catch {
            // ignore
          }
        }
        this.actions.onSelect(sel);
      } else if (!isTouch) {
        const fallback = hitRes ?? this.raycastHit(e, false);
        this.actions.onSelect(fallback ? fallback.sel : null);
      }
      return;
    }

    if (isTouch && this.viewOpts.mobileDrawMode === "orbit") {
      return;
    }

    if (tool === "sledgehammer") {
      if (!isTouch) {
        this.sledgeDragStart = { x: this.lastWorldPos.x, z: this.lastWorldPos.z };
      } else if (this.viewOpts.mobileDrawMode === "draw") {
        this.sledgeDragStart = { x: this.lastWorldPos.x, z: this.lastWorldPos.z };
      }
      return;
    }

    if (tool === "wall_straight" || tool === "wall_room" || tool === "wall_diagonal" || tool === "fence") {
      if (this.viewOpts.activeLevel === 2) {
        simsAudio.play("warning");
        return;
      }
      if (isTouch) this.cameraCtrl.setCameraLocked(true);
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
        if (isTouch) this.cameraCtrl.setCameraLocked(true);
        this.dragStartCell = { gx, gz };
      } else if (this.viewOpts.floorBrushMode === "tile" && this.lastWorldPos.inBounds && !this.isCellBlocked(lvIdx, gx, gz)) {
        if (isTouch) this.cameraCtrl.setCameraLocked(true);
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
      if (isTouch) this.cameraCtrl.setCameraLocked(true);
      this.dragStartCell = { gx, gz };
    } else if (tool === "terrain" && this.lastWorldPos.inBounds) {
      if (isTouch) this.cameraCtrl.setCameraLocked(true);
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
    this.requestRender();
    const isTouch = e.pointerType === "touch";
    if (isTouch && this.cameraCtrl.activeTouchCount <= 1) {
      this.cameraCtrl.setCameraLocked(false);
    }
    try {
      if (this.canvas.hasPointerCapture?.(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    if (isTouch && this.mobileGhostDragging) {
      this.mobileGhostDragging = false;
      return;
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
        this.actions.onPushPullWall?.(pp.lvIdx, pp.wallId, pp.deltaM, Boolean(e.altKey || this.altHeld || this.viewOpts.freePlacementEnabled));
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
        tool === "wall_diagonal" || e.altKey || this.altHeld || Boolean(this.viewOpts.freePlacementEnabled),
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
        this.actions.onPlacementCommitted?.(tool, Boolean(e.shiftKey || this.viewOpts.multiPlaceEnabled));
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
    if (dist > (isTouch ? 10 : 6)) return;

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

    // Point-placed tools (Opening, Stair, Furniture, HVAC, Light)
    if (POINT_PLACEMENT_TOOLS.has(tool)) {
      if (isTouch && this.viewOpts.mobilePlacementActive) {
        return;
      }
      this.commitPointPlacement(e, Boolean(e.shiftKey || this.viewOpts.multiPlaceEnabled));
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
    this.canvasRect = this.canvas.getBoundingClientRect();
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
    if (this.photoOutputPass) {
      this.photoOutputPass.photoUniforms.uAspect.value = w / h;
      this.photoOutputPass.setSize(Math.round(w * this.currentDpr), Math.round(h * this.currentDpr));
    }
    // A real resize just reset the drawing buffer; paint one frame right now so the
    // user never sees the cleared (black) canvas waiting for the next RAF.
    if (this.hasRenderedOnce && !this.contextLost && !this.disposed) {
      const cam = this.cameraCtrl.activeCamera;
      if (this.postActive && this.composer) {
        if (this.renderPass) this.renderPass.camera = cam;
        this.updateAtmosphere(cam);
        this.composer.render();
      } else {
        this.renderer.render(this.scene, cam);
      }
    }
    this.requestRender();
  }

  private handleVisibility(): void {
    if (document.hidden) {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    } else {
      this.lastFrameMs = performance.now();
      this.requestRender();
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

      const camMoved = this.cameraCtrl.update(dt);
      const explodeActive = Math.abs(this.explodeCurrent - this.explodeTarget) > 0.001;
      // OPT-09: `animatedFans.length > 0` alone kept the loop awake 100% of the
      // session; only an on-screen, effectively-visible fan keeps it rendering now.
      const fansActive = this.anyFanVisibleInFrustum();
      const rainActive = Boolean(this.rainPoints && this.rainPoints.visible && !this.reducedMotion);
      const lightningActive = this.lightningEnergy > 0.01 && !this.reducedMotion;
      const floodActive = Boolean(this.studioView?.showFloodWater && this.flood && this.flood.streetFloodCm > 0 && !this.reducedMotion);
      const airActive = Boolean(this.airParticlesMesh && this.airflow && this.airParticleStates.length > 0 && this.derived);
      const draggingActive = Boolean(this.draggingEntity || this.pushPullDragState || this.openingDragState || this.isBrushDown);

      const shouldRender =
        this.needsRender ||
        camMoved ||
        explodeActive ||
        fansActive ||
        rainActive ||
        lightningActive ||
        floodActive ||
        airActive ||
        draggingActive;

      // OPT-18: compositor blur gating on <body> (tracks real interaction, not just render)
      this.update3dActiveFlag(
        camMoved || explodeActive || fansActive || rainActive || floodActive || airActive || draggingActive,
        now,
      );

      if (!shouldRender) {
        return;
      }
      this.needsRender = false;
      this.simElapsedS += clampedDt;

      if (explodeActive) {
        this.explodeCurrent += (this.explodeTarget - this.explodeCurrent) * (this.reducedMotion ? 1 : Math.min(1, dt * 10));
        if (Math.abs(this.explodeCurrent - this.explodeTarget) <= 0.001) {
          this.explodeCurrent = this.explodeTarget;
        }
        this.applyExplode(this.explodeCurrent);
        if (this.explodeCurrent <= 0.005 && this.explodeTarget <= 0.005) {
          this.updateWallCutawayVisibility(true);
        }
      }

      if (fansActive) {
        for (const fan of this.animatedFans) {
          fan.rotation.y += dt * 7.5;
        }
      }

      if (rainActive && this.rainPoints) {
        // OPT-12: rain is fully vertex-shader driven — the CPU loop that advanced
        // ~1800 particles and re-uploaded the whole position buffer every frame is
        // gone; only the shared fall-cycle uniform and lightning cadence remain.
        this.rainTime.value = this.simElapsedS;

        if (this.rainActiveCount > 1200) {
          this.lightningTimer -= clampedDt;
          if (this.lightningTimer <= 0) {
            this.lightningTimer = 4 + Math.random() * 7;
            this.lightningEnergy = 2.8;
          }
        }
      }
      if (lightningActive) {
        this.lightningEnergy *= Math.exp(-clampedDt * 10);
      }
      // OPT-05: strike energy rides the existing fill light — the third permanent
      // DirectionalLight cost every PBR pixel one BRDF evaluation 100% of the time.
      if (this.lightningEnergy > 0.02) {
        this.fillLight.intensity = this.fillLightBase + this.lightningEnergy;
        if (!this.fillLightTinted) {
          this.fillLightTinted = true;
          this.fillLight.color.setHex(0xdce8ff);
        }
      } else if (this.fillLightTinted) {
        this.fillLight.intensity = this.fillLightBase;
        this.fillLightTinted = false;
        this.fillLight.color.setHex(0xb2cff0);
      } else {
        this.fillLight.intensity = this.fillLightBase;
      }

      this.palette.floodUniforms.uTime.value = this.reducedMotion ? 0 : this.simElapsedS;
      this.palette.floodUniforms.uRain.value = Math.min(1, this.lastRainMmH / 100);

      if (airActive && this.airParticlesMesh && this.airflow && this.derived) {
        const af = this.airflow;
        const proj = this.derived.project;
        const lt1Y = proj.site.peil.floor1PeilM;
        const lt2Y = lt1Y + (proj.levels[0]?.height ?? 3.6);
        // OPT-12: direct column-major matrix writes (Y-rotation by the flow angle)
        // instead of atan2 + Quaternion + Matrix4.compose per particle — only
        // elements [0,2,8,10,12..14] ever change.
        const matArr = this.airParticlesMesh.instanceMatrix.array as Float32Array;
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
          const invLen = 1 / Math.max(1e-5, Math.hypot(vx, vz));
          const c = vz * invLen;
          const s = vx * invLen;
          const mi = i * 16;
          matArr[mi] = c;
          matArr[mi + 1] = 0;
          matArr[mi + 2] = -s;
          matArr[mi + 3] = 0;
          matArr[mi + 4] = 0;
          matArr[mi + 5] = 1;
          matArr[mi + 6] = 0;
          matArr[mi + 7] = 0;
          matArr[mi + 8] = s;
          matArr[mi + 9] = 0;
          matArr[mi + 10] = c;
          matArr[mi + 11] = 0;
          matArr[mi + 12] = p.x;
          matArr[mi + 13] = p.y;
          matArr[mi + 14] = p.z;
          matArr[mi + 15] = 1;
          const tNorm = Math.max(0, Math.min(1, (temp - 23) / 10));
          this._col.setRGB(0.2 + tNorm * 0.78, 0.76 - tNorm * 0.25, 0.96 - tNorm * 0.72);
          this.airParticlesMesh.setColorAt(i, this._col);
        }
        this.airParticlesMesh.instanceMatrix.needsUpdate = true;
        if (this.airParticlesMesh.instanceColor) this.airParticlesMesh.instanceColor.needsUpdate = true;
      }

      this.updateWallCutawayVisibility(false);
      // Lock sky dome center to camera (`3d-sky-background`) so orbiting never introduces dome translation parallax
      this.skyMesh.position.copy(this.cameraCtrl.activeCamera.position);
      const cam = this.cameraCtrl.activeCamera;
      // OPT-22: dev-only frame profiler (?perf=1 / development).
      const perfT0 = this.perfEnabled ? performance.now() : 0;
      if (this.perfEnabled) this.beginPerfGpuQuery();
      if (this.postActive && this.composer) {
        if (this.renderPass) this.renderPass.camera = cam;
        this.updateAtmosphere(cam);
        this.composer.render();
      } else {
        this.renderer.render(this.scene, cam);
      }
      if (this.perfEnabled) {
        this.endPerfGpuQuery();
        this.perfCpuMs = performance.now() - perfT0;
      }
      this.hasRenderedOnce = true;
      // GR-02: first reflection-probe bake happens right after the first rendered
      // frame (house built, sky assigned) — then only on rebuild/envKey change.
      if (this.probeRig && this.rayTracingEnabled && !this.probeRig.hasBaked && !this.softwareGpu) {
        this.bakeReflectionProbes();
        this.requestRender();
      }

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
          if (this.perfEnabled) this.emitPerfStats(avg);
        }
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** OPT-22: begin the frame-level GPU timer query (one in flight at a time). */
  private beginPerfGpuQuery(): void {
    if (!this.perfGpuExt || this.perfGpuQuery) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.perfGpuQuery = gl.createQuery();
    gl.beginQuery(this.perfGpuExt.TIME_ELAPSED_EXT, this.perfGpuQuery);
  }

  /** OPT-22: close the frame-level GPU timer query. */
  private endPerfGpuQuery(): void {
    if (!this.perfGpuExt || !this.perfGpuQuery) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    gl.endQuery(this.perfGpuExt.TIME_ELAPSED_EXT);
  }

  /** OPT-22: publish `window.__GOMAHAN_PERF__` (CPU frame ms, GPU frame ms via
   * EXT_disjoint_timer_query_webgl2 when the extension exists, renderer counters). */
  private emitPerfStats(fps: number): void {
    let gpuMs: number | null = null;
    const q = this.perfGpuQuery;
    if (this.perfGpuExt && q) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext & { QUERY_RESULT_DISJOINT?: number };
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.QUERY_RESULT_DISJOINT || !gl.getQueryParameter(q, gl.QUERY_RESULT_DISJOINT)) {
          gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        }
        gl.deleteQuery(q);
        this.perfGpuQuery = null;
      }
    }
    const info = this.renderer.info;
    (window as unknown as { __GOMAHAN_PERF__?: Record<string, number | null> }).__GOMAHAN_PERF__ = {
      cpuMs: Number(this.perfCpuMs.toFixed(3)),
      gpuMs: gpuMs === null ? null : Number(gpuMs.toFixed(3)),
      fps,
      calls: info.render.calls,
      programs: info.programs?.length ?? 0,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }
}
