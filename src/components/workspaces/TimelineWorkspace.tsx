"use client";

import type { ScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { KpiMetric, SectionHeader, StudioCard } from "@/components/ui/StudioPrimitives";
import { CalendarRange, PackageCheck, TrendingUp, Users, Wallet } from "lucide-react";

export function TimelineWorkspace({ schedule }: { schedule: ScheduleSummary }) {
  const scenario = useStudioStore((s) => s.scheduleScenario);
  const setScenario = useStudioStore((s) => s.setScheduleScenario);
  const patchStageProgress = useStudioStore((s) => s.patchStageProgress);

  const maxDay = Math.max(1, schedule.totalDurationDays);
  const maxCum = Math.max(1, ...schedule.weeklyCashFlow.map((w) => w.cumulativePlannedIdr));
  const peakCrew = Math.max(1, ...schedule.weeklyCashFlow.map((w) => w.peakCrew));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <StudioCard>
          <SectionHeader
            icon={<CalendarRange className="h-4 w-4 text-primary" />}
            title="Jadwal Pelaksanaan (Gantt), S-Curve & Pengadaan Material"
            subtitle={`Estimasi total ${schedule.totalDurationDays} hari kerja (${schedule.totalWeeks} minggu @ 6 hari/minggu).`}
            action={
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
                      scenario === k ? "bg-[#f2efe8] text-[#14171c] shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            }
          />
        </StudioCard>

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

        {/* Gantt Chart */}
        <div className="studio-surface overflow-hidden rounded-xl">
          <div className="border-b border-border px-4 py-2.5 text-xs font-semibold">
            Diagram Gantt &amp; Progres Lapangan
          </div>
          <div className="divide-y divide-border">
            {schedule.stages.map((st) => {
              const leftPct = (st.startDay / maxDay) * 100;
              const widthPct = Math.max(3, (st.durationDays / maxDay) * 100);
              return (
                <div key={st.id} className="grid items-center gap-3 px-4 py-2.5 text-xs md:grid-cols-[240px_1fr_115px_85px]">
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
                    <input
                      type="number"
                      min={0}
                      max={100}
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
          <SectionHeader title="Kurva-S Arus Kas Kumulatif Mingguan" />
          <svg viewBox="0 0 720 190" className="h-44 w-full">
            <rect x={0} y={0} width={720} height={190} fill="#111419" rx={8} />
            {[0.25, 0.5, 0.75, 1].map((g) => (
              <line key={g} x1={30} y1={160 - g * 135} x2={700} y2={160 - g * 135} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
            ))}
            {schedule.weeklyCashFlow.map((w, i) => {
              const barW = Math.max(6, 650 / Math.max(1, schedule.weeklyCashFlow.length) - 4);
              const x = 35 + (i / Math.max(1, schedule.weeklyCashFlow.length)) * 650;
              const h = (w.cumulativePlannedIdr / maxCum) * 135;
              return (
                <g key={w.week}>
                  <title>{`${w.label}: ${fmtRp(w.cumulativePlannedIdr)}`}</title>
                  <rect x={x} y={160 - h} width={barW} height={h} fill="#e28a48" opacity={0.85} rx={3} />
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
      </div>
    </div>
  );
}
