"use client";

import type { ScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { CalendarRange, PackageCheck, TrendingUp, Wallet } from "lucide-react";

export function TimelineWorkspace({ schedule }: { schedule: ScheduleSummary }) {
  const scenario = useStudioStore((s) => s.scheduleScenario);
  const setScenario = useStudioStore((s) => s.setScheduleScenario);
  const patchStageProgress = useStudioStore((s) => s.patchStageProgress);

  const maxDay = Math.max(1, schedule.totalDurationDays);
  const maxCum = Math.max(1, ...schedule.weeklyCashFlow.map((w) => w.cumulativePlannedIdr));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <CalendarRange className="h-4 w-4 text-primary" />
              Jadwal Pelaksanaan (Gantt), S-Curve Cash Flow & Pengadaan Material
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Estimasi total {schedule.totalDurationDays} hari kerja ({schedule.totalWeeks} minggu @ 6 hari/minggu).
            </p>
          </div>
          <div className="flex gap-1 rounded border border-border bg-secondary p-1 text-xs">
            {(
              [
                ["baseline", `Normal (${schedule.scenarios.baselineDays}h)`],
                ["accelerated", `Dipercepat (${schedule.scenarios.acceleratedDays}h)`],
                ["delayed", `Terlambat Hujan (${schedule.scenarios.delayedDays}h)`],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setScenario(k)}
                className={cn(
                  "rounded px-2.5 py-1 font-semibold",
                  scenario === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Next Stage Funding + EVM */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-primary/40 bg-primary/10 p-3.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase text-primary">
              <Wallet className="h-3.5 w-3.5" /> Dana Tahap Berikutnya
            </div>
            <div className="mt-1 text-xs font-semibold text-foreground">{schedule.nextStageFunding?.stageName ?? "-"}</div>
            <div className="mt-0.5 font-mono text-lg font-bold text-primary">
              {fmtRp(schedule.nextStageFunding?.amountIdr ?? 0)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="text-[10.5px] uppercase text-muted-foreground">Earned Value (EV) vs Actual (AC)</div>
            <div className="mt-1 font-mono text-base font-bold">{fmtRp(schedule.earnedValue.ev)}</div>
            <div className="text-[11px] text-muted-foreground">Terpakai: {fmtRp(schedule.earnedValue.ac)}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="flex items-center gap-1 text-[10.5px] uppercase text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-teal-400" /> CPI & SPI</div>
            <div className="mt-1 font-mono text-base font-bold">
              CPI {schedule.earnedValue.cpi.toFixed(2)} · SPI {schedule.earnedValue.spi.toFixed(2)}
            </div>
            <div className="text-[11px] text-muted-foreground">EAC: {fmtRp(schedule.earnedValue.eac)}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="text-[10.5px] uppercase text-muted-foreground">Puncak Tenaga Kerja</div>
            <div className="mt-1 font-mono text-base font-bold">
              {Math.max(1, ...schedule.weeklyCashFlow.map((w) => w.peakCrew))} Tukang/Hari
            </div>
            <div className="text-[11px] text-muted-foreground">Kalender 6 hari/minggu, 8 jam/hari</div>
          </div>
        </div>

        {/* Gantt Chart */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs font-bold">Diagram Gantt & Progres Lapangan (Edit Progres % di Kanan)</div>
          <div className="divide-y divide-border">
            {schedule.stages.map((st) => {
              const leftPct = (st.startDay / maxDay) * 100;
              const widthPct = Math.max(2, (st.durationDays / maxDay) * 100);
              return (
                <div key={st.id} className="grid items-center gap-2 px-3 py-2 text-xs md:grid-cols-[240px_1fr_110px_80px]">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{st.order}. {st.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      H+{st.startDay} → H+{st.endDay} ({st.durationDays} hr · {st.baseCrew} org)
                    </div>
                  </div>
                  <div className="relative h-5 rounded bg-secondary">
                    <div
                      className="absolute top-0.5 bottom-0.5 rounded bg-primary/35 border border-primary"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    >
                      <div className="h-full bg-primary/80" style={{ width: `${st.progressPct}%` }} />
                    </div>
                  </div>
                  <div className="text-right font-mono text-[11px] font-semibold">{fmtRp(st.budgetIdr)}</div>
                  <div className="flex items-center justify-end gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={st.progressPct}
                      onChange={(e) => patchStageProgress(st.id, { progressPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                      className="h-6 w-14 rounded border border-input bg-secondary px-1 text-right font-mono text-[11px]"
                    />
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weekly Cash Flow S-Curve SVG */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 text-xs font-bold">Kurva-S Arus Kas Kumulatif Mingguan (Planned S-Curve)</div>
          <svg viewBox="0 0 720 190" className="h-44 w-full">
            <rect x={0} y={0} width={720} height={190} fill="#14171c" rx={6} />
            {schedule.weeklyCashFlow.map((w, i) => {
              const barW = Math.max(6, 660 / Math.max(1, schedule.weeklyCashFlow.length) - 4);
              const x = 35 + (i / Math.max(1, schedule.weeklyCashFlow.length)) * 660;
              const h = (w.cumulativePlannedIdr / maxCum) * 140;
              return (
                <g key={w.week}>
                  <rect x={x} y={160 - h} width={barW} height={h} fill="#df8949" opacity={0.75} rx={2} />
                  {i % 2 === 0 && (
                    <text x={x + barW / 2} y={176} textAnchor="middle" fontSize={9} fill="#98a0ab">
                      {w.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Material Procurement Schedule */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-bold">
            <PackageCheck className="h-4 w-4 text-emerald-400" /> Jadwal Order Belanja Material (Lead Time Kontraktor)
          </div>
          <div className="divide-y divide-border text-xs">
            {schedule.procurementOrders.map((po) => (
              <div key={po.stageId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <div className="font-semibold">{po.stageName}</div>
                  <div className="text-[11px] text-muted-foreground">{po.materials.join(" · ")}</div>
                </div>
                <div className="text-right">
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
