import * as THREE from "three";
import type { BuildCameraSnapshot } from "@/features/buildMode/types";

export interface BuildCameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const DEFAULT_SNAPSHOT: BuildCameraSnapshot = {
  target: [2.5, 3.25, 8.5], // visual centre of the 5m x 17m two-storey mass
  yaw: Math.PI * 1.18, // architectural 3/4 from the garden side, carport receding to the right
  pitch: 0.34, // shallower hero angle keeps the facade upright and leaves sky above the ridge
  distance: 27.5, // full 17m lot plus foreground landscaping, no cropped eave
};

/**
 * Dedicated Sims 4-inspired angled perspective camera controller for Build Mode.
 * Strictly isolated from any Walk Mode camera state.
 */
export class BuildCameraController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly orthoCamera: THREE.OrthographicCamera;
  private useOrtho = false;
  private allowUnderground = false;
  private domElement: HTMLElement;
  private domRect: DOMRect | null = null;
  private bounds: BuildCameraBounds;
  private aspect = 16 / 9;

  // Target (desired damped goal) & Current (rendered smooth state)
  private goalTarget = new THREE.Vector3(...DEFAULT_SNAPSHOT.target);
  private currTarget = new THREE.Vector3(...DEFAULT_SNAPSHOT.target);
  private goalYaw = DEFAULT_SNAPSHOT.yaw;
  private currYaw = DEFAULT_SNAPSHOT.yaw;
  private goalPitch = DEFAULT_SNAPSHOT.pitch;
  private currPitch = DEFAULT_SNAPSHOT.pitch;
  private goalDistance = DEFAULT_SNAPSHOT.distance;
  private currDistance = DEFAULT_SNAPSHOT.distance;

  private keys = new Set<string>();
  private snap90Enabled = false;
  private edgeScrollEnabled = false;

  // Pointer drag state
  private dragMode: "none" | "orbit" | "pan" = "none";
  private rightDragPending = false;
  private rightDownX = 0;
  private rightDownY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private cursorNdc = new THREE.Vector2(0, 0);
  private cursorInside = false;

  // Scratch vectors to avoid per-frame allocations
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly _hit = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _wheelNdc = new THREE.Vector2(0, 0);

  // Touch pinch / 2-finger orbit & pan state
  private activeTouches = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;
  private lastTouchMid: { x: number; y: number } | null = null;
  private lastTouchAngle = 0;

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;
  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerMoveBound: (e: PointerEvent) => void;
  private readonly onPointerUpBound: (e: PointerEvent) => void;
  private readonly onPointerLeaveBound: () => void;
  private readonly onWheelBound: (e: WheelEvent) => void;
  private readonly onContextMenuBound: (e: MouseEvent) => void;
  private readonly onBlurBound: () => void;

  constructor(domElement: HTMLElement, aspect = 16 / 9, initialBounds?: BuildCameraBounds) {
    this.domElement = domElement;
    this.bounds = initialBounds ?? { minX: -5, maxX: 10, minZ: -5, maxZ: 22 };
    this.aspect = Math.max(0.1, aspect);
    // 42° keeps verticals calmer than a wide game camera while still fitting the narrow lot.
    this.camera = new THREE.PerspectiveCamera(42, this.aspect, 0.2, 280);
    this.orthoCamera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.2, 280);
    this.updateCameraTransform();

    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    this.onKeyUpBound = (e) => this.handleKeyUp(e);
    this.onPointerDownBound = (e) => this.handlePointerDown(e);
    this.onPointerMoveBound = (e) => this.handlePointerMove(e);
    this.onPointerUpBound = (e) => this.handlePointerUp(e);
    this.onPointerLeaveBound = () => {
      this.cursorInside = false;
    };
    this.onWheelBound = (e) => this.handleWheel(e);
    this.onContextMenuBound = (e) => e.preventDefault();
    this.onBlurBound = () => {
      this.keys.clear();
      this.dragMode = "none";
      this.cursorInside = false;
      this.activeTouches.clear();
    };

    window.addEventListener("keydown", this.onKeyDownBound);
    window.addEventListener("keyup", this.onKeyUpBound);
    window.addEventListener("blur", this.onBlurBound);
    domElement.addEventListener("pointerdown", this.onPointerDownBound);
    window.addEventListener("pointermove", this.onPointerMoveBound);
    window.addEventListener("pointerup", this.onPointerUpBound);
    domElement.addEventListener("pointerleave", this.onPointerLeaveBound);
    domElement.addEventListener("wheel", this.onWheelBound, { passive: false });
    domElement.addEventListener("contextmenu", this.onContextMenuBound);
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("keyup", this.onKeyUpBound);
    window.removeEventListener("blur", this.onBlurBound);
    this.domElement.removeEventListener("pointerdown", this.onPointerDownBound);
    window.removeEventListener("pointermove", this.onPointerMoveBound);
    window.removeEventListener("pointerup", this.onPointerUpBound);
    this.domElement.removeEventListener("pointerleave", this.onPointerLeaveBound);
    this.domElement.removeEventListener("wheel", this.onWheelBound);
    this.domElement.removeEventListener("contextmenu", this.onContextMenuBound);
  }

  public get activeCamera(): THREE.Camera {
    return this.useOrtho ? this.orthoCamera : this.camera;
  }

  public setOrtho(ortho: boolean): void {
    this.useOrtho = ortho;
    this.updateCameraTransform();
  }

  public setAllowUnderground(allow: boolean): void {
    this.allowUnderground = allow;
    if (!allow) {
      this.goalPitch = Math.max(0.14, this.goalPitch);
      this.goalTarget.y = Math.max(0.1, this.goalTarget.y);
    }
  }

  public setAspect(aspect: number): void {
    this.aspect = Math.max(0.1, aspect);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.domRect = this.domElement.getBoundingClientRect();
    this.updateCameraTransform();
  }

  private getRect(): DOMRect {
    if (!this.domRect || this.domRect.width <= 0) {
      this.domRect = this.domElement.getBoundingClientRect();
    }
    return this.domRect;
  }

  public setBounds(bounds: BuildCameraBounds): void {
    this.bounds = bounds;
    this.clampGoalTarget();
  }

  public setTargetElevation(y: number): void {
    this.goalTarget.y = y;
  }

  public setSnap90Enabled(enabled: boolean): void {
    this.snap90Enabled = enabled;
  }

  public setEdgeScrollEnabled(enabled: boolean): void {
    this.edgeScrollEnabled = enabled;
  }

  public rotateQuarter(dir: -1 | 1): void {
    const step = Math.PI / 2;
    this.goalYaw = this.goalYaw + dir * step;
  }

  public resetOverview(centerX = 2.5, centerY = 3.25, centerZ = 8.5): void {
    this.goalTarget.set(centerX, centerY, centerZ);
    this.goalYaw = DEFAULT_SNAPSHOT.yaw;
    this.goalPitch = DEFAULT_SNAPSHOT.pitch;
    this.goalDistance = DEFAULT_SNAPSHOT.distance;
  }

  public setPreset(preset: "3d" | "front" | "back" | "side" | "top" | "foundation"): void {
    switch (preset) {
      case "front":
        this.goalTarget.set(2.5, 3.15, 8.5);
        this.goalYaw = Math.PI;
        this.goalPitch = 0.18;
        this.goalDistance = 25.5;
        break;
      case "back":
        this.goalTarget.set(2.5, 3.15, 8.5);
        this.goalYaw = 0;
        this.goalPitch = 0.18;
        this.goalDistance = 25.5;
        break;
      case "side":
        this.goalTarget.set(2.5, 3.15, 8.5);
        this.goalYaw = Math.PI * 0.5;
        this.goalPitch = 0.22;
        this.goalDistance = 29.5;
        break;
      case "top":
        this.goalTarget.set(2.5, 1.0, 8.5);
        this.goalYaw = Math.PI;
        this.goalPitch = 1.48;
        this.goalDistance = 28;
        break;
      case "foundation":
        this.goalTarget.set(2.5, -0.45, 8.5);
        this.goalYaw = -2.42;
        this.goalPitch = this.allowUnderground ? -0.22 : 0.35;
        this.goalDistance = 23.5;
        break;
      default:
        this.goalTarget.set(...DEFAULT_SNAPSHOT.target);
        this.goalYaw = DEFAULT_SNAPSHOT.yaw;
        this.goalPitch = DEFAULT_SNAPSHOT.pitch;
        this.goalDistance = DEFAULT_SNAPSHOT.distance;
        break;
    }
  }

  public getSnapshot(): BuildCameraSnapshot {
    return {
      target: [this.goalTarget.x, this.goalTarget.y, this.goalTarget.z],
      yaw: this.goalYaw,
      pitch: this.goalPitch,
      distance: this.goalDistance,
    };
  }

  public applySnapshot(snap: BuildCameraSnapshot): void {
    this.goalTarget.set(snap.target[0], snap.target[1], snap.target[2]);
    this.currTarget.copy(this.goalTarget);
    this.goalYaw = snap.yaw;
    this.currYaw = snap.yaw;
    this.goalPitch = snap.pitch;
    this.currPitch = snap.pitch;
    this.goalDistance = snap.distance;
    this.currDistance = snap.distance;
    this.clampGoalTarget();
    this.updateCameraTransform();
  }

  public getCurrentYaw(): number {
    return this.currYaw;
  }

  public getCurrentTarget(): THREE.Vector3 {
    return this.currTarget;
  }

  private clampGoalTarget(): void {
    this.goalTarget.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.goalTarget.x));
    this.goalTarget.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.goalTarget.z));
  }

  private isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (this.snap90Enabled && !e.repeat && (k === "q" || k === "e")) {
      this.goalYaw += (k === "q" ? -1 : 1) * (Math.PI / 2);
      return;
    }
    this.keys.add(k);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.key.toLowerCase());
  }

  private handlePointerDown(e: PointerEvent): void {
    try {
      this.domElement.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore synthetic events
    }
    if (e.pointerType === "touch") {
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size === 2) {
        const pts = [...this.activeTouches.values()];
        this.lastPinchDist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
        this.lastTouchMid = { x: (pts[0]!.x + pts[1]!.x) * 0.5, y: (pts[0]!.y + pts[1]!.y) * 0.5 };
        this.lastTouchAngle = Math.atan2(pts[1]!.y - pts[0]!.y, pts[1]!.x - pts[0]!.x);
      } else {
        this.lastTouchMid = null;
      }
      return;
    }
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    if (e.button === 2) {
      this.rightDragPending = true;
      this.rightDownX = e.clientX;
      this.rightDownY = e.clientY;
    } else if (e.button === 1) {
      e.preventDefault();
      this.dragMode = "pan";
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (e.pointerType === "touch" && this.activeTouches.has(e.pointerId)) {
      const prev = this.activeTouches.get(e.pointerId)!;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activeTouches.size === 1) {
        this.panByPixels(dx, dy);
      } else if (this.activeTouches.size === 2) {
        const pts = [...this.activeTouches.values()];
        const p0 = pts[0]!;
        const p1 = pts[1]!;
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const delta = dist - this.lastPinchDist;
        this.lastPinchDist = dist;
        this.goalDistance = Math.max(3.4, Math.min(36, this.goalDistance - delta * 0.04));

        // Twist angle -> yaw orbit + vertical midpoint drag -> tilt/pan
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        let dAngle = angle - this.lastTouchAngle;
        while (dAngle > Math.PI) dAngle -= Math.PI * 2;
        while (dAngle < -Math.PI) dAngle += Math.PI * 2;
        this.lastTouchAngle = angle;
        if (Math.abs(dAngle) < 0.45) {
          this.goalYaw -= dAngle * 1.1;
        }

        const mid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
        if (this.lastTouchMid) {
          const mdx = mid.x - this.lastTouchMid.x;
          const mdy = mid.y - this.lastTouchMid.y;
          this.panByPixels(mdx, mdy * 0.55);
          const minPitch = this.allowUnderground ? -1.05 : 0.14;
          this.goalPitch = Math.max(minPitch, Math.min(1.5, this.goalPitch - mdy * 0.0028));
        }
        this.lastTouchMid = mid;
      }
      return;
    }

    const rect = this.getRect();
    if (rect.width > 0 && rect.height > 0) {
      this.cursorNdc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.cursorInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
    }

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.rightDragPending && this.dragMode === "none") {
      if (Math.hypot(e.clientX - this.rightDownX, e.clientY - this.rightDownY) > 5) {
        this.dragMode = "orbit";
        this.rightDragPending = false;
      }
    }

    if (this.dragMode === "orbit") {
      this.goalYaw -= dx * 0.0065;
      const minPitch = this.allowUnderground ? -1.05 : 0.14;
      this.goalPitch = Math.max(minPitch, Math.min(1.5, this.goalPitch + dy * 0.0055));
    } else if (this.dragMode === "pan") {
      this.panByPixels(dx, dy);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    try {
      if (this.domElement.hasPointerCapture?.(e.pointerId)) {
        this.domElement.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (e.pointerType === "touch") {
      this.activeTouches.delete(e.pointerId);
      this.lastPinchDist = 0;
      this.lastTouchMid = null;
      return;
    }
    this.rightDragPending = false;
    this.dragMode = "none";
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.getRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Cursor-directed zoom: trace cursor ray onto current floor horizontal plane
    this._plane.setFromNormalAndCoplanarPoint(this._up, this.goalTarget);
    this._wheelNdc.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._wheelNdc, this.activeCamera);
    const hitPoint = this._raycaster.ray.intersectPlane(this._plane, this._hit);

    const oldDist = this.goalDistance;
    const zoomFactor = e.deltaY > 0 ? 1.12 : 0.89;
    const newDist = Math.max(3.4, Math.min(36, oldDist * zoomFactor));
    const ratio = (oldDist - newDist) / Math.max(0.01, oldDist);

    if (hitPoint && Number.isFinite(hitPoint.x) && Number.isFinite(hitPoint.z)) {
      const pull = ratio * 0.62;
      this.goalTarget.x += (hitPoint.x - this.goalTarget.x) * pull;
      this.goalTarget.z += (hitPoint.z - this.goalTarget.z) * pull;
      this.clampGoalTarget();
    }
    this.goalDistance = newDist;
  }

  private panByPixels(dx: number, dy: number): void {
    const scale = this.currDistance * 0.00145;
    this.computeHorizontalBasis();
    this.goalTarget.addScaledVector(this._right, -dx * scale);
    this.goalTarget.addScaledVector(this._fwd, dy * scale);
    this.clampGoalTarget();
  }

  private computeHorizontalBasis(): void {
    // Camera looks from (+sin(yaw), ., +cos(yaw)) toward target, so forward-XZ is (-sin(yaw), 0, -cos(yaw))
    this._fwd.set(-Math.sin(this.currYaw), 0, -Math.cos(this.currYaw)).normalize();
    this._right.set(Math.cos(this.currYaw), 0, -Math.sin(this.currYaw)).normalize();
  }

  /**
   * Advances keyboard/edge pan + smooth camera damping using frame delta seconds.
   * Returns `true` if the camera moved or is still damping toward its goal.
   */
  public update(dt: number): boolean {
    const clampedDt = Math.min(0.05, Math.max(0.001, dt));
    const panSpeed = Math.max(4.5, this.currDistance * 0.72);
    const orbitSpeed = 1.65;

    let moveForward = 0;
    let moveRight = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) moveForward += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) moveForward -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) moveRight += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) moveRight -= 1;

    // Optional edge-scrolling when pointer rests inside edge strip
    if (this.edgeScrollEnabled && this.cursorInside && this.dragMode === "none") {
      if (this.cursorNdc.x > 0.92) moveRight += 0.85;
      else if (this.cursorNdc.x < -0.92) moveRight -= 0.85;
      if (this.cursorNdc.y > 0.92) moveForward += 0.85;
      else if (this.cursorNdc.y < -0.92) moveForward -= 0.85;
    }

    if (moveForward !== 0 || moveRight !== 0) {
      this.computeHorizontalBasis();
      const len = Math.hypot(moveForward, moveRight) || 1;
      this.goalTarget.addScaledVector(this._fwd, (moveForward / len) * panSpeed * clampedDt);
      this.goalTarget.addScaledVector(this._right, (moveRight / len) * panSpeed * clampedDt);
      this.clampGoalTarget();
    }

    if (!this.snap90Enabled) {
      if (this.keys.has("q")) this.goalYaw -= orbitSpeed * clampedDt;
      if (this.keys.has("e")) this.goalYaw += orbitSpeed * clampedDt;
    }

    const dx = this.goalTarget.x - this.currTarget.x;
    const dy = this.goalTarget.y - this.currTarget.y;
    const dz = this.goalTarget.z - this.currTarget.z;
    const dYaw = this.goalYaw - this.currYaw;
    const dPitch = this.goalPitch - this.currPitch;
    const dDist = this.goalDistance - this.currDistance;

    if (
      Math.abs(dx) < 1e-4 &&
      Math.abs(dy) < 1e-4 &&
      Math.abs(dz) < 1e-4 &&
      Math.abs(dYaw) < 1e-4 &&
      Math.abs(dPitch) < 1e-4 &&
      Math.abs(dDist) < 1e-4
    ) {
      return false;
    }

    const alpha = 1 - Math.exp(-10.5 * clampedDt);
    this.currTarget.lerp(this.goalTarget, alpha);
    this.currYaw += dYaw * alpha;
    this.currPitch += dPitch * alpha;
    this.currDistance += dDist * alpha;

    this.updateCameraTransform();
    return true;
  }

  private updateCameraTransform(): void {
    // Sims 4 close-zoom lower angle shift only when above ground in perspective
    const closeT = !this.allowUnderground && this.currPitch > 0.25 ? Math.max(0, Math.min(1, (8.5 - this.currDistance) / 5.1)) : 0;
    const effectivePitch = this.allowUnderground
      ? Math.max(-1.05, Math.min(1.5, this.currPitch))
      : Math.max(0.14, this.currPitch - closeT * 0.18);

    const horizDist = Math.cos(effectivePitch) * this.currDistance;
    const vertDist = Math.sin(effectivePitch) * this.currDistance;
    const camX = this.currTarget.x + Math.sin(this.currYaw) * horizDist;
    const camZ = this.currTarget.z + Math.cos(this.currYaw) * horizDist;
    const camY = this.allowUnderground
      ? this.currTarget.y + vertDist
      : Math.max(0.45, this.currTarget.y + vertDist);

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.currTarget);

    if (this.useOrtho) {
      const halfH = this.currDistance * 0.42;
      this.orthoCamera.left = -halfH * this.aspect;
      this.orthoCamera.right = halfH * this.aspect;
      this.orthoCamera.top = halfH;
      this.orthoCamera.bottom = -halfH;
      this.orthoCamera.position.set(camX, camY, camZ);
      this.orthoCamera.lookAt(this.currTarget);
      this.orthoCamera.updateProjectionMatrix();
    }
  }
}
