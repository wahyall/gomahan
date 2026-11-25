"use client";

import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { Lightbulb, Sun } from "lucide-react";

export function LightingWorkspace({ lighting }: { lighting: LightingSimulationResult }) {
  const project = useStudioStore((s) => s.project);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const patchSiteOrientation = useStudioStore((s) => s.patchSiteOrientation);
  const updateLight = useStudioStore((s) => s.updateLight);
  const patchView = useStudioStore((s) => s.patchView);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const sim = project.simulation;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Sun className="h-4 w-4 text-amber-400" />
              Simulasi Pencahayaan Alami & Buatan — Surabaya ({project.site.latitude.toFixed(2)}, {project.site.longitude.toFixed(2)})
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{lighting.methodologyNote}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              patchView({ showLuxHeatmap: true });
              setWorkspace("build");
            }}
            className="rounded border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25"
          >
            Tampilkan Heatmap Lux di 3D
          </button>
        </div>

        {/* Controls */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="font-semibold">Jam Simulasi</span>
              <span className="font-mono font-bold text-amber-300">
                {Math.floor(sim.hourOfDay).toString().padStart(2, "0")}:{sim.hourOfDay % 1 >= 0.5 ? "30" : "00"} WIB
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={22}
              step={0.5}
              value={sim.hourOfDay}
              onChange={(e) => patchSimulation({ hourOfDay: Number(e.target.value) })}
              className="w-full accent-[#df8949]"
            />
            <div className="grid grid-cols-4 gap-1">
              {[
                [7, "07:00"],
                [12, "12:00"],
                [16, "16:00"],
                [19.5, "19:30"],
              ].map(([h, lbl]) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => patchSimulation({ hourOfDay: Number(h) })}
                  className={cn(
                    "rounded border py-1 text-[10.5px] font-semibold",
                    Math.abs(sim.hourOfDay - Number(h)) < 0.3 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
            <div className="flex justify-between text-xs">
              <span className="font-semibold">Orientasi Hadap Kavling</span>
              <span className="font-mono font-bold">{project.site.orientationDeg}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={315}
              step={45}
              value={project.site.orientationDeg}
              onChange={(e) => patchSiteOrientation(Number(e.target.value))}
              className="w-full accent-[#df8949]"
            />
            <div className="flex gap-1.5 text-xs">
              {(["kemarau", "hujan"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => patchSimulation({ season: s })}
                  className={cn(
                    "flex-1 rounded border py-1 font-semibold capitalize",
                    sim.season === s ? "border-primary bg-primary/20 text-primary" : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  Musim {s}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">Ringkasan Pencahayaan</div>
            <div className="font-mono text-2xl font-bold text-amber-300">{lighting.daylightScore} / 100</div>
            <div className="text-xs text-muted-foreground">
              Rata-rata Ruang: <b className="font-mono text-foreground">{lighting.avgHouseLux} lux</b> · Kepatuhan SNI: <b>{lighting.sniCompliancePct}%</b>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Sudut Matahari: {lighting.solar.altitudeDeg.toFixed(1)}° · Langit: {lighting.solar.skyIrradianceLux} lux
            </div>
          </div>
        </div>

        {/* Room Lux Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-xs font-bold">Intensitas Cahaya per Ruangan (Alami + Lampu vs Target SNI)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-[10.5px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Lantai</th>
                  <th className="px-3 py-2 text-left">Ruangan</th>
                  <th className="px-3 py-2 text-right">Daylight Factor</th>
                  <th className="px-3 py-2 text-right">Alami (Lux)</th>
                  <th className="px-3 py-2 text-right">Lampu (Lux)</th>
                  <th className="px-3 py-2 text-right">Total (Lux)</th>
                  <th className="px-3 py-2 text-right">Target SNI</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lighting.rooms.map((r) => (
                  <tr key={r.roomId}>
                    <td className="px-3 py-2 font-mono">LT{r.levelIndex + 1}</td>
                    <td className="px-3 py-2 font-medium">{r.roomName}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.daylightFactorPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-mono">{r.naturalLux}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.artificialLux}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{r.totalLux}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.targetLux}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-bold",
                        r.status === "TERANG" ? "text-emerald-400" : r.status === "CUKUP" ? "text-amber-300" : "text-red-400",
                      )}
                    >
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Interactive Artificial Lights Switchboard */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5 text-amber-400" /> Kontrol Lampu Interior & Eksterior
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {project.levels.flatMap((lv) =>
              lv.lights.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded border border-border bg-secondary/40 px-2.5 py-2 text-xs">
                  <div className="min-w-0 pr-2">
                    <div className="truncate font-semibold">{l.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      LT{lv.index + 1} · {l.lumens} lm · {l.colorTempK}K
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateLight(lv.index as 0 | 1, l.id, { on: !l.on })}
                    className={cn(
                      "rounded px-2 py-1 text-[10.5px] font-bold",
                      l.on ? "bg-amber-400/25 text-amber-200" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {l.on ? "ON" : "OFF"}
                  </button>
                </div>
              )),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
