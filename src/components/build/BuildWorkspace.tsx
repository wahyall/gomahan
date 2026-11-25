"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrickWall,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Download,
  Eye,
  Footprints,
  Grid3x3,
  Hammer,
  HelpCircle,
  Home,
  Layers,
  MousePointer2,
  Pipette,
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
  Wind,
} from "lucide-react";
import { toast } from "sonner";
import {
  BuildScene,
  UNIFIED_BUILD_CATALOG,
  useBuildModeStore,
  type BuildCatalogEntry,
  type BuildCategoryId,
  type BuildSceneStats,
  type RoofVisibilityMode,
  type WallVisibilityMode,
} from "@/features/buildMode";
import { simsAudio } from "@/lib/audio/simsAudio";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { PAINT_SWATCHES, ROOF_SWATCHES } from "@/lib/model/catalog";
import type { RoofType } from "@/lib/model/types";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { cn } from "@/lib/utils";

interface BuildWorkspaceProps {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  lighting?: LightingSimulationResult;
  airflow?: AirflowSimulationResult;
  onExportJson: () => void;
  onImportJson: () => void;
  onSaveSnapshot: () => void;
}

const CATEGORIES: { id: BuildCategoryId; label: string; short: string }[] = [
  { id: "build", label: "Bangunan", short: "Bangun" },
  { id: "walls", label: "Dinding & Cat", short: "Dinding" },
  { id: "floors", label: "Lantai", short: "Lantai" },
  { id: "openings", label: "Pintu & Jendela", short: "Bukaan" },
  { id: "stairs_roof", label: "Tangga & Atap", short: "Atap" },
  { id: "outdoor", label: "Teras & Kolam", short: "Luar" },
  { id: "furniture", label: "Furnitur", short: "Perabot" },
  { id: "hvac", label: "AC & Kipas", short: "AC/Kipas" },
  { id: "lighting", label: "Lampu", short: "Lampu" },
];

const WALL_MODES: { id: WallVisibilityMode; label: string; hint: string }[] = [
  { id: "up", label: "Penuh", hint: "Semua dinding penuh (Home)" },
  { id: "cutaway", label: "Cutaway", hint: "Otomatis potong sisi kamera" },
  { id: "down", label: "Rendah", hint: "Dinding rendah seperti denah (End)" },
];

const TIMES_OF_DAY: { id: string; hour: number; label: string }[] = [
  { id: "morning", hour: 7.5, label: "Pagi" },
  { id: "noon", hour: 12.0, label: "Siang" },
  { id: "sunset", hour: 17.2, label: "Sore" },
  { id: "night", hour: 21.0, label: "Malam" },
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

function ItemThumbnail({ item }: { item: BuildCatalogEntry }) {
  const hex = item.swatchHex;
  return (
    <div
      className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded border border-white/10"
      style={{ background: `linear-gradient(145deg, ${hex}36 0%, #1c2028 74%)` }}
    >
      {(item.kind === "wall_material" || item.kind === "tool") && (
        <div className="h-7 w-7 rounded-sm border border-white/25 shadow-inner" style={{ backgroundColor: hex }} />
      )}
      {item.kind === "floor_material" && (
        <div className="grid h-7 w-7 grid-cols-2 grid-rows-2 gap-0.5 rounded-sm bg-[#252930] p-0.5">
          <span className="rounded-[1px]" style={{ backgroundColor: hex }} />
          <span className="rounded-[1px] opacity-85" style={{ backgroundColor: hex }} />
          <span className="rounded-[1px] opacity-85" style={{ backgroundColor: hex }} />
          <span className="rounded-[1px]" style={{ backgroundColor: hex }} />
        </div>
      )}
      {item.kind === "opening" && (
        <div className="flex h-8 w-6 items-center justify-center rounded-t-sm border-2 border-[#c8bfb0] bg-[#78a8c9]/35">
          <div className="h-1.5 w-1.5 rounded-full bg-amber-300" />
        </div>
      )}
      {item.kind === "stair" && (
        <svg viewBox="0 0 28 24" className="h-7 w-7 text-amber-200" fill="currentColor">
          <path d="M3 20h5v-4h5v-4h5V8h7v12H3z" opacity="0.9" />
        </svg>
      )}
      {item.kind === "roof" && (
        <svg viewBox="0 0 28 24" className="h-7 w-7" fill={hex} stroke="#dce3ec" strokeWidth="1.2">
          <path d="M3 16L25 8v4L3 20z" />
        </svg>
      )}
      {item.kind === "outdoor" && (
        <div className="h-7 w-9 rounded border border-white/25" style={{ backgroundColor: hex }} />
      )}
      {item.kind === "furniture" && (
        <div className="flex flex-col items-center">
          <div className="h-3.5 w-8 rounded-t-sm border border-white/25" style={{ backgroundColor: hex }} />
          <div className="h-1.5 w-9 rounded-b-sm bg-[#6e4e35]" />
        </div>
      )}
      {item.kind === "hvac" && (
        <div className="flex h-5 w-9 items-center justify-center rounded border border-white/25 text-[8px] font-bold text-slate-900" style={{ backgroundColor: hex }}>
          {item.hvacMeta?.type === "ac_split" ? "AC" : "FAN"}
        </div>
      )}
      {item.kind === "light" && (
        <div className="flex flex-col items-center">
          <div className="h-2.5 w-0.5 bg-zinc-400" />
          <div
            className="h-4 w-6 rounded-t-full border border-white/25 shadow-[0_3px_10px_rgba(255,210,120,0.65)]"
            style={{ backgroundColor: hex }}
          />
        </div>
      )}
    </div>
  );
}

export function BuildWorkspace({ derived, struct, lighting, airflow, onExportJson, onImportJson, onSaveSnapshot }: BuildWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<BuildScene | null>(null);

  const project = derived.project;
  const selected = useStudioStore((s) => s.selected);
  const setSelected = useStudioStore((s) => s.setSelected);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const view = useStudioStore((s) => s.view);
  const patchView = useStudioStore((s) => s.patchView);

  const activeLevel = useBuildModeStore((s) => s.activeLevel);
  const wallVisibility = useBuildModeStore((s) => s.wallVisibility);
  const roofVisibility = useBuildModeStore((s) => s.roofVisibility);
  const gridVisible = useBuildModeStore((s) => s.gridVisible);
  const snap90Enabled = useBuildModeStore((s) => s.snap90Enabled);
  const edgeScrollEnabled = useBuildModeStore((s) => s.edgeScrollEnabled);
  const neighborsVisible = useBuildModeStore((s) => s.neighborsVisible);
  const showBricksOverlay = useBuildModeStore((s) => s.showBricksOverlay);
  const activeCategory = useBuildModeStore((s) => s.activeCategory);
  const activeTool = useBuildModeStore((s) => s.activeTool);
  const selectedCatalogId = useBuildModeStore((s) => s.selectedCatalogId);
  const floorBrushMode = useBuildModeStore((s) => s.floorBrushMode);
  const terrainBrushMode = useBuildModeStore((s) => s.terrainBrushMode);
  const placementRotationQuarter = useBuildModeStore((s) => s.placementRotationQuarter);
  const hover = useBuildModeStore((s) => s.hover);
  const previewHud = useBuildModeStore((s) => s.previewHud);
  const savedCameraSnapshot = useBuildModeStore((s) => s.savedCameraSnapshot);

  const stepLevel = useBuildModeStore((s) => s.stepLevel);
  const setWallVisibility = useBuildModeStore((s) => s.setWallVisibility);
  const cycleWallVisibility = useBuildModeStore((s) => s.cycleWallVisibility);
  const setRoofVisibility = useBuildModeStore((s) => s.setRoofVisibility);
  const toggleGrid = useBuildModeStore((s) => s.toggleGrid);
  const toggleSnap90 = useBuildModeStore((s) => s.toggleSnap90);
  const toggleEdgeScroll = useBuildModeStore((s) => s.toggleEdgeScroll);
  const toggleNeighbors = useBuildModeStore((s) => s.toggleNeighbors);
  const toggleBricksOverlay = useBuildModeStore((s) => s.toggleBricksOverlay);
  const setCategory = useBuildModeStore((s) => s.setCategory);
  const selectCatalogItem = useBuildModeStore((s) => s.selectCatalogItem);
  const selectCatalogById = useBuildModeStore((s) => s.selectCatalogById);
  const setFloorBrushMode = useBuildModeStore((s) => s.setFloorBrushMode);
  const setTerrainBrushMode = useBuildModeStore((s) => s.setTerrainBrushMode);
  const rotatePlacementQuarter = useBuildModeStore((s) => s.rotatePlacementQuarter);
  const setHover = useBuildModeStore((s) => s.setHover);
  const setPreviewHud = useBuildModeStore((s) => s.setPreviewHud);
  const saveCameraSnapshot = useBuildModeStore((s) => s.saveCameraSnapshot);

  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<BuildSceneStats | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("rumah_studio_onboarding_seen_v2") !== "1") {
        queueMicrotask(() => setHelpOpen(true));
      }
    } catch {
      // ignore private storage restrictions
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setHelpOpen(false);
    try {
      window.localStorage.setItem("rumah_studio_onboarding_seen_v2", "1");
    } catch {
      // ignore private storage restrictions
    }
  }, []);

  const pastCount = useStudioStore.temporal.getState().pastStates.length;
  const futureCount = useStudioStore.temporal.getState().futureStates.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const testGl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!testGl) {
        queueMicrotask(() => setWebglError("Browser/GPU tidak mendukung WebGL sehingga tampilan 3D tidak dapat dimuat."));
        return;
      }
      const st = useStudioStore.getState();
      const bs = new BuildScene(canvas, {
        onSelect: (sel) => setSelected(sel),
        onHoverCell: (gx, gz, worldX, worldZ, inBounds) => setHover({ gx, gz, worldX, worldZ, inBounds }),
        onPreviewHud: (hud) => setPreviewHud(hud),
        onEyedropCatalog: (cid) => {
          selectCatalogById(cid);
          toast.info("Item disalin dari viewport.");
        },
        onStats: (snap) => setStats(snap),
        onAddWall: (lv, w) => st.addWall(lv, w),
        onAddRoomAndWalls: (lv, ws, r) => st.addRoomAndWalls(lv, ws, r),
        onUpdateWall: (lv, id, p) => st.updateWall(lv, id, p),
        onDeleteWall: (lv, id) => st.deleteWall(lv, id),
        onAddOpening: (lv, wid, op) => st.addOpening(lv, wid, op),
        onDeleteOpening: (lv, wid, oid) => st.deleteOpening(lv, wid, oid),
        onPaintRoomFloor: (lv, rid, matId) => st.paintRoomFloor(lv, rid, matId),
        onSetFloorTiles: (tiles) => st.setFloorTileOverrides(tiles),
        onAddStair: (lv, s, v) => st.addStairWithCutout(lv, s, v),
        onAddFurniture: (lv, f) => st.addFurniture(lv, f),
        onMoveFurniture: (lv, id, pos, rotationY) =>
          st.updateFurniture(lv, id, rotationY !== undefined ? { position: pos, rotationY } : { position: pos }),
        onDeleteFurniture: (lv, id) => st.deleteFurniture(lv, id),
        onAddHvac: (lv, h) => st.addHvac(lv, h),
        onMoveHvac: (lv, id, pos, rotationY) =>
          st.updateHvac(lv, id, rotationY !== undefined ? { position: pos, rotationY } : { position: pos }),
        onDeleteHvac: (lv, id) => st.deleteHvac(lv, id),
        onAddLight: (lv, l) => st.addLight(lv, l),
        onMoveLight: (lv, id, pos, rotationY) =>
          st.updateLight(lv, id, rotationY !== undefined ? { position: pos, rotationY } : { position: pos }),
        onDeleteLight: (lv, id) => st.deleteLight(lv, id),
        onAddPool: (p) => st.addPool(p),
        onSetTerrainHeights: (h) => st.setTerrainHeights(h),
      });
      if (savedCameraSnapshot) bs.cameraCtrl.applySnapshot(savedCameraSnapshot);
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
    // Mount once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.updateProjectData(derived, struct, selected, view, lighting, airflow);
  }, [derived, struct, selected, view, lighting, airflow]);

  useEffect(() => {
    sceneRef.current?.setViewOptions({
      activeLevel,
      wallVisibility,
      roofVisibility,
      gridVisible,
      snap90Enabled,
      edgeScrollEnabled,
      neighborsVisible,
      showBricksOverlay,
      activeTool,
      selectedCatalogId,
      floorBrushMode,
      terrainBrushMode,
      placementRotationQuarter,
    });
  }, [
    activeLevel,
    wallVisibility,
    roofVisibility,
    gridVisible,
    snap90Enabled,
    edgeScrollEnabled,
    neighborsVisible,
    showBricksOverlay,
    activeTool,
    selectedCatalogId,
    floorBrushMode,
    terrainBrushMode,
    placementRotationQuarter,
  ]);

  const selectedDetails = useMemo(() => {
    if (!selected || selected.kind === "part") return null;
    const lv = project.levels[selected.levelIndex];
    if (!lv) return null;
    if (selected.kind === "wall") {
      const w = lv.walls.find((x) => x.id === selected.id);
      if (!w) return null;
      const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      return { title: w.name, sub: `Panjang ${len.toFixed(2)} m · Tebal ${(w.thickness * 100).toFixed(0)} cm · LT${lv.index + 1}` };
    }
    if (selected.kind === "opening") {
      const w = lv.walls.find((x) => x.id === selected.wallId);
      const o = w?.openings.find((x) => x.id === selected.id);
      if (!o) return null;
      return { title: o.label, sub: `${o.width.toFixed(2)}×${o.height.toFixed(2)} m · Sill ${o.sill.toFixed(2)} m` };
    }
    if (selected.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === selected.id);
      if (!f) return null;
      return { title: f.name, sub: `${f.size.x.toFixed(1)}×${f.size.z.toFixed(1)} m · Seret untuk pindah` };
    }
    if (selected.kind === "hvac") {
      const h = lv.hvac.find((x) => x.id === selected.id);
      if (!h) return null;
      return { title: h.name, sub: `${h.flowRateM3h} m³/j · ${h.on ? "ON" : "OFF"}` };
    }
    if (selected.kind === "light") {
      const l = lv.lights.find((x) => x.id === selected.id);
      if (!l) return null;
      return { title: l.name, sub: `${l.lumens} lm · ${l.colorTempK}K · ${l.on ? "ON" : "OFF"}` };
    }
    return null;
  }, [project.levels, selected]);

  const handleDeleteSelected = useCallback(() => {
    if (!selected || selected.kind === "part") return;
    const st = useStudioStore.getState();
    const lv = selected.levelIndex as 0 | 1;
    if (selected.kind === "wall") st.deleteWall(lv, selected.id);
    else if (selected.kind === "opening") st.deleteOpening(lv, selected.wallId, selected.id);
    else if (selected.kind === "furniture") st.deleteFurniture(lv, selected.id);
    else if (selected.kind === "hvac") st.deleteHvac(lv, selected.id);
    else if (selected.kind === "light") st.deleteLight(lv, selected.id);
  }, [selected]);

  const handleRotateSelected = useCallback(
    (deltaRad = Math.PI / 2) => {
      if (!selected || selected.kind === "part") {
        rotatePlacementQuarter(deltaRad > 0 ? 1 : -1);
        simsAudio.play("rotate");
        return;
      }
      const st = useStudioStore.getState();
      const lvIdx = selected.levelIndex as 0 | 1;
      const lv = st.project.levels[lvIdx];
      if (!lv) return;
      if (selected.kind === "furniture") {
        const cur = lv.furniture.find((f) => f.id === selected.id);
        if (cur) st.updateFurniture(lvIdx, cur.id, { rotationY: cur.rotationY + deltaRad });
      } else if (selected.kind === "hvac") {
        const cur = lv.hvac.find((h) => h.id === selected.id);
        if (cur) st.updateHvac(lvIdx, cur.id, { rotationY: cur.rotationY + deltaRad });
      }
      simsAudio.play("rotate");
    },
    [rotatePlacementQuarter, selected],
  );

  const handleDuplicateSelected = useCallback(() => {
    if (!selected || selected.kind === "part") return;
    const st = useStudioStore.getState();
    const lvIdx = selected.levelIndex as 0 | 1;
    const lv = st.project.levels[lvIdx];
    if (!lv) return;
    if (selected.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === selected.id);
      if (f) {
        st.addFurniture(lvIdx, {
          ...structuredClone(f),
          id: `furn-cp-${Date.now().toString(36)}`,
          position: { x: Math.min(4.6, f.position.x + 0.6), y: f.position.y, z: f.position.z },
        });
      }
    } else if (selected.kind === "hvac") {
      const h = lv.hvac.find((x) => x.id === selected.id);
      if (h) {
        st.addHvac(lvIdx, {
          ...structuredClone(h),
          id: `hv-cp-${Date.now().toString(36)}`,
          position: { x: Math.min(4.6, h.position.x + 0.6), y: h.position.y, z: h.position.z },
        });
      }
    } else if (selected.kind === "light") {
      const l = lv.lights.find((x) => x.id === selected.id);
      if (l) {
        st.addLight(lvIdx, {
          ...structuredClone(l),
          id: `lgt-cp-${Date.now().toString(36)}`,
          position: { x: Math.min(4.6, l.position.x + 0.6), y: l.position.y, z: l.position.z },
        });
      }
    }
  }, [selected]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const mod = e.ctrlKey || e.metaKey;
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
      } else if (e.key.toLowerCase() === "v" && !mod && !e.shiftKey) {
        selectCatalogById("tool_select");
        simsAudio.play("select");
      } else if (e.key.toLowerCase() === "g" && !mod) {
        toggleGrid();
      } else if (e.key.toLowerCase() === "k" && !mod) {
        selectCatalogById("tool_sledgehammer");
        simsAudio.play("select");
      } else if (e.key.toLowerCase() === "i" && !mod) {
        selectCatalogById("tool_eyedropper");
        simsAudio.play("select");
      } else if ((e.key === "r" || e.key === "." || e.key === ",") && !mod) {
        handleRotateSelected(e.key === "," ? -Math.PI / 2 : Math.PI / 2);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selected && selected.kind !== "part") {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (e.key === "Escape") {
        if (resetModalOpen) setResetModalOpen(false);
        else {
          setSelected(null);
          selectCatalogById("tool_select");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    stepLevel,
    cycleWallVisibility,
    setWallVisibility,
    wallVisibility,
    toggleGrid,
    selectCatalogById,
    handleRotateSelected,
    selected,
    handleDeleteSelected,
    resetModalOpen,
    setSelected,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UNIFIED_BUILD_CATALOG.filter((item) =>
      q ? item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) : item.category === activeCategory,
    );
  }, [activeCategory, query]);

  const activeItem = UNIFIED_BUILD_CATALOG.find((c) => c.id === selectedCatalogId) ?? UNIFIED_BUILD_CATALOG[0]!;
  const levelLabel = activeLevel === 0 ? "Lantai 1" : activeLevel === 1 ? "Lantai 2" : "Atap";

  const handleSelectItemClick = (item: BuildCatalogEntry) => {
    if (item.toolId === "roof" && item.roofType) {
      useStudioStore.getState().patchSystems({ roofType: item.roofType as RoofType });
      selectCatalogItem(item);
      toast.success(`Bentuk atap diubah menjadi ${item.name}.`);
      return;
    }
    selectCatalogItem(item);
    simsAudio.play("select");
  };

  return (
    <div className="relative flex h-full w-full flex-1 flex-col overflow-hidden bg-[#161b22] select-none">
      <canvas
        ref={canvasRef}
        className={cn("viewport-canvas h-full w-full flex-1", activeTool === "select" ? "cursor-pointer" : "cursor-crosshair")}
      />

      {webglError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#14181f]/95 p-6 text-center">
          <div className="max-w-md rounded-xl border border-rose-500/40 bg-[#1c222d] p-5">
            <h2 className="text-base font-bold text-rose-300">WebGL Tidak Tersedia</h2>
            <p className="mt-2 text-xs text-muted-foreground">{webglError}</p>
          </div>
        </div>
      )}

      {/* TOP HUD ROW: Non-overlapping action pill + floor/wall controls */}
      <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex flex-col items-end gap-1.5 px-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="hidden shrink-0 sm:block sm:w-[155px]" />

        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 self-center rounded-xl border border-white/15 bg-[#1a1f27]/92 px-1.5 py-1 shadow-xl backdrop-blur-md">
          <button
            type="button"
            disabled={pastCount === 0}
            onClick={() => useStudioStore.temporal.getState().undo()}
            title="Undo (Ctrl+Z)"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-35"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Undo</span>
            {pastCount > 0 && <span className="text-[10px] text-amber-300 tabular-nums">{pastCount}</span>}
          </button>
          <button
            type="button"
            disabled={futureCount === 0}
            onClick={() => useStudioStore.temporal.getState().redo()}
            title="Redo (Ctrl+Y)"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-35"
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Redo</span>
          </button>

          <span className="mx-0.5 h-4 w-px bg-white/15" />

          <button
            type="button"
            onClick={() => {
              selectCatalogById("tool_select");
              simsAudio.play("select");
            }}
            title="Mode Pilih & Geser Objek 3D (V / Esc)"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              activeTool === "select" ? "bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Pilih</span>
          </button>
          <button
            type="button"
            onClick={() => {
              selectCatalogById("tool_sledgehammer");
              simsAudio.play("select");
            }}
            title="Palu Hapus Elemen (K / Del)"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              activeTool === "sledgehammer" ? "bg-rose-500/25 text-rose-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Hammer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Hapus</span>
          </button>
          <button
            type="button"
            onClick={() => {
              selectCatalogById("tool_eyedropper");
              simsAudio.play("select");
            }}
            title="Pipet Salin Material/Objek (I)"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              activeTool === "eyedropper" ? "bg-sky-500/25 text-sky-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Pipette className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Pipet</span>
          </button>

          <span className="mx-0.5 h-4 w-px bg-white/15" />

          <button
            type="button"
            onClick={toggleGrid}
            title="Grid 0.5m (G)"
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
            onClick={toggleBricksOverlay}
            title="Tampilkan Susunan Batu Bata Hebel/Merah Asli"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              showBricksOverlay ? "bg-amber-500/25 text-amber-200" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <BrickWall className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Bata</span>
          </button>
          <button
            type="button"
            onClick={() => patchView({ showLuxHeatmap: !view.showLuxHeatmap })}
            title="Tampilkan / Sembunyikan Simulasi Heatmap Cahaya (Lux)"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              view.showLuxHeatmap ? "bg-yellow-500/25 text-yellow-200" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Sun className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Lux</span>
          </button>
          <button
            type="button"
            onClick={() => patchView({ showAirParticles: !view.showAirParticles })}
            title="Tampilkan / Sembunyikan Simulasi Partikel Aliran Angin & AC/Kipas"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              view.showAirParticles ? "bg-teal-500/25 text-teal-200" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Wind className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Angin</span>
          </button>
          <button
            type="button"
            onClick={toggleSnap90}
            title="Snap Q/E 90°"
            className={cn(
              "hidden h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition sm:flex",
              snap90Enabled ? "bg-amber-500/20 text-amber-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Compass className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">90°</span>
          </button>
          <button
            type="button"
            onClick={toggleNeighbors}
            title="Tampilkan Rumah Tetangga Kiri/Kanan"
            className={cn(
              "hidden h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition sm:flex",
              neighborsVisible ? "bg-sky-500/20 text-sky-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Tetangga</span>
          </button>
          <button
            type="button"
            onClick={toggleEdgeScroll}
            title="Edge Scroll Kamera"
            className={cn(
              "hidden h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition lg:flex",
              edgeScrollEnabled ? "bg-sky-500/20 text-sky-300" : "text-muted-foreground hover:bg-white/10",
            )}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
          </button>

          <div className="hidden items-center gap-0.5 rounded-lg bg-black/25 p-0.5 md:flex" title="Waktu Pencahayaan">
            <Sun className="mx-1 h-3 w-3 text-amber-300" />
            {TIMES_OF_DAY.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => useStudioStore.getState().patchSimulation({ hourOfDay: t.hour })}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium transition",
                  Math.abs(project.simulation.hourOfDay - t.hour) < 2.2
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <span className="mx-0.5 h-4 w-px bg-white/15" />

          <button type="button" onClick={onSaveSnapshot} title="Simpan Snapshot Lokal" className="hidden h-7 items-center rounded-md px-1.5 text-xs text-foreground hover:bg-white/10 sm:flex">
            <Save className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onExportJson} title="Ekspor JSON Proyek" className="flex h-7 items-center rounded-md px-1.5 text-xs text-foreground hover:bg-white/10">
            <Download className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onImportJson} title="Impor JSON Proyek" className="flex h-7 items-center rounded-md px-1.5 text-xs text-foreground hover:bg-white/10">
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setResetModalOpen(true)} title="Reset / Kosongkan Kavling" className="flex h-7 items-center rounded-md px-1.5 text-xs text-rose-300 hover:bg-rose-500/15">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            title="Pintasan Kamera & Build Mode"
            className={cn("flex h-7 w-7 items-center justify-center rounded-md text-xs", helpOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/10")}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* TOP-RIGHT: Floor Switcher + 3 Wall Modes + Roof + Quick Turn */}
        <div className="pointer-events-auto flex shrink-0 flex-col gap-2">
          <div className="flex flex-col gap-1.5 rounded-xl border border-white/15 bg-[#1a1f27]/92 p-2 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Lantai</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={activeLevel >= 2}
                  onClick={() => {
                    stepLevel(1);
                    simsAudio.play("select");
                  }}
                  title="Naik Lantai (PageUp)"
                  className="flex h-6 w-6 items-center justify-center rounded bg-white/10 text-foreground hover:bg-white/20 disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[66px] text-center text-xs font-bold text-amber-300">{levelLabel}</span>
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
                    wallVisibility === wm.id ? "bg-emerald-500 font-semibold text-slate-950 shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <WallModeIcon mode={wm.id} />
                  <span className="hidden sm:inline">{wm.label}</span>
                </button>
              ))}
            </div>

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
                <button type="button" title="Putar 90° Kiri (Q)" onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(-1)} className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-foreground hover:bg-white/15">
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button type="button" title="Putar 90° Kanan (E)" onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(1)} className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-foreground hover:bg-white/15">
                  <RotateCw className="h-3 w-3" />
                </button>
                <button type="button" title="Reset Kamera" onClick={() => sceneRef.current?.cameraCtrl.resetOverview()} className="flex h-6 items-center justify-center rounded bg-white/5 px-1.5 text-[10px] font-medium text-foreground hover:bg-white/15">
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Selected Element Controls OR Tile Grid Hover Readout */}
          {(selectedDetails || (hover && hover.inBounds)) && (
            <div className="max-w-[265px] rounded-xl border border-white/15 bg-[#1a1f27]/92 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
              {selectedDetails ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-amber-300">{selectedDetails.title}</span>
                    <button type="button" onClick={() => setSelected(null)} className="text-[10px] text-muted-foreground hover:text-foreground">
                      Tutup
                    </button>
                  </div>
                  <div className="text-[11px] text-muted-foreground">{selectedDetails.sub}</div>
                  {selected?.kind === "furniture" && (() => {
                    const lv = project.levels[selected.levelIndex];
                    const f = lv?.furniture.find((x) => x.id === selected.id);
                    const cat = f ? UNIFIED_BUILD_CATALOG.find((c) => c.materialId === f.catalogId) : null;
                    if (!f || !cat?.swatches?.length) return null;
                    return (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        {cat.swatches.map((sw) => (
                          <button
                            key={sw.hex}
                            type="button"
                            title={sw.name}
                            onClick={() => useStudioStore.getState().updateFurniture(selected.levelIndex as 0 | 1, f.id, { colorHex: sw.hex })}
                            className={cn("h-4 w-4 rounded-full border", f.colorHex === sw.hex ? "border-emerald-400 scale-110" : "border-white/30")}
                            style={{ backgroundColor: sw.hex }}
                          />
                        ))}
                        <button
                          type="button"
                          title="Terapkan warna ke semua item sejenis di lantai ini"
                          onClick={() => {
                            const st = useStudioStore.getState();
                            for (const sib of lv?.furniture ?? []) {
                              if (sib.catalogId === f.catalogId) {
                                st.updateFurniture(selected.levelIndex as 0 | 1, sib.id, { colorHex: f.colorHex });
                              }
                            }
                            toast.success(`Warna diterapkan ke seluruh ${f.name}.`);
                          }}
                          className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9.5px] font-medium hover:bg-white/20"
                        >
                          Semua Sejenis
                        </button>
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {(selected?.kind === "light" || selected?.kind === "hvac") && (
                      <button
                        type="button"
                        onClick={() => {
                          const lvIdx = selected.levelIndex as 0 | 1;
                          const st = useStudioStore.getState();
                          if (selected.kind === "light") {
                            const l = project.levels[lvIdx]?.lights.find((x) => x.id === selected.id);
                            if (l) st.updateLight(lvIdx, l.id, { on: !l.on });
                          } else {
                            const h = project.levels[lvIdx]?.hvac.find((x) => x.id === selected.id);
                            if (h) st.updateHvac(lvIdx, h.id, { on: !h.on });
                          }
                        }}
                        className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/35"
                      >
                        Saklar ON/OFF
                      </button>
                    )}
                    {(selected?.kind === "furniture" || selected?.kind === "hvac") && (
                      <button type="button" onClick={() => handleRotateSelected(Math.PI / 2)} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium hover:bg-white/20">
                        Putar 90°
                      </button>
                    )}
                    {(selected?.kind === "furniture" || selected?.kind === "hvac" || selected?.kind === "light") && (
                      <button type="button" onClick={handleDuplicateSelected} className="flex items-center gap-0.5 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-200 hover:bg-sky-500/35">
                        <Copy className="h-2.5 w-2.5" /> Duplikat
                      </button>
                    )}
                    {selected?.kind === "opening" && (
                      <button
                        type="button"
                        onClick={() => {
                          const lv = selected.levelIndex as 0 | 1;
                          const w = project.levels[lv]?.walls.find((x) => x.id === selected.wallId);
                          const o = w?.openings.find((x) => x.id === selected.id);
                          if (o) useStudioStore.getState().updateOpening(lv, w!.id, o.id, { openPct: o.openPct > 20 ? 0 : 75 });
                        }}
                        className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/35"
                      >
                        Buka/Tutup
                      </button>
                    )}
                    <button type="button" onClick={handleDeleteSelected} className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/35">
                      Hapus
                    </button>
                  </div>
                </div>
              ) : activeTool === "select" ? (
                <div className="flex items-center justify-between gap-2 text-[11px] text-sky-300">
                  <span>Mode Pilih Aktif</span>
                  <span className="text-muted-foreground">Klik / seret objek 3D</span>
                </div>
              ) : (
                hover && (
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-emerald-300 tabular-nums">
                    <span>Grid ({hover.gx}, {hover.gz})</span>
                    <span className="text-muted-foreground">{(hover.gx * 0.5).toFixed(1)}m × {(hover.gz * 0.5).toFixed(1)}m</span>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* FLOATING PREVIEW HUD PILL */}
      {previewHud && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[168px] z-20 flex justify-center px-3 sm:bottom-[148px]">
          <div
            className={cn(
              "rounded-full border px-3.5 py-1 text-xs font-bold shadow-lg backdrop-blur-md",
              previewHud.valid ? "border-emerald-400/50 bg-[#122620]/90 text-emerald-200" : "border-rose-400/50 bg-[#2b1416]/90 text-rose-200",
            )}
          >
            {previewHud.label} · Klik kanan / Esc untuk batal
          </div>
        </div>
      )}

      {helpOpen && (
        <div
          role="dialog"
          aria-label="Panduan Cepat Build & Walk Mode"
          className="pointer-events-auto absolute left-2.5 top-14 z-30 w-[calc(100vw-20px)] max-w-md rounded-xl border border-white/15 bg-[#181d25]/96 p-3.5 text-xs shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-primary">Panduan Cepat 1 Layar</div>
              <span className="font-bold text-foreground">Kontrol Build Mode &amp; Walk Mode</span>
            </div>
            <button
              type="button"
              onClick={dismissOnboarding}
              className="rounded-md border border-white/15 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-white/10"
            >
              Mulai Desain
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <ul className="space-y-1 text-[10.5px] text-muted-foreground">
              <li className="font-semibold text-emerald-300">Build Mode</li>
              <li><strong className="text-foreground">Klik Kanan / Q·E</strong>: Putar kamera</li>
              <li><strong className="text-foreground">WASD / Tengah</strong>: Geser kamera</li>
              <li><strong className="text-foreground">Scroll</strong>: Zoom ke arah kursor</li>
              <li><strong className="text-foreground">PgUp / PgDn</strong>: Lantai (LT1/LT2/Atap)</li>
              <li><strong className="text-foreground">Home / End</strong>: Dinding (Penuh/Cut/Rendah)</li>
              <li><strong className="text-foreground">R / K / I / Alt</strong>: Putar / Hapus / Pipet / Bebas Grid</li>
            </ul>
            <ul className="space-y-1 text-[10.5px] text-muted-foreground">
              <li className="font-semibold text-teal-300">Walk Mode Realistis</li>
              <li><strong className="text-foreground">Shift + V / Klik Tombol</strong>: Masuk Walk</li>
              <li><strong className="text-foreground">WASD + Shift</strong>: Berjalan &amp; Lari</li>
              <li><strong className="text-foreground">Klik Kanvas / Seret</strong>: Lihat 360°</li>
              <li><strong className="text-foreground">V</strong>: 1st Person ↔ 3rd Person</li>
              <li><strong className="text-foreground">E</strong>: Buka / Tutup pintu terdekat</li>
              <li><strong className="text-foreground">F3 / Esc</strong>: Debug Collision / Kembali Build</li>
            </ul>
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-white/10 pt-2 text-[10.5px] text-muted-foreground">
            <span>Denah asli 5×17 m selalu tersinkron ke semua simulasi.</span>
            <button type="button" onClick={dismissOnboarding} className="font-semibold text-primary hover:underline">
              Jangan tampilkan lagi
            </button>
          </div>
        </div>
      )}

      {/* BOTTOM DOCK: ARCHITECTURAL METRICS (NO PRICES) + CATALOG */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 p-2.5 sm:flex-row sm:items-end sm:justify-between">
        <div className="pointer-events-auto flex flex-col gap-1.5 rounded-xl border border-white/15 bg-[#1a1f27]/92 p-2.5 shadow-2xl backdrop-blur-md sm:w-[276px]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Denah Asli 5×17 m (SNI)</div>
              <div className="text-sm font-extrabold tracking-tight text-emerald-300 tabular-nums">
                {derived.totalNetFloorM2.toFixed(1)} m² Bersih · {derived.totalWallLengthM.toFixed(1)} m Dinding
              </div>
            </div>
            <div className="text-right text-[10px] text-muted-foreground tabular-nums">
              <div>Peil +{project.site.peil.floor1PeilM.toFixed(2)} m</div>
              <div>{derived.masonry.totalBuyBricks.toLocaleString("id-ID")} bata ({project.systems.brick.preset})</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                simsAudio.play("select");
                setWorkspace("walk");
              }}
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

        {/* Sims 4 Catalog Bar */}
        <div className="pointer-events-auto flex min-w-0 flex-1 flex-col rounded-xl border border-white/15 bg-[#1a1f27]/92 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-1.5 border-b border-white/10 px-2.5 py-1.5">
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
                    activeCategory === cat.id ? "bg-emerald-500 text-slate-950 shadow-sm" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground",
                  )}
                >
                  <span className="hidden md:inline">{cat.label}</span>
                  <span className="md:hidden">{cat.short}</span>
                </button>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari..."
                  className="h-6 w-28 rounded-md border border-white/15 bg-black/30 pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setCatalogCollapsed((c) => !c)}
                className="flex h-6 items-center gap-1 rounded bg-white/10 px-2 text-[10px] font-medium text-foreground hover:bg-white/20"
              >
                {catalogCollapsed ? <Eye className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
          </div>

          {/* Contextual Sub-Bar: Global Paint Swatches / Floor Brush / Terrain / Rotate / Peil */}
          {!catalogCollapsed &&
            (activeTool === "floor_tile" ||
              activeTool === "floor_rect" ||
              activeTool === "floor_fill" ||
              activeTool === "terrain" ||
              activeTool === "stair" ||
              activeTool === "furniture" ||
              activeCategory === "walls" ||
              activeCategory === "stairs_roof" ||
              activeCategory === "build") && (
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/20 px-2.5 py-1 text-[10px]">
                {(activeTool === "floor_tile" || activeTool === "floor_rect" || activeTool === "floor_fill") && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Kuas Lantai:</span>
                    {(
                      [
                        { id: "fill", label: "1 Ruangan" },
                        { id: "rect", label: "Persegi" },
                        { id: "tile", label: "1 Ubin" },
                      ] as const
                    ).map((bm) => (
                      <button
                        key={bm.id}
                        type="button"
                        onClick={() => setFloorBrushMode(bm.id)}
                        className={cn(
                          "rounded px-1.5 py-0.5 font-medium",
                          floorBrushMode === bm.id ? "bg-emerald-500 text-slate-950" : "bg-white/10 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {bm.label}
                      </button>
                    ))}
                  </div>
                )}

                {activeTool === "terrain" && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Tanah:</span>
                    {(
                      [
                        { id: "raise", label: "Naik" },
                        { id: "lower", label: "Turun" },
                        { id: "flatten", label: "Ratakan" },
                      ] as const
                    ).map((tm) => (
                      <button
                        key={tm.id}
                        type="button"
                        onClick={() => setTerrainBrushMode(tm.id)}
                        className={cn(
                          "rounded px-1.5 py-0.5 font-medium",
                          terrainBrushMode === tm.id ? "bg-emerald-500 text-slate-950" : "bg-white/10 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {tm.label}
                      </button>
                    ))}
                  </div>
                )}

                {(activeTool === "stair" || activeTool === "furniture" || activeTool === "hvac") && (
                  <button
                    type="button"
                    onClick={() => handleRotateSelected(Math.PI / 2)}
                    className="rounded bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-200 hover:bg-amber-500/35"
                  >
                    Putar ({placementRotationQuarter * 90}°) · R
                  </button>
                )}

                {activeCategory === "walls" && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Warna Utama Fasad:</span>
                    {PAINT_SWATCHES.map((sw) => (
                      <button
                        key={sw.hex}
                        type="button"
                        title={`Cat Eksterior: ${sw.name}`}
                        onClick={() => useStudioStore.getState().patchSimulation({ paintExtHex: sw.hex })}
                        className={cn("h-4 w-4 rounded-full border", project.simulation.paintExtHex === sw.hex ? "border-emerald-400 scale-110" : "border-white/30")}
                        style={{ backgroundColor: sw.hex }}
                      />
                    ))}
                  </div>
                )}

                {activeCategory === "stairs_roof" && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Warna Atap:</span>
                    {ROOF_SWATCHES.map((sw) => (
                      <button
                        key={sw.hex}
                        type="button"
                        title={sw.name}
                        onClick={() => useStudioStore.getState().patchSimulation({ roofColorHex: sw.hex })}
                        className={cn("h-4 w-4 rounded-full border", project.simulation.roofColorHex === sw.hex ? "border-emerald-400 scale-110" : "border-white/30")}
                        style={{ backgroundColor: sw.hex }}
                      />
                    ))}
                  </div>
                )}

                {activeCategory === "build" && (
                  <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                    <span>Peil Lantai 1:</span>
                    <button
                      type="button"
                      onClick={() =>
                        useStudioStore.getState().patchPeil({
                          floor1PeilM: Math.max(0.15, Number((project.site.peil.floor1PeilM - 0.1).toFixed(2))),
                        })
                      }
                      className="rounded bg-white/10 px-1.5 text-foreground hover:bg-white/20"
                    >
                      -
                    </button>
                    <span className="font-mono text-foreground">{project.site.peil.floor1PeilM.toFixed(2)}m</span>
                    <button
                      type="button"
                      onClick={() =>
                        useStudioStore.getState().patchPeil({
                          floor1PeilM: Math.min(1.5, Number((project.site.peil.floor1PeilM + 0.1).toFixed(2))),
                        })
                      }
                      className="rounded bg-white/10 px-1.5 text-foreground hover:bg-white/20"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            )}

          {!catalogCollapsed && (
            <div className="flex items-center gap-2 overflow-x-auto px-2.5 py-2">
              {filteredItems.map((item) => {
                const active = selectedCatalogId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectItemClick(item)}
                    title={item.description}
                    className={cn(
                      "group flex w-28 shrink-0 flex-col gap-1 rounded-lg border p-1.5 text-left transition",
                      active ? "border-emerald-400 bg-emerald-500/15 shadow-md" : "border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/5",
                    )}
                  >
                    <ItemThumbnail item={item} />
                    <div className="truncate text-[11px] font-semibold text-foreground">{item.name}</div>
                    <div className="flex items-center justify-between text-[10px] tabular-nums">
                      <span className="truncate text-sky-300/90">{item.specLabel}</span>
                      {active && <Sparkles className="h-2.5 w-2.5 shrink-0 text-emerald-300" />}
                    </div>
                  </button>
                );
              })}

              <div className="ml-auto hidden max-w-[230px] shrink-0 flex-col justify-center rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] xl:flex">
                <div className="font-semibold text-emerald-300">Aktif: {activeItem.name}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{activeItem.description}</div>
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
              Kosongkan rumah untuk membangun dari tanah 5×17 m kosong atau kembalikan ke desain Rumah 2 Lantai 3 KT Surabaya asli (bisa di-Undo dengan Ctrl+Z).
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  useStudioStore.getState().resetLotClean();
                  setResetModalOpen(false);
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
              >
                <Trash2 className="h-3.5 w-3.5" /> Kosongkan Kavling (Bangun Dari Nol)
              </button>
              <button
                type="button"
                onClick={() => {
                  useStudioStore.getState().resetProject();
                  setResetModalOpen(false);
                  simsAudio.play("place");
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                <Save className="h-3.5 w-3.5" /> Muat Desain Asli Rumah 5×17 m Lengkap
              </button>
              <button type="button" onClick={() => setResetModalOpen(false)} className="mt-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/15">
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
