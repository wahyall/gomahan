"use client";

import { useEffect, useRef, useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { GamificationEvaluation } from "@/lib/gamification/simsEngine";
import { HouseScene } from "@/lib/scene/HouseScene";
import { FURNITURE_CATALOG, HVAC_CATALOG, LIGHT_CATALOG } from "@/lib/model/catalog";
import { useStudioStore, type BuildTool, type CameraPreset } from "@/lib/store/useStudioStore";
import { PartInfoPanel } from "@/components/panels/PartInfoPanel";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import {
  Award,
  Boxes,
  BrickWall,
  CloudRain,
  DoorOpen,
  Droplets,
  Fan,
  Footprints,
  GitCompare,
  Grid3x3,
  Hammer,
  Layers,
  Lightbulb,
  MousePointer,
  PanelRight,
  Ruler,
  ShieldAlert,
  Sofa,
  Sun,
  Tag,
  Wind,
  Zap,
} from "lucide-react";

interface Props {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  rab: RabSummary;
  lighting: LightingSimulationResult;
  airflow: AirflowSimulationResult;
  flood: FloodSimulationResult;
  gamification: GamificationEvaluation;
  onSceneReady?: (scene: HouseScene | null) => void;
}

const TOOLS: { id: BuildTool; label: string; icon: React.ElementType }[] = [
  { id: "select", label: "Pilih / Geser", icon: MousePointer },
  { id: "wall", label: "Sekat Dinding", icon: BrickWall },
  { id: "door", label: "Tambah Pintu", icon: DoorOpen },
  { id: "window", label: "Tambah Jendela", icon: Layers },
  { id: "furniture", label: "Taruh Furnitur", icon: Sofa },
  { id: "hvac", label: "Taruh AC / Kipas", icon: Fan },
  { id: "light", label: "Taruh Lampu", icon: Lightbulb },
  { id: "demolish", label: "Palu Hapus", icon: Hammer },
];

export function Viewport3D({ derived, struct, rab, lighting, airflow, flood, gamification, onSceneReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HouseScene | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ label: string; x: number; y: number } | null>(null);
  const [showQuests, setShowQuests] = useState(false);

  const view = useStudioStore((s) => s.view);
  const patchView = useStudioStore((s) => s.patchView);
  const activeTool = useStudioStore((s) => s.activeTool);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const activeLevelIndex = useStudioStore((s) => s.activeLevelIndex);
  const setActiveLevelIndex = useStudioStore((s) => s.setActiveLevelIndex);
  const selected = useStudioStore((s) => s.selected);
  const setSelected = useStudioStore((s) => s.setSelected);
  const dockOpen = useStudioStore((s) => s.dockOpen);
  const setDockOpen = useStudioStore((s) => s.setDockOpen);
  const updateFurniture = useStudioStore((s) => s.updateFurniture);
  const updateHvac = useStudioStore((s) => s.updateHvac);
  const updateLight = useStudioStore((s) => s.updateLight);
  const addFurniture = useStudioStore((s) => s.addFurniture);
  const addHvac = useStudioStore((s) => s.addHvac);
  const addLight = useStudioStore((s) => s.addLight);
  const addWall = useStudioStore((s) => s.addWall);
  const addOpening = useStudioStore((s) => s.addOpening);
  const deleteWall = useStudioStore((s) => s.deleteWall);
  const deleteFurniture = useStudioStore((s) => s.deleteFurniture);
  const deleteHvac = useStudioStore((s) => s.deleteHvac);
  const deleteLight = useStudioStore((s) => s.deleteLight);
  const lockBaseline = useStudioStore((s) => s.lockBaseline);
  const baselineProject = useStudioStore((s) => s.baselineProject);

  // Mount Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;
    const sc = new HouseScene(canvasRef.current, {
      onSelect: (sel) => {
        const st = useStudioStore.getState();
        if (st.activeTool === "demolish" && sel && sel.kind !== "part") {
          if (sel.kind === "wall") st.deleteWall(sel.levelIndex as 0 | 1, sel.id);
          else if (sel.kind === "furniture") st.deleteFurniture(sel.levelIndex as 0 | 1, sel.id);
          else if (sel.kind === "hvac") st.deleteHvac(sel.levelIndex as 0 | 1, sel.id);
          else if (sel.kind === "light") st.deleteLight(sel.levelIndex as 0 | 1, sel.id);
          else if (sel.kind === "opening") st.deleteOpening(sel.levelIndex as 0 | 1, sel.wallId, sel.id);
          return;
        }
        st.setSelected(sel);
      },
      onHover: (label, x, y) => setHoverInfo(label ? { label, x, y } : null),
      onMoveEntity: (sel, x, z) => {
        const st = useStudioStore.getState();
        if (sel.kind === "furniture") {
          const cur = st.project.levels[sel.levelIndex]?.furniture.find((f) => f.id === sel.id);
          if (cur) st.updateFurniture(sel.levelIndex as 0 | 1, sel.id, { position: { ...cur.position, x, z } });
        } else if (sel.kind === "hvac") {
          const cur = st.project.levels[sel.levelIndex]?.hvac.find((h) => h.id === sel.id);
          if (cur) st.updateHvac(sel.levelIndex as 0 | 1, sel.id, { position: { ...cur.position, x, z } });
        } else if (sel.kind === "light") {
          const cur = st.project.levels[sel.levelIndex]?.lights.find((l) => l.id === sel.id);
          if (cur) st.updateLight(sel.levelIndex as 0 | 1, sel.id, { position: { ...cur.position, x, z } });
        }
      },
      onPlaceAt: (x, z, lvIdx) => {
        const st = useStudioStore.getState();
        const t = st.activeTool;
        if (t === "furniture") {
          const cat = FURNITURE_CATALOG.find((c) => c.catalogId === st.placeTemplate.furnitureCatalogId) ?? FURNITURE_CATALOG[0]!;
          st.addFurniture(lvIdx, {
            id: `furn-${Date.now().toString(36)}`,
            catalogId: cat.catalogId,
            name: cat.name,
            category: cat.category,
            position: { x, y: 0, z },
            size: { ...cat.defaultSize },
            rotationY: 0,
            colorHex: cat.colorHex,
            accentHex: cat.accentHex,
          });
          st.setActiveTool("select");
        } else if (t === "hvac") {
          const hCat =
            HVAC_CATALOG.find(
              (c) => c.type === st.placeTemplate.hvacType && (c.pkRating === st.placeTemplate.hvacPk || !c.pkRating),
            ) ?? HVAC_CATALOG[0]!;
          st.addHvac(lvIdx, {
            id: `hv-${Date.now().toString(36)}`,
            name: hCat.name,
            type: hCat.type,
            position: { x, y: hCat.defaultElevationM, z },
            rotationY: 0,
            pkRating: hCat.pkRating,
            flowRateM3h: hCat.flowRateM3h,
            coolingCapacityW: hCat.coolingCapacityW,
            powerW: hCat.powerW,
            setpointC: hCat.setpointC,
            speedLevel: 2,
            on: true,
          });
          st.setActiveTool("select");
        } else if (t === "light") {
          const lCat = LIGHT_CATALOG.find((c) => c.type === st.placeTemplate.lightType) ?? LIGHT_CATALOG[0]!;
          st.addLight(lvIdx, {
            id: `lgt-${Date.now().toString(36)}`,
            name: lCat.name,
            type: lCat.type,
            position: { x, y: lCat.defaultElevationM, z },
            lumens: lCat.lumens,
            colorTempK: lCat.colorTempK,
            beamAngleDeg: lCat.beamAngleDeg,
            dimmer: 1,
            on: true,
          });
          st.setActiveTool("select");
        } else if (t === "wall") {
          st.addWall(lvIdx, { x: Math.max(0.1, x - 1.0), z }, { x: Math.min(4.9, x + 1.0), z }, false);
          st.setActiveTool("select");
        } else if (t === "door" || t === "window") {
          // Attach to nearest non-party wall
          const lv = st.project.levels[lvIdx];
          if (!lv) return;
          let bestWall = lv.walls.find((w) => !w.partyWallSide);
          let bestDist = Infinity;
          let bestOff = 1.0;
          for (const w of lv.walls) {
            if (w.partyWallSide) continue;
            const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
            if (len < 1.1) continue;
            const ux = (w.end.x - w.start.x) / len;
            const uz = (w.end.z - w.start.z) / len;
            const proj = Math.max(0.6, Math.min(len - 0.6, (x - w.start.x) * ux + (z - w.start.z) * uz));
            const px = w.start.x + ux * proj;
            const pz = w.start.z + uz * proj;
            const d = Math.hypot(x - px, z - pz);
            if (d < bestDist) {
              bestDist = d;
              bestWall = w;
              bestOff = proj;
            }
          }
          if (bestWall) {
            st.addOpening(lvIdx, bestWall.id, {
              id: `op-${Date.now().toString(36)}`,
              kind: t,
              width: t === "door" ? 0.85 : 1.0,
              height: t === "door" ? 2.15 : 1.35,
              sill: t === "door" ? 0 : 0.85,
              offset: Number(bestOff.toFixed(2)),
              swing: 1,
              openPct: 50,
              frameMaterialId: t === "door" ? "wood_teak" : "alu_dark",
              label: t === "door" ? "Pintu Baru" : "Jendela Baru",
            });
          }
          st.setActiveTool("select");
        }
      },
      onWalkthroughExit: () => useStudioStore.getState().patchView({ cameraPreset: "3d" }),
    });
    sceneRef.current = sc;
    onSceneReady?.(sc);
    sc.setCameraPreset("3d");
    return () => {
      sc.dispose();
      sceneRef.current = null;
      onSceneReady?.(null);
    };
  }, [onSceneReady, addFurniture, addHvac, addLight, addOpening, addWall, deleteFurniture, deleteHvac, deleteLight, deleteWall, setSelected, updateFurniture, updateHvac, updateLight]);

  useEffect(() => {
    sceneRef.current?.update(derived, struct, lighting, airflow, flood, view, selected, activeLevelIndex, activeTool);
  }, [derived, struct, lighting, airflow, flood, view, selected, activeLevelIndex, activeTool]);

  const setPreset = (p: CameraPreset) => {
    patchView({ cameraPreset: p });
    sceneRef.current?.setCameraPreset(p);
  };

  const isSimpleMode = derived.project.gamification.mode === "simple";
  const budgetPct = Math.min(100, Math.round((rab.grandTotal / Math.max(1, rab.budgetCapIdr)) * 100));

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Blender-Style Viewport Top Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-[#21242a] px-2">
        <div className="flex items-center gap-0.5">
          {([
            ["3d", "3/4"],
            ["front", "Depan"],
            ["back", "Belakang"],
            ["side", "Samping"],
            ["top", "Atas"],
          ] as [CameraPreset, string][]).map(([id, lbl]) => (
            <ToolbarBtn key={id} active={view.cameraPreset === id} onClick={() => setPreset(id)}>
              {lbl}
            </ToolbarBtn>
          ))}
          <ToolbarBtn active={view.cameraPreset === "walkthrough"} onClick={() => setPreset("walkthrough")} title="Jalan Orang Pertama (WASD + Mouse)">
            <Footprints className="h-3 w-3" /> <span className="hidden lg:inline">Jalan</span>
          </ToolbarBtn>
        </div>

        <Sep />

        <ToolbarBtn active={!view.ortho} onClick={() => patchView({ ortho: false })}>Persp</ToolbarBtn>
        <ToolbarBtn active={view.ortho} onClick={() => patchView({ ortho: true })}>Orto</ToolbarBtn>

        <Sep />

        <ToolbarBtn active={view.activeLevelView === "lt1"} onClick={() => { setActiveLevelIndex(0); patchView({ activeLevelView: "lt1" }); }}>LT1</ToolbarBtn>
        <ToolbarBtn active={view.activeLevelView === "all"} onClick={() => { setActiveLevelIndex(1); patchView({ activeLevelView: "all" }); }}>LT1+LT2</ToolbarBtn>

        <Sep />

        <ToolbarBtn active={view.explode > 0.05} onClick={() => patchView({ explode: view.explode > 0.05 ? 0 : 1 })} title="Bongkar Granular (Exploded View)">
          <Boxes className="h-3 w-3" /> <span className="hidden md:inline">Bongkar</span>
        </ToolbarBtn>
        <ToolbarBtn active={view.wireframe} onClick={() => patchView({ wireframe: !view.wireframe })}>Wire</ToolbarBtn>
        <ToolbarBtn active={view.xrayRebar} onClick={() => patchView({ xrayRebar: !view.xrayRebar })} title="X-Ray Tulangan Besi SNI">Besi</ToolbarBtn>

        <Sep />

        <ToolbarBtn active={view.showAir} onClick={() => patchView({ showAir: !view.showAir })} title="Pipa Air & Bio Septic (X-Ray)">
          <Droplets className="h-3 w-3 text-sky-400" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showListrik} onClick={() => patchView({ showListrik: !view.showListrik })} title="Kabel & Panel MCB (X-Ray)">
          <Zap className="h-3 w-3 text-amber-400" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showLuxHeatmap} onClick={() => patchView({ showLuxHeatmap: !view.showLuxHeatmap })} title="Heatmap Pencahayaan (Lux)">
          <Sun className="h-3 w-3 text-yellow-300" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showAirParticles} onClick={() => patchView({ showAirParticles: !view.showAirParticles })} title="Partikel Aliran Angin, Kipas & AC">
          <Wind className="h-3 w-3 text-teal-400" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showFloodWater || view.showRain} onClick={() => patchView({ showFloodWater: !view.showFloodWater, showRain: !view.showRain })} title="Overlay Hujan & Genangan Banjir">
          <CloudRain className="h-3 w-3 text-cyan-300" />
        </ToolbarBtn>

        <Sep />

        <ToolbarBtn active={view.showLabels} onClick={() => patchView({ showLabels: !view.showLabels })} title="Label Ruangan">
          <Tag className="h-3 w-3" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showDims} onClick={() => patchView({ showDims: !view.showDims })} title="Dimensi 3D">
          <Ruler className="h-3 w-3" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showGrid} onClick={() => patchView({ showGrid: !view.showGrid })} title="Grid Studio">
          <Grid3x3 className="h-3 w-3" />
        </ToolbarBtn>

        <div className="ml-auto flex items-center gap-1">
          <ToolbarBtn
            active={view.beforeAfterEnabled}
            onClick={() => patchView({ beforeAfterEnabled: !view.beforeAfterEnabled })}
            title="Bandingkan Desain Awal vs Revisi (Before/After)"
          >
            <GitCompare className="h-3 w-3" />
          </ToolbarBtn>
          <ToolbarBtn active={dockOpen} onClick={() => setDockOpen(!dockOpen)} title="Panel Kanan (Outliner & Properti)">
            <PanelRight className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>
      </div>

      {/* Main Canvas + Left Sims Tool Rail */}
      <div className="relative flex min-h-0 flex-1">
        {/* Left Tool Rail (Sims 4 Build/Buy Tools) */}
        <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-[#1a1d22] py-2">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTool(t.id)}
                title={t.label}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded border transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        {/* 3D Canvas Container */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            className={cn(
              "viewport-canvas h-full w-full",
              activeTool === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair",
            )}
          />

          {/* Top-Left Sims 4 Gamification & Engineering HUD */}
          <div className="pointer-events-none absolute left-2.5 top-2.5 flex max-w-[340px] flex-col gap-1.5">
            {isSimpleMode && (
              <div className="pointer-events-auto rounded-md border border-white/10 bg-[#14171c]/88 p-2.5 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="font-bold text-primary">Budget Meter (Target {fmtRp(rab.budgetCapIdr)})</span>
                  <span className={cn("font-mono font-bold", rab.overBudget ? "text-red-400" : "text-emerald-400")}>
                    {budgetPct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full transition-all", rab.overBudget ? "bg-red-500" : "bg-emerald-500")}
                    style={{ width: `${Math.min(100, budgetPct)}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="text-muted-foreground">
                    Skor Kenyamanan: <b className="font-mono text-teal-300">{gamification.overallComfortScore}/100</b>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowQuests(!showQuests)}
                    className="flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/30"
                  >
                    <Award className="h-3 w-3" /> Misi & Lencana ({gamification.badges.filter((b) => b.unlocked).length}/5)
                  </button>
                </div>

                {showQuests && (
                  <div className="mt-2 space-y-2 border-t border-white/10 pt-2 text-[10.5px]">
                    <div className="flex flex-wrap gap-1">
                      {gamification.badges.map((b) => (
                        <span
                          key={b.id}
                          title={b.subtitle}
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[9.5px] font-semibold",
                            b.unlocked ? "border-amber-400/40 bg-amber-400/15 text-amber-200" : "border-white/10 bg-white/5 text-muted-foreground",
                          )}
                        >
                          {b.unlocked ? "★ " : ""}
                          {b.title}
                        </span>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {gamification.quests.map((q) => (
                        <div key={q.id} className={cn("flex items-start gap-1.5", q.done ? "text-emerald-300 line-through opacity-75" : "text-foreground/90")}>
                          <span>{q.done ? "✓" : "○"}</span>
                          <span>{q.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quick Masonry & Area Summary Pill */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded border border-white/10 bg-black/60 px-2.5 py-1 text-[10.5px] text-stone-200 backdrop-blur-sm">
              <span>
                Bata: <b className="font-mono text-primary">{fmtNum(derived.masonry.totalPiecesPlaced)}</b> bh ({derived.project.systems.brick.lengthMm}×{derived.project.systems.brick.heightMm}×{derived.project.systems.brick.depthMm} mm)
              </span>
              <span className="text-stone-500">|</span>
              <span>
                Bersih: <b className="font-mono">{fmtNum(derived.totalNetFloorM2, 1)} m²</b>
              </span>
              {derived.validation.some((v) => v.severity === "critical") && (
                <span className="flex items-center gap-1 text-red-400 font-semibold">
                  <ShieldAlert className="h-3 w-3" /> {derived.validation.filter((v) => v.severity === "critical").length} Peringatan
                </span>
              )}
            </div>

            {activeTool !== "select" && (
              <div className="pointer-events-auto rounded border border-primary/50 bg-primary/20 px-2.5 py-1 text-[11px] font-semibold text-primary backdrop-blur-sm">
                Mode: {TOOLS.find((t) => t.id === activeTool)?.label} — Klik lantai / elemen pada LT{activeLevelIndex + 1} (Esc batal)
              </div>
            )}

            {view.cameraPreset === "walkthrough" && (
              <div className="pointer-events-auto rounded border border-teal-400/40 bg-teal-950/80 px-2.5 py-1 text-[11px] text-teal-200">
                Walkthrough Aktif: Gunakan <b>W A S D</b> / Panah untuk jalan, <b>Q/E</b> naik-turun, <b>Geser Mouse</b> lihat sekitar, <b>Esc</b> keluar.
              </div>
            )}
          </div>

          {/* Before / After Baseline Comparison Overlay */}
          {view.beforeAfterEnabled && (
            <div className="pointer-events-auto absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-md border border-primary/40 bg-card/95 px-3 py-1.5 text-[11px] shadow-xl backdrop-blur">
              <span>
                Baseline Awal: <b className="font-mono">{baselineProject.systems.brick.name.split("(")[0]}</b> · {baselineProject.systems.foundation}
              </span>
              <span className="text-muted-foreground">→</span>
              <span>
                Sekarang: <b className="font-mono text-primary">{fmtRp(rab.grandTotal)}</b> ({fmtNum(derived.masonry.totalBuyBricks)} bata)
              </span>
              <button
                type="button"
                onClick={lockBaseline}
                className="rounded bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/30"
              >
                Kunci Sebagai Baseline
              </button>
            </div>
          )}

          {/* Top-Right Interactive View Cube */}
          <div className="absolute right-2.5 top-2.5 flex flex-col items-center gap-1">
            <div className="rounded border border-white/10 bg-black/55 p-1 backdrop-blur-sm">
              <svg width="58" height="58" viewBox="0 0 62 62">
                <polygon
                  points="31,7 52,17.5 31,28 10,17.5"
                  onClick={() => setPreset("top")}
                  className="cursor-pointer fill-stone-600/60 stroke-stone-300/60 hover:fill-primary/70"
                />
                <text x="31" y="21" textAnchor="middle" fontSize="6.5" className="pointer-events-none fill-stone-100">ATAS</text>
                <polygon
                  points="10,17.5 31,28 31,53 10,42.5"
                  onClick={() => setPreset("front")}
                  className="cursor-pointer fill-stone-700/70 stroke-stone-300/60 hover:fill-primary/70"
                />
                <text x="20.5" y="39" textAnchor="middle" fontSize="6.5" className="pointer-events-none fill-stone-100">DEPAN</text>
                <polygon
                  points="52,17.5 52,42.5 31,53 31,28"
                  onClick={() => setPreset("side")}
                  className="cursor-pointer fill-stone-800/80 stroke-stone-300/60 hover:fill-primary/70"
                />
                <text x="41.5" y="39" textAnchor="middle" fontSize="6.5" className="pointer-events-none fill-stone-100">SAMP</text>
              </svg>
            </div>
            <button
              type="button"
              onClick={() => setPreset("3d")}
              className="rounded border border-white/10 bg-black/55 px-2 py-0.5 text-[10px] text-stone-200 hover:border-primary hover:text-primary"
            >
              3/4
            </button>
          </div>

          {/* Hover Tooltip */}
          {hoverInfo && (
            <div
              className="pointer-events-none absolute z-10 rounded border border-primary/50 bg-[#14161a]/95 px-2 py-1 text-[10.5px] font-medium text-foreground shadow-lg"
              style={hoverInfo.x > 460 ? { right: 16, top: hoverInfo.y - 12 } : { left: hoverInfo.x + 14, top: hoverInfo.y - 12 }}
            >
              {hoverInfo.label} <span className="text-muted-foreground">· klik detail</span>
            </div>
          )}

          {/* Legend Bottom Left */}
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 hidden flex-wrap gap-2 rounded border border-white/10 bg-black/55 px-2.5 py-1 text-[10px] text-stone-300 backdrop-blur-sm md:flex">
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-xs bg-[#efede6]" /> Bata / Plester</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-xs bg-[#8f9295]" /> Beton SNI</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-xs bg-[#363b40]" /> Atap Shed 10°</span>
            {view.showAir && <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-xs bg-[#3ea2f4]" /> Pipa Air</span>}
            {view.showListrik && <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-xs bg-[#f5c442]" /> Listrik</span>}
            {view.showFloodWater && flood.streetFloodCm > 0 && (
              <span className="inline-flex items-center gap-1 text-cyan-300"><i className="h-2.5 w-2.5 rounded-xs bg-[#5c7c7a]" /> Banjir {flood.streetFloodCm} cm</span>
            )}
          </div>

          {/* Floating Part / Entity Detail Panel */}
          <PartInfoPanel derived={derived} struct={struct} rab={rab} />
        </div>
      </div>
    </section>
  );
}

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[10.5px] font-medium transition",
        active ? "bg-primary text-primary-foreground" : "text-stone-300 hover:bg-white/10 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}
