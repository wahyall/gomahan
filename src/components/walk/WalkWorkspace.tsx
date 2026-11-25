"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bug,
  Camera,
  DoorOpen,
  Footprints,
  Hammer,
  HelpCircle,
  RotateCcw,
  User,
  X,
} from "lucide-react";
import { WalkScene, type WalkHudTelemetry } from "@/features/walkMode";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { useStudioStore } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";
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

export function WalkWorkspace({ derived, struct, onSnapshotCapture }: WalkWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WalkScene | null>(null);
  const onSnapshotRef = useRef(onSnapshotCapture);
  useEffect(() => {
    onSnapshotRef.current = onSnapshotCapture;
  }, [onSnapshotCapture]);

  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const updateOpening = useStudioStore((s) => s.updateOpening);

  const [telemetry, setTelemetry] = useState<WalkHudTelemetry | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

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
        onToggleDoor: (lv, wallId, opId, openPct) => updateOpening(lv, wallId, opId, { openPct }),
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

      {/* TOP HUD BAR */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2">
        <div className="flex max-w-full flex-col gap-1.5">
          <div className="studio-glass pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl px-3 py-1.5 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
              <Footprints className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Walk · LT {levelNum}</span>
            </span>
            <span className="h-3.5 w-px bg-white/15" />
            <span className="font-medium text-foreground">{telemetry?.roomName ?? "Teras Depan"}</span>
            <span className="hidden rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              {telemetry ? SURFACE_LABEL[telemetry.surface] : "Kayu"}
            </span>
            {telemetry?.onStairId && (
              <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                Di Tangga
              </span>
            )}
            {telemetry && (
              <span className="hidden font-mono text-[10px] text-muted-foreground tabular-nums md:inline">
                {telemetry.fps} FPS
              </span>
            )}
          </div>

          {telemetry?.collidedLastTick && telemetry.lastCollisionLabels.length > 0 && (
            <div className="w-fit rounded-xl border border-amber-400/35 bg-[#1b1812]/90 px-3 py-1 text-[10.5px] font-medium text-amber-200 backdrop-blur-md">
              Tertahan: {telemetry.lastCollisionLabels[0]}
            </div>
          )}
        </div>

        {/* TOP-RIGHT HUD CONTROLS */}
        <div className="studio-glass pointer-events-auto flex flex-wrap items-center gap-1 rounded-2xl p-1">
          <button
            type="button"
            onClick={() => sceneRef.current?.toggleCameraMode()}
            className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-foreground transition hover:bg-white/[0.08]"
            title="Ganti Sudut Pandang 1st Person / 3rd Person (Tombol V)"
          >
            {isFirst ? <User className="h-3.5 w-3.5 text-primary" /> : <Camera className="h-3.5 w-3.5 text-primary" />}
            <span>{isFirst ? "1st Person" : "3rd Person"}</span>
            <kbd className="hidden rounded bg-white/10 px-1 font-mono text-[9.5px] text-muted-foreground sm:inline">V</kbd>
          </button>

          <button
            type="button"
            onClick={() => sceneRef.current?.toggleDebugOverlay()}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition",
              telemetry?.debugOverlayVisible
                ? "bg-primary/20 text-[#f6ba86] ring-1 ring-primary/45"
                : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
            )}
            title="Tampilkan Wireframe Collision, Tangga & Kapsul (F3)"
            aria-pressed={Boolean(telemetry?.debugOverlayVisible)}
          >
            <Bug className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Debug</span>
            <kbd className="hidden rounded bg-white/10 px-1 font-mono text-[9.5px] sm:inline">F3</kbd>
          </button>

          <button
            type="button"
            onClick={() => sceneRef.current?.teleportToSafeSpawn()}
            className="flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
            title="Kembali ke Posisi Aman Awal (R)"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl transition",
              helpOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
            )}
            title="Kontrol Walk Mode"
            aria-label="Panduan Kontrol Walk Mode"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setWorkspace("build")}
            className="flex h-8 items-center gap-1.5 rounded-xl bg-[#f2efe8] px-3 text-xs font-semibold text-[#14171c] shadow-sm transition hover:brightness-95"
            title="Kembali ke Build Mode (Esc)"
          >
            <Hammer className="h-3.5 w-3.5 text-[#b9662a]" aria-hidden />
            <span>Build</span>
            <kbd className="hidden rounded bg-black/10 px-1 font-mono text-[9.5px] sm:inline">Esc</kbd>
          </button>
        </div>
      </div>

      {/* Interactive Door Prompt */}
      {nearDoor && (
        <div className="absolute bottom-40 left-4 z-20 sm:bottom-14 sm:left-1/2 sm:-translate-x-1/2 [@media(max-height:480px)]:bottom-4 [@media(max-height:480px)]:left-1/2 [@media(max-height:480px)]:-translate-x-1/2">
          <button
            type="button"
            onClick={() => sceneRef.current?.triggerInteractNearestDoor()}
            className="studio-glass flex min-h-10 items-center gap-2 rounded-full border-primary/50 px-4 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary"
          >
            <DoorOpen className="h-4 w-4 text-primary" aria-hidden />
            <span>
              [E] {nearDoor.openPct > 5 ? "Tutup" : "Buka"} {nearDoor.label}
            </span>
          </button>
        </div>
      )}

      {/* Help Popover */}
      {helpOpen && (
        <div className="studio-glass absolute right-3 top-14 z-30 w-72 rounded-2xl p-4 text-[11px] text-muted-foreground shadow-2xl">
          <div className="mb-2.5 flex items-center justify-between text-xs font-bold text-foreground">
            <span>Kontrol Walk Mode</span>
            <button type="button" onClick={() => setHelpOpen(false)} aria-label="Tutup" className="rounded p-0.5 hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="space-y-1.5">
            <li><strong className="text-foreground">WASD / Panah</strong>: Berjalan</li>
            <li><strong className="text-foreground">Shift</strong>: Berlari cepat</li>
            <li><strong className="text-foreground">Klik / Seret Kanvas</strong>: Lihat 360°</li>
            <li><strong className="text-foreground">V</strong>: 1st Person ↔ 3rd Person</li>
            <li><strong className="text-foreground">E</strong>: Buka / Tutup pintu terdekat</li>
            <li><strong className="text-foreground">Scroll</strong>: Atur jarak kamera 3rd Person</li>
            <li><strong className="text-foreground">F3 / Esc</strong>: Debug / Kembali ke Build Mode</li>
          </ul>
        </div>
      )}

      {/* Touch D-Pad for Mobile Viewports */}
      <div className="absolute bottom-5 left-4 z-20 grid grid-cols-3 gap-1.5 sm:hidden">
        <div />
        <TouchPadBtn
          label="Maju"
          onActive={(on) => {
            padRef.current.forward = on ? 1 : 0;
            pushPad();
          }}
        >
          <ArrowUp className="h-4 w-4" />
        </TouchPadBtn>
        <div />
        <TouchPadBtn
          label="Kiri"
          onActive={(on) => {
            padRef.current.strafe = on ? -1 : 0;
            pushPad();
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </TouchPadBtn>
        <TouchPadBtn
          label="Mundur"
          onActive={(on) => {
            padRef.current.forward = on ? -1 : 0;
            pushPad();
          }}
        >
          <ArrowDown className="h-4 w-4" />
        </TouchPadBtn>
        <TouchPadBtn
          label="Kanan"
          onActive={(on) => {
            padRef.current.strafe = on ? 1 : 0;
            pushPad();
          }}
        >
          <ArrowRight className="h-4 w-4" />
        </TouchPadBtn>
      </div>

      {/* Mobile Touch Sprint */}
      <div className="absolute bottom-5 right-4 z-20 flex items-center gap-2 sm:hidden">
        <button
          type="button"
          onPointerDown={() => {
            padRef.current.sprint = true;
            pushPad();
          }}
          onPointerUp={() => {
            padRef.current.sprint = false;
            pushPad();
          }}
          onPointerCancel={() => {
            padRef.current.sprint = false;
            pushPad();
          }}
          onPointerLeave={() => {
            padRef.current.sprint = false;
            pushPad();
          }}
          className="studio-glass flex h-11 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold text-foreground active:bg-primary/40"
        >
          Lari
        </button>
      </div>

      {/* Desktop Key Legend Pill */}
      <div className="studio-glass pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 rounded-full px-4 py-1.5 text-[10.5px] text-muted-foreground sm:flex [@media(max-height:500px)]:hidden [@media(pointer:coarse)]:hidden">
        <span><strong className="text-foreground">WASD</strong> Jalan</span>
        <span><strong className="text-foreground">Shift</strong> Lari</span>
        <span><strong className="text-foreground">Klik / Seret</strong> Lihat 360°</span>
        <span><strong className="text-foreground">V</strong> Sudut Pandang</span>
        <span><strong className="text-foreground">E</strong> Pintu</span>
        <span><strong className="text-foreground">Esc</strong> Build</span>
      </div>
    </div>
  );
}

function TouchPadBtn({
  label,
  onActive,
  children,
}: {
  label: string;
  onActive: (down: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={() => onActive(true)}
      onPointerUp={() => onActive(false)}
      onPointerCancel={() => onActive(false)}
      onPointerLeave={() => onActive(false)}
      className="studio-glass flex h-11 w-11 items-center justify-center rounded-xl text-foreground active:bg-primary/40"
    >
      {children}
    </button>
  );
}
