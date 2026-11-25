"use client";

import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { KpiMetric, SectionHeader, StudioCard, StudioRange } from "@/components/ui/StudioPrimitives";
import { Eye, Hammer, Lightbulb, Sun } from "lucide-react";

export function LightingWorkspace({ lighting }: { lighting: LightingSimulationResult }) {
  const project = useStudioStore((s) => s.project);
  const view = useStudioStore((s) => s.view);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const patchSiteOrientation = useStudioStore((s) => s.patchSiteOrientation);
  const updateLight = useStudioStore((s) => s.updateLight);
  const patchView = useStudioStore((s) => s.patchView);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const sim = project.simulation;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <StudioCard>
          <SectionHeader
            icon={<Sun className="h-4 w-4 text-amber-400" />}
            title={`Simulasi Pencahayaan Surabaya (${project.site.latitude.toFixed(2)}, ${project.site.longitude.toFixed(2)})`}
            subtitle={lighting.methodologyNote}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => patchView({ showLuxHeatmap: !view.showLuxHeatmap })}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition",
                view.showLuxHeatmap
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-foreground hover:border-white/25",
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              {view.showLuxHeatmap ? "Heatmap Lux 3D Aktif" : "Tampilkan Heatmap Lux 3D"}
            </button>
            <button
              type="button"
              onClick={() => {
                patchView({ showLuxHeatmap: true });
                setWorkspace("build");
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-black/25 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Hammer className="h-3.5 w-3.5" /> Tambah/Geser Lampu di Build
            </button>
          </div>
        </StudioCard>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
          <KpiMetric label="Skor Pencahayaan Alami" value={`${lighting.daylightScore} / 100`} tone="amber" />
          <KpiMetric
            label="Rata-rata Intensitas"
            value={`${lighting.avgHouseLux} lux`}
            sub={`Kepatuhan SNI ${lighting.sniCompliancePct}%`}
          />
          <KpiMetric
            label="Sudut Matahari"
            value={`${lighting.solar.altitudeDeg.toFixed(1)}°`}
            sub={`Langit ${lighting.solar.skyIrradianceLux} lux`}
            className="col-span-2 @lg:col-span-1"
          />
        </div>

        {/* Solar & Time Controls */}
        <div className="grid grid-cols-1 gap-3.5 @md:grid-cols-2">
          <StudioCard className="space-y-3">
            <StudioRange
              label="Jam Simulasi (WIB)"
              display={`${Math.floor(sim.hourOfDay).toString().padStart(2, "0")}:${sim.hourOfDay % 1 >= 0.5 ? "30" : "00"}`}
              min={5}
              max={22}
              step={0.5}
              value={sim.hourOfDay}
              onChange={(v) => patchSimulation({ hourOfDay: v })}
            />
            <div className="grid grid-cols-4 gap-1.5">
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
                    "rounded-lg border py-1.5 text-[11px] font-semibold transition",
                    Math.abs(sim.hourOfDay - Number(h)) < 0.3
                      ? "border-[#f2efe8] bg-[#f2efe8] text-[#14171c]"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </StudioCard>

          <StudioCard className="space-y-3">
            <StudioRange
              label="Orientasi Hadap Kavling"
              display={`${project.site.orientationDeg}°`}
              min={0}
              max={315}
              step={45}
              value={project.site.orientationDeg}
              onChange={(v) => patchSiteOrientation(v)}
            />
            <div className="flex gap-1.5">
              {(["kemarau", "hujan"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => patchSimulation({ season: s })}
                  className={cn(
                    "flex-1 rounded-lg border py-1.5 text-xs font-semibold capitalize transition",
                    sim.season === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  Musim {s}
                </button>
              ))}
            </div>
          </StudioCard>
        </div>

        {/* Room Lux Table */}
        <div className="studio-surface overflow-hidden rounded-xl">
          <div className="border-b border-border px-3.5 py-2.5 text-xs font-semibold">
            Intensitas Cahaya per Ruangan (Alami + Lampu vs Target SNI)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#1a1f28] text-[10.5px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Lantai</th>
                  <th className="px-3 py-2 text-left">Ruangan</th>
                  <th className="px-3 py-2 text-right">DF</th>
                  <th className="px-3 py-2 text-right">Alami</th>
                  <th className="px-3 py-2 text-right">Lampu</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Target</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {lighting.rooms.map((r) => (
                  <tr key={r.roomId} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-mono text-muted-foreground">LT{r.levelIndex + 1}</td>
                    <td className="px-3 py-2 font-medium">{r.roomName}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.daylightFactorPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-mono">{r.naturalLux}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.artificialLux}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{r.totalLux}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.targetLux}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-semibold",
                        r.status === "TERANG" ? "text-emerald-300" : r.status === "CUKUP" ? "text-amber-300" : "text-rose-300",
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

        {/* Light Fixtures Control Board */}
        <StudioCard className="space-y-3">
          <SectionHeader icon={<Lightbulb className="h-4 w-4 text-amber-300" />} title="Saklar Lampu Interior & Eksterior" />
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
            {project.levels.flatMap((lv) =>
              lv.lights.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{l.name}</div>
                    <div className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
                      LT{lv.index + 1} · {l.lumens} lm · {l.colorTempK}K
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateLight(lv.index as 0 | 1, l.id, { on: !l.on })}
                    className={cn(
                      "min-w-12 rounded-lg px-2.5 py-1 text-[11px] font-bold transition",
                      l.on ? "bg-amber-400/25 text-amber-200 ring-1 ring-amber-400/40" : "bg-white/[0.06] text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {l.on ? "ON" : "OFF"}
                  </button>
                </div>
              )),
            )}
          </div>
        </StudioCard>
      </div>
    </div>
  );
}
