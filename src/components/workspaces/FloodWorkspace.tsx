"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { AlertOctagon, CloudRain, Droplets, ShieldCheck, Waves } from "lucide-react";

export function FloodWorkspace({ derived, flood }: { derived: DerivedProjectModel; flood: FloodSimulationResult }) {
  const project = useStudioStore((s) => s.project);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const patchPeil = useStudioStore((s) => s.patchPeil);
  const patchFloodMitigation = useStudioStore((s) => s.patchFloodMitigation);
  const patchSystems = useStudioStore((s) => s.patchSystems);
  const patchView = useStudioStore((s) => s.patchView);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const sim = project.simulation;
  const peil = project.site.peil;
  const fm = project.floodMitigation;
  const sys = project.systems;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <CloudRain className="h-4 w-4 text-cyan-400" />
              Simulasi Hujan Deras & Proyeksi Banjir Surabaya (0 – 150 cm)
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Memproyeksikan debit limpasan atap shed 10° ke talang depan, kapasitas sumur resapan SNI 03-2453, titik masuk genangan, arus balik WC, dan keamanan listrik PUIL.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              patchView({ showFloodWater: true, showRain: sim.rainIntensityMmH > 0 });
              setWorkspace("build");
            }}
            className="rounded border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25"
          >
            Lihat Simulasi Banjir 3D
          </button>
        </div>

        {/* Sliders: Rain & Flood Depth & Floor Peil */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-cyan-300">Tinggi Air Banjir Jalan</span>
              <span className="font-mono text-base font-bold">{sim.floodDepthCm} cm</span>
            </div>
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              value={sim.floodDepthCm}
              onChange={(e) => patchSimulation({ floodDepthCm: Number(e.target.value) })}
              className="w-full accent-[#22d3ee]"
            />
            <div className="grid grid-cols-5 gap-1">
              {[0, 15, 45, 80, 120].map((cm) => (
                <button
                  key={cm}
                  type="button"
                  onClick={() => patchSimulation({ floodDepthCm: cm })}
                  className={cn(
                    "rounded border py-1 text-[10px] font-semibold",
                    sim.floodDepthCm === cm ? "border-cyan-400 bg-cyan-500/20 text-cyan-200" : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  {cm === 0 ? "Kering" : `${cm} cm`}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-sky-300">Intensitas Hujan (BMKG)</span>
              <span className="font-mono text-base font-bold">{sim.rainIntensityMmH} mm/jam</span>
            </div>
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              value={sim.rainIntensityMmH}
              onChange={(e) => patchSimulation({ rainIntensityMmH: Number(e.target.value) })}
              className="w-full accent-[#38bdf8]"
            />
            <div className="grid grid-cols-4 gap-1">
              {[
                [0, "Cerah"],
                [20, "Sedang"],
                [65, "Lebat"],
                [120, "Badai"],
              ].map(([mm, lbl]) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => patchSimulation({ rainIntensityMmH: Number(mm) })}
                  className={cn(
                    "rounded border py-1 text-[10px] font-semibold",
                    sim.rainIntensityMmH === Number(mm) ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-primary">Peil Lantai LT1 (dari Jalan)</span>
              <span className="font-mono text-base font-bold">+{Math.round(peil.floor1PeilM * 100)} cm</span>
            </div>
            <input
              type="range"
              min={0.15}
              max={1.4}
              step={0.05}
              value={peil.floor1PeilM}
              onChange={(e) =>
                patchPeil({
                  floor1PeilM: Number(e.target.value),
                  terracePeilM: Math.max(0.1, Number((Number(e.target.value) - 0.15).toFixed(2))),
                })
              }
              className="w-full accent-[#df8949]"
            />
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-muted-foreground">Skor Ketahanan Banjir</span>
              <span className="font-mono font-bold text-emerald-300">{flood.floodResilienceScore} / 100</span>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {flood.warnings.length > 0 && (
          <div className="space-y-1.5">
            {flood.warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-red-500/45 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-200">
                <AlertOctagon className="h-4 w-4 shrink-0 text-red-400" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Roof Runoff & Mitigation Controls */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Droplets className="h-4 w-4 text-sky-400" /> Hidraulik Atap Shed 10° & Talang Depan
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border bg-secondary/40 p-2.5">
                <div className="text-[10.5px] text-muted-foreground">Debit Limpasan Atap ({derived.roof.areaM2.toFixed(0)} m²)</div>
                <div className="mt-1 font-mono text-base font-bold">{flood.roofRunoffLps.toFixed(2)} L/detik</div>
              </div>
              <div className="rounded border border-border bg-secondary/40 p-2.5">
                <div className="text-[10.5px] text-muted-foreground">Kapasitas Talang & Pipa Turun</div>
                <div className={cn("mt-1 font-mono text-base font-bold", flood.gutterOverflowRisk ? "text-red-400" : "text-emerald-300")}>
                  {Math.min(flood.gutterCapacityLps, flood.downspoutCapacityLps).toFixed(2)} L/detik
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Lebar Talang Depan (mm)</span>
                <input
                  type="number"
                  min={120}
                  max={350}
                  step={20}
                  value={sys.gutterWidthMm}
                  onChange={(e) => patchSystems({ gutterWidthMm: Math.max(120, Number(e.target.value) || 200) })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Jumlah Pipa Turun (Downspout)</span>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={sys.downspoutCount}
                  onChange={(e) => patchSystems({ downspoutCount: Math.max(1, Number(e.target.value) || 2) })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2 font-mono"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Fitur Mitigasi Banjir (Langsung Masuk RAB)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex cursor-pointer items-center justify-between rounded border border-border bg-secondary/40 px-2.5 py-2">
                <span>Backflow Valve Limbah</span>
                <input type="checkbox" checked={fm.backflowValve} onChange={(e) => patchFloodMitigation({ backflowValve: e.target.checked })} className="accent-[#df8949]" />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded border border-border bg-secondary/40 px-2.5 py-2">
                <span>Sekat Banjir Pintu (60 cm)</span>
                <input type="checkbox" checked={fm.doorFloodBarrier} onChange={(e) => patchFloodMitigation({ doorFloodBarrier: e.target.checked })} className="accent-[#df8949]" />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded border border-border bg-secondary/40 px-2.5 py-2">
                <span>Pompa Celup Kuras</span>
                <input type="checkbox" checked={fm.submersiblePump} onChange={(e) => patchFloodMitigation({ submersiblePump: e.target.checked })} className="accent-[#df8949]" />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded border border-border bg-secondary/40 px-2.5 py-2">
                <span>Waterproof Dinding Bawah</span>
                <input type="checkbox" checked={fm.wallWaterproofing} onChange={(e) => patchFloodMitigation({ wallWaterproofing: e.target.checked })} className="accent-[#df8949]" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs pt-1">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Sumur Resapan SNI 03-2453</span>
                <input
                  type="number"
                  min={0}
                  max={4}
                  value={fm.infiltrationWells}
                  onChange={(e) => patchFloodMitigation({ infiltrationWells: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Tinggi Stop Kontak LT1 (m)</span>
                <input
                  type="number"
                  min={0.3}
                  max={1.5}
                  step={0.1}
                  value={fm.outletHeightM}
                  onChange={(e) => patchFloodMitigation({ outletHeightM: Math.max(0.3, Number(e.target.value) || 0.45) })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2 font-mono"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Zone Impact Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-bold">
            <Waves className="h-4 w-4 text-cyan-400" /> Proyeksi Ketinggian Genangan per Zona pada Banjir {flood.streetFloodCm} cm
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-[10.5px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Zona Rumah</th>
                  <th className="px-3 py-2 text-right">Elevasi Peil</th>
                  <th className="px-3 py-2 text-right">Genangan di Atas Lantai</th>
                  <th className="px-3 py-2 text-left">Mekanisme & Penyebab</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {flood.zoneImpacts.map((z) => (
                  <tr key={z.zoneName}>
                    <td className="px-3 py-2 font-semibold">{z.zoneName}</td>
                    <td className="px-3 py-2 text-right font-mono">+{z.floorPeilCm} cm</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{z.waterDepthInsideCm} cm</td>
                    <td className="px-3 py-2 text-muted-foreground">{z.entryCause}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-bold",
                        z.status === "KERING" ? "text-emerald-400" : z.status === "TERGENANG" ? "text-amber-300" : "text-red-400",
                      )}
                    >
                      {z.status}
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
