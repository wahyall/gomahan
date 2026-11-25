"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { getPartInfo } from "@/lib/house/parts";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { Eye, EyeOff, Move, Power, RotateCw, Trash2, Wallet, X } from "lucide-react";
import { FURNITURE_CATALOG } from "@/lib/model/catalog";

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
  const updateFurniture = useStudioStore((s) => s.updateFurniture);
  const updateHvac = useStudioStore((s) => s.updateHvac);
  const updateLight = useStudioStore((s) => s.updateLight);
  const updateOpening = useStudioStore((s) => s.updateOpening);
  const moveSelectedBy = useStudioStore((s) => s.moveSelectedBy);
  const rotateSelected = useStudioStore((s) => s.rotateSelected);
  const deleteSelected = useStudioStore((s) => s.deleteSelected);

  if (!selected) return null;

  // Entity inspector (Furniture / HVAC / Light / Wall / Opening)
  if (selected.kind !== "part") {
    const lv = derived.project.levels[selected.levelIndex];
    if (!lv) return null;

    let title = "";
    let subtitle = "";
    let body: React.ReactNode = null;

    if (selected.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === selected.id);
      if (!f) return null;
      const cat = FURNITURE_CATALOG.find((c) => c.catalogId === f.catalogId);
      title = f.name;
      subtitle = `${lv.name} · ${f.size.x.toFixed(2)}×${f.size.z.toFixed(2)} m · Geser langsung di 3D atau pakai tombol`;
      body = (
        <div className="space-y-2.5">
          <div className="text-[11px] text-muted-foreground">
            Posisi: <span className="font-mono text-foreground">X {f.position.x.toFixed(1)}m · Z {f.position.z.toFixed(1)}m</span>
          </div>
          {cat && cat.swatches.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Warna Material (Swatch)</div>
              <div className="flex flex-wrap gap-1.5">
                {cat.swatches.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    onClick={() => updateFurniture(selected.levelIndex as 0 | 1, f.id, { colorHex: sw.hex })}
                    title={sw.name}
                    className={`h-6 w-6 rounded-full border ${f.colorHex === sw.hex ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "border-white/25"}`}
                    style={{ background: sw.hex }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      );
    } else if (selected.kind === "hvac") {
      const hv = lv.hvac.find((x) => x.id === selected.id);
      if (!hv) return null;
      title = hv.name;
      subtitle = `${lv.name} · ${hv.type.toUpperCase()} · ${hv.powerW} W · ${hv.flowRateM3h} m³/jam`;
      body = (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span>Status Unit</span>
            <button
              type="button"
              onClick={() => updateHvac(selected.levelIndex as 0 | 1, hv.id, { on: !hv.on })}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold ${hv.on ? "bg-emerald-500/20 text-emerald-300" : "bg-secondary text-muted-foreground"}`}
            >
              <Power className="h-3 w-3" /> {hv.on ? "NYALA" : "MATI"}
            </button>
          </div>
          {hv.type === "ac_split" && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Suhu Setpoint AC</span>
                <span className="font-mono font-semibold">{hv.setpointC}°C</span>
              </div>
              <input
                type="range"
                min={18}
                max={28}
                step={1}
                value={hv.setpointC}
                onChange={(e) => updateHvac(selected.levelIndex as 0 | 1, hv.id, { setpointC: Number(e.target.value) })}
                className="w-full accent-[#df8949]"
              />
              <div className="flex gap-1 pt-1">
                {([0.5, 1, 1.5] as const).map((pk) => (
                  <button
                    key={pk}
                    type="button"
                    onClick={() =>
                      updateHvac(selected.levelIndex as 0 | 1, hv.id, {
                        pkRating: pk,
                        powerW: pk === 0.5 ? 360 : pk === 1 ? 720 : 1050,
                        coolingCapacityW: pk === 0.5 ? 1465 : pk === 1 ? 2638 : 3517,
                      })
                    }
                    className={`flex-1 rounded border py-1 text-[10px] font-semibold ${hv.pkRating === pk ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {pk} PK
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 text-[10px] text-muted-foreground">Kecepatan Hembusan</div>
            <div className="flex gap-1">
              {([1, 2, 3] as const).map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => updateHvac(selected.levelIndex as 0 | 1, hv.id, { speedLevel: spd })}
                  className={`flex-1 rounded border py-1 text-[10px] font-semibold ${hv.speedLevel === spd ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground"}`}
                >
                  Level {spd}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    } else if (selected.kind === "light") {
      const l = lv.lights.find((x) => x.id === selected.id);
      if (!l) return null;
      title = l.name;
      subtitle = `${lv.name} · ${l.lumens} lm · ${l.colorTempK}K`;
      body = (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span>Lampu</span>
            <button
              type="button"
              onClick={() => updateLight(selected.levelIndex as 0 | 1, l.id, { on: !l.on })}
              className={`rounded px-2 py-1 text-[11px] font-semibold ${l.on ? "bg-amber-500/25 text-amber-200" : "bg-secondary text-muted-foreground"}`}
            >
              {l.on ? "NYALA" : "MATI"}
            </button>
          </div>
          <div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Dimmer</span>
              <span className="font-mono">{Math.round(l.dimmer * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.1}
              value={l.dimmer}
              onChange={(e) => updateLight(selected.levelIndex as 0 | 1, l.id, { dimmer: Number(e.target.value) })}
              className="w-full accent-[#df8949]"
            />
          </div>
        </div>
      );
    } else if (selected.kind === "opening") {
      const w = lv.walls.find((x) => x.id === selected.wallId);
      const op = w?.openings.find((o) => o.id === selected.id);
      if (!w || !op) return null;
      title = op.label;
      subtitle = `${w.name} · ${op.width.toFixed(2)}×${op.height.toFixed(2)} m`;
      body = (
        <div className="space-y-2 text-xs">
          <div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Lebar Bukaan</span>
              <span className="font-mono">{op.width.toFixed(2)} m</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.6}
              step={0.05}
              value={op.width}
              onChange={(e) => updateOpening(selected.levelIndex as 0 | 1, w.id, op.id, { width: Number(e.target.value) })}
              className="w-full accent-[#df8949]"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Posisi Sepanjang Dinding</span>
              <span className="font-mono">{op.offset.toFixed(2)} m</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={Math.max(0.5, Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) - 0.4)}
              step={0.05}
              value={op.offset}
              onChange={(e) => updateOpening(selected.levelIndex as 0 | 1, w.id, op.id, { offset: Number(e.target.value) })}
              className="w-full accent-[#df8949]"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Bukaan Angin (%)</span>
              <span className="font-mono">{op.openPct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={op.openPct}
              onChange={(e) => updateOpening(selected.levelIndex as 0 | 1, w.id, op.id, { openPct: Number(e.target.value) })}
              className="w-full accent-[#2dd4bf]"
            />
          </div>
        </div>
      );
    } else if (selected.kind === "wall") {
      const w = lv.walls.find((x) => x.id === selected.id);
      if (!w) return null;
      const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      title = w.name;
      subtitle = `${lv.name} · Panjang ${len.toFixed(2)} m · Tebal ${Math.round(w.thickness * 1000)} mm`;
      body = (
        <div className="text-[11px] text-muted-foreground">
          {w.partyWallSide
            ? `Dinding batas tetangga sisi ${w.partyWallSide === "left" ? "kiri" : "kanan"} (terkunci sesuai PBG).`
            : "Dinding ini bisa digeser dengan panah di bawah atau dihapus jika ingin membuka ruangan."}
        </div>
      );
    }

    return (
      <div className="pointer-events-auto absolute bottom-3 right-3 z-20 w-[320px] max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-card/95 shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border bg-[#23272e] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-foreground">{title}</div>
            <div className="truncate text-[10px] text-muted-foreground">{subtitle}</div>
          </div>
          <button type="button" onClick={() => setSelected(null)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-3 p-3">
          {body}
          {/* Contextual Sims 4 Action Bar (Pie-menu style controls) */}
          <div className="grid grid-cols-4 gap-1 border-t border-border pt-2">
            <button type="button" onClick={() => moveSelectedBy(-0.2, 0)} className="rounded border border-border bg-secondary py-1 text-[10px] hover:border-primary" title="Geser Kiri (-X)">
              ← X
            </button>
            <button type="button" onClick={() => moveSelectedBy(0.2, 0)} className="rounded border border-border bg-secondary py-1 text-[10px] hover:border-primary" title="Geser Kanan (+X)">
              X →
            </button>
            <button type="button" onClick={() => moveSelectedBy(0, -0.2)} className="rounded border border-border bg-secondary py-1 text-[10px] hover:border-primary" title="Geser Depan (-Z)">
              ↑ Z
            </button>
            <button type="button" onClick={() => moveSelectedBy(0, 0.2)} className="rounded border border-border bg-secondary py-1 text-[10px] hover:border-primary" title="Geser Belakang (+Z)">
              Z ↓
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => rotateSelected(Math.PI / 4)}
              className="flex flex-1 items-center justify-center gap-1 rounded border border-border bg-secondary py-1.5 text-[11px] font-medium hover:border-primary"
            >
              <RotateCw className="h-3 w-3" /> Putar 45°
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              className="flex flex-1 items-center justify-center gap-1 rounded border border-red-500/40 bg-red-500/10 py-1.5 text-[11px] font-medium text-red-300 hover:bg-red-500/20"
            >
              <Trash2 className="h-3 w-3" /> Hapus
            </button>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Move className="h-3 w-3 text-primary" /> Tip: Klik & geser langsung di lantai 3D untuk memindahkan objek.
          </div>
        </div>
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
        <button type="button" onClick={() => setSelected(null)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-3.5 w-3.5" />
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
