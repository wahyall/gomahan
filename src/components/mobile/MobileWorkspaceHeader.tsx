"use client";

import { Download, DraftingCompass, FileSpreadsheet, Menu, Redo2, Search, Undo2 } from "lucide-react";
import { useStore } from "zustand";
import { useStudioStore, type WorkspaceId } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";

interface MobileWorkspaceHeaderProps {
  onOpenProjectMenu: () => void;
}

const DOC_SUB_TABS: { id: WorkspaceId; label: string; icon: React.ElementType }[] = [
  { id: "rab", label: "RAB", icon: FileSpreadsheet },
  { id: "drawings", label: "Denah 2D", icon: DraftingCompass },
  { id: "deliver", label: "Ekspor", icon: Download },
];

export function MobileWorkspaceHeader({ onOpenProjectMenu }: MobileWorkspaceHeaderProps) {
  const workspace = useStudioStore((s) => s.workspace);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);

  const canUndo = useStore(useStudioStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useStudioStore.temporal, (s) => s.futureStates.length > 0);

  const isDocGroup = workspace === "rab" || workspace === "drawings" || workspace === "deliver";

  return (
    <header className="no-print shrink-0 border-b border-border bg-[#0f1216] px-2.5 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenProjectMenu}
          aria-label="Menu Proyek"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-[#161a21] text-foreground active:scale-[0.96]"
        >
          <Menu className="h-4 w-4 text-primary" />
        </button>

        {isDocGroup ? (
          <div className="flex flex-1 items-center gap-1 rounded-xl border border-white/10 bg-[#161a21] p-1">
            {DOC_SUB_TABS.map((t) => {
              const Icon = t.icon;
              const active = workspace === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setWorkspace(t.id)}
                  className={cn(
                    "flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold transition",
                    active ? "bg-[#f2efe8] text-[#14171c] shadow-sm" : "text-muted-foreground",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[#b9662a]" : "opacity-80")} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-sm font-bold text-foreground">Mode Lapangan &amp; Jadwal</div>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Cari cepat"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-[#161a21] text-foreground active:scale-[0.96]"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canUndo}
            onClick={() => useStudioStore.temporal.getState().undo()}
            aria-label="Undo"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-[#161a21] text-foreground disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={() => useStudioStore.temporal.getState().redo()}
            aria-label="Redo"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-[#161a21] text-foreground disabled:opacity-30"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
