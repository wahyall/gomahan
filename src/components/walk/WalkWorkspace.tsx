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
} from "lucide-react";
import { WalkScene, type WalkHudTelemetry } from "@/features/walkMode";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { useStudioStore } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { cn } from "@/lib/utils";

interface WalkWorkspaceProps {
  derived: DerivedProjectModel;
  struct: StructuralReport;
}

const SURFACE_LABEL: Record<WalkHudTelemetry["surface"], string> = {
  tile: "Keramik",
  wood: "Kayu / Tangga",
  grass: "Rumput Taman",
  stone: "Batu / Jalan",
};

export function WalkWorkspace({ derived, struct }: WalkWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WalkScene | null>(null);

  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const updateOpening = useStudioStore((s) => s.updateOpening);

  const [telemetry, setTelemetry] = useState<WalkHudTelemetry | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Mobile touch pad state
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
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#12161c] p-6 text-center">
        <div className="max-w-md space-y-3 rounded-xl border border-red-500/40 bg-card p-6 shadow-xl">
          <h2 className="text-sm font-bold text-red-300">WebGL Walk Mode Tidak Tersedia</h2>
          <p className="text-xs text-muted-foreground">{webglError}</p>
          <button
            type="button"
            onClick={() => setWorkspace("build")}
            className="mx-auto inline-flex min-h-9 items-center gap-1.5 rounded bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
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
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair outline-none" />

      {/* Center Reticle in 1st-Person */}
      {isFirst && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-1.5 w-1.5 rounded-full bg-white/80 ring-2 ring-black/35" />
        </div>
      )}

      {/* TOP HUD BAR: Responsive flex container so left/right HUD never overlap on 390px mobile */}
      <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-20 flex flex-wrap items-start justify-between gap-2">
        <div className="flex max-w-full flex-col gap-1.5">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-white/15 bg-[#151a22]/90 px-2.5 py-1.5 text-[11px] shadow-xl backdrop-blur-md sm:gap-2 sm:px-3 sm:text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-teal-300">
              <Footprints className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Walk · LT {levelNum}</span>
            </span>
            <span className="h-3.5 w-px bg-white/15" />
            <span className="font-medium text-foreground">{telemetry?.roomName ?? "Teras Depan"}</span>
            <span className="hidden rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              {telemetry ? SURFACE_LABEL[telemetry.surface] : "Kayu"}
            </span>
            {telemetry?.onStairId && (
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                Di Tangga
              </span>
            )}
            {telemetry && (
              <span className="hidden font-mono text-[10px] text-muted-foreground md:inline">
                {telemetry.fps} FPS · {telemetry.calls} draws
              </span>
            )}
          </div>

          {telemetry?.collidedLastTick && telemetry.lastCollisionLabels.length > 0 && (
            <div className="w-fit rounded-lg border border-amber-400/35 bg-[#1a1814]/88 px-2.5 py-1 text-[10.5px] font-medium text-amber-200 backdrop-blur-md">
              Tertahan: {telemetry.lastCollisionLabels[0]}
            </div>
          )}
        </div>

        {/* TOP-RIGHT HUD CONTROLS */}
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => sceneRef.current?.toggleCameraMode()}
            className="flex min-h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-[#151a22]/90 px-2.5 text-[11px] font-semibold text-foreground shadow-lg backdrop-blur-md hover:border-teal-400/50"
            title="Ganti Sudut Pandang 1st Person / 3rd Person (Tombol V)"
          >
            {isFirst ? <User className="h-3.5 w-3.5 text-teal-300" /> : <Camera className="h-3.5 w-3.5 text-teal-300" />}
            <span>{isFirst ? "1st Person" : "3rd Person"}</span>
            <kbd className="hidden rounded bg-white/10 px-1 text-[9.5px] text-muted-foreground sm:inline">V</kbd>
          </button>

          <button
            type="button"
            onClick={() => sceneRef.current?.toggleDebugOverlay()}
            className={cn(
              "flex min-h-9 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold shadow-lg backdrop-blur-md transition sm:px-2.5",
              telemetry?.debugOverlayVisible
                ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                : "border-white/15 bg-[#151a22]/90 text-muted-foreground hover:text-foreground",
            )}
            title="Tampilkan Wireframe Collision, Tangga & Kapsul (F3)"
            aria-pressed={Boolean(telemetry?.debugOverlayVisible)}
          >
            <Bug className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Collision</span>
            <kbd className="rounded bg-white/10 px-1 text-[9.5px]">F3</kbd>
          </button>

          <button
            type="button"
            onClick={() => sceneRef.current?.teleportToSafeSpawn()}
            className="flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-[#151a22]/90 px-2.5 text-[11px] font-medium text-muted-foreground shadow-lg backdrop-blur-md hover:text-foreground"
            title="Kembali ke Posisi Aman Awal (R)"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#151a22]/90 text-muted-foreground shadow-lg backdrop-blur-md hover:text-foreground"
            title="Kontrol Walk Mode"
            aria-label="Panduan Kontrol Walk Mode"
          >
            <HelpCircle className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setWorkspace("build")}
            className="flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-400/45 bg-[#162723]/92 px-2.5 text-[11.5px] font-bold text-emerald-200 shadow-lg backdrop-blur-md hover:bg-emerald-500/25 sm:px-3"
            title="Kembali ke Build Mode (Tombol Esc)"
          >
            <Hammer className="h-3.5 w-3.5" aria-hidden />
            <span>Build</span>
            <kbd className="hidden rounded bg-black/25 px-1 text-[9.5px] sm:inline">Esc</kbd>
          </button>
        </div>
      </div>

      {/* Interactive Door Prompt near Doorway (kept above mobile D-pad) */}
      {nearDoor && (
        <div className="absolute bottom-36 left-4 z-20 sm:bottom-14 sm:left-1/2 sm:-translate-x-1/2">
          <button
            type="button"
            onClick={() => sceneRef.current?.triggerInteractNearestDoor()}
            className="flex min-h-9 items-center gap-2 rounded-full border border-teal-400/50 bg-[#141c24]/92 px-3.5 py-1.5 text-xs font-semibold text-teal-100 shadow-xl backdrop-blur-md hover:bg-teal-500/25"
          >
            <DoorOpen className="h-3.5 w-3.5 text-teal-300" aria-hidden />
            <span>
              [E] {nearDoor.openPct > 5 ? "Tutup" : "Buka"} {nearDoor.label}
            </span>
          </button>
        </div>
      )}

      {/* Help Popover */}
      {helpOpen && (
        <div className="absolute right-3 top-14 z-30 w-72 rounded-xl border border-white/15 bg-[#151a22]/96 p-3.5 text-[11px] text-muted-foreground shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-foreground">
            <span>Kontrol Walk Mode Realistis</span>
            <button type="button" onClick={() => setHelpOpen(false)} className="text-[10px] text-primary hover:underline">
              Tutup
            </button>
          </div>
          <ul className="space-y-1">
            <li><strong className="text-foreground">WASD / Panah</strong>: Berjalan (mengikuti arah pandang)</li>
            <li><strong className="text-foreground">Shift</strong>: Berlari cepat</li>
            <li><strong className="text-foreground">Klik / Seret Kanvas</strong>: Putar kamera 360° (Pointer Lock)</li>
            <li><strong className="text-foreground">V</strong>: Ganti 1st Person ↔ 3rd Person</li>
            <li><strong className="text-foreground">E</strong>: Buka / Tutup pintu terdekat</li>
            <li><strong className="text-foreground">Scroll</strong>: Atur jarak kamera 3rd Person</li>
            <li><strong className="text-foreground">F3</strong>: Tampilkan Wireframe Collision &amp; Tangga</li>
            <li><strong className="text-foreground">Esc</strong>: Lepas kursor / kembali ke Build Mode</li>
          </ul>
        </div>
      )}

      {/* Touch D-Pad for Mobile Viewports */}
      <div className="absolute bottom-5 left-4 z-20 grid grid-cols-3 gap-1 sm:hidden">
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

      {/* Mobile Touch Sprint & Quick Look Controls */}
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
          className="flex h-11 items-center gap-1.5 rounded-lg border border-white/20 bg-[#151a22]/85 px-3 text-xs font-semibold text-foreground active:bg-primary/40"
        >
          Lari
        </button>
      </div>

      {/* Bottom Desktop Key Legend Strip */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#141921]/82 px-4 py-1.5 text-[10.5px] text-muted-foreground shadow-lg backdrop-blur-md sm:flex">
        <span><strong className="text-foreground">WASD</strong> Jalan</span>
        <span><strong className="text-foreground">Shift</strong> Lari</span>
        <span><strong className="text-foreground">Klik / Seret</strong> Lihat</span>
        <span><strong className="text-foreground">V</strong> 1st / 3rd Person</span>
        <span><strong className="text-foreground">E</strong> Pintu</span>
        <span><strong className="text-foreground">F3</strong> Debug</span>
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
      className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-[#151a22]/85 text-foreground active:bg-primary/40"
    >
      {children}
    </button>
  );
}
