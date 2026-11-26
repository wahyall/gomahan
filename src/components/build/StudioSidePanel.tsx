"use client";

import dynamic from "next/dynamic";
import {
  CloudRain,
  Eye,
  EyeOff,
  Landmark,
  Layers,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Wind,
  X,
} from "lucide-react";
import { StudioRange } from "@/components/ui/StudioPrimitives";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { CUT_PLANE_MAX_M, CUT_PLANE_MIN_M, CUT_PLANE_OFF } from "@/lib/model/constants";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import { useStudioStore, type StudioPanelId } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { cn } from "@/lib/utils";

const InspectorPanel = dynamic(() => import("@/components/panels/InspectorPanel").then((m) => m.InspectorPanel), { ssr: false });
const OutlinerPanel = dynamic(() => import("@/components/panels/OutlinerPanel").then((m) => m.OutlinerPanel), { ssr: false });
const AirflowWorkspace = dynamic(() => import("@/components/workspaces/AirflowWorkspace").then((m) => m.AirflowWorkspace), { ssr: false });
const FloodWorkspace = dynamic(() => import("@/components/workspaces/FloodWorkspace").then((m) => m.FloodWorkspace), { ssr: false });
const LightingWorkspace = dynamic(() => import("@/components/workspaces/LightingWorkspace").then((m) => m.LightingWorkspace), { ssr: false });
const StructureWorkspace = dynamic(() => import("@/components/workspaces/StructureWorkspace").then((m) => m.StructureWorkspace), { ssr: false });

interface StudioSidePanelProps {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  lighting: LightingSimulationResult;
  airflow: AirflowSimulationResult;
  flood: FloodSimulationResult;
  onFocusFoundation: () => void;
}

const PANEL_TABS: { id: Exclude<StudioPanelId, "none">; label: string; icon: React.ElementType }[] = [
  { id: "structure", label: "Struktur", icon: ShieldCheck },
  { id: "lighting", label: "Cahaya", icon: Sun },
  { id: "airflow", label: "Udara", icon: Wind },
  { id: "flood", label: "Banjir", icon: CloudRain },
  { id: "inspection", label: "Inspeksi", icon: SlidersHorizontal },
];

export function StudioSidePanel({
  derived,
  struct,
  lighting,
  airflow,
  flood,
  onFocusFoundation,
}: StudioSidePanelProps) {
  const studioPanel = useStudioStore((s) => s.studioPanel);
  const setStudioPanel = useStudioStore((s) => s.setStudioPanel);
  const inspectSubTab = useStudioStore((s) => s.inspectSubTab);
  const setInspectSubTab = useStudioStore((s) => s.setInspectSubTab);
  const view = useStudioStore((s) => s.view);
  const patchView = useStudioStore((s) => s.patchView);

  if (studioPanel === "none") return null;

  const criticalCount = derived.validation.filter((v) => v.severity === "critical").length;
  const floodDanger = flood.lt1FloorFloodCm > 0 || flood.electricalHazardMcb || flood.electricalHazardOutlets;

  return (
    <>
      {/* Mobile / tablet dismiss backdrop */}
      <button
        type="button"
        aria-label="Tutup panel overlay"
        onClick={() => setStudioPanel("none")}
        className="fixed inset-0 z-20 bg-black/45 backdrop-blur-[1px] lg:hidden"
      />

      <aside
        aria-label="Panel analisis dan inspeksi teknis"
        className="@container absolute inset-y-0 right-0 z-30 flex w-full max-w-[440px] flex-col border-l border-border bg-[#111418]/98 shadow-2xl backdrop-blur-xl lg:static lg:z-auto lg:w-[440px] lg:max-w-none lg:shrink-0 lg:bg-[#111418] lg:shadow-none xl:w-[500px] 2xl:w-[560px]"
      >
        {/* Unified Segmented Panel Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-[#0f1216] px-2.5 py-2">
          <div className="grid min-w-0 flex-1 grid-cols-5 gap-0.5 rounded-xl border border-white/[0.08] bg-[#161a21] p-0.5">
            {PANEL_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = studioPanel === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStudioPanel(tab.id)}
                  className={cn(
                    "relative flex h-7 items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-medium transition",
                    active
                      ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm"
                      : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[#b9662a]" : "opacity-80")} aria-hidden />
                  <span className="truncate">{tab.label}</span>
                  {tab.id === "structure" && !struct.overallSafe && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
                  )}
                  {tab.id === "flood" && floodDanger && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-hidden />
                  )}
                  {tab.id === "inspection" && criticalCount > 0 && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setStudioPanel("none")}
            aria-label="Tutup panel samping"
            title="Tutup panel samping (Esc)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-[#161a21] text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panel Body */}
        {studioPanel === "structure" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Integrated Structure Mode Viewport Controls (Terrain / Cut Plane / Explode / X-Ray) */}
            <div className="shrink-0 space-y-2.5 border-b border-border bg-[#14181f] px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => patchView({ showTerrain: !view.showTerrain })}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-medium transition",
                    view.showTerrain
                      ? "border-border bg-black/25 text-muted-foreground hover:text-foreground"
                      : "border-amber-400/50 bg-amber-500/20 font-semibold text-amber-200",
                  )}
                  title="Sembunyikan tanah dan urugan untuk melihat pondasi"
                >
                  {view.showTerrain ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  <span>{view.showTerrain ? "Sembunyikan Tanah" : "Tanah Tersembunyi"}</span>
                </button>

                <button
                  type="button"
                  onClick={onFocusFoundation}
                  className="flex h-7 items-center gap-1 rounded-lg border border-primary/40 bg-primary/15 px-2.5 text-[11px] font-semibold text-[#f6ba86] transition hover:bg-primary/25"
                  title="Sembunyikan tanah dan arahkan kamera langsung ke struktur pondasi"
                >
                  <Landmark className="h-3 w-3" />
                  <span>Fokus Pondasi</span>
                </button>

                <button
                  type="button"
                  onClick={() => patchView({ wireframe: !view.wireframe })}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition",
                    view.wireframe
                      ? "border-primary/50 bg-primary/20 text-[#f6ba86]"
                      : "border-border bg-black/25 text-muted-foreground hover:text-foreground",
                  )}
                >
                  Wire
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StudioRange
                  label="Explode (Bongkar)"
                  display={`${Math.round(view.explode * 100)}%`}
                  min={0}
                  max={1}
                  step={0.05}
                  value={view.explode}
                  onChange={(v) => patchView({ explode: v })}
                />
                <StudioRange
                  label="Potong Horizontal"
                  display={view.cutH >= CUT_PLANE_MAX_M - 0.05 ? "Penuh" : `${view.cutH.toFixed(1)} m`}
                  min={CUT_PLANE_MIN_M}
                  max={CUT_PLANE_MAX_M}
                  step={0.1}
                  value={Math.min(CUT_PLANE_MAX_M, view.cutH)}
                  onChange={(v) => patchView({ cutH: v >= CUT_PLANE_MAX_M - 0.05 ? CUT_PLANE_OFF : v })}
                />
              </div>
            </div>

            <StructureWorkspace derived={derived} struct={struct} onFocusFoundation={onFocusFoundation} />
          </div>
        )}

        {studioPanel === "lighting" && <LightingWorkspace lighting={lighting} />}

        {studioPanel === "airflow" && <AirflowWorkspace derived={derived} airflow={airflow} />}

        {studioPanel === "flood" && <FloodWorkspace derived={derived} flood={flood} />}

        {studioPanel === "inspection" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-[#14181f] px-3 py-2">
              <button
                type="button"
                onClick={() => setInspectSubTab("inspector")}
                className={cn(
                  "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium transition",
                  inspectSubTab === "inspector"
                    ? "bg-primary/20 font-semibold text-[#f6ba86] ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Sistem, Bata &amp; Cek ({derived.validation.length})
              </button>
              <button
                type="button"
                onClick={() => setInspectSubTab("outliner")}
                className={cn(
                  "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium transition",
                  inspectSubTab === "outliner"
                    ? "bg-primary/20 font-semibold text-[#f6ba86] ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                )}
              >
                <Layers className="h-3.5 w-3.5" />
                Outliner Layer 3D
              </button>
            </div>

            {inspectSubTab === "inspector" ? (
              <InspectorPanel derived={derived} />
            ) : (
              <OutlinerPanel derived={derived} struct={struct} />
            )}
          </div>
        )}
      </aside>
    </>
  );
}
