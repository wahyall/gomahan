"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { BrickWall, Cable, ChevronRight, Eye, EyeOff, Fan, Home, Landmark, Layers, ListTree, PaintBucket, TreePine } from "lucide-react";

interface Props {
  derived: DerivedProjectModel;
  struct: StructuralReport;
}

export function OutlinerPanel({ derived, struct }: Props) {
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
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-[#21242a] px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <ListTree className="h-3.5 w-3.5 text-primary" /> Outliner Struktur & Elemen
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.map((r) => {
          const Icon = r.icon;
          const isSelected = selected?.kind === "part" && selected.id === r.partId;
          const isVisible = r.flagKey ? Boolean(view[r.flagKey]) : r.partId ? !view.hiddenParts.includes(r.partId) : true;
          return (
            <div
              key={r.id}
              onClick={() => r.partId && setSelected(isSelected ? null : { kind: "part", id: r.partId })}
              role={r.partId ? "button" : undefined}
              tabIndex={r.partId ? 0 : undefined}
              onKeyDown={(e) => {
                if (r.partId && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setSelected(isSelected ? null : { kind: "part", id: r.partId });
                }
              }}
              className={cn(
                "group flex h-7 items-center gap-1 rounded px-1.5 text-[11.5px]",
                r.partId ? "cursor-pointer hover:bg-accent/60" : "hover:bg-accent/30",
                isSelected && "bg-primary/20 font-semibold text-primary",
                r.indent === 1 && "pl-3.5",
                r.indent === 2 && "pl-6",
              )}
            >
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />}
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.note && <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground group-hover:inline">{r.note}</span>}
              {(r.flagKey || r.partId) && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (r.flagKey) patchView({ [r.flagKey]: !view[r.flagKey] });
                    else if (r.partId) toggleHiddenPart(r.partId);
                  }}
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded transition",
                    locked ? "opacity-30" : isVisible ? "text-primary hover:bg-primary/20" : "text-muted-foreground/50 hover:text-foreground",
                  )}
                  title={locked ? "Dikendalikan Timeline Konstruksi" : isVisible ? "Sembunyikan" : "Tampilkan"}
                >
                  {isVisible || locked ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
