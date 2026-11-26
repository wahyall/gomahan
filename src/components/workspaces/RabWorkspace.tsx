"use client";

import { Fragment, useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { KpiMetric, SectionHeader, StudioCard, StudioConfirmDialog, StudioNumberField, StudioRange } from "@/components/ui/StudioPrimitives";
import { BrickWall, ChevronDown, ChevronRight, Layers, RotateCcw, Ruler, Search, Wallet, X } from "lucide-react";

export function RabWorkspace({ derived, rab }: { derived: DerivedProjectModel; rab: RabSummary }) {
  const project = useStudioStore((s) => s.project);
  const updatePriceItem = useStudioStore((s) => s.updatePriceItem);
  const resetPriceBook = useStudioStore((s) => s.resetPriceBook);
  const patchRabSettings = useStudioStore((s) => s.patchRabSettings);
  const setBudgetCap = useStudioStore((s) => s.setBudgetCap);
  const setBrickPreset = useStudioStore((s) => s.setBrickPreset);

  const [query, setQuery] = useState("");
  const [collapsedDivs, setCollapsedDivs] = useState<Record<string, boolean>>({});
  const [confirmResetPricesOpen, setConfirmResetPricesOpen] = useState(false);

  const settings = project.rabSettings;
  const masonry = derived.masonry;
  const bSpec = project.systems.brick;
  const budgetPct = Math.round((rab.grandTotal / Math.max(1, rab.budgetCapIdr)) * 100);
  const diffRp = rab.budgetCapIdr - rab.grandTotal;

  const qLower = query.trim().toLowerCase();
  const filteredDivisions = rab.divisions
    .map((div) => ({
      ...div,
      rows: div.rows.filter(
        (r) =>
          !qLower ||
          r.uraian.toLowerCase().includes(qLower) ||
          r.ahspCode.toLowerCase().includes(qLower) ||
          r.spek.toLowerCase().includes(qLower) ||
          div.nama.toLowerCase().includes(qLower),
      ),
    }))
    .filter((d) => d.rows.length > 0);

  const toggleDiv = (id: string) => {
    setCollapsedDivs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiMetric
            icon={<BrickWall className="h-4 w-4 text-primary" />}
            label="Kebutuhan Bata"
            value={`${fmtNum(masonry.totalBuyBricks)} bh`}
            sub={`Pasang ${fmtNum(masonry.totalPiecesPlaced)} kpg + ${bSpec.wastePct}% waste`}
          />
          <KpiMetric
            icon={<Layers className="h-4 w-4 text-primary" />}
            label={bSpec.mortarKind === "thinbed" ? "Perekat Thinbed" : "Semen & Pasir (1:5)"}
            value={
              bSpec.mortarKind === "thinbed"
                ? `${fmtNum(masonry.thinbedZak40kg)} zak`
                : `${fmtNum(masonry.cementZak50kg)} zak + ${fmtNum(masonry.sandM3, 1)} m³`
            }
            sub={`Nat ${bSpec.mortarMm} mm · Mortar ${fmtNum(masonry.mortarWithWasteM3, 2)} m³`}
          />
          <KpiMetric
            icon={<Ruler className="h-4 w-4 text-primary" />}
            label="Luas Bersih 2 Lantai"
            value={`${fmtNum(derived.totalNetFloorM2, 2)} m²`}
            sub={`Tebal bata memakai ${fmtNum(derived.totalWallDeductionM2, 2)} m²`}
          />
          <KpiMetric
            icon={<Wallet className="h-4 w-4 text-primary" />}
            label="Grand Total RAB"
            value={fmtRp(rab.grandTotal)}
            tone={rab.overBudget ? "rose" : "emerald"}
            sub={`${fmtRp(rab.perM2NetFloor)}/m² bersih`}
          />
        </div>

        {/* Settings & Markups & Budget Progress */}
        <div className="grid gap-4 lg:grid-cols-3">
          <StudioCard className="space-y-3 text-xs">
            <SectionHeader title="Skema Upah & Target Budget" />
            <div className="flex gap-1 rounded-lg bg-black/30 p-0.5">
              <button
                type="button"
                onClick={() => patchRabSettings({ laborMode: "ahsp_oh" })}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-[11px] font-semibold transition",
                  settings.laborMode === "ahsp_oh" ? "bg-[#f2efe8] text-[#14171c]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                AHSP OH 2023
              </button>
              <button
                type="button"
                onClick={() => patchRabSettings({ laborMode: "borongan_pct" })}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-[11px] font-semibold transition",
                  settings.laborMode === "borongan_pct" ? "bg-[#f2efe8] text-[#14171c]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Borongan %
              </button>
            </div>
            {settings.laborMode === "borongan_pct" && (
              <StudioRange
                label="Persentase Upah Borongan"
                display={`${settings.boronganPct}%`}
                min={15}
                max={45}
                step={1}
                value={settings.boronganPct}
                onChange={(v) => patchRabSettings({ boronganPct: v })}
              />
            )}
            <StudioNumberField
              label="Target Anggaran Maksimal (IDR)"
              step={10_000_000}
              value={rab.budgetCapIdr}
              onChange={(v) => setBudgetCap(v || 450_000_000)}
            />
            <div className="text-[10.5px] font-mono text-muted-foreground">
              Pagu aktif: <span className="font-semibold text-foreground">{fmtRp(rab.budgetCapIdr)}</span>
            </div>
          </StudioCard>

          <StudioCard className="space-y-3 text-xs">
            <SectionHeader
              title="Markup & Cadangan (%)"
              action={
                <button
                  type="button"
                  onClick={() => setConfirmResetPricesOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-border bg-black/25 px-2 py-1 text-[10.5px] font-medium hover:border-primary"
                >
                  <RotateCcw className="h-3 w-3" /> Reset Harga
                </button>
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <StudioNumberField label="Overhead" unit="%" min={0} max={25} step={0.5} value={settings.overheadPct} onChange={(v) => patchRabSettings({ overheadPct: v })} />
              <StudioNumberField label="Profit" unit="%" min={0} max={25} step={0.5} value={settings.profitPct} onChange={(v) => patchRabSettings({ profitPct: v })} />
              <StudioNumberField label="PPN" unit="%" min={0} max={25} step={0.5} value={settings.vatPct} onChange={(v) => patchRabSettings({ vatPct: v })} />
              <StudioNumberField label="Contingency" unit="%" min={0} max={25} step={0.5} value={settings.contingencyPct} onChange={(v) => patchRabSettings({ contingencyPct: v })} />
            </div>
            <div className="text-[10.5px] text-muted-foreground">Basis harga: {project.priceBook.region}</div>
          </StudioCard>

          <StudioCard highlight className="flex flex-col justify-between space-y-2.5 text-xs">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Material Langsung</span>
                <span className="font-mono font-medium tabular-nums">{fmtRp(rab.directMaterialTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Upah Tenaga Kerja</span>
                <span className="font-mono font-medium tabular-nums">{fmtRp(rab.directLaborTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Markup &amp; PPN</span>
                <span className="font-mono font-medium tabular-nums">{fmtRp(rab.overheadAmount + rab.profitAmount + rab.vatAmount + rab.contingencyAmount)}</span>
              </div>
            </div>

            <div className="space-y-1.5 border-t border-primary/25 pt-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span>Pagu Anggaran ({budgetPct}%)</span>
                <span className={cn("font-mono tabular-nums", diffRp >= 0 ? "text-emerald-300" : "text-rose-300")}>
                  {diffRp >= 0 ? `Sisa ${fmtRp(diffRp)}` : `Over ${fmtRp(Math.abs(diffRp))}`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/40">
                <div
                  className={cn("h-full rounded-full transition-all", rab.overBudget ? "bg-rose-400" : "bg-emerald-400")}
                  style={{ width: `${Math.min(100, budgetPct)}%` }}
                />
              </div>
            </div>

            <div className="flex gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setBrickPreset("hebel")}
                className={cn(
                  "flex-1 rounded-lg border py-1.5 text-[11px] font-semibold transition",
                  bSpec.preset === "hebel" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-black/25 hover:border-white/25",
                )}
              >
                Simulasi Hebel
              </button>
              <button
                type="button"
                onClick={() => setBrickPreset("merah")}
                className={cn(
                  "flex-1 rounded-lg border py-1.5 text-[11px] font-semibold transition",
                  bSpec.preset === "merah" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-black/25 hover:border-white/25",
                )}
              >
                Simulasi Bata Merah
              </button>
            </div>
          </StudioCard>
        </div>

        {/* BOQ Filter & Editable Table */}
        <div className="studio-surface overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[#161a21] px-3.5 py-2.5">
            <div className="text-xs font-semibold text-foreground">Daftar Rincian Pekerjaan (BOQ &amp; Harga Satuan Editable)</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari uraian atau kode AHSP..."
                className="h-8 w-56 rounded-lg border border-input bg-[#111418] pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Hapus pencarian"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="bg-[#1b2029] text-left text-[10.5px] font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3.5 py-2.5">Kode AHSP</th>
                  <th className="px-3.5 py-2.5">Uraian Pekerjaan &amp; Rumus Model</th>
                  <th className="px-3.5 py-2.5 text-right">Qty</th>
                  <th className="px-3.5 py-2.5 text-right">Harga Material (Rp)</th>
                  <th className="px-3.5 py-2.5 text-right">Upah (Rp)</th>
                  <th className="px-3.5 py-2.5 text-right">Subtotal (Rp)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {filteredDivisions.map((div) => {
                  const collapsed = Boolean(collapsedDivs[div.id]) && !qLower;
                  return (
                    <Fragment key={div.id}>
                      <tr className="bg-white/[0.04] hover:bg-white/[0.07]">
                        <td colSpan={6} className="p-0">
                          <button
                            type="button"
                            onClick={() => toggleDiv(div.id)}
                            aria-expanded={!collapsed}
                            className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-primary" /> : <ChevronDown className="h-3.5 w-3.5 text-primary" />}
                              <span>Divisi {div.kode} — {div.nama}</span>
                              <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {div.rows.length} item
                              </span>
                            </span>
                            <span className="font-mono font-bold text-primary">{fmtRp(div.subtotal)}</span>
                          </button>
                        </td>
                      </tr>
                      {!collapsed &&
                        div.rows.map((r) => (
                          <tr key={r.id} className="hover:bg-white/[0.02]">
                            <td className="whitespace-nowrap px-3.5 py-2 font-mono text-[10.5px] text-muted-foreground">{r.ahspCode}</td>
                            <td className="px-3.5 py-2">
                              <div className="font-semibold text-foreground">{r.uraian}</div>
                              <div className="text-[10.5px] text-muted-foreground">
                                {r.spek} · <span className="text-primary/80">{r.formulaNote}</span>
                              </div>
                            </td>
                            <td className="px-3.5 py-2 text-right font-mono whitespace-nowrap">
                              {fmtNum(r.qty, r.qty % 1 === 0 ? 0 : 2)} {r.unit}
                            </td>
                            <td className="px-3.5 py-1.5 text-right">
                              <input
                                type="number"
                                min={0}
                                step={500}
                                value={r.materialUnit}
                                onChange={(e) => updatePriceItem(r.priceKey, "materialPrice", Math.max(0, Number(e.target.value) || 0))}
                                className="h-7 w-28 rounded-lg border border-input bg-[#111418] px-2 text-right font-mono text-xs outline-none focus:border-primary"
                              />
                            </td>
                            <td className="px-3.5 py-1.5 text-right">
                              <input
                                type="number"
                                min={0}
                                step={500}
                                disabled={settings.laborMode === "borongan_pct"}
                                value={r.laborUnit}
                                onChange={(e) => updatePriceItem(r.priceKey, "laborPrice", Math.max(0, Number(e.target.value) || 0))}
                                className="h-7 w-24 rounded-lg border border-input bg-[#111418] px-2 text-right font-mono text-xs outline-none focus:border-primary disabled:opacity-40"
                              />
                            </td>
                            <td className="px-3.5 py-2 text-right font-mono font-semibold">{fmtRp(r.subtotal)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <StudioConfirmDialog
        open={confirmResetPricesOpen}
        onCancel={() => setConfirmResetPricesOpen(false)}
        title="Reset Harga Satuan?"
        description="Seluruh harga material dan upah yang Anda ubah akan dikembalikan ke standar AHSP Surabaya 2026 (dapat dibatalkan via Ctrl+Z)."
        confirmLabel="Reset Harga"
        danger
        onConfirm={() => {
          resetPriceBook();
          setConfirmResetPricesOpen(false);
        }}
      />
    </div>
  );
}
