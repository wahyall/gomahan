"use client";

import type { ReactNode } from "react";
import {
  BookOpen,
  Box,
  ClipboardCheck,
  CloudRain,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Hammer,
  HardHat,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sofa,
  Sparkles,
  Sun,
  Undo2,
  Redo2,
  Volume2,
  VolumeX,
  Wind,
  DraftingCompass,
  CalendarRange,
} from "lucide-react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { useStudioStore, type WorkspaceId } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const WORKSPACES: { id: WorkspaceId; label: string; short: string; icon: React.ElementType }[] = [
  { id: "build", label: "Build", short: "Build", icon: Hammer },
  { id: "furnish", label: "Furnish", short: "Furnish", icon: Sofa },
  { id: "structure", label: "Struktur", short: "Struktur", icon: ShieldCheck },
  { id: "lighting", label: "Cahaya", short: "Cahaya", icon: Sun },
  { id: "airflow", label: "Udara", short: "Udara", icon: Wind },
  { id: "flood", label: "Hujan & Banjir", short: "Banjir", icon: CloudRain },
  { id: "drawings", label: "Gambar Kerja", short: "Gambar", icon: DraftingCompass },
  { id: "rab", label: "RAB", short: "RAB", icon: FileSpreadsheet },
  { id: "timeline", label: "Timeline", short: "Jadwal", icon: CalendarRange },
  { id: "deliver", label: "Deliver", short: "Export", icon: Download },
  { id: "site", label: "Site Mode", short: "Lapangan", icon: HardHat },
  { id: "guide", label: "Panduan", short: "Panduan", icon: BookOpen },
];

interface TopBarProps {
  derived: DerivedProjectModel;
  rab: RabSummary;
  onExportJson: () => void;
  onImportJson: () => void;
  onSaveSnapshot: () => void;
}

export function TopBar({ derived, rab, onExportJson, onImportJson, onSaveSnapshot }: TopBarProps) {
  const workspace = useStudioStore((s) => s.workspace);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const mode = useStudioStore((s) => s.project.gamification.mode);
  const setMode = useStudioStore((s) => s.setGamificationMode);
  const soundEnabled = useStudioStore((s) => s.project.gamification.soundEnabled);
  const setSoundEnabled = useStudioStore((s) => s.setSoundEnabled);
  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const resetProject = useStudioStore((s) => s.resetProject);

  const canUndo = useStudioStore.temporal.getState().pastStates.length > 0;
  const canRedo = useStudioStore.temporal.getState().futureStates.length > 0;

  return (
    <header className="no-print flex h-12 shrink-0 items-center gap-2 border-b border-border bg-[#131519] px-2.5">
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
          <Box className="h-4 w-4" aria-hidden />
        </div>
        <div className="hidden leading-none xl:block">
          <div className="text-[13px] font-bold tracking-tight text-foreground">Rumah Studio 5×17</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">2 Lantai · 3 KT · Surabaya SNI</div>
        </div>
      </div>

      {/* Workspace Tabs */}
      <nav className="mx-1 flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto" aria-label="Ruang kerja utama">
        {WORKSPACES.map((w) => {
          const Icon = w.icon;
          const active = workspace === w.id;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => setWorkspace(w.id)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2 text-[11.5px] font-medium transition-colors",
                active
                  ? "border-primary bg-card/80 text-primary"
                  : "border-transparent text-muted-foreground hover:bg-card/40 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden 2xl:inline">{w.label}</span>
              <span className="2xl:hidden">{w.short}</span>
            </button>
          );
        })}
      </nav>

      {/* Quick Actions & Simple/Pro Switch */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => useStudioStore.temporal.getState().undo()}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-35"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => useStudioStore.temporal.getState().redo()}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-35"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          title="Command Palette (Ctrl+K)"
          className="hidden h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] text-muted-foreground hover:text-foreground sm:flex"
        >
          <Search className="h-3 w-3" />
          <span>Ctrl+K</span>
        </button>

        <div className="flex rounded border border-border bg-card p-0.5 text-[10.5px] font-semibold">
          <button
            type="button"
            onClick={() => setMode("simple")}
            className={cn(
              "flex items-center gap-1 rounded-sm px-2 py-0.5 transition",
              mode === "simple" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            title="Mode Simpel / Sims 4 (Gamifikasi Aktif)"
          >
            <Sparkles className="h-3 w-3" /> Sims
          </button>
          <button
            type="button"
            onClick={() => setMode("pro")}
            className={cn(
              "flex items-center gap-1 rounded-sm px-2 py-0.5 transition",
              mode === "pro" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            title="Mode Pro (Parameter Teknis Penuh)"
          >
            <SlidersHorizontal className="h-3 w-3" /> Pro
          </button>
        </div>

        <TopIconBtn onClick={() => setSoundEnabled(!soundEnabled)} title={soundEnabled ? "Matikan SFX Sims" : "Nyalakan SFX Sims"}>
          {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </TopIconBtn>
        <TopIconBtn onClick={onSaveSnapshot} title="Simpan Versi Snapshot Lokal">
          <Save className="h-3.5 w-3.5" />
        </TopIconBtn>
        <TopIconBtn onClick={onImportJson} title="Buka Proyek JSON">
          <FolderOpen className="h-3.5 w-3.5" />
        </TopIconBtn>
        <TopIconBtn onClick={onExportJson} title="Simpan Proyek JSON Backup">
          <ClipboardCheck className="h-3.5 w-3.5" />
        </TopIconBtn>
        <TopIconBtn onClick={resetProject} title="Reset ke Template 5×17 Default">
          <RotateCcw className="h-3.5 w-3.5" />
        </TopIconBtn>

        {/* Live Budget Pill */}
        <div
          onClick={() => setWorkspace("rab")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setWorkspace("rab")}
          className={cn(
            "hidden cursor-pointer rounded border px-2 py-0.5 text-right leading-none lg:block",
            rab.overBudget ? "border-red-500/40 bg-red-500/10" : "border-emerald-500/40 bg-emerald-500/10",
          )}
          title={`Target Anggaran: ${fmtRp(rab.budgetCapIdr)} | Luas Bersih: ${fmtNum(derived.totalNetFloorM2, 1)} m²`}
        >
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            RAB {rab.overBudget ? "Over Budget" : "Aman"}
          </div>
          <div className={cn("mt-0.5 font-mono text-[11px] font-bold tabular-nums", rab.overBudget ? "text-red-300" : "text-emerald-300")}>
            {fmtRp(rab.grandTotal)}
          </div>
        </div>
      </div>
    </header>
  );
}

function TopIconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 items-center justify-center rounded border border-border bg-card text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
    >
      {children}
    </button>
  );
}
