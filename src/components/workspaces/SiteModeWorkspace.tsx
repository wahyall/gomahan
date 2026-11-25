"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { ScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { KpiMetric, SectionHeader, StudioCard } from "@/components/ui/StudioPrimitives";
import { CheckSquare, HardHat, Printer, Square } from "lucide-react";

export function SiteModeWorkspace({
  derived,
  struct,
  schedule,
}: {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  schedule: ScheduleSummary;
}) {
  const project = useStudioStore((s) => s.project);
  const toggleSiteChecklist = useStudioStore((s) => s.toggleSiteChecklist);
  const patchStageProgress = useStudioStore((s) => s.patchStageProgress);
  const doneMap = project.gamification.siteChecklistDone;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#111418] p-4 sm:p-5">
      <div className="mx-auto max-w-4xl space-y-4">
        <StudioCard highlight>
          <SectionHeader
            icon={<HardHat className="h-5 w-5 text-primary" />}
            title="Mode Lapangan Mandor & Tukang (Site Mode)"
            subtitle="Ringkasan belanja material, panjang besi, dan checklist inspeksi mutu QC siap sentuh di tablet atau ponsel proyek."
            action={
              <button
                type="button"
                onClick={() => window.print()}
                className="no-print flex h-10 items-center gap-1.5 rounded-xl bg-[#f2efe8] px-4 text-xs font-semibold text-[#14171c] shadow-sm hover:brightness-95"
              >
                <Printer className="h-4 w-4 text-[#b9662a]" /> Cetak Checklist
              </button>
            }
          />
        </StudioCard>

        {/* High-Contrast Material Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiMetric
            label="Bata Beli (+Waste)"
            value={`${fmtNum(derived.masonry.totalBuyBricks)} bh`}
            tone="primary"
            sub={derived.project.systems.brick.name.split("(")[0]!}
          />
          <KpiMetric
            label={derived.project.systems.brick.mortarKind === "thinbed" ? "Perekat Thinbed" : "Semen Pasangan"}
            value={
              derived.project.systems.brick.mortarKind === "thinbed"
                ? `${fmtNum(derived.masonry.thinbedZak40kg)} zak`
                : `${fmtNum(derived.masonry.cementZak50kg)} zak`
            }
            tone="primary"
            sub={`Nat ${derived.project.systems.brick.mortarMm} mm`}
          />
          <KpiMetric
            label="Total Beton K-250"
            value={`${fmtNum(struct.concreteVolumes.totalConcreteM3, 1)} m³`}
            tone="primary"
            sub={derived.project.systems.foundation}
          />
          <KpiMetric
            label="Total Besi Tulangan"
            value={`${fmtNum(struct.totalRebarKg, 0)} kg`}
            tone="primary"
            sub={`${struct.bbs.length} ukuran potong`}
          />
        </div>

        {/* Touch-friendly Stage Progress + QC Checklists */}
        <div className="space-y-3">
          {schedule.stages.map((st) => {
            const doneChecks = st.qcChecklist.filter((_, qi) => Boolean(doneMap[`${st.id}-${qi}`])).length;
            return (
              <StudioCard key={st.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-foreground">{st.order}. {st.name}</div>
                    <div className="font-mono text-xs text-muted-foreground tabular-nums">
                      Jadwal H+{st.startDay} s.d. H+{st.endDay} ({st.durationDays} hari) · QC {doneChecks}/{st.qcChecklist.length}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-primary tabular-nums">{st.progressPct}%</span>
                    <button
                      type="button"
                      onClick={() => patchStageProgress(st.id, { progressPct: st.progressPct >= 100 ? 0 : 100 })}
                      className={cn(
                        "h-9 rounded-xl border px-3 text-xs font-semibold transition",
                        st.progressPct >= 100
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                          : "border-border bg-black/25 text-foreground hover:border-primary",
                      )}
                    >
                      {st.progressPct >= 100 ? "Selesai ✓" : "Tandai 100%"}
                    </button>
                  </div>
                </div>

                <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${st.progressPct}%` }} />
                </div>

                <div className="space-y-1.5">
                  {st.qcChecklist.map((q, qi) => {
                    const key = `${st.id}-${qi}`;
                    const checked = Boolean(doneMap[key]);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleSiteChecklist(key)}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-xs transition active:scale-[0.995]",
                          checked
                            ? "border-emerald-500/25 bg-emerald-500/[0.06] text-muted-foreground"
                            : "border-border bg-black/25 text-foreground hover:border-primary/60",
                        )}
                      >
                        {checked ? <CheckSquare className="h-5 w-5 shrink-0 text-emerald-400" /> : <Square className="h-5 w-5 shrink-0 text-muted-foreground" />}
                        <span className={checked ? "line-through" : "font-medium"}>{q}</span>
                      </button>
                    );
                  })}
                </div>
              </StudioCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}
