import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { DEFAULT_BLOOM_STRENGTH, DualKawaseBloomPass, FinalOutputPass } from "@/features/buildMode/DualKawaseBloomPass";
import { AtmospherePass } from "@/features/buildMode/AtmospherePass";
import type { BuildQualityTier } from "@/features/buildMode/BuildScene";
import { WalkAvatar } from "@/features/walkMode/WalkAvatar";
import { WalkController, type WalkSnapshotState } from "@/features/walkMode/WalkController";
import { WalkDebugOverlay } from "@/features/walkMode/WalkDebugOverlay";
import { WALK_CONFIG, type WalkCameraMode } from "@/features/walkMode/walkConfig";
import { simsAudio } from "@/lib/audio/simsAudio";
import { AdaptiveRenderGovernor } from "@/lib/scene/adaptiveQuality";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { createContactShadowTexture, disposeResource } from "@/lib/scene/geometryHelpers";
import {
  createEnvironmentMap,
  createMaterialPalette,
  createSkyGradientTexture,
  makeSunSpriteTexture,
  type MaterialPalette,
} from "@/lib/scene/materials";
import { buildProjectHouse, buildStaticNeighborhood } from "@/lib/scene/projectHouseBuilder";
import { computeSolarPosition } from "@/lib/simulation/lightingEngine";
import type { Project } from "@/lib/model/types";
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
  private pmremCache = new Map<"day" | "night" | "storm", THREE.Texture>();
  private skyKey = "";
  private readonly contactShadowTex: THREE.CanvasTexture;
  private readonly contactShadowMat: THREE.MeshBasicMaterial;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;

  /** Cinematic ray-traced-look post stack, mirroring BuildScene (`Baked AO + sun shafts + bloom + MSAA HDR`). */
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private atmospherePass: AtmospherePass | null = null;
  private bloomPass: DualKawaseBloomPass | null = null;
  private outputPass: FinalOutputPass | null = null;
  private postActive = false;
  private rayTracingEnabled = true;
  private qualityOverride: BuildQualityTier = "auto";
  private activeTier: "high" | "medium" | "low" = "high";
  private readonly softwareGpu: boolean;
  private readonly mobileViewport: boolean;
  private godRayStrength = 0;
  private simElapsedS = 0;
  private sunCore: THREE.Sprite | null = null;
  private sunHalo: THREE.Sprite | null = null;
  private readonly sunDir = new THREE.Vector3(0.45, 0.78, -0.42);
  private readonly _v1 = new THREE.Vector3();

  private readonly envGroup = new THREE.Group();
  private readonly neighborsGroup = new THREE.Group();
  private readonly houseContainer = new THREE.Group();
  private readonly lightsGroup = new THREE.Group();
  private readonly spotLightPool: THREE.SpotLight[] = [];
  private lastLightLevel = -1;
  private lastLightX = Number.NaN;
  private lastLightZ = Number.NaN;
  private lastSimNight = false;
  private baseDpr = 1;
  private currentDpr = 1;
  private lastDprCheckMs = 0;
  /**
   * Hysteresis governor for the adaptive DPR. The naive 36/54fps thresholds
   * oscillated (dpr 1 ↔ baseDpr) on GPUs sitting between them with the cinematic
   * stack on, and every switch reset `canvas.width` → black flicker.
   */
  private readonly dprGovernor = new AdaptiveRenderGovernor({
    lowFps: 36,
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
  private contextLost = false;
  private lastEmittedState = "";
  private readonly reducedMotion =
    typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

  private staticDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private dynResources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private animatedFans: THREE.Object3D[] = [];

  public readonly ctrl: WalkController;
  private readonly avatar: WalkAvatar;
  private readonly debugOverlay: WalkDebugOverlay;

  private derived: DerivedProjectModel;
  private struct: StructuralReport;
  private prevBuildRefs: {
    systems: unknown;
    peil: unknown;
    buildExtras: unknown;
    levels: { walls: unknown; rooms: unknown; slabs: unknown; stairs: unknown; furniture: unknown; lights: unknown; hvac: unknown }[];
  } | null = null;
  private envKey = "";
  private needsRender = true;
  private lastWalkActive = true;
  private sessionDoorOverrides = new Map<string, number>();

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
  private activeLookPointerId: number | null = null;
  private walkTouches = new Map<number, { x: number; y: number }>();
  private lastWalkPinchDist = 0;
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
  private readonly fpsRing = new Float32Array(24);
  private fpsRingIdx = 0;
  private fpsRingCount = 0;
  private fpsRingSum = 0;
  private disposed = false;

  // OPT-01: canvas.toDataURL bridge for snapshot/export paths (preserveDrawingBuffer: false)
  private rawToDataURL: HTMLCanvasElement["toDataURL"] | null = null;
  // OPT-09 / OPT-18: frustum-gated fan animation + compositor blur gating
  private readonly _frustum = new THREE.Frustum();
  private readonly _pm = new THREE.Matrix4();
  private body3dActive = false;
  private last3dActiveAt = 0;

  private readonly onResizeBound = () => this.handleResize();
  private readonly onVisibilityBound = () => this.handleVisibility();
  private readonly onKeyDownBound = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onKeyUpBound = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly onPointerDownBound = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerMoveBound = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerUpBound = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      this.walkTouches.delete(e.pointerId);
      if (e.pointerId === this.activeLookPointerId) {
        this.dragLookActive = false;
        this.activeLookPointerId = null;
      }
      if (this.walkTouches.size < 2) {
        this.lastWalkPinchDist = 0;
      }
    } else if (this.activeLookPointerId === null || e.pointerId === this.activeLookPointerId) {
      this.dragLookActive = false;
      this.activeLookPointerId = null;
    }
    try {
      if (this.canvas.hasPointerCapture?.(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };
  private readonly onContextLostBound = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestoredBound = () => {
    this.contextLost = false;
    this.lastFrameMs = performance.now();
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

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false });
    const mobileViewport = typeof window !== "undefined" && window.innerWidth < 768;
    this.mobileViewport = mobileViewport;
    // Software rasterizers (SwiftShader / llvmpipe) must never receive the cinematic stack
    // (MSAA resolve on HalfFloat targets wedges them into ghost-white frames).
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
    this.activeTier = softwareGpu ? "low" : mobileViewport ? "medium" : "high";
    const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.baseDpr = softwareGpu ? Math.min(1, rawDpr) : mobileViewport ? Math.min(1.5, rawDpr) : Math.min(2, Math.max(1.5, rawDpr));
    this.currentDpr = this.baseDpr;
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd2e1ec, 0.0042);

    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    this.camera = new THREE.PerspectiveCamera(WALK_CONFIG.firstPerson.fov, aspect, WALK_CONFIG.cameraNear, WALK_CONFIG.cameraFar);

    // OPT-01 (2026-11): `preserveDrawingBuffer: false` restores the zero-copy swapchain
    // page-flip; snapshot/export paths read the canvas through `captureDataUrl()`, which
    // renders one synchronous frame immediately before the read.
    this.rawToDataURL = this.canvas.toDataURL.bind(this.canvas);
    this.canvas.toDataURL = ((type?: string, quality?: number) => {
      if (this.disposed || this.contextLost) return this.rawToDataURL!(type, quality);
      return this.captureDataUrl(type ?? "image/jpeg", quality ?? 0.92);
    }) as HTMLCanvasElement["toDataURL"];

    this.palette = createMaterialPalette(mobileViewport ? 1 : 2);
    this.palette.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x6f6859, 0.78);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5e0, 2.75);
    this.sunLight.position.set(14, 22, -10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(mobileViewport ? 1024 : 2048, mobileViewport ? 1024 : 2048);
    this.sunLight.shadow.camera.near = 1.5;
    this.sunLight.shadow.camera.far = 56;
    this.sunLight.shadow.camera.left = -10.5;
    this.sunLight.shadow.camera.right = 10.5;
    this.sunLight.shadow.camera.top = 14.5;
    this.sunLight.shadow.camera.bottom = -14.5;
    this.sunLight.shadow.bias = -0.00025;
    this.sunLight.shadow.normalBias = 0.0085;
    this.sunLight.target.position.set(2.5, 2.4, 8.5);
    this.scene.add(this.sunLight, this.sunLight.target);

    // Cool sky shadow-side fill light keeps unlit brickwork crisp without flat ambient
    // (same `3d-wood-lighting-scorecard` rig as the Build viewport).
    this.fillLight = new THREE.DirectionalLight(0xb2cff0, 0.4);
    this.fillLight.position.set(-14, 12, 20);
    this.scene.add(this.fillLight);

    this.skyMat = new THREE.MeshBasicMaterial({ color: 0x87b8de, side: THREE.BackSide, depthWrite: false, fog: false });
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
    window.addEventListener("pointercancel", this.onPointerUpBound);
    canvas.addEventListener("wheel", this.onWheelBound, { passive: false });
    canvas.addEventListener("webglcontextlost", this.onContextLostBound);
    canvas.addEventListener("webglcontextrestored", this.onContextRestoredBound);

    // Pre-allocate 4 reusable floor-local SpotLights (avoids 14-28 shader light loops & per-rebuild allocations)
    for (let i = 0; i < 4; i++) {
      const spot = new THREE.SpotLight(0xffe7bd, 0, 4.4, Math.PI * 0.34, 0.82, 0.45);
      this.lightsGroup.add(spot, spot.target);
      this.spotLightPool.push(spot);
    }

    this.updateProjectData(derived, struct);
    this.setupPostPipeline();
    this.configurePostPipeline();
    this.startLoop();
  }

  public requestRender(): void {
    this.needsRender = true;
  }

  /** OPT-01: render one synchronous frame, then read the canvas in the same microtask. */
  public captureDataUrl(mime = "image/jpeg", quality = 0.92): string {
    if (this.disposed || this.contextLost) return this.rawToDataURL?.(mime, quality) ?? "";
    if (this.postActive && this.composer) {
      this.updateAtmosphere(this.camera);
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    return this.rawToDataURL!(mime, quality);
  }

  /** OPT-09: a fan only keeps the loop alive while it is on-screen and effectively visible. */
  private anyFanVisibleInFrustum(): boolean {
    if (this.animatedFans.length === 0 || this.reducedMotion) return false;
    this.camera.updateMatrixWorld();
    this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
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

  private markShadowDirty(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  /** Toggle the cinematic ray-traced-look stack (same setting as the Build viewport). */
  public setRayTracingLook(enabled: boolean): void {
    this.rayTracingEnabled = enabled;
    this.configurePostPipeline();
    this.requestRender();
  }

  /** Apply the shared render-quality tier (Auto / Tinggi / Sedang / Hemat). */
  public setQualityOverride(tier: BuildQualityTier): void {
    this.qualityOverride = tier;
    // Explicit user pick resets the adaptive memory so auto logic cannot fight it.
    this.dprGovernor.reset();
    const effective: "high" | "medium" | "low" =
      tier === "auto"
        ? this.softwareGpu
          ? "low"
          : this.mobileViewport
            ? "medium"
            : "high"
        : tier;
    this.applyQualityTier(effective);
    this.requestRender();
  }

  /**
   * Cinematic "ray-traced like" real-time pipeline, mirrored from BuildScene:
   * linear HDR MSAA buffer → Baked AO → screen-space sun shafts → progressive
   * Dual-Kawase HDR bloom (OPT-04) → fused bloom composite + vignette + dither +
   * single ACES tone-map + sRGB in `FinalOutputPass` (OPT-03 fusion).
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
      // MSAA resolve on HalfFloat targets wedges software rasterizers into ghost-white frames.
      samples: this.softwareGpu ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.atmospherePass = new AtmospherePass();
    this.bloomPass = new DualKawaseBloomPass(new THREE.Vector2(w, h));
    this.outputPass = new FinalOutputPass();
    this.outputPass.finalUniforms.tBloom.value = this.bloomPass.bloomTexture;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.atmospherePass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    // Custom-target composers start with _width/_height in *pixels*; setSize must run
    // before setPixelRatio or the targets transiently resize to w·dpr² (~4x the VRAM).
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.currentDpr);
    this.lastAppliedSize = { w, h, dpr: this.currentDpr };
    this.atmospherePass.atmosphereUniforms.uAspect.value = w / h;
    this.outputPass.finalUniforms.uAspect.value = w / h;
  }

  /** Enable / disable passes per quality tier; low tier falls back to the direct render. */
  private configurePostPipeline(): void {
    if (!this.composer || !this.rayTracingEnabled || this.activeTier === "low") {
      this.postActive = false;
      return;
    }
    this.postActive = true;
    if (this.atmospherePass) {
      this.atmospherePass.atmosphereUniforms.uSamples.value = this.activeTier === "high" ? 40 : 22;
    }
  }

  private applyQualityTier(tier: "high" | "medium" | "low"): void {
    this.activeTier = tier;
    const rawDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // Software rasterizers never supersample — large HalfFloat buffers wedge them into empty frames.
    const targetDpr =
      tier === "high"
        ? this.softwareGpu
          ? 1
          : Math.min(2, Math.max(1.5, rawDpr))
        : tier === "medium"
          ? Math.min(rawDpr, 1.35)
          : 1;
    if (Math.abs(targetDpr - this.baseDpr) > 0.04) {
      this.baseDpr = targetDpr;
      this.currentDpr = Math.min(this.currentDpr, this.baseDpr);
      // handleResize applies pixelRatio + size exactly once (guarded) and repaints
      // immediately, so a tier switch never flashes a reset (black) canvas.
      this.handleResize();
    }
    const wantShadow = tier === "high" ? (this.mobileViewport ? 1024 : 2048) : tier === "medium" ? 1024 : 512;
    this.renderer.shadowMap.enabled = tier !== "low";
    if (this.sunLight.shadow.mapSize.x !== wantShadow) {
      this.sunLight.shadow.mapSize.set(wantShadow, wantShadow);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
      this.sunLight.shadow.bias = wantShadow >= 2048 ? -0.00025 : wantShadow >= 1024 ? -0.0003 : -0.00035;
      this.sunLight.shadow.normalBias = wantShadow >= 2048 ? 0.0085 : wantShadow >= 1024 ? 0.01 : 0.012;
      this.markShadowDirty();
    }
    this.configurePostPipeline();
    this.requestRender();
  }

  /** Project the sun into screen space and drive the god-ray uniforms every frame,
   * then gate the pass chain (OPT-03 atmosphere kill-switch + OPT-04 bloom bypass). */
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
      const d = Math.hypot((ux - 0.5) * aspect, uy - 0.5);
      ap.atmosphereUniforms.uSunFade.value = THREE.MathUtils.clamp(1 - (d - 0.85) / 0.95, 0, 1);
      ap.atmosphereUniforms.uIntensity.value = this.godRayStrength;
      ap.atmosphereUniforms.uSunColor.value.copy(this.sunLight.color);
      ap.atmosphereUniforms.uTime.value = this.simElapsedS;
    }

    // OPT-03: no shafts → no full-resolution HalfFloat read/write at all.
    ap.enabled = ap.atmosphereUniforms.uSunFade.value > 0.001;

    // OPT-04 early bypass: sun down + every pooled interior light off → no pixel can
    // pass the 1.75 bloom threshold → the whole 7-pass bloom pyramid is skipped.
    if (this.bloomPass) {
      let anyLightOn = false;
      for (const spot of this.spotLightPool) {
        if (spot.intensity > 0) {
          anyLightOn = true;
          break;
        }
      }
      this.bloomPass.enabled = Boolean(this.sunCore?.visible) || anyLightOn;
    }
    if (this.outputPass) {
      this.outputPass.finalUniforms.uTime.value = this.simElapsedS;
      this.outputPass.finalUniforms.uBloomStrength.value = this.bloomPass?.enabled ? DEFAULT_BLOOM_STRENGTH : 0;
    }
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

    const nextEnvKey = `${sim.hourOfDay.toFixed(2)}|${sim.season}|${Math.round(sim.rainIntensityMmH / 5)}|${project.site.orientationDeg}`;
    if (nextEnvKey !== this.envKey) {
      this.envKey = nextEnvKey;
      const nextSkyKey = `${Math.round(sim.hourOfDay * 4)}|${sim.season}|${Math.round(sim.rainIntensityMmH / 5)}`;
      if (nextSkyKey !== this.skyKey) {
        this.skyKey = nextSkyKey;
        const newSky = createSkyGradientTexture(sim.hourOfDay, sim.season, sim.rainIntensityMmH);
        this.skyMat.map?.dispose();
        this.skyMat.map = newSky;
        this.skyMat.color.setHex(0xffffff);
        this.skyMat.needsUpdate = true;
      }

      const solar = computeSolarPosition(sim.hourOfDay, project.site.latitude, sim.season, project.site.orientationDeg);
      const isNight = !solar.isDaylight;
      const isStorm = sim.rainIntensityMmH > 20;
      const pmremKey: "day" | "night" | "storm" = isNight ? "night" : isStorm ? "storm" : "day";
      let env = this.pmremCache.get(pmremKey);
      if (!env) {
        env = createEnvironmentMap(this.renderer, sim.hourOfDay, sim.rainIntensityMmH);
        this.pmremCache.set(pmremKey, env);
      }
      if (this.scene.environment !== env) {
        this.scene.environment = env;
        this.palette.bindEnvMap(env);
      }
      this.scene.environmentIntensity = isNight ? 0.35 : isStorm ? 0.82 : 0.62;

      const [sx, sy, sz] = solar.sunDir;
      this.sunLight.position.set(2.5 + sx * 24, Math.max(3, sy * 24), 8.5 + sz * 24);
      this.fillLight.position.set(2.5 - sx * 18, 12, 8.5 - sz * 18);
      this.fillLight.intensity = isNight ? 0.14 : isStorm ? 0.35 : 0.4;
      this.sunLight.intensity = isNight ? 0.18 : isStorm ? 0.95 : 2.4;
      this.sunLight.color.set(isNight ? 0x6c88b8 : sim.hourOfDay < 7.5 || sim.hourOfDay > 16.5 ? 0xffcb8c : 0xfff5e0);
      this.hemiLight.intensity = isNight ? 0.26 : isStorm ? 0.7 : 0.5;

      this.sunDir.set(sx, Math.max(0.05, sy), sz).normalize();
      const isGolden =
        !isNight && ((sim.hourOfDay >= 5.2 && sim.hourOfDay <= 7.5) || (sim.hourOfDay >= 16.5 && sim.hourOfDay <= 18.8));
      const sunUp = solar.isDaylight && sy > 0.03;
      if (this.sunCore) {
        this.sunCore.visible = sunUp;
        this.sunCore.material.color.setRGB(isGolden ? 6.0 : 5.6, isGolden ? 3.6 : 5.0, isGolden ? 2.0 : 4.3);
      }
      if (this.sunHalo) {
        this.sunHalo.visible = sunUp && !isStorm;
        this.sunHalo.material.color.setRGB(isGolden ? 1.2 : 0.9, isGolden ? 0.75 : 0.86, isGolden ? 0.46 : 0.78);
      }

      this.godRayStrength = isNight ? 0 : isStorm ? 0.12 : isGolden ? 0.95 : 0.5;
      this.godRayStrength *= THREE.MathUtils.lerp(1.3, 0.75, THREE.MathUtils.clamp(this.sunDir.y, 0, 1));

      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.set(isNight ? 0x0e1628 : isStorm ? 0x647280 : 0xd9e8f4);
        this.scene.fog.density = isStorm ? 0.011 : isNight ? 0.0052 : 0.0046;
      }
      this.markShadowDirty();
    }

    const pb = this.prevBuildRefs;
    const levelsChanged =
      !pb ||
      pb.levels.length !== project.levels.length ||
      project.levels.some((l, i) => {
        const pl = pb.levels[i]!;
        return (
          pl.walls !== l.walls ||
          pl.rooms !== l.rooms ||
          pl.slabs !== l.slabs ||
          pl.stairs !== l.stairs ||
          pl.furniture !== l.furniture ||
          pl.lights !== l.lights ||
          pl.hvac !== l.hvac
        );
      });
    const buildChanged =
      !pb ||
      pb.systems !== project.systems ||
      pb.peil !== project.site.peil ||
      pb.buildExtras !== project.buildExtras ||
      levelsChanged;

    if (buildChanged) {
      this.prevBuildRefs = {
        systems: project.systems,
        peil: project.site.peil,
        buildExtras: project.buildExtras,
        levels: project.levels.map((l) => ({
          walls: l.walls,
          rooms: l.rooms,
          slabs: l.slabs,
          stairs: l.stairs,
          furniture: l.furniture,
          lights: l.lights,
          hvac: l.hvac,
        })),
      };
      this.refreshWalkWorldAndHouse();
    }
    this.requestRender();
  }

  private getEffectiveDerived(): DerivedProjectModel {
    if (this.sessionDoorOverrides.size === 0) return this.derived;
    const baseProj = this.derived.project;
    const nextLevels = baseProj.levels.map((lv, lvIdx) => ({
      ...lv,
      walls: lv.walls.map((w) => ({
        ...w,
        openings: w.openings.map((op) => {
          const ov = this.sessionDoorOverrides.get(`${lvIdx}:${w.id}:${op.id}`);
          return ov === undefined ? op : { ...op, openPct: ov };
        }),
      })),
    }));
    const nextProj: Project = { ...baseProj, levels: nextLevels };
    return { ...this.derived, project: nextProj };
  }

  private refreshWalkWorldAndHouse(): void {
    const eff = this.getEffectiveDerived();
    this.ctrl.rebuildColliders(eff.project);
    this.debugOverlay.rebuildWorld(this.ctrl.world);
    this.rebuildHouseAndLights(eff, this.struct);
  }

  private rebuildHouseAndLights(derived: DerivedProjectModel, struct: StructuralReport): void {
    for (const r of this.dynResources) disposeResource(r);
    this.dynResources = [];
    this.houseContainer.clear();

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
      walkOpenDoorsFull: false,
      enableDynamicLights: false,
    });
    this.houseContainer.add(built.houseRoot);
    this.dynResources = built.resources;
    this.animatedFans = built.animatedFans;

    this.updatePooledLights(true);
    this.markShadowDirty();
  }

  private updatePooledLights(force: boolean): void {
    if (!this.derived || this.spotLightPool.length === 0) return;
    const lvIdx = Math.min(1, Math.max(0, this.ctrl.currentLevel)) as 0 | 1;
    const px = this.ctrl.x;
    const pz = this.ctrl.z;
    const simNight = this.derived.project.simulation.hourOfDay < 6.5 || this.derived.project.simulation.hourOfDay > 17.2;
    const distSq = (px - this.lastLightX) ** 2 + (pz - this.lastLightZ) ** 2;
    if (!force && lvIdx === this.lastLightLevel && simNight === this.lastSimNight && distSq < 0.56) {
      return;
    }

    this.lastLightLevel = lvIdx;
    this.lastLightX = px;
    this.lastLightZ = pz;
    this.lastSimNight = simNight;

    const lv = this.derived.project.levels[lvIdx];
    const baseY =
      lvIdx === 0
        ? this.derived.project.site.peil.floor1PeilM
        : this.derived.project.site.peil.floor1PeilM + (this.derived.project.levels[0]?.height ?? 3.6);
    const simNightBoost = simNight ? 1.65 : 1.0;

    const candidates = lv
      ? lv.lights
          .filter((l) => l.on && l.dimmer > 0)
          .map((l) => ({
            l,
            d2: (l.position.x - px) ** 2 + (l.position.z - pz) ** 2,
          }))
          .sort((a, b) => a.d2 - b.d2)
          .slice(0, this.spotLightPool.length)
      : [];

    for (let i = 0; i < this.spotLightPool.length; i++) {
      const spot = this.spotLightPool[i]!;
      const item = candidates[i];
      if (!item || !lv) {
        spot.intensity = 0;
        continue;
      }
      const { l } = item;
      const rotY = l.rotationY ?? 0;
      const fwdOff = l.type === "wall" ? 1.15 : 0;
      const halfAngle = Math.min(Math.PI * 0.42, Math.max(0.35, ((l.beamAngleDeg * 0.5) * Math.PI) / 180));
      spot.color.setHex(l.colorTempK <= 3200 ? 0xffcb85 : 0xffe7bd);
      spot.intensity = (l.lumens / 650) * l.dimmer * 1.15 * simNightBoost;
      spot.distance = Math.min(4.4, lv.height + 0.6);
      spot.angle = halfAngle;
      spot.position.set(
        l.position.x + Math.sin(rotY) * (l.type === "wall" ? 0.24 : 0),
        baseY + Math.min(lv.height - 0.25, l.position.y) - 0.05,
        l.position.z + Math.cos(rotY) * (l.type === "wall" ? 0.24 : 0),
      );
      spot.target.position.set(l.position.x + Math.sin(rotY) * fwdOff, baseY, l.position.z + Math.cos(rotY) * fwdOff);
      spot.target.updateMatrixWorld();
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
    this.requestRender();
    this.emitTelemetry(true);
  }

  public setCameraMode(mode: WalkCameraMode): void {
    if (this.cameraMode !== mode) this.toggleCameraMode();
  }

  public toggleDebugOverlay(): void {
    this.debugOverlay.setVisible(!this.debugOverlay.isVisible());
    this.requestRender();
    this.emitTelemetry(true);
  }

  public teleportToSafeSpawn(): void {
    this.ctrl.teleportToSafeSpawn();
    this.pitchRad = this.cameraMode === "third_person" ? THREE.MathUtils.degToRad(-WALK_CONFIG.thirdPerson.pitchDefaultDeg) : 0;
    this.camInitialized = false;
    this.requestRender();
    this.emitTelemetry(true);
  }

  public triggerInteractNearestDoor(): boolean {
    const door = this.ctrl.nearestDoor;
    if (!door) return false;
    const isOpen = door.openPct > WALK_CONFIG.doorOpenPassPct;
    const nextPct = isOpen ? 0 : 85;
    simsAudio.playDoorToggle(!isOpen);
    this.sessionDoorOverrides.set(`${door.levelIndex}:${door.wallId}:${door.opId}`, nextPct);
    this.refreshWalkWorldAndHouse();
    this.emitTelemetry(true);
    return true;
  }

  public setVirtualInput(forward: number, strafe: number, sprint: boolean): void {
    this.virtualMove = { forward, strafe, sprint };
    this.requestRender();
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
    this.requestRender();
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
    this.requestRender();
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.pointerType === "touch") {
      this.walkTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        this.canvas.setPointerCapture?.(e.pointerId);
      } catch {
        // ignore synthetic events
      }
      if (this.walkTouches.size >= 2) {
        this.dragLookActive = false;
        this.activeLookPointerId = null;
        if (this.walkTouches.size === 2 && this.cameraMode === "third_person") {
          const pts = [...this.walkTouches.values()];
          this.lastWalkPinchDist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
        }
        return;
      }
      if (this.activeLookPointerId === null) {
        this.activeLookPointerId = e.pointerId;
        this.dragLookActive = true;
        this.pointerDownPos = { x: e.clientX, y: e.clientY };
        this.lastDragPos = { x: e.clientX, y: e.clientY };
      }
      return;
    }

    if (e.button !== 0 && e.button !== 2) return;
    this.activeLookPointerId = e.pointerId;
    this.dragLookActive = true;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.lastDragPos = { x: e.clientX, y: e.clientY };
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore synthetic events
    }

    // Request Pointer Lock smoothly on mouse click in 1st-person mode (never on touch screens)
    if (
      e.button === 0 &&
      this.cameraMode === "first_person" &&
      document.pointerLockElement !== this.canvas
    ) {
      try {
        const res = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
        res?.catch?.(() => {});
      } catch {
        // Fallback drag look already armed cleanly
      }
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (e.pointerType === "touch") {
      if (!this.walkTouches.has(e.pointerId)) return;
      this.walkTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.walkTouches.size >= 2) {
        if (this.walkTouches.size === 2 && this.cameraMode === "third_person") {
          const pts = [...this.walkTouches.values()];
          const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
          const delta = dist - this.lastWalkPinchDist;
          this.lastWalkPinchDist = dist;
          this.thirdPersonDist = THREE.MathUtils.clamp(
            this.thirdPersonDist - delta * 0.018,
            WALK_CONFIG.thirdPerson.minDist,
            WALK_CONFIG.thirdPerson.maxDist,
          );
          this.requestRender();
        }
        return;
      }
      if (!this.dragLookActive || this.activeLookPointerId !== e.pointerId) return;
    }

    let dx = 0;
    let dy = 0;

    if (this.pointerLocked) {
      dx = e.movementX || 0;
      dy = e.movementY || 0;
    } else if (this.dragLookActive && (this.activeLookPointerId === null || e.pointerId === this.activeLookPointerId)) {
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
    this.requestRender();
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.cameraMode === "third_person") {
      this.thirdPersonDist = THREE.MathUtils.clamp(
        this.thirdPersonDist + e.deltaY * 0.0022,
        WALK_CONFIG.thirdPerson.minDist,
        WALK_CONFIG.thirdPerson.maxDist,
      );
      this.requestRender();
    }
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent ? parent.clientWidth : this.canvas.clientWidth);
    const h = Math.max(1, parent ? parent.clientHeight : this.canvas.clientHeight);
    const dprChanged = Math.abs(this.currentDpr - this.lastAppliedSize.dpr) > 0.001;
    const sizeChanged = w !== this.lastAppliedSize.w || h !== this.lastAppliedSize.h;
    if (!dprChanged && !sizeChanged) return; // same-value setSize still wipes the canvas to black
    this.lastAppliedSize = { w, h, dpr: this.currentDpr };
    if (dprChanged) this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      if (dprChanged) this.composer.setPixelRatio(this.currentDpr);
      if (sizeChanged || dprChanged) this.composer.setSize(w, h);
    }
    if (this.atmospherePass) this.atmospherePass.atmosphereUniforms.uAspect.value = w / h;
    if (this.outputPass) this.outputPass.finalUniforms.uAspect.value = w / h;
    // A real resize just reset the drawing buffer; paint one frame right now so the
    // user never sees the cleared (black) canvas waiting for the next RAF.
    if (this.hasRenderedOnce && !this.contextLost && !this.disposed) {
      if (this.postActive && this.composer) {
        this.updateAtmosphere(this.camera);
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
    this.requestRender();
  }

  private handleVisibility(): void {
    if (document.hidden) {
      this.keysDown.clear();
      this.dragLookActive = false;
      this.activeLookPointerId = null;
      this.walkTouches.clear();
      this.lastWalkPinchDist = 0;
      this.virtualMove = { forward: 0, strafe: 0, sprint: false };
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

  private readMoveInput(dt: number): { forward: number; strafe: number; sprint: boolean } {
    let forward = this.virtualMove.forward;
    let strafe = this.virtualMove.strafe;
    if (this.keysDown.has("KeyW") || this.keysDown.has("ArrowUp")) forward += 1;
    if (this.keysDown.has("KeyS") || this.keysDown.has("ArrowDown")) forward -= 1;
    if (this.keysDown.has("KeyD") || this.keysDown.has("ArrowRight")) strafe += 1;
    if (this.keysDown.has("KeyA") || this.keysDown.has("ArrowLeft")) strafe -= 1;
    // Frame-rate independent keyboard turn when Q is held
    if (this.keysDown.has("KeyQ")) this.ctrl.yaw += dt * 1.9;

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
      if (this.contextLost) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;

      const move = this.readMoveInput(dt);
      // OPT-09: `animatedFans.length > 0` alone kept the loop awake 100% of the
      // session; only an on-screen, effectively-visible fan keeps it rendering now.
      const fansActive = this.anyFanVisibleInFrustum();
      const moveInputActive =
        move.forward !== 0 || move.strafe !== 0 || this.keysDown.has("KeyQ");
      const camSettling =
        !this.camInitialized ||
        (this.cameraMode === "third_person" && Math.abs(this.smoothCamDist - this.thirdPersonDist) > 1e-3);
      const shouldStepAndRender =
        this.needsRender || moveInputActive || camSettling || fansActive || this.lastWalkActive;

      // OPT-18: compositor blur gating on <body>
      this.update3dActiveFlag(
        this.needsRender || moveInputActive || camSettling || fansActive || this.lastWalkActive,
        now,
      );

      if (!shouldStepAndRender) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }
      this.needsRender = false;
      this.simElapsedS += dt;

      // Spin ceiling/stand fans gently (skipped if user prefers reduced motion)
      if (fansActive) {
        for (const fan of this.animatedFans) {
          fan.rotation.y += dt * 4.5;
        }
      }

      // Advance kinematic capsule controller
      const prevDist = this.ctrl.distanceTraveledM;
      const snap = this.ctrl.step(dt, {
        forward: move.forward,
        strafe: move.strafe,
        sprint: move.sprint,
        yaw: this.ctrl.yaw,
      });
      this.lastWalkActive = snap.speed > 0.01 || !snap.grounded || moveInputActive;

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

      // Update pooled floor-local lights as player moves across rooms/floors
      this.updatePooledLights(false);

      // Update camera (1st-person or 3rd-person spring-arm collision)
      this.updateCamera(dt, snap, move.sprint);

      // Lock sky dome + sun billboards to the camera so walking never introduces parallax drift
      this.skyMesh.position.copy(this.camera.position);
      if (this.sunCore?.visible) this.sunCore.position.copy(this.camera.position).addScaledVector(this.sunDir, 132);
      if (this.sunHalo?.visible) this.sunHalo.position.copy(this.camera.position).addScaledVector(this.sunDir, 132);

      // Cinematic ray-traced-look stack (mirrors BuildScene), or the direct render fallback
      if (this.postActive && this.composer) {
        this.updateAtmosphere(this.camera);
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      this.hasRenderedOnce = true;

      // FPS, Adaptive DPR Governor & Stats Telemetry (O(1) circular ring buffer, zero-GC)
      const fpsInst = 1 / Math.max(0.001, dt);
      if (this.fpsRingCount === 24) {
        this.fpsRingSum -= this.fpsRing[this.fpsRingIdx]!;
      } else {
        this.fpsRingCount += 1;
      }
      this.fpsRing[this.fpsRingIdx] = fpsInst;
      this.fpsRingSum += fpsInst;
      this.fpsRingIdx = (this.fpsRingIdx + 1) % 24;

      if (this.qualityOverride === "auto" && this.fpsRingCount >= 20 && now - this.lastDprCheckMs > 2000) {
        this.lastDprCheckMs = now;
        const avg = this.fpsRingSum / this.fpsRingCount;
        const decision = this.dprGovernor.sample(avg, now);
        if (decision === "downgrade" && this.currentDpr > 1) {
          this.currentDpr = 1;
          this.handleResize();
        } else if (decision === "upgrade" && this.currentDpr < this.baseDpr) {
          this.currentDpr = this.baseDpr;
          this.handleResize();
        }
      }
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
      if (!this.reducedMotion && snap.speed > 0.25 && snap.grounded) {
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
    // OPT-13: cheapest throttle check first — getSnapshot() and the 13-segment
    // signature string are only built after the 90 ms gate passes.
    if (!force && now - this.lastSnapshotEmitAt < 90) return;
    const avgFps =
      this.fpsRingCount > 0 ? Math.round(this.fpsRingSum / this.fpsRingCount) : 60;
    const snap = this.ctrl.getSnapshot();
    const stateSig = `${snap.x.toFixed(2)}|${snap.y.toFixed(2)}|${snap.z.toFixed(2)}|${snap.yaw.toFixed(2)}|${snap.currentLevel}|${snap.roomName}|${snap.nearestDoor?.opId ?? ""}|${snap.nearestDoor?.openPct ?? -1}|${snap.collidedLastTick}|${this.cameraMode}|${this.pointerLocked}|${this.debugOverlay.isVisible()}|${Math.round(avgFps / 5)}`;
    const minGap = stateSig !== this.lastEmittedState ? 90 : 450;
    if (!force && now - this.lastSnapshotEmitAt < minGap) return;
    this.lastSnapshotEmitAt = now;
    this.lastEmittedState = stateSig;

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
    window.removeEventListener("resize", this.onResizeBound);
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityBound);
    document.removeEventListener("pointerlockchange", this.onPointerLockChangeBound);
    window.removeEventListener("keydown", this.onKeyDownBound);
    window.removeEventListener("keyup", this.onKeyUpBound);
    this.canvas.removeEventListener("pointerdown", this.onPointerDownBound);
    window.removeEventListener("pointermove", this.onPointerMoveBound);
    window.removeEventListener("pointerup", this.onPointerUpBound);
    window.removeEventListener("pointercancel", this.onPointerUpBound);
    this.canvas.removeEventListener("wheel", this.onWheelBound);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLostBound);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestoredBound);

    this.envGroup.clear();
    this.neighborsGroup.clear();
    this.lightsGroup.clear();
    this.houseContainer.clear();
    this.avatar.dispose();
    this.debugOverlay.dispose();
    for (const r of this.dynResources) disposeResource(r);
    for (const r of this.staticDisposables) disposeResource(r);
    this.dynResources = [];
    this.staticDisposables = [];
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null;
    }
    this.skyMat.map?.dispose();
    for (const env of this.pmremCache.values()) env.dispose();
    this.pmremCache.clear();
    this.palette.dispose();

    this.postActive = false;
    this.atmospherePass?.dispose();
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.atmospherePass = null;
    this.bloomPass = null;
    this.outputPass = null;

    this.renderer.dispose();
  }
}
