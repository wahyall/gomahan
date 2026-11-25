"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BookOpen,
  Box,
  CalendarRange,
  ChevronDown,
  ClipboardCheck,
  CloudRain,
  Download,
  DraftingCompass,
  FileSpreadsheet,
  FolderOpen,
  Footprints,
  Hammer,
  HardHat,
  MoreHorizontal,
  Redo2,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Undo2,
  Volume2,
  VolumeX,
  Wind,
} from "lucide-react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { useStore } from "zustand";
import { useStudioStore, type WorkspaceId } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface WorkspaceNavItem {
  id: WorkspaceId;
  label: string;
  short: string;
  group: "desain" | "simulasi" | "dokumen";
  icon: React.ElementType;
}

const WORKSPACES: WorkspaceNavItem[] = [
  { id: "build", label: "Build Mode", short: "Build", group: "desain", icon: Hammer },
  { id: "walk", label: "Walk Mode", short: "Walk", group: "desain", icon: Footprints },
  { id: "structure", label: "Struktur", short: "Struktur", group: "simulasi", icon: ShieldCheck },
  { id: "lighting", label: "Cahaya", short: "Cahaya", group: "simulasi", icon: Sun },
  { id: "airflow", label: "Udara", short: "Udara", group: "simulasi", icon: Wind },
  { id: "flood", label: "Banjir", short: "Banjir", group: "simulasi", icon: CloudRain },
  { id: "drawings", label: "Denah 2D", short: "Denah", group: "dokumen", icon: DraftingCompass },
  { id: "rab", label: "RAB", short: "RAB", group: "dokumen", icon: FileSpreadsheet },
  { id: "timeline", label: "Jadwal", short: "Jadwal", group: "dokumen", icon: CalendarRange },
  { id: "site", label: "Lapangan", short: "Site", group: "dokumen", icon: HardHat },
  { id: "deliver", label: "Ekspor", short: "Ekspor", group: "dokumen", icon: Download },
  { id: "guide", label: "Panduan", short: "Panduan", group: "dokumen", icon: BookOpen },
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

  const canUndo = useStore(useStudioStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useStudioStore.temporal, (s) => s.futureStates.length > 0);

  return (
    <header className="no-print flex shrink-0 flex-col border-b border-border bg-[#0f1216]">
      {/* Primary Row: Brand + Grouped Segmented Dock + Global Actions */}
      <div className="flex h-11 items-center justify-between gap-2.5 px-3 sm:h-12 [@media(max-height:480px)]:h-9">
        {/* Brand Identity */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#e28a48] to-[#b9662a] text-[#170f07] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_6px_rgba(0,0,0,0.4)]">
            <Box className="h-4 w-4 stroke-[2.2]" aria-hidden />
          </div>
          <div className="leading-none">
            <div className="text-[13px] font-bold tracking-tight text-foreground">Rumah Studio</div>
            <div className="mt-0.5 hidden font-mono text-[10px] text-muted-foreground sm:block">5×17 m · Surabaya SNI</div>
          </div>
        </div>

        {/* Desktop Segmented Field Navigation Dock */}
        <nav
          className="mx-1 hidden min-w-0 flex-1 items-center justify-center lg:flex"
          aria-label="Ruang kerja utama"
        >
          <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#161a21] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            {WORKSPACES.map((w, idx) => {
              const Icon = w.icon;
              const active = workspace === w.id;
              const prevGroup = idx > 0 ? WORKSPACES[idx - 1]!.group : w.group;
              return (
                <div key={w.id} className="flex shrink-0 items-center">
                  {idx > 0 && prevGroup !== w.group && (
                    <span className="mx-0.5 h-4 w-px shrink-0 bg-white/[0.1] xl:mx-1" aria-hidden />
                  )}
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setWorkspace(w.id)}
                    className={cn(
                      "flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium transition-all duration-150 active:scale-[0.98] 2xl:gap-1.5 2xl:px-2.5",
                      active
                        ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                        : "text-[#98a1ae] hover:bg-white/[0.06] hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("hidden h-3.5 w-3.5 shrink-0 xl:inline-block", active ? "text-[#b9662a]" : "opacity-80")} aria-hidden />
                    <span className="hidden 2xl:inline">{w.label}</span>
                    <span className="2xl:hidden">{w.short}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Right Utility Cluster */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Undo / Redo Pair */}
          <div className="flex items-center rounded-lg border border-border bg-[#161a21] p-0.5">
            <button
              type="button"
              onClick={() => useStudioStore.temporal.getState().undo()}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo (Ctrl+Z)"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground disabled:opacity-30 sm:h-7 sm:w-7"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => useStudioStore.temporal.getState().redo()}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo (Ctrl+Shift+Z)"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/[0.07] hover:text-foreground disabled:opacity-30 sm:h-7 sm:w-7"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Command Palette Trigger */}
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            title="Cari perintah cepat (Ctrl+K)"
            aria-label="Buka Command Palette"
            className="flex h-8 w-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-[#161a21] text-[11px] font-medium text-muted-foreground transition hover:border-white/20 hover:text-foreground 2xl:w-auto 2xl:px-2"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden font-mono text-[10px] 2xl:inline">Ctrl+K</span>
          </button>

          {/* Ringkas / Pro Switch */}
          <div className="flex rounded-lg border border-border bg-[#161a21] p-0.5 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setMode("simple")}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md px-2 transition",
                mode === "simple" ? "bg-primary font-semibold text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              title="Mode Ringkas (Skor & Anggaran Aktif)"
            >
              <Sparkles className="h-3 w-3" />
              <span className="hidden sm:inline">Ringkas</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("pro")}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md px-2 transition",
                mode === "pro" ? "bg-primary font-semibold text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              title="Mode Pro (Parameter Teknis Penuh)"
            >
              <SlidersHorizontal className="h-3 w-3" />
              <span className="hidden sm:inline">Pro</span>
            </button>
          </div>

          {/* Unified Project Actions Menu (replaces 5 cramped mystery icon buttons) */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Menu file dan pengaturan proyek"
                className="flex h-8 items-center gap-1 rounded-lg border border-border bg-[#161a21] px-2.5 text-[11px] font-medium text-foreground transition hover:border-white/20 hover:bg-[#1d222b]"
              >
                <MoreHorizontal className="h-3.5 w-3.5 sm:hidden" />
                <span className="hidden sm:inline">Proyek</span>
                <ChevronDown className="hidden h-3 w-3 text-muted-foreground sm:inline" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="studio-glass z-50 min-w-[215px] rounded-xl p-1.5 text-xs text-foreground"
              >
                <DropdownMenu.Item
                  onSelect={onSaveSnapshot}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                >
                  <Save className="h-3.5 w-3.5 text-primary" />
                  <span>Simpan Snapshot Lokal</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={onImportJson}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-sky-400" />
                  <span>Buka File Proyek JSON...</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={onExportJson}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                >
                  <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Unduh Backup JSON</span>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-white/[0.08]" />
                <DropdownMenu.Item
                  onSelect={() => setSoundEnabled(!soundEnabled)}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                >
                  <span className="flex items-center gap-2">
                    {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-primary" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span>Efek Suara Studio</span>
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{soundEnabled ? "ON" : "OFF"}</span>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-white/[0.08]" />
                <DropdownMenu.Item
                  onSelect={resetProject}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-rose-300 outline-none transition hover:bg-rose-500/15 focus:bg-rose-500/15"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset ke Desain Awal 5×17</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Live RAB Budget Chip (2xl shows full amount cleanly; xl shows compact status) */}
          <button
            type="button"
            onClick={() => setWorkspace("rab")}
            className={cn(
              "hidden h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-left leading-none transition hover:brightness-110 active:scale-[0.98] xl:flex",
              rab.overBudget ? "border-rose-500/35 bg-rose-500/10" : "border-emerald-500/30 bg-emerald-500/10",
            )}
            title={`Target Anggaran: ${fmtRp(rab.budgetCapIdr)} | Luas Bersih: ${fmtNum(derived.totalNetFloorM2, 1)} m²`}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", rab.overBudget ? "bg-rose-400" : "bg-emerald-400")} />
            <div>
              <div className="text-[9.5px] font-medium text-muted-foreground">RAB {rab.overBudget ? "Over" : "Aman"}</div>
              <div className={cn("font-mono text-[11px] font-bold tabular-nums", rab.overBudget ? "text-rose-200" : "text-emerald-200")}>
                <span className="hidden 2xl:inline">{fmtRp(rab.grandTotal)}</span>
                <span className="2xl:hidden">Rp {Math.round(rab.grandTotal / 1_000_000)}jt</span>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Mobile / Tablet Scrollable Workspace Strip (< lg, comfortable tap targets) */}
      <nav
        className="no-scrollbar flex h-10 items-center gap-1 overflow-x-auto border-t border-white/[0.06] bg-[#13171d] px-2.5 lg:hidden [@media(max-height:480px)]:h-8"
        aria-label="Navigasi ruang kerja mobile"
      >
        {WORKSPACES.map((w, idx) => {
          const Icon = w.icon;
          const active = workspace === w.id;
          const prevGroup = idx > 0 ? WORKSPACES[idx - 1]!.group : w.group;
          return (
            <div key={w.id} className="flex shrink-0 items-center">
              {idx > 0 && prevGroup !== w.group && (
                <span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />
              )}
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setWorkspace(w.id)}
                className={cn(
                  "flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors",
                  active
                    ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[#b9662a]" : "opacity-80")} aria-hidden />
                <span>{w.short}</span>
              </button>
            </div>
          );
        })}
      </nav>
    </header>
  );
}
