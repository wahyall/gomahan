"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import { HVAC_CATALOG } from "@/lib/model/catalog";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { KpiMetric, SectionHeader, StudioCard, StudioRange } from "@/components/ui/StudioPrimitives";
import { Eye, Fan, Hammer, Move, Plus, Power, RotateCw, Trash2, Wind, Zap } from "lucide-react";

export function AirflowWorkspace({ derived, airflow }: { derived: DerivedProjectModel; airflow: AirflowSimulationResult }) {
  const project = useStudioStore((s) => s.project);
  const view = useStudioStore((s) => s.view);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const patchView = useStudioStore((s) => s.patchView);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const updateHvac = useStudioStore((s) => s.updateHvac);
  const addHvac = useStudioStore((s) => s.addHvac);
  const deleteHvac = useStudioStore((s) => s.deleteHvac);

  const sim = project.simulation;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <StudioCard>
          <SectionHeader
            icon={<Wind className="h-4 w-4 text-teal-400" />}
            title="Simulasi Sirkulasi Udara, Kipas & AC"
            subtitle={airflow.methodologyNote}
          />
          <div className="mt-3 flex flex-wrap gap-2">
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
            <button
              type="button"
              onClick={() => {
                patchView({ showAirParticles: true });
                setWorkspace("build");
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-black/25 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Hammer className="h-3.5 w-3.5" /> Pasang Kipas / AC di Build
            </button>
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
            subtitle="Klik unit untuk menggeser, memutar arah hembusan, atau menonaktifkan sementara."
          />

          <div className="flex flex-wrap gap-1.5">
            {HVAC_CATALOG.map((cat) => (
              <button
                key={cat.name}
                type="button"
                onClick={() =>
                  addHvac(0, {
                    id: `hv-${Date.now().toString(36)}`,
                    name: cat.name,
                    type: cat.type,
                    position: { x: 2.5, y: cat.defaultElevationM, z: 9.5 },
                    rotationY: 0,
                    pkRating: cat.pkRating,
                    flowRateM3h: cat.flowRateM3h,
                    coolingCapacityW: cat.coolingCapacityW,
                    powerW: cat.powerW,
                    setpointC: cat.setpointC,
                    speedLevel: 2,
                    on: true,
                  })
                }
                className="flex items-center gap-1 rounded-lg border border-border bg-black/25 px-2.5 py-1 text-[11px] font-medium transition hover:border-teal-400/60 hover:text-foreground"
              >
                <Plus className="h-3 w-3 text-teal-400" /> {cat.name.split("(")[0]!.trim()}
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
                      onClick={() => deleteHvac(lv.index as 0 | 1, hv.id)}
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
          <div className="overflow-x-auto">
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
    </div>
  );
}
