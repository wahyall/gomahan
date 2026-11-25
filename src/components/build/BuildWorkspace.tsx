"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Download,
  Eye,
  Footprints,
  Grid3x3,
  HelpCircle,
  Home,
  Layers,
  MousePointer2,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  BuildScene,
  STARTER_BUILD_CATALOG,
  useBuildModeStore,
  type BuildCatalogItem,
  type BuildCategoryId,
  type BuildSceneStats,
  type BuildTimeOfDay,
  type RoofVisibilityMode,
  type WallVisibilityMode,
} from "@/features/buildMode";
import { simsAudio } from "@/lib/audio/simsAudio";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const CATEGORIES: { id: BuildCategoryId; label: string; short: string }[] = [
  { id: "build", label: "Bangunan", short: "Bangun" },
  { id: "walls", label: "Dinding & Cat", short: "Dinding" },
  { id: "floors", label: "Lantai", short: "Lantai" },
  { id: "openings", label: "Pintu & Jendela", short: "Bukaan" },
  { id: "stairs_roof", label: "Tangga & Atap", short: "Tangga" },
  { id: "outdoor", label: "Teras & Taman", short: "Luar" },
  { id: "furniture", label: "Furnitur", short: "Perabot" },
  { id: "lighting", label: "Lampu", short: "Lampu" },
];

const WALL_MODES: { id: WallVisibilityMode; label: string; hint: string }[] = [
  { id: "up", label: "Penuh", hint: "Semua dinding penuh (Home)" },
  { id: "cutaway", label: "Cutaway", hint: "Otomatis potong sisi kamera" },
  { id: "down", label: "Rendah", hint: "Dinding rendah seperti denah (End)" },
];

const TIMES_OF_DAY: { id: BuildTimeOfDay; label: string }[] = [
  { id: "morning", label: "Pagi" },
  { id: "noon", label: "Siang" },
  { id: "sunset", label: "Sore" },
  { id: "night", label: "Malam" },
];

function WallModeIcon({ mode }: { mode: WallVisibilityMode }) {
  return (
    <svg viewBox="0 0 20 16" className="h-3.5 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      {mode === "up" && (
        <>
          <path d="M2 5L10 2L18 5V13L10 15L2 13V5Z" />
          <path d="M10 2V15" opacity="0.65" />
        </>
      )}
      {mode === "cutaway" && (
        <>
          <path d="M2 5L10 2L18 5V13L10 15" />
          <path d="M2 5V13L10 15" strokeDasharray="2 2" opacity="0.55" />
          <path d="M2 10.5L10 12.5V15L2 13V10.5Z" fill="currentColor" fillOpacity="0.28" />
        </>
      )}
      {mode === "down" && (
        <path d="M2 10.5L10 8.5L18 10.5V13.2L10 15L2 13.2V10.5Z" fill="currentColor" fillOpacity="0.3" />
      )}
    </svg>
  );
}

function ItemThumbnail({ item }: { item: BuildCatalogItem }) {
  const swatchHex = item.swatches[0]?.hex ?? "#9aa5b1";
  return (
    <div
      className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded border border-white/10"
      style={{
        background: `linear-gradient(145deg, ${swatchHex}33 0%, #1c2028 72%)`,
      }}
    >
      {item.kind === "wall_material" && (
        <div className="h-7 w-7 rounded-sm border border-white/25 shadow-inner" style={{ backgroundColor: swatchHex }} />
      )}
      {item.kind === "floor_material" && (
        <div
          className="grid h-7 w-7 grid-cols-2 grid-rows-2 gap-0.5 rounded-sm p-0.5"
          style={{ backgroundColor: "#252930" }}
        >
          <span className="rounded-[1px]" style={{ backgroundColor: swatchHex }} />
          <span className="rounded-[1px] opacity-85" style={{ backgroundColor: swatchHex }} />
          <span className="rounded-[1px] opacity-85" style={{ backgroundColor: swatchHex }} />
          <span className="rounded-[1px]" style={{ backgroundColor: swatchHex }} />
        </div>
      )}
      {item.kind === "opening" && (
        <div className="flex h-8 w-6 items-center justify-center rounded-t-sm border-2 border-[#c8bfb0] bg-[#78a8c9]/35">
          <div className="h-1.5 w-1.5 rounded-full bg-amber-300" />
        </div>
      )}
      {item.kind === "stair" && (
        <svg viewBox="0 0 28 24" className="h-7 w-7 text-amber-200" fill="currentColor">
          <path d="M3 20h5v-4h5v-4h5V8h7v12H3z" opacity="0.88" />
        </svg>
      )}
      {item.kind === "roof_material" && (
        <svg viewBox="0 0 28 24" className="h-7 w-7" fill={swatchHex} stroke="#dce3ec" strokeWidth="1.2">
          <path d="M3 16L25 8v4L3 20z" />
        </svg>
      )}
      {item.kind === "furniture" && (
        <div className="flex flex-col items-center">
          <div className="h-3 w-8 rounded-t-sm border border-white/20" style={{ backgroundColor: swatchHex }} />
          <div className="h-2 w-9 rounded-b-sm bg-[#6e4e35]" />
        </div>
      )}
      {item.kind === "light" && (
        <div className="flex flex-col items-center">
          <div className="h-2.5 w-0.5 bg-zinc-400" />
          <div
            className="h-4 w-6 rounded-t-full border border-white/25 shadow-[0_3px_10px_rgba(255,210,120,0.65)]"
            style={{ backgroundColor: swatchHex }}
          />
        </div>
      )}
    </div>
  );
}

export function BuildWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<BuildScene | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const document = useBuildModeStore((s) => s.document);
  const costSummary = useBuildModeStore((s) => s.costSummary);
  const undoCount = useBuildModeStore((s) => s.undoStack.length);
  const redoCount = useBuildModeStore((s) => s.redoStack.length);
  const activeLevel = useBuildModeStore((s) => s.activeLevel);
  const wallVisibility = useBuildModeStore((s) => s.wallVisibility);
  const roofVisibility = useBuildModeStore((s) => s.roofVisibility);
  const timeOfDay = useBuildModeStore((s) => s.timeOfDay);
  const gridVisible = useBuildModeStore((s) => s.gridVisible);
  const snap90Enabled = useBuildModeStore((s) => s.snap90Enabled);
  const edgeScrollEnabled = useBuildModeStore((s) => s.edgeScrollEnabled);
  const neighborsVisible = useBuildModeStore((s) => s.neighborsVisible);
  const activeCategory = useBuildModeStore((s) => s.activeCategory);
  const activeTool = useBuildModeStore((s) => s.activeTool);
  const selectedCatalogId = useBuildModeStore((s) => s.selectedCatalogId);
  const hover = useBuildModeStore((s) => s.hover);
  const selectedEntity = useBuildModeStore((s) => s.selectedEntity);
  const savedCameraSnapshot = useBuildModeStore((s) => s.savedCameraSnapshot);
  const lastNotice = useBuildModeStore((s) => s.lastNotice);

  const hydrateAutosave = useBuildModeStore((s) => s.hydrateAutosave);
  const undo = useBuildModeStore((s) => s.undo);
  const redo = useBuildModeStore((s) => s.redo);
  const stepLevel = useBuildModeStore((s) => s.stepLevel);
  const setWallVisibility = useBuildModeStore((s) => s.setWallVisibility);
  const cycleWallVisibility = useBuildModeStore((s) => s.cycleWallVisibility);
  const setRoofVisibility = useBuildModeStore((s) => s.setRoofVisibility);
  const setTimeOfDay = useBuildModeStore((s) => s.setTimeOfDay);
  const toggleGrid = useBuildModeStore((s) => s.toggleGrid);
  const toggleSnap90 = useBuildModeStore((s) => s.toggleSnap90);
  const toggleEdgeScroll = useBuildModeStore((s) => s.toggleEdgeScroll);
  const toggleNeighbors = useBuildModeStore((s) => s.toggleNeighbors);
  const setCategory = useBuildModeStore((s) => s.setCategory);
  const selectCatalogItem = useBuildModeStore((s) => s.selectCatalogItem);
  const setHover = useBuildModeStore((s) => s.setHover);
  const setSelectedEntity = useBuildModeStore((s) => s.setSelectedEntity);
  const saveCameraSnapshot = useBuildModeStore((s) => s.saveCameraSnapshot);
  const resetToEmptyLot = useBuildModeStore((s) => s.resetToEmptyLot);
  const resetToStarterHouse = useBuildModeStore((s) => s.resetToStarterHouse);
  const exportJson = useBuildModeStore((s) => s.exportJson);
  const importJsonRaw = useBuildModeStore((s) => s.importJsonRaw);
  const clearNotice = useBuildModeStore((s) => s.clearNotice);

  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<BuildSceneStats | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);

  // Hydrate v2 autosave cleanly on first mount
  useEffect(() => {
    hydrateAutosave();
  }, [hydrateAutosave]);

  useEffect(() => {
    if (lastNotice) {
      toast.info(lastNotice);
      clearNotice();
    }
  }, [lastNotice, clearNotice]);

  // Mount Three.js BuildScene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const testGl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!testGl) {
        queueMicrotask(() =>
          setWebglError("Browser/GPU tidak mendukung WebGL sehingga tampilan 3D tidak dapat dimuat."),
        );
        return;
      }
      const bs = new BuildScene(canvas, {
        onHoverCell: (gx, gz, worldX, worldZ, inBounds) => {
          setHover({ gx, gz, worldX, worldZ, inBounds });
        },
        onSelectObject: (hit) => {
          setSelectedEntity(hit);
          if (hit) simsAudio.play("select");
        },
        onStats: (snap) => setStats(snap),
      });
      if (savedCameraSnapshot) {
        bs.cameraCtrl.applySnapshot(savedCameraSnapshot);
      }
      sceneRef.current = bs;
      return () => {
        saveCameraSnapshot(bs.cameraCtrl.getSnapshot());
        bs.dispose();
        sceneRef.current = null;
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal menginisialisasi renderer 3D.";
      queueMicrotask(() => setWebglError(msg));
      return undefined;
    }
    // Mount lifecycle intentionally initialized once per canvas instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push document data changes into BuildScene renderer
  useEffect(() => {
    sceneRef.current?.setDocument(document);
  }, [document]);

  // Push view/visibility changes into BuildScene renderer
  useEffect(() => {
    sceneRef.current?.setViewOptions({
      activeLevel,
      wallVisibility,
      roofVisibility,
      timeOfDay,
      gridVisible,
      neighborsVisible,
      snap90Enabled,
      edgeScrollEnabled,
    });
  }, [
    activeLevel,
    wallVisibility,
    roofVisibility,
    timeOfDay,
    gridVisible,
    neighborsVisible,
    snap90Enabled,
    edgeScrollEnabled,
  ]);

  const handleEnterWalkMode = useCallback(() => {
    if (sceneRef.current) {
      saveCameraSnapshot(sceneRef.current.cameraCtrl.getSnapshot());
    }
    simsAudio.play("select");
    setWorkspace("walk");
  }, [saveCameraSnapshot, setWorkspace]);

  // Build Mode keyboard shortcuts (Ctrl+Z, Ctrl+Y, PageUp/Down, Home/End, G, Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        if (undo()) simsAudio.play("select");
        return;
      }
      if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        if (redo()) simsAudio.play("select");
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toast.success("Progres Build Mode v2 tersimpan otomatis.");
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        stepLevel(1);
        simsAudio.play("select");
      } else if (e.key === "PageDown") {
        e.preventDefault();
        stepLevel(-1);
        simsAudio.play("select");
      } else if (e.key === "Home") {
        e.preventDefault();
        cycleWallVisibility();
        simsAudio.play("select");
      } else if (e.key === "End") {
        e.preventDefault();
        setWallVisibility(wallVisibility === "down" ? "cutaway" : "down");
        simsAudio.play("select");
      } else if (e.key.toLowerCase() === "g" && !mod) {
        toggleGrid();
      } else if (e.key === "Escape") {
        if (resetModalOpen) {
          setResetModalOpen(false);
        } else {
          setSelectedEntity(null);
          selectCatalogItem(STARTER_BUILD_CATALOG[0]!);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    undo,
    redo,
    stepLevel,
    cycleWallVisibility,
    setWallVisibility,
    wallVisibility,
    toggleGrid,
    resetModalOpen,
    setSelectedEntity,
    selectCatalogItem,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STARTER_BUILD_CATALOG.filter((item) => {
      if (q) {
        return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
      }
      return item.category === activeCategory;
    });
  }, [activeCategory, query]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      const res = importJsonRaw(raw);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } catch {
      toast.error("Gagal membaca file JSON.");
    }
  };

  const activeLevelObj = document.levels.find((l) => l.index === activeLevel) ?? document.levels[0];
  const selectedItemObj = STARTER_BUILD_CATALOG.find((c) => c.id === selectedCatalogId) ?? STARTER_BUILD_CATALOG[0]!;

  return (
    <div className="relative flex h-full w-full flex-1 flex-col overflow-hidden bg-[#161b22] select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Full-bleed 3D Viewport */}
      <canvas ref={canvasRef} className="viewport-canvas h-full w-full flex-1 cursor-crosshair" />

      {webglError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#14181f]/95 p-6 text-center">
          <div className="max-w-md rounded-xl border border-rose-500/40 bg-[#1c222d] p-5">
            <h2 className="text-base font-bold text-rose-300">WebGL Tidak Tersedia</h2>
            <p className="mt-2 text-xs text-muted-foreground">{webglError}</p>
          </div>
        </div>
      )}

      {/* TOP-CENTER: Sims-style Action Cluster (Undo/Redo, Save/Export/Reset, Grid/Snap) */}
      <div className="pointer-events-none absolute inset-x-0 top-2.5 z-20 flex justify-center px-2">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-white/15 bg-[#1a1f27]/90 px-2 py-1 shadow-xl backdrop-blur-md">
          <button
            type="button"
            disabled={undoCount === 0}
            onClick={() => {
              if (undo()) simsAudio.play("select");
            }}
            title="Undo (Ctrl+Z)"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-35"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Undo</span>
            {undoCount > 0 && <span className="text-[10px] text-amber-300 tabular-nums">{undoCount}</span>}
          </button>
          <button
            type="button"
            disabled={redoCount === 0}
            onClick={() => {
              if (redo()) simsAudio.play("select");
            }}
            title="Redo (Ctrl+Y)"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-35"
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Redo</span>
          </button>

          <span className="mx-0.5 h-4 w-px bg-white/15" />

          <button
            type="button"
            onClick={toggleGrid}
            title="Tampilkan / Sembunyikan Grid 0.5m (G)"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              gridVisible ? "bg-emerald-500/20 text-emerald-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Grid3x3 className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Grid</span>
          </button>

          <button
            type="button"
            onClick={toggleSnap90}
            title="Mode Putar Q/E Snap 90°"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              snap90Enabled ? "bg-amber-500/20 text-amber-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Compass className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Snap 90°</span>
          </button>

          <button
            type="button"
            onClick={toggleNeighbors}
            title="Tampilkan batas bayangan rumah tetangga kiri/kanan"
            className={cn(
              "hidden h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition sm:flex",
              neighborsVisible ? "bg-sky-500/20 text-sky-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Tetangga</span>
          </button>

          <button
            type="button"
            onClick={toggleEdgeScroll}
            title="Aktifkan geser kamera saat kursor menyentuh tepi layar"
            className={cn(
              "hidden h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition lg:flex",
              edgeScrollEnabled ? "bg-sky-500/20 text-sky-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            <span>Tepi</span>
          </button>

          <span className="mx-0.5 hidden h-4 w-px bg-white/15 sm:block" />

          {/* Time of day quick cycle */}
          <div className="hidden items-center gap-0.5 rounded-lg bg-black/25 p-0.5 md:flex" title="Waktu Pencahayaan">
            <Sun className="mx-1 h-3 w-3 text-amber-300" />
            {TIMES_OF_DAY.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTimeOfDay(t.id)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium transition",
                  timeOfDay === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <span className="mx-0.5 h-4 w-px bg-white/15" />

          <button
            type="button"
            onClick={() => {
              exportJson();
              toast.success("File denah Build v2 berhasil diekspor.");
            }}
            title="Export JSON v2"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Ekspor</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Import JSON v2"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-white/10"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Impor</span>
          </button>
          <button
            type="button"
            onClick={() => setResetModalOpen(true)}
            title="Reset atau Kosongkan Kavling"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-rose-300 hover:bg-rose-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Reset</span>
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            title="Bantuan Kamera & Pintasan"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium transition",
              helpOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* TOP-RIGHT: Sims 4-Style Floor Switcher, Wall Visibility & Camera Quick Turn */}
      <div className="pointer-events-auto absolute right-2.5 top-14 z-20 flex flex-col gap-2 sm:top-2.5">
        <div className="flex flex-col gap-1.5 rounded-xl border border-white/15 bg-[#1a1f27]/90 p-2 shadow-xl backdrop-blur-md">
          {/* Level Up / Down */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Lantai</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={activeLevel >= document.levels.length - 1}
                onClick={() => {
                  stepLevel(1);
                  simsAudio.play("select");
                }}
                title="Naik Lantai (PageUp)"
                className="flex h-6 w-6 items-center justify-center rounded bg-white/10 text-foreground hover:bg-white/20 disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[66px] text-center text-xs font-bold text-amber-300">
                {activeLevelObj?.name ?? `Lantai ${activeLevel + 1}`}
              </span>
              <button
                type="button"
                disabled={activeLevel <= 0}
                onClick={() => {
                  stepLevel(-1);
                  simsAudio.play("select");
                }}
                title="Turun Lantai (PageDown)"
                className="flex h-6 w-6 items-center justify-center rounded bg-white/10 text-foreground hover:bg-white/20 disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Wall Visibility 3 Modes */}
          <div className="flex items-center gap-1 rounded-lg bg-black/30 p-0.5">
            {WALL_MODES.map((wm) => (
              <button
                key={wm.id}
                type="button"
                title={wm.hint}
                onClick={() => {
                  setWallVisibility(wm.id);
                  simsAudio.play("select");
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                  wallVisibility === wm.id
                    ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <WallModeIcon mode={wm.id} />
                <span className="hidden sm:inline">{wm.label}</span>
              </button>
            ))}
          </div>

          {/* Roof mode & Quick 90 deg Camera Buttons */}
          <div className="flex items-center justify-between gap-1 pt-0.5">
            <div className="flex items-center gap-0.5">
              {(["auto", "show", "hide"] as RoofVisibilityMode[]).map((rm) => (
                <button
                  key={rm}
                  type="button"
                  onClick={() => setRoofVisibility(rm)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium transition",
                    roofVisibility === rm ? "bg-sky-500/25 text-sky-300" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Atap: {rm === "auto" ? "Auto" : rm === "show" ? "On" : "Off"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title="Putar Kamera 90° Kiri (Q)"
                onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(-1)}
                className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-foreground hover:bg-white/15"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Putar Kamera 90° Kanan (E)"
                onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(1)}
                className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-foreground hover:bg-white/15"
              >
                <RotateCw className="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Reset Posisi Kamera"
                onClick={() => sceneRef.current?.cameraCtrl.resetOverview()}
                className="flex h-6 items-center justify-center rounded bg-white/5 px-1.5 text-[10px] font-medium text-foreground hover:bg-white/15"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Selected entity or tile inspector chip */}
        {(selectedEntity || (hover && hover.inBounds)) && (
          <div className="rounded-xl border border-white/15 bg-[#1a1f27]/90 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
            {selectedEntity ? (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-300">{selectedEntity.label}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedEntity(null)}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Tutup
                  </button>
                </div>
                <div className="text-[11px] text-muted-foreground">{selectedEntity.detail}</div>
              </div>
            ) : (
              hover && (
                <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-emerald-300 tabular-nums">
                  <span>
                    Grid ({hover.gx}, {hover.gz})
                  </span>
                  <span className="text-muted-foreground">
                    {(hover.gx * 0.5).toFixed(1)}m × {(hover.gz * 0.5).toFixed(1)}m
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* HELP POPOVER */}
      {helpOpen && (
        <div className="pointer-events-auto absolute left-3 top-14 z-30 w-72 rounded-xl border border-white/15 bg-[#181d25]/95 p-3.5 text-xs shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="font-bold text-foreground">Kontrol Kamera & Build Mode</span>
            <button type="button" onClick={() => setHelpOpen(false)} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
            <li><strong className="text-foreground">Klik Kanan + Seret</strong>: Putar sudut kamera</li>
            <li><strong className="text-foreground">Q / E</strong>: Putar kiri / kanan (aktifkan Snap 90° untuk putar 90°)</li>
            <li><strong className="text-foreground">WASD / Panah / Klik Tengah</strong>: Geser kamera</li>
            <li><strong className="text-foreground">Scroll Mouse</strong>: Zoom mengarah ke posisi kursor</li>
            <li><strong className="text-foreground">PageUp / PageDown</strong>: Naik / turun lantai</li>
            <li><strong className="text-foreground">Home / End</strong>: Ubah mode visibilitas dinding</li>
            <li><strong className="text-foreground">Ctrl+Z / Ctrl+Y</strong>: Undo / Redo aksi</li>
          </ul>
        </div>
      )}

      {/* BOTTOM SIMS 4 DOCK + FUNDS CARD */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 p-2.5 sm:flex-row sm:items-end sm:justify-between">
        {/* Bottom-Left: Budget, Lot Summary & Walk Mode CTA */}
        <div className="pointer-events-auto flex flex-col gap-1.5 rounded-xl border border-white/15 bg-[#1a1f27]/92 p-2.5 shadow-2xl backdrop-blur-md sm:w-[270px]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                Sisa Dana Kavling 5×17
              </div>
              <div
                className={cn(
                  "text-base font-extrabold tracking-tight tabular-nums",
                  costSummary.overBudget ? "text-rose-400" : "text-emerald-400",
                )}
              >
                {fmtRp(costSummary.remainingIdr)}
              </div>
            </div>
            <div className="text-right text-[10px] text-muted-foreground tabular-nums">
              <div>Biaya: {fmtRp(costSummary.totalIdr)}</div>
              <div>
                {costSummary.builtFloorAreaM2} m² · {costSummary.wallLengthM} m dinding
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleEnterWalkMode}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow hover:brightness-110"
            >
              <Footprints className="h-3.5 w-3.5" />
              <span>Jalan di Rumah (Shift+V)</span>
            </button>
            {stats && (
              <span className="rounded bg-black/40 px-1.5 py-1 font-mono text-[10px] text-emerald-300 tabular-nums">
                {stats.fps} FPS · {stats.calls} draws
              </span>
            )}
          </div>
        </div>

        {/* Bottom-Right / Center: Sims 4-Inspired Catalog Bar */}
        <div className="pointer-events-auto flex min-w-0 flex-1 flex-col rounded-xl border border-white/15 bg-[#1a1f27]/92 shadow-2xl backdrop-blur-md">
          {/* Category Tabs + Search + Collapse */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-white/10 px-2.5 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategory(cat.id);
                    simsAudio.play("select");
                  }}
                  className={cn(
                    "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                    activeCategory === cat.id
                      ? "bg-emerald-500 text-slate-950 shadow-sm"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground",
                  )}
                >
                  <span className="hidden md:inline">{cat.label}</span>
                  <span className="md:hidden">{cat.short}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari katalog..."
                  className="h-6 w-32 rounded-md border border-white/15 bg-black/30 pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setCatalogCollapsed((c) => !c)}
                title={catalogCollapsed ? "Buka Katalog" : "Ringkas Katalog"}
                className="flex h-6 items-center gap-1 rounded bg-white/10 px-2 text-[10px] font-medium text-foreground hover:bg-white/20"
              >
                {catalogCollapsed ? <Eye className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
          </div>

          {/* Thumbnail Cards Row */}
          {!catalogCollapsed && (
            <div className="flex items-center gap-2 overflow-x-auto px-2.5 py-2">
              {filteredItems.map((item) => {
                const active = selectedCatalogId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      selectCatalogItem(item);
                      simsAudio.play("select");
                    }}
                    title={item.description}
                    className={cn(
                      "group flex w-28 shrink-0 flex-col gap-1 rounded-lg border p-1.5 text-left transition",
                      active
                        ? "border-emerald-400 bg-emerald-500/15 shadow-md"
                        : "border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/5",
                    )}
                  >
                    <ItemThumbnail item={item} />
                    <div className="truncate text-[11px] font-semibold text-foreground">{item.name}</div>
                    <div className="flex items-center justify-between text-[10px] tabular-nums">
                      <span className={item.priceIdr === 0 ? "text-sky-300" : "text-amber-300"}>
                        {item.priceIdr === 0 ? "Alat" : fmtRp(item.priceIdr)}
                      </span>
                      {active && <Sparkles className="h-2.5 w-2.5 text-emerald-300" />}
                    </div>
                  </button>
                );
              })}

              {/* Status note describing active Fase 1 tool */}
              <div className="ml-auto hidden max-w-[220px] shrink-0 flex-col justify-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] xl:flex">
                <div className="font-semibold text-emerald-300">Alat Aktif: {selectedItemObj.name}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  {activeTool === "select"
                    ? "Klik elemen rumah di viewport 3D untuk inspeksi detail & ukuran."
                    : "Preview fondasi aktif — tool gambar interaktif penuh diaktifkan di Fase 2 & 3."}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RESET / PRESET CONFIRMATION MODAL */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#1b2029] p-5 shadow-2xl">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Home className="h-4 w-4 text-primary" /> Atur Ulang Kavling 5×17 m
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Pilih apakah ingin mengosongkan seluruh kavling menjadi tanah bersih atau memuat ulang denah Rumah 2 Lantai 5×17 m standar Surabaya. Aksi reset ini menghapus riwayat undo aktif.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  resetToEmptyLot();
                  setResetModalOpen(false);
                  simsAudio.play("demolish");
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
              >
                <Trash2 className="h-3.5 w-3.5" /> Kosongkan Kavling (Tanah 5×17 Bersih)
              </button>
              <button
                type="button"
                onClick={() => {
                  resetToStarterHouse();
                  setResetModalOpen(false);
                  simsAudio.play("place");
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                <Save className="h-3.5 w-3.5" /> Muat Denah Default Rumah 5×17 m (3 KT)
              </button>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="mt-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/15"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
