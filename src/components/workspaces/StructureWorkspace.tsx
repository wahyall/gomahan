"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import {
  KpiMetric,
  SectionHeader,
  StudioCard,
  StudioNumberField,
  StudioSelect,
  StudioSwitch,
} from "@/components/ui/StudioPrimitives";
import { AlertTriangle, Boxes, CheckCircle2, Eye, ShieldCheck } from "lucide-react";

export function StructureWorkspace({ derived: _derived, struct }: { derived: DerivedProjectModel; struct: StructuralReport }) {
  const project = useStudioStore((s) => s.project);
  const view = useStudioStore((s) => s.view);
  const patchStructuralParams = useStudioStore((s) => s.patchStructuralParams);
  const patchSoil = useStudioStore((s) => s.patchSoil);
  const patchView = useStudioStore((s) => s.patchView);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const sp = project.structuralParams;
  const soil = project.site.soil;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <StudioCard>
          <SectionHeader
            icon={<ShieldCheck className="h-4 w-4" />}
            title={`Analisis Struktur SNI (${struct.systemLabel})`}
            subtitle={`Acuan ${struct.standards.join(" · ")}. Alat bantu pra-desain — verifikasi final tetap melalui SKK/SKA.`}
            action={
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold",
                  struct.overallSafe
                    ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-300"
                    : "border-amber-500/35 bg-amber-500/15 text-amber-300",
                )}
              >
                {struct.overallSafe ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {struct.overallSafe ? "Pra-Desain Aman" : "Perlu Penyesuaian"}
              </span>
            }
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => patchView({ xrayRebar: !view.xrayRebar, showStructure: true })}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition",
                view.xrayRebar
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-foreground hover:border-white/25",
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              {view.xrayRebar ? "X-Ray Besi Aktif" : "Tampilkan X-Ray Besi 3D"}
            </button>
            <button
              type="button"
              onClick={() => {
                patchView({ xrayRebar: true, showStructure: true });
                setWorkspace("build");
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-black/25 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Boxes className="h-3.5 w-3.5" /> Edit di Build Mode
            </button>
          </div>
        </StudioCard>

        {/* Responsive KPI Grid tailored to @container width (2x2 on split panel, 4-col when wide) */}
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          <KpiMetric
            label="Total Berat Gempa"
            value={`${fmtNum(struct.totalWeightKn, 0)} kN`}
            sub={`Geser V = ${fmtNum(struct.seismicBaseShearKn, 1)} kN (Cs=${struct.seismicCoeffCs.toFixed(3)})`}
          />
          <KpiMetric
            label="Total Beton K-250"
            value={`${fmtNum(struct.concreteVolumes.totalConcreteM3, 2)} m³`}
            sub={`Bekisting ${fmtNum(struct.totalFormworkM2, 1)} m²`}
          />
          <KpiMetric
            label="Total Besi Tulangan"
            value={`${fmtNum(struct.totalRebarKg, 0)} kg`}
            tone="primary"
            sub={`${struct.bbs.length} bar mark · fy ${sp.rebarFyMpa} MPa`}
          />
          <KpiMetric
            label="Simpangan Gempa"
            value={`${(struct.driftRatio * 100).toFixed(2)}%`}
            tone={struct.driftRatio <= struct.driftLimit ? "emerald" : "rose"}
            sub={`Batas SNI ${(struct.driftLimit * 100).toFixed(1)}% (${soil.siteClass})`}
          />
        </div>

        {/* Soil, Material & Review Gate */}
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
          <StudioCard className="space-y-3">
            <SectionHeader title="Parameter Tanah & Mutu Material" />
            <div className="grid grid-cols-2 gap-2.5">
              <StudioNumberField
                label="Daya Dukung Tanah"
                unit="kPa"
                min={40}
                max={400}
                value={soil.allowableBearingKpa}
                onChange={(v) => patchSoil({ allowableBearingKpa: Math.max(40, v) })}
              />
              <StudioSelect
                label="Kelas Situs Gempa"
                value={soil.siteClass}
                onChange={(v) => patchSoil({ siteClass: v as "SC" | "SD" | "SE" })}
                options={[
                  ["SC", "SC (Keras)"],
                  ["SD", "SD (Sedang)"],
                  ["SE", "SE (Lunak Sby)"],
                ]}
              />
              <StudioNumberField
                label="Mutu Beton fc'"
                unit="MPa"
                min={17}
                max={40}
                step={0.5}
                value={sp.concreteFcMpa}
                onChange={(v) => patchStructuralParams({ concreteFcMpa: v })}
              />
              <StudioNumberField
                label="Baja Tulangan fy"
                unit="MPa"
                min={240}
                max={500}
                step={10}
                value={sp.rebarFyMpa}
                onChange={(v) => patchStructuralParams({ rebarFyMpa: v })}
              />
            </div>
          </StudioCard>

          <StudioCard className="space-y-3">
            <SectionHeader title="Catatan & Gerbang Review Insinyur" />
            <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              {struct.assumptions.map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
            {struct.warnings.map((w, i) => (
              <div key={i} className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                {w}
              </div>
            ))}
            <div className="space-y-2 border-t border-border pt-2.5">
              <StudioSwitch
                label="Sudah direview Tenaga Ahli / Kontraktor"
                description="Syarat tanda terbit dokumen Final pada menu Ekspor"
                checked={sp.engineerReviewed}
                onChange={(v) => patchStructuralParams({ engineerReviewed: v })}
              />
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Nama Peninjau / No. SKK</span>
                <input
                  type="text"
                  placeholder="Contoh: Ir. Budi Santoso, ST (SKK Muda)"
                  value={sp.reviewerName}
                  onChange={(e) => patchStructuralParams({ reviewerName: e.target.value })}
                  className="h-9 w-full rounded-lg border border-input bg-[#13161c] px-2.5 text-xs text-foreground outline-none focus:border-primary"
                />
              </label>
            </div>
          </StudioCard>
        </div>

        {/* Foundations & Columns Check */}
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
          <div className="studio-surface overflow-hidden rounded-xl">
            <div className="border-b border-border px-3.5 py-2.5 text-xs font-semibold">
              Pemeriksaan Pondasi ({struct.foundations.length} Titik)
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#1a1f28] text-[10.5px] font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Titik</th>
                    <th className="px-3 py-2 text-left">Tipe</th>
                    <th className="px-3 py-2 text-right">Tegangan</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {struct.foundations.map((f) => (
                    <tr key={f.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-mono font-semibold">{f.id}</td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">{f.sizeLabel}</td>
                      <td className="px-3 py-2 text-right font-mono">{f.bearingPressureKpa.toFixed(1)}/{f.allowableBearingKpa}</td>
                      <td className={cn("px-3 py-2 text-right font-semibold", f.status === "AMAN" ? "text-emerald-300" : "text-amber-300")}>
                        {f.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="studio-surface overflow-hidden rounded-xl">
            <div className="border-b border-border px-3.5 py-2.5 text-xs font-semibold">Pemeriksaan Kolom Utama</div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#1a1f28] text-[10.5px] font-semibold text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Elemen</th>
                    <th className="px-3 py-2 text-left">Tulangan</th>
                    <th className="px-3 py-2 text-right">Rasio D/C</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {struct.columns.slice(0, 12).map((c) => (
                    <tr key={c.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-mono font-semibold">
                        {c.id} <span className="font-normal text-muted-foreground">({Math.round(c.widthM * 100)}×{Math.round(c.depthM * 100)})</span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">{c.rebarSpec}</td>
                      <td className="px-3 py-2 text-right font-mono">{(c.utilizationRatio * 100).toFixed(0)}%</td>
                      <td className={cn("px-3 py-2 text-right font-semibold", c.status === "AMAN" ? "text-emerald-300" : "text-amber-300")}>
                        {c.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Bar Bending Schedule */}
        <div className="studio-surface overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
            <span className="text-xs font-semibold">Daftar Potongan Besi (Bar Bending Schedule / BBS)</span>
            <span className="font-mono text-xs font-bold text-primary tabular-nums">Total: {fmtNum(struct.totalRebarKg, 1)} kg</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#1a1f28] text-[10.5px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Mark</th>
                  <th className="px-3 py-2 text-left">Elemen</th>
                  <th className="px-3 py-2 text-center">Dia</th>
                  <th className="px-3 py-2 text-left">Tekukan</th>
                  <th className="px-3 py-2 text-right">Potong</th>
                  <th className="px-3 py-2 text-right">Jml</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Berat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {struct.bbs.map((b) => (
                  <tr key={b.barMark} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-mono font-bold text-primary">{b.barMark}</td>
                    <td className="px-3 py-2">{b.element}</td>
                    <td className="px-3 py-2 text-center font-mono">D{b.diameterMm}</td>
                    <td className="px-3 py-2 text-muted-foreground">{b.shape}</td>
                    <td className="px-3 py-2 text-right font-mono">{b.cutLengthM.toFixed(2)} m</td>
                    <td className="px-3 py-2 text-right font-mono">{b.count}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtNum(b.totalLengthM, 1)} m</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{fmtNum(b.totalWeightKg, 1)} kg</td>
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
