import {
  buildWalkCollisionWorld,
  intersectRayObb3D,
  isWallOverlappingVerticalSpan,
  resolveCircleVsObb2D,
  sampleWalkSurface,
  type WalkCollisionWorld,
  type WalkColliderBox,
  type WalkDoorInteractable,
} from "@/features/walkMode/collisionBuilder";
import { WALK_CONFIG } from "@/features/walkMode/walkConfig";
import type { WalkSurfaceMaterial } from "@/lib/audio/simsAudio";
import type { Project } from "@/lib/model/types";

export interface WalkInputState {
  forward: number; // -1..+1 relative to camera yaw
  strafe: number; // -1..+1 relative to camera right
  sprint: boolean;
  yaw: number; // radians; 0 looks along +Z, Math.PI along -Z
}

export interface WalkSnapshotState {
  x: number;
  y: number; // feet Y
  z: number;
  vx: number;
  vz: number;
  speed: number;
  yaw: number;
  grounded: boolean;
  currentLevel: 0 | 1;
  onStairId: string | null;
  roomName: string;
  surface: WalkSurfaceMaterial;
  nearestDoor: WalkDoorInteractable | null;
  collidedLastTick: boolean;
  lastCollisionLabels: string[];
  distanceTraveledM: number;
}

/**
 * Pure deterministic kinematic capsule controller backed strictly by `WalkCollisionWorld`.
 * Features 60 Hz fixed-timestep accumulation, max-step substepping (zero tunneling),
 * iterative multi-contact 2D OBB sliding, step-up & max-slope limits, stair ramps,
 * anti-fall upper-slab protection, spawn push-out, and collider spring-arm raycasting.
 */
export class WalkController {
  public world: WalkCollisionWorld;
  public x: number = WALK_CONFIG.defaultSpawn.x;
  public y = 0.4;
  public z: number = WALK_CONFIG.defaultSpawn.z;
  public vx = 0;
  public vz = 0;
  public yaw: number = WALK_CONFIG.defaultSpawn.yaw;
  public grounded = true;
  public currentLevel: 0 | 1 = 0;
  public onStairId: string | null = null;
  public roomName = "Teras Depan";
  public surface: WalkSurfaceMaterial = "wood";
  public nearestDoor: WalkDoorInteractable | null = null;
  public collidedLastTick = false;
  public lastCollisionLabels: string[] = [];
  public distanceTraveledM = 0;

  private accumulator = 0;
  private seenStamp: Uint32Array;
  private stampCounter = 1;
  private readonly queryBuffer: number[] = [];

  constructor(project: Project) {
    this.world = buildWalkCollisionWorld(project);
    this.seenStamp = new Uint32Array(Math.max(64, this.world.colliders.length + 16));
    this.teleportToSafeSpawn();
  }

  public rebuildColliders(project: Project): void {
    this.world = buildWalkCollisionWorld(project);
    if (this.seenStamp.length < this.world.colliders.length + 16) {
      this.seenStamp = new Uint32Array(this.world.colliders.length + 32);
    }
    this.validateAndPushOutCurrentPosition();
    this.refreshFloorAndDoorState();
  }

  public teleportToSafeSpawn(): void {
    const startX = WALK_CONFIG.defaultSpawn.x;
    const startZ = WALK_CONFIG.defaultSpawn.z;
    const startSample = sampleWalkSurface(this.world, startX, startZ, this.world.terasY);
    if (!this.wouldCollideAt(startX, startSample.y, startZ)) {
      this.x = startX;
      this.y = startSample.y;
      this.z = startZ;
      this.vx = 0;
      this.vz = 0;
      this.yaw = WALK_CONFIG.defaultSpawn.yaw;
      this.refreshFloorAndDoorState();
      return;
    }

    // Spiral fallback search around Teras -> Ruang Tamu -> Street
    const ringRadii = [0.35, 0.7, 1.1, 1.6, 2.2, 3.0];
    for (const rad of ringRadii) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const cx = startX + Math.cos(ang) * rad;
        const cz = startZ + Math.sin(ang) * rad;
        if (!this.inLotWalkBounds(cx, cz)) continue;
        const s = sampleWalkSurface(this.world, cx, cz, this.world.terasY);
        if (s.supported && !this.wouldCollideAt(cx, s.y, cz)) {
          this.x = cx;
          this.y = s.y;
          this.z = cz;
          this.vx = 0;
          this.vz = 0;
          this.refreshFloorAndDoorState();
          return;
        }
      }
    }

    // Last resort clean street spot in front of lot
    this.x = 2.5;
    this.y = this.world.streetY;
    this.z = -1.6;
    this.vx = 0;
    this.vz = 0;
    this.yaw = 0;
    this.refreshFloorAndDoorState();
  }

  public setPositionDirect(x: number, y: number, z: number, yaw: number = this.yaw): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.validateAndPushOutCurrentPosition();
    this.refreshFloorAndDoorState();
  }

  private inLotWalkBounds(x: number, z: number): boolean {
    const b = WALK_CONFIG.lotWalkBounds;
    const r = WALK_CONFIG.capsuleRadius;
    return x >= b.minX + r && x <= b.maxX - r && z >= b.minZ + r && z <= b.maxZ - r;
  }

  private queryNearbyColliders(x: number, z: number, radius: number): void {
    this.stampCounter += 1;
    if (this.stampCounter >= 0xfffffffe) {
      this.seenStamp.fill(0);
      this.stampCounter = 1;
    }
    this.world.spatial.queryAabb(
      x - radius,
      x + radius,
      z - radius,
      z + radius,
      this.seenStamp,
      this.stampCounter,
      this.queryBuffer,
    );
  }

  public wouldCollideAt(x: number, feetY: number, z: number): boolean {
    if (!this.inLotWalkBounds(x, z)) return true;
    const r = WALK_CONFIG.capsuleRadius;
    this.queryNearbyColliders(x, z, r + 0.12);
    for (let i = 0; i < this.queryBuffer.length; i++) {
      const box = this.world.colliders[this.queryBuffer[i]!]!;
      if (!isWallOverlappingVerticalSpan(box, feetY, WALK_CONFIG.stepHeight, WALK_CONFIG.capsuleHeight)) continue;
      if (resolveCircleVsObb2D(x, z, r, box)) return true;
    }
    return false;
  }

  private validateAndPushOutCurrentPosition(): void {
    const r = WALK_CONFIG.capsuleRadius;
    for (let pass = 0; pass < WALK_CONFIG.collisionSolverPasses * 2; pass++) {
      let pushed = false;
      this.queryNearbyColliders(this.x, this.z, r + 0.45);
      for (let i = 0; i < this.queryBuffer.length; i++) {
        const box = this.world.colliders[this.queryBuffer[i]!]!;
        if (!isWallOverlappingVerticalSpan(box, this.y, WALK_CONFIG.stepHeight, WALK_CONFIG.capsuleHeight)) continue;
        const mtv = resolveCircleVsObb2D(this.x, this.z, r + 0.002, box);
        if (mtv) {
          this.x += mtv[0];
          this.z += mtv[1];
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    const b = WALK_CONFIG.lotWalkBounds;
    this.x = Math.max(b.minX + r, Math.min(b.maxX - r, this.x));
    this.z = Math.max(b.minZ + r, Math.min(b.maxZ - r, this.z));

    // If pinched between adjacent obstacles (e.g. sofa + coffee table), relocate to nearest free supported point
    if (this.wouldCollideAt(this.x, this.y, this.z)) {
      const originX = this.x;
      const originZ = this.z;
      for (const rad of [0.25, 0.5, 0.8, 1.15, 1.6, 2.2]) {
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const cx = originX + Math.cos(ang) * rad;
          const cz = originZ + Math.sin(ang) * rad;
          if (!this.inLotWalkBounds(cx, cz)) continue;
          const s = sampleWalkSurface(this.world, cx, cz, this.y);
          if (s.supported && Math.abs(s.y - this.y) <= WALK_CONFIG.stepHeight + 0.2 && !this.wouldCollideAt(cx, s.y, cz)) {
            this.x = cx;
            this.z = cz;
            this.y = s.y;
            return;
          }
        }
      }
    }
  }

  /**
   * Advances simulation using fixed 60 Hz steps with substep division when distance > radius*ratio.
   */
  public step(rawDt: number, input: WalkInputState): WalkSnapshotState {
    const dt = Math.min(WALK_CONFIG.maxFrameDt, Math.max(0, rawDt));
    this.accumulator += dt;
    this.yaw = input.yaw;

    while (this.accumulator >= WALK_CONFIG.fixedDt) {
      this.fixedTick(WALK_CONFIG.fixedDt, input);
      this.accumulator -= WALK_CONFIG.fixedDt;
    }

    return this.getSnapshot();
  }

  private fixedTick(dt: number, input: WalkInputState): void {
    // Normalize diagonal movement cleanly
    let inFwd = input.forward;
    let inRight = input.strafe;
    const mag = Math.hypot(inFwd, inRight);
    if (mag > 1) {
      inFwd /= mag;
      inRight /= mag;
    }

    // Forward along yaw: yaw=0 -> +Z (`sin=0, cos=1`) so +forward looks toward building (`+Z`)
    const fwdX = Math.sin(input.yaw);
    const fwdZ = Math.cos(input.yaw);
    const rightX = -Math.cos(input.yaw);
    const rightZ = Math.sin(input.yaw);

    const wishDirX = fwdX * inFwd + rightX * inRight;
    const wishDirZ = fwdZ * inFwd + rightZ * inRight;
    const wishLen = Math.hypot(wishDirX, wishDirZ);
    const maxSpeed = input.sprint ? WALK_CONFIG.runSpeed : WALK_CONFIG.walkSpeed;

    if (wishLen > 1e-4) {
      const targetVx = (wishDirX / wishLen) * maxSpeed * Math.min(1, mag);
      const targetVz = (wishDirZ / wishLen) * maxSpeed * Math.min(1, mag);
      const dv = WALK_CONFIG.accel * dt;
      const errX = targetVx - this.vx;
      const errZ = targetVz - this.vz;
      const errMag = Math.hypot(errX, errZ);
      if (errMag <= dv) {
        this.vx = targetVx;
        this.vz = targetVz;
      } else {
        this.vx += (errX / errMag) * dv;
        this.vz += (errZ / errMag) * dv;
      }
    } else {
      const curSpd = Math.hypot(this.vx, this.vz);
      const drop = WALK_CONFIG.decel * dt;
      if (curSpd <= drop) {
        this.vx = 0;
        this.vz = 0;
      } else {
        const k = (curSpd - drop) / curSpd;
        this.vx *= k;
        this.vz *= k;
      }
    }

    const totalMove = Math.hypot(this.vx * dt, this.vz * dt);
    const maxStepDist = WALK_CONFIG.capsuleRadius * WALK_CONFIG.maxSubstepMoveRatio;
    const substeps = Math.max(1, Math.ceil(totalMove / maxStepDist));
    const subDt = dt / substeps;

    this.collidedLastTick = false;
    const labels = new Set<string>();

    for (let s = 0; s < substeps; s++) {
      this.advanceSubstep(subDt, labels);
    }

    this.lastCollisionLabels = Array.from(labels);
    this.refreshFloorAndDoorState();
  }

  private advanceSubstep(dt: number, hitLabels: Set<string>): void {
    const startX = this.x;
    const startZ = this.z;
    const startY = this.y;

    let candX = this.x + this.vx * dt;
    let candZ = this.z + this.vz * dt;
    const r = WALK_CONFIG.capsuleRadius;

    // 1. Multi-pass iterative Circle-vs-OBB sliding against spatial hash colliders
    for (let pass = 0; pass < WALK_CONFIG.collisionSolverPasses; pass++) {
      this.queryNearbyColliders(candX, candZ, r + 0.25);
      let anyHit = false;
      for (let i = 0; i < this.queryBuffer.length; i++) {
        const box = this.world.colliders[this.queryBuffer[i]!]!;
        if (!isWallOverlappingVerticalSpan(box, startY, WALK_CONFIG.stepHeight, WALK_CONFIG.capsuleHeight)) {
          continue;
        }
        const mtv = resolveCircleVsObb2D(candX, candZ, r, box);
        if (mtv) {
          candX += mtv[0];
          candZ += mtv[1];
          anyHit = true;
          this.collidedLastTick = true;
          hitLabels.add(box.label);
        }
      }
      if (!anyHit) break;
    }

    // 2. Clamp to outer walkable lot boundary
    const b = WALK_CONFIG.lotWalkBounds;
    if (candX < b.minX + r) {
      candX = b.minX + r;
      this.collidedLastTick = true;
    } else if (candX > b.maxX - r) {
      candX = b.maxX - r;
      this.collidedLastTick = true;
    }
    if (candZ < b.minZ + r) {
      candZ = b.minZ + r;
      this.collidedLastTick = true;
    } else if (candZ > b.maxZ - r) {
      candZ = b.maxZ - r;
      this.collidedLastTick = true;
    }

    // 3. Anti-fall upper-slab guard & max-slope / step-up check
    const candSurface = sampleWalkSurface(this.world, candX, candZ, startY);
    if (!candSurface.supported) {
      // Prevent walking off open LT2 ledges / void drops where no rail or stair connects
      this.collidedLastTick = true;
      hitLabels.add("Batas Drop Lantai 2");
      // Try sliding cleanly on individual axes before rejecting full move
      const tryXSurface = sampleWalkSurface(this.world, candX, startZ, startY);
      const tryZSurface = sampleWalkSurface(this.world, startX, candZ, startY);
      if (tryXSurface.supported && !this.wouldCollideAt(candX, tryXSurface.y, startZ)) {
        candZ = startZ;
      } else if (tryZSurface.supported && !this.wouldCollideAt(startX, tryZSurface.y, candZ)) {
        candX = startX;
      } else {
        candX = startX;
        candZ = startZ;
      }
    } else {
      const horizDist = Math.hypot(candX - startX, candZ - startZ);
      const deltaY = candSurface.y - startY;
      if (deltaY > WALK_CONFIG.stepHeight) {
        // Vertical ledge strictly higher than stepHeight without ramp -> block
        this.collidedLastTick = true;
        candX = startX;
        candZ = startZ;
      } else if (deltaY > 0.04 && horizDist > 1e-4 && !candSurface.onStairId) {
        // Non-stair steep slope rejection unless clean low discrete architectural step (<= stepHeight)
        const maxTan = Math.tan((WALK_CONFIG.maxSlopeDeg * Math.PI) / 180);
        if (deltaY > WALK_CONFIG.stepHeight || (deltaY > 0.25 && deltaY / horizDist > maxTan * 2.5)) {
          this.collidedLastTick = true;
          candX = startX;
          candZ = startZ;
        }
      }
    }

    // Apply validated XZ displacement and project velocity cleanly onto wall tangent
    const actualDx = candX - startX;
    const actualDz = candZ - startZ;
    this.x = candX;
    this.z = candZ;
    this.distanceTraveledM += Math.hypot(actualDx, actualDz);

    // Prevent velocity accumulating inward into walls
    if (dt > 1e-6 && this.collidedLastTick) {
      this.vx = actualDx / dt;
      this.vz = actualDz / dt;
    }

    // Vertical floor/stair snapping
    const finalSample = sampleWalkSurface(this.world, this.x, this.z, this.y);
    if (finalSample.supported) {
      const targetY = finalSample.y;
      if (this.y > targetY + 0.015) {
        const drop = Math.min(this.y - targetY, Math.max(0.18, WALK_CONFIG.gravity * dt));
        this.y -= drop;
      } else {
        // Smooth upward blend for stair steps & curb steps
        const blend = finalSample.onStairId ? 0.55 : 0.42;
        this.y += (targetY - this.y) * Math.min(1, blend + dt * 16);
      }
      if (Math.abs(this.y - targetY) < 0.008) this.y = targetY;
      this.grounded = true;
    }
  }

  private refreshFloorAndDoorState(): void {
    const s = sampleWalkSurface(this.world, this.x, this.z, this.y);
    this.currentLevel = s.levelIndex;
    this.onStairId = s.onStairId;
    this.roomName = s.roomName;
    this.surface = s.surface;

    // Prioritize door the avatar is facing within interaction distance
    let bestDoor: WalkDoorInteractable | null = null;
    let bestScore = Infinity;
    const lookX = Math.sin(this.yaw);
    const lookZ = Math.cos(this.yaw);
    for (const d of this.world.doors) {
      if (d.levelIndex !== this.currentLevel) continue;
      const dx = d.cx - this.x;
      const dz = d.cz - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= WALK_CONFIG.doorInteractDistanceM) {
        const dot = dist > 0.05 ? (dx / dist) * lookX + (dz / dist) * lookZ : 1;
        const penalty = dot > 0.25 ? 0 : 0.65;
        const score = dist + penalty;
        if (score < bestScore) {
          bestScore = score;
          bestDoor = d;
        }
      }
    }
    this.nearestDoor = bestDoor;
  }

  /**
   * Spring-arm camera occlusion solver against strictly data-derived `WalkCollisionWorld` (`blocksCamera = true`).
   * Guarantees the 3rd-person camera never penetrates interior/exterior walls or drops under slabs.
   */
  public raycastCameraSpringArm(
    ox: number,
    oy: number,
    oz: number,
    desiredX: number,
    desiredY: number,
    desiredZ: number,
  ): { x: number; y: number; z: number; clipped: boolean } {
    const dx = desiredX - ox;
    const dy = desiredY - oy;
    const dz = desiredZ - oz;
    const totalLen = Math.hypot(dx, dy, dz);
    if (totalLen < 1e-4) return { x: desiredX, y: desiredY, z: desiredZ, clipped: false };

    const minX = Math.min(ox, desiredX) - 0.35;
    const maxX = Math.max(ox, desiredX) + 0.35;
    const minZ = Math.min(oz, desiredZ) - 0.35;
    const maxZ = Math.max(oz, desiredZ) + 0.35;

    this.stampCounter += 1;
    if (this.stampCounter >= 0xfffffffe) {
      this.seenStamp.fill(0);
      this.stampCounter = 1;
    }
    this.world.spatial.queryAabb(minX, maxX, minZ, maxZ, this.seenStamp, this.stampCounter, this.queryBuffer);

    let bestT = 1.0;
    const pad = WALK_CONFIG.thirdPerson.armWallPadding;

    for (let i = 0; i < this.queryBuffer.length; i++) {
      const box = this.world.colliders[this.queryBuffer[i]!]!;
      if (!box.blocksCamera) continue;
      const t = intersectRayObb3D(ox, oy, oz, dx, dy, dz, box, pad);
      if (t !== null && t < bestT) {
        bestT = t;
      }
    }

    // Clamp minimum distance from avatar head so camera stays readable even against tight wall corner
    const minT = Math.min(1, WALK_CONFIG.thirdPerson.minDist / totalLen);
    const clampedT = bestT < 1 ? Math.max(minT, bestT * 0.94) : 1.0;

    // Also clamp camera height above active floor / ground (prevent poking below floor slab)
    const camX = ox + dx * clampedT;
    const camZ = oz + dz * clampedT;
    const floorSample = sampleWalkSurface(this.world, camX, camZ, this.y);
    const minCamY = (floorSample.supported ? floorSample.y : this.y) + 0.3;
    const camY = Math.max(minCamY, oy + dy * clampedT);

    return {
      x: camX,
      y: camY,
      z: camZ,
      clipped: bestT < 0.999,
    };
  }

  public getActiveDebugBoxes(): WalkColliderBox[] {
    return this.world.colliders;
  }

  public getSnapshot(): WalkSnapshotState {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      vx: this.vx,
      vz: this.vz,
      speed: Math.hypot(this.vx, this.vz),
      yaw: this.yaw,
      grounded: this.grounded,
      currentLevel: this.currentLevel,
      onStairId: this.onStairId,
      roomName: this.roomName,
      surface: this.surface,
      nearestDoor: this.nearestDoor,
      collidedLastTick: this.collidedLastTick,
      lastCollisionLabels: this.lastCollisionLabels,
      distanceTraveledM: this.distanceTraveledM,
    };
  }
}
