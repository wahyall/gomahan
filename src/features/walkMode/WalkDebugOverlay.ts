import * as THREE from "three";
import type { WalkCollisionWorld } from "@/features/walkMode/collisionBuilder";
import type { WalkController } from "@/features/walkMode/WalkController";
import { WALK_CONFIG } from "@/features/walkMode/walkConfig";

/**
 * Toggleable (`F3`) Debug Wireframe Overlay showing strictly data-derived colliders,
 * stair ramps, and the live kinematic player capsule. Zero per-frame heap allocations.
 */
export class WalkDebugOverlay {
  public readonly root = new THREE.Group();
  private readonly worldGroup = new THREE.Group();
  private readonly capsuleGroup = new THREE.Group();
  private readonly capsuleMat: THREE.LineBasicMaterial;
  private readonly worldDisposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly staticDisposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor() {
    this.root.visible = false;
    this.root.renderOrder = 995;

    // Player capsule wireframe (`cylinder` body + top/bottom hemisphere rings)
    this.capsuleMat = new THREE.LineBasicMaterial({ color: 0x2ee68e, depthTest: false, transparent: true, opacity: 0.95 });
    const r = WALK_CONFIG.capsuleRadius;
    const h = WALK_CONFIG.capsuleHeight;
    const bodyCyl = new THREE.CylinderGeometry(r, r, h - r * 2, 16, 1, true);
    const bodyEdges = new THREE.EdgesGeometry(bodyCyl);
    bodyCyl.dispose();
    const cylLines = new THREE.LineSegments(bodyEdges, this.capsuleMat);
    cylLines.position.y = h * 0.5;
    cylLines.renderOrder = 996;

    const ringGeo = new THREE.RingGeometry(r * 0.96, r, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const baseRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.85 }),
    );
    baseRing.position.y = 0.025;
    baseRing.renderOrder = 996;

    // Forward indicator tick
    const dirPts = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.9, 0),
      new THREE.Vector3(0, 0.9, r + 0.35),
    ]);
    const dirLine = new THREE.LineSegments(dirPts, this.capsuleMat);
    dirLine.renderOrder = 996;

    this.capsuleGroup.add(cylLines, baseRing, dirLine);
    this.staticDisposables.push(bodyEdges, ringGeo, baseRing.material as THREE.Material, dirPts, this.capsuleMat);
    this.root.add(this.worldGroup, this.capsuleGroup);
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  public isVisible(): boolean {
    return this.root.visible;
  }

  public rebuildWorld(world: WalkCollisionWorld): void {
    for (const r of this.worldDisposables) r.dispose();
    this.worldDisposables.length = 0;
    this.worldGroup.clear();

    const matWall = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.72 });
    const matClosed = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.88 });
    const matFurn = new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.65 });
    const matRail = new THREE.LineBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.85 });
    const matStair = new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.9 });
    this.worldDisposables.push(matWall, matClosed, matFurn, matRail, matStair);

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitEdges = new THREE.EdgesGeometry(unitBox);
    unitBox.dispose();
    this.worldDisposables.push(unitEdges);

    for (const b of world.colliders) {
      if (b.kind === "neighbor") continue; // keep view readable inside lot
      const h = Math.max(0.1, b.yMax - b.yMin);
      const line = new THREE.LineSegments(
        unitEdges,
        b.kind === "closed_door"
          ? matClosed
          : b.kind === "furniture"
            ? matFurn
            : b.kind === "railing"
              ? matRail
              : matWall,
      );
      line.scale.set(b.halfW * 2, h, b.halfD * 2);
      line.position.set(b.cx, b.yMin + h * 0.5, b.cz);
      line.rotation.y = b.rotY;
      this.worldGroup.add(line);
    }

    for (const st of world.stairs) {
      const rx = st.dirZ * st.halfWidth;
      const rz = -st.dirX * st.halfWidth;
      const pts = [
        new THREE.Vector3(st.startX - rx, st.baseY + 0.04, st.startZ - rz),
        new THREE.Vector3(st.startX + rx, st.baseY + 0.04, st.startZ + rz),
        new THREE.Vector3(st.startX + rx, st.baseY + 0.04, st.startZ + rz),
        new THREE.Vector3(st.endX + rx, st.topY + 0.04, st.endZ + rz),
        new THREE.Vector3(st.endX + rx, st.topY + 0.04, st.endZ + rz),
        new THREE.Vector3(st.endX - rx, st.topY + 0.04, st.endZ - rz),
        new THREE.Vector3(st.endX - rx, st.topY + 0.04, st.endZ - rz),
        new THREE.Vector3(st.startX - rx, st.baseY + 0.04, st.startZ - rz),
      ];
      const rampGeo = new THREE.BufferGeometry().setFromPoints(pts);
      this.worldDisposables.push(rampGeo);
      this.worldGroup.add(new THREE.LineSegments(rampGeo, matStair));
    }
  }

  public update(ctrl: WalkController): void {
    if (!this.root.visible) return;
    this.capsuleGroup.position.set(ctrl.x, ctrl.y, ctrl.z);
    this.capsuleGroup.rotation.y = ctrl.yaw;
    this.capsuleMat.color.setHex(ctrl.collidedLastTick ? 0xfbbf24 : ctrl.grounded ? 0x2ee68e : 0xf43f5e);
  }

  public dispose(): void {
    for (const r of this.worldDisposables) r.dispose();
    for (const r of this.staticDisposables) r.dispose();
  }
}
