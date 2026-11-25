"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { getPartInfo } from "@/lib/house/parts";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { Eye, EyeOff, Wallet, X } from "lucide-react";

interface Props {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  rab: RabSummary;
}

export function PartInfoPanel({ derived, struct, rab }: Props) {
  const selected = useStudioStore((s) => s.selected);
  const setSelected = useStudioStore((s) => s.setSelected);
  const view = useStudioStore((s) => s.view);
  const toggleHiddenPart = useStudioStore((s) => s.toggleHiddenPart);
  const updatePriceItem = useStudioStore((s) => s.updatePriceItem);

  if (!selected) return null;

  // Read-only element summary inside analytical 3D viewports
  if (selected.kind !== "part") {
    const lv = derived.project.levels[selected.levelIndex];
    if (!lv) return null;

    let title = "";
    let subtitle = "";
    let note = "";

    if (selected.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === selected.id);
      if (!f) return null;
      title = f.name;
      subtitle = `${lv.name} · ${f.size.x.toFixed(2)}×${f.size.z.toFixed(2)} m`;
      note = `Posisi data: X ${f.position.x.toFixed(2)} m · Z ${f.position.z.toFixed(2)} m`;
    } else if (selected.kind === "hvac") {
      const hv = lv.hvac.find((x) => x.id === selected.id);
      if (!hv) return null;
      title = hv.name;
      subtitle = `${lv.name} · ${hv.type.toUpperCase()} · ${hv.powerW} W · ${hv.flowRateM3h} m³/jam`;
      note = hv.on ? `Aktif (${hv.setpointC}°C, Speed ${hv.speedLevel})` : "Unit mati";
    } else if (selected.kind === "light") {
      const l = lv.lights.find((x) => x.id === selected.id);
      if (!l) return null;
      title = l.name;
      subtitle = `${lv.name} · ${l.lumens} lm · ${l.colorTempK}K`;
      note = l.on ? `Menyala (${Math.round(l.dimmer * 100)}%)` : "Mati";
    } else if (selected.kind === "opening") {
      const w = lv.walls.find((x) => x.id === selected.wallId);
      const op = w?.openings.find((o) => o.id === selected.id);
      if (!w || !op) return null;
      title = op.label;
      subtitle = `${w.name} · ${op.width.toFixed(2)}×${op.height.toFixed(2)} m`;
      note = `Bukaan angin ${op.openPct}%`;
    } else if (selected.kind === "wall") {
      const w = lv.walls.find((x) => x.id === selected.id);
      if (!w) return null;
      const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      title = w.name;
      subtitle = `${lv.name} · Panjang ${len.toFixed(2)} m · Tebal ${Math.round(w.thickness * 1000)} mm`;
      note = w.partyWallSide
        ? `Dinding batas tetangga sisi ${w.partyWallSide === "left" ? "kiri" : "kanan"}`
        : "Elemen dinding arsitektur";
    }

    return (
      <div className="pointer-events-auto absolute bottom-3 right-3 z-20 w-[300px] max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-card/95 shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border bg-[#23272e] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-foreground">{title}</div>
            <div className="truncate text-[10px] text-muted-foreground">{subtitle}</div>
          </div>
          <button
            type="button"
            aria-label="Tutup ringkasan elemen"
            onClick={() => setSelected(null)}
            className="flex min-h-7 min-w-7 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="p-3 text-[11px] text-muted-foreground">{note}</div>
      </div>
    );
  }

  // Building Part Inspector (from MVP: specs + live inline RAB unit price editing!)
  const info = getPartInfo(selected.id, derived, struct);
  if (!info) return null;

  const relatedRows = rab.rows.filter((r) => info.rowIds.includes(r.id));
  const isHidden = view.hiddenParts.includes(info.id);

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-20 flex max-h-[82%] w-[345px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-md border border-border bg-card/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-border bg-[#23272e] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-foreground">{info.label}</div>
          <div className="text-[10px] uppercase tracking-wider text-primary">{info.group}</div>
        </div>
        <button
          type="button"
          aria-label="Tutup panel detail elemen"
          onClick={() => setSelected(null)}
          className="flex min-h-7 min-w-7 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
        <p className="leading-relaxed text-muted-foreground">{info.ringkas}</p>
        <ul className="space-y-1 text-[11px] text-foreground/90">
          {info.specs.map((s, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span>{s}</span>
            </li>
          ))}
        </ul>

        {info.praktik && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10.5px] text-amber-200">
            {info.praktik}
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Wallet className="h-3 w-3 text-primary" /> Biaya & Edit Harga Satuan (RAB Live)
          </div>
          {relatedRows.length === 0 ? (
            <div className="rounded border border-border bg-muted/40 p-2 text-[10.5px] text-muted-foreground">
              Tidak ada baris RAB aktif untuk konfigurasi saat ini.
            </div>
          ) : (
            <div className="space-y-1.5">
              {relatedRows.map((r) => (
                <div key={r.id} className="rounded border border-border bg-background/60 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-foreground">{r.uraian}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {fmtNum(r.qty, r.qty % 1 === 0 ? 0 : 2)} {r.unit} · {r.ahspCode}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-[11px] font-bold text-primary">{fmtRp(r.subtotal)}</div>
                  </div>
                  <label className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>Harga Material (Rp/{r.unit})</span>
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={r.materialUnit}
                      onChange={(e) => updatePriceItem(r.priceKey, "materialPrice", Math.max(0, Number(e.target.value) || 0))}
                      className="h-6 w-28 rounded border border-input bg-card px-2 text-right font-mono text-[11px] text-foreground outline-none focus:border-primary"
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-[#23272e] p-2">
        <button
          type="button"
          onClick={() => toggleHiddenPart(info.id)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-border bg-secondary text-[11px] font-semibold hover:border-primary"
        >
          {isHidden ? <EyeOff className="h-3.5 w-3.5 text-amber-400" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
          {isHidden ? "Tampilkan Kembali Bagian Ini" : "Sembunyikan Bagian Ini"}
        </button>
      </div>
    </div>
  );
}
