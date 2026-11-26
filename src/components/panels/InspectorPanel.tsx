"use client";

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
import { useBuildModeStore } from "@/features/buildMode/store";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { StudioNumberField, StudioRange, StudioSelect, StudioSwitch } from "@/components/ui/StudioPrimitives";
import { AlertTriangle, Layers, PaintBucket, SlidersHorizontal } from "lucide-react";

export function InspectorPanel({ derived }: { derived: DerivedProjectModel }) {
  const tab = useStudioStore((s) => s.inspectorTab);
  const setTab = useStudioStore((s) => s.setInspectorTab);
  const openBuildPanel = useStudioStore((s) => s.openBuildPanel);
  const project = useStudioStore((s) => s.project);
  const view = useStudioStore((s) => s.view);
  const patchSystems = useStudioStore((s) => s.patchSystems);
  const setBrickPreset = useStudioStore((s) => s.setBrickPreset);
  const patchBrickSpec = useStudioStore((s) => s.patchBrickSpec);
  const patchView = useStudioStore((s) => s.patchView);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const showBricksOverlay = useBuildModeStore((s) => s.showBricksOverlay);
  const neighborsVisible = useBuildModeStore((s) => s.neighborsVisible);

  const sys = project.systems;
  const brick = sys.brick;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-[#161a21] px-2">
        <TabBtn active={tab === "sistem"} onClick={() => setTab("sistem")}>
          <SlidersHorizontal className="h-3 w-3" /> Sistem &amp; Bata
        </TabBtn>
        <TabBtn active={tab === "tampilan"} onClick={() => setTab("tampilan")}>
          <PaintBucket className="h-3 w-3" /> Tampilan
        </TabBtn>
        <TabBtn active={tab === "validasi"} onClick={() => setTab("validasi")}>
          <AlertTriangle className="h-3 w-3" /> Cek ({derived.validation.length})
        </TabBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {tab === "sistem" && (
          <div className="space-y-4">
            <Section title="Arsitektur & Struktur Utama">
              <StudioSelect
                label="Sistem Pondasi 2 Lantai"
                value={sys.foundation}
                onChange={(v) => patchSystems({ foundation: v as FoundationSystem })}
                options={[
                  ["footplate_batukali", "Footplate + Batu Kali + Sloof 20/30"],
                  ["footplate_full", "Footplate Penuh 120×120 + Tie Beam"],
                  ["strauss_pile", "Strauss Pile Ø30 cm (Tanah Lunak)"],
                  ["cakar_ayam", "Cakar Ayam Sedyatmo (Buis Ø40)"],
                  ["elevated_flood", "Elevated Panggung (Anti-Banjir)"],
                ]}
              />
              <StudioSelect
                label="Sistem Rangka Utama"
                value={sys.frame}
                onChange={(v) => patchSystems({ frame: v as FrameSystem })}
                options={[
                  ["rc_moment_frame", "Beton Bertulang SNI 2847"],
                  ["steel_wf", "Struktur Baja Profil IWF / H-Beam"],
                ]}
              />
              <StudioSelect
                label="Sistem Pelat Lantai 2"
                value={sys.slab}
                onChange={(v) => patchSystems({ slab: v as SlabSystem })}
                options={[
                  ["rc_slab_12", "Cor Beton Konvensional 12 cm"],
                  ["bondek_wiremesh", "Bondek 0,75 mm + Wiremesh M8"],
                  ["aac_panel", "Panel Lantai AAC Hebel 12,5 cm"],
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <StudioSelect
                  label="Bentuk Atap"
                  value={sys.roofType}
                  onChange={(v) => patchSystems({ roofType: v as RoofType })}
                  options={[
                    ["shed_front", "Shed Depan"],
                    ["shed_back", "Shed Belakang"],
                    ["gable", "Pelana"],
                    ["hip", "Limas"],
                    ["flat_deck", "Dak Beton"],
                  ]}
                />
                <StudioSelect
                  label="Penutup Atap"
                  value={sys.roofCover}
                  onChange={(v) => patchSystems({ roofCover: v as RoofCover })}
                  options={[
                    ["standing_seam", "Standing Seam"],
                    ["spandek_pasir", "Spandek Pasir"],
                    ["genteng_beton", "Genteng Beton"],
                    ["genteng_keramik", "Genteng Keramik"],
                  ]}
                />
              </div>
              <StudioRange
                label="Kemiringan Atap"
                display={`${sys.roofSlopeDeg}°`}
                min={3}
                max={38}
                step={1}
                value={sys.roofSlopeDeg}
                onChange={(v) => patchSystems({ roofSlopeDeg: v })}
              />
            </Section>

            <Section title="Susunan & Ukuran Bata Custom">
              <StudioSelect
                label="Jenis / Preset Bata"
                value={brick.preset}
                onChange={(v) => setBrickPreset(v as MasonryPreset)}
                options={[
                  ["hebel", "Hebel AAC (600×200×100)"],
                  ["merah", "Bata Merah SNI (200×50×100)"],
                  ["batako", "Batako Press (400×200×100)"],
                  ["precast", "Panel Precast (600×300×80)"],
                  ["custom", "Custom Dimensi Sendiri"],
                ]}
              />

              <div className="space-y-2.5 rounded-xl border border-primary/25 bg-primary/[0.06] p-2.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-primary">
                  <span>Dimensi Bata (mm)</span>
                  <span className="font-mono tabular-nums">{derived.masonry.totalPiecesPlaced} kpg</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <StudioNumberField
                    label="Panjang"
                    value={brick.lengthMm}
                    min={80}
                    max={1000}
                    onChange={(v) => patchBrickSpec({ preset: "custom", lengthMm: v })}
                  />
                  <StudioNumberField
                    label="Tinggi"
                    value={brick.heightMm}
                    min={30}
                    max={500}
                    onChange={(v) => patchBrickSpec({ preset: "custom", heightMm: v })}
                  />
                  <StudioNumberField
                    label="Tebal"
                    value={brick.depthMm}
                    min={50}
                    max={250}
                    onChange={(v) => patchBrickSpec({ preset: "custom", depthMm: v, outerThicknessMm: v })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <StudioNumberField
                    label="Dinding Luar"
                    unit="mm"
                    value={brick.outerThicknessMm}
                    min={60}
                    max={300}
                    onChange={(v) => patchBrickSpec({ outerThicknessMm: v })}
                  />
                  <StudioNumberField
                    label="Sekat Dalam"
                    unit="mm"
                    value={brick.innerThicknessMm}
                    min={50}
                    max={250}
                    onChange={(v) => patchBrickSpec({ innerThicknessMm: v })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <StudioSelect
                    label="Perekat / Spesi"
                    value={brick.mortarKind}
                    onChange={(v) => patchBrickSpec({ mortarKind: v as BrickSpec["mortarKind"] })}
                    options={[
                      ["thinbed", "Thinbed Instan"],
                      ["cement_sand", "Semen-Pasir 1:5"],
                    ]}
                  />
                  <StudioSelect
                    label="Pola Ikatan"
                    value={brick.bondPattern}
                    onChange={(v) => patchBrickSpec({ bondPattern: v as BrickSpec["bondPattern"] })}
                    options={[
                      ["running", "Running"],
                      ["stack", "Sejajar"],
                      ["english", "English Bond"],
                    ]}
                  />
                </div>
                <StudioRange
                  label="Ketebalan Nat / Semen"
                  display={`${brick.mortarMm} mm`}
                  min={1}
                  max={25}
                  step={0.5}
                  value={brick.mortarMm}
                  onChange={(v) => patchBrickSpec({ mortarMm: v })}
                />
                <StudioRange
                  label="Faktor Waste Potongan"
                  display={`${brick.wastePct}%`}
                  min={0}
                  max={20}
                  step={1}
                  value={brick.wastePct}
                  onChange={(v) => patchBrickSpec({ wastePct: v })}
                />
                <div className="rounded-lg bg-black/25 px-2.5 py-2 text-[10.5px] leading-snug text-muted-foreground">
                  Luas bersih 2 lantai: <b className="font-mono text-foreground tabular-nums">{fmtNum(derived.totalNetFloorM2, 2)} m²</b> (tebal bata memakai{" "}
                  <b className="font-mono text-amber-300 tabular-nums">{fmtNum(derived.totalWallDeductionM2, 2)} m²</b>).
                </div>
              </div>
            </Section>

            <Section title="Keramik Lantai & Parameter Lanjutan">
              <StudioSelect
                label="Ukuran Keramik Lantai"
                value={String(sys.tileSizeCm)}
                onChange={(v) => patchSystems({ tileSizeCm: Number(v) as 30 | 40 | 60 })}
                options={[
                  ["30", "30 × 30 cm"],
                  ["40", "40 × 40 cm (Standar Tropis)"],
                  ["60", "60 × 60 cm (Granit Tile)"],
                ]}
              />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openBuildPanel("structure")}
                  className="rounded-lg border border-border bg-black/25 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition hover:border-primary/60"
                >
                  Parameter SNI →
                </button>
                <button
                  type="button"
                  onClick={() => openBuildPanel("flood")}
                  className="rounded-lg border border-border bg-black/25 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition hover:border-cyan-400/60"
                >
                  Peil &amp; Banjir →
                </button>
              </div>
            </Section>
          </div>
        )}

        {tab === "tampilan" && (
          <div className="space-y-4">
            <Section title="Exploded View (Bongkar Granular)">
              <StudioRange
                label="Tingkat Bongkar"
                display={`${Math.round(view.explode * 100)}%`}
                min={0}
                max={1}
                step={0.02}
                value={view.explode}
                onChange={(v) => patchView({ explode: v })}
              />
              <div className="grid grid-cols-4 gap-1">
                {[0, 0.35, 0.7, 1].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => patchView({ explode: k })}
                    className={cn(
                      "rounded-lg border py-1 text-[10.5px] font-medium transition",
                      Math.abs(view.explode - k) < 0.02
                        ? "border-primary bg-primary text-primary-foreground font-semibold"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {k === 0 ? "Rakit" : k === 1 ? "Penuh" : `${Math.round(k * 100)}%`}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Warna Fasad & Atap">
              <div className="text-[11px] font-medium text-muted-foreground">Cat Dinding Eksterior</div>
              <div className="flex flex-wrap gap-1.5">
                {PAINT_SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => patchSimulation({ paintExtHex: s.hex })}
                    title={s.name}
                    className={cn(
                      "h-6 w-6 rounded-full border transition",
                      project.simulation.paintExtHex === s.hex ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-card" : "border-white/25",
                    )}
                    style={{ background: s.hex }}
                  />
                ))}
              </div>
              <div className="pt-1 text-[11px] font-medium text-muted-foreground">Warna Penutup Atap</div>
              <div className="flex flex-wrap gap-1.5">
                {ROOF_SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => patchSimulation({ roofColorHex: s.hex })}
                    title={s.name}
                    className={cn(
                      "h-6 w-6 rounded-full border transition",
                      project.simulation.roofColorHex === s.hex ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-card" : "border-white/25",
                    )}
                    style={{ background: s.hex }}
                  />
                ))}
              </div>
            </Section>

            <Section title="Waktu Matahari">
              <StudioRange
                label="Jam Surabaya"
                display={`${Math.floor(project.simulation.hourOfDay).toString().padStart(2, "0")}:${project.simulation.hourOfDay % 1 >= 0.5 ? "30" : "00"}`}
                min={5}
                max={22}
                step={0.5}
                value={project.simulation.hourOfDay}
                onChange={(v) => patchSimulation({ hourOfDay: v })}
              />
            </Section>

            <Section title="Layer Visibilitas">
              <div className="space-y-1.5">
                <StudioSwitch
                  label="Susunan Bata 3D"
                  checked={showBricksOverlay || view.showBricks}
                  onChange={(v) => {
                    patchView({ showBricks: v });
                    useBuildModeStore.setState({ showBricksOverlay: v });
                  }}
                />
                <StudioSwitch label="Plester & Cat" checked={view.showFinishing} onChange={(v) => patchView({ showFinishing: v })} />
                <StudioSwitch label="Struktur Beton / Baja" checked={view.showStructure} onChange={(v) => patchView({ showStructure: v })} />
                <StudioSwitch label="X-Ray Besi Tulangan" checked={view.xrayRebar} onChange={(v) => patchView({ xrayRebar: v })} />
                <StudioSwitch
                  label="Rumah Tetangga (Kiri/Kanan)"
                  checked={neighborsVisible && view.showNeighbors}
                  onChange={(v) => {
                    patchView({ showNeighbors: v });
                    useBuildModeStore.setState({ neighborsVisible: v });
                  }}
                />
              </div>
            </Section>
          </div>
        )}

        {tab === "validasi" && (
          <div className="space-y-2">
            {derived.validation.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-200">
                Semua pengecekan batas tetangga, bukaan, tangga &amp; pencahayaan SNI lolos tanpa catatan.
              </div>
            ) : (
              derived.validation.map((v) => (
                <div
                  key={v.id}
                  className={cn(
                    "rounded-xl border p-3",
                    v.severity === "critical"
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                      : v.severity === "warning"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                        : "border-sky-500/30 bg-sky-500/10 text-sky-200",
                  )}
                >
                  <div className="text-xs font-semibold">{v.title}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed opacity-90">{v.detail}</div>
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
        "flex h-7 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium transition",
        active ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5 border-b border-border/70 pb-3.5 last:border-b-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-tight text-foreground">
        <Layers className="h-3.5 w-3.5 text-primary" /> {title}
      </div>
      {children}
    </div>
  );
}
