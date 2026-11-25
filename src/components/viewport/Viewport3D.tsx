"use client";

import { useEffect, useRef, useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { GamificationEvaluation } from "@/lib/gamification/simsEngine";
import { HouseScene, type QualityTier, type SceneStatsSnapshot, type WebGLStatus } from "@/lib/scene/HouseScene";
import { useStudioStore, type CameraPreset } from "@/lib/store/useStudioStore";
import { PartInfoPanel } from "@/components/panels/PartInfoPanel";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import {
  Award,
  Boxes,
  CloudRain,
  Droplets,
  GitCompare,
  Grid3x3,
  Ruler,
  ShieldAlert,
  Sun,
  Tag,
  Wind,
  X,
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

export function Viewport3D({ derived, struct, rab, lighting, airflow, flood, gamification, onSceneReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HouseScene | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ label: string; x: number; y: number } | null>(null);
  const [showQuests, setShowQuests] = useState(false);
  const [webglStatus, setWebglStatus] = useState<WebGLStatus>("ok");
  const [sceneStats, setSceneStats] = useState<SceneStatsSnapshot | null>(null);
  const [qualityOverride, setQualityOverride] = useState<QualityTier | "auto">("auto");
  const [showControlHint, setShowControlHint] = useState(true);

  const view = useStudioStore((s) => s.view);
  const patchView = useStudioStore((s) => s.patchView);
  const setActiveLevelIndex = useStudioStore((s) => s.setActiveLevelIndex);
  const selected = useStudioStore((s) => s.selected);
  const lockBaseline = useStudioStore((s) => s.lockBaseline);
  const baselineProject = useStudioStore((s) => s.baselineProject);

  // Mount Three.js analytical viewer
  useEffect(() => {
    if (!canvasRef.current) return;
    const sc = new HouseScene(canvasRef.current, {
      onSelect: (sel) => useStudioStore.getState().setSelected(sel),
      onHover: (label, x, y) => setHoverInfo(label ? { label, x, y } : null),
      onWebGLStatus: (status) => setWebglStatus(status),
      onStats: (stats) => setSceneStats(stats),
    });
    sceneRef.current = sc;
    onSceneReady?.(sc);
    sc.setCameraPreset("3d");
    return () => {
      sc.dispose();
      sceneRef.current = null;
      onSceneReady?.(null);
    };
  }, [onSceneReady]);

  useEffect(() => {
    sceneRef.current?.update(derived, struct, lighting, airflow, flood, view, selected);
  }, [derived, struct, lighting, airflow, flood, view, selected]);

  const setPreset = (p: CameraPreset) => {
    patchView({ cameraPreset: p });
    sceneRef.current?.setCameraPreset(p);
  };

  const isSimpleMode = derived.project.gamification.mode === "simple";
  const budgetPct = Math.min(100, Math.round((rab.grandTotal / Math.max(1, rab.budgetCapIdr)) * 100));

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Analytical Viewport Top Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-[#151920] px-2.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-black/25 p-0.5">
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
        </div>

        <Sep />

        <div className="flex items-center gap-0.5 rounded-lg bg-black/25 p-0.5">
          <ToolbarBtn active={!view.ortho} onClick={() => patchView({ ortho: false })}>
            Persp
          </ToolbarBtn>
          <ToolbarBtn active={view.ortho} onClick={() => patchView({ ortho: true })}>
            Orto
          </ToolbarBtn>
        </div>

        <Sep />

        <div className="flex items-center gap-0.5 rounded-lg bg-black/25 p-0.5">
          <ToolbarBtn
            active={view.activeLevelView === "lt1"}
            onClick={() => {
              setActiveLevelIndex(0);
              patchView({ activeLevelView: "lt1" });
            }}
          >
            LT1
          </ToolbarBtn>
          <ToolbarBtn
            active={view.activeLevelView === "all"}
            onClick={() => {
              setActiveLevelIndex(1);
              patchView({ activeLevelView: "all" });
            }}
          >
            LT1+2
          </ToolbarBtn>
        </div>

        <Sep />

        <ToolbarBtn active={view.explode > 0.05} onClick={() => patchView({ explode: view.explode > 0.05 ? 0 : 1 })} title="Bongkar Granular (Exploded View)">
          <Boxes className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Bongkar</span>
        </ToolbarBtn>
        <ToolbarBtn active={view.wireframe} onClick={() => patchView({ wireframe: !view.wireframe })}>
          Wire
        </ToolbarBtn>
        <ToolbarBtn active={view.xrayRebar} onClick={() => patchView({ xrayRebar: !view.xrayRebar })} title="X-Ray Tulangan Besi SNI">
          Besi
        </ToolbarBtn>

        <Sep />

        <ToolbarBtn active={view.showAir} onClick={() => patchView({ showAir: !view.showAir })} title="Pipa Air & Bio Septic">
          <Droplets className="h-3.5 w-3.5 text-sky-400" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showListrik} onClick={() => patchView({ showListrik: !view.showListrik })} title="Kabel & Panel MCB">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showLuxHeatmap} onClick={() => patchView({ showLuxHeatmap: !view.showLuxHeatmap })} title="Heatmap Pencahayaan (Lux)">
          <Sun className="h-3.5 w-3.5 text-amber-300" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showAirParticles} onClick={() => patchView({ showAirParticles: !view.showAirParticles })} title="Partikel Aliran Angin">
          <Wind className="h-3.5 w-3.5 text-teal-400" />
        </ToolbarBtn>
        <ToolbarBtn
          active={view.showFloodWater || view.showRain}
          onClick={() => patchView({ showFloodWater: !view.showFloodWater, showRain: !view.showRain })}
          title="Overlay Hujan & Banjir"
        >
          <CloudRain className="h-3.5 w-3.5 text-cyan-300" />
        </ToolbarBtn>

        <Sep />

        <ToolbarBtn active={view.showLabels} onClick={() => patchView({ showLabels: !view.showLabels })} title="Label Ruangan">
          <Tag className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showDims} onClick={() => patchView({ showDims: !view.showDims })} title="Dimensi 3D">
          <Ruler className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn active={view.showGrid} onClick={() => patchView({ showGrid: !view.showGrid })} title="Grid Studio">
          <Grid3x3 className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <div className="ml-auto flex items-center gap-1">
          <ToolbarBtn
            active={view.beforeAfterEnabled}
            onClick={() => patchView({ beforeAfterEnabled: !view.beforeAfterEnabled })}
            title="Bandingkan Desain Awal vs Revisi"
          >
            <GitCompare className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>
      </div>

      {/* Main 3D Canvas */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <canvas ref={canvasRef} className="viewport-canvas h-full w-full cursor-grab active:cursor-grabbing" />

          {/* Top Overlay Row */}
          <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-start justify-between gap-2">
            <div className="flex min-w-0 max-w-[calc(100%-70px)] flex-col gap-1.5 sm:max-w-[340px]">
              {isSimpleMode && (
                <div className="studio-glass pointer-events-auto rounded-2xl p-2.5 [@media(max-height:480px)]:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10.5px]">
                    <span className="truncate font-semibold text-primary">Target {fmtRp(rab.budgetCapIdr)}</span>
                    <span className={cn("font-mono font-bold tabular-nums", rab.overBudget ? "text-rose-300" : "text-emerald-300")}>
                      {fmtRp(rab.grandTotal)} ({budgetPct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn("h-full rounded-full transition-all", rab.overBudget ? "bg-rose-400" : "bg-emerald-400")}
                      style={{ width: `${Math.min(100, budgetPct)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
                    <span className="text-muted-foreground">
                      Skor Kinerja: <b className="font-mono text-foreground tabular-nums">{gamification.overallComfortScore}/100</b>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowQuests(!showQuests)}
                      className="flex min-h-7 items-center gap-1 rounded-lg bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/25"
                    >
                      <Award className="h-3 w-3 shrink-0" />
                      <span>Misi ({gamification.badges.filter((b) => b.unlocked).length}/5)</span>
                    </button>
                  </div>

                  {showQuests && (
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto border-t border-white/[0.08] pt-2 text-[10.5px]">
                      <div className="flex flex-wrap gap-1">
                        {gamification.badges.map((b) => (
                          <span
                            key={b.id}
                            title={b.subtitle}
                            className={cn(
                              "rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold",
                              b.unlocked ? "border-amber-400/40 bg-amber-400/15 text-amber-200" : "border-white/10 bg-white/5 text-muted-foreground",
                            )}
                          >
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
              <div className="studio-glass pointer-events-auto flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-xl px-2.5 py-1.5 text-[10.5px] text-foreground/90">
                <span>
                  Bata Beli: <b className="font-mono text-primary tabular-nums">{fmtNum(derived.masonry.totalBuyBricks)}</b> bh
                </span>
                <span className="text-muted-foreground">·</span>
                <span>
                  Bersih: <b className="font-mono tabular-nums">{fmtNum(derived.totalNetFloorM2, 1)} m²</b>
                </span>
                {derived.validation.some((v) => v.severity === "critical") && (
                  <span className="flex items-center gap-1 font-semibold text-rose-300">
                    <ShieldAlert className="h-3 w-3" /> {derived.validation.filter((v) => v.severity === "critical").length} Kritis
                  </span>
                )}
              </div>
            </div>

            {/* Interactive View Cube */}
            <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-1">
              <div className="studio-glass rounded-xl p-1">
                <svg width="50" height="50" viewBox="0 0 62 62" className="sm:h-[56px] sm:w-[56px]" aria-label="Kubus orientasi kamera 3D">
                  <polygon
                    points="31,7 52,17.5 31,28 10,17.5"
                    role="button"
                    tabIndex={0}
                    aria-label="Kamera Atas"
                    onClick={() => setPreset("top")}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPreset("top")}
                    className="cursor-pointer fill-stone-600/60 stroke-stone-300/60 hover:fill-primary/70 focus:outline-none focus:fill-primary"
                  />
                  <text x="31" y="21" textAnchor="middle" fontSize="6.5" className="pointer-events-none fill-stone-100">ATAS</text>
                  <polygon
                    points="10,17.5 31,28 31,53 10,42.5"
                    role="button"
                    tabIndex={0}
                    aria-label="Kamera Depan"
                    onClick={() => setPreset("front")}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPreset("front")}
                    className="cursor-pointer fill-stone-700/70 stroke-stone-300/60 hover:fill-primary/70 focus:outline-none focus:fill-primary"
                  />
                  <text x="20.5" y="39" textAnchor="middle" fontSize="6.5" className="pointer-events-none fill-stone-100">DEPAN</text>
                  <polygon
                    points="52,17.5 52,42.5 31,53 31,28"
                    role="button"
                    tabIndex={0}
                    aria-label="Kamera Samping"
                    onClick={() => setPreset("side")}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPreset("side")}
                    className="cursor-pointer fill-stone-800/80 stroke-stone-300/60 hover:fill-primary/70 focus:outline-none focus:fill-primary"
                  />
                  <text x="41.5" y="39" textAnchor="middle" fontSize="6.5" className="pointer-events-none fill-stone-100">SAMP</text>
                </svg>
              </div>
              <button
                type="button"
                onClick={() => setPreset("3d")}
                aria-label="Reset kamera 3/4 isometrik"
                className="studio-glass min-h-6 rounded-lg px-2.5 py-0.5 text-[10px] font-semibold text-foreground hover:text-primary"
              >
                3/4
              </button>
            </div>
          </div>

          {webglStatus === "ok" && !sceneStats && (
            <div className="studio-glass pointer-events-none absolute bottom-12 right-3 z-10 rounded-xl px-3 py-1.5 text-[11px] text-foreground">
              Menyiapkan mesin render 3D &amp; material...
            </div>
          )}

          {showControlHint && !selected && !view.beforeAfterEnabled && (
            <div className="studio-glass pointer-events-auto absolute bottom-2.5 right-2.5 hidden items-center gap-2 rounded-xl px-2.5 py-1 text-[10px] text-muted-foreground [@media(min-width:1024px)_and_(min-height:520px)]:flex">
              <span>Seret: Putar · Kanan/Shift: Geser · Scroll: Zoom · Klik elemen: Detail RAB</span>
              <button
                type="button"
                aria-label="Tutup panduan kontrol"
                onClick={() => setShowControlHint(false)}
                className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {view.beforeAfterEnabled && (
            <div className="studio-glass pointer-events-auto absolute bottom-12 left-1/2 z-20 flex max-w-[94%] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border-primary/40 px-3 py-1.5 text-[11px]">
              <span>
                Baseline: <b className="font-mono">{baselineProject.systems.brick.name.split("(")[0]}</b>
              </span>
              <span className="text-muted-foreground">→</span>
              <span>
                Sekarang: <b className="font-mono text-primary">{fmtRp(rab.grandTotal)}</b> ({fmtNum(derived.masonry.totalBuyBricks)} bata)
              </span>
              <button
                type="button"
                onClick={lockBaseline}
                className="min-h-7 rounded-lg bg-primary/20 px-2.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/30"
              >
                Kunci Baseline
              </button>
            </div>
          )}

          {hoverInfo && (
            <div
              className="studio-glass pointer-events-none absolute z-10 rounded-lg border-primary/45 px-2.5 py-1 text-[10.5px] font-medium text-foreground shadow-lg"
              style={hoverInfo.x > 460 ? { right: 16, top: hoverInfo.y - 12 } : { left: hoverInfo.x + 14, top: hoverInfo.y - 12 }}
            >
              {hoverInfo.label} <span className="text-muted-foreground">· klik detail</span>
            </div>
          )}

          {webglStatus !== "ok" && (
            <div role="alert" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-background/95 p-6 text-center">
              <ShieldAlert className="h-8 w-8 text-amber-400" />
              <div className="text-sm font-bold text-foreground">
                {webglStatus === "unsupported" ? "WebGL Tidak Tersedia di Browser Ini" : "Konteks GPU WebGL Terputus"}
              </div>
              <p className="max-w-md text-xs text-muted-foreground">
                {webglStatus === "unsupported"
                  ? "Gunakan workspace Denah 2D, Struktur SNI, dan RAB yang tetap berjalan normal."
                  : "Driver GPU mereset konteks rendering. Klik Muat Ulang Scene."}
              </p>
              {webglStatus === "lost" && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-1 min-h-9 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground"
                >
                  Muat Ulang Scene
                </button>
              )}
            </div>
          )}

          {/* Legend Bottom Left */}
          <div className="studio-glass pointer-events-none absolute bottom-2.5 left-2.5 hidden flex-wrap items-center gap-2 rounded-xl px-2.5 py-1 text-[10px] text-muted-foreground [@media(min-width:768px)_and_(min-height:520px)]:flex">
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#efede6]" /> Plester</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#8f9295]" /> Beton SNI</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#363b40]" /> Atap</span>
            {view.showAir && <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#3ea2f4]" /> Air</span>}
            {view.showListrik && <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#f5c442]" /> Listrik</span>}
            {view.showFloodWater && flood.streetFloodCm > 0 && (
              <span className="inline-flex items-center gap-1 text-cyan-300"><i className="h-2 w-2 rounded-full bg-[#5c7c7a]" /> Banjir {flood.streetFloodCm}cm</span>
            )}
            {sceneStats && (
              <span className="pointer-events-auto ml-1 flex items-center gap-1.5 border-l border-white/10 pl-2 font-mono text-[9.5px] tabular-nums">
                <span>{sceneStats.fps} FPS</span>
                <select
                  aria-label="Kualitas Grafis 3D"
                  value={qualityOverride}
                  onChange={(e) => {
                    const next = e.target.value as QualityTier | "auto";
                    setQualityOverride(next);
                    sceneRef.current?.setQualityOverride(next);
                  }}
                  className="rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[9.5px] uppercase text-primary outline-none"
                >
                  <option value="auto">Auto ({sceneStats.tier})</option>
                  <option value="high">High</option>
                  <option value="medium">Med</option>
                  <option value="low">Low</option>
                </select>
              </span>
            )}
          </div>

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
        "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition active:scale-[0.98]",
        active ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm" : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-white/10" />;
}
