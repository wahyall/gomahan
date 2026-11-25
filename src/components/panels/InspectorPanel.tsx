"use client";

import { useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type {
  BrickSpec,
  FoundationSystem,
  FrameSystem,
  MasonryPreset,
  RoofCover,
  RoofType,
  SlabSystem,
} from "@/lib/model/types";
import { PAINT_SWATCHES, ROOF_SWATCHES } from "@/lib/model/catalog";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, Layers, PaintBucket, SlidersHorizontal } from "lucide-react";

export function InspectorPanel({ derived }: { derived: DerivedProjectModel }) {
  const [tab, setTab] = useState<"sistem" | "tampilan" | "validasi">("sistem");
  const project = useStudioStore((s) => s.project);
  const view = useStudioStore((s) => s.view);
  const patchSystems = useStudioStore((s) => s.patchSystems);
  const setBrickPreset = useStudioStore((s) => s.setBrickPreset);
  const patchBrickSpec = useStudioStore((s) => s.patchBrickSpec);
  const patchPeil = useStudioStore((s) => s.patchPeil);
  const patchView = useStudioStore((s) => s.patchView);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);

  const sys = project.systems;
  const brick = sys.brick;
  const isPro = project.gamification.mode === "pro";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-[#21242a] px-2">
        <TabBtn active={tab === "sistem"} onClick={() => setTab("sistem")}>
          <SlidersHorizontal className="h-3 w-3" /> Sistem & Bata
        </TabBtn>
        <TabBtn active={tab === "tampilan"} onClick={() => setTab("tampilan")}>
          <PaintBucket className="h-3 w-3" /> Tampilan
        </TabBtn>
        <TabBtn active={tab === "validasi"} onClick={() => setTab("validasi")}>
          <AlertTriangle className="h-3 w-3" /> Cek ({derived.validation.length})
        </TabBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 text-xs">
        {tab === "sistem" && (
          <div className="space-y-3.5">
            {/* Multi-System Architecture Options */}
            <Section title="1. Pilihan Sistem Arsitektur & Struktur">
              <SelectField
                label="Sistem Pondasi 2 Lantai"
                value={sys.foundation}
                onChange={(v) => patchSystems({ foundation: v as FoundationSystem })}
                options={[
                  ["footplate_batukali", "Footplate + Batu Kali + Sloof 20/30"],
                  ["footplate_full", "Footplate Penuh 120×120 + Tie Beam"],
                  ["strauss_pile", "Strauss Pile Ø30 cm (Tanah Lunak Surabaya)"],
                  ["cakar_ayam", "Cakar Ayam Sedyatmo (Pelat + Buis Ø40)"],
                  ["elevated_flood", "Elevated Panggung Pendek (Anti-Banjir)"],
                ]}
              />
              <SelectField
                label="Sistem Rangka Utama"
                value={sys.frame}
                onChange={(v) => patchSystems({ frame: v as FrameSystem })}
                options={[
                  ["rc_moment_frame", "Beton Bertulang SNI 2847 (K-250 / BJTS 420B)"],
                  ["steel_wf", "Struktur Baja Profil IWF / H-Beam"],
                ]}
              />
              <SelectField
                label="Sistem Pelat Lantai 2"
                value={sys.slab}
                onChange={(v) => patchSystems({ slab: v as SlabSystem })}
                options={[
                  ["rc_slab_12", "Cor Beton Konvensional 12 cm (Tulangan Ø10)"],
                  ["bondek_wiremesh", "Bondek 0,75 mm + Wiremesh M8"],
                  ["aac_panel", "Panel Lantai AAC Hebel 12,5 cm"],
                ]}
              />
              <div className="grid grid-cols-2 gap-1.5">
                <SelectField
                  label="Bentuk Atap"
                  value={sys.roofType}
                  onChange={(v) => patchSystems({ roofType: v as RoofType })}
                  options={[
                    ["shed_front", "Shed Miring ke Depan"],
                    ["shed_back", "Shed Miring ke Belakang"],
                    ["gable", "Pelana (Gable)"],
                    ["hip", "Limas (Hip)"],
                    ["flat_deck", "Dak Beton Datar"],
                  ]}
                />
                <SelectField
                  label="Penutup Atap"
                  value={sys.roofCover}
                  onChange={(v) => patchSystems({ roofCover: v as RoofCover })}
                  options={[
                    ["standing_seam", "Metal Standing Seam"],
                    ["spandek_pasir", "Spandek Pasir"],
                    ["genteng_beton", "Genteng Beton Flat"],
                    ["genteng_keramik", "Genteng Keramik"],
                  ]}
                />
              </div>
              <SliderRow
                label="Kemiringan Atap"
                display={`${sys.roofSlopeDeg}°`}
                min={3}
                max={38}
                step={1}
                val={sys.roofSlopeDeg}
                onChange={(v) => patchSystems({ roofSlopeDeg: v })}
              />
            </Section>

            {/* Brick System + Custom Brick Dimensions */}
            <Section title="2. Susunan Bata & Custom Ukuran Bata">
              <SelectField
                label="Jenis / Preset Bata"
                value={brick.preset}
                onChange={(v) => setBrickPreset(v as MasonryPreset)}
                options={[
                  ["hebel", "Bata Putih / Hebel AAC (600×200×100)"],
                  ["merah", "Bata Merah SNI (200×50×100)"],
                  ["batako", "Batako Semen Press (400×200×100)"],
                  ["precast", "Panel Precast (600×300×80)"],
                  ["custom", "Custom Ukuran Bata Sendiri (L×T×D mm)"],
                ]}
              />

              {/* Custom Dimensions Editor (Always accessible or switched directly!) */}
              <div className="rounded border border-primary/25 bg-primary/5 p-2 space-y-2">
                <div className="flex items-center justify-between text-[10.5px] font-semibold text-primary">
                  <span>Dimensi Bata (mm)</span>
                  <span className="font-mono">{derived.masonry.totalPiecesPlaced} bh terpasang</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <NumInput
                    label="Panjang"
                    val={brick.lengthMm}
                    min={80}
                    max={1000}
                    onChange={(v) => patchBrickSpec({ preset: "custom", lengthMm: v })}
                  />
                  <NumInput
                    label="Tinggi"
                    val={brick.heightMm}
                    min={30}
                    max={500}
                    onChange={(v) => patchBrickSpec({ preset: "custom", heightMm: v })}
                  />
                  <NumInput
                    label="Tebal Bata"
                    val={brick.depthMm}
                    min={50}
                    max={250}
                    onChange={(v) =>
                      patchBrickSpec({
                        preset: "custom",
                        depthMm: v,
                        outerThicknessMm: v,
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <NumInput
                    label="Tebal Dinding Luar"
                    val={brick.outerThicknessMm}
                    min={60}
                    max={300}
                    onChange={(v) => patchBrickSpec({ outerThicknessMm: v })}
                  />
                  <NumInput
                    label="Tebal Sekat Dalam"
                    val={brick.innerThicknessMm}
                    min={50}
                    max={250}
                    onChange={(v) => patchBrickSpec({ innerThicknessMm: v })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <SelectField
                    label="Perekat / Spesi"
                    value={brick.mortarKind}
                    onChange={(v) => patchBrickSpec({ mortarKind: v as BrickSpec["mortarKind"] })}
                    options={[
                      ["thinbed", "Perekat Instan Thinbed"],
                      ["cement_sand", "Adukan Semen-Pasir 1:5"],
                    ]}
                  />
                  <SelectField
                    label="Pola Ikatan"
                    value={brick.bondPattern}
                    onChange={(v) => patchBrickSpec({ bondPattern: v as BrickSpec["bondPattern"] })}
                    options={[
                      ["running", "Berselang (Running)"],
                      ["stack", "Sejajar (Stack)"],
                      ["english", "English Bond"],
                    ]}
                  />
                </div>
                <SliderRow
                  label="Ketebalan Nat / Semen"
                  display={`${brick.mortarMm} mm`}
                  min={1}
                  max={25}
                  step={0.5}
                  val={brick.mortarMm}
                  onChange={(v) => patchBrickSpec({ mortarMm: v })}
                />
                {isPro && (
                  <SliderRow
                    label="Faktor Waste Potongan"
                    display={`${brick.wastePct}%`}
                    min={0}
                    max={20}
                    step={1}
                    val={brick.wastePct}
                    onChange={(v) => patchBrickSpec({ wastePct: v })}
                  />
                )}
                <div className="rounded bg-card/80 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                  Luas bersih 2 lantai: <b className="font-mono text-foreground">{fmtNum(derived.totalNetFloorM2, 2)} m²</b>{" "}
                  (tebal bata memakai <b className="font-mono text-amber-300">{fmtNum(derived.totalWallDeductionM2, 2)} m²</b> /{" "}
                  {fmtNum(derived.totalWallDeductionPct, 1)}%).
                </div>
              </div>
            </Section>

            {/* Keramik & Peil Banjir */}
            <Section title="3. Peil Banjir & Lantai Keramik">
              <SliderRow
                label="Peil Lantai LT1 (dari jalan)"
                display={`+${Math.round(project.site.peil.floor1PeilM * 100)} cm`}
                min={0.15}
                max={1.5}
                step={0.05}
                val={project.site.peil.floor1PeilM}
                onChange={(v) =>
                  patchPeil({
                    floor1PeilM: v,
                    terracePeilM: Math.max(0.1, Number((v - 0.15).toFixed(2))),
                  })
                }
              />
              <SelectField
                label="Ukuran Keramik Lantai"
                value={String(sys.tileSizeCm)}
                onChange={(v) => patchSystems({ tileSizeCm: Number(v) as 30 | 40 | 60 })}
                options={[
                  ["30", "30 × 30 cm (Garis Nat Rapat)"],
                  ["40", "40 × 40 cm (Standar Tropis)"],
                  ["60", "60 × 60 cm (Granit Tile Luas)"],
                ]}
              />
            </Section>
          </div>
        )}

        {tab === "tampilan" && (
          <div className="space-y-3.5">
            <Section title="Exploded View (Bongkar Granular)">
              <SliderRow
                label="Tingkat Bongkar"
                display={`${Math.round(view.explode * 100)}%`}
                min={0}
                max={1}
                step={0.02}
                val={view.explode}
                onChange={(v) => patchView({ explode: v })}
              />
              <div className="grid grid-cols-4 gap-1">
                {[0, 0.35, 0.7, 1].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => patchView({ explode: k })}
                    className={cn(
                      "rounded border py-1 text-[10.5px] font-medium",
                      Math.abs(view.explode - k) < 0.02
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {k === 0 ? "Rakit" : k === 1 ? "Penuh" : `${Math.round(k * 100)}%`}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Potongan Horizontal (Section Cut)">
              <SliderRow
                label="Tinggi Bidang Potong"
                display={view.cutH < 12 ? `${view.cutH.toFixed(2)} m` : "Nonaktif"}
                min={0.8}
                max={12}
                step={0.1}
                val={Math.min(12, view.cutH)}
                onChange={(v) => patchView({ cutH: v >= 11.9 ? 100 : v })}
              />
            </Section>

            <Section title="Warna Fasad & Atap">
              <div className="text-[10px] text-muted-foreground">Cat Dinding Eksterior</div>
              <div className="flex flex-wrap gap-1.5">
                {PAINT_SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => patchSimulation({ paintExtHex: s.hex })}
                    title={s.name}
                    className={cn(
                      "h-6 w-6 rounded-full border",
                      project.simulation.paintExtHex === s.hex ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "border-white/25",
                    )}
                    style={{ background: s.hex }}
                  />
                ))}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">Warna Penutup Atap</div>
              <div className="flex flex-wrap gap-1.5">
                {ROOF_SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => patchSimulation({ roofColorHex: s.hex })}
                    title={s.name}
                    className={cn(
                      "h-6 w-6 rounded-full border",
                      project.simulation.roofColorHex === s.hex ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "border-white/25",
                    )}
                    style={{ background: s.hex }}
                  />
                ))}
              </div>
            </Section>

            <Section title="Waktu Matahari (Siang / Malam)">
              <SliderRow
                label="Jam Surabaya"
                display={`${Math.floor(project.simulation.hourOfDay).toString().padStart(2, "0")}:${project.simulation.hourOfDay % 1 >= 0.5 ? "30" : "00"}`}
                min={5}
                max={22}
                step={0.5}
                val={project.simulation.hourOfDay}
                onChange={(v) => patchSimulation({ hourOfDay: v })}
              />
            </Section>

            <Section title="Layer Visibilitas">
              <ToggleRow label="Susunan Bata 3D" checked={view.showBricks} onChange={(v) => patchView({ showBricks: v })} />
              <ToggleRow label="Plester & Cat" checked={view.showFinishing} onChange={(v) => patchView({ showFinishing: v })} />
              <ToggleRow label="Struktur Beton / Baja" checked={view.showStructure} onChange={(v) => patchView({ showStructure: v })} />
              <ToggleRow label="X-Ray Besi Tulangan" checked={view.xrayRebar} onChange={(v) => patchView({ xrayRebar: v })} />
              <ToggleRow label="Rumah Tetangga (Kiri/Kanan)" checked={view.showNeighbors} onChange={(v) => patchView({ showNeighbors: v })} />
            </Section>
          </div>
        )}

        {tab === "validasi" && (
          <div className="space-y-2">
            {derived.validation.length === 0 ? (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300">
                Semua pengecekan batas tetangga, bukaan, tangga & pencahayaan SNI lolos tanpa catatan!
              </div>
            ) : (
              derived.validation.map((v) => (
                <div
                  key={v.id}
                  className={cn(
                    "rounded border p-2",
                    v.severity === "critical"
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : v.severity === "warning"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                        : "border-sky-500/30 bg-sky-500/10 text-sky-200",
                  )}
                >
                  <div className="text-[11px] font-bold">{v.title}</div>
                  <div className="mt-0.5 text-[10.5px] opacity-90">{v.detail}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1 rounded px-2 text-[10.5px] font-semibold transition",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-b border-border/60 pb-3 last:border-b-0">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Layers className="h-3 w-3 text-primary" /> {title}
      </div>
      {children}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10.5px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded border border-input bg-secondary px-2 text-[11px] text-foreground outline-none focus:border-primary"
      >
        {options.map(([k, txt]) => (
          <option key={k} value={k}>
            {txt}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumInput({ label, val, min, max, onChange }: { label: string; val: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[9.5px] text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={val}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="h-7 w-full rounded border border-input bg-card px-1.5 text-right font-mono text-[11px] text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function SliderRow({
  label,
  display,
  min,
  max,
  step,
  val,
  onChange,
}: {
  label: string;
  display: string;
  min: number;
  max: number;
  step: number;
  val: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold text-foreground">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#df8949]"
      />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px]">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#df8949]" />
    </label>
  );
}
