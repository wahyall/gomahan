"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import { HVAC_CATALOG } from "@/lib/model/catalog";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { Fan, Move, Plus, Power, RotateCw, Trash2, Wind, Zap } from "lucide-react";

export function AirflowWorkspace({ derived, airflow }: { derived: DerivedProjectModel; airflow: AirflowSimulationResult }) {
  const project = useStudioStore((s) => s.project);
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Wind className="h-4 w-4 text-teal-400" />
              Simulasi Sirkulasi Udara (Angin Alami, Stack Void, Kipas & AC Movable)
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{airflow.methodologyNote}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              patchView({ showAirParticles: true });
              setWorkspace("build");
            }}
            className="rounded border border-teal-400/50 bg-teal-500/15 px-3 py-1.5 text-xs font-semibold text-teal-300 hover:bg-teal-500/25"
          >
            Lihat Partikel Aliran Udara di 3D
          </button>
        </div>

        {/* Wind & Outdoor Controls */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-semibold">Kecepatan Angin Luar</span>
              <span className="font-mono font-bold text-teal-300">{sim.windSpeedMs.toFixed(1)} m/dt</span>
            </div>
            <input
              type="range"
              min={0}
              max={8}
              step={0.2}
              value={sim.windSpeedMs}
              onChange={(e) => patchSimulation({ windSpeedMs: Number(e.target.value) })}
              className="w-full accent-[#2dd4bf]"
            />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Arah Angin</span>
              <span className="font-mono">{sim.windDirectionDeg}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={315}
              step={45}
              value={sim.windDirectionDeg}
              onChange={(e) => patchSimulation({ windDirectionDeg: Number(e.target.value) })}
              className="w-full accent-[#2dd4bf]"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-semibold">Suhu Udara Luar Surabaya</span>
              <span className="font-mono font-bold text-amber-300">{sim.ambientTempC}°C</span>
            </div>
            <input
              type="range"
              min={24}
              max={38}
              step={0.5}
              value={sim.ambientTempC}
              onChange={(e) => patchSimulation({ ambientTempC: Number(e.target.value) })}
              className="w-full accent-[#df8949]"
            />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Kelembapan (RH)</span>
              <span className="font-mono">{sim.humidityPct}%</span>
            </div>
            <input
              type="range"
              min={45}
              max={95}
              step={5}
              value={sim.humidityPct}
              onChange={(e) => patchSimulation({ humidityPct: Number(e.target.value) })}
              className="w-full accent-[#2dd4bf]"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="text-xs text-muted-foreground">Skor Sirkulasi & Termal</div>
            <div className="mt-1 font-mono text-2xl font-bold text-teal-300">{airflow.airflowScore} / 100</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Rata-rata ACH: <b className="font-mono text-foreground">{airflow.avgAch.toFixed(1)}×/jam</b> · Cross-vent: <b>{airflow.crossVentPct}%</b>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-amber-400" /> Beban Listrik & HVAC
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-amber-300">{airflow.totalHvacPowerW} W</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Rekomendasi PLN: <b className="font-mono text-foreground">{derived.mep.recommendedPlnVa} VA</b> (MCB {project.rabSettings.plnVaTier} VA)
            </div>
          </div>
        </div>

        {/* Recommendations */}
        {airflow.recommendations.length > 0 && (
          <div className="space-y-1.5">
            {airflow.recommendations.map((rec, i) => (
              <div key={i} className="rounded border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {rec}
              </div>
            ))}
          </div>
        )}

        {/* Movable Fans & AC Units Manager */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Fan className="h-4 w-4 text-teal-400" /> Unit AC & Kipas Terpasang (Bisa Digeser, Diputar & Ditambah)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {HVAC_CATALOG.slice(0, 5).map((cat) => (
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
                  className="flex items-center gap-1 rounded border border-border bg-secondary px-2 py-1 text-[10.5px] font-medium hover:border-teal-400"
                >
                  <Plus className="h-3 w-3 text-teal-400" /> {cat.name.split("(")[0]!.trim()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {project.levels.flatMap((lv) =>
              lv.hvac.map((hv) => (
                <div key={hv.id} className="rounded border border-border bg-secondary/40 p-2.5 text-xs space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{hv.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        LT{lv.index + 1} · X:{hv.position.x.toFixed(1)}m Z:{hv.position.z.toFixed(1)}m · {hv.powerW}W
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { on: !hv.on })}
                      className={cn(
                        "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold",
                        hv.on ? "bg-teal-500/20 text-teal-300" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Power className="h-3 w-3" /> {hv.on ? "ON" : "OFF"}
                    </button>
                  </div>

                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="flex items-center gap-0.5 text-muted-foreground"><Move className="h-3 w-3" /> Geser:</span>
                    <button type="button" onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, x: Math.max(0.2, hv.position.x - 0.5) } })} className="rounded border border-border px-1.5 py-0.5">-X</button>
                    <button type="button" onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, x: Math.min(4.8, hv.position.x + 0.5) } })} className="rounded border border-border px-1.5 py-0.5">+X</button>
                    <button type="button" onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, z: Math.max(0.5, hv.position.z - 0.5) } })} className="rounded border border-border px-1.5 py-0.5">-Z</button>
                    <button type="button" onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { position: { ...hv.position, z: Math.min(16.5, hv.position.z + 0.5) } })} className="rounded border border-border px-1.5 py-0.5">+Z</button>
                    <button
                      type="button"
                      onClick={() => updateHvac(lv.index as 0 | 1, hv.id, { rotationY: (hv.rotationY + Math.PI / 4) % (Math.PI * 2) })}
                      className="ml-auto rounded border border-border px-1.5 py-0.5 hover:border-primary"
                      title="Putar arah hembusan"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHvac(lv.index as 0 | 1, hv.id)}
                      className="rounded border border-red-500/30 px-1.5 py-0.5 text-red-300 hover:bg-red-500/20"
                      title="Hapus unit"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )),
            )}
          </div>
        </div>

        {/* Zonal Metrics Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs font-bold">Metrik Sirkulasi & Kenyamanan Termal per Zona (ASHRAE 55 / SNI 03-6572)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-[10.5px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Lantai</th>
                  <th className="px-3 py-2 text-left">Ruangan</th>
                  <th className="px-3 py-2 text-right">ACH (/jam)</th>
                  <th className="px-3 py-2 text-right">Kecepatan</th>
                  <th className="px-3 py-2 text-right">Suhu Udara</th>
                  <th className="px-3 py-2 text-right">Suhu Terasa</th>
                  <th className="px-3 py-2 text-right">CO₂ (ppm)</th>
                  <th className="px-3 py-2 text-right">PMV</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {airflow.zones.map((z) => (
                  <tr key={z.roomId}>
                    <td className="px-3 py-2 font-mono">LT{z.levelIndex + 1}</td>
                    <td className="px-3 py-2 font-medium">{z.roomName}</td>
                    <td className="px-3 py-2 text-right font-mono">{z.ach.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono">{z.avgVelocityMs.toFixed(2)} m/s</td>
                    <td className="px-3 py-2 text-right font-mono">{z.airTempC.toFixed(1)}°C</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{z.effectiveTempC.toFixed(1)}°C</td>
                    <td className="px-3 py-2 text-right font-mono">{z.co2Ppm}</td>
                    <td className="px-3 py-2 text-right font-mono">{z.pmv.toFixed(2)}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-bold",
                        z.comfortStatus === "SEJUK AC" ? "text-sky-300" : z.comfortStatus === "NYAMAN" ? "text-emerald-400" : z.comfortStatus === "HANGAT" ? "text-amber-300" : "text-red-400",
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
