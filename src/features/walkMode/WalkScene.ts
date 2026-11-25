import * as THREE from "three";
import { WalkAvatar } from "@/features/walkMode/WalkAvatar";
import { WalkController, type WalkSnapshotState } from "@/features/walkMode/WalkController";
import { WalkDebugOverlay } from "@/features/walkMode/WalkDebugOverlay";
import { WALK_CONFIG, type WalkCameraMode } from "@/features/walkMode/walkConfig";
import { simsAudio } from "@/lib/audio/simsAudio";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { createContactShadowTexture } from "@/lib/scene/geometryHelpers";
import {
  createEnvironmentMap,
  createMaterialPalette,
  createSkyGradientTexture,
  type MaterialPalette,
} from "@/lib/scene/materials";
import { buildProjectHouse, buildStaticNeighborhood } from "@/lib/scene/projectHouseBuilder";
import type { StructuralReport } from "@/lib/structure/sniEngine";

export interface WalkHudTelemetry extends WalkSnapshotState {
  cameraMode: WalkCameraMode;
  pointerLocked: boolean;
  debugOverlayVisible: boolean;
  cameraClipped: boolean;
  fps: number;
  calls: number;
  triangles: number;
}

export interface WalkSceneActions {
  onHudUpdate: (telemetry: WalkHudTelemetry) => void;
  onToggleDoor: (levelIndex: 0 | 1, wallId: string, opId: string, nextOpenPct: number) => void;
  onExitWalkMode: () => void;
}

/**
 * Full-Fidelity PBR Realistic Walk Mode Viewport backed by `WalkController`, `WalkAvatar`,
 * `WalkDebugOverlay`, material-aware footsteps SFX, and dual 1st/3rd-person cameras.
 */
export class WalkScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly actions: WalkSceneActions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly palette: MaterialPalette;
  private readonly skyMat: THREE.MeshBasicMaterial;
  private readonly skyMesh: THREE.Mesh;
  private envTex: THREE.Texture | null = null;
  private readonly contactShadowTex: THREE.CanvasTexture;
  private readonly contactShadowMat: THREE.MeshBasicMaterial;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;

  private readonly envGroup = new THREE.Group();
  private readonly neighborsGroup = new THREE.Group();
  private readonly houseContainer = new THREE.Group();
  private readonly lightsGroup = new THREE.Group();
  private readonly pointLights: THREE.PointLight[] = [];

  private staticDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private dynResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private animatedFans: THREE.Object3D[] = [];

  public readonly ctrl: WalkController;
  private readonly avatar: WalkAvatar;
  private readonly debugOverlay: WalkDebugOverlay;

  private derived: DerivedProjectModel;
  private struct: StructuralReport;
  private buildSignature = "";
  private envKey = "";

  // Camera & Input State
  private cameraMode: WalkCameraMode = "first_person";
  private pitchRad = 0; // + look up, - look down
  private thirdPersonDist: number = WALK_CONFIG.thirdPerson.defaultDist;
  private smoothCamDist: number = WALK_CONFIG.thirdPerson.defaultDist;
  private smoothCamPos = new THREE.Vector3();
  private camInitialized = false;
  private bobPhase = 0;
  private stepAccumM = 0;
  private lastSnapshotEmitAt = 0;
  private cameraClipped = false;

  private readonly keysDown = new Set<string>();
  private virtualMove = { forward: 0, strafe: 0, sprint: false };
  private dragLookActive = false;
  private pointerDownPos = { x: 0, y: 0 };
  private lastDragPos = { x: 0, y: 0 };
  private pointerLocked = false;

  // Scratch vectors (zero per-frame heap allocations in render loop)
  private readonly lookDir = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();

  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private lastFrameMs = performance.now();
  private fpsSamples: number[] = [];
  private disposed = false;

  private readonly onResizeBound = () => this.handleResize();
  private readonly onVisibilityBound = () => this.handleVisibility();
  private readonly onKeyDownBound = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onKeyUpBound = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly onPointerDownBound = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerMoveBound = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerUpBound = () => {
    this.dragLookActive = false;
  };
  private readonly onWheelBound = (e: WheelEvent) => this.handleWheel(e);
  private readonly onPointerLockChangeBound = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  constructor(
    canvas: HTMLCanvasElement,
    derived: DerivedProjectModel,
    struct: StructuralReport,
    actions: WalkSceneActions,
  ) {
    this.canvas = canvas;
    this.derived = derived;
    this.struct = struct;
    this.actions = actions;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd2e1ec, 0.0042);

    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    this.camera = new THREE.PerspectiveCamera(WALK_CONFIG.firstPerson.fov, aspect, WALK_CONFIG.cameraNear, WALK_CONFIG.cameraFar);

    this.palette = createMaterialPalette();
    this.palette.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x6f6859, 0.78);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5e0, 2.3);
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

    const skyTex = createSkyGradientTexture(derived.project.simulation.hourOfDay, derived.project.simulation.season, derived.project.simulation.rainIntensityMmH);
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

    this.ctrl = new WalkController(derived.project);
    this.avatar = new WalkAvatar(this.contactShadowTex);
    this.debugOverlay = new WalkDebugOverlay();
    this.debugOverlay.rebuildWorld(this.ctrl.world);

    this.scene.add(
      this.envGroup,
      this.neighborsGroup,
      this.houseContainer,
      this.lightsGroup,
      this.avatar.root,
      this.debugOverlay.root,
    );

    this.handleResize();
    window.addEventListener("resize", this.onResizeBound);
    if (canvas.parentElement && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(canvas.parentElement);
    }
    document.addEventListener("visibilitychange", this.onVisibilityBound);
    document.addEventListener("pointerlockchange", this.onPointerLockChangeBound);
    window.addEventListener("keydown", this.onKeyDownBound);
    window.addEventListener("keyup", this.onKeyUpBound);
    canvas.addEventListener("pointerdown", this.onPointerDownBound);
    window.addEventListener("pointermove", this.onPointerMoveBound);
    window.addEventListener("pointerup", this.onPointerUpBound);
    canvas.addEventListener("wheel", this.onWheelBound, { passive: false });

    this.updateProjectData(derived, struct);
    this.startLoop();
  }

  public updateProjectData(derived: DerivedProjectModel, struct: StructuralReport): void {
    this.derived = derived;
    this.struct = struct;
    const { project } = derived;
    const sim = project.simulation;

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

      const sunElev = Math.max(0.15, Math.sin(((sim.hourOfDay - 5.5) / 13) * Math.PI));
      const sunAz = ((sim.hourOfDay - 12) / 6) * 0.9;
      this.sunLight.position.set(2.5 + Math.sin(sunAz) * 24, Math.max(3, sunElev * 24), 8.5 - Math.cos(sunAz) * 14);
      this.sunLight.intensity = isNight ? 0.25 : 2.3;
      this.sunLight.color.set(isNight ? 0x6c88b8 : sim.hourOfDay < 7.5 || sim.hourOfDay > 16.5 ? 0xffcb8c : 0xfff5e0);
      this.hemiLight.intensity = isNight ? 0.34 : 0.78;
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
    });

    if (sig !== this.buildSignature) {
      this.buildSignature = sig;
      this.ctrl.rebuildColliders(project);
      this.debugOverlay.rebuildWorld(this.ctrl.world);
      this.rebuildHouseAndLights(derived, struct);
    }
  }

  private rebuildHouseAndLights(derived: DerivedProjectModel, struct: StructuralReport): void {
    for (const r of this.dynResources) r.dispose();
    this.dynResources = [];
    this.houseContainer.clear();
    this.lightsGroup.clear();
    this.pointLights.length = 0;

    const built = buildProjectHouse(derived, struct, this.palette, this.contactShadowMat, {
      stage: 0,
      showBricks: false,
      showStructure: true,
      showRoof: true,
      showRangka: false,
      showFinishing: true,
      xrayRebar: false,
      showAir: false,
      showListrik: false,
      hiddenParts: new Set<string>(),
      activeLevelView: "all",
      supportWallCutaway: false,
      hideUpperPropsInLt1: false,
      walkOpenDoorsFull: true,
    });
    this.houseContainer.add(built.houseRoot);
    this.dynResources = built.resources;
    this.animatedFans = built.animatedFans;

    // Active warm interior lighting isolated per floor (downward SpotLights prevent LT1<->LT2 light bleed)
    const lt1Y = derived.project.site.peil.floor1PeilM;
    const lt2Y = lt1Y + derived.project.levels[0]!.height;
    const simNightBoost = derived.project.simulation.hourOfDay < 6.5 || derived.project.simulation.hourOfDay > 17.2 ? 2.1 : 0.95;
    for (const lvIdx of [0, 1] as const) {
      const lv = derived.project.levels[lvIdx];
      if (!lv) continue;
      const baseY = lvIdx === 0 ? lt1Y : lt2Y;
      const activeLights = lv.lights.filter((l) => l.on && l.dimmer > 0).slice(-7);
      for (const l of activeLights) {
        const lightHex = l.colorTempK <= 3200 ? 0xffcb85 : 0xffe7bd;
        const rotY = l.rotationY ?? 0;
        const fwdOff = l.type === "wall" ? 1.15 : 0;
        const halfAngle = Math.min(Math.PI * 0.42, Math.max(0.35, ((l.beamAngleDeg * 0.5) * Math.PI) / 180));
        const spot = new THREE.SpotLight(
          lightHex,
          (l.lumens / 450) * l.dimmer * 2.2 * simNightBoost,
          Math.min(3.85, lv.height + 0.15),
          halfAngle,
          0.78,
          1.4,
        );
        spot.position.set(l.position.x, baseY + Math.min(lv.height - 0.25, l.position.y) - 0.05, l.position.z);
        spot.target.position.set(l.position.x + Math.sin(rotY) * fwdOff, baseY, l.position.z + Math.cos(rotY) * fwdOff);
        this.lightsGroup.add(spot, spot.target);
        this.pointLights.push(spot as unknown as THREE.PointLight);
      }
    }
  }

  public toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === "first_person" ? "third_person" : "first_person";
    if (this.cameraMode === "third_person") {
      this.pitchRad = THREE.MathUtils.degToRad(-WALK_CONFIG.thirdPerson.pitchDefaultDeg);
      this.camera.fov = WALK_CONFIG.thirdPerson.fov;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock?.();
      }
    } else {
      this.pitchRad = THREE.MathUtils.clamp(
        this.pitchRad,
        THREE.MathUtils.degToRad(WALK_CONFIG.firstPerson.pitchMinDeg),
        THREE.MathUtils.degToRad(WALK_CONFIG.firstPerson.pitchMaxDeg),
      );
      this.camera.fov = WALK_CONFIG.firstPerson.fov;
    }
    this.camera.updateProjectionMatrix();
    this.camInitialized = false;
    simsAudio.play("select");
    this.emitTelemetry(true);
  }

  public setCameraMode(mode: WalkCameraMode): void {
    if (this.cameraMode !== mode) this.toggleCameraMode();
  }

  public toggleDebugOverlay(): void {
    this.debugOverlay.setVisible(!this.debugOverlay.isVisible());
    this.emitTelemetry(true);
  }

  public teleportToSafeSpawn(): void {
    this.ctrl.teleportToSafeSpawn();
    this.pitchRad = this.cameraMode === "third_person" ? THREE.MathUtils.degToRad(-WALK_CONFIG.thirdPerson.pitchDefaultDeg) : 0;
    this.camInitialized = false;
    this.emitTelemetry(true);
  }

  public triggerInteractNearestDoor(): boolean {
    const door = this.ctrl.nearestDoor;
    if (!door) return false;
    const isOpen = door.openPct > WALK_CONFIG.doorOpenPassPct;
    const nextPct = isOpen ? 0 : 75;
    simsAudio.playDoorToggle(!isOpen);
    this.actions.onToggleDoor(door.levelIndex, door.wallId, door.opId, nextPct);
    return true;
  }

  public setVirtualInput(forward: number, strafe: number, sprint: boolean): void {
    this.virtualMove = { forward, strafe, sprint };
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    if (e.code === "KeyV") {
      e.preventDefault();
      this.toggleCameraMode();
      return;
    }
    if (e.code === "F3") {
      e.preventDefault();
      this.toggleDebugOverlay();
      return;
    }
    if (e.code === "KeyE") {
      e.preventDefault();
      this.triggerInteractNearestDoor();
      return;
    }
    if (e.code === "KeyR") {
      e.preventDefault();
      this.teleportToSafeSpawn();
      return;
    }
    if (e.code === "Escape") {
      if (document.pointerLockElement === this.canvas) {
        e.stopImmediatePropagation();
        document.exitPointerLock?.();
      } else {
        this.actions.onExitWalkMode();
      }
      return;
    }
    this.keysDown.add(e.code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    this.dragLookActive = true;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.lastDragPos = { x: e.clientX, y: e.clientY };

    // Request Pointer Lock smoothly on primary canvas click in 1st-person mode (with drag fallback if declined)
    if (e.button === 0 && this.cameraMode === "first_person" && document.pointerLockElement !== this.canvas) {
      try {
        const res = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
        res?.catch?.(() => {});
      } catch {
        // Fallback drag look already armed cleanly
      }
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    let dx = 0;
    let dy = 0;

    if (this.pointerLocked) {
      dx = e.movementX || 0;
      dy = e.movementY || 0;
    } else if (this.dragLookActive) {
      dx = e.clientX - this.lastDragPos.x;
      dy = e.clientY - this.lastDragPos.y;
      this.lastDragPos = { x: e.clientX, y: e.clientY };
    } else {
      return;
    }

    const sens =
      this.cameraMode === "first_person"
        ? WALK_CONFIG.firstPerson.lookSensitivityRadPerPx
        : WALK_CONFIG.thirdPerson.lookSensitivityRadPerPx;

    this.ctrl.yaw -= dx * sens;
    this.pitchRad -= dy * sens;

    const minP = THREE.MathUtils.degToRad(
      this.cameraMode === "first_person" ? WALK_CONFIG.firstPerson.pitchMinDeg : WALK_CONFIG.thirdPerson.pitchMinDeg,
    );
    const maxP = THREE.MathUtils.degToRad(
      this.cameraMode === "first_person" ? WALK_CONFIG.firstPerson.pitchMaxDeg : WALK_CONFIG.thirdPerson.pitchMaxDeg,
    );
    this.pitchRad = THREE.MathUtils.clamp(this.pitchRad, minP, maxP);
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.cameraMode === "third_person") {
      this.thirdPersonDist = THREE.MathUtils.clamp(
        this.thirdPersonDist + e.deltaY * 0.0022,
        WALK_CONFIG.thirdPerson.minDist,
        WALK_CONFIG.thirdPerson.maxDist,
      );
    }
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent ? parent.clientWidth : this.canvas.clientWidth);
    const h = Math.max(1, parent ? parent.clientHeight : this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private handleVisibility(): void {
    if (document.hidden) {
      this.keysDown.clear();
      this.dragLookActive = false;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    } else {
      this.lastFrameMs = performance.now();
      this.startLoop();
    }
  }

  private readMoveInput(): { forward: number; strafe: number; sprint: boolean } {
    let forward = this.virtualMove.forward;
    let strafe = this.virtualMove.strafe;
    if (this.keysDown.has("KeyW") || this.keysDown.has("ArrowUp")) forward += 1;
    if (this.keysDown.has("KeyS") || this.keysDown.has("ArrowDown")) forward -= 1;
    if (this.keysDown.has("KeyD") || this.keysDown.has("ArrowRight")) strafe += 1;
    if (this.keysDown.has("KeyA") || this.keysDown.has("ArrowLeft")) strafe -= 1;
    // Note: Q/E still work cleanly: E interacts door, Q rotates left slowly if keyboard turning desired
    if (this.keysDown.has("KeyQ")) this.ctrl.yaw += 0.03;

    const sprint =
      this.virtualMove.sprint || this.keysDown.has("ShiftLeft") || this.keysDown.has("ShiftRight");

    return {
      forward: THREE.MathUtils.clamp(forward, -1, 1),
      strafe: THREE.MathUtils.clamp(strafe, -1, 1),
      sprint,
    };
  }

  private startLoop(): void {
    if (this.rafId !== null || this.disposed) return;
    const tick = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;

      // Spin ceiling/stand fans gently
      for (const fan of this.animatedFans) {
        fan.rotation.y += dt * 4.5;
      }

      // Advance kinematic capsule controller
      const move = this.readMoveInput();
      const prevDist = this.ctrl.distanceTraveledM;
      const snap = this.ctrl.step(dt, {
        forward: move.forward,
        strafe: move.strafe,
        sprint: move.sprint,
        yaw: this.ctrl.yaw,
      });

      // Footsteps SFX cadence
      const stepDelta = snap.distanceTraveledM - prevDist;
      if (stepDelta > 0 && snap.grounded) {
        this.stepAccumM += stepDelta;
        const interval = move.sprint ? WALK_CONFIG.footstepIntervalRunM : WALK_CONFIG.footstepIntervalWalkM;
        if (this.stepAccumM >= interval) {
          this.stepAccumM -= interval;
          simsAudio.playFootstep(snap.surface, move.sprint);
        }
      } else if (snap.speed < 0.1) {
        this.stepAccumM = WALK_CONFIG.footstepIntervalWalkM * 0.45; // prompt immediate first step when starting again
      }

      // Update resident avatar (visible in 3rd-person, hidden seamlessly in 1st-person)
      this.avatar.update(
        dt,
        snap.x,
        snap.y,
        snap.z,
        snap.vx,
        snap.vz,
        snap.yaw,
        Boolean(snap.onStairId),
        this.cameraMode === "third_person",
      );

      // Update debug wireframe overlay
      this.debugOverlay.update(this.ctrl);

      // Update camera (1st-person or 3rd-person spring-arm collision)
      this.updateCamera(dt, snap, move.sprint);

      this.renderer.render(this.scene, this.camera);

      // FPS & Stats Telemetry
      const fpsInst = 1 / Math.max(0.001, dt);
      this.fpsSamples.push(fpsInst);
      if (this.fpsSamples.length > 24) this.fpsSamples.shift();
      this.emitTelemetry(false);

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private updateCamera(dt: number, snap: WalkSnapshotState, sprint: boolean): void {
    const cosP = Math.cos(this.pitchRad);
    const sinP = Math.sin(this.pitchRad);
    const sinY = Math.sin(snap.yaw);
    const cosY = Math.cos(snap.yaw);

    this.lookDir.set(sinY * cosP, sinP, cosY * cosP);
    this.camRight.set(-cosY, 0, sinY);

    if (this.cameraMode === "first_person") {
      let bobY = 0;
      let bobX = 0;
      if (snap.speed > 0.25 && snap.grounded) {
        this.bobPhase += dt * (sprint ? 2.9 : 2.1) * WALK_CONFIG.firstPerson.headBobFreqHz;
        bobY = Math.sin(this.bobPhase * 2) * WALK_CONFIG.firstPerson.headBobAmpY * Math.min(1, snap.speed / WALK_CONFIG.walkSpeed);
        bobX = Math.cos(this.bobPhase) * WALK_CONFIG.firstPerson.headBobAmpX * Math.min(1, snap.speed / WALK_CONFIG.walkSpeed);
      }
      const eyeX = snap.x + this.camRight.x * bobX;
      const eyeY = snap.y + WALK_CONFIG.eyeHeight + bobY;
      const eyeZ = snap.z + this.camRight.z * bobX;

      if (!this.camInitialized) {
        this.smoothCamPos.set(eyeX, eyeY, eyeZ);
        this.camInitialized = true;
      } else {
        const ySmooth = 1 - Math.exp(-dt * 22);
        this.smoothCamPos.set(eyeX, THREE.MathUtils.lerp(this.smoothCamPos.y, eyeY, ySmooth), eyeZ);
      }

      this.camera.position.copy(this.smoothCamPos);
      this.lookTarget.copy(this.camera.position).add(this.lookDir);
      this.camera.lookAt(this.lookTarget);
      this.cameraClipped = false;
    } else {
      // Third-person spring-arm raycast against data colliders
      const pivotX = snap.x;
      const pivotY = snap.y + WALK_CONFIG.thirdPerson.targetHeight;
      const pivotZ = snap.z;

      const rawCamX = pivotX - this.lookDir.x * this.thirdPersonDist;
      const rawCamY = pivotY - this.lookDir.y * this.thirdPersonDist;
      const rawCamZ = pivotZ - this.lookDir.z * this.thirdPersonDist;

      const safe = this.ctrl.raycastCameraSpringArm(pivotX, pivotY, pivotZ, rawCamX, rawCamY, rawCamZ);
      this.cameraClipped = safe.clipped;

      const hitDist = Math.hypot(safe.x - pivotX, safe.y - pivotY, safe.z - pivotZ);
      const speedSmooth = hitDist < this.smoothCamDist ? 26 : WALK_CONFIG.thirdPerson.armSmoothSpeed;
      if (!this.camInitialized) {
        this.smoothCamDist = hitDist;
        this.smoothCamPos.set(safe.x, safe.y, safe.z);
        this.camInitialized = true;
      } else {
        this.smoothCamDist = THREE.MathUtils.lerp(this.smoothCamDist, hitDist, 1 - Math.exp(-dt * speedSmooth));
        const ratio = hitDist > 1e-4 ? Math.min(1, this.smoothCamDist / hitDist) : 1;
        const targetPosX = pivotX + (safe.x - pivotX) * ratio;
        const targetPosY = pivotY + (safe.y - pivotY) * ratio;
        const targetPosZ = pivotZ + (safe.z - pivotZ) * ratio;
        const posBlend = 1 - Math.exp(-dt * 18);
        this.smoothCamPos.lerp(this.lookTarget.set(targetPosX, targetPosY, targetPosZ), posBlend);
      }

      this.camera.position.copy(this.smoothCamPos);
      this.lookTarget.set(pivotX, pivotY + 0.08, pivotZ);
      this.camera.lookAt(this.lookTarget);
    }
  }

  private emitTelemetry(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastSnapshotEmitAt < 90) return;
    this.lastSnapshotEmitAt = now;

    const avgFps =
      this.fpsSamples.length > 0
        ? Math.round(this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length)
        : 60;
    const snap = this.ctrl.getSnapshot();
    const telemetry: WalkHudTelemetry = {
      ...snap,
      cameraMode: this.cameraMode,
      pointerLocked: this.pointerLocked,
      debugOverlayVisible: this.debugOverlay.isVisible(),
      cameraClipped: this.cameraClipped,
      fps: avgFps,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };

    if (typeof window !== "undefined") {
      (window as unknown as { __RUMAH_WALK_STATS__?: WalkHudTelemetry }).__RUMAH_WALK_STATS__ = telemetry;
    }
    this.actions.onHudUpdate(telemetry);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
    window.removeEventListener("resize", this.onResizeBound);
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityBound);
    document.removeEventListener("pointerlockchange", this.onPointerLockChangeBound);
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("keyup", this.onKeyUpBound);
    this.canvas.removeEventListener("pointerdown", this.onPointerDownBound);
    window.removeEventListener("pointermove", this.onPointerMoveBound);
    window.removeEventListener("pointerup", this.onPointerUpBound);
    this.canvas.removeEventListener("wheel", this.onWheelBound);

    this.avatar.dispose();
    this.debugOverlay.dispose();
    for (const r of this.dynResources) r.dispose();
    for (const r of this.staticDisposables) r.dispose();
    this.envTex?.dispose();
    this.palette.dispose();
    this.renderer.dispose();
  }
}
