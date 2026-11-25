"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import {
  KpiMetric,
  SectionHeader,
  StudioCard,
  StudioNumberField,
  StudioRange,
  StudioSwitch,
} from "@/components/ui/StudioPrimitives";
import { AlertOctagon, CloudRain, Droplets, Eye, ShieldCheck, Waves } from "lucide-react";

export function FloodWorkspace({ derived, flood }: { derived: DerivedProjectModel; flood: FloodSimulationResult }) {
  const project = useStudioStore((s) => s.project);
  const view = useStudioStore((s) => s.view);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const patchPeil = useStudioStore((s) => s.patchPeil);
  const patchFloodMitigation = useStudioStore((s) => s.patchFloodMitigation);
  const patchSystems = useStudioStore((s) => s.patchSystems);
  const patchView = useStudioStore((s) => s.patchView);

  const sim = project.simulation;
  const peil = project.site.peil;
  const fm = project.floodMitigation;
  const sys = project.systems;

  const waterVisible = view.showFloodWater || view.showRain;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <StudioCard>
          <SectionHeader
            icon={<CloudRain className="h-4 w-4 text-cyan-400" />}
            title="Simulasi Hujan & Proyeksi Banjir (0–150 cm)"
            subtitle="Menghitung limpasan atap shed ke talang depan, sumur resapan SNI 03-2453, batas genangan teras/LT1, serta keamanan instalasi PUIL."
            action={
              <button
                type="button"
                onClick={() => patchView({ showFloodWater: !waterVisible, showRain: !waterVisible })}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition",
                  waterVisible
                    ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100"
                    : "border-border bg-secondary text-foreground hover:border-white/25",
                )}
              >
                <Eye className="h-3.5 w-3.5" />
                {waterVisible ? "Animasi Hujan/Air Aktif" : "Aktifkan Air &amp; Hujan 3D"}
              </button>
            }
          />
        </StudioCard>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
          <KpiMetric
            label="Skor Ketahanan Banjir"
            value={`${flood.floodResilienceScore} / 100`}
            tone={flood.floodResilienceScore >= 80 ? "emerald" : flood.floodResilienceScore >= 55 ? "amber" : "rose"}
          />
          <KpiMetric
            label="Debit Limpasan Atap"
            value={`${flood.roofRunoffLps.toFixed(2)} L/dt`}
            sub={`Luas atap ${derived.roof.areaM2.toFixed(0)} m²`}
          />
          <KpiMetric
            label="Kapasitas Talang"
            value={`${Math.min(flood.gutterCapacityLps, flood.downspoutCapacityLps).toFixed(2)} L/dt`}
            tone={flood.gutterOverflowRisk ? "rose" : "emerald"}
            sub={flood.gutterOverflowRisk ? "Risiko luapan talang" : "Kapasitas memadai"}
            className="col-span-2 @xl:col-span-1"
          />
        </div>

        {/* Sliders: Rain & Flood Depth & Floor Peil */}
        <div className="grid grid-cols-1 gap-3.5 @md:grid-cols-2">
          <StudioCard className="space-y-3">
            <StudioRange
              label="Tinggi Air Banjir Jalan"
              display={`${sim.floodDepthCm} cm`}
              min={0}
              max={150}
              step={5}
              value={sim.floodDepthCm}
              accentHex="#22d3ee"
              onChange={(v) => patchSimulation({ floodDepthCm: v })}
            />
            <div className="grid grid-cols-5 gap-1">
              {[0, 15, 45, 80, 120].map((cm) => (
                <button
                  key={cm}
                  type="button"
                  onClick={() => patchSimulation({ floodDepthCm: cm })}
                  className={cn(
                    "rounded-lg border py-1 text-[10.5px] font-semibold transition",
                    sim.floodDepthCm === cm
                      ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {cm === 0 ? "Kering" : `${cm}cm`}
                </button>
              ))}
            </div>
          </StudioCard>

          <StudioCard className="space-y-3">
            <StudioRange
              label="Intensitas Hujan (BMKG)"
              display={`${sim.rainIntensityMmH} mm/jam`}
              min={0}
              max={150}
              step={5}
              value={sim.rainIntensityMmH}
              accentHex="#38bdf8"
              onChange={(v) => patchSimulation({ rainIntensityMmH: v })}
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
                    "rounded-lg border py-1 text-[10.5px] font-semibold transition",
                    sim.rainIntensityMmH === Number(mm)
                      ? "border-sky-400/60 bg-sky-500/20 text-sky-100"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </StudioCard>
        </div>

        <StudioCard>
          <StudioRange
            label="Peil Elevasi Lantai LT1 (terhadap permukaan jalan)"
            display={`+${Math.round(peil.floor1PeilM * 100)} cm`}
            min={0.15}
            max={1.4}
            step={0.05}
            value={peil.floor1PeilM}
            onChange={(v) =>
              patchPeil({
                floor1PeilM: v,
                terracePeilM: Math.max(0.1, Number((v - 0.15).toFixed(2))),
              })
            }
          />
        </StudioCard>

        {flood.warnings.length > 0 && (
          <div className="space-y-1.5">
            {flood.warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200">
                <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Roof Hydraulics & Flood Mitigation */}
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
          <StudioCard className="space-y-3">
            <SectionHeader icon={<Droplets className="h-4 w-4 text-sky-400" />} title="Hidraulik Talang Depan" />
            <div className="grid grid-cols-2 gap-2.5">
              <StudioNumberField
                label="Lebar Talang"
                unit="mm"
                min={120}
                max={350}
                step={20}
                value={sys.gutterWidthMm}
                onChange={(v) => patchSystems({ gutterWidthMm: Math.max(120, v) })}
              />
              <StudioNumberField
                label="Pipa Turun"
                unit="pipa"
                min={1}
                max={6}
                value={sys.downspoutCount}
                onChange={(v) => patchSystems({ downspoutCount: Math.max(1, v) })}
              />
            </div>
          </StudioCard>

          <StudioCard className="space-y-3">
            <SectionHeader
              icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
              title="Fitur Mitigasi Banjir (Otomatis Masuk RAB)"
            />
            <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
              <StudioSwitch
                label="Backflow Valve Limbah"
                checked={fm.backflowValve}
                onChange={(v) => patchFloodMitigation({ backflowValve: v })}
              />
              <StudioSwitch
                label="Sekat Banjir Pintu (60 cm)"
                checked={fm.doorFloodBarrier}
                onChange={(v) => patchFloodMitigation({ doorFloodBarrier: v })}
              />
              <StudioSwitch
                label="Pompa Celup Kuras"
                checked={fm.submersiblePump}
                onChange={(v) => patchFloodMitigation({ submersiblePump: v })}
              />
              <StudioSwitch
                label="Waterproof Dinding Bawah"
                checked={fm.wallWaterproofing}
                onChange={(v) => patchFloodMitigation({ wallWaterproofing: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <StudioNumberField
                label="Sumur Resapan SNI"
                unit="titik"
                min={0}
                max={4}
                value={fm.infiltrationWells}
                onChange={(v) => patchFloodMitigation({ infiltrationWells: Math.max(0, v) })}
              />
              <StudioNumberField
                label="Tinggi Stop Kontak LT1"
                unit="m"
                min={0.3}
                max={1.5}
                step={0.1}
                value={fm.outletHeightM}
                onChange={(v) => patchFloodMitigation({ outletHeightM: Math.max(0.3, v) })}
              />
            </div>
          </StudioCard>
        </div>

        {/* Zone Impact Table */}
        <div className="studio-surface overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5 text-xs font-semibold">
            <Waves className="h-4 w-4 text-cyan-400" /> Proyeksi Ketinggian Genangan pada Banjir {flood.streetFloodCm} cm
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#1a1f28] text-[10.5px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Zona Rumah</th>
                  <th className="px-3 py-2 text-right">Peil</th>
                  <th className="px-3 py-2 text-right">Genangan</th>
                  <th className="px-3 py-2 text-left">Mekanisme</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {flood.zoneImpacts.map((z) => (
                  <tr key={z.zoneName} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-semibold">{z.zoneName}</td>
                    <td className="px-3 py-2 text-right font-mono">+{z.floorPeilCm} cm</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{z.waterDepthInsideCm} cm</td>
                    <td className="px-3 py-2 text-muted-foreground">{z.entryCause}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-semibold",
                        z.status === "KERING" ? "text-emerald-300" : z.status === "TERGENANG" ? "text-amber-300" : "text-rose-300",
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
