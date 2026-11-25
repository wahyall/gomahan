"use client";

import { getWalkModeStubState } from "@/features/walkMode";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { ArrowLeft, Footprints } from "lucide-react";

export function WalkModeStub() {
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const stub = getWalkModeStubState();

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[#121418] p-6 text-center">
      <div className="max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-teal-400/40 bg-teal-500/15 text-teal-300">
          <Footprints className="h-6 w-6" aria-hidden />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-teal-300">
            Walk Mode Realistis · Fase {stub.readyPhase} Stub
          </div>
          <h2 className="text-base font-bold text-foreground">Kontroler Kapsul &amp; Collision Data (Stub)</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Kamera berjalan bebas lama yang tembus dinding telah dihapus total. Kontroler kinematik fixed-timestep, spatial hash per tile, tinggi lantai &amp; tangga, serta kamera 1st/3rd person anti-tembus tembok akan aktif di Fase 4.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setWorkspace("build")}
          className="mx-auto flex min-h-9 items-center gap-1.5 rounded border border-primary/50 bg-primary/15 px-3.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Kembali ke Build Mode (Esc)
        </button>
      </div>
    </div>
  );
}
