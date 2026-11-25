"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { ScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
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
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#121417] p-3 sm:p-5">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-card p-4">
          <div className="flex items-center gap-2.5">
            <HardHat className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-base font-bold text-foreground">Mode Lapangan Mandor & Tukang (Site Mode)</h2>
              <p className="text-xs text-muted-foreground">Ringkasan material belanja, besi potong, dan checklist QC siap pakai di HP/Tablet.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="no-print flex h-10 items-center gap-1.5 rounded bg-primary px-4 text-xs font-bold text-primary-foreground"
          >
            <Printer className="h-4 w-4" /> Cetak Checklist
          </button>
        </div>

        {/* Big High-Contrast Material Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BigCard label="Bata Beli (+Waste)" value={`${fmtNum(derived.masonry.totalBuyBricks)} bh`} sub={derived.project.systems.brick.name.split("(")[0]!} />
          <BigCard
            label={derived.project.systems.brick.mortarKind === "thinbed" ? "Perekat Thinbed" : "Semen Pasangan"}
            value={derived.project.systems.brick.mortarKind === "thinbed" ? `${fmtNum(derived.masonry.thinbedZak40kg)} zak` : `${fmtNum(derived.masonry.cementZak50kg)} zak`}
            sub={`Nat ${derived.project.systems.brick.mortarMm} mm`}
          />
          <BigCard label="Total Beton K-250" value={`${fmtNum(struct.concreteVolumes.totalConcreteM3, 1)} m³`} sub={derived.project.systems.foundation} />
          <BigCard label="Total Besi Tulangan" value={`${fmtNum(struct.totalRebarKg, 0)} kg`} sub={`${struct.bbs.length} ukuran potong`} />
        </div>

        {/* Touch-friendly Stage Progress + QC Checklists */}
        <div className="space-y-3">
          {schedule.stages.map((st) => (
            <div key={st.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-foreground">{st.order}. {st.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">Jadwal H+{st.startDay} s.d. H+{st.endDay} ({st.durationDays} hari)</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-primary">{st.progressPct}%</span>
                  <button
                    type="button"
                    onClick={() => patchStageProgress(st.id, { progressPct: st.progressPct >= 100 ? 0 : 100 })}
                    className="h-9 rounded border border-border bg-secondary px-3 text-xs font-bold hover:border-primary"
                  >
                    {st.progressPct >= 100 ? "Selesai ✓" : "Tandai 100%"}
                  </button>
                </div>
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
                      className="flex min-h-11 w-full items-center gap-3 rounded border border-border bg-secondary/40 px-3 py-2 text-left text-xs hover:border-primary"
                    >
                      {checked ? <CheckSquare className="h-5 w-5 shrink-0 text-emerald-400" /> : <Square className="h-5 w-5 shrink-0 text-muted-foreground" />}
                      <span className={checked ? "line-through text-muted-foreground" : "text-foreground"}>{q}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BigCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold text-primary">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
