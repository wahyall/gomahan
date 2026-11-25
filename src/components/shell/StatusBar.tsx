"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { GamificationEvaluation } from "@/lib/gamification/simsEngine";
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
  gamification: GamificationEvaluation;
  saveStatus: "idle" | "saving" | "saved";
}

export function StatusBar({
  derived,
  struct,
  rab,
  lighting,
  airflow,
  flood,
  gamification,
  saveStatus,
}: StatusBarProps) {
  const selected = useStudioStore((s) => s.selected);
  const view = useStudioStore((s) => s.view);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const criticalCount = derived.validation.filter((v) => v.severity === "critical").length;
  const warnCount = derived.validation.filter((v) => v.severity === "warning").length;

  const selectedLabel = selected
    ? selected.kind === "part"
      ? `Elemen: ${selected.id}`
      : `${selected.kind.toUpperCase()} (${selected.id})`
    : "Tidak ada seleksi";

  const floodDanger = flood.lt1FloorFloodCm > 0 || flood.electricalHazardMcb || flood.electricalHazardOutlets;
  const floodCaution = !floodDanger && (flood.carportFloodCm > 0 || flood.gutterOverflowRisk);
  const unlockedBadges = gamification.badges.filter((b) => b.unlocked).length;

  return (
    <footer className="no-print flex h-7 shrink-0 items-center justify-between gap-2 overflow-x-auto border-t border-border bg-[#121417] px-2.5 text-[10.5px] text-muted-foreground">
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Ruler className="h-3 w-3 text-primary" />
          Tapak {derived.totalLotAreaM2} m² · Bersih {fmtNum(derived.totalNetFloorM2, 1)} m²
          <span className="text-muted-foreground">(-{fmtNum(derived.totalWallDeductionM2, 2)} m² bata)</span>
        </span>
        <span className="hidden items-center gap-1 md:flex" title="Kebutuhan beli bata utuh (+waste) dan jumlah keping terpasang termasuk potongan">
          <BrickWall className="h-3 w-3 text-amber-400" />
          Beli {fmtNum(derived.masonry.totalBuyBricks)} bata (pasang {fmtNum(derived.masonry.totalPiecesPlaced)} kpg · {derived.project.systems.brick.lengthMm}×{derived.project.systems.brick.heightMm}×{derived.project.systems.brick.depthMm} mm)
        </span>
        <span className="hidden items-center gap-1 lg:flex">
          <Layers className="h-3 w-3 text-sky-400" />
          {selectedLabel}
          {view.ortho ? " · Ortho" : " · Persp"}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => setWorkspace("lighting")}
          className="hidden items-center gap-1 hover:text-foreground sm:flex"
          title="Ringkasan pencahayaan Surabaya"
        >
          <Sun className="h-3 w-3 text-amber-300" />
          {Math.round(lighting.avgHouseLux)} lux ({Math.round(lighting.sniCompliancePct)}%)
        </button>

        <button
          type="button"
          onClick={() => setWorkspace("airflow")}
          className="hidden items-center gap-1 hover:text-foreground sm:flex"
          title="Aliran udara & beban daya HVAC"
        >
          <Wind className="h-3 w-3 text-teal-400" />
          {fmtNum(airflow.avgAch, 1)} ACH · {(airflow.totalHvacPowerW / 1000).toFixed(2)} kW
        </button>

        <button
          type="button"
          onClick={() => setWorkspace("flood")}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-foreground",
            floodDanger && "bg-red-500/20 text-red-300",
            floodCaution && "bg-amber-500/20 text-amber-300",
          )}
          title="Status banjir Surabaya & listrik PUIL"
        >
          {flood.streetFloodCm > 0 ? <Droplets className="h-3 w-3 text-cyan-400" /> : <CloudRain className="h-3 w-3 text-slate-400" />}
          Banjir {flood.streetFloodCm}cm ({flood.lt1FloorFloodCm > 0 ? `Masuk ${fmtNum(flood.lt1FloorFloodCm, 0)}cm!` : "Aman"})
        </button>

        <button
          type="button"
          onClick={() => setWorkspace("structure")}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5",
            struct.overallSafe && criticalCount === 0 ? "text-emerald-400" : "bg-red-500/15 text-red-300",
          )}
        >
          {criticalCount > 0 || !struct.overallSafe ? <ShieldAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3 opacity-60" />}
          {criticalCount > 0 ? `${criticalCount} Kritis` : warnCount > 0 ? `${warnCount} Catatan` : "SNI OK"}
        </button>

        <button
          type="button"
          onClick={() => setWorkspace("rab")}
          className={cn(
            "font-mono font-bold",
            rab.overBudget ? "text-red-400" : "text-emerald-400",
          )}
        >
          {fmtRp(rab.grandTotal)}
        </button>

        <span className="hidden rounded bg-secondary px-1.5 py-0.5 font-semibold text-primary xl:inline">
          Skor {gamification.overallComfortScore}/100 · {unlockedBadges}/{gamification.badges.length} Lencana
        </span>

        <span className="text-[10px] text-muted-foreground">
          {saveStatus === "saving" ? "Menyimpan..." : saveStatus === "saved" ? "Tersimpan lokal" : "Siap"}
        </span>
      </div>
    </footer>
  );
}
