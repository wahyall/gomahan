"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useStore } from "zustand";
import {
  Box,
  Boxes,
  BrickWall,
  Check,
  ChevronDown,
  CloudRain,
  Compass,
  Copy,
  Droplets,
  Eye,
  FlipHorizontal2,
  Footprints,
  Grid3x3,
  Hammer,
  HelpCircle,
  Home,
  Landmark,
  Layers,
  Moon,
  MousePointer2,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  X,
  Wind,
} from "lucide-react";
import { toast } from "sonner";
import { StudioSidePanel } from "@/components/build/StudioSidePanel";
import { PartInfoPanel } from "@/components/panels/PartInfoPanel";
import { StageTimelineBar } from "@/components/panels/StageTimelineBar";
import {
  BuildScene,
  UNIFIED_BUILD_CATALOG,
  useBuildModeStore,
  type BuildCatalogEntry,
  type BuildCategoryId,
  type BuildSceneStats,
  type FurnitureSubcategory,
  type RoofVisibilityMode,
  type WallVisibilityMode,
} from "@/features/buildMode";
import { simsAudio } from "@/lib/audio/simsAudio";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { polygonArea } from "@/lib/geometry/rooms";
import { CUT_PLANE_MAX_M, CUT_PLANE_OFF, PEIL_FLOOR1_MAX_M, PEIL_FLOOR1_MIN_M } from "@/lib/model/constants";
import { PAINT_SWATCHES, ROOF_SWATCHES } from "@/lib/model/catalog";
import type { RoofType, RoomProgram } from "@/lib/model/types";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import { useStudioStore, type CameraPreset, type StudioPanelId } from "@/lib/store/useStudioStore";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { cn } from "@/lib/utils";

interface BuildWorkspaceProps {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  rab: RabSummary;
  lighting: LightingSimulationResult;
  airflow: AirflowSimulationResult;
  flood: FloodSimulationResult;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onSnapshotCapture?: (dataUrl: string) => void;
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

const FURNITURE_SUBCATS: { id: FurnitureSubcategory; label: string }[] = [
  { id: "all", label: "Semua" },
  { id: "living", label: "Tamu" },
  { id: "bedroom", label: "Tidur" },
  { id: "kitchen", label: "Dapur & Makan" },
  { id: "bath", label: "Kamar Mandi" },
  { id: "outdoor", label: "Luar & Parkir" },
];

function matchFurnitureSubcat(item: BuildCatalogEntry, sub: FurnitureSubcategory): boolean {
  if (sub === "all") return true;
  const mat = item.materialId ?? "";
  if (sub === "living") {
    return (
      item.furnitureCategory === "seating" ||
      item.furnitureCategory === "storage" ||
      mat === "coffee_table" ||
      mat === "desk"
    );
  }
  if (sub === "bedroom") {
    return item.furnitureCategory === "bed" || mat === "wardrobe";
  }
  if (sub === "kitchen") {
    return item.furnitureCategory === "kitchen" || mat === "dining_table" || mat === "dining_chair";
  }
  if (sub === "bath") return item.furnitureCategory === "sanitary";
  if (sub === "outdoor") return item.furnitureCategory === "plant" || item.furnitureCategory === "vehicle";
  return true;
}

const ROOM_PROGRAM_OPTIONS: { id: RoomProgram; label: string }[] = [
  { id: "living", label: "Ruang Tamu / Keluarga" },
  { id: "bedroom", label: "Kamar Tidur" },
  { id: "kitchen", label: "Dapur / Makan" },
  { id: "bathroom", label: "Kamar Mandi" },
  { id: "circulation", label: "Teras / Sirkulasi" },
  { id: "balcony", label: "Balkon" },
  { id: "carport", label: "Carport" },
  { id: "garden", label: "Taman" },
];

function WallModeIcon({ mode }: { mode: WallVisibilityMode }) {
  return (
    <svg viewBox="0 0 20 16" className="h-3.5 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
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
      className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded-lg border border-white/[0.08]"
      style={{ background: `linear-gradient(155deg, ${hex}2c 0%, #151921 78%)` }}
    >
      {(item.kind === "wall_material" || item.kind === "tool") && (
        <div className="h-6 w-6 rounded border border-white/25 shadow-inner" style={{ backgroundColor: hex }} />
      )}
      {item.kind === "floor_material" && (
        <div className="grid h-6 w-6 grid-cols-2 grid-rows-2 gap-0.5 rounded-sm bg-[#222731] p-0.5">
          <span className="rounded-[1px]" style={{ backgroundColor: hex }} />
          <span className="rounded-[1px] opacity-85" style={{ backgroundColor: hex }} />
          <span className="rounded-[1px] opacity-85" style={{ backgroundColor: hex }} />
          <span className="rounded-[1px]" style={{ backgroundColor: hex }} />
        </div>
      )}
      {item.kind === "opening" && (
        <div className="flex h-7 w-5 items-center justify-center rounded-t-sm border-2 border-[#cfc6b7] bg-[#78a8c9]/30">
          <div className="h-1.5 w-1.5 rounded-full bg-amber-300" />
        </div>
      )}
      {item.kind === "stair" && (
        <svg viewBox="0 0 28 24" className="h-6 w-6 text-amber-200" fill="currentColor">
          <path d="M3 20h5v-4h5v-4h5V8h7v12H3z" opacity="0.9" />
        </svg>
      )}
      {item.kind === "roof" && (
        <svg viewBox="0 0 28 24" className="h-6 w-6" fill={hex} stroke="#dce3ec" strokeWidth="1.2">
          <path d="M3 16L25 8v4L3 20z" />
        </svg>
      )}
      {item.kind === "outdoor" && (
        <div className="h-6 w-8 rounded border border-white/25" style={{ backgroundColor: hex }} />
      )}
      {item.kind === "furniture" && (
        <div className="flex flex-col items-center">
          <div className="h-3 w-7 rounded-t-sm border border-white/25" style={{ backgroundColor: hex }} />
          <div className="h-1.5 w-8 rounded-b-sm bg-[#6e4e35]" />
        </div>
      )}
      {item.kind === "hvac" && (
        <div
          className="flex h-5 w-9 items-center justify-center rounded border border-white/25 text-[8.5px] font-bold text-slate-950"
          style={{ backgroundColor: hex }}
        >
          {item.hvacMeta?.type === "ac_split" ? "AC" : "FAN"}
        </div>
      )}
      {item.kind === "light" && (
        <div className="flex flex-col items-center">
          <div className="h-2 w-0.5 bg-zinc-400" />
          <div
            className="h-3.5 w-5 rounded-t-full border border-white/25 shadow-[0_3px_10px_rgba(255,210,120,0.65)]"
            style={{ backgroundColor: hex }}
          />
        </div>
      )}
    </div>
  );
}

export function BuildWorkspace({
  derived,
  struct,
  rab,
  lighting,
  airflow,
  flood,
  onCanvasReady,
  onSnapshotCapture,
}: BuildWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<BuildScene | null>(null);
  const onSnapshotRef = useRef(onSnapshotCapture);
  const onCanvasReadyRef = useRef(onCanvasReady);
  useEffect(() => {
    onSnapshotRef.current = onSnapshotCapture;
    onCanvasReadyRef.current = onCanvasReady;
  }, [onSnapshotCapture, onCanvasReady]);

  const project = derived.project;
  const selected = useStudioStore((s) => s.selected);
  const setSelected = useStudioStore((s) => s.setSelected);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const view = useStudioStore((s) => s.view);
  const patchView = useStudioStore((s) => s.patchView);
  const studioPanel = useStudioStore((s) => s.studioPanel);
  const setStudioPanel = useStudioStore((s) => s.setStudioPanel);
  const stageTimelineOpen = useStudioStore((s) => s.stageTimelineOpen);
  const setStageTimelineOpen = useStudioStore((s) => s.setStageTimelineOpen);

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
  const selectedSwatchHex = useBuildModeStore((s) => s.selectedSwatchHex);
  const activeFurnitureSubcat = useBuildModeStore((s) => s.activeFurnitureSubcat);
  const floorBrushMode = useBuildModeStore((s) => s.floorBrushMode);
  const terrainBrushMode = useBuildModeStore((s) => s.terrainBrushMode);
  const wallPaintMode = useBuildModeStore((s) => s.wallPaintMode);
  const placementRotationStep = useBuildModeStore((s) => s.placementRotationStep);
  const placementFlipSwing = useBuildModeStore((s) => s.placementFlipSwing);
  const pendingRoofType = useBuildModeStore((s) => s.pendingRoofType);
  const hover = useBuildModeStore((s) => s.hover);
  const previewHud = useBuildModeStore((s) => s.previewHud);
  const savedCameraSnapshot = useBuildModeStore((s) => s.savedCameraSnapshot);
  const rtLook = useBuildModeStore((s) => s.rtLook);
  const renderTier = useBuildModeStore((s) => s.renderTier);
  const setRtLook = useBuildModeStore((s) => s.setRtLook);
  const setRenderTier = useBuildModeStore((s) => s.setRenderTier);

  const pastCount = useStore(useStudioStore.temporal, (s) => s.pastStates.length);
  const futureCount = useStore(useStudioStore.temporal, (s) => s.futureStates.length);

  const setActiveLevel = useBuildModeStore((s) => s.setActiveLevel);
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
  const setSelectedSwatchHex = useBuildModeStore((s) => s.setSelectedSwatchHex);
  const setActiveFurnitureSubcat = useBuildModeStore((s) => s.setActiveFurnitureSubcat);
  const setFloorBrushMode = useBuildModeStore((s) => s.setFloorBrushMode);
  const setTerrainBrushMode = useBuildModeStore((s) => s.setTerrainBrushMode);
  const setWallPaintMode = useBuildModeStore((s) => s.setWallPaintMode);
  const rotatePlacementStep = useBuildModeStore((s) => s.rotatePlacementStep);
  const togglePlacementFlipSwing = useBuildModeStore((s) => s.togglePlacementFlipSwing);
  const setPendingRoofType = useBuildModeStore((s) => s.setPendingRoofType);
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
        onEyedropCatalog: (cid, swatchHex) => {
          selectCatalogById(cid, swatchHex);
          toast.info("Item disalin dari viewport.");
        },
        onStats: (snap) => setStats(snap),
        onAddWall: (lv, w) => st.addWall(lv, w),
        onAddRoomAndWalls: (lv, ws, r) => st.addRoomAndWalls(lv, ws, r),
        onUpdateWall: (lv, id, p) => st.updateWall(lv, id, p),
        onPushPullWall: (lv, wid, d, altFree) => {
          const res = st.pushPullWall(lv, wid, d, altFree);
          if (!res.ok && res.reason) toast.warning(res.reason);
        },
        onPaintRoomWalls: (lv, rid, matId) => st.paintRoomWalls(lv, rid, matId),
        onDeleteWall: (lv, id) => st.deleteWall(lv, id),
        onDeleteWallsBatch: (lv, ids) => st.deleteWallsBatch(lv, ids),
        onAddOpening: (lv, wid, op) => st.addOpening(lv, wid, op),
        onUpdateOpening: (lv, wid, oid, p) => st.updateOpening(lv, wid, oid, p),
        onDeleteOpening: (lv, wid, oid) => st.deleteOpening(lv, wid, oid),
        onPaintRoomFloor: (lv, rid, matId) => st.paintRoomFloor(lv, rid, matId),
        onDeleteRoom: (lv, rid) => st.deleteRoom(lv, rid),
        onSetFloorTiles: (tiles) => st.setFloorTileOverrides(tiles),
        onDeleteFloorTile: (lv, gx, gz) => st.deleteFloorTile(lv, gx, gz),
        onDeleteFloorTilesBatch: (tiles) => st.deleteFloorTilesBatch(tiles),
        onAddStair: (lv, s, v) => st.addStairWithCutout(lv, s, v),
        onDeleteStair: (lv, id) => st.deleteStair(lv, id),
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
        onDeletePool: (id) => st.deletePool(id),
        onSetTerrainHeights: (h) => st.setTerrainHeights(h),
        onPlacementCommitted: (_tool, keepTool) => {
          if (!keepTool) selectCatalogById("tool_select");
        },
      });
      if (savedCameraSnapshot) bs.cameraCtrl.applySnapshot(savedCameraSnapshot);
      sceneRef.current = bs;
      onCanvasReadyRef.current?.(canvas);
      return () => {
        saveCameraSnapshot(bs.cameraCtrl.getSnapshot());
        try {
          if (canvas.width > 0 && canvas.height > 0) {
            onSnapshotRef.current?.(canvas.toDataURL("image/jpeg", 0.9));
          }
        } catch {
          // ignore readback failure
        }
        onCanvasReadyRef.current?.(null);
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
    sceneRef.current?.updateProjectData(derived, struct, useStudioStore.getState().selected, view, lighting, airflow, flood);
  }, [derived, struct, view, lighting, airflow, flood]);

  useEffect(() => {
    sceneRef.current?.setSelected(selected);
  }, [selected]);

  // Cinematic RT-look & quality tier are pushed into the scene whenever they change
  useEffect(() => {
    sceneRef.current?.setRayTracingLook(rtLook);
  }, [rtLook]);

  useEffect(() => {
    sceneRef.current?.setQualityOverride(renderTier);
  }, [renderTier]);

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
      selectedSwatchHex,
      floorBrushMode,
      terrainBrushMode,
      wallPaintMode,
      placementRotationStep,
      placementFlipSwing,
      pendingRoofType,
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
    selectedSwatchHex,
    floorBrushMode,
    terrainBrushMode,
    wallPaintMode,
    placementRotationStep,
    placementFlipSwing,
    pendingRoofType,
  ]);

  useEffect(() => {
    const nextView = activeLevel === 0 ? "lt1" : activeLevel === 1 ? "lt2_cut" : "all";
    if (useStudioStore.getState().view.activeLevelView !== nextView) {
      patchView({ activeLevelView: nextView });
    }
  }, [activeLevel, patchView]);

  const selectedDetails = useMemo(() => {
    if (!selected || selected.kind === "part") return null;
    if (selected.kind === "pool") {
      const pObj = (project.buildExtras?.pools ?? []).find((x) => x.id === selected.id);
      if (!pObj) return null;
      const pw = (Math.abs(pObj.gx2 - pObj.gx1) + 1) * 0.5;
      const pd = (Math.abs(pObj.gz2 - pObj.gz1) + 1) * 0.5;
      return { title: "Kolam Renang / Taman", sub: `${pw.toFixed(1)}×${pd.toFixed(1)} m · Dalam ${pObj.depth.toFixed(2)} m` };
    }
    const lv = project.levels[selected.levelIndex];
    if (!lv) return null;
    if (selected.kind === "wall") {
      const w = lv.walls.find((x) => x.id === selected.id);
      if (!w) return null;
      const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      return {
        title: w.name,
        sub: `${w.kind === "fence" ? "Pagar" : "Dinding"} ${len.toFixed(2)} m · ${(w.thickness * 100).toFixed(0)} cm · LT${lv.index + 1}`,
      };
    }
    if (selected.kind === "opening") {
      const w = lv.walls.find((x) => x.id === selected.wallId);
      const o = w?.openings.find((x) => x.id === selected.id);
      if (!o) return null;
      return { title: o.label, sub: `${o.width.toFixed(2)}×${o.height.toFixed(2)} m · Seret di dinding` };
    }
    if (selected.kind === "room") {
      const r = lv.rooms.find((x) => x.id === selected.id);
      if (!r) return null;
      const areaM2 = polygonArea(r.polygon);
      return { title: r.name, sub: `Ruangan · ${areaM2.toFixed(1)} m² · LT${lv.index + 1}` };
    }
    if (selected.kind === "floorTile") {
      const tile = (project.buildExtras?.floorTiles ?? []).find(
        (t) => t.levelIndex === selected.levelIndex && t.gx === selected.gx && t.gz === selected.gz,
      );
      return {
        title: `Ubin (${selected.gx}, ${selected.gz})`,
        sub: `${tile?.materialId ?? "Ubin kustom"} · LT${lv.index + 1}`,
      };
    }
    if (selected.kind === "stair") {
      const stObj = lv.stairs.find((x) => x.id === selected.id);
      if (!stObj) return null;
      return { title: stObj.name, sub: `${stObj.riserCount} anak tangga · Lebar ${stObj.width.toFixed(2)} m · LT${lv.index + 1}` };
    }
    if (selected.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === selected.id);
      if (!f) return null;
      return { title: f.name, sub: `${f.size.x.toFixed(1)}×${f.size.z.toFixed(1)} m · Seret di 3D` };
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
  }, [project.buildExtras?.floorTiles, project.buildExtras?.pools, project.levels, selected]);

  const handleDeleteSelected = useCallback(() => {
    if (!selected || selected.kind === "part") return;
    const st = useStudioStore.getState();
    const lv = selected.levelIndex as 0 | 1;
    if (selected.kind === "pool") st.deletePool(selected.id);
    else if (selected.kind === "stair") st.deleteStair(lv, selected.id);
    else if (selected.kind === "wall") st.deleteWall(lv, selected.id);
    else if (selected.kind === "opening") st.deleteOpening(lv, selected.wallId, selected.id);
    else if (selected.kind === "room") st.deleteRoom(lv, selected.id);
    else if (selected.kind === "floorTile") st.deleteFloorTile(lv, selected.gx, selected.gz);
    else if (selected.kind === "furniture") st.deleteFurniture(lv, selected.id);
    else if (selected.kind === "hvac") st.deleteHvac(lv, selected.id);
    else if (selected.kind === "light") st.deleteLight(lv, selected.id);
  }, [selected]);

  const handleRotateSelected = useCallback(
    (deltaStep: -1 | 1 = 1) => {
      if (sceneRef.current?.rotateActiveDrag(deltaStep)) {
        simsAudio.play("rotate");
        return;
      }
      if (!selected || selected.kind === "part") {
        if (activeTool === "opening") {
          togglePlacementFlipSwing();
        } else {
          rotatePlacementStep(deltaStep);
        }
        simsAudio.play("rotate");
        return;
      }
      const st = useStudioStore.getState();
      const lvIdx = selected.levelIndex as 0 | 1;
      const lv = st.project.levels[lvIdx];
      if (!lv) return;
      const deltaRad = (deltaStep > 0 ? 1 : -1) * (Math.PI / 4);
      if (selected.kind === "opening") {
        const w = lv.walls.find((x) => x.id === selected.wallId);
        const cur = w?.openings.find((o) => o.id === selected.id);
        if (w && cur) st.updateOpening(lvIdx, w.id, cur.id, { swing: cur.swing === -1 ? 1 : -1 });
      } else if (selected.kind === "furniture") {
        const cur = lv.furniture.find((f) => f.id === selected.id);
        if (cur) st.updateFurniture(lvIdx, cur.id, { rotationY: cur.rotationY + deltaRad });
      } else if (selected.kind === "hvac") {
        const cur = lv.hvac.find((h) => h.id === selected.id);
        if (cur) st.updateHvac(lvIdx, cur.id, { rotationY: cur.rotationY + deltaRad });
      } else if (selected.kind === "light") {
        const cur = lv.lights.find((l) => l.id === selected.id);
        if (cur) st.updateLight(lvIdx, cur.id, { rotationY: (cur.rotationY ?? 0) + deltaRad });
      }
      simsAudio.play("rotate");
    },
    [activeTool, rotatePlacementStep, selected, togglePlacementFlipSwing],
  );

  const handleDuplicateSelected = useCallback(() => {
    if (!selected || selected.kind === "part") return;
    const st = useStudioStore.getState();
    const lvIdx = selected.levelIndex as 0 | 1;
    const lv = st.project.levels[lvIdx];
    if (!lv) return;
    const maxX = Math.max(1, st.project.site.width - 0.35);
    if (selected.kind === "furniture") {
      const f = lv.furniture.find((x) => x.id === selected.id);
      if (f) {
        st.addFurniture(lvIdx, {
          ...structuredClone(f),
          id: `furn-cp-${Date.now().toString(36)}`,
          position: { x: Math.min(maxX, f.position.x + 0.5), y: f.position.y, z: f.position.z },
        });
      }
    } else if (selected.kind === "hvac") {
      const h = lv.hvac.find((x) => x.id === selected.id);
      if (h) {
        st.addHvac(lvIdx, {
          ...structuredClone(h),
          id: `hv-cp-${Date.now().toString(36)}`,
          position: { x: Math.min(maxX, h.position.x + 0.5), y: h.position.y, z: h.position.z },
        });
      }
    } else if (selected.kind === "light") {
      const l = lv.lights.find((x) => x.id === selected.id);
      if (l) {
        st.addLight(lvIdx, {
          ...structuredClone(l),
          id: `lgt-cp-${Date.now().toString(36)}`,
          position: { x: Math.min(maxX, l.position.x + 0.5), y: l.position.y, z: l.position.z },
        });
      }
    }
  }, [selected]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const mod = e.ctrlKey || e.metaKey;
      const st = useStudioStore.getState();
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
      } else if (e.key.toLowerCase() === "b" && !mod && !e.shiftKey) {
        selectCatalogById("tool_wall_straight");
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
      } else if ((e.key.toLowerCase() === "r" || e.key === "." || e.key === ",") && !mod) {
        handleRotateSelected(e.key === "," ? -1 : 1);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selected && selected.kind !== "part") {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (e.key === "Escape") {
        if (st.commandPaletteOpen || st.guideOpen) return;
        if (resetModalOpen) {
          e.stopImmediatePropagation();
          setResetModalOpen(false);
        } else if (helpOpen) {
          e.stopImmediatePropagation();
          setHelpOpen(false);
        } else if (pendingRoofType) {
          e.stopImmediatePropagation();
          setPendingRoofType(null);
        } else if (activeTool !== "select") {
          e.stopImmediatePropagation();
          selectCatalogById("tool_select");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
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
    helpOpen,
    pendingRoofType,
    setPendingRoofType,
    activeTool,
  ]);

  const handleFocusFoundation = useCallback(() => {
    patchView({ showTerrain: false, showStructure: true });
    sceneRef.current?.cameraCtrl.setPreset("foundation");
    simsAudio.play("select");
  }, [patchView]);

  const handleCameraPreset = useCallback((preset: CameraPreset) => {
    sceneRef.current?.cameraCtrl.setPreset(preset);
    simsAudio.play("select");
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UNIFIED_BUILD_CATALOG.filter((item) => {
      if (q) return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
      if (item.category !== activeCategory) return false;
      if (activeCategory === "furniture") return matchFurnitureSubcat(item, activeFurnitureSubcat);
      return true;
    });
  }, [activeCategory, activeFurnitureSubcat, query]);

  const activeItem = UNIFIED_BUILD_CATALOG.find((c) => c.id === selectedCatalogId) ?? UNIFIED_BUILD_CATALOG[0]!;
  const criticalCount = derived.validation.filter((v) => v.severity === "critical").length;
  const floodActive = view.showFloodWater || view.showRain;
  const floodDanger = flood.lt1FloorFloodCm > 0 || flood.electricalHazardMcb || flood.electricalHazardOutlets;

  const handleSelectItemClick = (item: BuildCatalogEntry) => {
    selectCatalogItem(item);
    simsAudio.play("select");
  };

  const panelTabs: { id: Exclude<StudioPanelId, "none">; label: string; icon: React.ElementType; badge?: number; dotClass?: string }[] = [
    { id: "structure", label: "Struktur", icon: ShieldCheck, badge: criticalCount > 0 ? criticalCount : undefined },
    { id: "lighting", label: "Cahaya", icon: Sun },
    { id: "airflow", label: "Udara", icon: Wind },
    { id: "flood", label: "Banjir", icon: CloudRain, dotClass: floodDanger ? "bg-rose-400" : flood.streetFloodCm > 0 ? "bg-cyan-400" : undefined },
    { id: "inspection", label: "Inspeksi", icon: SlidersHorizontal },
  ];

  const layerChecklist: { key: "showAir" | "showListrik" | "showLabels" | "showDims" | "wireframe"; label: string }[] = [
    { key: "showAir", label: "Jalur Pipa Air & Bio Septic" },
    { key: "showListrik", label: "Jalur Kabel Listrik & PUIL" },
    { key: "showLabels", label: "Label Ruangan 3D" },
    { key: "showDims", label: "Garis Dimensi 3D" },
    { key: "wireframe", label: "Mode Wireframe Struktur" },
  ];

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-[#10141a]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="@container relative flex min-h-0 w-full flex-1 flex-col overflow-hidden select-none">
          <canvas
            ref={canvasRef}
            className={cn("viewport-canvas touch-none h-full w-full flex-1", activeTool === "select" ? "cursor-pointer" : "cursor-crosshair")}
          />

          {webglError && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#111418]/95 p-6 text-center">
              <div className="studio-glass max-w-md rounded-2xl border-rose-500/40 p-6">
                <h2 className="text-base font-bold text-rose-300">WebGL Tidak Tersedia</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{webglError}</p>
              </div>
            </div>
          )}

          {/* TOP HUD: 3 cleanly separated edge zones */}
          <div className="pointer-events-none absolute inset-x-0 top-2.5 z-20 flex flex-wrap items-start justify-between gap-2 px-3">
            {/* TOP-LEFT: Unified Simulation/Analysis Panel Switcher + Walk Mode */}
            <div className="pointer-events-auto order-1 flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl p-1 studio-glass">
              {panelTabs.map((t) => {
                const Icon = t.icon;
                const active = studioPanel === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStudioPanel(active ? "none" : t.id)}
                    className={cn(
                      "relative flex h-7 shrink-0 items-center gap-1 rounded-xl px-2 text-[11px] font-medium transition active:scale-[0.98] sm:h-8 sm:px-2.5",
                      active
                        ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm"
                        : "text-foreground/90 hover:bg-white/[0.08] hover:text-foreground",
                    )}
                    title={`Buka / tutup panel ${t.label}`}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[#b9662a]" : "opacity-85")} aria-hidden />
                    <span className="hidden sm:inline">{t.label}</span>
                    {t.badge !== undefined && (
                      <span className="rounded-full bg-rose-500 px-1 font-mono text-[9.5px] font-bold text-white">
                        {t.badge}
                      </span>
                    )}
                    {t.dotClass && <span className={cn("h-1.5 w-1.5 rounded-full", t.dotClass)} />}
                  </button>
                );
              })}

              <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden />

              <button
                type="button"
                onClick={() => {
                  simsAudio.play("select");
                  setWorkspace("walk");
                }}
                title="Masuk Walk Mode Orang Pertama / Ketiga (Shift+V)"
                className="flex h-7 shrink-0 items-center gap-1 rounded-xl bg-white/[0.06] px-2 text-[11px] font-medium text-foreground transition hover:bg-white/[0.12] active:scale-[0.98] sm:h-8 sm:px-2.5"
              >
                <Footprints className="h-3.5 w-3.5 text-primary" />
                <span className="hidden md:inline">Walk</span>
              </button>

              <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden />

              <button
                type="button"
                disabled={pastCount === 0}
                onClick={() => useStudioStore.temporal.getState().undo()}
                title="Batalkan (Ctrl+Z)"
                aria-label="Undo"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-foreground transition hover:bg-white/[0.1] disabled:opacity-35 sm:h-8 sm:w-8"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={futureCount === 0}
                onClick={() => useStudioStore.temporal.getState().redo()}
                title="Ulangi (Ctrl+Y)"
                aria-label="Redo"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-foreground transition hover:bg-white/[0.1] disabled:opacity-35 sm:h-8 sm:w-8"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* TOP-CENTER: Unified Build Tools & Live 3D Analysis Overlays */}
            <div className="order-3 flex w-full justify-center @[1360px]:order-2 @[1360px]:w-auto">
              <div className="no-scrollbar pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto scroll-smooth rounded-2xl p-1 studio-glass">
              <button
                type="button"
                onClick={() => {
                  selectCatalogById("tool_select");
                  simsAudio.play("select");
                }}
                title="Mode Pilih & Geser Objek 3D (V / Esc)"
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition active:scale-[0.98]",
                  activeTool === "select"
                    ? "bg-[#f2efe8] text-[#14171c] shadow-sm"
                    : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
                )}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                <span>Pilih</span>
                <kbd className="hidden rounded bg-black/15 px-1 font-mono text-[9.5px] sm:inline">V</kbd>
              </button>

              <button
                type="button"
                onClick={() => {
                  selectCatalogById("tool_sledgehammer");
                  simsAudio.play("select");
                }}
                title="Palu Hapus Elemen (K / Del)"
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-medium transition active:scale-[0.98]",
                  activeTool === "sledgehammer"
                    ? "bg-rose-500/25 text-rose-200 ring-1 ring-rose-400/50"
                    : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
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
                  "flex h-8 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-medium transition active:scale-[0.98]",
                  activeTool === "eyedropper"
                    ? "bg-primary/25 text-[#f6ba86] ring-1 ring-primary/50"
                    : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
                )}
              >
                <Pipette className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Pipet</span>
              </button>

              <span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />

              <OverlayBtn
                active={!view.showTerrain}
                tone="amber"
                onClick={() => patchView({ showTerrain: !view.showTerrain })}
                title={view.showTerrain ? "Sembunyikan tanah untuk inspeksi pondasi" : "Tampilkan kembali tanah & halaman"}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>{view.showTerrain ? "Tanah" : "Tanah Off"}</span>
              </OverlayBtn>

              <button
                type="button"
                onClick={handleFocusFoundation}
                title="Sembunyikan tanah & arahkan kamera ke struktur pondasi"
                className="flex h-8 shrink-0 items-center gap-1 rounded-xl bg-white/[0.05] px-2 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
              >
                <Landmark className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Pondasi</span>
              </button>

              <OverlayBtn active={gridVisible} onClick={toggleGrid} title="Tampilkan Grid 0.5 m (G)">
                <Grid3x3 className="h-3.5 w-3.5" />
                <span className="hidden 2xl:inline">Grid</span>
              </OverlayBtn>

              <OverlayBtn active={showBricksOverlay} onClick={toggleBricksOverlay} title="Susunan Bata Hebel/Merah Asli">
                <BrickWall className="h-3.5 w-3.5" />
                <span className="hidden 2xl:inline">Bata</span>
              </OverlayBtn>

              <OverlayBtn
                active={view.xrayRebar}
                tone="amber"
                onClick={() => patchView({ xrayRebar: !view.xrayRebar, showStructure: true })}
                title="X-Ray Besi Tulangan Pondasi, Kolom & Balok"
              >
                <Boxes className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Besi</span>
              </OverlayBtn>

              <OverlayBtn
                active={view.explode > 0.05}
                onClick={() => patchView({ explode: view.explode > 0.05 ? 0 : 1 })}
                title="Bongkar Lapisan Konstruksi (Exploded View)"
              >
                <Box className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Bongkar</span>
              </OverlayBtn>

              <OverlayBtn
                active={view.showLuxHeatmap}
                tone="amber"
                onClick={() => patchView({ showLuxHeatmap: !view.showLuxHeatmap })}
                title="Overlay Heatmap Pencahayaan (Lux)"
              >
                <Sun className="h-3.5 w-3.5" />
                <span className="hidden 2xl:inline">Lux</span>
              </OverlayBtn>

              <OverlayBtn
                active={view.showAirParticles}
                tone="teal"
                onClick={() => patchView({ showAirParticles: !view.showAirParticles })}
                title="Overlay Partikel Aliran Angin & AC/Kipas"
              >
                <Wind className="h-3.5 w-3.5" />
                <span className="hidden 2xl:inline">Angin</span>
              </OverlayBtn>

              <OverlayBtn
                active={floodActive}
                tone="cyan"
                onClick={() => patchView({ showFloodWater: !floodActive, showRain: !floodActive })}
                title="Overlay Air Banjir & Hujan 3D"
              >
                <Droplets className="h-3.5 w-3.5" />
                <span className="hidden 2xl:inline">Banjir</span>
              </OverlayBtn>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    title="Lapisan MEP, Dimensi, 12 Tahap Konstruksi & Opsi Kamera"
                    className="flex h-8 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-medium text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">Lapisan</span>
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="center"
                    sideOffset={6}
                    className="studio-glass z-50 w-60 rounded-xl p-1.5 text-xs shadow-2xl"
                  >
                    {layerChecklist.map((item) => {
                      const active = view[item.key];
                      return (
                        <DropdownMenu.Item
                          key={item.key}
                          onSelect={(e) => {
                            e.preventDefault();
                            patchView({ [item.key]: !active });
                          }}
                          className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                        >
                          <span>{item.label}</span>
                          {active && <Check className="h-3.5 w-3.5 text-primary" />}
                        </DropdownMenu.Item>
                      );
                    })}
                    <DropdownMenu.Item
                      onSelect={(e) => {
                        e.preventDefault();
                        const next = !stageTimelineOpen;
                        setStageTimelineOpen(next);
                        if (!next && view.stage > 0) patchView({ stage: 0 });
                      }}
                      className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                    >
                      <span>Timeline 12 Tahap Konstruksi</span>
                      {(stageTimelineOpen || view.stage > 0) && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-white/[0.08]" />
                    <DropdownMenu.Item
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleSnap90();
                      }}
                      className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                    >
                      <span className="flex items-center gap-1.5"><Compass className="h-3.5 w-3.5 opacity-75" /> Kunci Sudut 90°</span>
                      {snap90Enabled && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={(e) => {
                        e.preventDefault();
                        const nextNeighbors = !neighborsVisible;
                        toggleNeighbors();
                        patchView({ showNeighbors: nextNeighbors });
                      }}
                      className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                    >
                      <span>Tampilkan Dinding Tetangga</span>
                      {neighborsVisible && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleEdgeScroll();
                      }}
                      className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                    >
                      <span>Geser Kamera Tepi Layar</span>
                      {edgeScrollEnabled && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-white/[0.08]" />
                    <DropdownMenu.Item
                      onSelect={(e) => {
                        e.preventDefault();
                        setRtLook(!rtLook);
                      }}
                      className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 outline-none transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-300/90" />
                        Render Sinematik (Ray-Traced Look)
                      </span>
                      {rtLook && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenu.Item>
                    <div className="px-2.5 pb-1.5 pt-1">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Kualitas Render
                      </div>
                      <div className="flex items-center gap-0.5 rounded-lg bg-black/30 p-0.5">
                        {([
                          ["auto", "Auto"],
                          ["high", "Tinggi"],
                          ["medium", "Sedang"],
                          ["low", "Hemat"],
                        ] as const).map(([tier, label]) => (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => setRenderTier(tier)}
                            className={cn(
                              "flex-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition",
                              renderTier === tier
                                ? "bg-[#f2efe8] text-[#14171c] shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[9.5px] leading-relaxed text-muted-foreground">
                        {rtLook
                          ? "GTAO, berkas matahari, bloom HDR & MSAA aktif sesuai tier (mode Banjir/hujan mematikan GTAO otomatis)."
                          : "Mode kompatibilitas: render langsung tanpa pasca-pemrosesan."}
                      </p>
                    </div>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />

              <button
                type="button"
                onClick={() => setResetModalOpen(true)}
                title="Atur Ulang atau Kosongkan Kavling 5×17 m"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-rose-300/80 transition hover:bg-rose-500/15 hover:text-rose-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                title="Pintasan Keyboard & Panduan Cepat"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition",
                  helpOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
                )}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
              </div>
            </div>

            {/* TOP-RIGHT: Floor Jump + Wall Cutaway + Mode Struktur Camera Cube & Ortho */}
            <div className="pointer-events-auto order-2 flex shrink-0 flex-col items-end gap-2 @[1360px]:order-3">
              <div className="flex flex-col gap-1 rounded-2xl p-1.5 sm:gap-1.5 sm:p-2 studio-glass">
                {/* Direct Floor Selector (LT1 / LT2 / Atap) */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-1 items-center gap-0.5 rounded-lg bg-black/30 p-0.5">
                    {([
                      [0, "LT 1"],
                      [1, "LT 2"],
                      [2, "Atap"],
                    ] as const).map(([lvl, label]) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => {
                          setActiveLevel(lvl);
                          simsAudio.play("select");
                        }}
                        title={`Pindah ke ${label} (PgUp/PgDn)`}
                        className={cn(
                          "flex-1 whitespace-nowrap rounded-md px-2 py-1 text-[10.5px] font-semibold transition sm:text-[11px]",
                          activeLevel === lvl
                            ? "bg-[#f2efe8] text-[#14171c] shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Wall Cutaway Mode */}
                <div className="flex items-center gap-0.5 rounded-lg bg-black/30 p-0.5">
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
                          ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <WallModeIcon mode={wm.id} />
                      <span className="hidden sm:inline">{wm.label}</span>
                    </button>
                  ))}
                </div>

                {/* Roof Visibility + Persp/Orto + Quick Orbit */}
                <div className="hidden items-center justify-between gap-1.5 pt-0.5 sm:flex">
                  <div className="flex items-center gap-0.5">
                    {(["auto", "show", "hide"] as RoofVisibilityMode[]).map((rm) => (
                      <button
                        key={rm}
                        type="button"
                        onClick={() => {
                          setRoofVisibility(rm);
                          patchView({ showRoof: rm !== "hide" });
                        }}
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition",
                          roofVisibility === rm
                            ? "bg-primary/20 text-[#f6ba86] ring-1 ring-primary/40"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {rm === "auto" ? "Atap Auto" : rm === "show" ? "On" : "Off"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => patchView({ ortho: !view.ortho })}
                      title="Ganti proyeksi Perspektif / Ortografis (CAD)"
                      className={cn(
                        "flex h-7 items-center rounded-md px-1.5 font-mono text-[10px] font-semibold transition",
                        view.ortho ? "bg-primary/25 text-[#f6ba86] ring-1 ring-primary/40" : "bg-white/[0.06] text-foreground hover:bg-white/[0.14]",
                      )}
                    >
                      {view.ortho ? "Orto" : "Persp"}
                    </button>
                    <button
                      type="button"
                      title="Putar Kamera 90° Kiri (Q)"
                      aria-label="Putar Kamera 90° Kiri"
                      onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(-1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-foreground hover:bg-white/[0.14]"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Putar Kamera 90° Kanan (E)"
                      aria-label="Putar Kamera 90° Kanan"
                      onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(1)}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-foreground hover:bg-white/[0.14]"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Reset Sudut Kamera"
                      onClick={() => sceneRef.current?.cameraCtrl.resetOverview()}
                      className="flex h-7 items-center justify-center rounded-md bg-white/[0.06] px-2 text-[10.5px] font-medium text-foreground hover:bg-white/[0.14]"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* View Cube Presets (from Mode Struktur) */}
                <div className="hidden grid-cols-6 gap-0.5 rounded-lg bg-black/30 p-0.5 sm:grid">
                  {([
                    ["3d", "3/4"],
                    ["top", "Atas"],
                    ["front", "Depan"],
                    ["side", "Samp"],
                    ["back", "Blkg"],
                    ["foundation", "Dasar"],
                  ] as [CameraPreset, string][]).map(([preset, lbl]) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => (preset === "foundation" ? handleFocusFoundation() : handleCameraPreset(preset))}
                      title={`Preset kamera: ${lbl}`}
                      className="rounded px-1 py-0.5 text-center font-mono text-[9.5px] font-medium text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Terrain / Section / Explode / Sim Overlays Pill when active */}
              {(!view.showTerrain ||
                view.explode > 0.05 ||
                view.cutH < CUT_PLANE_MAX_M - 0.05 ||
                view.showLuxHeatmap ||
                view.showAirParticles ||
                floodActive) && (
                <div className="flex flex-wrap items-center justify-end gap-1.5 rounded-xl border border-amber-400/35 bg-[#1b1812]/90 px-2.5 py-1 text-[10.5px] text-amber-200 backdrop-blur-md">
                  {!view.showTerrain && (
                    <button
                      type="button"
                      onClick={() => patchView({ showTerrain: true })}
                      className="font-semibold underline decoration-amber-400/60 underline-offset-2 hover:text-white"
                    >
                      Tanah Tersembunyi (Tampilkan)
                    </button>
                  )}
                  {view.explode > 0.05 && (
                    <button
                      type="button"
                      onClick={() => patchView({ explode: 0 })}
                      className="font-mono hover:text-white"
                    >
                      Bongkar {Math.round(view.explode * 100)}% (Reset)
                    </button>
                  )}
                  {view.cutH < CUT_PLANE_MAX_M - 0.05 && (
                    <button
                      type="button"
                      onClick={() => patchView({ cutH: CUT_PLANE_OFF })}
                      className="font-mono hover:text-white"
                    >
                      Potong {view.cutH.toFixed(1)}m (Reset)
                    </button>
                  )}
                  {view.showLuxHeatmap && (
                    <button
                      type="button"
                      onClick={() => patchView({ showLuxHeatmap: false })}
                      className="font-medium text-amber-300 underline-offset-2 hover:text-white hover:underline"
                    >
                      Lux 3D (Matikan)
                    </button>
                  )}
                  {view.showAirParticles && (
                    <button
                      type="button"
                      onClick={() => patchView({ showAirParticles: false })}
                      className="font-medium text-teal-300 underline-offset-2 hover:text-white hover:underline"
                    >
                      Angin 3D (Matikan)
                    </button>
                  )}
                  {floodActive && (
                    <button
                      type="button"
                      onClick={() => patchView({ showFloodWater: false, showRain: false })}
                      className="font-medium text-cyan-300 underline-offset-2 hover:text-white hover:underline"
                    >
                      Hujan/Banjir 3D (Matikan)
                    </button>
                  )}
                </div>
              )}

          {/* Contextual Selected Object Card OR Live Hover Coordinates */}
          {(selectedDetails || (hover && hover.inBounds) || activeTool === "select") && (
            <div
              className={cn(
                "w-[272px] max-w-[calc(100vw-24px)] rounded-2xl px-3 py-2 text-xs studio-glass",
                !selectedDetails && "hidden sm:block",
              )}
            >
              {selectedDetails ? (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{selectedDetails.title}</div>
                      <div className="text-[11px] text-muted-foreground">{selectedDetails.sub}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      aria-label="Lepas pilihan objek"
                      className="rounded-md p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {selected?.kind === "room" && (() => {
                    const lvIdx = selected.levelIndex as 0 | 1;
                    const r = project.levels[lvIdx]?.rooms.find((x) => x.id === selected.id);
                    if (!r) return null;
                    return (
                      <div className="space-y-1.5 pt-0.5">
                        <input
                          value={r.name}
                          onChange={(e) => useStudioStore.getState().updateRoom(lvIdx, r.id, { name: e.target.value })}
                          placeholder="Nama ruangan"
                          className="h-7 w-full rounded-lg border border-white/15 bg-black/30 px-2 text-[11px] text-foreground focus:border-primary focus:outline-none"
                        />
                        <select
                          value={r.program}
                          onChange={(e) =>
                            useStudioStore.getState().updateRoom(lvIdx, r.id, { program: e.target.value as RoomProgram })
                          }
                          className="h-7 w-full rounded-lg border border-white/15 bg-[#12161d] px-2 text-[11px] text-foreground focus:border-primary focus:outline-none"
                        >
                          {ROOM_PROGRAM_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}

                  {selected?.kind === "furniture" && (() => {
                    const lv = project.levels[selected.levelIndex];
                    const f = lv?.furniture.find((x) => x.id === selected.id);
                    const cat = f ? UNIFIED_BUILD_CATALOG.find((c) => c.materialId === f.catalogId) : null;
                    if (!f || !cat?.swatches?.length) return null;
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {cat.swatches.map((sw) => (
                          <button
                            key={sw.hex}
                            type="button"
                            title={sw.name}
                            onClick={() => useStudioStore.getState().updateFurniture(selected.levelIndex as 0 | 1, f.id, { colorHex: sw.hex })}
                            className={cn(
                              "h-4 w-4 rounded-full border transition",
                              f.colorHex === sw.hex ? "scale-110 border-primary ring-2 ring-primary/40" : "border-white/30",
                            )}
                            style={{ backgroundColor: sw.hex }}
                          />
                        ))}
                        <button
                          type="button"
                          title="Terapkan warna ke semua item sejenis di lantai ini"
                          onClick={() => {
                            const updates = (lv?.furniture ?? [])
                              .filter((sib) => sib.catalogId === f.catalogId && sib.id !== f.id)
                              .map((sib) => ({ id: sib.id, patch: { colorHex: f.colorHex } }));
                            if (updates.length > 0) {
                              useStudioStore.getState().updateFurnitureBatch(selected.levelIndex as 0 | 1, updates);
                            }
                            toast.success(`Warna diterapkan ke seluruh ${f.name}.`);
                          }}
                          className="ml-auto rounded-md bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium hover:bg-white/[0.15]"
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
                        className="rounded-md bg-primary/20 px-2 py-1 text-[10.5px] font-semibold text-[#f6ba86] hover:bg-primary/30"
                      >
                        Saklar ON/OFF
                      </button>
                    )}
                    {(selected?.kind === "furniture" || selected?.kind === "hvac" || selected?.kind === "light") && (
                      <button
                        type="button"
                        onClick={() => handleRotateSelected(1)}
                        className="rounded-md bg-white/[0.08] px-2 py-1 text-[10.5px] font-medium hover:bg-white/[0.15]"
                      >
                        Putar 45°
                      </button>
                    )}
                    {(selected?.kind === "furniture" || selected?.kind === "hvac" || selected?.kind === "light") && (
                      <button
                        type="button"
                        onClick={handleDuplicateSelected}
                        className="flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-[10.5px] font-medium hover:bg-white/[0.15]"
                      >
                        <Copy className="h-3 w-3" /> Duplikat
                      </button>
                    )}
                    {selected?.kind === "opening" && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const lv = selected.levelIndex as 0 | 1;
                            const w = project.levels[lv]?.walls.find((x) => x.id === selected.wallId);
                            const o = w?.openings.find((x) => x.id === selected.id);
                            if (o) useStudioStore.getState().updateOpening(lv, w!.id, o.id, { openPct: o.openPct > 20 ? 0 : 75 });
                          }}
                          className="rounded-md bg-emerald-500/20 px-2 py-1 text-[10.5px] font-medium text-emerald-200 hover:bg-emerald-500/35"
                        >
                          Buka/Tutup
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRotateSelected(1)}
                          className="flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-[10.5px] font-medium hover:bg-white/[0.15]"
                        >
                          <FlipHorizontal2 className="h-3 w-3" /> Balik
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      className="ml-auto rounded-md bg-rose-500/20 px-2 py-1 text-[10.5px] font-semibold text-rose-200 hover:bg-rose-500/35"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ) : activeTool === "select" ? (
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-foreground">Mode Pilih</span>
                  <span className="text-muted-foreground">Klik atau seret objek di 3D</span>
                </div>
              ) : (
                hover && (
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums">
                    <span className="font-semibold text-[#f6ba86]">Grid ({hover.gx}, {hover.gz})</span>
                    <span className="text-muted-foreground">
                      {(hover.gx * 0.25).toFixed(2)}m × {(hover.gz * 0.25).toFixed(2)}m
                    </span>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* FLOATING PLACEMENT PREVIEW HUD PILL */}
      {previewHud && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[174px] z-20 flex justify-center px-3 sm:bottom-[152px]">
          <div
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold shadow-xl backdrop-blur-md",
              previewHud.valid
                ? "border-emerald-400/45 bg-[#122620]/90 text-emerald-200"
                : "border-rose-400/45 bg-[#2b1416]/90 text-rose-200",
            )}
          >
            {previewHud.label} · Klik kanan / Esc untuk batal
          </div>
        </div>
      )}

      {/* ONBOARDING / SHORTCUTS CHEATSHEET */}
      {helpOpen && (
        <div
          data-build-modal="1"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          onClick={dismissOnboarding}
        >
          <div
            role="dialog"
            aria-label="Panduan Cepat Build & Walk Mode"
            onClick={(e) => e.stopPropagation()}
            className="studio-glass pointer-events-auto w-full max-w-md rounded-2xl p-4 text-xs shadow-2xl"
          >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">Panduan Cepat</div>
              <h3 className="text-sm font-bold text-foreground">Kontrol Build &amp; Walk Mode</h3>
            </div>
            <button
              type="button"
              onClick={dismissOnboarding}
              className="rounded-lg bg-[#f2efe8] px-3 py-1.5 text-xs font-semibold text-[#14171c] hover:brightness-95"
            >
              Mulai Desain
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.08] bg-black/20 p-2.5">
              <div className="mb-1.5 text-[11px] font-semibold text-primary">Build Mode</div>
              <ul className="space-y-1 text-[10.5px] text-muted-foreground">
                <li><strong className="text-foreground">Klik Kanan / Q·E</strong>: Putar kamera</li>
                <li><strong className="text-foreground">WASD / Tengah</strong>: Geser kamera</li>
                <li><strong className="text-foreground">Scroll</strong>: Zoom ke arah kursor</li>
                <li><strong className="text-foreground">V / Klik Objek</strong>: Pilih &amp; geser bebas</li>
                <li><strong className="text-foreground">PgUp / PgDn</strong>: Pindah Lantai</li>
                <li><strong className="text-foreground">R / K / I</strong>: Putar / Hapus / Pipet</li>
              </ul>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 p-2.5">
              <div className="mb-1.5 text-[11px] font-semibold text-teal-300">Walk Mode Realistis</div>
              <ul className="space-y-1 text-[10.5px] text-muted-foreground">
                <li><strong className="text-foreground">Shift + V</strong>: Masuk Walk Mode</li>
                <li><strong className="text-foreground">WASD + Shift</strong>: Jalan &amp; Lari</li>
                <li><strong className="text-foreground">Klik Kanvas</strong>: Lihat 360°</li>
                <li><strong className="text-foreground">V</strong>: 1st Person ↔ 3rd Person</li>
                <li><strong className="text-foreground">E</strong>: Buka / Tutup pintu terdekat</li>
                <li><strong className="text-foreground">Esc</strong>: Kembali ke Build Mode</li>
              </ul>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.08] pt-2.5 text-[10.5px] text-muted-foreground">
            <span>Semua perubahan langsung memperbarui SNI, simulasi &amp; RAB.</span>
            <button type="button" onClick={dismissOnboarding} className="font-semibold text-primary hover:underline">
              Tutup &amp; ingat
            </button>
          </div>
          </div>
        </div>
      )}

      {/* BOTTOM DOCK: TELEMETRY + DAYLIGHT PRESETS + UNIFIED CATALOG */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-3 pb-2.5 lg:flex-row lg:items-end lg:justify-between">
        {/* Bottom-Left Lot Telemetry + Time of Day (shown cleanly on wide viewports) */}
        <div className="studio-glass pointer-events-auto hidden w-[264px] shrink-0 flex-col gap-2 rounded-2xl px-3 py-2.5 min-[1440px]:flex">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Denah 5×17 m</div>
              <div className="mt-0.5 font-mono text-sm font-bold tracking-tight text-foreground tabular-nums">
                {derived.totalNetFloorM2.toFixed(1)} m² <span className="text-xs font-normal text-muted-foreground">· {derived.totalWallLengthM.toFixed(1)} m dind</span>
              </div>
            </div>
            <div className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">
              <div className="text-primary font-semibold">Peil +{project.site.peil.floor1PeilM.toFixed(2)}m</div>
              <div>{derived.masonry.totalBuyBricks.toLocaleString("id-ID")} bata</div>
            </div>
          </div>

          {/* Daylight Time-of-Day Scrubber Pills */}
          <div className="flex items-center gap-1 rounded-xl bg-black/30 p-0.5">
            <span className="px-1.5 text-amber-300" title="Waktu Pencahayaan Matahari Surabaya">
              {project.simulation.hourOfDay >= 18.5 ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </span>
            {TIMES_OF_DAY.map((t) => {
              const active = Math.abs(project.simulation.hourOfDay - t.hour) < 2.2;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => useStudioStore.getState().patchSimulation({ hourOfDay: t.hour })}
                  className={cn(
                    "flex-1 rounded-lg py-1 text-[10.5px] font-medium transition",
                    active ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
            {stats && (
              <span className="hidden pl-1.5 pr-1 font-mono text-[9.5px] text-muted-foreground tabular-nums sm:inline">
                {stats.fps}fps
              </span>
            )}
          </div>

          {/* Material legend (restored from Struktur Mode) with contextual MEP rows */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-white/[0.07] pt-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#efede6]" /> Plester</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#8f9295]" /> Beton SNI</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#363b40]" /> Atap</span>
            {view.showAir && <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#3ea2f4]" /> Air</span>}
            {view.showListrik && <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#f5c442]" /> Listrik</span>}
            {view.xrayRebar && <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#f97316]" /> Besi</span>}
            {view.showLuxHeatmap && <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#fbbf24]" /> Lux</span>}
          </div>
        </div>

        {/* Bottom-Right Interactive Build Catalog Dock */}
        <div className="studio-glass pointer-events-auto flex min-w-0 flex-1 flex-col rounded-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] px-2.5 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {CATEGORIES.map((cat) => {
                const active = activeCategory === cat.id && !query.trim();
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setCategory(cat.id);
                      simsAudio.play("select");
                    }}
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition active:scale-[0.98]",
                      active
                        ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm"
                        : "text-muted-foreground hover:bg-white/[0.07] hover:text-foreground",
                    )}
                  >
                    <span className="hidden md:inline">{cat.label}</span>
                    <span className="md:hidden">{cat.short}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <div className="relative block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground sm:left-2.5" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari..."
                  className="h-8 w-20 rounded-lg border border-white/10 bg-black/30 pl-6 pr-5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none sm:h-7 sm:w-32 sm:pl-7 sm:pr-6"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Hapus pencarian katalog"
                    onClick={() => setQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                title="Ganti Waktu Pencahayaan (Pagi / Siang / Sore / Malam)"
                onClick={() => {
                  const idx = TIMES_OF_DAY.findIndex((t) => Math.abs(project.simulation.hourOfDay - t.hour) < 2.2);
                  const next = TIMES_OF_DAY[(idx + 1) % TIMES_OF_DAY.length]!;
                  useStudioStore.getState().patchSimulation({ hourOfDay: next.hour });
                  simsAudio.play("select");
                }}
                className="flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2 text-[10.5px] font-medium text-amber-200 transition hover:bg-white/[0.12] sm:h-7 min-[1440px]:hidden"
              >
                {project.simulation.hourOfDay >= 18.5 ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                <span className="hidden sm:inline">
                  {(TIMES_OF_DAY.find((t) => Math.abs(project.simulation.hourOfDay - t.hour) < 2.2) ?? TIMES_OF_DAY[1]!).label}
                </span>
              </button>
              <button
                type="button"
                aria-label={catalogCollapsed ? "Tampilkan katalog item" : "Lipat katalog item"}
                onClick={() => setCatalogCollapsed((c) => !c)}
                className="flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2 text-[10.5px] font-medium text-foreground transition hover:bg-white/[0.12] sm:h-7"
              >
                {catalogCollapsed ? (
                  <>
                    <Eye className="h-3 w-3 text-primary" />
                    <span>Katalog</span>
                  </>
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Contextual Options Bar */}
          {!catalogCollapsed &&
            (activeTool === "floor_tile" ||
              activeTool === "terrain" ||
              activeTool === "wall_paint" ||
              activeTool === "stair" ||
              activeTool === "furniture" ||
              activeTool === "hvac" ||
              activeTool === "light" ||
              activeCategory === "furniture" ||
              activeCategory === "walls" ||
              activeCategory === "stairs_roof" ||
              activeCategory === "build" ||
              Boolean(pendingRoofType)) && (
              <div className="flex flex-wrap items-center gap-2.5 border-b border-white/[0.06] bg-black/20 px-3 py-1.5 text-[10.5px]">
                {activeCategory === "furniture" && !query.trim() && (
                  <div className="flex flex-wrap items-center gap-1">
                    {FURNITURE_SUBCATS.map((sc) => (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => setActiveFurnitureSubcat(sc.id)}
                        className={cn(
                          "rounded-md px-2 py-0.5 font-medium transition",
                          activeFurnitureSubcat === sc.id
                            ? "bg-primary font-semibold text-primary-foreground"
                            : "bg-white/[0.07] text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {sc.label}
                      </button>
                    ))}
                  </div>
                )}

                {activeTool === "furniture" && Boolean(activeItem.swatches?.length) && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Warna:</span>
                    {activeItem.swatches!.map((sw) => {
                      const activeHex = selectedSwatchHex ?? activeItem.swatchHex;
                      return (
                        <button
                          key={sw.hex}
                          type="button"
                          title={sw.name}
                          onClick={() => setSelectedSwatchHex(sw.hex)}
                          className={cn(
                            "h-4 w-4 rounded-full border transition",
                            activeHex === sw.hex ? "scale-110 border-primary ring-2 ring-primary/40" : "border-white/30",
                          )}
                          style={{ backgroundColor: sw.hex }}
                        />
                      );
                    })}
                  </div>
                )}

                {activeTool === "floor_tile" && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Kuas:</span>
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
                          "rounded-md px-2 py-0.5 font-medium transition",
                          floorBrushMode === bm.id ? "bg-primary font-semibold text-primary-foreground" : "bg-white/[0.07] text-muted-foreground hover:text-foreground",
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
                          "rounded-md px-2 py-0.5 font-medium transition",
                          terrainBrushMode === tm.id ? "bg-primary font-semibold text-primary-foreground" : "bg-white/[0.07] text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {tm.label}
                      </button>
                    ))}
                  </div>
                )}

                {(activeTool === "stair" || activeTool === "furniture" || activeTool === "hvac" || activeTool === "light") && (
                  <button
                    type="button"
                    onClick={() => handleRotateSelected(1)}
                    className="flex items-center gap-1 rounded-md bg-primary/20 px-2 py-0.5 font-semibold text-[#f6ba86] hover:bg-primary/30"
                  >
                    <RotateCw className="h-3 w-3" /> Putar ({(activeTool === "stair" ? (placementRotationStep % 4) * 90 : placementRotationStep * 45)}°) · R
                  </button>
                )}

                {(activeCategory === "walls" || activeTool === "wall_paint") && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Mode Cat:</span>
                      {(
                        [
                          { id: "side", label: "Sisi" },
                          { id: "room", label: "1 Ruangan" },
                        ] as const
                      ).map((pm) => (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => setWallPaintMode(pm.id)}
                          className={cn(
                            "rounded-md px-2 py-0.5 font-medium transition",
                            wallPaintMode === pm.id
                              ? "bg-primary font-semibold text-primary-foreground"
                              : "bg-white/[0.07] text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {pm.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Fasad:</span>
                      {PAINT_SWATCHES.map((sw) => (
                        <button
                          key={sw.hex}
                          type="button"
                          title={`Cat Global Fasad: ${sw.name}`}
                          onClick={() => useStudioStore.getState().patchSimulation({ paintExtHex: sw.hex })}
                          className={cn(
                            "h-4 w-4 rounded-full border transition",
                            project.simulation.paintExtHex === sw.hex ? "scale-110 border-primary ring-2 ring-primary/40" : "border-white/30",
                          )}
                          style={{ backgroundColor: sw.hex }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {(activeCategory === "stairs_roof" || pendingRoofType) && (
                  <div className="flex flex-wrap items-center gap-2.5">
                    {pendingRoofType && (
                      <div className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-2 py-0.5">
                        <span className="font-semibold text-[#f6ba86]">Preview: {pendingRoofType}</span>
                        <button
                          type="button"
                          onClick={() => {
                            useStudioStore.getState().patchSystems({ roofType: pendingRoofType as RoofType });
                            setPendingRoofType(null);
                            simsAudio.play("place");
                            toast.success(`Bentuk atap diterapkan.`);
                          }}
                          className="rounded bg-emerald-500/80 px-2 py-0.5 font-semibold text-slate-950 hover:bg-emerald-400"
                        >
                          Terapkan
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingRoofType(null)}
                          className="rounded bg-white/10 px-1.5 py-0.5 text-foreground hover:bg-white/20"
                        >
                          Batal
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span>Sudut:</span>
                      <button
                        type="button"
                        onClick={() =>
                          useStudioStore.getState().patchSystems({ roofSlopeDeg: Math.max(5, project.systems.roofSlopeDeg - 2) })
                        }
                        className="flex h-5 w-5 items-center justify-center rounded bg-white/10 font-bold text-foreground hover:bg-white/20"
                      >
                        -
                      </button>
                      <span className="font-mono font-semibold text-foreground tabular-nums">{project.systems.roofSlopeDeg}°</span>
                      <button
                        type="button"
                        onClick={() =>
                          useStudioStore.getState().patchSystems({ roofSlopeDeg: Math.min(45, project.systems.roofSlopeDeg + 2) })
                        }
                        className="flex h-5 w-5 items-center justify-center rounded bg-white/10 font-bold text-foreground hover:bg-white/20"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span>Tritisan:</span>
                      <button
                        type="button"
                        onClick={() =>
                          useStudioStore.getState().patchSystems({
                            overhangFrontM: Math.max(0.2, Number((project.systems.overhangFrontM - 0.1).toFixed(2))),
                          })
                        }
                        className="flex h-5 w-5 items-center justify-center rounded bg-white/10 font-bold text-foreground hover:bg-white/20"
                      >
                        -
                      </button>
                      <span className="font-mono font-semibold text-foreground tabular-nums">{project.systems.overhangFrontM.toFixed(1)}m</span>
                      <button
                        type="button"
                        onClick={() =>
                          useStudioStore.getState().patchSystems({
                            overhangFrontM: Math.min(1.5, Number((project.systems.overhangFrontM + 0.1).toFixed(2))),
                          })
                        }
                        className="flex h-5 w-5 items-center justify-center rounded bg-white/10 font-bold text-foreground hover:bg-white/20"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Atap:</span>
                      {ROOF_SWATCHES.map((sw) => (
                        <button
                          key={sw.hex}
                          type="button"
                          title={sw.name}
                          onClick={() => useStudioStore.getState().patchSimulation({ roofColorHex: sw.hex })}
                          className={cn(
                            "h-4 w-4 rounded-full border transition",
                            project.simulation.roofColorHex === sw.hex ? "scale-110 border-primary ring-2 ring-primary/40" : "border-white/30",
                          )}
                          style={{ backgroundColor: sw.hex }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {activeCategory === "build" && (
                  <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                    <span>Peil LT1:</span>
                    <button
                      type="button"
                      onClick={() =>
                        useStudioStore.getState().patchPeil({
                          floor1PeilM: Math.max(PEIL_FLOOR1_MIN_M, Number((project.site.peil.floor1PeilM - 0.1).toFixed(2))),
                        })
                      }
                      className="flex h-7 w-7 items-center justify-center rounded bg-white/10 font-bold text-foreground hover:bg-white/20 sm:h-6 sm:w-6"
                    >
                      -
                    </button>
                    <span className="font-mono font-semibold text-foreground tabular-nums">{project.site.peil.floor1PeilM.toFixed(2)}m</span>
                    <button
                      type="button"
                      onClick={() =>
                        useStudioStore.getState().patchPeil({
                          floor1PeilM: Math.min(PEIL_FLOOR1_MAX_M, Number((project.site.peil.floor1PeilM + 0.1).toFixed(2))),
                        })
                      }
                      className="flex h-7 w-7 items-center justify-center rounded bg-white/10 font-bold text-foreground hover:bg-white/20 sm:h-6 sm:w-6"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            )}

          {/* Item Rail */}
          {!catalogCollapsed && (
            <div className="flex items-stretch gap-2 overflow-x-auto px-2.5 py-2">
              {filteredItems.map((item) => {
                const active = selectedCatalogId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectItemClick(item)}
                    title={item.description}
                    className={cn(
                      "group flex w-24 shrink-0 flex-col gap-1 rounded-xl border p-1.5 text-left transition active:scale-[0.98] sm:w-28 sm:gap-1.5",
                      active
                        ? "border-primary/70 bg-primary/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                        : "border-white/[0.08] bg-black/25 hover:border-white/20 hover:bg-white/[0.05]",
                    )}
                  >
                    <ItemThumbnail item={item} />
                    <div className="truncate text-[11px] font-semibold text-foreground">{item.name}</div>
                    <div className="flex items-center justify-between gap-1 font-mono text-[9.5px] tabular-nums">
                      <span className="truncate text-muted-foreground">{item.specLabel}</span>
                      <span className="flex items-center gap-0.5">
                        {item.swatches?.slice(0, 3).map((sw) => (
                          <i
                            key={sw.hex}
                            className="inline-block h-2 w-2 rounded-full border border-white/25"
                            style={{ backgroundColor: sw.hex }}
                          />
                        ))}
                        {active && <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary" />}
                      </span>
                    </div>
                  </button>
                );
              })}

              {filteredItems.length === 0 && (
                <div className="flex h-20 flex-1 items-center justify-center text-xs text-muted-foreground">
                  Tidak ada item yang cocok dengan &ldquo;{query}&rdquo;.
                </div>
              )}

              <div className="ml-auto hidden max-w-[235px] shrink-0 flex-col justify-center rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] @[1260px]:flex">
                <div className="truncate font-semibold text-primary">Aktif: {activeItem.name}</div>
                <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{activeItem.description}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FLOATING PART INSPECTION CARD (Structural / MEP element clicked in 3D) */}
      {selected?.kind === "part" && (
        <PartInfoPanel
          derived={derived}
          struct={struct}
          rab={rab}
          className={catalogCollapsed ? "bottom-16 right-3" : "bottom-[178px] right-3 sm:bottom-[162px]"}
        />
      )}

      {/* RESET / PRESET CONFIRMATION MODAL */}
      {resetModalOpen && (
        <div data-build-modal="1" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="studio-glass w-full max-w-md rounded-2xl p-5 shadow-2xl">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Home className="h-4 w-4 text-primary" /> Atur Ulang Kavling 5×17 m
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Kosongkan rumah untuk membangun dari lahan 5×17 m kosong atau muat ulang desain Rumah 2 Lantai 3 KT Surabaya asli (bisa di-Undo dengan Ctrl+Z).
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  useStudioStore.getState().resetLotClean();
                  setResetModalOpen(false);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
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
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                <Save className="h-3.5 w-3.5" /> Muat Desain Asli Rumah 5×17 m Lengkap
              </button>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="mt-1 rounded-xl bg-white/[0.08] px-3 py-2 text-xs font-medium text-foreground hover:bg-white/[0.14]"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
        </div>

        {(stageTimelineOpen || view.stage > 0) && <StageTimelineBar />}
      </div>

      <StudioSidePanel
        derived={derived}
        struct={struct}
        lighting={lighting}
        airflow={airflow}
        flood={flood}
        onFocusFoundation={handleFocusFoundation}
      />
    </div>
  );
}

function OverlayBtn({
  active,
  onClick,
  title,
  tone = "primary",
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  tone?: "primary" | "amber" | "teal" | "cyan";
  className?: string;
  children: React.ReactNode;
}) {
  const activeStyle =
    tone === "amber"
      ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/45"
      : tone === "teal"
        ? "bg-teal-500/20 text-teal-200 ring-1 ring-teal-400/45"
        : tone === "cyan"
          ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/45"
          : "bg-primary/20 text-[#f6ba86] ring-1 ring-primary/45";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-8 items-center gap-1 rounded-xl px-2 text-xs font-medium transition active:scale-[0.98]",
        active ? activeStyle : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
