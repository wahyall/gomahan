"use client";

import { Fragment } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { BrickWall, Layers, RotateCcw, Ruler, Wallet } from "lucide-react";

export function RabWorkspace({ derived, rab }: { derived: DerivedProjectModel; rab: RabSummary }) {
  const project = useStudioStore((s) => s.project);
  const updatePriceItem = useStudioStore((s) => s.updatePriceItem);
  const resetPriceBook = useStudioStore((s) => s.resetPriceBook);
  const patchRabSettings = useStudioStore((s) => s.patchRabSettings);
  const setBudgetCap = useStudioStore((s) => s.setBudgetCap);
  const setBrickPreset = useStudioStore((s) => s.setBrickPreset);

  const settings = project.rabSettings;
  const masonry = derived.masonry;
  const bSpec = project.systems.brick;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<BrickWall className="h-4 w-4 text-primary" />}
            title="Kebutuhan Bata"
            val={`${fmtNum(masonry.totalBuyBricks)} buah`}
            sub={`Terpasang ${fmtNum(masonry.totalPiecesPlaced)} (potongan ${fmtNum(masonry.cutPiecesCount)}) + waste ${bSpec.wastePct}%`}
          />
          <StatCard
            icon={<Layers className="h-4 w-4 text-primary" />}
            title={bSpec.mortarKind === "thinbed" ? "Perekat Thinbed" : "Semen & Pasir (1:5)"}
            val={bSpec.mortarKind === "thinbed" ? `${fmtNum(masonry.thinbedZak40kg)} zak 40kg` : `${fmtNum(masonry.cementZak50kg)} zak + ${fmtNum(masonry.sandM3, 1)} m³`}
            sub={`Nat ${bSpec.mortarMm} mm · Volume mortar ${fmtNum(masonry.mortarWithWasteM3, 2)} m³`}
          />
          <StatCard
            icon={<Ruler className="h-4 w-4 text-primary" />}
            title="Luas Bersih 2 Lantai"
            val={`${fmtNum(derived.totalNetFloorM2, 2)} m²`}
            sub={`Tebal bata memakai ${fmtNum(derived.totalWallDeductionM2, 2)} m² (${fmtNum(derived.totalWallDeductionPct, 1)}%) dari tapak`}
          />
          <StatCard
            icon={<Wallet className="h-4 w-4 text-primary" />}
            title="Grand Total RAB"
            val={fmtRp(rab.grandTotal)}
            sub={`${fmtRp(rab.perM2NetFloor)} / m² bersih · ${rab.overBudget ? "Melebihi Target" : "Masuk Target"}`}
          />
        </div>

        {/* Settings & Markups & What-if Quick Toggle */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5 text-xs">
            <div className="font-bold uppercase tracking-wider text-muted-foreground">Skema Upah & Target Budget</div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => patchRabSettings({ laborMode: "ahsp_oh" })}
                className={cn("flex-1 rounded border py-1 font-semibold", settings.laborMode === "ahsp_oh" ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground")}
              >
                AHSP OH 2023
              </button>
              <button
                type="button"
                onClick={() => patchRabSettings({ laborMode: "borongan_pct" })}
                className={cn("flex-1 rounded border py-1 font-semibold", settings.laborMode === "borongan_pct" ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground")}
              >
                Borongan %
              </button>
            </div>
            {settings.laborMode === "borongan_pct" && (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Persentase Upah Borongan</span>
                  <span className="font-mono font-bold">{settings.boronganPct}%</span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={45}
                  value={settings.boronganPct}
                  onChange={(e) => patchRabSettings({ boronganPct: Number(e.target.value) })}
                  className="w-full accent-[#df8949]"
                />
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">Target Anggaran Maksimal (IDR)</span>
              <input
                type="number"
                step={10_000_000}
                value={rab.budgetCapIdr}
                onChange={(e) => setBudgetCap(Number(e.target.value) || 450_000_000)}
                className="h-8 w-full rounded border border-input bg-secondary px-2 text-right font-mono"
              />
            </label>
          </div>

          <div className="rounded-lg border border-border bg-card p-3.5 space-y-2 text-xs">
            <div className="font-bold uppercase tracking-wider text-muted-foreground">Markup & Cadangan (%)</div>
            <div className="grid grid-cols-2 gap-2">
              <MarkupInput label="Overhead %" val={settings.overheadPct} onChange={(v) => patchRabSettings({ overheadPct: v })} />
              <MarkupInput label="Profit Kontraktor %" val={settings.profitPct} onChange={(v) => patchRabSettings({ profitPct: v })} />
              <MarkupInput label="PPN %" val={settings.vatPct} onChange={(v) => patchRabSettings({ vatPct: v })} />
              <MarkupInput label="Contingency %" val={settings.contingencyPct} onChange={(v) => patchRabSettings({ contingencyPct: v })} />
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10.5px] text-muted-foreground">{project.priceBook.region}</span>
              <button
                type="button"
                onClick={resetPriceBook}
                className="flex items-center gap-1 rounded border border-border bg-secondary px-2 py-1 text-[10.5px] hover:border-primary"
              >
                <RotateCcw className="h-3 w-3" /> Reset Harga Surabaya
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/10 p-3.5 text-xs space-y-1.5">
            <div className="flex justify-between"><span>Material Langsung</span><span className="font-mono">{fmtRp(rab.directMaterialTotal)}</span></div>
            <div className="flex justify-between"><span>Upah Tenaga Kerja</span><span className="font-mono">{fmtRp(rab.directLaborTotal)}</span></div>
            <div className="flex justify-between"><span>Overhead + Profit + PPN + Cadangan</span><span className="font-mono">{fmtRp(rab.overheadAmount + rab.profitAmount + rab.vatAmount + rab.contingencyAmount)}</span></div>
            <div className="flex justify-between border-t border-primary/25 pt-1.5 text-sm font-bold text-foreground">
              <span>Grand Total RAB</span>
              <span className="font-mono text-primary">{fmtRp(rab.grandTotal)}</span>
            </div>
            <div className="flex gap-1 pt-1">
              <button type="button" onClick={() => setBrickPreset("hebel")} className="flex-1 rounded border border-border bg-card py-1 text-[10px] font-semibold hover:border-primary">
                Uji Hebel
              </button>
              <button type="button" onClick={() => setBrickPreset("merah")} className="flex-1 rounded border border-border bg-card py-1 text-[10px] font-semibold hover:border-primary">
                Uji Bata Merah
              </button>
            </div>
          </div>
        </div>

        {/* Full Editable BOQ Table */}
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-muted text-left text-[10.5px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Kode AHSP</th>
                <th className="px-3 py-2">Uraian Pekerjaan & Rumus Model</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Harga Material (Rp)</th>
                <th className="px-3 py-2 text-right">Upah (Rp)</th>
                <th className="px-3 py-2 text-right">Subtotal (Rp)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rab.divisions.map((div) => (
                <Fragment key={div.id}>
                  <tr className="bg-secondary/70">
                    <td colSpan={5} className="px-3 py-2 font-bold uppercase tracking-wide text-foreground">
                      Divisi {div.kode} — {div.nama}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-primary">{fmtRp(div.subtotal)}</td>
                  </tr>
                  {div.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono text-[10.5px] text-muted-foreground">{r.ahspCode}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-foreground">{r.uraian}</div>
                        <div className="text-[10.5px] text-muted-foreground">{r.spek} · <i className="text-primary/80">{r.formulaNote}</i></div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                        {fmtNum(r.qty, r.qty % 1 === 0 ? 0 : 2)} {r.unit}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          min={0}
                          step={500}
                          value={r.materialUnit}
                          onChange={(e) => updatePriceItem(r.priceKey, "materialPrice", Math.max(0, Number(e.target.value) || 0))}
                          className="h-7 w-28 rounded border border-input bg-background px-2 text-right font-mono text-xs outline-none focus:border-primary"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          min={0}
                          step={500}
                          disabled={settings.laborMode === "borongan_pct"}
                          value={r.laborUnit}
                          onChange={(e) => updatePriceItem(r.priceKey, "laborPrice", Math.max(0, Number(e.target.value) || 0))}
                          className="h-7 w-24 rounded border border-input bg-background px-2 text-right font-mono text-xs outline-none focus:border-primary disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{fmtRp(r.subtotal)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, title, val, sub }: { icon: React.ReactNode; title: string; val: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon} {title}
      </div>
      <div className="mt-1 font-mono text-lg font-bold text-foreground">{val}</div>
      <div className="mt-0.5 text-[10.5px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function MarkupInput({ label, val, onChange }: { label: string; val: number; onChange: (v: number) => void }) {
  return (
    <label className="space-y-0.5">
      <span className="text-[10.5px] text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        max={25}
        step={0.5}
        value={val}
        onChange={(e) => onChange(Math.max(0, Math.min(25, Number(e.target.value) || 0)))}
        className="h-7 w-full rounded border border-input bg-secondary px-2 text-right font-mono"
      />
    </label>
  );
}
