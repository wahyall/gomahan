"use client";

import { FURNITURE_CATALOG, HVAC_CATALOG, LIGHT_CATALOG } from "@/lib/model/catalog";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { Fan, Lightbulb, Plus, Sofa } from "lucide-react";

export function BuildFurnishDrawer() {
  const activeLevelIndex = useStudioStore((s) => s.activeLevelIndex);
  const setActiveLevelIndex = useStudioStore((s) => s.setActiveLevelIndex);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const patchPlaceTemplate = useStudioStore((s) => s.patchPlaceTemplate);
  const placeTemplate = useStudioStore((s) => s.placeTemplate);
  const addFurniture = useStudioStore((s) => s.addFurniture);
  const addHvac = useStudioStore((s) => s.addHvac);
  const addLight = useStudioStore((s) => s.addLight);

  return (
    <div className="flex w-[260px] shrink-0 flex-col border-r border-border bg-[#191c21]">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Katalog Sims 4 Build/Buy</span>
        <div className="flex rounded border border-border bg-card p-0.5 text-[10px]">
          {([0, 1] as const).map((idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveLevelIndex(idx)}
              className={cn("rounded px-1.5 py-0.5 font-semibold", activeLevelIndex === idx ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              LT{idx + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2.5 text-xs">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Fan className="h-3 w-3 text-teal-400" /> AC & Kipas (Bisa Dipindah)
          </div>
          <div className="space-y-1">
            {HVAC_CATALOG.map((h) => (
              <div key={h.name} className="flex items-center justify-between rounded border border-border bg-card p-2">
                <div className="min-w-0 pr-1">
                  <div className="truncate text-[11px] font-semibold">{h.name}</div>
                  <div className="truncate text-[9.5px] text-muted-foreground">{h.powerW}W · {h.flowRateM3h} m³/j</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      patchPlaceTemplate({ hvacType: h.type, hvacPk: h.pkRating });
                      setActiveTool("hvac");
                    }}
                    className="rounded border border-primary/50 bg-primary/15 px-1.5 py-1 text-[10px] font-semibold text-primary hover:bg-primary/25"
                    title="Klik posisi di 3D"
                  >
                    Taruh
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      addHvac(activeLevelIndex, {
                        id: `hv-${Date.now().toString(36)}`,
                        name: h.name,
                        type: h.type,
                        position: { x: 2.5, y: h.defaultElevationM, z: 9.5 },
                        rotationY: 0,
                        pkRating: h.pkRating,
                        flowRateM3h: h.flowRateM3h,
                        coolingCapacityW: h.coolingCapacityW,
                        powerW: h.powerW,
                        setpointC: h.setpointC,
                        speedLevel: 2,
                        on: true,
                      })
                    }
                    className="rounded border border-border bg-secondary p-1 text-muted-foreground hover:text-foreground"
                    title="Tambah langsung di tengah ruangan"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Lightbulb className="h-3 w-3 text-amber-400" /> Lampu & Pencahayaan
          </div>
          <div className="grid grid-cols-1 gap-1">
            {LIGHT_CATALOG.map((l) => (
              <div key={l.name} className="flex items-center justify-between rounded border border-border bg-card p-1.5">
                <div className="min-w-0 pr-1">
                  <div className="truncate text-[11px] font-medium">{l.name}</div>
                  <div className="text-[9.5px] text-muted-foreground">{l.lumens} lm · {l.colorTempK}K</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    addLight(activeLevelIndex, {
                      id: `lgt-${Date.now().toString(36)}`,
                      name: l.name,
                      type: l.type,
                      position: { x: 2.5, y: l.defaultElevationM, z: 9.5 },
                      lumens: l.lumens,
                      colorTempK: l.colorTempK,
                      beamAngleDeg: l.beamAngleDeg,
                      dimmer: 1,
                      on: true,
                    })
                  }
                  className="rounded border border-border bg-secondary px-2 py-1 text-[10px] hover:border-primary"
                >
                  + Pasang
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Sofa className="h-3 w-3 text-primary" /> Furnitur & Kendaraan
          </div>
          <div className="space-y-1">
            {FURNITURE_CATALOG.map((f) => (
              <div
                key={f.catalogId}
                className={cn(
                  "flex items-center justify-between rounded border p-1.5",
                  placeTemplate.furnitureCatalogId === f.catalogId ? "border-primary bg-primary/10" : "border-border bg-card",
                )}
              >
                <div className="min-w-0 pr-1">
                  <div className="truncate text-[11px] font-medium">{f.name}</div>
                  <div className="text-[9.5px] text-muted-foreground">
                    {f.defaultSize.x}×{f.defaultSize.z} m
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      patchPlaceTemplate({ furnitureCatalogId: f.catalogId });
                      setActiveTool("furniture");
                    }}
                    className="rounded border border-primary/50 bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
                  >
                    Taruh
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      addFurniture(activeLevelIndex, {
                        id: `fn-${Date.now().toString(36)}`,
                        catalogId: f.catalogId,
                        name: f.name,
                        category: f.category,
                        position: { x: 2.5, y: 0, z: 9.5 },
                        size: { ...f.defaultSize },
                        rotationY: 0,
                        colorHex: f.colorHex,
                        accentHex: f.accentHex,
                      })
                    }
                    className="rounded border border-border bg-secondary p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
