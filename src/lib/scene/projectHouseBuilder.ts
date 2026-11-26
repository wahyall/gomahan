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
  showTerrain?: boolean;
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
  walkOpenDoorsFull?: boolean;
  enableDynamicLights?: boolean;
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
  ground.name = "env-terrain-ground";
  ground.userData.isTerrain = true;
  envGroup.add(ground);

  const roadGeo = new THREE.BoxGeometry(90, 0.06, 6.25);
  const road = new THREE.Mesh(roadGeo, palette.road);
  road.position.set(2.5, -0.04, -3.65);
  road.receiveShadow = true;
  road.name = "env-terrain-road";
  road.userData.isTerrain = true;
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
    m.userData.isTerrain = true;
    envGroup.add(m);
  }

  const curbMat = new THREE.MeshStandardMaterial({ color: 0x7b8087, roughness: 0.88, metalness: 0.02 });
  const grateMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.55, metalness: 0.72 });
  const drainDarkMat = new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.95 });

  const gutterFrontWall = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 0.12), curbMat);
  gutterFrontWall.position.set(2.5, -0.015, -0.52);
  gutterFrontWall.receiveShadow = true;
  gutterFrontWall.userData.isTerrain = true;
  const gutterBackWall = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 0.12), curbMat);
  gutterBackWall.position.set(2.5, -0.015, -0.06);
  gutterBackWall.receiveShadow = true;
  gutterBackWall.userData.isTerrain = true;
  const gutterBed = new THREE.Mesh(new THREE.BoxGeometry(28, 0.02, 0.36), drainDarkMat);
  gutterBed.position.set(2.5, -0.045, -0.29);
  gutterBed.receiveShadow = true;
  gutterBed.userData.isTerrain = true;
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
    m.userData.isTerrain = true;
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
    gm.userData.isTerrain = true;
    envGroup.add(gm);
  }

  // Concrete pedestrian sidewalk curb between gutter and asphalt road (`3d-modular-buildings`)
  const sidewalkGeo = new THREE.BoxGeometry(28, 0.045, 0.32);
  const sidewalk = new THREE.Mesh(sidewalkGeo, curbMat);
  sidewalk.position.set(2.5, -0.005, -0.68);
  sidewalk.receiveShadow = true;
  sidewalk.userData.isTerrain = true;
  envGroup.add(sidewalk);

  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  staticDisposables.push(shadowMat, groundGeo, roadGeo, sidewalkGeo, stripeMat, curbMat, grateMat, drainDarkMat);

  // Subtle architectural base contact shadow strip under lot footprint (`3d-wood-lighting-scorecard`)
  if (contactShadowTex) {
    const basePoolGeo = new THREE.PlaneGeometry(6.6, 14.8);
    basePoolGeo.rotateX(-Math.PI / 2);
    const basePoolMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const basePool = new THREE.Mesh(basePoolGeo, basePoolMat);
    basePool.position.set(2.5, 0.004, 10.2);
    basePool.userData.isTerrain = true;
    envGroup.add(basePool);
    staticDisposables.push(basePoolGeo, basePoolMat);
  }

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
      staticDisposables.push(mergedWall);
    }

    const nRoof = createChamferBox(4.96, 0.24, 13.8, 0.025, 1);
    nRoof.rotateX(-0.14);
    nRoof.translate(cx, 7.62, 10.5);
    const rm = new THREE.Mesh(nRoof, palette.neighborRoof);
    rm.castShadow = true;
    rm.receiveShadow = true;
    grp.add(rm);
    staticDisposables.push(nRoof);

    // Muted facade rhythm: plinth, floor band, corner pilasters, window frames + sills, door.
    // This turns the old translucent boxes into believable adjacent houses without stealing focus.
    const detailGeos: THREE.BufferGeometry[] = [];
    const addDetail = (geo: THREE.BufferGeometry) => detailGeos.push(geo);
    const plinth = createChamferBox(5.02, 0.62, 0.1, 0.012, 1);
    plinth.translate(cx, 0.33, 3.95);
    addDetail(plinth);
    const floorBand = createChamferBox(5.04, 0.13, 0.11, 0.012, 1);
    floorBand.translate(cx, 3.52, 3.95);
    addDetail(floorBand);
    const fascia = createChamferBox(5.08, 0.18, 13.92, 0.02, 1);
    fascia.rotateX(-0.14);
    fascia.translate(cx, 7.46, 10.5);
    addDetail(fascia);
    for (const side of [-1, 1]) {
      const pilaster = createChamferBox(0.15, 6.7, 0.14, 0.012, 1);
      pilaster.translate(cx + side * 2.42, 3.45, 3.94);
      addDetail(pilaster);
    }
    const doorX = cx + (labelSide === "left" ? 0.72 : -0.72);
    const doorGeo = createChamferBox(0.98, 2.18, 0.1, 0.012, 1);
    doorGeo.translate(doorX, 1.19, 4.03);
    addDetail(doorGeo);
    const doorCanopy = createChamferBox(1.45, 0.11, 0.82, 0.012, 1);
    doorCanopy.translate(doorX, 2.55, 3.66);
    addDetail(doorCanopy);

    const mergedDetail = mergeGeometryBatch(detailGeos);
    if (mergedDetail) {
      const dm = new THREE.Mesh(mergedDetail, palette.lisplank);
      dm.castShadow = true;
      dm.receiveShadow = true;
      grp.add(dm);
      staticDisposables.push(mergedDetail);
    }

    const winMat = new THREE.MeshStandardMaterial({
      color: 0x2a3744,
      roughness: 0.16,
      metalness: 0.35,
      envMapIntensity: 0.9,
    });
    const winFrameGeos: THREE.BufferGeometry[] = [];
    const winGlassGeos: THREE.BufferGeometry[] = [];
    const winSillGeos: THREE.BufferGeometry[] = [];
    for (const [wy, wz] of [
      [2.16, 3.97],
      [5.3, 3.97],
    ] as [number, number][]) {
      const wx = cx + (labelSide === "left" ? -0.55 : 0.55);
      const frameW = 1.62;
      const frameH = 1.6;
      const rail = 0.055;
      for (const [ox, oy, w, h] of [
        [0, frameH * 0.5 - rail * 0.5, frameW, rail],
        [0, -frameH * 0.5 + rail * 0.5, frameW, rail],
        [-frameW * 0.5 + rail * 0.5, 0, rail, frameH],
        [frameW * 0.5 - rail * 0.5, 0, rail, frameH],
        [0, 0, 0.045, frameH - rail * 1.2],
      ] as [number, number, number, number][]) {
        const fg = createChamferBox(w, h, 0.085, 0.006, 1);
        fg.translate(wx + ox, wy + oy, wz);
        winFrameGeos.push(fg);
      }
      const glass = new THREE.BoxGeometry(frameW - rail * 2, frameH - rail * 2, 0.024);
      glass.translate(wx, wy, wz - 0.012);
      winGlassGeos.push(glass);
      const sill = createChamferBox(frameW + 0.12, 0.075, 0.2, 0.008, 1);
      sill.translate(wx, wy - frameH * 0.5 - 0.035, wz - 0.035);
      winSillGeos.push(sill);
    }
    // Side window facing the hero lot keeps the neighbouring elevation from feeling blank.
    const sideWinX = cx + (labelSide === "left" ? 2.47 : -2.47);
    for (const [wy, wz] of [
      [2.25, 6.3],
      [5.35, 6.3],
      [2.25, 12.3],
    ] as [number, number][]) {
      const glass = new THREE.BoxGeometry(0.024, 1.18, 1.34);
      glass.translate(sideWinX, wy, wz);
      winGlassGeos.push(glass);
      const sill = createChamferBox(0.18, 0.07, 1.46, 0.008, 1);
      sill.translate(sideWinX + (labelSide === "left" ? 0.04 : -0.04), wy - 0.63, wz);
      winSillGeos.push(sill);
    }
    const mergedWinFrame = mergeGeometryBatch(winFrameGeos);
    if (mergedWinFrame) {
      const fm = new THREE.Mesh(mergedWinFrame, palette.aluDark);
      fm.castShadow = true;
      grp.add(fm);
      staticDisposables.push(mergedWinFrame);
    }
    const mergedWinGlass = mergeGeometryBatch(winGlassGeos);
    if (mergedWinGlass) {
      const gm = new THREE.Mesh(mergedWinGlass, winMat);
      gm.castShadow = true;
      grp.add(gm);
      staticDisposables.push(mergedWinGlass);
    }
    const mergedWinSill = mergeGeometryBatch(winSillGeos);
    if (mergedWinSill) {
      const sm = new THREE.Mesh(mergedWinSill, palette.lisplank);
      sm.castShadow = true;
      grp.add(sm);
      staticDisposables.push(mergedWinSill);
    }

    // Rooftop water tank + side condenser: small silhouettes that make the context read as lived-in.
    const tankGeos: THREE.BufferGeometry[] = [];
    const tank = new THREE.CylinderGeometry(0.42, 0.46, 1.12, 14);
    tank.translate(cx + 1.18, 8.78, 14.1);
    tankGeos.push(tank);
    const tankCap = new THREE.CylinderGeometry(0.48, 0.48, 0.08, 14);
    tankCap.translate(cx + 1.18, 9.38, 14.1);
    tankGeos.push(tankCap);
    const mergedTank = mergeGeometryBatch(tankGeos);
    if (mergedTank) {
      const tm = new THREE.Mesh(mergedTank, palette.aluDark);
      tm.castShadow = true;
      grp.add(tm);
      staticDisposables.push(mergedTank);
    }
    const acGeo = new THREE.BoxGeometry(0.68, 0.54, 0.3);
    acGeo.translate(cx + (labelSide === "left" ? -2.58 : 2.58), 4.28, 9.3);
    const ac = new THREE.Mesh(acGeo, palette.aluDark);
    ac.castShadow = true;
    grp.add(ac);
    staticDisposables.push(acGeo);

    // Front hedge behind the low fence, tucked under the neighbour tree.
    const hedgeGeo = createChamferBox(3.95, 0.52, 0.32, 0.07, 1);
    hedgeGeo.translate(cx, 0.55, 0.56);
    const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x4c7c3d, roughness: 0.9, envMapIntensity: 0.16 });
    const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    grp.add(hedge);
    staticDisposables.push(hedgeGeo, hedgeMat);

    const treeZ = 1.62;
    const treeX = cx + (labelSide === "left" ? 1.18 : -1.18);
    // Planter curb & soil ring (`3d-kasumidera-ultra-realism` / `3d-modular-buildings`)
    const ringCurbGeo = new THREE.CylinderGeometry(0.46, 0.5, 0.12, 12);
    ringCurbGeo.translate(treeX, 0.04, treeZ);
    const ringCurb = new THREE.Mesh(ringCurbGeo, curbMat);
    ringCurb.receiveShadow = true;
    grp.add(ringCurb);

    const trunkGeos: THREE.BufferGeometry[] = [];
    const mainTrunk = new THREE.CylinderGeometry(0.08, 0.145, 2.55, 8);
    mainTrunk.translate(treeX, 1.25, treeZ);
    trunkGeos.push(mainTrunk);
    const b1 = new THREE.CylinderGeometry(0.038, 0.065, 1.05, 6);
    b1.rotateZ(0.48);
    b1.translate(treeX - 0.25, 2.3, treeZ + 0.08);
    trunkGeos.push(b1);
    const b2 = new THREE.CylinderGeometry(0.036, 0.06, 0.95, 6);
    b2.rotateZ(-0.44);
    b2.translate(treeX + 0.22, 2.26, treeZ - 0.08);
    trunkGeos.push(b2);
    const mergedTrunk = mergeGeometryBatch(trunkGeos);
    if (mergedTrunk) {
      const trunk = new THREE.Mesh(mergedTrunk, palette.woodTeak);
      trunk.castShadow = true;
      grp.add(trunk);
    }

    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x568746, roughness: 0.86, envMapIntensity: 0.28 });
    const foliageHiMat = new THREE.MeshStandardMaterial({ color: 0x6ba055, roughness: 0.84, envMapIntensity: 0.3 });
    const crownGeos: THREE.BufferGeometry[] = [];
    for (const [ox, oy, oz, rad] of [
      [0, 2.88, 0, 0.9],
      [-0.48, 2.6, 0.26, 0.68],
      [0.46, 2.64, -0.22, 0.66],
    ] as [number, number, number, number][]) {
      const c = new THREE.IcosahedronGeometry(rad, 1);
      c.scale(1.06, 0.84, 1.06);
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
    const topCap = new THREE.IcosahedronGeometry(0.58, 1);
    topCap.scale(1.08, 0.8, 1.08);
    topCap.translate(treeX + 0.06, 3.34, treeZ + 0.08);
    const tcm = new THREE.Mesh(topCap, foliageHiMat);
    tcm.castShadow = true;
    grp.add(tcm);

    const discGeo = new THREE.PlaneGeometry(2.5, 2.5);
    discGeo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, shadowMat);
    disc.position.set(treeX, 0.008, treeZ);
    grp.add(disc);
    neighborsGroup.add(grp);
    staticDisposables.push(winMat, foliageMat, foliageHiMat, ringCurbGeo, discGeo, topCap);
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
  const showTerrain = opts.showTerrain !== false && !hidden.has("tanah");
  const concreteStructMat = opts.xrayRebar ? palette.concreteXray : palette.concrete;

  const batchBase = new StaticBatchCollector();
  const batchLt2 = new StaticBatchCollector();
  const batchRoof = new StaticBatchCollector();

  // 1. Plinth & Site Surfaces (hidden cleanly when showTerrain === false to expose foundations!)
  if (showTerrain && (stage === 0 || stage >= 1)) {
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
        (lt1Y + trH) * 0.5,
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

    // Human-scale landscaping gives the hero lot depth and a lived-in silhouette.
    const leafDeep = new THREE.MeshStandardMaterial({ color: 0x477a38, roughness: 0.88, envMapIntensity: 0.18 });
    const leafLight = new THREE.MeshStandardMaterial({ color: 0x69a052, roughness: 0.84, envMapIntensity: 0.2 });
    const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x4f803f, roughness: 0.92, envMapIntensity: 0.15 });
    const gardenLightMat = new THREE.MeshStandardMaterial({
      color: 0xffe7b2,
      emissive: 0xffc46b,
      emissiveIntensity: 1.8,
      roughness: 0.38,
      metalness: 0.1,
    });
    resources.push(leafDeep, leafLight, hedgeMat, gardenLightMat);

    const addGardenTree = (x: number, z: number, scale: number, mat: THREE.Material) => {
      const trunkGeos: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.065 * scale, 0.11 * scale, 2.25 * scale, 7);
      trunk.translate(x, 0.08 + 1.125 * scale, z);
      trunkGeos.push(trunk);
      for (const [ox, oz, ang, len] of [
        [0.22, 0.08, 0.5, 0.9],
        [-0.2, -0.1, -0.45, 0.82],
      ] as [number, number, number, number][]) {
        const branch = new THREE.CylinderGeometry(0.025 * scale, 0.05 * scale, len * scale, 6);
        branch.rotateZ(ang);
        branch.translate(x + ox * scale, 0.08 + 1.92 * scale, z + oz * scale);
        trunkGeos.push(branch);
      }
      const mergedTrunk = mergeGeometryBatch(trunkGeos);
      if (mergedTrunk) {
        const tm = new THREE.Mesh(mergedTrunk, palette.woodTeak);
        tm.castShadow = true;
        tm.receiveShadow = true;
        levelRoots[0].add(tm);
        resources.push(mergedTrunk);
      }

      const crownGeos: THREE.BufferGeometry[] = [];
      for (const [ox, oy, oz, rad] of [
        [0, 2.7, 0, 0.82],
        [-0.55, 2.35, 0.28, 0.58],
        [0.52, 2.42, -0.22, 0.62],
        [0.1, 2.18, 0.52, 0.46],
        [-0.16, 3.12, -0.12, 0.44],
      ] as [number, number, number, number][]) {
        const crown = new THREE.IcosahedronGeometry(rad * scale, 1);
        crown.scale(1.08, 0.82, 1.08);
        crown.translate(x + ox * scale, 0.08 + oy * scale, z + oz * scale);
        crownGeos.push(crown);
      }
      const mergedCrown = mergeGeometryBatch(crownGeos);
      if (mergedCrown) {
        const cm = new THREE.Mesh(mergedCrown, mat);
        cm.castShadow = true;
        cm.receiveShadow = true;
        levelRoots[0].add(cm);
        resources.push(mergedCrown);
      }
    };

    addGardenTree(0.48, 1.32, 1.0, leafLight);
    addGardenTree(3.95, 16.15, 0.82, leafDeep);

    const hedgeGeos: THREE.BufferGeometry[] = [];
    const frontHedge = createChamferBox(1.28, 0.42, 0.3, 0.06, 1);
    frontHedge.translate(0.76, 0.29, 0.17);
    hedgeGeos.push(frontHedge);
    const backHedge = createChamferBox(2.45, 0.52, 0.34, 0.06, 1);
    backHedge.translate(2.6, 0.34, 16.78);
    hedgeGeos.push(backHedge);
    const mergedHedge = mergeGeometryBatch(hedgeGeos);
    if (mergedHedge) {
      const hm = new THREE.Mesh(mergedHedge, hedgeMat);
      hm.castShadow = true;
      hm.receiveShadow = true;
      levelRoots[0].add(hm);
      resources.push(mergedHedge);
    }

    // Two small bollards anchor the garden path and bloom warmly after dusk.
    const bollardGeos: THREE.BufferGeometry[] = [];
    for (const [bx, bz] of [
      [0.08, 0.82],
      [0.08, 2.28],
    ] as [number, number][]) {
      const post = new THREE.CylinderGeometry(0.028, 0.032, 0.46, 7);
      post.translate(bx, 0.31, bz);
      bollardGeos.push(post);
      const bulb = new THREE.SphereGeometry(0.065, 10, 7);
      bulb.translate(bx, 0.57, bz);
      levelRoots[0].add(new THREE.Mesh(bulb, gardenLightMat));
      resources.push(bulb);
    }
    const mergedBollard = mergeGeometryBatch(bollardGeos);
    if (mergedBollard) {
      const bm = new THREE.Mesh(mergedBollard, palette.aluDark);
      bm.castShadow = true;
      levelRoots[0].add(bm);
      resources.push(mergedBollard);
    }
  }

  // Ground datum ±0.00 lot outline when terrain is hidden so spatial reference stays crisp
  if (!showTerrain) {
    const lotOutlineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.005, 0),
      new THREE.Vector3(project.site.width, 0.005, 0),
      new THREE.Vector3(project.site.width, 0.005, project.site.depth),
      new THREE.Vector3(0, 0.005, project.site.depth),
    ]);
    const lotOutlineMat = new THREE.LineBasicMaterial({ color: 0xe28a48, transparent: true, opacity: 0.65 });
    const lotLoop = new THREE.LineLoop(lotOutlineGeo, lotOutlineMat);
    levelRoots[0].add(lotLoop);
    resources.push(lotOutlineGeo, lotOutlineMat);
  }

  // Optional Terrain Sculpting Overlay from Build Mode
  const th = project.buildExtras?.terrainHeights;
  if (showTerrain && th && th.some((h) => Math.abs(h) > 0.01)) {
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

  // 2. Foundations, Batu Kali / Cakar Ayam / Strauss Pile & Sumur Resapan
  if (showFnd) {
    for (const f of struct.foundations) {
      const fw = project.systems.foundation === "footplate_full" ? 1.2 : project.systems.foundation === "cakar_ayam" ? 1.1 : 1.0;
      batchBase.addGeo(
        "fnd:all",
        concreteStructMat,
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
        concreteStructMat,
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
        for (const sxOff of [-0.24, 0.24]) {
          batchBase.addGeo(
            "fnd:all",
            concreteStructMat,
            "pondasi",
            "Pondasi Strauss Pile Ø30",
            new THREE.CylinderGeometry(0.14, 0.14, 2.4, 10),
            f.x + sxOff,
            -1.95,
            f.z,
            0,
            [0, -1.6, 0],
          );
          if (opts.xrayRebar) {
            batchBase.addGeo(
              "fnd:rebar",
              palette.rebar,
              "pondasi",
              "Tulangan Strauss Pile",
              new THREE.CylinderGeometry(0.08, 0.08, 2.35, 8),
              f.x + sxOff,
              -1.92,
              f.z,
              0,
              [0, -1.6, 0],
            );
          }
        }
      } else if (project.systems.foundation === "cakar_ayam") {
        batchBase.addGeo(
          "fnd:all",
          concreteStructMat,
          "pondasi",
          "Buis Beton Cakar Ayam Ø40",
          new THREE.CylinderGeometry(0.22, 0.22, 1.1, 12),
          f.x,
          -1.25,
          f.z,
          0,
          [0, -1.5, 0],
        );
      }
      if (opts.xrayRebar) {
        for (const off of [-0.32, 0, 0.32]) {
          batchBase.addBox("fnd:rebar", palette.rebar, "pondasi", "Tulangan Footplate", f.x, -0.68, f.z + off, fw * 0.84, 0.03, 0.03, { explodeOff: [0, -1.4, 0] });
          batchBase.addBox("fnd:rebar", palette.rebar, "pondasi", "Tulangan Footplate", f.x + off, -0.68, f.z, 0.03, 0.03, fw * 0.84, { explodeOff: [0, -1.4, 0] });
        }
        for (const [rx, rz] of [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]] as const) {
          batchBase.addBox(
            "fnd:rebar",
            palette.rebar,
            "pondasi",
            "Stek Tulangan Pedestal",
            f.x + rx,
            (lt1Y - 0.65) * 0.5 - 0.1,
            f.z + rz,
            0.025,
            lt1Y + 0.5,
            0.025,
            { explodeOff: [0, -1.4, 0] },
          );
        }
      }
    }

    if (project.systems.foundation === "footplate_batukali") {
      for (const w of project.levels[0]?.walls ?? []) {
        if (w.height < 1.5) continue;
        const dx = w.end.x - w.start.x;
        const dz = w.end.z - w.start.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.2) continue;
        const cx = (w.start.x + w.end.x) * 0.5;
        const cz = (w.start.z + w.end.z) * 0.5;
        const ang = -Math.atan2(dz, dx);
        const stripH = Math.max(0.38, lt1Y + 0.18);
        batchBase.addBox(
          "fnd:batukali",
          palette.mortar,
          "pondasi",
          "Pondasi Jalur Batu Kali",
          cx,
          lt1Y - 0.16 - stripH * 0.5,
          cz,
          len,
          stripH,
          0.34,
          { rotY: ang, explodeOff: [0, -0.95, 0] },
        );
      }
    } else if (project.systems.foundation === "cakar_ayam" && (project.levels[0]?.walls.length ?? 0) > 0) {
      batchBase.addBox(
        "fnd:cakar-plate",
        concreteStructMat,
        "pondasi",
        "Pelat Cakar Ayam 12 cm",
        2.5,
        -0.12,
        10.5,
        5.0,
        0.12,
        13.0,
        { explodeOff: [0, -1.0, 0] },
      );
    }

    for (let i = 0; i < project.floodMitigation.infiltrationWells; i++) {
      batchBase.addGeo(
        "fnd:resapan",
        concreteStructMat,
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

  // 3. Structural Frame (LT1 & LT2 Columns/Beams — strictly bounded to each column's spanned levels!)
  if (showSloofCol) {
    const colMat = project.systems.frame === "steel_wf" ? palette.steelWf : concreteStructMat;
    const hLt1 = project.levels[0]?.height ?? 3.6;
    const hLt2 = project.levels[1]?.height ?? 3.6;

    for (const col of struct.columns) {
      const isCanopy = col.z < 1.0;
      // LT1 segment (ground/sloof up to LT2 slab soffit or capped wall height)
      if (col.minLevel === 0) {
        const capH = col.maxHeightM ? Math.min(hLt1, col.maxHeightM) : hLt1;
        const h1 = isCanopy
          ? Math.max(2.2, lt2Y - 0.38 - (4.45 - col.z) * 0.055 - (lt1Y - 0.15))
          : capH + 0.15;
        batchBase.addGeo(
          "struct:col",
          colMat,
          "kolom",
          `Kolom LT1 (${struct.columns.length} titik)`,
          createChamferBox(col.widthM, h1, col.depthM, 0.008, 1),
          col.x,
          lt1Y - 0.15 + h1 * 0.5,
          col.z,
          0,
          [0, 0.45, 0],
        );
        if (opts.xrayRebar && col.isMain) {
          batchBase.addBox(
            "struct:rebar",
            palette.rebar,
            "kolom",
            `Tulangan Kolom LT1 (${col.rebarSpec})`,
            col.x,
            lt1Y - 0.15 + h1 * 0.5,
            col.z,
            col.widthM * 0.68,
            h1 + 0.08,
            col.depthM * 0.68,
            { explodeOff: [0, 0.45, 0] },
          );
        }
      }

      // LT2 segment (only when this column belongs to LT2!)
      if (col.maxLevel >= 1 && opts.activeLevelView !== "lt1") {
        const capH2 = col.minLevel === 1 && col.maxHeightM ? Math.min(hLt2, col.maxHeightM) : hLt2;
        const h2 = capH2 + 0.12;
        batchLt2.addGeo(
          "struct:col",
          colMat,
          "kolom",
          `Kolom LT2 (${struct.columns.length} titik)`,
          createChamferBox(col.widthM, h2, col.depthM, 0.008, 1),
          col.x,
          lt2Y - 0.04 + h2 * 0.5,
          col.z,
          0,
          [0, 1.35, 0],
        );
        if (opts.xrayRebar && col.isMain) {
          batchLt2.addBox(
            "struct:rebar",
            palette.rebar,
            "kolom",
            `Tulangan Kolom LT2 (${col.rebarSpec})`,
            col.x,
            lt2Y - 0.04 + h2 * 0.5,
            col.z,
            col.widthM * 0.68,
            h2 + 0.08,
            col.depthM * 0.68,
            { explodeOff: [0, 1.35, 0] },
          );
        }
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
      if (opts.xrayRebar && project.systems.frame !== "steel_wf") {
        targetBatch.addBox(
          `struct:rebar-${partId}`,
          palette.rebar,
          partId,
          `Tulangan ${bm.kind.toUpperCase()}`,
          cx,
          y,
          cz,
          Math.max(0.1, bm.lengthM - 0.06),
          bm.heightM * 0.58,
          bm.widthM * 0.56,
          { rotY: ang, explodeOff: [0, expY, 0] },
        );
      }
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
      const mat = slab.isOverhang ? palette.woodDeck : showTileFloor ? palette.tileFloor : concreteStructMat;
      batchLt2.addGeo(`slab:${matKey}`, mat, "pelat", slab.name, geo, 0, lt2Y - slab.thickness, 0, 0, [0, 1.5, 0]);
      if (opts.showFinishing && !slab.isOverhang) {
        const soffitGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false });
        soffitGeo.rotateX(-Math.PI / 2);
        batchLt2.addGeo("slab:ceiling", palette.ceiling, "plafon", "Plafon Gypsum LT1", soffitGeo, 0, lt2Y - slab.thickness - 0.014, 0, 0, [0, 1.5, 0]);
      }
    }
  }

  if (showTileFloor) {
    if (showTerrain) {
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
          mat = palette.getCachedMaterial(customTint.hex, customTint.roughness);
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
      const mat = palette.getCachedMaterial(spec.hex, spec.roughness);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      resources.push(merged);
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
    batchLt2.addBox("rail:glass-stair", palette.glass, "tangga", "Railing Tangga", 1.35, lt2Y + 0.5, 10.0, 0.035, 0.98, 4.9, {
      explodeOff: [0, 1.5, 0],
    });
    batchLt2.addGeo(
      "rail:alu",
      palette.aluDark,
      "tangga",
      "Handrail Tangga & Balkon",
      createChamferBox(0.06, 0.045, 4.95, 0.008, 1),
      1.35,
      lt2Y + 1.0,
      10.0,
      0,
      [0, 1.5, 0],
    );
    for (let pz = 7.6; pz <= 12.45; pz += 1.2) {
      batchLt2.addBox("rail:alu", palette.aluDark, "tangga", "Handrail Tangga & Balkon", 1.35, lt2Y + 0.5, pz, 0.04, 1.0, 0.04, {
        explodeOff: [0, 1.5, 0],
      });
    }
    batchLt2.addBox("rail:glass-balc", palette.glass, "pelat", "Railing Balkon", 1.25, lt2Y + 0.5, 3.04, 2.45, 0.98, 0.035, {
      explodeOff: [0, 1.5, 0],
    });
    batchLt2.addGeo(
      "rail:alu",
      palette.aluDark,
      "pelat",
      "Handrail Balkon",
      createChamferBox(2.5, 0.045, 0.06, 0.008, 1),
      1.25,
      lt2Y + 1.0,
      3.04,
      0,
      [0, 1.5, 0],
    );
    for (const px of [0.06, 0.85, 1.65, 2.44]) {
      batchLt2.addBox("rail:alu", palette.aluDark, "pelat", "Handrail Balkon", px, lt2Y + 0.5, 3.04, 0.04, 1.0, 0.04, {
        explodeOff: [0, 1.5, 0],
      });
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

    // "Bongkar Granular" (Struktur Mode signature): every brick gets its own radial burst vector
    // out of the lot centre, stacked by its own height, so the wall visibly dissolves brick-by-brick.
    // Rigid per-wall transforms are reserved for the plaster skins & openings below.
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
  const cutawayCapMat = palette.getCachedMaterial("#262b33", 0.85);

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
        wallMat = palette.getCachedMaterial(customMat.hex, customMat.roughness);
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
      }
      // Keep plaster skin and its door/window/vent openings locked together during Bongkar,
      // using the original Struktur Mode travel factors (X-splay 0.5, per-level lift 1.3).
      opts.onExplodePiece?.(
        fullGroup,
        new THREE.Vector3(((w.start.x + w.end.x) * 0.5 - 2.5) * 0.5, lvIdx * 1.3, 0),
      );

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
              const renderOpenPct =
                opts.walkOpenDoorsFull && op.openPct > 5 ? Math.max(op.openPct, 94) : op.openPct;
              pivot.rotation.y = op.swing * ((renderOpenPct / 100) * Math.PI * 0.48);
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
          const cuts = w.openings
            .filter((op) => op.sill < effH - 0.03)
            .map((op) => ({
              lo: Math.max(0.02, op.offset - op.width * 0.5),
              hi: Math.min(len - 0.02, op.offset + op.width * 0.5),
            }))
            .filter((c) => c.hi > c.lo + 0.02)
            .sort((a, b) => a.lo - b.lo);

          const spans: [number, number][] = [];
          let cursor = 0;
          for (const c of cuts) {
            if (c.lo > cursor + 0.03) spans.push([cursor, c.lo]);
            cursor = Math.max(cursor, c.hi);
          }
          if (len > cursor + 0.03) spans.push([cursor, len]);

          for (const [s0, s1] of spans) {
            const extL = s0 <= 0.005 ? w.thickness * 0.25 : 0;
            const extR = s1 >= len - 0.005 ? w.thickness * 0.25 : 0;
            const segLo = s0 - extL;
            const segHi = s1 + extR;
            const segLen = segHi - segLo;
            if (segLen < 0.03) continue;
            const midAlong = (segLo + segHi) * 0.5;
            const cx = w.start.x + ux * midAlong;
            const cz = w.start.z + uz * midAlong;

            const bodyG = new THREE.BoxGeometry(segLen, effH, skinT);
            const bodyM = new THREE.Mesh(bodyG, wallMat);
            bodyM.position.set(cx, baseLvY + effH * 0.5, cz);
            bodyM.rotation.y = ang;
            bodyM.castShadow = true;
            bodyM.receiveShadow = true;

            const capG = new THREE.BoxGeometry(segLen, 0.024, skinT + 0.01);
            const capM = new THREE.Mesh(capG, cutawayCapMat);
            capM.position.set(cx, baseLvY + effH + 0.012, cz);
            capM.rotation.y = ang;

            grp.add(bodyM, capM);
            resources.push(bodyG, capG);
          }
          tagPickable(grp, { kind: "wall", id: w.id, levelIndex: lvIdx }, w.name);
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
        0,
        [0, 2.85, 0],
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
        batchRoof.addGeo("roof:gutter", palette.aluDark, "talang", "Pipa Turun Hujan (Downspout)", tubeGeo, 0, 0, 0, 0, [0, 2.85, 0]);
        for (const cy of [1.2, 3.4, 5.6]) {
          batchRoof.addGeo("roof:gutter", palette.aluDark, "talang", "Klem Pipa Talang", new THREE.CylinderGeometry(0.062, 0.062, 0.045, 10), dx, cy, wallZ, 0, [0, 2.85, 0]);
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
        opts.onExplodePiece?.(cpRoof, new THREE.Vector3(0, 1.9, -0.45));
      }

      const cpFrontY = cpHeightAt(cpMidX, cpZ0);
      const cpAvgY = (cpHeightAt(cpMinX, cpZ0) + cpHeightAt(cpMinX, cpZ1)) * 0.5;
      const cpTilt = Math.atan(0.055);
      batchRoof.addBox("roof:cpframe", palette.aluDark, "rangka", "Rangka Kanopi Carport", cpMidX, cpFrontY - 0.03, cpZ0 + 0.03, cpW, 0.1, 0.06, {
        explodeOff: [0, 1.75, -0.45],
      });
      batchRoof.addBox("roof:cpframe", palette.aluDark, "rangka", "Rangka Kanopi Carport", cpMinX + 0.03, cpAvgY - 0.03, (cpZ0 + cpZ1) * 0.5, 0.06, 0.1, cpZ1 - cpZ0, {
        rotX: cpTilt,
        explodeOff: [0, 1.75, -0.45],
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

      // Per-level lighting budget (7 per level max so LT1 never starves LT2) + downward SpotLights so light never bleeds across floors!
      const emitDynamicLights = opts.enableDynamicLights !== false;
      const activeLightsOnLevel = emitDynamicLights ? lv.lights.filter((x) => x.on && x.dimmer > 0) : [];
      const maxHardwareLightsPerLevel = 7;
      const activeIdSet = new Set(activeLightsOnLevel.slice(-maxHardwareLightsPerLevel).map((x) => x.id));

      for (const l of lv.lights) {
        const mesh = buildLightFixtureMesh(l, palette, resources);
        lvGrp.add(mesh);
        tagPickable(mesh, { kind: "light", id: l.id, levelIndex: lvIdx }, l.name);
        if (activeIdSet.has(l.id)) {
          const lightHex = l.colorTempK <= 3200 ? 0xffcb85 : 0xfff3de;
          const clampedY = Math.min(lv.height - 0.25, Math.max(0.25, l.position.y));
          if (l.type === "garden") {
            const pt = new THREE.PointLight(lightHex, (l.lumens / 500) * l.dimmer * 1.4, 2.6, 1.6);
            pt.position.set(l.position.x, clampedY, l.position.z);
            lvGrp.add(pt);
          } else {
            // Downward-aimed SpotLight illuminates only this floor & never bleeds upward through slab into LT2 or downward into LT1
            const halfAngle = Math.min(Math.PI * 0.42, Math.max(0.35, ((l.beamAngleDeg * 0.5) * Math.PI) / 180));
            const rotY = l.rotationY ?? 0;
            const fwdOff = l.type === "wall" ? 1.15 : 0;
            const spot = new THREE.SpotLight(
              lightHex,
              (l.lumens / 450) * l.dimmer * 2.5,
              Math.min(3.85, lv.height + 0.15),
              halfAngle,
              0.78,
              1.4,
            );
            spot.position.set(
              l.position.x + Math.sin(rotY) * (l.type === "wall" ? 0.1 : 0),
              clampedY - 0.04,
              l.position.z + Math.cos(rotY) * (l.type === "wall" ? 0.1 : 0),
            );
            spot.target.position.set(
              l.position.x + Math.sin(rotY) * fwdOff,
              0,
              l.position.z + Math.cos(rotY) * fwdOff,
            );
            lvGrp.add(spot, spot.target);
          }
        }
      }

      levelRoots[lvIdx].add(lvGrp);
    }
  }

  // 10. Canonical Orthogonal MEP X-Ray Overlay (1:1 identical coordinates with Denah 2D!)
  if (showMep) {
    const mepGrp = new THREE.Group();
    const mepCollector = new StaticBatchCollector();
    const upVec = new THREE.Vector3(0, 1, 0);
    const segDir = new THREE.Vector3();
    const segQuat = new THREE.Quaternion();
    const segMid = new THREE.Vector3();
    const segScale = new THREE.Vector3(1, 1, 1);
    const segMat4 = new THREE.Matrix4();

    for (const lvIdx of [0, 1] as const) {
      if (lvIdx === 1 && opts.activeLevelView === "lt1") continue;
      const baseY = lvIdx === 0 ? lt1Y : lt2Y;
      const routes = derived.mepNetwork.routesByLevel[lvIdx];
      const symbols = derived.mepNetwork.symbolsByLevel[lvIdx];

      for (const rt of routes) {
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
        const radius = rt.kind === "air_kotor" ? 0.042 : rt.kind === "air_bersih" || rt.kind === "air_hujan" ? 0.028 : 0.022;
        const partId = isAir ? "pipaAirBersih" : "listrikLampu";

        for (let i = 1; i < rt.pts.length; i++) {
          const a = rt.pts[i - 1]!;
          const b = rt.pts[i]!;
          const ax = a.x;
          const ay = baseY + a.y;
          const az = a.z;
          const bx = b.x;
          const by = baseY + b.y;
          const bz = b.z;
          segDir.set(bx - ax, by - ay, bz - az);
          const len = segDir.length();
          if (len < 0.01) continue;
          segDir.divideScalar(len);
          segQuat.setFromUnitVectors(upVec, segDir);
          segMid.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
          segMat4.compose(segMid, segQuat, segScale);
          const cyl = new THREE.CylinderGeometry(radius, radius, len, 8);
          cyl.applyMatrix4(segMat4);
          mepCollector.addGeo(`mep:${rt.kind}`, mat, partId, rt.label, cyl, 0, 0, 0, 0, undefined, false, false);

          const joint = new THREE.SphereGeometry(radius * 1.18, 8, 6);
          joint.translate(bx, by, bz);
          mepCollector.addGeo(`mep:${rt.kind}`, mat, partId, rt.label, joint, 0, 0, 0, 0, undefined, false, false);
        }
      }

      for (const sym of symbols) {
        if (sym.kind === "panel_mcb" && (opts.showListrik || stage === 7)) {
          mepCollector.addBox(
            "mep:sym-mcb",
            palette.mepElecLamp,
            "panelMcb",
            sym.label,
            sym.x,
            baseY + sym.y,
            sym.z,
            0.3,
            0.4,
            0.12,
            { castShadow: false, receiveShadow: false },
          );
        } else if (sym.kind === "stopkontak" && (opts.showListrik || stage === 7)) {
          mepCollector.addBox(
            "mep:sym-sk",
            palette.mepElecOutlet,
            "stopkontak",
            sym.label,
            sym.x,
            baseY + sym.y,
            sym.z,
            0.1,
            0.1,
            0.05,
            { castShadow: false, receiveShadow: false },
          );
        } else if (sym.kind === "meter_air" && (opts.showAir || stage === 7)) {
          mepCollector.addBox(
            "mep:sym-mtr",
            palette.mepWaterClean,
            "meterAir",
            sym.label,
            sym.x,
            0.12,
            sym.z,
            0.24,
            0.18,
            0.18,
            { castShadow: false, receiveShadow: false },
          );
        }
      }
    }

    mepCollector.flush(mepGrp, resources, (mesh, partId, label) => {
      mesh.renderOrder = 950;
      tagPickable(mesh, { kind: "part", id: partId as never }, label);
    });

    if (opts.showAir || stage === 7) {
      const bioGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.35, 16);
      const bio = new THREE.Mesh(bioGeo, palette.mepWaterWaste);
      bio.position.set(2.8, -0.75, 1.6);
      bio.renderOrder = 951;
      mepGrp.add(bio);
      resources.push(bioGeo);
      tagPickable(bio, { kind: "part", id: "septic" }, "Bio Septic Tank (di bawah Carport)");
    }
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
