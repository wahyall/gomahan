"use client";

import { getBuildModeStubState } from "@/features/buildMode";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { Footprints, Hammer, Layers } from "lucide-react";

export function BuildModeStub() {
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const stub = getBuildModeStubState();

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[#121418] p-6 text-center">
      <div className="max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary">
          <Hammer className="h-6 w-6" aria-hidden />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-primary">
            Build Mode v{stub.version} · Fase {stub.readyPhase} Stub
          </div>
          <h2 className="text-base font-bold text-foreground">Modul Build Mode Baru Siap Dibangun</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Build Mode lama dan kamera bebas telah dihapus bersih. Fondasi grid-tile, kamera miring, Command Undo/Redo, serta tool dinding &amp; lantai akan diaktifkan pada fase berikutnya.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setWorkspace("walk")}
            className="flex min-h-9 items-center gap-1.5 rounded border border-teal-500/40 bg-teal-500/15 px-3 py-1.5 text-xs font-semibold text-teal-200 hover:bg-teal-500/25"
          >
            <Footprints className="h-3.5 w-3.5" aria-hidden /> Buka Stub Walk Mode
          </button>
          <button
            type="button"
            onClick={() => setWorkspace("structure")}
            className="flex min-h-9 items-center gap-1.5 rounded border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden /> Lihat Analisis 3D SNI
          </button>
        </div>
      </div>
    </div>
  );
}
