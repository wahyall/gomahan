"use client";

import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { RabSummary } from "@/lib/quantities/rabEngine";

type RabRow = RabSummary["rows"][number];
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";
import { KpiMetric, SectionHeader, StudioCard, StudioConfirmDialog, StudioNumberField, StudioRange } from "@/components/ui/StudioPrimitives";
import { BrickWall, ChevronDown, ChevronRight, Layers, Pencil, RotateCcw, Ruler, Search, Wallet, X } from "lucide-react";

const RabPriceInput = memo(function RabPriceInput({
  value,
  disabled,
  className,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  className: string;
  onCommit: (nextVal: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const commitNow = (raw: string, clearDraft: boolean) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = Math.max(0, Number(raw) || 0);
    if (next !== value) {
      onCommit(next);
    }
    if (clearDraft) setDraft(null);
  };

  return (
    <input
      type="number"
      min={0}
      step={500}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(e) => {
        const nextStr = e.target.value;
        setDraft(nextStr);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => commitNow(nextStr, false), 250);
      }}
      onBlur={() => commitNow(draft ?? String(value), true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commitNow(draft ?? String(value), true);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
});

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
  const [editingRow, setEditingRow] = useState<RabRow | null>(null);
  const [editField, setEditField] = useState<"materialPrice" | "laborPrice">("materialPrice");
  const [editDraft, setEditDraft] = useState("0");

  const settings = project.rabSettings;
  const masonry = derived.masonry;
  const bSpec = project.systems.brick;
  const budgetPct = Math.round((rab.grandTotal / Math.max(1, rab.budgetCapIdr)) * 100);
  const diffRp = rab.budgetCapIdr - rab.grandTotal;

  const qLower = query.trim().toLowerCase();
  const filteredDivisions = useMemo(
    () =>
      rab.divisions
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
        .filter((d) => d.rows.length > 0),
    [rab.divisions, qLower],
  );

  const toggleDiv = (id: string) => {
    setCollapsedDivs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openMobilePriceEditor = (row: RabRow) => {
    setEditingRow(row);
    setEditField("materialPrice");
    setEditDraft(String(row.materialUnit));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Sticky Mobile Budget Header */}
        <div className="sticky top-0 z-10 -mx-3 border-b border-white/10 bg-[#0f1216]/95 px-3 py-2.5 backdrop-blur-md md:hidden">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10.5px] font-medium text-muted-foreground">Total RAB ({budgetPct}% Pagu)</div>
              <div className={cn("font-mono text-base font-bold tabular-nums", rab.overBudget ? "text-rose-300" : "text-emerald-300")}>
                {fmtRp(rab.grandTotal)}
              </div>
            </div>
            <div className="text-right">
              <div className={cn("rounded-lg px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums", diffRp >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>
                {diffRp >= 0 ? `Sisa ${fmtRp(diffRp)}` : `Over ${fmtRp(Math.abs(diffRp))}`}
              </div>
            </div>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/50">
            <div
              className={cn("h-full rounded-full transition-all", rab.overBudget ? "bg-rose-400" : "bg-emerald-400")}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
          </div>
        </div>
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
            <div className="relative w-full sm:w-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari uraian atau kode AHSP..."
                className="min-h-11 w-full rounded-lg border border-input bg-[#111418] pl-8 pr-9 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none md:min-h-8 md:h-8 md:w-56 md:pr-7 md:text-xs"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Hapus pencarian"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 flex min-h-8 min-w-8 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Mobile BOQ Accordion + 2-Line Cards */}
          <div className="divide-y divide-border md:hidden">
            {filteredDivisions.map((div) => {
              const collapsed = Boolean(collapsedDivs[div.id]) && !qLower;
              return (
                <div key={div.id}>
                  <button
                    type="button"
                    onClick={() => toggleDiv(div.id)}
                    aria-expanded={!collapsed}
                    className="flex min-h-12 w-full items-center justify-between gap-2 bg-white/[0.04] px-3.5 py-2.5 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        {collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-primary" /> : <ChevronDown className="h-4 w-4 shrink-0 text-primary" />}
                        <span className="truncate">Div. {div.kode} — {div.nama}</span>
                      </div>
                      <div className="mt-0.5 pl-5 font-mono text-[10.5px] text-muted-foreground">{div.rows.length} item</div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-primary/15 px-2 py-1 font-mono text-xs font-bold text-primary tabular-nums">
                      {fmtRp(div.subtotal)}
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="divide-y divide-border/70">
                      {div.rows.map((r) => (
                        <div key={r.id} className="space-y-2 px-3.5 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-foreground">{r.uraian}</div>
                              <div className="mt-0.5 text-[10.5px] text-muted-foreground">{r.spek}</div>
                            </div>
                            <div className="shrink-0 text-right font-mono text-xs font-bold text-foreground tabular-nums">
                              {fmtRp(r.subtotal)}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
                              {fmtNum(r.qty, r.qty % 1 === 0 ? 0 : 2)} {r.unit} · {r.ahspCode}
                            </div>
                            <button
                              type="button"
                              onClick={() => openMobilePriceEditor(r)}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/15 px-3 text-xs font-semibold text-[#f6ba86] active:scale-[0.97]"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Edit Harga</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
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
                              <RabPriceInput
                                value={r.materialUnit}
                                onCommit={(val) => updatePriceItem(r.priceKey, "materialPrice", val)}
                                className="h-7 w-28 rounded-lg border border-input bg-[#111418] px-2 text-right font-mono text-xs outline-none focus:border-primary"
                              />
                            </td>
                            <td className="px-3.5 py-1.5 text-right">
                              <RabPriceInput
                                disabled={settings.laborMode === "borongan_pct"}
                                value={r.laborUnit}
                                onCommit={(val) => updatePriceItem(r.priceKey, "laborPrice", val)}
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

      {/* Mobile Numeric Price Editor Bottom Sheet */}
      <MobileBottomSheet
        open={Boolean(editingRow)}
        onClose={() => setEditingRow(null)}
        title={editingRow ? editingRow.uraian : "Edit Harga"}
        subtitle={editingRow ? `${fmtNum(editingRow.qty, editingRow.qty % 1 === 0 ? 0 : 2)} ${editingRow.unit} · ${editingRow.ahspCode}` : undefined}
        defaultSnap="half"
        modalBackdrop
      >
        {editingRow && (() => {
          const parsedVal = Math.max(0, Number(editDraft) || 0);
          const nextMat = editField === "materialPrice" ? parsedVal : editingRow.materialUnit;
          const nextLab = editField === "laborPrice" ? parsedVal : editingRow.laborUnit;
          const previewSub = Math.round(editingRow.qty * (nextMat + nextLab + editingRow.equipUnit));
          const applyFactor = (factor: number) => {
            const next = Math.max(0, Math.round((parsedVal * factor) / 500) * 500);
            setEditDraft(String(next));
          };
          return (
            <div className="space-y-4 p-4 pb-8">
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/30 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditField("materialPrice");
                    setEditDraft(String(editingRow.materialUnit));
                  }}
                  className={cn(
                    "min-h-11 rounded-lg text-xs font-semibold transition",
                    editField === "materialPrice" ? "bg-[#f2efe8] text-[#14171c]" : "text-muted-foreground",
                  )}
                >
                  Material ({fmtRp(editingRow.materialUnit)})
                </button>
                <button
                  type="button"
                  disabled={settings.laborMode === "borongan_pct"}
                  onClick={() => {
                    setEditField("laborPrice");
                    setEditDraft(String(editingRow.laborUnit));
                  }}
                  className={cn(
                    "min-h-11 rounded-lg text-xs font-semibold transition disabled:opacity-40",
                    editField === "laborPrice" ? "bg-[#f2efe8] text-[#14171c]" : "text-muted-foreground",
                  )}
                >
                  Upah ({fmtRp(editingRow.laborUnit)})
                </button>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">
                  {editField === "materialPrice" ? "Harga Material" : "Upah Tenaga"} (Rp / {editingRow.unit})
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={500}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-input bg-[#111418] px-3 text-right font-mono text-base font-bold text-foreground tabular-nums focus:border-primary focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-4 gap-2">
                {[
                  [0.9, "-10%"],
                  [0.95, "-5%"],
                  [1.05, "+5%"],
                  [1.1, "+10%"],
                ].map(([f, lbl]) => (
                  <button
                    key={String(lbl)}
                    type="button"
                    onClick={() => applyFactor(Number(f))}
                    className="min-h-11 rounded-xl border border-white/10 bg-white/[0.06] font-mono text-xs font-semibold text-foreground active:bg-white/15"
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-xs">
                <span className="text-muted-foreground">Pratinjau Subtotal</span>
                <span className="font-mono text-sm font-bold text-primary tabular-nums">{fmtRp(previewSub)}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  updatePriceItem(editingRow.priceKey, editField, parsedVal);
                  setEditingRow(null);
                }}
                className="min-h-12 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground active:scale-[0.98]"
              >
                Simpan Harga
              </button>
            </div>
          );
        })()}
      </MobileBottomSheet>
    </div>
  );
}
