"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { getPartInfo } from "@/lib/house/parts";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Wallet, X } from "lucide-react";

interface Props {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  rab: RabSummary;
  className?: string;
}

export function PartInfoPanel({ derived, struct, rab, className }: Props) {
  const selected = useStudioStore((s) => s.selected);
  const setSelected = useStudioStore((s) => s.setSelected);
  const view = useStudioStore((s) => s.view);
  const toggleHiddenPart = useStudioStore((s) => s.toggleHiddenPart);
  const updatePriceItem = useStudioStore((s) => s.updatePriceItem);

  if (!selected || selected.kind !== "part") return null;

  const info = getPartInfo(selected.id, derived, struct);
  if (!info) return null;

  const relatedRows = rab.rows.filter((r) => info.rowIds.includes(r.id));
  const isHidden = view.hiddenParts.includes(info.id);

  return (
    <div className={cn("studio-glass pointer-events-auto absolute z-20 flex max-h-[72%] w-[345px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl", className ?? "bottom-3 right-3")}>
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-black/20 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-foreground">{info.label}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-primary">{info.group}</div>
        </div>
        <button
          type="button"
          aria-label="Tutup panel detail elemen"
          onClick={() => setSelected(null)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5 text-xs">
        <p className="leading-relaxed text-muted-foreground">{info.ringkas}</p>
        <ul className="space-y-1 text-[11px] text-foreground/90">
          {info.specs.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{s}</span>
            </li>
          ))}
        </ul>

        {info.praktik && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10.5px] leading-relaxed text-amber-200">
            {info.praktik}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Wallet className="h-3.5 w-3.5 text-primary" /> Biaya &amp; Harga Satuan Live
          </div>
          {relatedRows.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-black/20 p-2.5 text-[10.5px] text-muted-foreground">
              Tidak ada baris RAB aktif untuk konfigurasi saat ini.
            </div>
          ) : (
            <div className="space-y-2">
              {relatedRows.map((r) => (
                <div key={r.id} className="rounded-xl border border-white/[0.08] bg-black/25 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-foreground">{r.uraian}</div>
                      <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        {fmtNum(r.qty, r.qty % 1 === 0 ? 0 : 2)} {r.unit} · {r.ahspCode}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-[11px] font-bold text-primary tabular-nums">{fmtRp(r.subtotal)}</div>
                  </div>
                  <label className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
                    <span>Harga (Rp/{r.unit})</span>
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={r.materialUnit}
                      onChange={(e) => updatePriceItem(r.priceKey, "materialPrice", Math.max(0, Number(e.target.value) || 0))}
                      className="h-7 w-28 rounded-lg border border-input bg-[#12151b] px-2 text-right font-mono text-[11px] text-foreground tabular-nums outline-none focus:border-primary"
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/[0.08] bg-black/20 p-2.5">
        <button
          type="button"
          onClick={() => toggleHiddenPart(info.id)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] text-[11px] font-semibold transition hover:bg-white/[0.12]"
        >
          {isHidden ? <EyeOff className="h-3.5 w-3.5 text-amber-400" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
          {isHidden ? "Tampilkan Kembali Elemen" : "Sembunyikan di 3D"}
        </button>
      </div>
    </div>
  );
}
