"use client";

import { useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { ScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { KpiMetric, SectionHeader, StudioCard, StudioConfirmDialog } from "@/components/ui/StudioPrimitives";
import { CalendarRange, CheckSquare, HardHat, PackageCheck, Printer, RotateCcw, Square, TrendingUp, Users, Wallet } from "lucide-react";

export function TimelineWorkspace({
  derived,
  struct,
  schedule,
}: {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  schedule: ScheduleSummary;
}) {
  const [subMode, setSubMode] = useState<"schedule" | "site">("schedule");
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const project = useStudioStore((s) => s.project);
  const scenario = useStudioStore((s) => s.scheduleScenario);
  const setScenario = useStudioStore((s) => s.setScheduleScenario);
  const patchStageProgress = useStudioStore((s) => s.patchStageProgress);
  const toggleSiteChecklist = useStudioStore((s) => s.toggleSiteChecklist);
  const doneMap = project.siteChecklistDone;

  const maxDay = Math.max(1, schedule.totalDurationDays);
  const maxCum = Math.max(1, ...schedule.weeklyCashFlow.map((w) => w.cumulativePlannedIdr), ...schedule.weeklyCashFlow.map((w) => w.cumulativeActualIdr));
  const peakCrew = Math.max(1, ...schedule.weeklyCashFlow.map((w) => w.peakCrew));

  const resetAllProgress = () => {
    for (const st of schedule.stages) {
      patchStageProgress(st.id, { progressPct: 0, actualCost: 0 });
    }
    setConfirmResetOpen(false);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <StudioCard>
          <SectionHeader
            icon={subMode === "site" ? <HardHat className="h-4 w-4 text-primary" /> : <CalendarRange className="h-4 w-4 text-primary" />}
            title={subMode === "site" ? "Mode Lapangan Mandor & Kontrol Mutu (QC)" : "Jadwal Pelaksanaan (Gantt), S-Curve & Pengadaan Material"}
            subtitle={
              subMode === "site"
                ? "Ringkasan belanja material dan checklist inspeksi mutu 12 tahap siap sentuh di tablet proyek."
                : `Estimasi total ${schedule.totalDurationDays} hari kerja (${schedule.totalWeeks} minggu @ 6 hari/minggu).`
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1 rounded-xl border border-white/[0.08] bg-black/30 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setSubMode("schedule")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                      subMode === "schedule" ? "bg-[#f2efe8] text-[#14171c] shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Jadwal & S-Curve
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubMode("site")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                      subMode === "site" ? "bg-[#f2efe8] text-[#14171c] shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <HardHat className="h-3 w-3" /> Mode Lapangan
                  </button>
                </div>

                {subMode === "schedule" ? (
                  <>
                    <div className="flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-black/30 p-1 text-xs">
                      {(
                        [
                          ["baseline", `Normal (${schedule.scenarios.baselineDays}h)`],
                          ["accelerated", `Dipercepat (${schedule.scenarios.acceleratedDays}h)`],
                          ["delayed", `Cuaca Hujan (${schedule.scenarios.delayedDays}h)`],
                        ] as const
                      ).map(([k, lbl]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setScenario(k)}
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                            scenario === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmResetOpen(true)}
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20"
                    >
                      <RotateCcw className="h-3 w-3" /> Reset 0%
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="no-print flex h-9 items-center gap-1.5 rounded-xl bg-[#f2efe8] px-3.5 text-xs font-semibold text-[#14171c] shadow-sm hover:brightness-95"
                  >
                    <Printer className="h-4 w-4 text-[#b9662a]" /> Cetak Checklist
                  </button>
                )}
              </div>
            }
          />
        </StudioCard>

        {subMode === "schedule" ? (
          <>
            {/* EVM Metrics */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiMetric
                icon={<Wallet className="h-3.5 w-3.5 text-primary" />}
                label="Dana Tahap Berikutnya"
                value={fmtRp(schedule.nextStageFunding?.amountIdr ?? 0)}
                tone="primary"
                sub={schedule.nextStageFunding?.stageName ?? "Semua selesai"}
              />
              <KpiMetric
                label="Earned Value (EV)"
                value={fmtRp(schedule.earnedValue.ev)}
                sub={`Aktual terpakai ${fmtRp(schedule.earnedValue.ac)}`}
              />
              <KpiMetric
                icon={<TrendingUp className="h-3.5 w-3.5 text-teal-400" />}
                label="Indeks CPI · SPI"
                value={`${schedule.earnedValue.cpi.toFixed(2)} · ${schedule.earnedValue.spi.toFixed(2)}`}
                tone="cyan"
                sub={`Proyeksi EAC ${fmtRp(schedule.earnedValue.eac)}`}
              />
              <KpiMetric
                icon={<Users className="h-3.5 w-3.5 text-primary" />}
                label="Puncak Tenaga Kerja"
                value={`${peakCrew} Tukang`}
                sub="Kalender 6 hari/minggu, 8 jam/hari"
              />
            </div>

            {/* Gantt Chart with Progress & Actual Cost inputs */}
            <div className="studio-surface overflow-hidden rounded-xl">
              <div className="border-b border-border px-4 py-2.5 text-xs font-semibold">
                Diagram Gantt, Progres &amp; Realisasi Biaya (12 Tahap)
              </div>
              <div className="divide-y divide-border">
                {schedule.stages.map((st) => {
                  const leftPct = (st.startDay / maxDay) * 100;
                  const widthPct = Math.max(3, (st.durationDays / maxDay) * 100);
                  return (
                    <div key={st.id} className="grid items-center gap-3 px-4 py-2.5 text-xs md:grid-cols-[220px_1fr_110px_125px_85px]">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">{st.order}. {st.name}</div>
                        <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
                          H+{st.startDay} → H+{st.endDay} ({st.durationDays} hr · {st.baseCrew} org)
                        </div>
                      </div>
                      <div className="relative h-5 rounded-md bg-black/35">
                        <div
                          className="absolute bottom-0.5 top-0.5 overflow-hidden rounded border border-primary/60 bg-primary/25"
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        >
                          <div className="h-full bg-primary transition-all" style={{ width: `${st.progressPct}%` }} />
                        </div>
                      </div>
                      <div className="text-right font-mono text-[11px] font-semibold tabular-nums">{fmtRp(st.budgetIdr)}</div>
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-[10px] text-muted-foreground">Rp</span>
                        <input
                          type="number"
                          min={0}
                          step={500000}
                          aria-label={`Biaya aktual ${st.name}`}
                          value={st.actualCostIdr}
                          onChange={(e) => patchStageProgress(st.id, { actualCost: Math.max(0, Number(e.target.value) || 0) })}
                          className="h-7 w-24 rounded-lg border border-input bg-[#111418] px-1.5 text-right font-mono text-[11px] tabular-nums focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          aria-label={`Progres ${st.name}`}
                          value={st.progressPct}
                          onChange={(e) => patchStageProgress(st.id, { progressPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                          className="h-7 w-14 rounded-lg border border-input bg-[#111418] px-1.5 text-right font-mono text-[11px] tabular-nums focus:border-primary focus:outline-none"
                        />
                        <span className="text-[10.5px] text-muted-foreground">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* S-Curve Cash Flow */}
            <StudioCard className="space-y-3">
              <SectionHeader title="Kurva-S Arus Kas Kumulatif Mingguan (Rencana vs Aktual)" />
              <svg viewBox="0 0 720 190" className="h-44 w-full">
                <rect x={0} y={0} width={720} height={190} fill="#111419" rx={8} />
                {[0.25, 0.5, 0.75, 1].map((g) => (
                  <line key={g} x1={30} y1={160 - g * 135} x2={700} y2={160 - g * 135} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                ))}
                {schedule.weeklyCashFlow.map((w, i) => {
                  const barW = Math.max(6, 650 / Math.max(1, schedule.weeklyCashFlow.length) - 4);
                  const x = 35 + (i / Math.max(1, schedule.weeklyCashFlow.length)) * 650;
                  const h = (w.cumulativePlannedIdr / maxCum) * 135;
                  const hAct = (w.cumulativeActualIdr / maxCum) * 135;
                  return (
                    <g key={w.week}>
                      <title>{`${w.label}: Rencana ${fmtRp(w.cumulativePlannedIdr)} | Aktual ${fmtRp(w.cumulativeActualIdr)}`}</title>
                      <rect x={x} y={160 - h} width={barW} height={h} fill="#e28a48" opacity={0.78} rx={3} />
                      {hAct > 0 && <rect x={x + 2} y={160 - hAct} width={Math.max(3, barW - 4)} height={hAct} fill="#2dd4bf" opacity={0.85} rx={2} />}
                      {i % 2 === 0 && (
                        <text x={x + barW / 2} y={177} textAnchor="middle" fontSize={9} fill="#969fab">
                          {w.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </StudioCard>

            {/* Material Procurement */}
            <div className="studio-surface overflow-hidden rounded-xl">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-semibold">
                <PackageCheck className="h-4 w-4 text-emerald-400" /> Jadwal Order Belanja Material (Lead Time Kontraktor)
              </div>
              <div className="divide-y divide-border text-xs">
                {schedule.procurementOrders.map((po) => (
                  <div key={po.stageId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-white/[0.02]">
                    <div>
                      <div className="font-semibold text-foreground">{po.stageName}</div>
                      <div className="text-[11px] text-muted-foreground">{po.materials.join(" · ")}</div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="font-mono font-bold text-primary">Order H+{po.orderByDay} (butuh H+{po.neededByDay})</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{fmtRp(po.estimatedCostIdr)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Mode Lapangan Mandor */}
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
          </>
        )}
      </div>

      <StudioConfirmDialog
        open={confirmResetOpen}
        title="Reset Seluruh Progres Lapangan?"
        description="Semua persentase progres tahap dan realisasi biaya aktual akan dikembalikan ke 0%."
        confirmLabel="Reset 0%"
        onConfirm={resetAllProgress}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </div>
  );
}
