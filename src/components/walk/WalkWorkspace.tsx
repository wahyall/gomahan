"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bug,
  Camera,
  DoorOpen,
  Footprints,
  Hammer,
  HelpCircle,
  Moon,
  RotateCcw,
  Sun,
  User,
  X,
  Zap,
} from "lucide-react";
import { WalkScene, type WalkHudTelemetry } from "@/features/walkMode";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { useBuildModeStore } from "@/features/buildMode/store";
import { useTouchControls } from "@/lib/hooks/useMobileLayout";
import { useStudioStore } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { VirtualJoystick } from "@/components/walk/VirtualJoystick";
import { cn } from "@/lib/utils";

interface WalkWorkspaceProps {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  onSnapshotCapture?: (dataUrl: string) => void;
}

const SURFACE_LABEL: Record<WalkHudTelemetry["surface"], string> = {
  tile: "Keramik",
  wood: "Kayu / Tangga",
  grass: "Rumput Taman",
  stone: "Batu / Jalan",
};

/** Same daylight presets as the Build viewport so both modes share one sun. */
const TIMES_OF_DAY: { id: string; hour: number; label: string }[] = [
  { id: "morning", hour: 7.5, label: "Pagi" },
  { id: "noon", hour: 12.0, label: "Siang" },
  { id: "sunset", hour: 17.2, label: "Sore" },
  { id: "night", hour: 21.0, label: "Malam" },
];

function activeTimeIdx(hourOfDay: number): number {
  const idx = TIMES_OF_DAY.findIndex((t) => Math.abs(hourOfDay - t.hour) < 2.2);
  return idx >= 0 ? idx : 1;
}

export function WalkWorkspace({ derived, struct, onSnapshotCapture }: WalkWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WalkScene | null>(null);
  const onSnapshotRef = useRef(onSnapshotCapture);
  useEffect(() => {
    onSnapshotRef.current = onSnapshotCapture;
  }, [onSnapshotCapture]);

  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const touchControls = useTouchControls();

  const [telemetry, setTelemetry] = useState<WalkHudTelemetry | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sprintLocked, setSprintLocked] = useState(false);

  const padRef = useRef({ forward: 0, strafe: 0, sprint: false });
  const pushPad = () => {
    sceneRef.current?.setVirtualInput(padRef.current.forward, padRef.current.strafe, padRef.current.sprint);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const testGl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!testGl) {
        queueMicrotask(() =>
          setWebglError("Browser/GPU tidak mendukung WebGL sehingga tampilan Walk Mode 3D tidak dapat dimuat."),
        );
        return;
      }
      const ws = new WalkScene(canvas, derived, struct, {
        onHudUpdate: (next) => setTelemetry(next),
        onExitWalkMode: () => setWorkspace("build"),
      });
      sceneRef.current = ws;
      return () => {
        try {
          if (canvas.width > 0 && canvas.height > 0) {
            onSnapshotRef.current?.(canvas.toDataURL("image/jpeg", 0.9));
          }
        } catch {
          // ignore readback failure
        }
        ws.dispose();
        sceneRef.current = null;
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal menginisialisasi renderer Walk Mode.";
      queueMicrotask(() => setWebglError(msg));
      return undefined;
    }
    // Mount once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.updateProjectData(derived, struct);
  }, [derived, struct]);

  // Cinematic RT-look & quality tier follow the exact same settings as the Build viewport
  const rtLook = useBuildModeStore((s) => s.rtLook);
  const renderTier = useBuildModeStore((s) => s.renderTier);

  useEffect(() => {
    sceneRef.current?.setRayTracingLook(rtLook);
  }, [rtLook]);

  useEffect(() => {
    sceneRef.current?.setQualityOverride(renderTier);
  }, [renderTier]);

  // Dynamic time-of-day (T cycles Pagi → Siang → Sore → Malam, same presets as Build mode)
  const hourOfDay = derived.project.simulation.hourOfDay;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code === "KeyT" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        const currHour = useStudioStore.getState().project.simulation.hourOfDay;
        const next = TIMES_OF_DAY[(activeTimeIdx(currHour) + 1) % TIMES_OF_DAY.length]!;
        useStudioStore.getState().patchSimulation({ hourOfDay: next.hour });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (webglError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#10141a] p-6 text-center">
        <div className="studio-glass max-w-md space-y-3 rounded-2xl border-rose-500/40 p-6">
          <h2 className="text-sm font-bold text-rose-300">WebGL Walk Mode Tidak Tersedia</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{webglError}</p>
          <button
            type="button"
            onClick={() => setWorkspace("build")}
            className="mx-auto inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            <Hammer className="h-3.5 w-3.5" aria-hidden /> Kembali ke Build Mode
          </button>
        </div>
      </div>
    );
  }

  const isFirst = (telemetry?.cameraMode ?? "first_person") === "first_person";
  const levelNum = (telemetry?.currentLevel ?? 0) + 1;
  const nearDoor = telemetry?.nearestDoor ?? null;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#10161e] select-none">
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair touch-none select-none outline-none" />

      {/* Crisp 1st-Person Reticle */}
      {isFirst && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-1.5 w-1.5 rounded-full bg-white/85 ring-2 ring-black/40" />
        </div>
      )}

      {/* TOP HUD BAR (Unified responsive flex flow so status, controls, and time-of-day never overlap) */}
      <div className="pointer-events-none absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5 lg:items-start lg:gap-2">
          {/* 1. Location & Telemetry Status Pill */}
          <div className="studio-glass pointer-events-auto order-1 flex max-w-[calc(100%-5.75rem)] items-center gap-2 rounded-2xl px-2.5 py-1.5 text-xs sm:max-w-full sm:px-3">
            <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-primary">
              <Footprints className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Walk · LT {levelNum}</span>
            </span>
            <span className="h-3.5 w-px shrink-0 bg-white/15" />
            <span className="min-w-0 truncate font-medium text-foreground">
              {telemetry?.roomName ?? "Teras Depan"}
            </span>
            <span className="hidden shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              {telemetry ? SURFACE_LABEL[telemetry.surface] : "Kayu"}
            </span>
            {telemetry?.onStairId && (
              <span className="hidden shrink-0 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 sm:inline">
                Di Tangga
              </span>
            )}
            {telemetry && (
              <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums md:inline">
                {telemetry.fps} FPS
              </span>
            )}
          </div>

          {/* 2. Mobile Top-Right Exit Button (keeps Row 1 balanced with exit action always pinned top-right) */}
          <button
            type="button"
            onClick={() => setWorkspace("build")}
            className="pointer-events-auto order-2 flex min-h-10 shrink-0 items-center gap-1.5 rounded-2xl bg-[#f2efe8] px-3 text-xs font-semibold text-[#14171c] shadow-sm transition hover:brightness-95 active:scale-[0.98] sm:hidden"
            title="Kembali ke Build Mode"
          >
            <Hammer className="h-3.5 w-3.5 text-[#b9662a]" aria-hidden />
            <span>Desain</span>
          </button>

          {/* Forces clean Row 2 split on <640px widths even in wider mobile viewports */}
          <div className="order-3 h-0 basis-full sm:hidden" aria-hidden />

          {/* 3. Dynamic Time-of-Day Pills (Row 2 right on mobile, Row 2 center on sm/md, Row 1 center on lg+) */}
          <div className="order-5 flex shrink-0 justify-end sm:order-3 sm:w-full sm:justify-center lg:order-2 lg:w-auto">
            <div className="studio-glass pointer-events-auto flex items-center gap-0.5 rounded-full p-0.5">
              <span className="pl-2 pr-0.5 text-amber-300 sm:px-2" title="Waktu Pencahayaan Matahari">
                {hourOfDay >= 18.5 ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              </span>
              {TIMES_OF_DAY.map((t) => {
                const active = Math.abs(hourOfDay - t.hour) < 2.2;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => useStudioStore.getState().patchSimulation({ hourOfDay: t.hour })}
                    className={cn(
                      "min-h-9 rounded-full px-1.5 py-1 text-[10.5px] font-medium transition sm:min-h-0 sm:px-2.5",
                      active
                        ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
              {!touchControls && <kbd className="hidden rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground md:inline">T</kbd>}
            </div>
          </div>

          {/* 4. Camera / Reset / Help / (sm+: Exit) Controls */}
          <div className="studio-glass pointer-events-auto order-4 flex shrink-0 items-center gap-0.5 rounded-2xl p-1 sm:order-2 sm:gap-1">
            <button
              type="button"
              onClick={() => sceneRef.current?.toggleCameraMode()}
              className="flex min-h-9 items-center gap-1 rounded-xl px-2 text-xs font-medium text-foreground transition hover:bg-white/[0.08] sm:min-h-8 sm:h-8 sm:gap-1.5 sm:px-2.5"
              title="Ganti Sudut Pandang 1st Person / 3rd Person"
            >
              {isFirst ? <User className="h-3.5 w-3.5 text-primary" /> : <Camera className="h-3.5 w-3.5 text-primary" />}
              <span>{isFirst ? "1st" : "3rd"}</span>
              {!touchControls && <kbd className="hidden rounded bg-white/10 px-1 font-mono text-[9.5px] text-muted-foreground sm:inline">V</kbd>}
            </button>

            <button
              type="button"
              onClick={() => sceneRef.current?.toggleDebugOverlay()}
              className={cn(
                "hidden min-h-8 h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition md:flex",
                telemetry?.debugOverlayVisible
                  ? "bg-primary/20 text-[#f6ba86] ring-1 ring-primary/45"
                  : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
              )}
              title="Tampilkan Wireframe Collision, Tangga & Kapsul (F3)"
              aria-pressed={Boolean(telemetry?.debugOverlayVisible)}
            >
              <Bug className="h-3.5 w-3.5" aria-hidden />
              <span>Debug</span>
              <kbd className="rounded bg-white/10 px-1 font-mono text-[9.5px]">F3</kbd>
            </button>

            <button
              type="button"
              onClick={() => sceneRef.current?.teleportToSafeSpawn()}
              className="flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-xl px-2 text-xs font-medium text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground sm:min-h-8 sm:min-w-0 sm:h-8 sm:px-2.5"
              title="Kembali ke Posisi Aman Awal"
              aria-label="Reset posisi walk"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Reset</span>
            </button>

            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              className={cn(
                "flex min-h-9 min-w-9 items-center justify-center rounded-xl transition sm:min-h-8 sm:min-w-8 sm:h-8 sm:w-8",
                helpOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
              )}
              title="Kontrol Walk Mode"
              aria-label="Panduan Kontrol Walk Mode"
            >
              <HelpCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setWorkspace("build")}
              className="hidden min-h-8 h-8 items-center gap-1.5 rounded-xl bg-[#f2efe8] px-3 text-xs font-semibold text-[#14171c] shadow-sm transition hover:brightness-95 sm:flex"
              title="Kembali ke Build Mode"
            >
              <Hammer className="h-3.5 w-3.5 text-[#b9662a]" aria-hidden />
              <span>Desain</span>
              {!touchControls && <kbd className="hidden rounded bg-black/10 px-1 font-mono text-[9.5px] sm:inline">Esc</kbd>}
            </button>
          </div>
        </div>

        {/* Collision / Stair Badges below the HUD bar so they never push or cover controls */}
        {(telemetry?.onStairId || (telemetry?.collidedLastTick && telemetry.lastCollisionLabels.length > 0)) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {telemetry?.onStairId && (
              <span className="rounded-xl border border-emerald-500/35 bg-[#121f19]/90 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-300 backdrop-blur-md sm:hidden">
                Di Tangga
              </span>
            )}
            {telemetry?.collidedLastTick && telemetry.lastCollisionLabels.length > 0 && (
              <div className="w-fit rounded-xl border border-amber-400/35 bg-[#1b1812]/90 px-3 py-1 text-[10.5px] font-medium text-amber-200 backdrop-blur-md">
                Tertahan: {telemetry.lastCollisionLabels[0]}
              </div>
            )}
          </div>
        )}

        {/* Help Popover anchored below HUD bar so it never overlaps controls */}
        {helpOpen && (
          <div className="studio-glass pointer-events-auto mt-0.5 w-72 max-w-full self-end rounded-2xl p-4 text-[11px] text-muted-foreground shadow-2xl">
            <div className="mb-2.5 flex items-center justify-between text-xs font-bold text-foreground">
              <span>{touchControls ? "Kontrol Sentuh Walk Mode" : "Kontrol Walk Mode"}</span>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                aria-label="Tutup"
                className="flex min-h-9 min-w-9 items-center justify-center rounded-lg hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {touchControls ? (
              <ul className="space-y-2">
                <li><strong className="text-foreground">Geser Sisi Kiri</strong>: Analog Joystick untuk berjalan 360° (dorong penuh untuk lari)</li>
                <li><strong className="text-foreground">Geser Sisi Kanan</strong>: Lihat sekeliling 360° secara bebas</li>
                <li><strong className="text-foreground">Cubit 2 Jari</strong>: Atur jarak kamera pada mode 3rd Person</li>
                <li><strong className="text-foreground">Tombol Pintu</strong>: Muncul otomatis saat mendekati pintu</li>
              </ul>
            ) : (
              <ul className="space-y-1.5">
                <li><strong className="text-foreground">WASD / Panah</strong>: Berjalan</li>
                <li><strong className="text-foreground">Shift</strong>: Berlari cepat</li>
                <li><strong className="text-foreground">Klik / Seret Kanvas</strong>: Lihat 360°</li>
                <li><strong className="text-foreground">V</strong>: 1st Person ↔ 3rd Person</li>
                <li><strong className="text-foreground">E</strong>: Buka / Tutup pintu terdekat</li>
                <li><strong className="text-foreground">Scroll</strong>: Atur jarak kamera 3rd Person</li>
                <li><strong className="text-foreground">T</strong>: Ganti waktu (Pagi / Siang / Sore / Malam)</li>
                <li><strong className="text-foreground">F3 / Esc</strong>: Debug / Kembali ke Build Mode</li>
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Interactive Door Prompt */}
      {nearDoor && (
        <div
          className={cn(
            "absolute z-20",
            touchControls
              ? "bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5.25rem))] right-4 max-w-[54vw]"
              : "bottom-14 left-1/2 -translate-x-1/2",
          )}
        >
          <button
            type="button"
            onClick={() => sceneRef.current?.triggerInteractNearestDoor()}
            className="studio-glass flex min-h-12 max-w-full items-center gap-2 rounded-full border-primary/60 bg-[#171b22]/95 px-4 py-2 text-xs font-semibold text-foreground shadow-xl transition hover:border-primary active:scale-[0.98]"
          >
            <DoorOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">
              {!touchControls && "[E] "}
              {nearDoor.openPct > 5 ? "Tutup" : "Buka"} {nearDoor.label}
            </span>
          </button>
        </div>
      )}

      {/* Touch Controls (Portrait, Landscape & Coarse Tablets): Left Floating Analog Joystick + Right Sprint Lock */}
      {touchControls && (
        <>
          <VirtualJoystick
            sprintLocked={sprintLocked}
            onMove={(forward, strafe, sprint) => {
              padRef.current = { forward, strafe, sprint };
              pushPad();
            }}
            className="absolute bottom-0 left-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+6.25rem)] z-10 w-[44%] md:top-24"
          />

          <div className="pointer-events-auto absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !sprintLocked;
                setSprintLocked(next);
                padRef.current.sprint = next;
                pushPad();
              }}
              aria-pressed={sprintLocked}
              className={cn(
                "studio-glass flex min-h-11 items-center gap-1.5 rounded-2xl px-4 text-xs font-semibold transition active:scale-[0.97]",
                sprintLocked
                  ? "border-primary/60 bg-primary/25 text-[#f6ba86]"
                  : "text-foreground",
              )}
            >
              <Zap className="h-4 w-4 text-primary" aria-hidden />
              <span>{sprintLocked ? "Lari: ON" : "Lari"}</span>
            </button>
          </div>
        </>
      )}

      {/* Desktop Key Legend Pill */}
      {!touchControls && (
        <div className="studio-glass pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 rounded-full px-4 py-1.5 text-[10.5px] text-muted-foreground sm:flex [@media(max-height:500px)]:hidden">
          <span><strong className="text-foreground">WASD</strong> Jalan</span>
          <span><strong className="text-foreground">Shift</strong> Lari</span>
          <span><strong className="text-foreground">Klik / Seret</strong> Lihat 360°</span>
          <span><strong className="text-foreground">V</strong> Sudut Pandang</span>
          <span><strong className="text-foreground">E</strong> Pintu</span>
          <span><strong className="text-foreground">T</strong> Waktu</span>
          <span><strong className="text-foreground">Esc</strong> Build</span>
        </div>
      )}
    </div>
  );
}
