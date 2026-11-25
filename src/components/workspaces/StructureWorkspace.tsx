"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

export function StructureWorkspace({ derived: _derived, struct }: { derived: DerivedProjectModel; struct: StructuralReport }) {
  const project = useStudioStore((s) => s.project);
  const patchStructuralParams = useStudioStore((s) => s.patchStructuralParams);
  const patchSoil = useStudioStore((s) => s.patchSoil);
  const patchView = useStudioStore((s) => s.patchView);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const sp = project.structuralParams;
  const soil = project.site.soil;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Analisis Struktur 2 Lantai & Penulangan SNI ({struct.systemLabel})
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Mengacu pada {struct.standards.join(" · ")}. Alat bantu pra-desain — bukan pengganti dokumen struktur bersertifikat SKK/SKA.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                patchView({ xrayRebar: true, showStructure: true });
                setWorkspace("build");
              }}
              className="rounded border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25"
            >
              Lihat X-Ray Tulangan di 3D
            </button>
            <span
              className={cn(
                "flex items-center gap-1 rounded border px-3 py-1.5 text-xs font-bold",
                struct.overallSafe
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-300",
              )}
            >
              {struct.overallSafe ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {struct.overallSafe ? "Pra-Desain Aman" : "Perlu Penyesuaian"}
            </span>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi title="Total Berat Gempa (W)" val={`${fmtNum(struct.totalWeightKn, 0)} kN`} sub={`Geser Dasar V = ${fmtNum(struct.seismicBaseShearKn, 1)} kN (Cs=${struct.seismicCoeffCs.toFixed(3)})`} />
          <Kpi title="Total Beton K-250" val={`${fmtNum(struct.concreteVolumes.totalConcreteM3, 2)} m³`} sub={`Bekisting: ${fmtNum(struct.totalFormworkM2, 1)} m²`} />
          <Kpi title="Total Besi Tulangan (BBS)" val={`${fmtNum(struct.totalRebarKg, 0)} kg`} sub={`${struct.bbs.length} bar mark (fy=${sp.rebarFyMpa} MPa)`} />
          <Kpi title="Simpangan Gempa (Drift)" val={`${(struct.driftRatio * 100).toFixed(2)}%`} sub={`Batas SNI 1726: ${(struct.driftLimit * 100).toFixed(1)}% (${soil.siteClass})`} />
        </div>

        {/* Editable Soil & Material Assumptions */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Parameter Tanah & Mutu Material</h3>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Daya Dukung Izin Tanah (kPa)</span>
                <input
                  type="number"
                  min={40}
                  max={400}
                  value={soil.allowableBearingKpa}
                  onChange={(e) => patchSoil({ allowableBearingKpa: Math.max(40, Number(e.target.value) || 100) })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Kelas Situs Gempa</span>
                <select
                  value={soil.siteClass}
                  onChange={(e) => patchSoil({ siteClass: e.target.value as "SC" | "SD" | "SE" })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2"
                >
                  <option value="SC">SC (Tanah Keras / Batuan Lunak)</option>
                  <option value="SD">SD (Tanah Sedang)</option>
                  <option value="SE">SE (Tanah Lunak Surabaya)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Mutu Beton fc&apos; (MPa)</span>
                <input
                  type="number"
                  min={17}
                  max={40}
                  step={0.5}
                  value={sp.concreteFcMpa}
                  onChange={(e) => patchStructuralParams({ concreteFcMpa: Number(e.target.value) || 21.7 })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Mutu Baja Tulangan fy (MPa)</span>
                <input
                  type="number"
                  min={240}
                  max={500}
                  step={10}
                  value={sp.rebarFyMpa}
                  onChange={(e) => patchStructuralParams({ rebarFyMpa: Number(e.target.value) || 420 })}
                  className="h-8 w-full rounded border border-input bg-secondary px-2 font-mono"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Peringatan & Gerbang Review Insinyur</h3>
            <ul className="space-y-1.5 text-xs">
              {struct.assumptions.map((a, i) => (
                <li key={i} className="text-[11px] text-muted-foreground">• {a}</li>
              ))}
            </ul>
            {struct.warnings.map((w, i) => (
              <div key={i} className="rounded border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                {w}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={sp.engineerReviewed}
                  onChange={(e) => patchStructuralParams({ engineerReviewed: e.target.checked })}
                  className="accent-[#df8949]"
                />
                <span>Sudah direview oleh Tenaga Ahli / Kontraktor (Syarat Export Final)</span>
              </label>
              <input
                type="text"
                placeholder="Nama Peninjau / SKK"
                value={sp.reviewerName}
                onChange={(e) => patchStructuralParams({ reviewerName: e.target.value })}
                className="h-7 rounded border border-input bg-secondary px-2 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Foundations & Columns Check */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-3 py-2 text-xs font-bold">Pemeriksaan Pondasi ({struct.foundations.length} Titik)</div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-[10.5px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left">Titik</th>
                    <th className="px-2.5 py-1.5 text-left">Tipe</th>
                    <th className="px-2.5 py-1.5 text-right">Tegangan</th>
                    <th className="px-2.5 py-1.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {struct.foundations.map((f) => (
                    <tr key={f.id}>
                      <td className="px-2.5 py-1.5 font-mono font-bold">{f.id}</td>
                      <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground">{f.sizeLabel}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">{f.bearingPressureKpa.toFixed(1)} / {f.allowableBearingKpa} kPa</td>
                      <td className={cn("px-2.5 py-1.5 text-right font-bold", f.status === "AMAN" ? "text-emerald-400" : "text-amber-400")}>{f.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-3 py-2 text-xs font-bold">Pemeriksaan Kolom & Balok Utama</div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-[10.5px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left">Elemen</th>
                    <th className="px-2.5 py-1.5 text-left">Tulangan / Profil</th>
                    <th className="px-2.5 py-1.5 text-right">Rasio D/C</th>
                    <th className="px-2.5 py-1.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {struct.columns.slice(0, 12).map((c) => (
                    <tr key={c.id}>
                      <td className="px-2.5 py-1.5 font-mono">{c.id} ({Math.round(c.widthM * 100)}×{Math.round(c.depthM * 100)})</td>
                      <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground">{c.rebarSpec}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">{(c.utilizationRatio * 100).toFixed(0)}%</td>
                      <td className={cn("px-2.5 py-1.5 text-right font-bold", c.status === "AMAN" ? "text-emerald-400" : "text-amber-400")}>{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Bar Bending Schedule (BBS) */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-bold">Daftar Potongan Besi (Bar Bending Schedule / BBS) — Siap Delegasi Tukang Besi</span>
            <span className="font-mono text-xs font-bold text-primary">Total: {fmtNum(struct.totalRebarKg, 1)} kg</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-[10.5px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Mark</th>
                  <th className="px-3 py-2 text-left">Elemen Struktur</th>
                  <th className="px-3 py-2 text-center">Dia</th>
                  <th className="px-3 py-2 text-left">Bentuk Tekuk</th>
                  <th className="px-3 py-2 text-right">Potong (m)</th>
                  <th className="px-3 py-2 text-right">Jumlah</th>
                  <th className="px-3 py-2 text-right">Total (m)</th>
                  <th className="px-3 py-2 text-right">Berat (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {struct.bbs.map((b) => (
                  <tr key={b.barMark}>
                    <td className="px-3 py-2 font-mono font-bold text-primary">{b.barMark}</td>
                    <td className="px-3 py-2">{b.element}</td>
                    <td className="px-3 py-2 text-center font-mono">D{b.diameterMm}</td>
                    <td className="px-3 py-2 text-muted-foreground">{b.shape}</td>
                    <td className="px-3 py-2 text-right font-mono">{b.cutLengthM.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{b.count}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtNum(b.totalLengthM, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{fmtNum(b.totalWeightKg, 1)}</td>
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

function Kpi({ title, val, sub }: { title: string; val: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-1 font-mono text-lg font-bold text-foreground">{val}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
