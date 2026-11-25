import * as THREE from "three";
import { BuildCameraController } from "@/features/buildMode/BuildCameraController";
import {
  FLOOR_MATERIALS,
  ROOF_MATERIALS,
  STARTER_BUILD_CATALOG,
  WALL_MATERIALS,
} from "@/features/buildMode/starterLot";
import type {
  BuildDocument,
  BuildTimeOfDay,
  BuildWall,
  RoofVisibilityMode,
  WallVisibilityMode,
} from "@/features/buildMode/types";
import {
  createChamferBox,
  mergeGeometryBatch,
} from "@/lib/scene/geometryHelpers";
import { createEnvironmentMap, createSkyGradientTexture } from "@/lib/scene/materials";

export interface BuildSceneCallbacks {
  onHoverCell?: (gx: number, gz: number, worldX: number, worldZ: number, inBounds: boolean) => void;
  onSelectObject?: (hit: { kind: "wall" | "floor" | "opening" | "stair" | "roof" | "object"; id: string; label: string; detail: string } | null) => void;
  onStats?: (stats: BuildSceneStats) => void;
}

export interface BuildSceneStats {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface CutawayWallRecord {
  wall: BuildWall;
  midX: number;
  midZ: number;
  fullGroup: THREE.Group;
  cutawayGroup: THREE.Group;
  downGroup: THREE.Group;
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m?.dispose();
      } else {
        mat?.dispose();
      }
    }
  });
}

function addWallBoxPart(
  bucket: THREE.BufferGeometry[],
  centerX: number,
  centerY: number,
  centerZ: number,
  lenX: number,
  heightY: number,
  thickZ: number,
  yaw: number,
): void {
  if (lenX <= 0.01 || heightY <= 0.01 || thickZ <= 0.01) return;
  const g = new THREE.BoxGeometry(lenX, heightY, thickZ);
  g.rotateY(yaw);
  g.translate(centerX, centerY, centerZ);
  bucket.push(g);
}

/**
 * Splits a wall segment around doors/windows/arches cleanly into real geometric piers, lintels, and sills.
 */
function buildWallWithOpeningsGeometries(
  x1m: number,
  z1m: number,
  x2m: number,
  z2m: number,
  wallHeight: number,
  thickness: number,
  openings: BuildDocument["openings"],
): THREE.BufferGeometry | null {
  const dx = x2m - x1m;
  const dz = z2m - z1m;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return null;

  const yaw = -Math.atan2(dz, dx);
  const ux = dx / len;
  const uz = dz / len;

  // Miter slight endpad (half thickness) so perpendicular corners seal seamlessly without gaps
  const pad = thickness * 0.48;
  const spans = openings
    .map((o) => {
      const c = Math.max(0.05, Math.min(0.95, o.tCenter)) * len;
      const half = Math.min(len * 0.45, o.width * 0.5);
      return {
        start: Math.max(0.05, c - half),
        end: Math.min(len - 0.05, c + half),
        sill: Math.max(0, Math.min(wallHeight - 0.2, o.sillHeight)),
        top: Math.max(0.3, Math.min(wallHeight - 0.08, o.sillHeight + o.height)),
      };
    })
    .filter((s) => s.end - s.start > 0.08)
    .sort((a, b) => a.start - b.start);

  const geos: THREE.BufferGeometry[] = [];
  let cursor = -pad;

  for (const sp of spans) {
    if (sp.start > cursor + 0.01) {
      const segLen = sp.start - cursor;
      const mid = (cursor + sp.start) * 0.5;
      addWallBoxPart(geos, x1m + ux * mid, wallHeight * 0.5, z1m + uz * mid, segLen, wallHeight, thickness, yaw);
    }
    const opLen = sp.end - sp.start;
    const opMid = (sp.start + sp.end) * 0.5;
    if (sp.sill > 0.04) {
      addWallBoxPart(geos, x1m + ux * opMid, sp.sill * 0.5, z1m + uz * opMid, opLen, sp.sill, thickness, yaw);
    }
    if (wallHeight - sp.top > 0.05) {
      const lintelH = wallHeight - sp.top;
      addWallBoxPart(geos, x1m + ux * opMid, sp.top + lintelH * 0.5, z1m + uz * opMid, opLen, lintelH, thickness, yaw);
    }
    cursor = sp.end;
  }

  const endLimit = len + pad;
  if (endLimit > cursor + 0.01) {
    const segLen = endLimit - cursor;
    const mid = (cursor + endLimit) * 0.5;
    addWallBoxPart(geos, x1m + ux * mid, wallHeight * 0.5, z1m + uz * mid, segLen, wallHeight, thickness, yaw);
  }

  return mergeGeometryBatch(geos);
}

/**
 * Pure Data-to-Render Three.js scene for the new Sims 4-inspired Build Mode.
 */
export class BuildScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: BuildSceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  public readonly cameraCtrl: BuildCameraController;

  private readonly envGroup = new THREE.Group();
  private readonly neighborsGroup = new THREE.Group();
  private readonly buildingGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();

  private readonly levelGroups = new Map<number, THREE.Group>();
  private readonly roofGroups = new Map<number, THREE.Group>();
  private readonly cutawayWallsByLevel = new Map<number, CutawayWallRecord[]>();

  private gridMesh: THREE.LineSegments | null = null;
  private hoverTileMesh: THREE.Mesh | null = null;

  // Lighting
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private skyTex: THREE.Texture | null = null;
  private envTex: THREE.Texture | null = null;

  // Active state
  private doc: BuildDocument | null = null;
  private activeLevel = 0;
  private wallVisibility: WallVisibilityMode = "cutaway";
  private roofVisibility: RoofVisibilityMode = "auto";
  private lastCutawayYaw = Number.NaN;

  // Raycast scratch
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();
  private readonly activeFloorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private rafId: number | null = null;
  private lastFrameMs = performance.now();
  private fpsSamples: number[] = [];
  private disposed = false;
  private pointerDownPos = { x: 0, y: 0 };

  private readonly onResizeBound = () => this.handleResize();
  private readonly onVisibilityBound = () => this.handleVisibility();
  private readonly onPointerMoveBound = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerDownBound = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerUpBound = (e: PointerEvent) => this.handlePointerUp(e);

  constructor(canvas: HTMLCanvasElement, callbacks: BuildSceneCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.skyTex = createSkyGradientTexture(11.5, "kemarau", 0);
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.FogExp2("#d9ebfa", 0.0085);

    this.envTex = createEnvironmentMap(this.renderer, 11.5, 0);
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.55;

    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    this.cameraCtrl = new BuildCameraController(canvas, aspect);

    // Warm stylized Sims 4 afternoon key + sky/grass bounce + cool fill
    this.hemiLight = new THREE.HemisphereLight("#e5f2ff", "#6e8755", 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight("#fff2d9", 2.35);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 65;
    this.sunLight.shadow.camera.left = -14;
    this.sunLight.shadow.camera.right = 14;
    this.sunLight.shadow.camera.top = 18;
    this.sunLight.shadow.camera.bottom = -18;
    this.sunLight.target.position.set(2.5, 1.5, 8.5);
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.fillLight = new THREE.DirectionalLight("#b8d7f8", 0.6);
    this.fillLight.position.set(-12, 10, 18);
    this.scene.add(this.fillLight);

    this.scene.add(this.envGroup);
    this.scene.add(this.neighborsGroup);
    this.scene.add(this.buildingGroup);
    this.scene.add(this.overlayGroup);

    this.buildNeighborhoodEnvironment();
    this.buildCursorHighlight();

    this.handleResize();
    window.addEventListener("resize", this.onResizeBound);
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
    document.removeEventListener("visibilitychange", this.onVisibilityBound);
    this.canvas.removeEventListener("pointermove", this.onPointerMoveBound);
    this.canvas.removeEventListener("pointerdown", this.onPointerDownBound);
    this.canvas.removeEventListener("pointerup", this.onPointerUpBound);
    this.cameraCtrl.dispose();

    disposeObjectTree(this.envGroup);
    disposeObjectTree(this.neighborsGroup);
    disposeObjectTree(this.buildingGroup);
    disposeObjectTree(this.overlayGroup);
    this.skyTex?.dispose();
    this.envTex?.dispose();
    this.renderer.dispose();
  }

  private buildNeighborhoodEnvironment(): void {
    // Broad warm lawn ground surrounding lot
    const lawnMat = new THREE.MeshStandardMaterial({ color: "#7ba656", roughness: 0.94, metalness: 0.0 });
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), lawnMat);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(2.5, -0.02, 8.5);
    lawn.receiveShadow = true;
    this.envGroup.add(lawn);

    // Subtle striped yard lawn around plot for warmth
    const stripeMat = new THREE.MeshStandardMaterial({ color: "#729c4e", roughness: 0.94 });
    const stripeGeos: THREE.BufferGeometry[] = [];
    for (let z = -6; z < 26; z += 2) {
      const s = new THREE.PlaneGeometry(80, 1.0);
      s.rotateX(-Math.PI / 2);
      s.translate(2.5, -0.015, z);
      stripeGeos.push(s);
    }
    const mergedStripes = mergeGeometryBatch(stripeGeos);
    if (mergedStripes) {
      const stripes = new THREE.Mesh(mergedStripes, stripeMat);
      stripes.receiveShadow = true;
      this.envGroup.add(stripes);
    }

    // Front neighborhood street & sidewalk apron (Z < 0)
    const roadMat = new THREE.MeshStandardMaterial({ color: "#3b4048", roughness: 0.88 });
    const road = new THREE.Mesh(new THREE.BoxGeometry(60, 0.06, 5.2), roadMat);
    road.position.set(2.5, -0.01, -4.1);
    road.receiveShadow = true;
    this.envGroup.add(road);

    const sidewalkMat = new THREE.MeshStandardMaterial({ color: "#c2beb5", roughness: 0.86 });
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(60, 0.1, 1.45), sidewalkMat);
    sidewalk.position.set(2.5, 0.03, -0.78);
    sidewalk.receiveShadow = true;
    this.envGroup.add(sidewalk);

    // Street trees cleanly outside buildable 5x17 area
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#6f4e37", roughness: 0.88 });
    const crownMat = new THREE.MeshStandardMaterial({ color: "#588b43", roughness: 0.82 });
    const treePositions: [number, number][] = [
      [-3.5, -1.2],
      [8.5, -1.2],
      [-5.5, 19.5],
      [10.2, 20.5],
    ];
    for (const [tx, tz] of treePositions) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 1.8, 8), trunkMat);
      trunk.position.set(tx, 0.9, tz);
      trunk.castShadow = true;
      this.envGroup.add(trunk);

      const crownA = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 1), crownMat);
      crownA.position.set(tx, 2.35, tz);
      crownA.castShadow = true;
      crownA.receiveShadow = true;
      this.envGroup.add(crownA);
    }

    // Subtle semi-transparent neighbor house blocks (left X < 0, right X > 5.0)
    const neighborMat = new THREE.MeshStandardMaterial({
      color: "#cbd4df",
      roughness: 0.85,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    const leftHouse = new THREE.Mesh(new THREE.BoxGeometry(5.0, 6.2, 12.5), neighborMat);
    leftHouse.position.set(-2.72, 3.1, 10.0);
    const rightHouse = new THREE.Mesh(new THREE.BoxGeometry(5.0, 6.4, 12.5), neighborMat);
    rightHouse.position.set(7.72, 3.2, 10.0);
    this.neighborsGroup.add(leftHouse, rightHouse);
  }

  private buildCursorHighlight(): void {
    const geo = new THREE.PlaneGeometry(0.5, 0.5);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: "#3bc48d",
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.hoverTileMesh = new THREE.Mesh(geo, mat);
    this.hoverTileMesh.visible = false;
    this.overlayGroup.add(this.hoverTileMesh);
  }

  public setDocument(doc: BuildDocument): void {
    this.doc = doc;
    this.rebuildBuildingGeometry(doc);
    this.rebuildGridOverlay(doc);
    this.cameraCtrl.setBounds({
      minX: -4.5,
      maxX: doc.lot.cols * doc.lot.cellSize + 4.5,
      minZ: -5.5,
      maxZ: doc.lot.rows * doc.lot.cellSize + 5.5,
    });
    this.applyLevelAndVisibilityState();
  }

  public setViewOptions(opts: {
    activeLevel: number;
    wallVisibility: WallVisibilityMode;
    roofVisibility: RoofVisibilityMode;
    timeOfDay: BuildTimeOfDay;
    gridVisible: boolean;
    neighborsVisible: boolean;
    snap90Enabled: boolean;
    edgeScrollEnabled: boolean;
  }): void {
    const levelChanged = this.activeLevel !== opts.activeLevel;
    this.activeLevel = opts.activeLevel;
    this.wallVisibility = opts.wallVisibility;
    this.roofVisibility = opts.roofVisibility;
    this.neighborsGroup.visible = opts.neighborsVisible;
    if (this.gridMesh) this.gridMesh.visible = opts.gridVisible;

    this.cameraCtrl.setSnap90Enabled(opts.snap90Enabled);
    this.cameraCtrl.setEdgeScrollEnabled(opts.edgeScrollEnabled);
    this.applyLightingTime(opts.timeOfDay);

    if (this.doc && levelChanged) {
      const lvl = this.doc.levels.find((l) => l.index === opts.activeLevel);
      const elev = (lvl?.elevation ?? 0) + this.doc.lot.foundationHeight;
      this.cameraCtrl.setTargetElevation(elev);
      this.activeFloorPlane.constant = -elev;
      this.rebuildGridOverlay(this.doc);
    }
    this.applyLevelAndVisibilityState();
  }

  private applyLightingTime(tod: BuildTimeOfDay): void {
    switch (tod) {
      case "morning":
        this.sunLight.position.set(18, 13, 6);
        this.sunLight.color.set("#ffe6bf");
        this.sunLight.intensity = 2.05;
        this.hemiLight.intensity = 0.85;
        this.renderer.toneMappingExposure = 1.02;
        if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.set("#d9ecfa");
        break;
      case "noon":
        this.sunLight.position.set(12, 24, -9);
        this.sunLight.color.set("#fff4e0");
        this.sunLight.intensity = 2.35;
        this.hemiLight.intensity = 0.92;
        this.renderer.toneMappingExposure = 1.05;
        if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.set("#d9ebfa");
        break;
      case "sunset":
        this.sunLight.position.set(-16, 8, -14);
        this.sunLight.color.set("#ff9f5c");
        this.sunLight.intensity = 2.15;
        this.hemiLight.intensity = 0.7;
        this.renderer.toneMappingExposure = 0.98;
        if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.set("#e7c3ae");
        break;
      case "night":
        this.sunLight.position.set(-10, 18, 14);
        this.sunLight.color.set("#7da2d9");
        this.sunLight.intensity = 0.55;
        this.hemiLight.intensity = 0.38;
        this.renderer.toneMappingExposure = 0.86;
        if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.set("#1c2433");
        break;
    }
  }

  private rebuildGridOverlay(doc: BuildDocument): void {
    if (this.gridMesh) {
      this.overlayGroup.remove(this.gridMesh);
      this.gridMesh.geometry.dispose();
      (this.gridMesh.material as THREE.Material).dispose();
      this.gridMesh = null;
    }

    const cs = doc.lot.cellSize;
    const width = doc.lot.cols * cs;
    const depth = doc.lot.rows * cs;
    const lvl = doc.levels.find((l) => l.index === this.activeLevel);
    const y = doc.lot.foundationHeight + (lvl?.elevation ?? 0) + 0.032;

    const positions: number[] = [];
    const colors: number[] = [];
    const majorColor = new THREE.Color("#dbe7f2");
    const minorColor = new THREE.Color("#9db2c4");
    const borderColor = new THREE.Color("#f09b4b");

    for (let gx = 0; gx <= doc.lot.cols; gx++) {
      const x = gx * cs;
      const isBorder = gx === 0 || gx === doc.lot.cols;
      const isMajor = gx % 2 === 0;
      const col = isBorder ? borderColor : isMajor ? majorColor : minorColor;
      positions.push(x, y, 0, x, y, depth);
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }

    for (let gz = 0; gz <= doc.lot.rows; gz++) {
      const z = gz * cs;
      const isBorder = gz === 0 || gz === doc.lot.rows;
      const isMajor = gz % 2 === 0;
      const col = isBorder ? borderColor : isMajor ? majorColor : minorColor;
      positions.push(0, y, z, width, y, z);
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.gridMesh = new THREE.LineSegments(geo, mat);
    this.overlayGroup.add(this.gridMesh);
  }

  private rebuildBuildingGeometry(doc: BuildDocument): void {
    disposeObjectTree(this.buildingGroup);
    this.buildingGroup.clear();
    this.levelGroups.clear();
    this.roofGroups.clear();
    this.cutawayWallsByLevel.clear();

    const cs = doc.lot.cellSize;
    const width = doc.lot.cols * cs;
    const depth = doc.lot.rows * cs;
    const plinthH = doc.lot.foundationHeight;

    // 1. Foundation Plinth under the 5x17m kavling
    const plinthGeo = createChamferBox(width + 0.08, plinthH, depth + 0.08, 0.02, 1);
    const plinthMat = new THREE.MeshStandardMaterial({ color: "#80868d", roughness: 0.88 });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.set(width * 0.5, plinthH * 0.5, depth * 0.5);
    plinthMesh.receiveShadow = true;
    plinthMesh.castShadow = true;
    this.buildingGroup.add(plinthMesh);

    // Ensure level groups exist for every level
    for (const lvl of doc.levels) {
      const lg = new THREE.Group();
      lg.name = `level-${lvl.index}`;
      this.buildingGroup.add(lg);
      this.levelGroups.set(lvl.index, lg);
      this.cutawayWallsByLevel.set(lvl.index, []);
    }

    // 2. Floor Tiles per Level (batched per material -> low draw calls!)
    const floorBatches = new Map<string, { levelIndex: number; matId: string; geos: THREE.BufferGeometry[]; sampleCellId: string }>();
    for (const cell of Object.values(doc.floorCells)) {
      const key = `${cell.levelIndex}:${cell.materialId}`;
      let b = floorBatches.get(key);
      if (!b) {
        b = { levelIndex: cell.levelIndex, matId: cell.materialId, geos: [], sampleCellId: `${cell.levelIndex}:${cell.gx}:${cell.gz}` };
        floorBatches.set(key, b);
      }
      const lvl = doc.levels.find((l) => l.index === cell.levelIndex);
      const baseY = plinthH + (lvl?.elevation ?? 0);
      const thick = cell.levelIndex === 0 ? 0.035 : 0.14;
      const g = new THREE.BoxGeometry(cs, thick, cs);
      g.translate((cell.gx + 0.5) * cs, baseY + (cell.levelIndex === 0 ? 0.015 : -thick * 0.5 + 0.02), (cell.gz + 0.5) * cs);
      b.geos.push(g);
    }

    for (const batch of floorBatches.values()) {
      const merged = mergeGeometryBatch(batch.geos);
      if (!merged) continue;
      const info = FLOOR_MATERIALS[batch.matId] ?? FLOOR_MATERIALS.granite_warm!;
      const mat = new THREE.MeshStandardMaterial({
        color: info.hex,
        roughness: info.roughness,
        metalness: batch.matId === "pool_water" ? 0.12 : 0.03,
        transparent: batch.matId === "pool_water",
        opacity: batch.matId === "pool_water" ? 0.84 : 1,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.userData.selectHit = {
        kind: "floor",
        id: batch.sampleCellId,
        label: info.name,
        detail: `Lantai ${batch.levelIndex + 1} · Area ubin material ${info.name}`,
      };
      this.levelGroups.get(batch.levelIndex)?.add(mesh);
    }

    // 3. Walls + Openings + Pre-built Full/Cutaway/Down representations
    const frameMat = new THREE.MeshStandardMaterial({ color: "#3d332a", roughness: 0.58 });
    const doorWoodMat = new THREE.MeshStandardMaterial({ color: "#8e5f39", roughness: 0.52 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: "#a7d4f2",
      roughness: 0.1,
      metalness: 0.15,
      transparent: true,
      opacity: 0.42,
    });
    const capMat = new THREE.MeshStandardMaterial({ color: "#2d323a", roughness: 0.85 });

    for (const wall of doc.walls) {
      const lvl = doc.levels.find((l) => l.index === wall.levelIndex);
      const baseY = plinthH + (lvl?.elevation ?? 0);
      const lg = this.levelGroups.get(wall.levelIndex);
      if (!lg) continue;

      const x1m = wall.x1 * cs;
      const z1m = wall.z1 * cs;
      const x2m = wall.x2 * cs;
      const z2m = wall.z2 * cs;
      const wallOps = doc.openings.filter((o) => o.wallId === wall.id);
      const outerInfo = WALL_MATERIALS[wall.paintOuterId] ?? WALL_MATERIALS.plaster_warm!;
      const wallMat = new THREE.MeshStandardMaterial({ color: outerInfo.hex, roughness: outerInfo.roughness });

      const wallWrap = new THREE.Group();
      lg.add(wallWrap);

      const hitPayload = {
        kind: "wall" as const,
        id: wall.id,
        label: wall.kind === "fence" ? "Pagar / Railing" : `Dinding (${outerInfo.name})`,
        detail: `Panjang ${(Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) * cs).toFixed(1)} m · Tebal ${(wall.thickness * 100).toFixed(0)} cm`,
      };

      // Full height group
      const fullGroup = new THREE.Group();
      const fullGeo = buildWallWithOpeningsGeometries(x1m, z1m, x2m, z2m, wall.height, wall.thickness, wallOps);
      if (fullGeo) {
        const mesh = new THREE.Mesh(fullGeo, wallMat);
        mesh.position.y = baseY;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.selectHit = hitPayload;
        fullGroup.add(mesh);
      }
      // Door / window visual frames inside fullGroup
      const dx = x2m - x1m;
      const dz = z2m - z1m;
      const wLen = Math.hypot(dx, dz) || 1;
      const wYaw = -Math.atan2(dz, dx);
      for (const op of wallOps) {
        const cx = x1m + dx * op.tCenter;
        const cz = z1m + dz * op.tCenter;
        const opGroup = new THREE.Group();
        opGroup.position.set(cx, baseY + op.sillHeight + op.height * 0.5, cz);
        opGroup.rotation.y = wYaw;

        const frameThick = wall.thickness + 0.03;
        const topF = new THREE.Mesh(new THREE.BoxGeometry(op.width, 0.05, frameThick), frameMat);
        topF.position.y = op.height * 0.5 - 0.025;
        const leftF = new THREE.Mesh(new THREE.BoxGeometry(0.05, op.height, frameThick), frameMat);
        leftF.position.x = -op.width * 0.5 + 0.025;
        const rightF = new THREE.Mesh(new THREE.BoxGeometry(0.05, op.height, frameThick), frameMat);
        rightF.position.x = op.width * 0.5 - 0.025;
        opGroup.add(topF, leftF, rightF);

        if (op.kind === "window") {
          const pane = new THREE.Mesh(new THREE.BoxGeometry(op.width - 0.08, op.height - 0.08, 0.02), glassMat);
          opGroup.add(pane);
        } else if (op.kind === "door") {
          const leafW = Math.min(0.9, op.width - 0.08);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, op.height - 0.05, 0.04), doorWoodMat);
          // Hinged open subtly by 25 deg if openable
          leaf.position.set(-op.width * 0.5 + 0.05 + leafW * 0.42, 0, op.isOpen ? leafW * 0.25 : 0);
          leaf.rotation.y = op.isOpen ? 0.55 : 0;
          leaf.castShadow = true;
          opGroup.add(leaf);
        }
        fullGroup.add(opGroup);
      }

      // Cutaway (0.44m) & Down (0.24m) groups with dark section top cap
      const makeStubGroup = (stubH: number) => {
        const grp = new THREE.Group();
        const effectiveH = Math.min(wall.height, stubH);
        const geo = new THREE.BoxGeometry(wLen + wall.thickness * 0.85, effectiveH, wall.thickness);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set((x1m + x2m) * 0.5, baseY + effectiveH * 0.5, (z1m + z2m) * 0.5);
        mesh.rotation.y = wYaw;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.selectHit = hitPayload;
        grp.add(mesh);

        const capGeo = new THREE.BoxGeometry(wLen + wall.thickness * 0.85, 0.025, wall.thickness + 0.01);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set((x1m + x2m) * 0.5, baseY + effectiveH + 0.012, (z1m + z2m) * 0.5);
        cap.rotation.y = wYaw;
        grp.add(cap);
        return grp;
      };

      const cutawayGroup = makeStubGroup(wall.kind === "fence" ? wall.height : 0.44);
      const downGroup = makeStubGroup(wall.kind === "fence" ? 0.24 : 0.24);
      cutawayGroup.visible = false;
      downGroup.visible = false;

      wallWrap.add(fullGroup, cutawayGroup, downGroup);

      this.cutawayWallsByLevel.get(wall.levelIndex)?.push({
        wall,
        midX: (x1m + x2m) * 0.5,
        midZ: (z1m + z2m) * 0.5,
        fullGroup,
        cutawayGroup,
        downGroup,
      });
    }

    // 4. Stairs preview steps
    const treadMat = new THREE.MeshStandardMaterial({ color: "#9b6b43", roughness: 0.54 });
    const stringerMat = new THREE.MeshStandardMaterial({ color: "#32373e", roughness: 0.42, metalness: 0.45 });
    for (const st of doc.stairs) {
      const lvl = doc.levels.find((l) => l.index === st.levelIndex);
      const lg = this.levelGroups.get(st.levelIndex);
      if (!lvl || !lg) continue;

      const baseY = plinthH + lvl.elevation;
      const wM = st.widthCells * cs;
      const lM = st.lengthCells * cs;
      const steps = 16;
      const stepH = lvl.height / steps;
      const stepD = lM / steps;

      const stGroup = new THREE.Group();
      const cx = (st.gx + st.widthCells * 0.5) * cs;
      const cz = (st.gz + st.lengthCells * 0.5) * cs;
      stGroup.position.set(cx, baseY, cz);
      stGroup.rotation.y = st.rotationQuarter * (Math.PI / 2);

      const treadGeos: THREE.BufferGeometry[] = [];
      for (let i = 0; i < steps; i++) {
        const tg = createChamferBox(wM - 0.06, 0.055, stepD + 0.02, 0.008, 1);
        tg.translate(0, (i + 1) * stepH - 0.028, -lM * 0.5 + (i + 0.5) * stepD);
        treadGeos.push(tg);
      }
      const mergedTreads = mergeGeometryBatch(treadGeos);
      if (mergedTreads) {
        const treadsMesh = new THREE.Mesh(mergedTreads, treadMat);
        treadsMesh.castShadow = true;
        treadsMesh.receiveShadow = true;
        treadsMesh.userData.selectHit = {
          kind: "stair",
          id: st.id,
          label: "Tangga Utama LT1 → LT2",
          detail: `${steps} anak tangga · Lebar ${wM.toFixed(1)} m · Panjang ${lM.toFixed(1)} m`,
        };
        stGroup.add(treadsMesh);
      }

      // Steel stringer rail
      const beamLen = Math.hypot(lM, lvl.height);
      const pitch = Math.atan2(lvl.height, lM);
      const sGeo = new THREE.BoxGeometry(0.06, 0.14, beamLen);
      const rail = new THREE.Mesh(sGeo, stringerMat);
      rail.position.set(wM * 0.5 - 0.04, lvl.height * 0.5 - 0.12, 0);
      rail.rotation.x = -pitch;
      stGroup.add(rail);

      lg.add(stGroup);
    }

    // 5. Roofs (grouped per levelIndex so RoofVisibility controls cleanly)
    for (const roof of doc.roofs) {
      const rg = new THREE.Group();
      const matInfo = ROOF_MATERIALS[roof.materialId] ?? ROOF_MATERIALS.standing_seam_slate!;
      const rMat = new THREE.MeshStandardMaterial({
        color: matInfo.hex,
        roughness: matInfo.roughness,
        metalness: matInfo.metalness,
      });

      const x1 = roof.gx1 * cs - roof.overhang;
      const x2 = roof.gx2 * cs + roof.overhang;
      const z1 = roof.gz1 * cs - roof.overhang;
      const z2 = roof.gz2 * cs + roof.overhang;
      const rw = Math.abs(x2 - x1);
      const rd = Math.abs(z2 - z1);
      const tilt = (roof.pitchDeg * Math.PI) / 180;
      const roofPanel = new THREE.Mesh(createChamferBox(rw, 0.16, rd / Math.cos(tilt), 0.015, 1), rMat);
      roofPanel.position.set((x1 + x2) * 0.5, plinthH + roof.eaveHeight + Math.tan(tilt) * rd * 0.5, (z1 + z2) * 0.5);
      roofPanel.rotation.x = tilt;
      roofPanel.castShadow = true;
      roofPanel.receiveShadow = true;
      roofPanel.userData.selectHit = {
        kind: "roof",
        id: roof.id,
        label: `Atap ${matInfo.name}`,
        detail: `Kemiringan ${roof.pitchDeg}° · Overstek ${roof.overhang} m`,
      };
      rg.add(roofPanel);
      this.buildingGroup.add(rg);
      this.roofGroups.set(roof.levelIndex, rg);
    }

    // 6. Starter Furniture / Lighting Objects preview
    for (const obj of doc.objects) {
      const lvl = doc.levels.find((l) => l.index === obj.levelIndex);
      const lg = this.levelGroups.get(obj.levelIndex);
      if (!lvl || !lg) continue;

      const baseY = plinthH + lvl.elevation + obj.y;
      const itemInfo = STARTER_BUILD_CATALOG.find((c) => c.id === obj.catalogId);
      const [ow, oh, od] = itemInfo?.sizeM ?? [0.8, 0.8, 0.8];

      const oGroup = new THREE.Group();
      oGroup.position.set(obj.x, baseY, obj.z);
      oGroup.rotation.y = obj.rotationY;

      if (obj.catalogId === "lamp_pendant_warm") {
        const shade = new THREE.Mesh(
          new THREE.ConeGeometry(0.24, 0.2, 16),
          new THREE.MeshStandardMaterial({ color: "#d6a553", metalness: 0.55, roughness: 0.35 }),
        );
        shade.position.y = oh * 0.25;
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 12, 12),
          new THREE.MeshStandardMaterial({ color: "#fff6dc", emissive: "#ffcb77", emissiveIntensity: 1.6 }),
        );
        const point = new THREE.PointLight("#ffd699", 2.4, 7.5, 1.8);
        point.position.y = -0.15;
        oGroup.add(shade, bulb, point);
      } else {
        const bodyMat = new THREE.MeshStandardMaterial({ color: "#cfc5b4", roughness: 0.78 });
        const legMat = new THREE.MeshStandardMaterial({ color: "#6e4e35", roughness: 0.55 });
        const seat = new THREE.Mesh(createChamferBox(ow, oh * 0.45, od, 0.03, 2), bodyMat);
        seat.position.y = oh * 0.32;
        seat.castShadow = true;
        seat.receiveShadow = true;
        const back = new THREE.Mesh(createChamferBox(ow, oh * 0.55, od * 0.24, 0.03, 2), bodyMat);
        back.position.set(0, oh * 0.68, -od * 0.36);
        back.castShadow = true;
        const base = new THREE.Mesh(new THREE.BoxGeometry(ow * 0.94, 0.1, od * 0.92), legMat);
        base.position.y = 0.05;
        seat.userData.selectHit = {
          kind: "object",
          id: obj.id,
          label: itemInfo?.name ?? obj.catalogId,
          detail: `Lantai ${obj.levelIndex + 1} · Ukuran ${ow.toFixed(1)} × ${od.toFixed(1)} m`,
        };
        oGroup.add(seat, back, base);
      }
      lg.add(oGroup);
    }

    this.lastCutawayYaw = Number.NaN;
  }

  private applyLevelAndVisibilityState(): void {
    // Show active level and below; hide floors strictly above active level
    for (const [lvlIdx, grp] of this.levelGroups.entries()) {
      grp.visible = lvlIdx <= this.activeLevel;
    }

    // Roof visibility rule
    const maxLevel = this.doc ? Math.max(...this.doc.levels.map((l) => l.index)) : 2;
    for (const rg of this.roofGroups.values()) {
      if (this.roofVisibility === "show") rg.visible = true;
      else if (this.roofVisibility === "hide") rg.visible = false;
      else rg.visible = this.activeLevel >= maxLevel;
    }

    this.updateWallCutawayVisibility(true);
  }

  private updateWallCutawayVisibility(force = false): void {
    const yaw = this.cameraCtrl.getCurrentYaw();
    if (!force && Math.abs(yaw - this.lastCutawayYaw) < 0.06) return;
    this.lastCutawayYaw = yaw;

    const camPos = this.cameraCtrl.camera.position;
    const lotCenterX = this.doc ? this.doc.lot.cols * this.doc.lot.cellSize * 0.5 : 2.5;
    const lotCenterZ = this.doc ? this.doc.lot.rows * this.doc.lot.cellSize * 0.5 : 8.5;
    const camDirX = camPos.x - lotCenterX;
    const camDirZ = camPos.z - lotCenterZ;
    const camLen = Math.hypot(camDirX, camDirZ) || 1;
    const ux = camDirX / camLen;
    const uz = camDirZ / camLen;

    for (const [lvlIdx, records] of this.cutawayWallsByLevel.entries()) {
      if (lvlIdx > this.activeLevel) continue;
      for (const rec of records) {
        if (this.wallVisibility === "up" || lvlIdx < this.activeLevel) {
          rec.fullGroup.visible = true;
          rec.cutawayGroup.visible = false;
          rec.downGroup.visible = false;
        } else if (this.wallVisibility === "down") {
          rec.fullGroup.visible = false;
          rec.cutawayGroup.visible = false;
          rec.downGroup.visible = true;
        } else {
          // Cutaway on active level: camera-side walls drop cleanly so interior rooms open to view
          const wx = rec.midX - lotCenterX;
          const wz = rec.midZ - lotCenterZ;
          const dot = wx * ux + wz * uz;
          const isFrontFacing = dot > 0.25;
          rec.fullGroup.visible = !isFrontFacing;
          rec.cutawayGroup.visible = isFrontFacing;
          rec.downGroup.visible = false;
        }
      }
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.doc || !this.hoverTileMesh) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.camera);
    const hit = this.raycaster.ray.intersectPlane(this.activeFloorPlane, this.hitPoint);
    if (!hit) {
      this.hoverTileMesh.visible = false;
      return;
    }

    const cs = this.doc.lot.cellSize;
    const gx = Math.floor(hit.x / cs);
    const gz = Math.floor(hit.z / cs);
    const inBounds = gx >= 0 && gx < this.doc.lot.cols && gz >= 0 && gz < this.doc.lot.rows;

    this.hoverTileMesh.visible = inBounds;
    if (inBounds) {
      const lvl = this.doc.levels.find((l) => l.index === this.activeLevel);
      const y = this.doc.lot.foundationHeight + (lvl?.elevation ?? 0) + 0.036;
      this.hoverTileMesh.position.set((gx + 0.5) * cs, y, (gz + 0.5) * cs);
    }
    this.callbacks.onHoverCell?.(gx, gz, hit.x, hit.z, inBounds);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button === 0) {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;
    const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dist > 6) return;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.camera);
    const hits = this.raycaster.intersectObjects(this.buildingGroup.children, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      let cur: THREE.Object3D | null = h.object;
      let ancestorVisible = true;
      while (cur) {
        if (!cur.visible) {
          ancestorVisible = false;
          break;
        }
        cur = cur.parent;
      }
      if (!ancestorVisible) continue;
      const sel = h.object.userData?.selectHit;
      if (sel) {
        this.callbacks.onSelectObject?.(sel);
        return;
      }
    }
    this.callbacks.onSelectObject?.(null);
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.cameraCtrl.setAspect(w / h);
  }

  private handleVisibility(): void {
    if (!document.hidden) {
      this.lastFrameMs = performance.now();
    }
  }

  private startLoop(): void {
    const tick = (now: number) => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);
      if (document.hidden) return;

      const dt = (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;

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
          this.callbacks.onStats?.(snap);
        }
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
