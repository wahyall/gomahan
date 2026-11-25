import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { SelectionTarget } from "@/lib/store/useStudioStore";
import { createChamferBox, mergeGeometryBatch, StaticBatchCollector } from "@/lib/scene/geometryHelpers";
import type { MaterialPalette } from "@/lib/scene/materials";
import { buildFurnitureMesh, buildHvacMesh, buildLightFixtureMesh } from "@/lib/scene/propsBuilder";

// Ensure BVH raycast helpers are active globally on Three BufferGeometry / Mesh
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
  computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree =
  disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export function attachBvh(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  (geo as unknown as { computeBoundsTree?: () => void }).computeBoundsTree?.();
  return geo;
}

export interface WallCutawayRecord {
  wallId: string;
  levelIndex: 0 | 1;
  midX: number;
  midZ: number;
  exterior: boolean;
  fullGroup: THREE.Group;
  cutawayGroup: THREE.Group;
  downGroup: THREE.Group;
}

export interface ProjectHouseBuildOptions {
  stage: number;
  showBricks: boolean;
  showStructure: boolean;
  showRoof: boolean;
  showRangka: boolean;
  showFinishing: boolean;
  xrayRebar: boolean;
  showAir: boolean;
  showListrik: boolean;
  hiddenParts: Set<string>;
  activeLevelView: "all" | "lt1" | "lt2_cut";
  supportWallCutaway?: boolean;
  hideUpperPropsInLt1?: boolean;
  onExplodePiece?: (obj: THREE.Object3D, off: THREE.Vector3) => void;
  onExplodeInstanced?: (im: THREE.InstancedMesh, off: Float32Array) => void;
}

export interface BuiltProjectHouseResult {
  houseRoot: THREE.Group;
  levelRoots: [THREE.Group, THREE.Group];
  lt2StructuralGroup: THREE.Group;
  roofGroup: THREE.Group;
  wallCutawayRecords: WallCutawayRecord[];
  pickables: THREE.Object3D[];
  resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[];
  animatedFans: THREE.Object3D[];
}

export function buildStaticNeighborhood(
  envGroup: THREE.Group,
  neighborsGroup: THREE.Group,
  palette: MaterialPalette,
  contactShadowTex: THREE.Texture | null,
  staticDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
): void {
  const groundGeo = new THREE.PlaneGeometry(140, 140);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, palette.grass);
  ground.position.set(2.5, -0.055, 8.5);
  ground.receiveShadow = true;
  envGroup.add(ground);

  const roadGeo = new THREE.BoxGeometry(90, 0.06, 6.25);
  const road = new THREE.Mesh(roadGeo, palette.road);
  road.position.set(2.5, -0.04, -3.65);
  road.receiveShadow = true;
  envGroup.add(road);

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
    envGroup.add(m);
  }

  const curbMat = new THREE.MeshStandardMaterial({ color: 0x7b8087, roughness: 0.88, metalness: 0.02 });
  const grateMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.55, metalness: 0.72 });
  const drainDarkMat = new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.95 });

  const gutterFrontWall = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 0.12), curbMat);
  gutterFrontWall.position.set(2.5, -0.015, -0.52);
  gutterFrontWall.receiveShadow = true;
  const gutterBackWall = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 0.12), curbMat);
  gutterBackWall.position.set(2.5, -0.015, -0.06);
  gutterBackWall.receiveShadow = true;
  const gutterBed = new THREE.Mesh(new THREE.BoxGeometry(28, 0.02, 0.36), drainDarkMat);
  gutterBed.position.set(2.5, -0.045, -0.29);
  gutterBed.receiveShadow = true;
  envGroup.add(gutterFrontWall, gutterBackWall, gutterBed);

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
    envGroup.add(m);
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
    envGroup.add(gm);
  }

  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  staticDisposables.push(shadowMat, groundGeo, roadGeo, stripeMat, curbMat, grateMat, drainDarkMat);

  const addNeighborHouse = (cx: number, labelSide: string) => {
    const grp = new THREE.Group();
    grp.name = `neighbor-${labelSide}`;

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
      const wm = new THREE.Mesh(mergedWall, palette.neighborWall);
      wm.castShadow = true;
      wm.receiveShadow = true;
      grp.add(wm);
    }

    const nRoof = createChamferBox(4.96, 0.24, 13.8, 0.025, 1);
    nRoof.rotateX(-0.14);
    nRoof.translate(cx, 7.62, 10.5);
    const rm = new THREE.Mesh(nRoof, palette.neighborRoof);
    rm.castShadow = true;
    rm.receiveShadow = true;
    grp.add(rm);

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

    const treeZ = -0.82;
    const treeX = cx + (labelSide === "left" ? 1.15 : -1.15);
    const trunkGeo = new THREE.CylinderGeometry(0.085, 0.14, 2.55, 8);
    trunkGeo.translate(treeX, 1.25, treeZ);
    const trunk = new THREE.Mesh(trunkGeo, palette.woodTeak);
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

    const discGeo = new THREE.PlaneGeometry(2.3, 2.3);
    discGeo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, shadowMat);
    disc.position.set(treeX, 0.008, treeZ);
    grp.add(disc);
    neighborsGroup.add(grp);
    staticDisposables.push(winMat, foliageMat);
  };

  addNeighborHouse(-2.58, "left");
  addNeighborHouse(7.58, "right");
}

function buildCutoutRoofGeometry(
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

  const pts: [number, number][] = [];
  const voidHitsX =
    voidCut && voidCut.x1 > x0 + 0.04 && voidCut.x0 < x1 - 0.04 && voidCut.z0 < z1 - 0.04 && voidCut.z1 > z0 + 0.04;

  let effectiveZ1 = z1;
  if (voidHitsX && voidCut) {
    const vx0 = Math.max(x0, voidCut.x0);
    const vx1 = Math.min(x1, voidCut.x1);
    const vz0 = Math.max(z0, voidCut.z0);
    if (vx0 <= x0 + 0.04 && vx1 >= x1 - 0.04) {
      effectiveZ1 = vz0;
      if (effectiveZ1 - z0 < 0.08) return null;
      pts.push([x0, z0], [x1, z0], [x1, effectiveZ1], [x0, effectiveZ1]);
    } else if (vx1 >= x1 - 0.04) {
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

function buildAcCondenserUnit(
  x: number,
  y: number,
  z: number,
  rotY: number,
  resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
): THREE.Group {
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
  resources.push(bodyGeo, bodyMat, grilleGeo, grilleMat);
  return g;
}

const CUSTOM_PAINT_HEX: Record<string, { hex: string; roughness: number }> = {
  wall_sage: { hex: "#cad6c7", roughness: 0.84 },
  wall_cream: { hex: "#dfd5c3", roughness: 0.85 },
  wall_terracotta: { hex: "#a9523b", roughness: 0.88 },
  wall_timber: { hex: "#9c6d45", roughness: 0.62 },
  wall_andesit: { hex: "#434952", roughness: 0.78 },
};

const CUSTOM_TILE_HEX: Record<string, { hex: string; roughness: number }> = {
  granite_warm: { hex: "#dbd4c8", roughness: 0.42 },
  wood_oak: { hex: "#a5794d", roughness: 0.54 },
  terrazzo_bath: { hex: "#b8c0c4", roughness: 0.62 },
  concrete_carport: { hex: "#989c9e", roughness: 0.88 },
  terrace_deck: { hex: "#8e6643", roughness: 0.68 },
  garden_grass: { hex: "#5a8e46", roughness: 0.94 },
};

/**
 * Shared high-detail PBR house compiler used identically by HouseScene (analysis tabs) & BuildScene (Sims Build Mode).
 */
export function buildProjectHouse(
  derived: DerivedProjectModel,
  struct: StructuralReport,
  palette: MaterialPalette,
  contactShadowMat: THREE.Material,
  opts: ProjectHouseBuildOptions,
): BuiltProjectHouseResult {
  const houseRoot = new THREE.Group();
  const levelRoots: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  const lt2StructuralGroup = new THREE.Group();
  const roofGroup = new THREE.Group();
  const wallCutawayRecords: WallCutawayRecord[] = [];
  const pickables: THREE.Object3D[] = [];
  const resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const animatedFans: THREE.Object3D[] = [];

  houseRoot.add(levelRoots[0], levelRoots[1], lt2StructuralGroup, roofGroup);

  const tagPickable = (obj: THREE.Object3D, sel: NonNullable<SelectionTarget>, label: string) => {
    obj.userData.sel = sel;
    obj.userData.label = label;
    pickables.push(obj);
  };

  const { project, masonry, roof } = derived;
  const peil = project.site.peil;
  const lt1Y = peil.floor1PeilM;
  const lt2Y = lt1Y + project.levels[0]!.height;
  const stage = opts.stage;
  const hidden = opts.hiddenParts;

  const showFnd = !hidden.has("pondasi") && (stage === 0 || stage >= 2);
  const showSloofCol = !hidden.has("kolom") && opts.showStructure && (stage === 0 || stage >= 3);
  const showLt2Slab = !hidden.has("pelat") && opts.showStructure && (stage === 0 || stage >= 4);
  const showBricks = !hidden.has("dinding") && opts.showBricks && (stage === 0 || stage >= 5);
  const showOpenings = !hidden.has("pintu") && (stage === 0 || stage >= 5);
  const showTruss = !hidden.has("rangka") && opts.showRangka && (stage === 0 || stage >= 6);
  const showRoofCover = !hidden.has("genteng") && opts.showRoof && (stage === 0 || stage >= 6);
  const showMep = opts.showAir || opts.showListrik || stage === 7;
  const showPlasterPaint = !hidden.has("cat") && opts.showFinishing && (stage === 0 || stage >= 8);
  const showTileFloor = !hidden.has("lantai") && (stage === 0 || stage >= 8);
  const showProps = stage === 0 || stage >= 9;

  const batchBase = new StaticBatchCollector();
  const batchLt2 = new StaticBatchCollector();
  const batchRoof = new StaticBatchCollector();

  // 1. Plinth & Site Surfaces (including sculpted Build Terrain heights when customized!)
  if (stage === 0 || stage >= 1) {
    batchBase.addBox("site:grass", palette.grass, "lantai", "Taman Depan", 0.75, 0.04, 1.5, 1.5, 0.08, 3.0);
    const cpH = Math.max(0.08, peil.carportPeilM);
    batchBase.addGeo(
      "site:carport",
      palette.carport,
      "lantai",
      "Carport",
      createChamferBox(3.5, cpH, 4.5, 0.014, 1),
      3.25,
      cpH * 0.5,
      2.25,
    );
    const trH = Math.max(0.12, peil.terracePeilM);
    batchBase.addGeo(
      "site:teras",
      palette.woodDeck,
      "lantai",
      "Teras Depan",
      createChamferBox(2.25, trH, 1.0, 0.012, 1),
      1.125,
      trH * 0.5,
      3.5,
    );
    if (lt1Y > trH + 0.03) {
      batchBase.addGeo(
        "site:entry-step",
        palette.tileFloor,
        "lantai",
        "Tangga Masuk Teras",
        createChamferBox(1.12, lt1Y - trH, 0.34, 0.01, 1),
        1.58,
        (lt1Y + trH) * 0.25,
        3.85,
      );
    }
    batchBase.addBox(
      "fnd:plinth",
      palette.concrete,
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

  // Optional Terrain Sculpting Overlay from Build Mode
  const th = project.buildExtras?.terrainHeights;
  if (th && th.some((h) => Math.abs(h) > 0.01)) {
    const segW = 10;
    const segD = 34;
    const tGeo = new THREE.PlaneGeometry(5.4, 17.4, segW, segD);
    tGeo.rotateX(-Math.PI / 2);
    tGeo.translate(2.5, 0.02, 8.5);
    const pos = tGeo.getAttribute("position");
    const stride = segW + 1;
    for (let iz = 0; iz <= segD; iz++) {
      for (let ix = 0; ix <= segW; ix++) {
        const idx = iz * stride + ix;
        pos.setY(idx, 0.02 + (th[idx] ?? 0));
      }
    }
    tGeo.computeVertexNormals();
    const tMesh = new THREE.Mesh(tGeo, palette.grass);
    tMesh.receiveShadow = true;
    levelRoots[0].add(tMesh);
    resources.push(tGeo);
  }

  // 2. Foundations & Sumur Resapan
  if (showFnd) {
    for (const f of struct.foundations) {
      const fw = project.systems.foundation === "footplate_full" ? 1.2 : 1.0;
      batchBase.addGeo(
        "fnd:all",
        palette.concrete,
        "pondasi",
        `Pondasi (${project.systems.foundation})`,
        createChamferBox(fw, 0.32, fw, 0.015, 1),
        f.x,
        -0.65,
        f.z,
        0,
        [0, -1.4, 0],
      );
      batchBase.addBox(
        "fnd:all",
        palette.concrete,
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
        batchBase.addGeo(
          "fnd:all",
          palette.concrete,
          "pondasi",
          "Pondasi Strauss Pile",
          new THREE.CylinderGeometry(0.15, 0.15, 2.4, 10),
          f.x,
          -1.9,
          f.z,
          0,
          [0, -1.4, 0],
        );
      }
    }
    for (let i = 0; i < project.floodMitigation.infiltrationWells; i++) {
      batchBase.addGeo(
        "fnd:resapan",
        palette.concrete,
        "sumurResapan",
        "Sumur Resapan SNI 03-2453",
        new THREE.CylinderGeometry(0.42, 0.42, 1.5, 14),
        0.75,
        -0.7,
        1.2 + i * 1.1,
        0,
        [0, -1.2, 0],
      );
    }
  }

  // 3. Structural Frame (LT1 & LT2 Columns/Beams)
  if (showSloofCol) {
    const colMat = project.systems.frame === "steel_wf" ? palette.steelWf : palette.concrete;
    const maxColLevel = opts.activeLevelView === "lt1" ? 1 : 2;
    const colTop = maxColLevel === 1 ? lt2Y : lt2Y + project.levels[1]!.height;
    const colH = colTop - lt1Y + 0.25;

    for (const col of struct.columns) {
      const isCanopy = col.z < 1.0;
      const h = isCanopy ? Math.max(2.2, lt2Y - 0.38 - (4.45 - col.z) * 0.055 - (lt1Y - 0.15)) : colH;
      const colBatch = maxColLevel === 1 || isCanopy ? batchBase : batchLt2;
      colBatch.addGeo(
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
      if (opts.xrayRebar && col.isMain) {
        colBatch.addBox(
          "struct:rebar",
          palette.rebar,
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
      if (bm.levelIndex >= 1 && opts.activeLevelView === "lt1") continue;
      const targetBatch = bm.levelIndex === 0 ? batchBase : batchLt2;
      const y = bm.levelIndex === 0 ? lt1Y - 0.15 : bm.levelIndex === 1 ? lt2Y - 0.17 : lt2Y + 3.5;
      const cx = (bm.start.x + bm.end.x) * 0.5;
      const cz = (bm.start.z + bm.end.z) * 0.5;
      const ang = -Math.atan2(bm.end.z - bm.start.z, bm.end.x - bm.start.x);
      const partId = bm.kind === "sloof" ? "sloof" : bm.kind === "ring_balk" ? "ringbalk" : "balok";
      const expY = bm.kind === "sloof" ? -0.45 : bm.kind === "ring_balk" ? 2.35 : 1.35;

      targetBatch.addBox(
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

  // 4. LT2 Slabs & LT1 Room Floors + Pools + Build Tile Overrides
  if (showLt2Slab && opts.activeLevelView !== "lt1") {
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
      const mat = slab.isOverhang ? palette.woodDeck : showTileFloor ? palette.tileFloor : palette.concrete;
      batchLt2.addGeo(`slab:${matKey}`, mat, "pelat", slab.name, geo, 0, lt2Y - slab.thickness, 0, 0, [0, 1.5, 0]);
    }
  }

  if (showTileFloor) {
    batchBase.addBox("site:grass", palette.grass, "lantai", "Taman Belakang", 3.32, lt1Y - 0.015, 16.15, 3.16, 0.04, 1.52);
    for (const px of [2.15, 2.75, 3.35, 3.95]) {
      batchBase.addGeo(
        "floor1:woodDeck",
        palette.woodDeck,
        "lantai",
        "Pijakan Taman Belakang",
        createChamferBox(0.46, 0.03, 0.42, 0.008, 1),
        px,
        lt1Y + 0.01,
        15.85,
      );
    }
    for (const lvIdx of [0, 1] as const) {
      if (lvIdx === 1 && opts.activeLevelView === "lt1") continue;
      const fl = derived.floors[lvIdx];
      if (!fl) continue;
      const baseFloorY = lvIdx === 0 ? lt1Y - 0.025 : lt2Y - 0.022;
      const bTarget = lvIdx === 0 ? batchBase : batchLt2;
      for (const rm of fl.rooms) {
        if (rm.room.program === "garden" || rm.room.program === "carport" || rm.room.program === "void") continue;
        if (rm.room.polygon.length < 3) continue;
        const shape = new THREE.Shape();
        rm.room.polygon.forEach((p, i) => {
          if (i === 0) shape.moveTo(p.x, -p.z);
          else shape.lineTo(p.x, -p.z);
        });
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const customTint = CUSTOM_TILE_HEX[rm.room.floorMaterialId];
        let mat: THREE.Material = rm.isWetRoom
          ? palette.tileWet
          : rm.room.floorMaterialId === "wood_deck"
            ? palette.woodDeck
            : rm.room.floorMaterialId === "tile_wood_warm"
              ? palette.tileWood
              : palette.tileFloor;
        if (customTint) {
          mat = new THREE.MeshStandardMaterial({ color: customTint.hex, roughness: customTint.roughness });
          resources.push(mat);
        }
        const yOff = lvIdx === 0 && rm.room.program === "circulation" ? peil.terracePeilM + 0.005 : baseFloorY;
        bTarget.addGeo(`floor${lvIdx}:${rm.room.id}`, mat, "lantai", rm.room.name, geo, 0, yOff, 0, 0, undefined, false, true);
      }
    }
  }

  // Custom Tile Overrides + Pools from Build Mode
  const customTiles = project.buildExtras?.floorTiles ?? [];
  if (customTiles.length > 0) {
    const grouped = new Map<string, THREE.BufferGeometry[]>();
    for (const ct of customTiles) {
      if (ct.levelIndex === 1 && opts.activeLevelView === "lt1") continue;
      const y = ct.levelIndex === 0 ? lt1Y + 0.008 : lt2Y + 0.008;
      const k = `${ct.levelIndex}:${ct.materialId}`;
      const g = new THREE.BoxGeometry(0.5, 0.025, 0.5);
      g.translate((ct.gx + 0.5) * 0.5, y, (ct.gz + 0.5) * 0.5);
      const arr = grouped.get(k) ?? [];
      arr.push(g);
      grouped.set(k, arr);
    }
    for (const [k, geos] of grouped.entries()) {
      const [lvStr, matId] = k.split(":");
      const merged = mergeGeometryBatch(geos);
      if (!merged) continue;
      const spec = CUSTOM_TILE_HEX[matId ?? ""] ?? { hex: "#dbd4c8", roughness: 0.45 };
      const mat = new THREE.MeshStandardMaterial({ color: spec.hex, roughness: spec.roughness });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      resources.push(merged, mat);
      levelRoots[Number(lvStr) === 1 ? 1 : 0].add(mesh);
    }
  }

  for (const pool of project.buildExtras?.pools ?? []) {
    const x1 = Math.min(pool.gx1, pool.gx2) * 0.5;
    const x2 = (Math.max(pool.gx1, pool.gx2) + 1) * 0.5;
    const z1 = Math.min(pool.gz1, pool.gz2) * 0.5;
    const z2 = (Math.max(pool.gz1, pool.gz2) + 1) * 0.5;
    const pw = Math.max(0.5, x2 - x1);
    const pd = Math.max(0.5, z2 - z1);
    const pBasin = new THREE.Mesh(
      new THREE.BoxGeometry(pw, 0.12, pd),
      new THREE.MeshStandardMaterial({ color: "#286e8a", roughness: 0.35 }),
    );
    pBasin.position.set((x1 + x2) * 0.5, 0.02, (z1 + z2) * 0.5);
    const pWater = new THREE.Mesh(
      new THREE.BoxGeometry(pw - 0.08, 0.08, pd - 0.08),
      new THREE.MeshStandardMaterial({ color: "#3ab2e3", roughness: 0.08, transparent: true, opacity: 0.8 }),
    );
    pWater.position.set((x1 + x2) * 0.5, lt1Y + 0.03, (z1 + z2) * 0.5);
    levelRoots[0].add(pBasin, pWater);
    resources.push(pBasin.geometry, pBasin.material as THREE.Material, pWater.geometry, pWater.material as THREE.Material);
  }

  // 5. Staircase & Railings
  for (const st of project.levels[0]!.stairs) {
    const dx = st.end.x - st.start.x;
    const dz = st.end.z - st.start.z;
    const len = Math.hypot(dx, dz) || 1;
    const stepRun = len / st.riserCount;
    const stepRise = st.floorHeight / st.riserCount;
    const ang = -Math.atan2(dz, dx);
    for (let i = 0; i < st.riserCount; i++) {
      const t = (i + 0.5) / st.riserCount;
      const sx = st.start.x + dx * t;
      const sz = st.start.z + dz * t;
      const sy = lt1Y + (i + 0.5) * stepRise;
      batchBase.addGeo(
        "stair:tread",
        palette.woodTeak,
        "tangga",
        st.name,
        createChamferBox(stepRun + 0.035, 0.042, st.width, 0.008, 2),
        sx,
        sy + stepRise * 0.36,
        sz,
        ang,
      );
      batchBase.addBox(
        "stair:carriage",
        palette.concrete,
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
  if (opts.activeLevelView !== "lt1") {
    batchLt2.addBox("rail:glass-stair", palette.glass, "tangga", "Railing Tangga", 1.35, lt2Y + 0.5, 10.0, 0.035, 0.98, 4.9);
    batchLt2.addGeo(
      "rail:alu",
      palette.aluDark,
      "tangga",
      "Handrail Tangga & Balkon",
      createChamferBox(0.06, 0.045, 4.95, 0.008, 1),
      1.35,
      lt2Y + 1.0,
      10.0,
    );
    for (let pz = 7.6; pz <= 12.45; pz += 1.2) {
      batchLt2.addBox("rail:alu", palette.aluDark, "tangga", "Handrail Tangga & Balkon", 1.35, lt2Y + 0.5, pz, 0.04, 1.0, 0.04);
    }
    batchLt2.addBox("rail:glass-balc", palette.glass, "pelat", "Railing Balkon", 1.25, lt2Y + 0.5, 3.04, 2.45, 0.98, 0.035);
    batchLt2.addGeo(
      "rail:alu",
      palette.aluDark,
      "pelat",
      "Handrail Balkon",
      createChamferBox(2.5, 0.045, 0.06, 0.008, 1),
      1.25,
      lt2Y + 1.0,
      3.04,
    );
    for (const px of [0.06, 0.85, 1.65, 2.44]) {
      batchLt2.addBox("rail:alu", palette.aluDark, "pelat", "Handrail Balkon", px, lt2Y + 0.5, 3.04, 0.04, 1.0, 0.04);
    }
  }

  // 6. Brick-by-Brick Masonry InstancedMesh
  if (showBricks && masonry.bricks.length > 0) {
    const unitGeo = attachBvh(new THREE.BoxGeometry(1, 1, 1));
    resources.push(unitGeo);
    const visibleBricks =
      opts.activeLevelView === "lt1" ? masonry.bricks.filter((b) => b.levelIndex === 0) : masonry.bricks;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v1 = new THREE.Vector3();
    const s1 = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    const buildBrickIM = (list: typeof visibleBricks, mat: THREE.Material, label: string, lvTarget: number) => {
      if (list.length === 0) return;
      const im = new THREE.InstancedMesh(unitGeo, mat, list.length);
      im.castShadow = true;
      im.receiveShadow = true;
      const off = new Float32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) {
        const b = list[i]!;
        const baseY = b.levelIndex === 0 ? lt1Y : lt2Y;
        v1.set(b.x, baseY + b.y + b.hgt * 0.5, b.z);
        q.setFromAxisAngle(up, b.rotY);
        s1.set(b.len, b.hgt, b.thick);
        m4.compose(v1, q, s1);
        im.setMatrixAt(i, m4);
        off[i * 3] = (b.x - 2.5) * 0.65;
        off[i * 3 + 1] = b.levelIndex * 1.4 + b.y * 0.35;
        off[i * 3 + 2] = (b.z - 8.5) * 0.25;
      }
      im.instanceMatrix.needsUpdate = true;
      levelRoots[lvTarget === 1 ? 1 : 0].add(im);
      tagPickable(im, { kind: "part", id: "dinding" }, label);
      opts.onExplodeInstanced?.(im, off);
    };

    for (const lvI of [0, 1] as const) {
      if (lvI === 1 && opts.activeLevelView === "lt1") continue;
      const lvBricks = visibleBricks.filter((b) => b.levelIndex === lvI);
      buildBrickIM(lvBricks.filter((b) => b.outer), palette.brickOuter, `Dinding Bata Luar (${project.systems.brick.name})`, lvI);
      buildBrickIM(lvBricks.filter((b) => !b.outer), palette.brickInner, `Sekat Bata Dalam (${project.systems.brick.name})`, lvI);
    }
  }

  // 7. Plaster & Paint Walls + Openings (with full + cutaway + down representations when Build Mode cutaway enabled!)
  const cutawayCapMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.85 });
  if (opts.supportWallCutaway) resources.push(cutawayCapMat);

  for (const lv of project.levels) {
    if (lv.index === 1 && opts.activeLevelView === "lt1") continue;
    const lvIdx = (lv.index === 1 ? 1 : 0) as 0 | 1;
    const baseLvY = lvIdx === 0 ? lt1Y : lt2Y;
    const lvRoot = levelRoots[lvIdx];

    for (const w of lv.walls) {
      const dx = w.end.x - w.start.x;
      const dz = w.end.z - w.start.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const ux = dx / len;
      const uz = dz / len;
      const ang = -Math.atan2(dz, dx);

      const wallWrap = new THREE.Group();
      lvRoot.add(wallWrap);

      const fullGroup = new THREE.Group();
      wallWrap.add(fullGroup);

      const customMat = CUSTOM_PAINT_HEX[w.materialId];
      let wallMat: THREE.Material = w.exterior ? palette.plasterExt : palette.plasterInt;
      if (customMat) {
        wallMat = new THREE.MeshStandardMaterial({ color: customMat.hex, roughness: customMat.roughness });
        resources.push(wallMat);
      }

      if (showPlasterPaint) {
        const extra0 = lvIdx === 1 && w.exterior && w.height >= 2.8 ? roof.extraWallHeightAt(1, w.start.x, w.start.z) : 0;
        const extra1 = lvIdx === 1 && w.exterior && w.height >= 2.8 ? roof.extraWallHeightAt(1, w.end.x, w.end.z) : 0;
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
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(w.start.x, baseLvY, w.start.z);
        mesh.rotation.y = ang;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        fullGroup.add(mesh);
        resources.push(geo);
        tagPickable(mesh, { kind: "wall", id: w.id, levelIndex: lvIdx }, w.name);
        opts.onExplodePiece?.(
          mesh,
          new THREE.Vector3(((w.start.x + w.end.x) * 0.5 - 2.5) * 0.5, lvIdx * 1.3, 0),
        );
      }

      if (showOpenings) {
        for (const op of w.openings) {
          const cx = w.start.x + ux * op.offset;
          const cz = w.start.z + uz * op.offset;
          const opGroup = new THREE.Group();
          opGroup.position.set(cx, baseLvY + op.sill, cz);
          opGroup.rotation.y = ang;

          if (op.kind === "door" || op.kind === "arch") {
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
              const fm = new THREE.Mesh(frameGeo, palette.woodTeak);
              fm.castShadow = true;
              fm.receiveShadow = true;
              opGroup.add(fm);
              resources.push(frameGeo);
            }
            if (op.kind === "door") {
              const pivot = new THREE.Group();
              pivot.position.set(-op.width * 0.5 + ft, 0, 0);
              pivot.rotation.y = op.swing * ((op.openPct / 100) * Math.PI * 0.48);
              const leafMat = op.width > 1.3 ? palette.glass : palette.woodTeak;
              const leafGeo = attachBvh(createChamferBox(op.width - ft * 2, op.height - ft, 0.044, 0.008, 1));
              leafGeo.translate((op.width - ft * 2) * 0.5, (op.height - ft) * 0.5, 0);
              const leafMesh = new THREE.Mesh(leafGeo, leafMat);
              leafMesh.castShadow = true;
              leafMesh.receiveShadow = true;
              pivot.add(leafMesh);

              const hBase = createChamferBox(0.035, 0.14, 0.02, 0.004, 1);
              hBase.translate(op.width - ft * 3.5, 1.0, 0.028);
              const lever = createChamferBox(0.11, 0.02, 0.028, 0.004, 1);
              lever.translate(op.width - ft * 3.5 - 0.045, 1.03, 0.048);
              const hGeo = mergeGeometryBatch([hBase, lever]);
              if (hGeo) {
                pivot.add(new THREE.Mesh(hGeo, palette.steelLight));
                resources.push(hGeo);
              }
              resources.push(leafGeo);
              opGroup.add(pivot);
            }
            tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lvIdx }, op.label);
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
              const fm = new THREE.Mesh(frameGeo, palette.aluDark);
              fm.castShadow = true;
              fm.receiveShadow = true;
              opGroup.add(fm);
              resources.push(frameGeo);
            }
            const glassGeo = attachBvh(new THREE.BoxGeometry(op.width - ft * 2, op.height - ft * 2, 0.015));
            glassGeo.translate(0, op.height * 0.5, 0);
            opGroup.add(new THREE.Mesh(glassGeo, palette.glass));
            resources.push(glassGeo);
            tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lvIdx }, op.label);
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
              const vm = new THREE.Mesh(ventGeo, palette.concrete);
              vm.castShadow = true;
              vm.receiveShadow = true;
              opGroup.add(vm);
              resources.push(ventGeo);
            }
            tagPickable(opGroup, { kind: "opening", id: op.id, wallId: w.id, levelIndex: lvIdx }, op.label);
          }
          fullGroup.add(opGroup);
        }
      }

      if (opts.supportWallCutaway) {
        const makeStub = (stubH: number) => {
          const grp = new THREE.Group();
          const effH = Math.min(w.height, stubH);
          const skinT = w.thickness + 0.022;
          const bodyG = new THREE.BoxGeometry(len + w.thickness * 0.5, effH, skinT);
          const bodyM = new THREE.Mesh(bodyG, wallMat);
          bodyM.position.set((w.start.x + w.end.x) * 0.5, baseLvY + effH * 0.5, (w.start.z + w.end.z) * 0.5);
          bodyM.rotation.y = ang;
          bodyM.castShadow = true;
          bodyM.receiveShadow = true;
          tagPickable(bodyM, { kind: "wall", id: w.id, levelIndex: lvIdx }, w.name);

          const capG = new THREE.BoxGeometry(len + w.thickness * 0.5, 0.024, skinT + 0.01);
          const capM = new THREE.Mesh(capG, cutawayCapMat);
          capM.position.set((w.start.x + w.end.x) * 0.5, baseLvY + effH + 0.012, (w.start.z + w.end.z) * 0.5);
          capM.rotation.y = ang;
          grp.add(bodyM, capM);
          resources.push(bodyG, capG);
          return grp;
        };

        const cutawayGroup = makeStub(w.height <= 1.25 ? w.height : 0.44);
        const downGroup = makeStub(0.22);
        cutawayGroup.visible = false;
        downGroup.visible = false;
        wallWrap.add(cutawayGroup, downGroup);
        wallCutawayRecords.push({
          wallId: w.id,
          levelIndex: lvIdx,
          midX: (w.start.x + w.end.x) * 0.5,
          midZ: (w.start.z + w.end.z) * 0.5,
          exterior: w.exterior,
          fullGroup,
          cutawayGroup,
          downGroup,
        });
      }
    }
  }

  // 8. Roof Structure (Void + Skylight + Gutter/Downspouts + Carport Canopy)
  if ((showTruss || showRoofCover) && opts.activeLevelView !== "lt1") {
    const roofH = (x: number, z: number) => roof.heightAt(x, z) + lt1Y;
    const spanX = roof.maxX - roof.minX;
    const spanZ = roof.maxZ - roof.minZ;
    const midX = (roof.minX + roof.maxX) * 0.5;
    const voidCut = { x0: 1.7, x1: roof.maxX + 0.1, z0: 15.35, z1: roof.maxZ + 0.1 };
    const skylightHole: [number, number, number, number] = [0.14, 8.55, 1.3, 10.95];

    if (showTruss) {
      for (let i = 0; i < roof.trussCount; i++) {
        const z = roof.minZ + (i / Math.max(1, roof.trussCount - 1)) * spanZ;
        const tx0 = roof.minX + 0.05;
        const tx1 = z >= 15.35 ? Math.min(roof.maxX - 0.05, 1.68) : roof.maxX - 0.05;
        const tSpan = tx1 - tx0;
        if (tSpan < 0.25) continue;
        const tMidX = (tx0 + tx1) * 0.5;
        const h = roofH(tMidX, z);
        batchRoof.addBox("roof:truss", palette.steelLight, "rangka", "Rangka Baja Ringan C75", tMidX, h - 0.08, z, tSpan, 0.06, 0.05, {
          explodeOff: [0, 2.6, 0],
        });
      }
    }

    if (showRoofCover) {
      const slopeRad = (roof.slopeDeg * Math.PI) / 180;
      const thickness = 0.085 / Math.cos(slopeRad);
      const roofGeos: THREE.BufferGeometry[] = [];
      if (roof.roofType === "shed_front" || roof.roofType === "shed_back" || roof.roofType === "flat_deck") {
        const g = buildCutoutRoofGeometry(roof.minX, roof.maxX, roof.minZ, roof.maxZ, voidCut, skylightHole, roofH, thickness);
        if (g) roofGeos.push(g);
      } else {
        const gL = buildCutoutRoofGeometry(roof.minX, midX, roof.minZ, roof.maxZ, voidCut, skylightHole, roofH, thickness);
        const gR = buildCutoutRoofGeometry(midX, roof.maxX, roof.minZ, roof.maxZ, voidCut, skylightHole, roofH, thickness);
        if (gL) roofGeos.push(gL);
        if (gR) roofGeos.push(gR);
      }
      const mergedRoof = mergeGeometryBatch(roofGeos);
      if (mergedRoof) {
        const roofMesh = new THREE.Mesh(mergedRoof, palette.roofCover);
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        roofGroup.add(roofMesh);
        resources.push(mergedRoof);
        tagPickable(roofMesh, { kind: "part", id: "genteng" }, `Atap ${roof.roofType} (${roof.slopeDeg}°)`);
        opts.onExplodePiece?.(roofMesh, new THREE.Vector3(0, 3.2, 0));
      }

      const voidEdgeY = roofH(3.35, 15.35);
      batchRoof.addGeo(
        "roof:fascia",
        palette.lisplank,
        "genteng",
        "Lisplank Void Belakang",
        createChamferBox(roof.maxX - 1.7 + 0.08, 0.14, 0.08, 0.01, 1),
        (1.7 + roof.maxX) * 0.5,
        voidEdgeY + 0.04,
        15.35,
        0,
        [0, 3.2, 0],
      );

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
      batchRoof.addGeo("roof:skycurb", palette.aluDark, "plafon", "Rangka Skylight Tangga", curbFront, 0, 0, 0, 0, [0, 3.2, 0]);
      batchRoof.addGeo("roof:skycurb", palette.aluDark, "plafon", "Rangka Skylight Tangga", curbBack, 0, 0, 0, 0, [0, 3.2, 0]);

      const skyGlass = new THREE.Mesh(attachBvh(new THREE.BoxGeometry(hW + 0.06, 0.035, hD + 0.06)), palette.glass);
      skyGlass.position.set(hMidX, skyAvgY + 0.04, hMidZ);
      skyGlass.rotation.x = -skyRotX;
      roofGroup.add(skyGlass);
      resources.push(skyGlass.geometry);
      tagPickable(skyGlass, { kind: "part", id: "plafon" }, "Skylight Tangga Tempered Glass");
      opts.onExplodePiece?.(skyGlass, new THREE.Vector3(0, 3.2, 0));

      const eaveY = roofH(midX, roof.minZ) - 0.03;
      batchRoof.addGeo(
        "roof:gutter",
        palette.aluDark,
        "talang",
        "Talang Utama Depan",
        createChamferBox(spanX + 0.04, 0.13, 0.17, 0.012, 1),
        midX,
        eaveY,
        roof.minZ + 0.05,
      );
      for (const [dx, wallZ] of [
        [0.14, 3.04],
        [project.site.width - 0.14, 3.92],
      ] as [number, number][]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(dx, eaveY - 0.05, roof.minZ + 0.06),
          new THREE.Vector3(dx, eaveY - 0.34, roof.minZ + 0.25),
          new THREE.Vector3(dx, eaveY - 0.65, wallZ),
          new THREE.Vector3(dx, 0.25, wallZ),
          new THREE.Vector3(dx, 0.09, wallZ - 0.22),
        ]);
        const tubeGeo = attachBvh(new THREE.TubeGeometry(curve, 22, 0.044, 10, false));
        batchRoof.addGeo("roof:gutter", palette.aluDark, "talang", "Pipa Turun Hujan (Downspout)", tubeGeo);
        for (const cy of [1.2, 3.4, 5.6]) {
          batchRoof.addGeo("roof:gutter", palette.aluDark, "talang", "Klem Pipa Talang", new THREE.CylinderGeometry(0.062, 0.062, 0.045, 10), dx, cy, wallZ);
        }
      }

      const cpMinX = 1.48;
      const cpMaxX = project.site.width;
      const cpW = cpMaxX - cpMinX;
      const cpMidX = (cpMinX + cpMaxX) * 0.5;
      const cpZ0 = -0.35;
      const cpZ1 = 4.45;
      const cpHeightAt = (_x: number, z: number) => lt2Y - 0.34 - (cpZ1 - z) * 0.055;
      const cpGeo = buildCutoutRoofGeometry(cpMinX, cpMaxX, cpZ0, cpZ1, null, null, cpHeightAt, 0.065);
      if (cpGeo) {
        const cpRoof = new THREE.Mesh(cpGeo, palette.roofCover);
        cpRoof.castShadow = true;
        cpRoof.receiveShadow = true;
        roofGroup.add(cpRoof);
        resources.push(cpGeo);
        tagPickable(cpRoof, { kind: "part", id: "genteng" }, "Kanopi Carport Depan");
        opts.onExplodePiece?.(cpRoof, new THREE.Vector3(0, 1.8, 0));
      }

      const cpFrontY = cpHeightAt(cpMidX, cpZ0);
      const cpAvgY = (cpHeightAt(cpMinX, cpZ0) + cpHeightAt(cpMinX, cpZ1)) * 0.5;
      const cpTilt = Math.atan(0.055);
      batchRoof.addBox("roof:cpframe", palette.aluDark, "rangka", "Rangka Kanopi Carport", cpMidX, cpFrontY - 0.03, cpZ0 + 0.03, cpW, 0.1, 0.06);
      batchRoof.addBox("roof:cpframe", palette.aluDark, "rangka", "Rangka Kanopi Carport", cpMinX + 0.03, cpAvgY - 0.03, (cpZ0 + cpZ1) * 0.5, 0.06, 0.1, cpZ1 - cpZ0, {
        rotX: cpTilt,
      });
    }
  }

  const flushCollector = (col: StaticBatchCollector, targetGrp: THREE.Group) => {
    col.flush(targetGrp, resources, (mesh, partId, label, explodeOff) => {
      tagPickable(mesh, { kind: "part", id: partId as never }, label);
      if (explodeOff) opts.onExplodePiece?.(mesh, new THREE.Vector3(...explodeOff));
    });
  };
  flushCollector(batchBase, levelRoots[0]);
  flushCollector(batchLt2, lt2StructuralGroup);
  flushCollector(batchRoof, roofGroup);

  // 9. Furniture, Movable HVAC, Lights & Outdoor Condensers
  if (showProps) {
    let activePointLights = 0;
    for (const lv of project.levels) {
      if (lv.index === 1 && (opts.activeLevelView === "lt1" || opts.hideUpperPropsInLt1)) continue;
      const lvIdx = (lv.index === 1 ? 1 : 0) as 0 | 1;
      const baseY = lvIdx === 0 ? lt1Y : lt2Y;
      const lvGrp = new THREE.Group();
      lvGrp.position.y = baseY;

      for (const f of lv.furniture) {
        const mesh = buildFurnitureMesh(f, palette, resources, contactShadowMat);
        if (lvIdx === 0) {
          if (f.category === "vehicle" && f.position.z < 4.5) {
            mesh.position.y += Math.max(0.08, peil.carportPeilM) - lt1Y;
          } else if (f.position.x < 1.5 && f.position.z < 3.0) {
            mesh.position.y += 0.08 - lt1Y;
          } else if (f.position.z >= 3.0 && f.position.z <= 4.0 && f.position.x < 2.25) {
            mesh.position.y += Math.max(0.12, peil.terracePeilM) - lt1Y;
          }
        }
        lvGrp.add(mesh);
        tagPickable(mesh, { kind: "furniture", id: f.id, levelIndex: lvIdx }, f.name);
      }

      for (const hv of lv.hvac) {
        const mesh = buildHvacMesh(hv, palette, resources, animatedFans);
        lvGrp.add(mesh);
        tagPickable(mesh, { kind: "hvac", id: hv.id, levelIndex: lvIdx }, hv.name);
        if (hv.type === "ac_split") {
          const isFront = hv.position.z < 9.5;
          const extZ = isFront ? 3.84 : 15.42;
          const extX = isFront
            ? hv.position.x > 2.8
              ? Math.min(4.45, hv.position.x)
              : 3.15
            : Math.max(2.1, Math.min(4.45, hv.position.x));
          const outUnit = buildAcCondenserUnit(extX, 2.72, extZ, isFront ? 0 : Math.PI, resources);
          lvGrp.add(outUnit);
          tagPickable(outUnit, { kind: "hvac", id: hv.id, levelIndex: lvIdx }, `Outdoor ${hv.name}`);
        }
      }

      for (const l of lv.lights) {
        const mesh = buildLightFixtureMesh(l, palette, resources);
        lvGrp.add(mesh);
        tagPickable(mesh, { kind: "light", id: l.id, levelIndex: lvIdx }, l.name);
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

      levelRoots[lvIdx].add(lvGrp);
    }
  }

  // 10. MEP X-Ray Overlay
  if (showMep) {
    const mepGrp = new THREE.Group();
    for (const lv of project.levels) {
      if (lv.index === 1 && opts.activeLevelView === "lt1") continue;
      const baseY = lv.index === 0 ? lt1Y : lt2Y;
      for (const rt of lv.mepRoutes) {
        const isAir = rt.kind === "air_bersih" || rt.kind === "air_kotor" || rt.kind === "air_hujan";
        if (isAir && !opts.showAir && stage !== 7) continue;
        if (!isAir && !opts.showListrik && stage !== 7) continue;
        const mat =
          rt.kind === "air_bersih"
            ? palette.mepWaterClean
            : rt.kind === "air_kotor"
              ? palette.mepWaterWaste
              : rt.kind === "air_hujan"
                ? palette.mepRainPipe
                : rt.kind === "listrik_lampu"
                  ? palette.mepElecLamp
                  : rt.kind === "listrik_ac"
                    ? palette.mepElecAc
                    : palette.mepElecOutlet;
        const vecs = rt.pts.map((p) => new THREE.Vector3(p.x, baseY + p.y, p.z));
        const curve = new THREE.CatmullRomCurve3(vecs, false, "catmullrom", 0.05);
        const tubeGeo = new THREE.TubeGeometry(curve, Math.max(8, vecs.length * 6), rt.kind === "air_kotor" ? 0.045 : 0.025, 8, false);
        const mesh = new THREE.Mesh(tubeGeo, mat);
        mesh.renderOrder = 950;
        mepGrp.add(mesh);
        resources.push(tubeGeo);
        tagPickable(mesh, { kind: "part", id: isAir ? "pipaAirBersih" : "listrikLampu" }, rt.label);
      }
    }
    const bioGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.35, 16);
    const bio = new THREE.Mesh(bioGeo, palette.mepWaterWaste);
    bio.position.set(2.8, -0.75, 1.6);
    bio.renderOrder = 951;
    mepGrp.add(bio);
    resources.push(bioGeo);
    tagPickable(bio, { kind: "part", id: "septic" }, "Bio Septic Tank (di bawah Carport)");
    houseRoot.add(mepGrp);
  }

  return {
    houseRoot,
    levelRoots,
    lt2StructuralGroup,
    roofGroup,
    wallCutawayRecords,
    pickables,
    resources,
    animatedFans,
  };
}
