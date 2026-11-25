import * as THREE from "three";
import { WALK_CONFIG } from "@/features/walkMode/walkConfig";
import { createChamferBox } from "@/lib/scene/geometryHelpers";

/**
 * Clean semi-realistic articulated resident avatar (matching `WALK_CONFIG.capsuleHeight = 1.72m`)
 * following `game-dev-character-model`: layered warm palette, contact shadow, articulated limbs,
 * procedural walk/run/stair gait, and zero overlapping visual clutter.
 */
export class WalkAvatar {
  public readonly root = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly leftArmPivot = new THREE.Group();
  private readonly rightArmPivot = new THREE.Group();
  private readonly leftLegPivot = new THREE.Group();
  private readonly rightLegPivot = new THREE.Group();
  private readonly resources: (THREE.BufferGeometry | THREE.Material)[] = [];

  private facingYaw = 0;
  private stridePhase = 0;

  constructor(contactShadowTex: THREE.Texture | null) {
    this.root.name = "WalkResidentAvatar";

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe3b490, roughness: 0.62, metalness: 0.0 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x26211d, roughness: 0.78, metalness: 0.04 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3b7d72, roughness: 0.72, metalness: 0.02 });
    const collarMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.7, metalness: 0.02 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2f3640, roughness: 0.76, metalness: 0.04 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xeee9e0, roughness: 0.55, metalness: 0.05 });
    const shadowMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex ?? undefined,
      color: 0x11151b,
      transparent: true,
      opacity: contactShadowTex ? 0.55 : 0.25,
      depthWrite: false,
    });
    this.resources.push(skinMat, hairMat, shirtMat, collarMat, pantsMat, shoeMat, shadowMat);

    // Contact shadow at feet
    const shadowGeo = new THREE.CircleGeometry(0.28, 20);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.012;
    this.root.add(shadow);
    this.resources.push(shadowGeo);

    // Legs (hip pivot at y = 0.84m -> leg length 0.84m to feet)
    const buildLeg = (pivot: THREE.Group, offsetX: number) => {
      pivot.position.set(offsetX, 0.84, 0);
      const legGeo = createChamferBox(0.125, 0.74, 0.135, 0.025, 2);
      const legMesh = new THREE.Mesh(legGeo, pantsMat);
      legMesh.position.y = -0.37;
      legMesh.castShadow = true;

      const shoeGeo = createChamferBox(0.12, 0.09, 0.21, 0.022, 2);
      const shoeMesh = new THREE.Mesh(shoeGeo, shoeMat);
      shoeMesh.position.set(0, -0.795, 0.03);
      shoeMesh.castShadow = true;

      pivot.add(legMesh, shoeMesh);
      this.resources.push(legGeo, shoeGeo);
      this.bodyGroup.add(pivot);
    };
    buildLeg(this.leftLegPivot, -0.095);
    buildLeg(this.rightLegPivot, 0.095);

    // Torso (0.84 -> 1.42m)
    const torsoGeo = createChamferBox(0.32, 0.56, 0.19, 0.04, 2);
    const torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.y = 1.13;
    torso.castShadow = true;
    this.bodyGroup.add(torso);

    const collarGeo = new THREE.CylinderGeometry(0.085, 0.105, 0.06, 14);
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.y = 1.41;
    this.bodyGroup.add(collar);
    this.resources.push(torsoGeo, collarGeo);

    // Arms (shoulder pivot at y = 1.36m)
    const buildArm = (pivot: THREE.Group, offsetX: number) => {
      pivot.position.set(offsetX, 1.36, 0);
      const sleeveGeo = createChamferBox(0.1, 0.38, 0.1, 0.025, 2);
      const sleeve = new THREE.Mesh(sleeveGeo, shirtMat);
      sleeve.position.y = -0.18;
      sleeve.castShadow = true;

      const handGeo = new THREE.SphereGeometry(0.052, 10, 10);
      const hand = new THREE.Mesh(handGeo, skinMat);
      hand.position.y = -0.41;
      hand.castShadow = true;

      pivot.add(sleeve, hand);
      this.resources.push(sleeveGeo, handGeo);
      this.bodyGroup.add(pivot);
    };
    buildArm(this.leftArmPivot, -0.22);
    buildArm(this.rightArmPivot, 0.22);

    // Head + Hair (top reaches ~1.71m, fitting inside capsuleHeight 1.72m)
    this.headGroup.position.set(0, 1.54, 0);
    const headGeo = new THREE.SphereGeometry(0.122, 16, 14);
    headGeo.scale(0.92, 1.05, 0.96);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.castShadow = true;

    const hairGeo = new THREE.SphereGeometry(0.128, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
    hairGeo.scale(0.94, 1.04, 1.0);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.set(0, 0.02, -0.015);
    hair.rotation.x = -0.22;
    hair.castShadow = true;

    this.headGroup.add(head, hair);
    this.bodyGroup.add(this.headGroup);
    this.resources.push(headGeo, hairGeo);

    this.root.add(this.bodyGroup);
  }

  public update(
    dt: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vz: number,
    cameraYaw: number,
    onStair: boolean,
    visible: boolean,
  ): void {
    this.root.position.set(x, y, z);
    this.root.visible = visible;
    if (!visible) return;

    const speed = Math.hypot(vx, vz);
    const targetYaw = speed > 0.14 ? Math.atan2(vx, vz) : cameraYaw;

    // Shortest-path angle lerp
    let diff = targetYaw - this.facingYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facingYaw += diff * Math.min(1, dt * WALK_CONFIG.avatarTurnSpeedRad);
    this.bodyGroup.rotation.y = this.facingYaw;

    if (speed > 0.12) {
      const rate = speed * (onStair ? 4.2 : 3.2);
      this.stridePhase += dt * rate;
      const swingAmp = Math.min(0.68, 0.25 + speed * 0.11);
      const legSwing = Math.sin(this.stridePhase) * swingAmp;
      const armSwing = legSwing * 0.72;
      this.leftLegPivot.rotation.x = legSwing;
      this.rightLegPivot.rotation.x = -legSwing;
      this.leftArmPivot.rotation.x = -armSwing;
      this.rightArmPivot.rotation.x = armSwing;
      this.bodyGroup.position.y = Math.abs(Math.sin(this.stridePhase)) * (onStair ? 0.038 : 0.024);
    } else {
      // Relaxed idle decay
      const settle = Math.min(1, dt * 10);
      this.leftLegPivot.rotation.x *= 1 - settle;
      this.rightLegPivot.rotation.x *= 1 - settle;
      this.leftArmPivot.rotation.x *= 1 - settle;
      this.rightArmPivot.rotation.x *= 1 - settle;
      this.bodyGroup.position.y *= 1 - settle;
    }
  }

  public dispose(): void {
    for (const r of this.resources) r.dispose();
  }
}
