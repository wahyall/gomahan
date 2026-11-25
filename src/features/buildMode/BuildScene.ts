import * as THREE from "three";
import { BuildCameraController } from "@/features/buildMode/BuildCameraController";
import {
  applyTerrainBrushToHeights,
  computeProjectRoomFloodCells,
  createOpeningForWall,
  findRoomAtPoint,
  getStairSpan,
  snapOpeningToProjectWalls,
  snapWallEndpoint,
  validateProjectStairPlacement,
  worldToGridVertex,
  type GridPoint,
} from "@/features/buildMode/geometryUtils";
import { UNIFIED_BUILD_CATALOG } from "@/features/buildMode/projectCatalog";
import type { FloorBrushMode, TerrainBrushMode } from "@/features/buildMode/store";
import type {
  BuildCatalogEntry,
  BuildToolId,
  RoofVisibilityMode,
  WallVisibilityMode,
} from "@/features/buildMode/types";
import { simsAudio } from "@/lib/audio/simsAudio";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { FurnitureItem, HvacUnit, LightFixture, Room, Stair, Wall } from "@/lib/model/types";
import { createContactShadowTexture, mergeGeometryBatch } from "@/lib/scene/geometryHelpers";
import { createEnvironmentMap, createMaterialPalette, createSkyGradientTexture, type MaterialPalette } from "@/lib/scene/materials";
import { buildProjectHouse, buildStaticNeighborhood, type WallCutawayRecord } from "@/lib/scene/projectHouseBuilder";
import type { SelectionTarget } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";

export interface BuildSceneStats {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface BuildSceneActions {
  onSelect: (sel: SelectionTarget) => void;
  onHoverCell: (gx: number, gz: number, worldX: number, worldZ: number, inBounds: boolean) => void;
  onPreviewHud: (hud: { label: string; valid: boolean } | null) => void;
  onEyedropCatalog: (catalogId: string) => void;
  onStats?: (stats: BuildSceneStats) => void;
  // Direct Single-Source-of-Truth Project Mutations
  onAddWall: (lv: 0 | 1, wall: Wall) => void;
  onAddRoomAndWalls: (lv: 0 | 1, walls: Wall[], room?: Room) => void;
  onUpdateWall: (lv: 0 | 1, wallId: string, patch: Partial<Wall>) => void;
  onDeleteWall: (lv: 0 | 1, wallId: string) => void;
  onAddOpening: (lv: 0 | 1, wallId: string, op: ReturnType<typeof createOpeningForWall>) => void;
  onDeleteOpening: (lv: 0 | 1, wallId: string, opId: string) => void;
  onPaintRoomFloor: (lv: 0 | 1, roomId: string, matId: string) => void;
  onSetFloorTiles: (tiles: { levelIndex: number; gx: number; gz: number; materialId: string }[]) => void;
  onAddStair: (lv: 0 | 1, stair: Stair, voidPoly: { x: number; z: number }[]) => void;
  onAddFurniture: (lv: 0 | 1, item: FurnitureItem) => void;
  onMoveFurniture: (lv: 0 | 1, id: string, pos: { x: number; y: number; z: number }) => void;
  onDeleteFurniture: (lv: 0 | 1, id: string) => void;
  onAddHvac: (lv: 0 | 1, item: HvacUnit) => void;
  onMoveHvac: (lv: 0 | 1, id: string, pos: { x: number; y: number; z: number }) => void;
  onDeleteHvac: (lv: 0 | 1, id: string) => void;
  onAddLight: (lv: 0 | 1, light: LightFixture) => void;
  onMoveLight: (lv: 0 | 1, id: string, pos: { x: number; y: number; z: number }) => void;
  onDeleteLight: (lv: 0 | 1, id: string) => void;
  onAddPool: (pool: { id: string; gx1: number; gz1: number; gx2: number; gz2: number; depth: number }) => void;
  onSetTerrainHeights: (heights: number[]) => void;
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
  floorBrushMode: FloorBrushMode;
  terrainBrushMode: TerrainBrushMode;
  placementRotationQuarter: 0 | 1 | 2 | 3;
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
  private readonly lightningLight: THREE.DirectionalLight;

  private readonly envGroup = new THREE.Group();
  private readonly neighborsGroup = new THREE.Group();
  private readonly houseContainer = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly previewGroup = new THREE.Group();
  private readonly selectedRing: THREE.Mesh;

  private staticDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private dynResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private levelRoots: [THREE.Group, THREE.Group] | null = null;
  private lt2StructuralGroup: THREE.Group | null = null;
  private roofGroup: THREE.Group | null = null;
  private wallCutawayRecords: WallCutawayRecord[] = [];
  private animatedFans: THREE.Object3D[] = [];

  private gridMesh: THREE.LineSegments | null = null;
  private hoverTileMesh: THREE.Mesh | null = null;

  private derived: DerivedProjectModel | null = null;
  private struct: StructuralReport | null = null;
  private selected: SelectionTarget = null;
  private envKey = "";
  private buildSignature = "";
  private lastCutawayYaw = Number.NaN;

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
    floorBrushMode: "fill",
    terrainBrushMode: "raise",
    placementRotationQuarter: 0,
  };

  // Interactive Tool Drag / Move State
  private dragStartVertex: GridPoint | null = null;
  private dragStartCell: GridPoint | null = null;
  private brushStrokeCells = new Map<string, { levelIndex: number; gx: number; gz: number; materialId: string }>();
  private terrainScratch: number[] | null = null;
  private isBrushDown = false;
  private draggingEntity: SelectionTarget = null;
  private altHeld = false;
  private lastWorldPos = { x: 2.5, z: 8.5, inBounds: false };
  private pointerDownPos = { x: 0, y: 0 };

  private readonly validMat = new THREE.MeshBasicMaterial({ color: "#2ed68d", transparent: true, opacity: 0.45, depthWrite: false });
  private readonly invalidMat = new THREE.MeshBasicMaterial({ color: "#ef5350", transparent: true, opacity: 0.52, depthWrite: false });
  private readonly cyanMat = new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.45, depthWrite: false });

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd2e1ec, 0.0055);

    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    this.cameraCtrl = new BuildCameraController(canvas, aspect);

    this.palette = createMaterialPalette();
    this.palette.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x6f6859, 0.76);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5e0, 2.35);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1.5;
    this.sunLight.shadow.camera.far = 56;
    this.sunLight.shadow.camera.left = -10.5;
    this.sunLight.shadow.camera.right = 10.5;
    this.sunLight.shadow.camera.top = 14.5;
    this.sunLight.shadow.camera.bottom = -14.5;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.006;
    this.sunLight.target.position.set(2.5, 2.4, 8.5);
    this.scene.add(this.sunLight, this.sunLight.target);

    this.lightningLight = new THREE.DirectionalLight(0xdce8ff, 0);
    this.lightningLight.position.set(-10, 24, -12);
    this.scene.add(this.lightningLight);

    const skyTex = createSkyGradientTexture(10, "kemarau", 0);
    this.skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 20), this.skyMat);
    this.scene.add(this.skyMesh);

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

    const hoverGeo = new THREE.PlaneGeometry(0.5, 0.5);
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

    this.scene.add(this.envGroup, this.neighborsGroup, this.houseContainer, this.overlayGroup, this.previewGroup, this.selectedRing);

    this.handleResize();
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
    this.cameraCtrl.dispose();

    for (const r of this.dynResources) r.dispose();
    for (const r of this.staticDisposables) r.dispose();
    this.validMat.dispose();
    this.invalidMat.dispose();
    this.cyanMat.dispose();
    this.envTex?.dispose();
    this.palette.dispose();
    this.renderer.dispose();
  }

  public cancelActivePreview(): void {
    this.dragStartVertex = null;
    this.dragStartCell = null;
    this.draggingEntity = null;
    this.isBrushDown = false;
    this.brushStrokeCells.clear();
    this.terrainScratch = null;
    this.clearPreviewMeshes();
    this.actions.onPreviewHud(null);
  }

  private clearPreviewMeshes(): void {
    for (const c of this.previewGroup.children) {
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) c.geometry.dispose();
    }
    this.previewGroup.clear();
  }

  public updateProjectData(derived: DerivedProjectModel, struct: StructuralReport, selected: SelectionTarget): void {
    this.derived = derived;
    this.struct = struct;
    this.selected = selected;

    const { project } = derived;
    const sim = project.simulation;

    // Sync PBR materials cleanly to Project Settings
    this.palette.plasterExt.color.set(sim.paintExtHex);
    this.palette.plasterInt.color.set(sim.paintIntHex);
    this.palette.roofCover.color.set(sim.roofColorHex);
    this.palette.setTileSize(project.systems.tileSizeCm);

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
      const isNight = sim.hourOfDay < 5.5 || sim.hourOfDay > 18.5;
      this.scene.environmentIntensity = isNight ? 0.35 : 0.72;
      this.palette.bindEnvMap(env);

      // Sun angle by hour
      const sunElev = Math.max(0.15, Math.sin(((sim.hourOfDay - 5.5) / 13) * Math.PI));
      const sunAz = ((sim.hourOfDay - 12) / 6) * 0.9;
      this.sunLight.position.set(2.5 + Math.sin(sunAz) * 24, Math.max(3, sunElev * 24), 8.5 - Math.cos(sunAz) * 14);
      this.sunLight.intensity = isNight ? 0.25 : 2.35;
      this.sunLight.color.set(isNight ? 0x6c88b8 : sim.hourOfDay < 7.5 || sim.hourOfDay > 16.5 ? 0xffcb8c : 0xfff5e0);
      this.hemiLight.intensity = isNight ? 0.32 : 0.76;
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set(isNight ? 0x0e1628 : 0xd2e1ec);
      }
    }

    const sig = JSON.stringify({
      u: project.updatedAt,
      sys: project.systems,
      peil: project.site.peil,
      lv: project.levels.map((l) => [l.walls, l.rooms, l.slabs, l.stairs, l.furniture, l.lights, l.hvac]),
      ext: project.buildExtras,
      brk: this.viewOpts.showBricksOverlay,
    });

    if (sig !== this.buildSignature) {
      this.buildSignature = sig;
      this.rebuildFromProject(derived, struct);
    }

    this.updateSelectionRing(derived, selected);
  }

  public setViewOptions(opts: BuildViewOptions): void {
    const levelChanged = this.viewOpts.activeLevel !== opts.activeLevel;
    const bricksChanged = this.viewOpts.showBricksOverlay !== opts.showBricksOverlay;
    const toolChanged =
      this.viewOpts.activeTool !== opts.activeTool || this.viewOpts.selectedCatalogId !== opts.selectedCatalogId;

    this.viewOpts = opts;
    this.neighborsGroup.visible = opts.neighborsVisible;
    if (this.gridMesh) this.gridMesh.visible = opts.gridVisible;
    this.cameraCtrl.setSnap90Enabled(opts.snap90Enabled);
    this.cameraCtrl.setEdgeScrollEnabled(opts.edgeScrollEnabled);

    if (toolChanged) this.cancelActivePreview();
    if (bricksChanged && this.derived && this.struct) {
      this.rebuildFromProject(this.derived, this.struct);
    }

    if (levelChanged) {
      const y = this.getActiveFloorY();
      this.cameraCtrl.setTargetElevation(y);
      this.activeFloorPlane.constant = -y;
      this.rebuildGridOverlay();
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
    for (const r of this.dynResources) r.dispose();
    this.dynResources = [];
    this.animatedFans = [];

    const built = buildProjectHouse(derived, struct, this.palette, this.contactShadowMat, {
      stage: 0,
      showBricks: this.viewOpts.showBricksOverlay,
      showStructure: true,
      showRoof: true,
      showRangka: true,
      showFinishing: true,
      xrayRebar: false,
      showAir: false,
      showListrik: false,
      hiddenParts: new Set(),
      activeLevelView: "all",
      supportWallCutaway: true,
    });

    this.houseContainer.add(built.houseRoot);
    this.dynResources.push(...built.resources);
    this.levelRoots = built.levelRoots;
    this.lt2StructuralGroup = built.lt2StructuralGroup;
    this.roofGroup = built.roofGroup;
    this.wallCutawayRecords = built.wallCutawayRecords;
    this.animatedFans = built.animatedFans;
    this.lastCutawayYaw = Number.NaN;

    this.cameraCtrl.setBounds({
      minX: -4.5,
      maxX: derived.project.site.width + 4.5,
      minZ: -5.5,
      maxZ: derived.project.site.depth + 5.5,
    });
    this.rebuildGridOverlay();
    this.applyLevelAndWallVisibility();
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
    const cols = Math.round(wM / 0.5);
    const rows = Math.round(dM / 0.5);
    const y = this.getActiveFloorY() + 0.025;

    const positions: number[] = [];
    const colors: number[] = [];
    const majorCol = new THREE.Color("#dbe7f2");
    const minorCol = new THREE.Color("#9db2c4");
    const borderCol = new THREE.Color("#f09b4b");

    for (let gx = 0; gx <= cols; gx++) {
      const x = gx * 0.5;
      const c = gx === 0 || gx === cols ? borderCol : gx % 2 === 0 ? majorCol : minorCol;
      positions.push(x, y, 0, x, y, dM);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let gz = 0; gz <= rows; gz++) {
      const z = gz * 0.5;
      const c = gz === 0 || gz === rows ? borderCol : gz % 2 === 0 ? majorCol : minorCol;
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
    const lv = this.viewOpts.activeLevel;
    if (this.levelRoots) {
      this.levelRoots[0].visible = true;
      this.levelRoots[1].visible = lv >= 1;
    }
    if (this.lt2StructuralGroup) {
      this.lt2StructuralGroup.visible = lv >= 1;
    }
    if (this.roofGroup) {
      if (this.viewOpts.roofVisibility === "show") this.roofGroup.visible = true;
      else if (this.viewOpts.roofVisibility === "hide") this.roofGroup.visible = false;
      else this.roofGroup.visible = lv >= 2;
    }
    this.updateWallCutawayVisibility(true);
  }

  private updateWallCutawayVisibility(force = false): void {
    const yaw = this.cameraCtrl.getCurrentYaw();
    if (!force && Math.abs(yaw - this.lastCutawayYaw) < 0.06) return;
    this.lastCutawayYaw = yaw;

    const active = Math.min(1, this.viewOpts.activeLevel);
    const camPos = this.cameraCtrl.camera.position;
    const lotCX = (this.derived?.project.site.width ?? 5) * 0.5;
    const lotCZ = (this.derived?.project.site.depth ?? 17) * 0.5;
    const dx = camPos.x - lotCX;
    const dz = camPos.z - lotCZ;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;

    for (const ch of this.neighborsGroup.children) {
      if (this.viewOpts.activeLevel >= 2) {
        ch.visible = true;
      } else if (ch.name === "neighbor-left") {
        ch.visible = camPos.x >= 1.2;
      } else if (ch.name === "neighbor-right") {
        ch.visible = camPos.x <= 3.8;
      }
    }

    for (const rec of this.wallCutawayRecords) {
      if (this.viewOpts.activeLevel >= 2 || rec.levelIndex < active) {
        rec.fullGroup.visible = true;
        rec.cutawayGroup.visible = false;
        rec.downGroup.visible = false;
        continue;
      }
      if (this.viewOpts.wallVisibility === "up") {
        rec.fullGroup.visible = true;
        rec.cutawayGroup.visible = false;
        rec.downGroup.visible = false;
      } else if (this.viewOpts.wallVisibility === "down") {
        rec.fullGroup.visible = false;
        rec.cutawayGroup.visible = false;
        rec.downGroup.visible = true;
      } else {
        const dot = (rec.midX - lotCX) * ux + (rec.midZ - lotCZ) * uz;
        const isFront = dot > 0.25;
        rec.fullGroup.visible = !isFront;
        rec.cutawayGroup.visible = isFront;
        rec.downGroup.visible = false;
      }
    }
  }

  private updateSelectionRing(derived: DerivedProjectModel, sel: SelectionTarget): void {
    if (!sel || sel.kind === "part") {
      this.selectedRing.visible = false;
      return;
    }
    const lv = derived.project.levels[sel.levelIndex];
    if (!lv) {
      this.selectedRing.visible = false;
      return;
    }
    const baseY = sel.levelIndex === 0 ? derived.project.site.peil.floor1PeilM : derived.project.site.peil.floor1PeilM + derived.project.levels[0]!.height;
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
      if (w) pt = { x: (w.start.x + w.end.x) * 0.5, y: baseY + 0.05, z: (w.start.z + w.end.z) * 0.5 };
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

  private raycastHit(e: PointerEvent): { sel: NonNullable<SelectionTarget>; label: string; obj: THREE.Object3D } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.camera);
    const hits = this.raycaster.intersectObjects(this.houseContainer.children, true);
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
      cur = h.object;
      while (cur) {
        if (cur.userData?.sel) {
          return { sel: cur.userData.sel as NonNullable<SelectionTarget>, label: String(cur.userData.label ?? "Elemen"), obj: cur };
        }
        cur = cur.parent;
      }
    }
    return null;
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

    if (tool === "sledgehammer" || tool === "eyedropper" || tool === "wall_paint") {
      const hitRes = this.raycastHit(e);
      if (hitRes && (tool !== "wall_paint" || hitRes.sel.kind === "wall")) {
        const box = new THREE.Box3().setFromObject(hitRes.obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const geo = new THREE.BoxGeometry(Math.max(0.18, size.x + 0.06), Math.max(0.18, size.y + 0.06), Math.max(0.18, size.z + 0.06));
        const mat = tool === "sledgehammer" ? this.invalidMat : tool === "eyedropper" ? this.cyanMat : this.validMat;
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(center);
        this.previewGroup.add(m);
        this.actions.onPreviewHud({
          label: tool === "sledgehammer" ? `Hapus: ${hitRes.label}` : tool === "wall_paint" ? `Cat: ${item.name}` : `Salin: ${hitRes.label}`,
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
    const curVert = worldToGridVertex(wx, wz, cs, cols, rows);

    if ((tool === "wall_straight" || tool === "wall_diagonal" || tool === "fence") && this.dragStartVertex) {
      const endV = snapWallEndpoint(this.dragStartVertex, curVert, cols, rows, tool === "wall_diagonal" || e.altKey || this.altHeld);
      const dx = (endV.gx - this.dragStartVertex.gx) * cs;
      const dz = (endV.gz - this.dragStartVertex.gz) * cs;
      const len = Math.hypot(dx, dz);
      const valid = len >= 0.45;
      if (valid) {
        const h = tool === "fence" ? 1.2 : lvH;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.12, h, 0.14), this.validMat);
        m.position.set(this.dragStartVertex.gx * cs + dx * 0.5, baseY + h * 0.5, this.dragStartVertex.gz * cs + dz * 0.5);
        m.rotation.y = -Math.atan2(dz, dx);
        this.previewGroup.add(m);
      }
      this.actions.onPreviewHud({ label: `${tool === "fence" ? "Pagar" : "Dinding"} ${len.toFixed(1)} m`, valid });
      return;
    }

    if (tool === "wall_room" && this.dragStartVertex) {
      const x1 = Math.min(this.dragStartVertex.gx, curVert.gx);
      const x2 = Math.max(this.dragStartVertex.gx, curVert.gx);
      const z1 = Math.min(this.dragStartVertex.gz, curVert.gz);
      const z2 = Math.max(this.dragStartVertex.gz, curVert.gz);
      const wM = (x2 - x1) * cs;
      const dM = (z2 - z1) * cs;
      const valid = x2 - x1 >= 2 && z2 - z1 >= 2;
      if (wM >= 0.5 && dM >= 0.5) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(wM, 0.14, dM), valid ? this.validMat : this.invalidMat);
        m.position.set((x1 + x2) * 0.5 * cs, baseY + 0.08, (z1 + z2) * 0.5 * cs);
        this.previewGroup.add(m);
      }
      this.actions.onPreviewHud({ label: `Ruangan ${wM.toFixed(1)} × ${dM.toFixed(1)} m`, valid });
      return;
    }

    if (tool === "floor_tile" || tool === "floor_rect" || tool === "floor_fill") {
      if (this.viewOpts.floorBrushMode === "fill" || tool === "floor_fill") {
        if (!this.lastWorldPos.inBounds) return;
        const cells = computeProjectRoomFloodCells(lv.walls, cols, rows, cs, gx, gz);
        const geos = cells.slice(0, 500).map((c) => {
          const g = new THREE.BoxGeometry(cs, 0.05, cs);
          g.translate((c.gx + 0.5) * cs, baseY + 0.04, (c.gz + 0.5) * cs);
          return g;
        });
        const merged = mergeGeometryBatch(geos);
        if (merged) this.previewGroup.add(new THREE.Mesh(merged, this.validMat));
        this.actions.onPreviewHud({ label: `Isi Ruangan: ${(cells.length * cs * cs).toFixed(1)} m²`, valid: cells.length > 0 });
        return;
      }
      if (this.viewOpts.floorBrushMode === "rect" && this.dragStartCell) {
        const minX = Math.min(this.dragStartCell.gx, gx);
        const maxX = Math.max(this.dragStartCell.gx, gx);
        const minZ = Math.min(this.dragStartCell.gz, gz);
        const maxZ = Math.max(this.dragStartCell.gz, gz);
        const wM = (maxX - minX + 1) * cs;
        const dM = (maxZ - minZ + 1) * cs;
        const m = new THREE.Mesh(new THREE.BoxGeometry(wM, 0.05, dM), this.validMat);
        m.position.set((minX + maxX + 1) * 0.5 * cs, baseY + 0.04, (minZ + maxZ + 1) * 0.5 * cs);
        this.previewGroup.add(m);
        this.actions.onPreviewHud({ label: `Lantai ${wM.toFixed(1)} × ${dM.toFixed(1)} m`, valid: true });
        return;
      }
      if (this.brushStrokeCells.size > 0) {
        const geos = [...this.brushStrokeCells.values()].map((c) => {
          const g = new THREE.BoxGeometry(cs, 0.05, cs);
          g.translate((c.gx + 0.5) * cs, baseY + 0.04, (c.gz + 0.5) * cs);
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
      const snap = snapOpeningToProjectWalls(lv.walls, wx, wz, ow);
      if (!snap) {
        this.actions.onPreviewHud({ label: `Dekatkan ke dinding (${item.name})`, valid: false });
        return;
      }
      const sill = item.openingKind === "window" ? 0.9 : item.openingKind === "vent" ? 2.45 : 0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, 0.22), snap.valid ? this.validMat : this.invalidMat);
      m.position.set(snap.worldX, baseY + sill + oh * 0.5, snap.worldZ);
      m.rotation.y = snap.yaw;
      this.previewGroup.add(m);
      this.actions.onPreviewHud({ label: snap.valid ? `${item.name} (Klik Pasang)` : snap.reason ?? "Tidak muat", valid: snap.valid });
      return;
    }

    if (tool === "stair") {
      const [wC, lC] = item.footprintCells ?? [2, 8];
      const rq = this.viewOpts.placementRotationQuarter;
      const res = validateProjectStairPlacement(lv.stairs, lvIdx, gx, gz, wC, lC, rq, cols, rows, cs);
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
      const valid = this.viewOpts.activeLevel === 0 && maxX - minX >= 1 && maxZ - minZ >= 1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(wM, 0.22, dM), valid ? this.cyanMat : this.invalidMat);
      m.position.set((minX + maxX + 1) * 0.5 * cs, baseY + 0.08, (minZ + maxZ + 1) * 0.5 * cs);
      this.previewGroup.add(m);
      this.actions.onPreviewHud({ label: valid ? `Kolam ${wM.toFixed(1)} × ${dM.toFixed(1)} m` : "Kolam min 1×1m di Lantai 1", valid });
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
      const [sx, sy, sz] =
        tool === "furniture"
          ? item.sizeM ?? [0.8, 0.8, 0.8]
          : tool === "hvac"
            ? item.hvacMeta?.type === "ac_split"
              ? [0.85, 0.28, 0.22]
              : [0.55, 0.45, 0.55]
            : [0.35, 0.3, 0.35];
      const rot = this.viewOpts.placementRotationQuarter * (Math.PI / 2);
      const px = e.altKey || this.altHeld ? wx : Math.round(wx * 2) / 2;
      const pz = e.altKey || this.altHeld ? wz : Math.round(wz * 2) / 2;
      const elev = tool === "hvac" ? item.hvacMeta?.defaultElevationM ?? 0 : tool === "light" ? item.lightMeta?.defaultElevationM ?? 2.9 : 0;
      const valid = px >= 0.1 && px <= project.site.width - 0.1 && pz >= 0.1 && pz <= project.site.depth - 0.1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), valid ? this.validMat : this.invalidMat);
      m.position.set(px, baseY + elev + sy * 0.5, pz);
      m.rotation.y = rot;
      this.previewGroup.add(m);
      this.actions.onPreviewHud({
        label: valid ? `${item.name} (${this.viewOpts.placementRotationQuarter * 90}° · R putar · Alt bebas)` : "Di luar batas kavling",
        valid,
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
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.camera);
    const hit = this.raycaster.ray.intersectPlane(this.activeFloorPlane, this.hitPoint);
    if (!hit) {
      this.hoverTileMesh.visible = false;
      return;
    }

    const cs = 0.5;
    const cols = Math.round(this.derived.project.site.width / cs);
    const rows = Math.round(this.derived.project.site.depth / cs);
    const gx = Math.floor(hit.x / cs);
    const gz = Math.floor(hit.z / cs);
    const inBounds = gx >= 0 && gx < cols && gz >= 0 && gz < rows;
    this.lastWorldPos = { x: hit.x, z: hit.z, inBounds };

    this.hoverTileMesh.visible = inBounds;
    if (inBounds) {
      this.hoverTileMesh.position.set((gx + 0.5) * cs, this.getActiveFloorY() + 0.03, (gz + 0.5) * cs);
    }

    // Drag moving an already-selected Furniture / HVAC / Light item in Select mode
    if (this.draggingEntity && inBounds) {
      const snapX = e.altKey || this.altHeld ? hit.x : Math.round(hit.x * 2) / 2;
      const snapZ = e.altKey || this.altHeld ? hit.z : Math.round(hit.z * 2) / 2;
      const lvIdx = Math.min(1, this.viewOpts.activeLevel) as 0 | 1;
      const lv = this.derived.project.levels[lvIdx];
      if (lv) {
        if (this.draggingEntity.kind === "furniture") {
          const cur = lv.furniture.find((x) => x.id === this.draggingEntity?.id);
          if (cur) this.actions.onMoveFurniture(lvIdx, cur.id, { x: snapX, y: cur.position.y, z: snapZ });
        } else if (this.draggingEntity.kind === "hvac") {
          const cur = lv.hvac.find((x) => x.id === this.draggingEntity?.id);
          if (cur) this.actions.onMoveHvac(lvIdx, cur.id, { x: snapX, y: cur.position.y, z: snapZ });
        } else if (this.draggingEntity.kind === "light") {
          const cur = lv.lights.find((x) => x.id === this.draggingEntity?.id);
          if (cur) this.actions.onMoveLight(lvIdx, cur.id, { x: snapX, y: cur.position.y, z: snapZ });
        }
      }
      return;
    }

    if (this.isBrushDown && inBounds) {
      const tool = this.viewOpts.activeTool;
      const item = this.getActiveCatalogItem();
      if (tool === "floor_tile" && this.viewOpts.floorBrushMode === "tile") {
        this.brushStrokeCells.set(`${this.viewOpts.activeLevel}:${gx}:${gz}`, {
          levelIndex: Math.min(1, this.viewOpts.activeLevel),
          gx,
          gz,
          materialId: item.materialId ?? "granite_warm",
        });
      } else if (tool === "terrain" && this.terrainScratch) {
        const v = worldToGridVertex(hit.x, hit.z, cs, cols, rows);
        this.terrainScratch = applyTerrainBrushToHeights(this.terrainScratch, cols, rows, v.gx, v.gz, this.viewOpts.terrainBrushMode, 0.12);
      }
    }

    this.actions.onHoverCell(gx, gz, hit.x, hit.z, inBounds);
    this.updateToolPreview(e);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      if (this.dragStartVertex || this.dragStartCell || this.isBrushDown || this.draggingEntity) {
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
      const hitRes = this.raycastHit(e);
      if (hitRes && (hitRes.sel.kind === "furniture" || hitRes.sel.kind === "hvac" || hitRes.sel.kind === "light")) {
        this.draggingEntity = hitRes.sel;
        this.actions.onSelect(hitRes.sel);
      }
      return;
    }

    if (tool === "wall_straight" || tool === "wall_room" || tool === "wall_diagonal" || tool === "fence") {
      this.dragStartVertex = curVert;
    } else if (tool === "floor_tile" || tool === "floor_rect") {
      if (this.viewOpts.floorBrushMode === "rect" || tool === "floor_rect") {
        this.dragStartCell = { gx, gz };
      } else if (this.viewOpts.floorBrushMode === "tile" && this.lastWorldPos.inBounds) {
        this.isBrushDown = true;
        const item = this.getActiveCatalogItem();
        this.brushStrokeCells.set(`${this.viewOpts.activeLevel}:${gx}:${gz}`, {
          levelIndex: Math.min(1, this.viewOpts.activeLevel),
          gx,
          gz,
          materialId: item.materialId ?? "granite_warm",
        });
      }
    } else if (tool === "pool") {
      this.dragStartCell = { gx, gz };
    } else if (tool === "terrain" && this.lastWorldPos.inBounds) {
      this.isBrushDown = true;
      const base = this.derived.project.buildExtras?.terrainHeights ?? [];
      this.terrainScratch = applyTerrainBrushToHeights(base, cols, rows, curVert.gx, curVert.gz, this.viewOpts.terrainBrushMode, 0.2);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.derived) return;

    if (this.draggingEntity) {
      this.draggingEntity = null;
      simsAudio.play("place");
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

    // Dragged straight/diagonal/fence wall
    if ((tool === "wall_straight" || tool === "wall_diagonal" || tool === "fence") && this.dragStartVertex) {
      const endV = snapWallEndpoint(this.dragStartVertex, worldToGridVertex(this.lastWorldPos.x, this.lastWorldPos.z, cs, cols, rows), cols, rows, tool === "wall_diagonal" || e.altKey);
      if (endV.gx !== this.dragStartVertex.gx || endV.gz !== this.dragStartVertex.gz) {
        this.actions.onAddWall(lvIdx, {
          id: uid(tool === "fence" ? "fence" : "wall"),
          name: tool === "fence" ? "Pagar Baru" : "Dinding Baru",
          start: { x: this.dragStartVertex.gx * cs, z: this.dragStartVertex.gz * cs },
          end: { x: endV.gx * cs, z: endV.gz * cs },
          thickness: tool === "fence" ? 0.08 : brickThick,
          height: tool === "fence" ? 1.2 : lv.height,
          materialId: tool === "fence" ? "wall_andesit" : "wall_ext_ivory",
          exterior: true,
          openings: [],
        });
      }
      this.cancelActivePreview();
      return;
    }

    // Dragged rectangle Room (4 walls + interior slab Room)
    if (tool === "wall_room" && this.dragStartVertex) {
      const curVert = worldToGridVertex(this.lastWorldPos.x, this.lastWorldPos.z, cs, cols, rows);
      const x1 = Math.min(this.dragStartVertex.gx, curVert.gx) * cs;
      const x2 = Math.max(this.dragStartVertex.gx, curVert.gx) * cs;
      const z1 = Math.min(this.dragStartVertex.gz, curVert.gz) * cs;
      const z2 = Math.max(this.dragStartVertex.gz, curVert.gz) * cs;
      if (x2 - x1 >= 1.0 && z2 - z1 >= 1.0) {
        const mkW = (ax: number, az: number, bx: number, bz: number): Wall => ({
          id: uid("rmwall"),
          name: "Dinding Ruangan",
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
    if ((tool === "floor_tile" || tool === "floor_rect") && this.dragStartCell) {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
      const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
      const tiles: { levelIndex: number; gx: number; gz: number; materialId: string }[] = [];
      for (let x = Math.min(this.dragStartCell.gx, gx); x <= Math.max(this.dragStartCell.gx, gx); x++) {
        for (let z = Math.min(this.dragStartCell.gz, gz); z <= Math.max(this.dragStartCell.gz, gz); z++) {
          tiles.push({ levelIndex: lvIdx, gx: x, gz: z, materialId: item.materialId ?? "granite_warm" });
        }
      }
      this.actions.onSetFloorTiles(tiles);
      this.cancelActivePreview();
      return;
    }

    if (tool === "pool" && this.dragStartCell) {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
      const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
      if (this.viewOpts.activeLevel === 0 && Math.abs(gx - this.dragStartCell.gx) >= 1 && Math.abs(gz - this.dragStartCell.gz) >= 1) {
        this.actions.onAddPool({ id: uid("pool"), gx1: this.dragStartCell.gx, gz1: this.dragStartCell.gz, gx2: gx, gz2: gz, depth: 1.25 });
      } else {
        simsAudio.play("warning");
      }
      this.cancelActivePreview();
      return;
    }

    if (tool === "terrain" && this.terrainScratch) {
      this.actions.onSetTerrainHeights(this.terrainScratch);
      this.cancelActivePreview();
      return;
    }

    const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dist > 6) return;

    // Room floor flood fill click
    if ((tool === "floor_tile" || tool === "floor_fill") && (this.viewOpts.floorBrushMode === "fill" || tool === "floor_fill")) {
      const roomHit = findRoomAtPoint(lv.rooms, this.lastWorldPos.x, this.lastWorldPos.z);
      if (roomHit) {
        this.actions.onPaintRoomFloor(lvIdx, roomHit.id, item.materialId ?? "granite_warm");
      } else if (this.lastWorldPos.inBounds) {
        const cells = computeProjectRoomFloodCells(lv.walls, cols, rows, cs, Math.floor(this.lastWorldPos.x / cs), Math.floor(this.lastWorldPos.z / cs));
        this.actions.onSetFloorTiles(cells.map((c) => ({ levelIndex: lvIdx, gx: c.gx, gz: c.gz, materialId: item.materialId ?? "granite_warm" })));
      }
      return;
    }

    // Snap Opening to Project Wall
    if (tool === "opening") {
      const [ow, oh] = item.sizeM ?? [0.9, 2.15, 0.14];
      const snap = snapOpeningToProjectWalls(lv.walls, this.lastWorldPos.x, this.lastWorldPos.z, ow);
      if (!snap || !snap.valid) {
        simsAudio.play("warning");
        return;
      }
      const kind = item.openingKind ?? "door";
      const sill = kind === "window" ? 0.9 : kind === "vent" ? 2.45 : 0;
      this.actions.onAddOpening(lvIdx, snap.wall.id, createOpeningForWall(uid("op"), kind, snap.offsetM, ow, oh, sill, item.name));
      return;
    }

    // Place Stair + Auto Void Slab
    if (tool === "stair") {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(this.lastWorldPos.x / cs)));
      const gz = Math.max(0, Math.min(rows - 1, Math.floor(this.lastWorldPos.z / cs)));
      const [wC, lC] = item.footprintCells ?? [2, 8];
      const rq = this.viewOpts.placementRotationQuarter;
      const check = validateProjectStairPlacement(lv.stairs, lvIdx, gx, gz, wC, lC, rq, cols, rows, cs);
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
      return;
    }

    // Place Furniture / HVAC / Light
    if (tool === "furniture" || tool === "hvac" || tool === "light") {
      if (!this.lastWorldPos.inBounds) {
        simsAudio.play("warning");
        return;
      }
      const px = e.altKey ? this.lastWorldPos.x : Math.round(this.lastWorldPos.x * 2) / 2;
      const pz = e.altKey ? this.lastWorldPos.z : Math.round(this.lastWorldPos.z * 2) / 2;
      const rot = this.viewOpts.placementRotationQuarter * (Math.PI / 2);
      if (tool === "furniture") {
        const [sx, sy, sz] = item.sizeM ?? [1.0, 0.8, 0.8];
        // Stack tabletop/plant decor cleanly onto surface if overlapping table/kitchen counter
        let mountY = 0;
        if (item.furnitureCategory === "decor" || item.furnitureCategory === "plant") {
          for (const host of lv.furniture) {
            if (host.category === "table" || host.category === "kitchen") {
              if (Math.abs(px - host.position.x) <= host.size.x * 0.5 && Math.abs(pz - host.position.z) <= host.size.z * 0.5) {
                mountY = Math.max(mountY, host.position.y + host.size.y);
              }
            }
          }
        }
        this.actions.onAddFurniture(lvIdx, {
          id: uid("furn"),
          catalogId: item.materialId ?? "sofa_l",
          name: item.name,
          category: item.furnitureCategory ?? "seating",
          position: { x: px, y: mountY, z: pz },
          size: { x: sx, y: sy, z: sz },
          rotationY: rot,
          colorHex: item.swatchHex,
          accentHex: item.accentHex,
        });
      } else if (tool === "hvac" && item.hvacMeta) {
        this.actions.onAddHvac(lvIdx, {
          id: uid("hv"),
          name: item.name,
          type: item.hvacMeta.type,
          position: { x: px, y: item.hvacMeta.defaultElevationM, z: pz },
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
          position: { x: px, y: item.lightMeta.defaultElevationM, z: pz },
          lumens: item.lightMeta.lumens,
          colorTempK: item.lightMeta.colorTempK,
          beamAngleDeg: item.lightMeta.beamAngleDeg,
          dimmer: 1,
          on: true,
        });
      }
      return;
    }

    // Wall Paint / Sledgehammer / Eyedropper / Select
    const hitRes = this.raycastHit(e);
    if (tool === "wall_paint") {
      if (hitRes?.sel.kind === "wall") {
        this.actions.onUpdateWall(hitRes.sel.levelIndex as 0 | 1, hitRes.sel.id, { materialId: item.materialId ?? "wall_ext_ivory" });
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
      return;
    }
    if (tool === "eyedropper" && hitRes) {
      const s = hitRes.sel;
      if (s.kind === "furniture") {
        const f = project.levels[s.levelIndex]?.furniture.find((x) => x.id === s.id);
        if (f) this.actions.onEyedropCatalog(`furn_${f.catalogId}`);
      } else if (s.kind === "hvac") {
        const h = project.levels[s.levelIndex]?.hvac.find((x) => x.id === s.id);
        const match = UNIFIED_BUILD_CATALOG.find((c) => c.hvacMeta?.type === h?.type);
        if (match) this.actions.onEyedropCatalog(match.id);
      } else if (s.kind === "light") {
        const l = project.levels[s.levelIndex]?.lights.find((x) => x.id === s.id);
        const match = UNIFIED_BUILD_CATALOG.find((c) => c.lightMeta?.type === l?.type);
        if (match) this.actions.onEyedropCatalog(match.id);
      } else if (s.kind === "wall") {
        const w = project.levels[s.levelIndex]?.walls.find((x) => x.id === s.id);
        const match = UNIFIED_BUILD_CATALOG.find((c) => c.materialId === w?.materialId);
        this.actions.onEyedropCatalog(match?.id ?? "tool_wall_straight");
      }
      simsAudio.play("select");
      return;
    }

    this.actions.onSelect(hitRes ? hitRes.sel : null);
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.cameraCtrl.setAspect(w / h);
  }

  private handleVisibility(): void {
    if (!document.hidden) this.lastFrameMs = performance.now();
  }

  private startLoop(): void {
    const tick = (now: number) => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);
      if (document.hidden) return;

      const dt = (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;

      for (const fan of this.animatedFans) {
        fan.rotation.y += dt * 7.5;
      }

      this.cameraCtrl.update(dt);
      this.updateWallCutawayVisibility(false);
      this.renderer.render(this.scene, this.cameraCtrl.camera);

      if (dt > 0 && dt < 0.25) {
        this.fpsSamples.push(1 / dt);
        if (this.fpsSamples.length >= 24) {
          const avg = Math.round(this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length);
          this.fpsSamples = [];
          const info = this.renderer.info;
          const snap: BuildSceneStats = {
            fps: avg,
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
