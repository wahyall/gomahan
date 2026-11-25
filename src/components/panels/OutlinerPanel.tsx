"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { BrickWall, Cable, ChevronRight, Eye, EyeOff, Fan, Home, Landmark, Layers, ListTree, PaintBucket, TreePine, X } from "lucide-react";

interface Props {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  onCloseDrawer?: () => void;
}

export function OutlinerPanel({ derived, struct, onCloseDrawer }: Props) {
  const view = useStudioStore((s) => s.view);
  const patchView = useStudioStore((s) => s.patchView);
  const toggleHiddenPart = useStudioStore((s) => s.toggleHiddenPart);
  const selected = useStudioStore((s) => s.selected);
  const setSelected = useStudioStore((s) => s.setSelected);

  const locked = view.stage > 0;
  const rows: {
    id: string;
    label: string;
    note?: string;
    indent: number;
    icon?: React.ElementType;
    partId?: string;
    flagKey?: "showStructure" | "showBricks" | "showRangka" | "showRoof" | "showFinishing" | "showAir" | "showListrik" | "showLabels" | "showDims";
  }[] = [
    { id: "root", label: "Rumah 5×17 m (2 Lantai)", note: `${fmtNum(derived.totalNetFloorM2, 1)} m²`, indent: 0, icon: Home },
    { id: "pondasi", label: `Pondasi (${derived.project.systems.foundation})`, note: `${struct.foundations.length} titik`, indent: 1, icon: Landmark, partId: "pondasi" },
    { id: "sloof", label: "Sloof, Kolom, Balok & Pelat LT2", note: `${struct.columns.length} kolom`, indent: 1, icon: Layers, partId: "kolom", flagKey: "showStructure" },
    { id: "tangga", label: "Tangga Beton (20 Anak Tangga)", note: "3,60 m", indent: 2, partId: "tangga" },
    { id: "dinding", label: `Bata (${derived.project.systems.brick.name.split("(")[0]!.trim()})`, note: `${fmtNum(derived.masonry.totalPiecesPlaced)} bh`, indent: 1, icon: BrickWall, partId: "dinding", flagKey: "showBricks" },
    { id: "pintu", label: "Pintu & Kusen", note: `${derived.totalDoors} unit`, indent: 2, partId: "pintu" },
    { id: "jendela", label: "Jendela Kaca", note: `${derived.totalWindows} unit`, indent: 2, partId: "jendela" },
    { id: "vent", label: "Roster Lubang Angin", note: `${derived.totalVents} bh`, indent: 2, partId: "vent" },
    { id: "rangka", label: "Rangka Baja Ringan C75", note: `${derived.roof.trussCount} rangka`, indent: 1, icon: TreePine, partId: "rangka", flagKey: "showRangka" },
    { id: "genteng", label: `Atap ${derived.project.systems.roofType} (${derived.roof.slopeDeg}°)`, note: `${fmtNum(derived.roof.areaM2, 0)} m²`, indent: 2, partId: "genteng", flagKey: "showRoof" },
    { id: "talang", label: "Talang Depan & Sumur Resapan", note: `${derived.project.floodMitigation.infiltrationWells} sumur`, indent: 2, partId: "talang" },
    { id: "fin", label: "Plester, Cat & Keramik", note: `${derived.project.systems.tileSizeCm}×${derived.project.systems.tileSizeCm}`, indent: 1, icon: PaintBucket, partId: "cat", flagKey: "showFinishing" },
    { id: "lantai", label: "Lantai Keramik & Carport", note: `${fmtNum(derived.floors.reduce((s, f) => s + f.totalTiles, 0))} kpg`, indent: 2, partId: "lantai" },
    { id: "air", label: "Instalasi Air & Bio Septic (X-Ray)", note: `${Math.ceil(derived.mep.airBersihM + derived.mep.airKotorM)} m`, indent: 1, icon: Cable, partId: "pipaAirBersih", flagKey: "showAir" },
    { id: "listrik", label: "Instalasi Listrik & PUIL (X-Ray)", note: `${derived.mep.titikLampu} lampu`, indent: 1, icon: Cable, partId: "listrikLampu", flagKey: "showListrik" },
    { id: "hvac", label: "Unit AC & Kipas (Movable)", note: `${derived.mep.acCount} AC · ${derived.mep.fanCount} Kipas`, indent: 1, icon: Fan, partId: "acUnit" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-border">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-[#161a21] px-3 text-xs font-semibold text-foreground">
        <div className="flex items-center gap-2">
          <ListTree className="h-3.5 w-3.5 text-primary" />
          <span>Outliner Elemen</span>
        </div>
        {onCloseDrawer && (
          <button
            type="button"
            aria-label="Tutup Panel SNI & Outliner"
            onClick={onCloseDrawer}
            className="rounded-md p-1 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.map((r) => {
          const Icon = r.icon;
          const isSelected = selected?.kind === "part" && selected.id === r.partId;
          const isVisible = r.flagKey ? Boolean(view[r.flagKey]) : r.partId ? !view.hiddenParts.includes(r.partId) : true;
          return (
            <div
              key={r.id}
              className={cn(
                "group flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[11.5px] transition-colors",
                r.partId ? "hover:bg-white/[0.06]" : "hover:bg-white/[0.03]",
                isSelected && "bg-primary/15 font-semibold text-primary",
                r.indent === 1 && "pl-4",
                r.indent === 2 && "pl-7",
              )}
            >
              {r.partId ? (
                <button
                  type="button"
                  onClick={() => setSelected(isSelected ? null : { kind: "part", id: r.partId! })}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left outline-none focus-visible:text-primary"
                >
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden />
                  {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.note && <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums group-hover:inline">{r.note}</span>}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden />
                  {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.note && <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums group-hover:inline">{r.note}</span>}
                </div>
              )}
              {(r.flagKey || r.partId) && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    if (r.flagKey) patchView({ [r.flagKey]: !view[r.flagKey] });
                    else if (r.partId) toggleHiddenPart(r.partId);
                  }}
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition",
                    locked ? "opacity-30" : isVisible ? "text-primary hover:bg-primary/20" : "text-muted-foreground/45 hover:text-foreground",
                  )}
                  aria-label={locked ? "Dikendalikan Timeline Konstruksi" : `${isVisible ? "Sembunyikan" : "Tampilkan"} ${r.label}`}
                  title={locked ? "Dikendalikan Timeline Konstruksi" : isVisible ? "Sembunyikan" : "Tampilkan"}
                >
                  {isVisible || locked ? <Eye className="h-3.5 w-3.5" aria-hidden /> : <EyeOff className="h-3.5 w-3.5" aria-hidden />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
