"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, BrickWall, CloudRain, Droplets, Layers, Ruler, ShieldAlert, Sun, Wind } from "lucide-react";

interface StatusBarProps {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  rab: RabSummary;
  lighting: LightingSimulationResult;
  airflow: AirflowSimulationResult;
  flood: FloodSimulationResult;
  saveStatus: "idle" | "saving" | "saved";
}

export function StatusBar({
  derived,
  struct,
  rab,
  lighting,
  airflow,
  flood,
  saveStatus,
}: StatusBarProps) {
  const selected = useStudioStore((s) => s.selected);
  const view = useStudioStore((s) => s.view);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const openBuildPanel = useStudioStore((s) => s.openBuildPanel);
  const criticalCount = derived.validation.filter((v) => v.severity === "critical").length;
  const warnCount = derived.validation.filter((v) => v.severity === "warning").length;

  const selectedLabel = selected
    ? selected.kind === "part"
      ? `Elemen: ${selected.id}`
      : `${selected.kind.toUpperCase()} · ${selected.id}`
    : "Siap pilih objek";

  const floodDanger = flood.lt1FloorFloodCm > 0 || flood.electricalHazardMcb || flood.electricalHazardOutlets;
  const floodCaution = !floodDanger && (flood.carportFloodCm > 0 || flood.gutterOverflowRisk);
  const hasCriticalOrStructIssue = criticalCount > 0 || !struct.overallSafe;

  return (
    <footer className="no-print flex h-7 shrink-0 items-center justify-between gap-2 overflow-x-auto border-t border-border bg-[#0f1216] px-2.5 text-[10.5px] text-muted-foreground sm:px-3">
      <div className="flex shrink-0 items-center gap-2 sm:gap-3 tabular-nums">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Ruler className="h-3 w-3 shrink-0 text-primary" />
          <span className="hidden sm:inline">{derived.totalLotAreaM2} m² Tapak ·</span>
          <span>{fmtNum(derived.totalNetFloorM2, 1)} m²</span>
        </span>
        <span className="hidden items-center gap-1 md:flex" title="Kebutuhan beli bata utuh (+waste) dan jumlah keping terpasang">
          <BrickWall className="h-3 w-3 text-amber-400" />
          <span>{fmtNum(derived.masonry.totalBuyBricks)} bata</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            ({derived.project.systems.brick.lengthMm}×{derived.project.systems.brick.heightMm} mm)
          </span>
        </span>
        <span className="hidden items-center gap-1 lg:flex">
          <Layers className="h-3 w-3 text-sky-400" />
          <span className="max-w-[170px] truncate">{selectedLabel}</span>
          <span className="text-muted-foreground">· {view.ortho ? "Orto" : "Persp"}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 tabular-nums">
        <button
          type="button"
          onClick={() => openBuildPanel("lighting")}
          className="hidden items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-white/[0.06] hover:text-foreground sm:flex"
          title="Buka panel analisis pencahayaan Surabaya"
        >
          <Sun className="h-3 w-3 text-amber-300" />
          <span className="font-mono">{Math.round(lighting.avgHouseLux)} lx</span>
          <span className="text-muted-foreground">({Math.round(lighting.sniCompliancePct)}%)</span>
        </button>

        <button
          type="button"
          onClick={() => openBuildPanel("airflow")}
          className="hidden items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-white/[0.06] hover:text-foreground sm:flex"
          title="Buka panel simulasi aliran udara & HVAC"
        >
          <Wind className="h-3 w-3 text-teal-400" />
          <span className="font-mono">{fmtNum(airflow.avgAch, 1)} ACH</span>
        </button>

        <button
          type="button"
          onClick={() => openBuildPanel("flood")}
          className={cn(
            "hidden items-center gap-1 rounded px-1.5 py-0.5 transition hover:text-foreground sm:flex",
            floodDanger ? "bg-rose-500/20 text-rose-200" : floodCaution ? "bg-amber-500/20 text-amber-200" : "hover:bg-white/[0.06]",
          )}
          title="Status ketinggian banjir & keamanan PUIL"
        >
          {flood.streetFloodCm > 0 ? <Droplets className="h-3 w-3 text-cyan-400" /> : <CloudRain className="h-3 w-3 text-slate-400" />}
          <span>Banjir {flood.streetFloodCm}cm</span>
        </button>

        <button
          type="button"
          onClick={() => openBuildPanel("structure")}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 transition",
            hasCriticalOrStructIssue
              ? "bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
              : warnCount > 0
                ? "bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                : "text-emerald-300 hover:bg-emerald-500/10",
          )}
        >
          {hasCriticalOrStructIssue ? (
            <ShieldAlert className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3 opacity-75" />
          )}
          <span>
            {criticalCount > 0
              ? `${criticalCount} Kritis`
              : !struct.overallSafe
                ? "Cek Struktur"
                : warnCount > 0
                  ? `${warnCount} Catatan`
                  : "SNI Aman"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setWorkspace("rab")}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono font-bold transition hover:bg-white/[0.06]",
            rab.overBudget ? "text-rose-300" : "text-emerald-300",
          )}
        >
          <span className="hidden sm:inline">{fmtRp(rab.grandTotal)}</span>
          <span className="sm:hidden">Rp {Math.round(rab.grandTotal / 1_000_000)}jt</span>
        </button>

        <span className="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              saveStatus === "saving" ? "bg-amber-400" : saveStatus === "saved" ? "bg-emerald-400" : "bg-zinc-500",
            )}
          />
          {saveStatus === "saving" ? "Menyimpan..." : saveStatus === "saved" ? "Tersimpan" : "Siap"}
        </span>
      </div>
    </footer>
  );
}
