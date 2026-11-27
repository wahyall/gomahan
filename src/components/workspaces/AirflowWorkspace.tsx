"use client";

import { useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import { HVAC_CATALOG } from "@/lib/model/catalog";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { KpiMetric, SectionHeader, StudioCard, StudioConfirmDialog, StudioRange } from "@/components/ui/StudioPrimitives";
import { Eye, Fan, Move, Plus, Power, RotateCw, Trash2, Wind, Zap } from "lucide-react";

export function AirflowWorkspace({ derived, airflow }: { derived: DerivedProjectModel; airflow: AirflowSimulationResult }) {
  const project = useStudioStore((s) => s.project);
  const view = useStudioStore((s) => s.view);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const patchView = useStudioStore((s) => s.patchView);
  const updateHvac = useStudioStore((s) => s.updateHvac);
  const addHvac = useStudioStore((s) => s.addHvac);
  const deleteHvac = useStudioStore((s) => s.deleteHvac);

  const [targetLevel, setTargetLevel] = useState<0 | 1>(0);
  const [confirmDeleteHvac, setConfirmDeleteHvac] = useState<{ lvIndex: 0 | 1; id: string; name: string } | null>(null);

  const sim = project.simulation;
  const maxLevelIdx = Math.max(0, Math.min(1, project.levels.length - 1)) as 0 | 1;
  const effectiveLevel = Math.min(targetLevel, maxLevelIdx) as 0 | 1;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <StudioCard>
          <SectionHeader
            icon={<Wind className="h-4 w-4 text-teal-400" />}
            title="Simulasi Sirkulasi Udara, Kipas & AC"
            subtitle={airflow.methodologyNote}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => patchView({ showAirParticles: !view.showAirParticles })}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition",
                view.showAirParticles
                  ? "border-teal-400/60 bg-teal-500/25 text-teal-100"
                  : "border-border bg-secondary text-foreground hover:border-white/25",
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              {view.showAirParticles ? "Partikel Angin 3D Aktif" : "Tampilkan Aliran Angin 3D"}
            </button>
            <span className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              Pilih unit di tab <b className="text-foreground">Utilitas</b> pada dock bawah untuk tambah AC/kipas di 3D.
            </span>
          </div>
        </StudioCard>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <KpiMetric
            label="Skor Sirkulasi & Termal"
            value={`${airflow.airflowScore} / 100`}
            tone="cyan"
            sub={`Rata-rata ${airflow.avgAch.toFixed(1)} ACH · Cross-vent ${airflow.crossVentPct}%`}
          />
          <KpiMetric
            icon={<Zap className="h-3.5 w-3.5 text-amber-400" />}
            label="Beban Daya HVAC Total"
            value={`${airflow.totalHvacPowerW} W`}
            tone="amber"
            sub={`Saran PLN ${derived.mep.recommendedPlnVa} VA`}
          />
        </div>

        {/* Weather & Wind Controls */}
        <div className="grid grid-cols-1 gap-3.5 @md:grid-cols-2">
          <StudioCard className="space-y-3">
            <StudioRange
              label="Kecepatan Angin Luar"
              display={`${sim.windSpeedMs.toFixed(1)} m/dt`}
              min={0}
              max={8}
              step={0.2}
              value={sim.windSpeedMs}
              accentHex="#2dd4bf"
              onChange={(v) => patchSimulation({ windSpeedMs: v })}
            />
            <StudioRange
              label="Arah Angin Dominan"
              display={`${sim.windDirectionDeg}°`}
              min={0}
              max={315}
              step={45}
              value={sim.windDirectionDeg}
              accentHex="#2dd4bf"
              onChange={(v) => patchSimulation({ windDirectionDeg: v })}
            />
          </StudioCard>

          <StudioCard className="space-y-3">
            <StudioRange
              label="Suhu Luar Surabaya"
              display={`${sim.ambientTempC}°C`}
              min={24}
              max={38}
              step={0.5}
              value={sim.ambientTempC}
              onChange={(v) => patchSimulation({ ambientTempC: v })}
            />
            <StudioRange
              label="Kelembapan Relatif (RH)"
              display={`${sim.humidityPct}%`}
              min={45}
              max={95}
              step={5}
              value={sim.humidityPct}
              accentHex="#2dd4bf"
              onChange={(v) => patchSimulation({ humidityPct: v })}
            />
          </StudioCard>
        </div>

        {airflow.recommendations.length > 0 && (
          <div className="space-y-1.5">
            {airflow.recommendations.map((rec, i) => (
              <div key={i} className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
                {rec}
              </div>
            ))}
          </div>
        )}

        {/* Movable Fans & AC Manager */}
        <StudioCard className="space-y-3">
          <SectionHeader
            icon={<Fan className="h-4 w-4 text-teal-400" />}
            title="Unit AC & Kipas Terpasang"
            subtitle="Pilih lantai target untuk menambah unit, atau geser & putar arah hembusan."
            action={
              project.levels.length > 1 ? (
                <div className="flex items-center gap-0.5 rounded-lg border border-border bg-black/30 p-0.5 text-[11px]">
                  {([0, 1] as const).map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setTargetLevel(idx)}
                      className={cn(
                        "rounded-md px-2 py-0.5 font-semibold transition",
                        effectiveLevel === idx ? "bg-[#f2efe8] text-[#14171c]" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      LT {idx + 1}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          />

          <div className="flex flex-wrap gap-1.5">
            {HVAC_CATALOG.map((cat) => (
              <button
                key={cat.name}
                type="button"
                onClick={() => {
                  const existingCount = project.levels[effectiveLevel]?.hvac.length ?? 0;
                  const staggerX = Math.min(4.4, Math.max(0.6, 1.3 + ((existingCount * 0.85) % 2.8)));
                  const staggerZ = Math.min(15.5, Math.max(4.5, 6.0 + Math.floor(existingCount / 3) * 1.4));
                  addHvac(effectiveLevel, {
                    id: `hv-${Date.now().toString(36)}`,
                    name: cat.name,
                    type: cat.type,
                    position: { x: Number(staggerX.toFixed(2)), y: cat.defaultElevationM, z: Number(staggerZ.toFixed(2)) },
                    rotationY: 0,
                    pkRating: cat.pkRating,
                    flowRateM3h: cat.flowRateM3h,
                    coolingCapacityW: cat.coolingCapacityW,
                    powerW: cat.powerW,
                    setpointC: cat.setpointC,
                    speedLevel: 2,
                    on: true,
                  });
                }}
                className="flex items-center gap-1 rounded-lg border border-border bg-black/25 px-2.5 py-1 text-[11px] font-medium transition hover:border-teal-400/60 hover:text-foreground"
              >
                <Plus className="h-3 w-3 text-teal-400" /> {cat.name.split("(")[0]!.trim()} (LT{effectiveLevel + 1})
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2">
            {project.levels.flatMap((lv) =>
              lv.hvac.map((hv) => (
                <div key={hv.id} className="space-y-2 rounded-xl border border-white/[0.08] bg-black/25 p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{hv.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        LT{lv.index + 1} · X:{hv.position.x.toFixed(1)}m Z:{hv.position.z.toFixed(1)}m · {hv.powerW}W
                        {hv.coolingCapacityW > 0 ? ` · ${hv.coolingCapacityW}W ding` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { on: !hv.on })}
                      className={cn(
                        "flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-bold transition",
                        hv.on ? "bg-teal-500/20 text-teal-200 ring-1 ring-teal-400/40" : "bg-white/[0.06] text-muted-foreground",
                      )}
                    >
                      <Power className="h-3 w-3" /> {hv.on ? "ON" : "OFF"}
                    </button>
                  </div>

                  <div className="flex items-center gap-1 text-[10.5px]">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Move className="h-3 w-3" />
                    </span>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, x: Math.max(0.2, hv.position.x - 0.5) } })}
                      className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono hover:border-white/25"
                    >
                      -X
                    </button>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, x: Math.min(4.8, hv.position.x + 0.5) } })}
                      className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono hover:border-white/25"
                    >
                      +X
                    </button>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, z: Math.max(0.5, hv.position.z - 0.5) } })}
                      className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono hover:border-white/25"
                    >
                      -Z
                    </button>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, z: Math.min(16.5, hv.position.z + 0.5) } })}
                      className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono hover:border-white/25"
                    >
                      +Z
                    </button>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { rotationY: (hv.rotationY + Math.PI / 4) % (Math.PI * 2) })}
                      className="ml-auto rounded-md border border-border bg-secondary/50 px-1.5 py-1 hover:border-primary"
                      title="Putar arah hembusan"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteHvac({ lvIndex: lv.index as 0 | 1, id: hv.id, name: hv.name })}
                      className="rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-1 text-rose-300 hover:bg-rose-500/20"
                      title="Hapus unit"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )),
            )}
          </div>
        </StudioCard>

        {/* Zonal Metrics Table */}
        <div className="studio-surface overflow-hidden rounded-xl">
          <div className="border-b border-border px-3.5 py-2.5 text-xs font-semibold">
            Metrik Kenyamanan Termal per Zona (ASHRAE 55 / SNI)
          </div>
          <div className="grid grid-cols-1 gap-2 p-3 @lg:hidden">
            {airflow.zones.map((z) => (
              <div key={z.roomId} className="rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">LT{z.levelIndex + 1} · {z.roomName}</span>
                  <span
                    className={cn(
                      "rounded-lg px-2 py-0.5 text-[10.5px] font-bold",
                      z.comfortStatus === "SEJUK AC"
                        ? "bg-sky-500/15 text-sky-300"
                        : z.comfortStatus === "NYAMAN"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : z.comfortStatus === "HANGAT"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-rose-500/15 text-rose-300",
                    )}
                  >
                    {z.comfortStatus}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
                  <div><span className="text-muted-foreground">Terasa:</span> <strong className="text-foreground">{z.effectiveTempC.toFixed(1)}°C</strong></div>
                  <div><span className="text-muted-foreground">ACH:</span> <strong className="text-foreground">{z.ach.toFixed(1)}</strong></div>
                  <div className="text-right"><span className="text-muted-foreground">CO₂:</span> <strong className="text-foreground">{z.co2Ppm}</strong></div>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto @lg:block">
            <table className="w-full text-xs">
              <thead className="bg-[#1a1f28] text-[10.5px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Lantai</th>
                  <th className="px-3 py-2 text-left">Ruangan</th>
                  <th className="px-3 py-2 text-right">ACH</th>
                  <th className="px-3 py-2 text-right">Angin</th>
                  <th className="px-3 py-2 text-right">Suhu</th>
                  <th className="px-3 py-2 text-right">Terasa</th>
                  <th className="px-3 py-2 text-right">CO₂</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {airflow.zones.map((z) => (
                  <tr key={z.roomId} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-mono text-muted-foreground">LT{z.levelIndex + 1}</td>
                    <td className="px-3 py-2 font-medium">{z.roomName}</td>
                    <td className="px-3 py-2 text-right font-mono">{z.ach.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono">{z.avgVelocityMs.toFixed(2)} m/s</td>
                    <td className="px-3 py-2 text-right font-mono">{z.airTempC.toFixed(1)}°C</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{z.effectiveTempC.toFixed(1)}°C</td>
                    <td className="px-3 py-2 text-right font-mono">{z.co2Ppm}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-semibold",
                        z.comfortStatus === "SEJUK AC"
                          ? "text-sky-300"
                          : z.comfortStatus === "NYAMAN"
                            ? "text-emerald-300"
                            : z.comfortStatus === "HANGAT"
                              ? "text-amber-300"
                              : "text-rose-300",
                      )}
                    >
                      {z.comfortStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <StudioConfirmDialog
        open={confirmDeleteHvac !== null}
        onCancel={() => setConfirmDeleteHvac(null)}
        title="Hapus Unit HVAC?"
        description={`Unit "${confirmDeleteHvac?.name ?? ""}" akan dihapus dari lantai ${confirmDeleteHvac ? confirmDeleteHvac.lvIndex + 1 : 1} (dapat dibatalkan lewat Ctrl+Z).`}
        confirmLabel="Hapus Unit"
        danger
        onConfirm={() => {
          if (confirmDeleteHvac) {
            deleteHvac(confirmDeleteHvac.lvIndex, confirmDeleteHvac.id);
            setConfirmDeleteHvac(null);
          }
        }}
      />
    </div>
  );
}
