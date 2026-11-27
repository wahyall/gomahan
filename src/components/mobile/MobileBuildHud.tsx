"use client";

import { useState, type RefObject } from "react";
import { useStore } from "zustand";
import {
  Box,
  Boxes,
  BrickWall,
  Check,
  Compass,
  Copy,
  DoorOpen,
  Droplets,
  FlipHorizontal2,
  Grid3x3,
  Hammer,
  Hand,
  HelpCircle,
  Landmark,
  Layers,
  Magnet,
  Menu,
  Moon,
  MoreVertical,
  Move,
  Palette,
  Pencil,
  Pipette,
  Plus,
  Power,
  Redo2,
  Repeat,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Wind,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  BuildScene,
  UNIFIED_BUILD_CATALOG,
  useBuildModeStore,
  type BuildCatalogEntry,
  type BuildCategoryId,
  type BuildToolId,
  type FurnitureSubcategory,
  type RoofVisibilityMode,
  type WallVisibilityMode,
} from "@/features/buildMode";
import { simsAudio } from "@/lib/audio/simsAudio";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { PAINT_SWATCHES, ROOF_SWATCHES } from "@/lib/model/catalog";
import { PEIL_FLOOR1_MAX_M, PEIL_FLOOR1_MIN_M } from "@/lib/model/constants";
import type { RoofType, RoomProgram } from "@/lib/model/types";
import { useStudioStore, type CameraPreset } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";

const CATEGORIES: { id: BuildCategoryId; label: string }[] = [
  { id: "build", label: "Bangun" },
  { id: "walls", label: "Dinding" },
  { id: "floors", label: "Lantai" },
  { id: "openings", label: "Bukaan" },
  { id: "stairs_roof", label: "Atap/Tangga" },
  { id: "outdoor", label: "Luar" },
  { id: "furniture", label: "Perabot" },
  { id: "hvac", label: "AC/Kipas" },
  { id: "lighting", label: "Lampu" },
];

const FURNITURE_SUBCATS: { id: FurnitureSubcategory; label: string }[] = [
  { id: "all", label: "Semua" },
  { id: "living", label: "Tamu" },
  { id: "bedroom", label: "Tidur" },
  { id: "kitchen", label: "Dapur" },
  { id: "bath", label: "Mandi" },
  { id: "outdoor", label: "Parkir" },
];

const WALL_MODES: { id: WallVisibilityMode; label: string }[] = [
  { id: "up", label: "Penuh" },
  { id: "cutaway", label: "Potong" },
  { id: "down", label: "Rendah" },
];

const TIMES_OF_DAY: { id: string; hour: number; label: string }[] = [
  { id: "morning", hour: 7.5, label: "Pagi" },
  { id: "noon", hour: 12.0, label: "Siang" },
  { id: "sunset", hour: 17.2, label: "Sore" },
  { id: "night", hour: 21.0, label: "Malam" },
];

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

const POINT_TOOLS = new Set<BuildToolId>(["opening", "stair", "furniture", "hvac", "light"]);
const DRAG_DRAW_TOOLS = new Set<BuildToolId>(["wall_straight", "wall_room", "wall_diagonal", "fence", "pool", "terrain"]);

function matchFurnitureSubcat(item: BuildCatalogEntry, sub: FurnitureSubcategory): boolean {
  if (sub === "all") return true;
  const mat = item.materialId ?? "";
  if (sub === "living") {
    return item.furnitureCategory === "seating" || item.furnitureCategory === "storage" || mat === "coffee_table" || mat === "desk";
  }
  if (sub === "bedroom") return item.furnitureCategory === "bed" || mat === "wardrobe";
  if (sub === "kitchen") return item.furnitureCategory === "kitchen" || mat === "dining_table" || mat === "dining_chair";
  if (sub === "bath") return item.furnitureCategory === "sanitary";
  if (sub === "outdoor") return item.furnitureCategory === "plant" || item.furnitureCategory === "vehicle";
  return true;
}

interface MobileBuildHudProps {
  derived: DerivedProjectModel;
  sceneRef: RefObject<BuildScene | null>;
  selectedDetails: { title: string; sub: string } | null;
  onOpenProjectMenu: () => void;
  onOpenResetLot: () => void;
  onOpenHelp: () => void;
  onRotateSelected: (delta: -1 | 1) => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onCameraPreset: (preset: CameraPreset) => void;
  onFocusFoundation: () => void;
}

export function MobileBuildHud({
  derived,
  sceneRef,
  selectedDetails,
  onOpenProjectMenu,
  onOpenResetLot,
  onOpenHelp,
  onRotateSelected,
  onDuplicateSelected,
  onDeleteSelected,
  onCameraPreset,
  onFocusFoundation,
}: MobileBuildHudProps) {
  const project = derived.project;
  const selected = useStudioStore((s) => s.selected);
  const setSelected = useStudioStore((s) => s.setSelected);
  const view = useStudioStore((s) => s.view);
  const patchView = useStudioStore((s) => s.patchView);
  const stageTimelineOpen = useStudioStore((s) => s.stageTimelineOpen);
  const setStageTimelineOpen = useStudioStore((s) => s.setStageTimelineOpen);
  const studioPanel = useStudioStore((s) => s.studioPanel);

  const pastCount = useStore(useStudioStore.temporal, (s) => s.pastStates.length);
  const futureCount = useStore(useStudioStore.temporal, (s) => s.futureStates.length);

  const activeLevel = useBuildModeStore((s) => s.activeLevel);
  const setActiveLevel = useBuildModeStore((s) => s.setActiveLevel);
  const wallVisibility = useBuildModeStore((s) => s.wallVisibility);
  const setWallVisibility = useBuildModeStore((s) => s.setWallVisibility);
  const cycleWallVisibility = useBuildModeStore((s) => s.cycleWallVisibility);
  const roofVisibility = useBuildModeStore((s) => s.roofVisibility);
  const setRoofVisibility = useBuildModeStore((s) => s.setRoofVisibility);
  const gridVisible = useBuildModeStore((s) => s.gridVisible);
  const toggleGrid = useBuildModeStore((s) => s.toggleGrid);
  const snap90Enabled = useBuildModeStore((s) => s.snap90Enabled);
  const toggleSnap90 = useBuildModeStore((s) => s.toggleSnap90);
  const neighborsVisible = useBuildModeStore((s) => s.neighborsVisible);
  const toggleNeighbors = useBuildModeStore((s) => s.toggleNeighbors);
  const showBricksOverlay = useBuildModeStore((s) => s.showBricksOverlay);
  const toggleBricksOverlay = useBuildModeStore((s) => s.toggleBricksOverlay);
  const activeCategory = useBuildModeStore((s) => s.activeCategory);
  const setCategory = useBuildModeStore((s) => s.setCategory);
  const activeTool = useBuildModeStore((s) => s.activeTool);
  const selectCatalogItem = useBuildModeStore((s) => s.selectCatalogItem);
  const selectCatalogById = useBuildModeStore((s) => s.selectCatalogById);
  const selectedCatalogId = useBuildModeStore((s) => s.selectedCatalogId);
  const selectedSwatchHex = useBuildModeStore((s) => s.selectedSwatchHex);
  const setSelectedSwatchHex = useBuildModeStore((s) => s.setSelectedSwatchHex);
  const activeFurnitureSubcat = useBuildModeStore((s) => s.activeFurnitureSubcat);
  const setActiveFurnitureSubcat = useBuildModeStore((s) => s.setActiveFurnitureSubcat);
  const floorBrushMode = useBuildModeStore((s) => s.floorBrushMode);
  const setFloorBrushMode = useBuildModeStore((s) => s.setFloorBrushMode);
  const terrainBrushMode = useBuildModeStore((s) => s.terrainBrushMode);
  const setTerrainBrushMode = useBuildModeStore((s) => s.setTerrainBrushMode);
  const wallPaintMode = useBuildModeStore((s) => s.wallPaintMode);
  const setWallPaintMode = useBuildModeStore((s) => s.setWallPaintMode);
  const placementRotationStep = useBuildModeStore((s) => s.placementRotationStep);
  const pendingRoofType = useBuildModeStore((s) => s.pendingRoofType);
  const setPendingRoofType = useBuildModeStore((s) => s.setPendingRoofType);
  const freePlacementEnabled = useBuildModeStore((s) => s.freePlacementEnabled);
  const toggleFreePlacement = useBuildModeStore((s) => s.toggleFreePlacement);
  const multiPlaceEnabled = useBuildModeStore((s) => s.multiPlaceEnabled);
  const toggleMultiPlace = useBuildModeStore((s) => s.toggleMultiPlace);
  const mobileDrawMode = useBuildModeStore((s) => s.mobileDrawMode);
  const setMobileDrawMode = useBuildModeStore((s) => s.setMobileDrawMode);
  const mobileMoveEntityArmed = useBuildModeStore((s) => s.mobileMoveEntityArmed);
  const setMobileMoveEntityArmed = useBuildModeStore((s) => s.setMobileMoveEntityArmed);
  const mobileCatalogOpen = useBuildModeStore((s) => s.mobileCatalogOpen);
  const setMobileCatalogOpen = useBuildModeStore((s) => s.setMobileCatalogOpen);
  const previewHud = useBuildModeStore((s) => s.previewHud);
  const rtLook = useBuildModeStore((s) => s.rtLook);
  const setRtLook = useBuildModeStore((s) => s.setRtLook);
  const renderTier = useBuildModeStore((s) => s.renderTier);
  const setRenderTier = useBuildModeStore((s) => s.setRenderTier);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [roomSheetOpen, setRoomSheetOpen] = useState(false);
  const [swatchSheetOpen, setSwatchSheetOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeItem = UNIFIED_BUILD_CATALOG.find((c) => c.id === selectedCatalogId) ?? UNIFIED_BUILD_CATALOG[0]!;
  const isPointTool = POINT_TOOLS.has(activeTool);
  const isDragTool =
    DRAG_DRAW_TOOLS.has(activeTool) ||
    (activeTool === "floor_tile" && floorBrushMode !== "fill") ||
    activeTool === "sledgehammer";

  const filteredItems = UNIFIED_BUILD_CATALOG.filter((item) => {
    const q = query.trim().toLowerCase();
    if (q) return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    if (item.category !== activeCategory) return false;
    if (activeCategory === "furniture") return matchFurnitureSubcat(item, activeFurnitureSubcat);
    return true;
  });

  const cancelToolToSelect = () => {
    sceneRef.current?.cancelActivePreview();
    selectCatalogById("tool_select");
    setPendingRoofType(null);
    simsAudio.play("select");
  };

  return (
    <>
      {/* 1. FLOATING TOP PILL BAR (44px, single row, leaves >= 80% 3D viewport open) */}
      <div className="pointer-events-none absolute inset-x-2.5 top-[max(0.5rem,env(safe-area-inset-top))] z-20 flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={onOpenProjectMenu}
          aria-label="Menu Proyek"
          className="studio-glass pointer-events-auto flex min-h-11 min-w-11 items-center justify-center rounded-2xl text-foreground transition active:scale-[0.96]"
        >
          <Menu className="h-4 w-4 text-primary" />
        </button>

        {/* Center Level Segmented Pill */}
        <div className="studio-glass pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1">
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
              className={cn(
                "min-h-9 rounded-xl px-3 text-xs font-semibold transition",
                activeLevel === lvl ? "bg-[#f2efe8] text-[#14171c] shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Right: Single Undo / Redo / Options */}
        <div className="studio-glass pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1">
          <button
            type="button"
            disabled={pastCount === 0}
            onClick={() => useStudioStore.temporal.getState().undo()}
            aria-label="Undo"
            className="flex min-h-9 min-w-9 items-center justify-center rounded-xl text-foreground transition active:bg-white/15 disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={futureCount === 0}
            onClick={() => useStudioStore.temporal.getState().redo()}
            aria-label="Redo"
            className="flex min-h-9 min-w-9 items-center justify-center rounded-xl text-foreground transition active:bg-white/15 disabled:opacity-30"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOptionsOpen(true)}
            aria-label="Kamera dan Lapisan"
            className="flex min-h-9 min-w-9 items-center justify-center rounded-xl text-foreground transition active:bg-white/15"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 2. RESTING THUMB-ZONE CONTROLS (when select mode & nothing selected & no sim panel open) */}
      {activeTool === "select" && !selected && !pendingRoofType && studioPanel === "none" && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-end justify-between gap-2">
          {/* Bottom-left quick utility pills */}
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                cycleWallVisibility();
                simsAudio.play("select");
              }}
              className="studio-glass flex min-h-11 items-center gap-1.5 rounded-2xl px-3 text-xs font-semibold text-foreground active:scale-[0.97]"
            >
              <Layers className="h-4 w-4 text-primary" />
              <span>{WALL_MODES.find((w) => w.id === wallVisibility)?.label ?? "Potong"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                selectCatalogById("tool_sledgehammer");
                simsAudio.play("select");
              }}
              className="studio-glass flex min-h-11 items-center gap-1.5 rounded-2xl px-3 text-xs font-semibold text-rose-200 active:scale-[0.97]"
            >
              <Hammer className="h-4 w-4" />
              <span>Hapus</span>
            </button>
            <button
              type="button"
              onClick={() => {
                selectCatalogById("tool_eyedropper");
                simsAudio.play("select");
              }}
              aria-label="Pipet salin item"
              className="studio-glass flex min-h-11 min-w-11 items-center justify-center rounded-2xl text-foreground active:scale-[0.97]"
            >
              <Pipette className="h-4 w-4 text-primary" />
            </button>
          </div>

          {/* Primary FAB + Bangun */}
          <button
            type="button"
            onClick={() => {
              setMobileCatalogOpen(true);
              simsAudio.play("select");
            }}
            className="pointer-events-auto flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_28px_rgba(226,138,72,0.45)] transition active:scale-[0.96]"
          >
            <Plus className="h-5 w-5 stroke-[2.5]" />
            <span>Bangun</span>
          </button>
        </div>
      )}

      {/* 3. PLACEMENT STAGE 2-STEP ACTION BAR (MOB-03 + MOB-04) */}
      {(isPointTool || Boolean(pendingRoofType)) && studioPanel === "none" && (
        <div className="pointer-events-none absolute inset-x-2.5 bottom-3 z-20 flex flex-col items-center gap-2">
          {/* Live Ghost Status Pill */}
          <div
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold shadow-xl backdrop-blur-md",
              pendingRoofType
                ? "border-primary/50 bg-[#1c1612]/92 text-[#f6ba86]"
                : previewHud?.valid !== false
                  ? "border-emerald-400/50 bg-[#122620]/92 text-emerald-200"
                  : "border-rose-400/50 bg-[#2b1416]/92 text-rose-200",
            )}
          >
            {pendingRoofType
              ? `Pratinjau Atap: ${activeItem.name}`
              : previewHud?.label
                ? previewHud.label
                : `Seret 1 jari di layar untuk posisikan ${activeItem.name}`}
          </div>

          {activeTool === "furniture" && Boolean(activeItem.swatches?.length) && (
            <div className="studio-glass pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Warna:</span>
              {activeItem.swatches!.map((sw) => {
                const activeHex = selectedSwatchHex ?? activeItem.swatchHex;
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    aria-label={sw.name}
                    onClick={() => setSelectedSwatchHex(sw.hex)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition",
                      activeHex === sw.hex ? "scale-110 border-primary ring-2 ring-primary/40" : "border-white/30",
                    )}
                    style={{ backgroundColor: sw.hex }}
                  />
                );
              })}
            </div>
          )}

          {/* Contextual Thumb Action Bar */}
          <div className="studio-glass pointer-events-auto flex w-full max-w-lg items-center gap-2 overflow-x-auto rounded-2xl p-1.5 no-scrollbar">
            <button
              type="button"
              onClick={cancelToolToSelect}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-foreground active:scale-[0.97]"
            >
              <X className="h-4 w-4 text-rose-300" />
              <span>Batal</span>
            </button>

            {pendingRoofType ? (
              <button
                type="button"
                onClick={() => {
                  useStudioStore.getState().patchSystems({ roofType: pendingRoofType as RoofType });
                  setPendingRoofType(null);
                  selectCatalogById("tool_select");
                  simsAudio.play("place");
                  toast.success("Bentuk atap diterapkan.");
                }}
                className="ml-auto flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-slate-950 active:scale-[0.97]"
              >
                <Check className="h-4 w-4 stroke-[2.5]" />
                <span>Terapkan Atap</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onRotateSelected(1)}
                  className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-xs font-semibold text-foreground active:scale-[0.97]"
                >
                  {activeTool === "opening" ? (
                    <>
                      <FlipHorizontal2 className="h-4 w-4 text-primary" />
                      <span>Balik</span>
                    </>
                  ) : (
                    <>
                      <RotateCw className="h-4 w-4 text-primary" />
                      <span>{activeTool === "stair" ? `${(placementRotationStep % 4) * 90}°` : `${placementRotationStep * 45}°`}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFreePlacement()}
                  aria-pressed={freePlacementEnabled}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold transition active:scale-[0.97]",
                    freePlacementEnabled ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50" : "bg-white/[0.06] text-muted-foreground",
                  )}
                >
                  <Magnet className="h-3.5 w-3.5" />
                  <span>{freePlacementEnabled ? "Bebas" : "Grid"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleMultiPlace()}
                  aria-pressed={multiPlaceEnabled}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold transition active:scale-[0.97]",
                    multiPlaceEnabled ? "bg-primary/25 text-[#f6ba86] ring-1 ring-primary/50" : "bg-white/[0.06] text-muted-foreground",
                  )}
                >
                  <Repeat className="h-3.5 w-3.5" />
                  <span>{multiPlaceEnabled ? "Beruntun" : "1×"}</span>
                </button>

                <button
                  type="button"
                  disabled={previewHud?.valid === false}
                  onClick={() => {
                    const ok = sceneRef.current?.confirmMobilePlacement();
                    if (!ok) {
                      toast.warning(previewHud?.label ?? "Posisi belum valid untuk ditaruh.");
                    }
                  }}
                  className="ml-auto flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-slate-950 shadow-lg transition active:scale-[0.97] disabled:opacity-40"
                >
                  <Check className="h-4 w-4 stroke-[2.5]" />
                  <span>Taruh</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 4. DRAW / PAINT / BRUSH / SLEDGEHAMMER CONTEXTUAL ACTION BAR (MOB-04) */}
      {!isPointTool && !pendingRoofType && activeTool !== "select" && studioPanel === "none" && (
        <div className="pointer-events-none absolute inset-x-2.5 bottom-3 z-20 flex flex-col items-center gap-2">
          <div
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold shadow-xl backdrop-blur-md",
              previewHud && !previewHud.valid
                ? "border-rose-400/50 bg-[#2b1416]/92 text-rose-200"
                : "border-white/15 bg-[#12161d]/92 text-foreground",
            )}
          >
            {previewHud?.label ??
              (activeTool === "wall_paint"
                ? "Ketuk dinding untuk cat (seret untuk orbit)"
                : activeTool === "eyedropper"
                  ? "Ketuk objek di 3D untuk menyalin"
                  : activeTool === "sledgehammer"
                    ? mobileDrawMode === "draw"
                      ? "Ketuk atau seret area untuk menghapus"
                      : "Mode Orbit aktif (ketuk Gambar untuk hapus)"
                    : mobileDrawMode === "draw"
                      ? `Seret 1 jari di lantai: ${activeItem.name}`
                      : "Mode Orbit aktif (2 jari zoom/geser selalu aktif)")}
          </div>

          <div className="studio-glass pointer-events-auto flex w-full max-w-lg items-center gap-2 overflow-x-auto rounded-2xl p-1.5 no-scrollbar">
            <button
              type="button"
              onClick={cancelToolToSelect}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-[#f2efe8] px-3 text-xs font-bold text-[#14171c] active:scale-[0.97]"
            >
              <Check className="h-4 w-4 text-emerald-700" />
              <span>Selesai</span>
            </button>

            {isDragTool && (
              <button
                type="button"
                onClick={() => setMobileDrawMode(mobileDrawMode === "draw" ? "orbit" : "draw")}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition active:scale-[0.97]",
                  mobileDrawMode === "orbit"
                    ? "bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50"
                    : "bg-primary/25 text-[#f6ba86] ring-1 ring-primary/50",
                )}
              >
                {mobileDrawMode === "orbit" ? <Hand className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                <span>{mobileDrawMode === "orbit" ? "Orbit" : "Gambar"}</span>
              </button>
            )}

            {(activeTool === "wall_straight" || activeTool === "wall_diagonal" || activeTool === "fence") && (
              <button
                type="button"
                onClick={() => toggleFreePlacement()}
                aria-pressed={freePlacementEnabled}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold transition",
                  freePlacementEnabled ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50" : "bg-white/[0.06] text-muted-foreground",
                )}
              >
                <Magnet className="h-3.5 w-3.5" />
                <span>{freePlacementEnabled ? "Bebas" : "Sudut 90°"}</span>
              </button>
            )}

            {activeTool === "wall_paint" && (
              <div className="flex items-center gap-1 rounded-xl bg-black/30 p-0.5">
                {(
                  [
                    { id: "side", label: "1 Sisi" },
                    { id: "room", label: "1 Ruang" },
                  ] as const
                ).map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => setWallPaintMode(pm.id)}
                    className={cn(
                      "min-h-10 rounded-lg px-3 text-xs font-semibold transition",
                      wallPaintMode === pm.id ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>
            )}

            {activeTool === "floor_tile" && (
              <div className="flex items-center gap-1 rounded-xl bg-black/30 p-0.5">
                {(
                  [
                    { id: "fill", label: "1 Ruang" },
                    { id: "rect", label: "Persegi" },
                    { id: "tile", label: "1 Ubin" },
                  ] as const
                ).map((bm) => (
                  <button
                    key={bm.id}
                    type="button"
                    onClick={() => setFloorBrushMode(bm.id)}
                    className={cn(
                      "min-h-10 rounded-lg px-2.5 text-xs font-semibold transition",
                      floorBrushMode === bm.id ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                  >
                    {bm.label}
                  </button>
                ))}
              </div>
            )}

            {activeTool === "terrain" && (
              <div className="flex items-center gap-1 rounded-xl bg-black/30 p-0.5">
                {(
                  [
                    { id: "raise", label: "Naik" },
                    { id: "lower", label: "Turun" },
                    { id: "flatten", label: "Rata" },
                  ] as const
                ).map((tm) => (
                  <button
                    key={tm.id}
                    type="button"
                    onClick={() => setTerrainBrushMode(tm.id)}
                    className={cn(
                      "min-h-10 rounded-lg px-2.5 text-xs font-semibold transition",
                      terrainBrushMode === tm.id ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                  >
                    {tm.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setMobileCatalogOpen(true)}
              className="ml-auto flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-xs font-semibold text-foreground"
            >
              <Plus className="h-4 w-4 text-primary" />
              <span>Katalog</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. SELECTED OBJECT BOTTOM ACTION BAR (MOB-04 + MOB-08) */}
      {activeTool === "select" && selected && selected.kind !== "part" && selectedDetails && studioPanel === "none" && (
        <div className="pointer-events-none absolute inset-x-2.5 bottom-3 z-20 flex justify-center">
          <div className="studio-glass pointer-events-auto flex w-full max-w-lg flex-col gap-2 rounded-2xl p-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-foreground">{selectedDetails.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">{selectedDetails.sub}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMoveEntityArmed(false);
                  setSelected(null);
                }}
                aria-label="Lepas pilihan"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              {/* Wall Push-Pull Nudge Buttons (with 5cm precision toggle!) */}
              {selected.kind === "wall" && (
                <>
                  <button
                    type="button"
                    onClick={() => toggleFreePlacement()}
                    className={cn(
                      "flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold",
                      freePlacementEnabled ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50" : "bg-white/[0.07] text-muted-foreground",
                    )}
                  >
                    <span>{freePlacementEnabled ? "5cm" : "25cm"}</span>
                  </button>
                  {([-1, 1] as const).map((dir) => {
                    const step = freePlacementEnabled ? 0.05 : 0.25;
                    const delta = dir * step;
                    return (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => {
                          const res = useStudioStore
                            .getState()
                            .pushPullWall(selected.levelIndex as 0 | 1, selected.id, delta, freePlacementEnabled);
                          if (!res.ok && res.reason) toast.warning(res.reason);
                          else simsAudio.play("place");
                        }}
                        className="flex min-h-11 shrink-0 items-center rounded-xl bg-primary/20 px-3 font-mono text-xs font-bold text-[#f6ba86] active:scale-[0.97]"
                      >
                        {delta > 0 ? `+${Math.round(delta * 100)}` : Math.round(delta * 100)}cm
                      </button>
                    );
                  })}
                </>
              )}

              {(selected.kind === "furniture" || selected.kind === "hvac" || selected.kind === "light" || selected.kind === "opening") && (
                <button
                  type="button"
                  onClick={() => setMobileMoveEntityArmed(!mobileMoveEntityArmed)}
                  aria-pressed={mobileMoveEntityArmed}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-xs font-semibold",
                    mobileMoveEntityArmed ? "bg-primary text-primary-foreground" : "bg-white/[0.08] text-foreground",
                  )}
                >
                  <Move className="h-4 w-4" />
                  <span>{mobileMoveEntityArmed ? "Geser Aktif" : "Geser"}</span>
                </button>
              )}

              {(selected.kind === "furniture" || selected.kind === "hvac" || selected.kind === "light") && (
                <>
                  <button
                    type="button"
                    onClick={() => onRotateSelected(1)}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-xs font-semibold text-foreground"
                  >
                    <RotateCw className="h-4 w-4 text-primary" />
                    <span>Putar</span>
                  </button>
                  <button
                    type="button"
                    onClick={onDuplicateSelected}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-xs font-semibold text-foreground"
                  >
                    <Copy className="h-4 w-4" />
                    <span>Salin</span>
                  </button>
                </>
              )}

              {selected.kind === "furniture" && (
                <button
                  type="button"
                  onClick={() => setSwatchSheetOpen(true)}
                  className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-xs font-semibold text-foreground"
                >
                  <Palette className="h-4 w-4 text-amber-300" />
                  <span>Warna</span>
                </button>
              )}

              {(selected.kind === "light" || selected.kind === "hvac") && (
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
                  className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-primary/20 px-3 text-xs font-semibold text-[#f6ba86]"
                >
                  <Power className="h-4 w-4" />
                  <span>Saklar</span>
                </button>
              )}

              {selected.kind === "opening" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const lv = selected.levelIndex as 0 | 1;
                      const w = project.levels[lv]?.walls.find((x) => x.id === selected.wallId);
                      const o = w?.openings.find((x) => x.id === selected.id);
                      if (o && w) useStudioStore.getState().updateOpening(lv, w.id, o.id, { openPct: o.openPct > 20 ? 0 : 75 });
                    }}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-200"
                  >
                    <DoorOpen className="h-4 w-4" />
                    <span>Buka</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRotateSelected(1)}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-xs font-semibold text-foreground"
                  >
                    <FlipHorizontal2 className="h-4 w-4" />
                    <span>Balik</span>
                  </button>
                </>
              )}

              {selected.kind === "room" && (
                <button
                  type="button"
                  onClick={() => setRoomSheetOpen(true)}
                  className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-xs font-semibold text-foreground"
                >
                  <Pencil className="h-4 w-4 text-primary" />
                  <span>Ubah Ruang</span>
                </button>
              )}

              <button
                type="button"
                onClick={onDeleteSelected}
                className="ml-auto flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-rose-500/20 px-3 text-xs font-semibold text-rose-200"
              >
                <Trash2 className="h-4 w-4" />
                <span>Hapus</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. CATALOG DRAGGABLE BOTTOM SHEET (Auto-closes on item select) */}
      <MobileBottomSheet
        open={mobileCatalogOpen}
        onClose={() => setMobileCatalogOpen(false)}
        title="Katalog Bangunan & Interior"
        subtitle="Pilih item untuk langsung pratinjau di 3D"
        defaultSnap="full"
        modalBackdrop
        headerExtra={
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari dinding, pintu, sofa, AC, lampu..."
                className="min-h-11 w-full rounded-xl border border-white/15 bg-black/35 pl-9 pr-10 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Hapus pencarian"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 flex min-h-9 min-w-9 -translate-y-1/2 items-center justify-center text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
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
                      "min-h-11 shrink-0 rounded-xl px-3.5 text-xs font-semibold transition",
                      active ? "bg-[#f2efe8] text-[#14171c]" : "bg-white/[0.06] text-muted-foreground",
                    )}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>
        }
      >
        <div className="space-y-3 p-3.5 pb-8">
          {/* Furniture subcategories */}
          {activeCategory === "furniture" && !query.trim() && (
            <div className="flex flex-wrap gap-1.5">
              {FURNITURE_SUBCATS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setActiveFurnitureSubcat(sc.id)}
                  className={cn(
                    "min-h-10 rounded-xl px-3 text-xs font-semibold transition",
                    activeFurnitureSubcat === sc.id ? "bg-primary text-primary-foreground" : "bg-white/[0.06] text-muted-foreground",
                  )}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          )}

          {/* Large 44px Steppers for Roof & Peil */}
          {activeCategory === "build" && !query.trim() && (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/25 p-3">
              <span className="text-xs font-semibold text-foreground">Peil Lantai 1</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    useStudioStore.getState().patchPeil({
                      floor1PeilM: Math.max(PEIL_FLOOR1_MIN_M, Number((project.site.peil.floor1PeilM - 0.1).toFixed(2))),
                    })
                  }
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/10 text-base font-bold text-foreground"
                >
                  -
                </button>
                <span className="min-w-16 text-center font-mono text-sm font-bold text-primary tabular-nums">
                  +{project.site.peil.floor1PeilM.toFixed(2)}m
                </span>
                <button
                  type="button"
                  onClick={() =>
                    useStudioStore.getState().patchPeil({
                      floor1PeilM: Math.min(PEIL_FLOOR1_MAX_M, Number((project.site.peil.floor1PeilM + 0.1).toFixed(2))),
                    })
                  }
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/10 text-base font-bold text-foreground"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {activeCategory === "stairs_roof" && !query.trim() && (
            <div className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">Kemiringan Atap</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      useStudioStore.getState().patchSystems({ roofSlopeDeg: Math.max(5, project.systems.roofSlopeDeg - 2) })
                    }
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/10 text-base font-bold"
                  >
                    -
                  </button>
                  <span className="min-w-12 text-center font-mono text-sm font-bold">{project.systems.roofSlopeDeg}°</span>
                  <button
                    type="button"
                    onClick={() =>
                      useStudioStore.getState().patchSystems({ roofSlopeDeg: Math.min(45, project.systems.roofSlopeDeg + 2) })
                    }
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/10 text-base font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">Tritisan Depan</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      useStudioStore.getState().patchSystems({
                        overhangFrontM: Math.max(0.2, Number((project.systems.overhangFrontM - 0.1).toFixed(2))),
                      })
                    }
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/10 text-base font-bold"
                  >
                    -
                  </button>
                  <span className="min-w-12 text-center font-mono text-sm font-bold">{project.systems.overhangFrontM.toFixed(1)}m</span>
                  <button
                    type="button"
                    onClick={() =>
                      useStudioStore.getState().patchSystems({
                        overhangFrontM: Math.min(1.5, Number((project.systems.overhangFrontM + 0.1).toFixed(2))),
                      })
                    }
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/10 text-base font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs font-medium text-muted-foreground">Warna Atap:</span>
                {ROOF_SWATCHES.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    aria-label={sw.name}
                    onClick={() => useStudioStore.getState().patchSimulation({ roofColorHex: sw.hex })}
                    className={cn(
                      "h-9 w-9 rounded-full border-2",
                      project.simulation.roofColorHex === sw.hex ? "border-primary ring-2 ring-primary/40" : "border-white/30",
                    )}
                    style={{ backgroundColor: sw.hex }}
                  />
                ))}
              </div>
            </div>
          )}

          {activeCategory === "walls" && !query.trim() && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-3">
              <span className="text-xs font-semibold text-foreground">Cat Fasad Global:</span>
              {PAINT_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  aria-label={sw.name}
                  onClick={() => useStudioStore.getState().patchSimulation({ paintExtHex: sw.hex })}
                  className={cn(
                    "h-9 w-9 rounded-full border-2",
                    project.simulation.paintExtHex === sw.hex ? "border-primary ring-2 ring-primary/40" : "border-white/30",
                  )}
                  style={{ backgroundColor: sw.hex }}
                />
              ))}
            </div>
          )}

          {/* Catalog Items Grid */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {filteredItems.map((item) => {
              const active = selectedCatalogId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    selectCatalogItem(item);
                    setMobileCatalogOpen(false);
                    simsAudio.play("select");
                  }}
                  className={cn(
                    "flex min-h-20 flex-col justify-between gap-1.5 rounded-2xl border p-3 text-left transition active:scale-[0.98]",
                    active ? "border-primary/70 bg-primary/15" : "border-white/10 bg-black/25",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="h-6 w-6 shrink-0 rounded-lg border border-white/25"
                      style={{ backgroundColor: item.swatchHex }}
                    />
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground">{item.specLabel}</span>
                  </div>
                  <div>
                    <div className="line-clamp-1 text-xs font-bold text-foreground">{item.name}</div>
                    <div className="line-clamp-1 text-[10.5px] text-muted-foreground">{item.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredItems.length === 0 && (
            <div className="py-10 text-center text-xs text-muted-foreground">
              Tidak ada item untuk &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
      </MobileBottomSheet>

      {/* 7. OPTIONS / VIEW CUBE / LAYERS BOTTOM SHEET */}
      <MobileBottomSheet
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Kamera, Lapisan & Opsi"
        defaultSnap="half"
        modalBackdrop
      >
        <div className="space-y-4 p-4 pb-8">
          {/* Camera View Cube */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sudut Kamera</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ["3d", "3/4 Isometrik"],
                ["top", "Tampak Atas"],
                ["front", "Depan"],
                ["side", "Samping"],
                ["back", "Belakang"],
                ["foundation", "Pondasi"],
              ] as [CameraPreset, string][]).map(([preset, lbl]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    if (preset === "foundation") onFocusFoundation();
                    else onCameraPreset(preset);
                    setOptionsOpen(false);
                  }}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] px-2 text-xs font-semibold text-foreground active:bg-primary/20"
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2 pt-1">
              <button
                type="button"
                onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(-1)}
                className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/25 text-xs font-semibold"
              >
                <RotateCcw className="h-3.5 w-3.5" /> 90°
              </button>
              <button
                type="button"
                onClick={() => sceneRef.current?.cameraCtrl.rotateQuarter(1)}
                className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-white/10 bg-black/25 text-xs font-semibold"
              >
                <RotateCw className="h-3.5 w-3.5" /> 90°
              </button>
              <button
                type="button"
                onClick={() => patchView({ ortho: !view.ortho })}
                className={cn(
                  "flex min-h-11 items-center justify-center rounded-xl border text-xs font-semibold",
                  view.ortho ? "border-primary bg-primary/20 text-[#f6ba86]" : "border-white/10 bg-black/25 text-foreground",
                )}
              >
                {view.ortho ? "Orto" : "Persp"}
              </button>
              <button
                type="button"
                onClick={() => sceneRef.current?.cameraCtrl.resetOverview()}
                className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-black/25 text-xs font-semibold"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Wall & Roof Visibility */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Potongan Dinding &amp; Atap</div>
            <div className="grid grid-cols-3 gap-2">
              {WALL_MODES.map((wm) => (
                <button
                  key={wm.id}
                  type="button"
                  onClick={() => setWallVisibility(wm.id)}
                  className={cn(
                    "min-h-11 rounded-xl border text-xs font-semibold",
                    wallVisibility === wm.id ? "border-primary bg-primary text-primary-foreground" : "border-white/10 bg-black/25 text-muted-foreground",
                  )}
                >
                  {wm.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["auto", "show", "hide"] as RoofVisibilityMode[]).map((rm) => (
                <button
                  key={rm}
                  type="button"
                  onClick={() => {
                    setRoofVisibility(rm);
                    patchView({ showRoof: rm !== "hide" });
                  }}
                  className={cn(
                    "min-h-11 rounded-xl border text-xs font-semibold",
                    roofVisibility === rm ? "border-primary/60 bg-primary/20 text-[#f6ba86]" : "border-white/10 bg-black/25 text-muted-foreground",
                  )}
                >
                  {rm === "auto" ? "Atap Auto" : rm === "show" ? "Atap On" : "Atap Off"}
                </button>
              ))}
            </div>
          </div>

          {/* Time of day */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Waktu Matahari</div>
            <div className="grid grid-cols-4 gap-2">
              {TIMES_OF_DAY.map((t) => {
                const active = Math.abs(project.simulation.hourOfDay - t.hour) < 2.2;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => useStudioStore.getState().patchSimulation({ hourOfDay: t.hour })}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1 rounded-xl border text-xs font-semibold",
                      active ? "border-[#f2efe8] bg-[#f2efe8] text-[#14171c]" : "border-white/10 bg-black/25 text-muted-foreground",
                    )}
                  >
                    {t.id === "night" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3D Layers & Overlays */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Lapisan &amp; Simulasi 3D</div>
            <div className="grid grid-cols-2 gap-2">
              <LayerToggleBtn active={gridVisible} onClick={toggleGrid} icon={<Grid3x3 className="h-4 w-4" />} label="Grid 0.5m" />
              <LayerToggleBtn active={!view.showTerrain} onClick={() => patchView({ showTerrain: !view.showTerrain })} icon={<Landmark className="h-4 w-4" />} label="Sembunyi Tanah" />
              <LayerToggleBtn active={showBricksOverlay} onClick={toggleBricksOverlay} icon={<BrickWall className="h-4 w-4" />} label="Susunan Bata" />
              <LayerToggleBtn active={view.xrayRebar} onClick={() => patchView({ xrayRebar: !view.xrayRebar, showStructure: true })} icon={<Boxes className="h-4 w-4" />} label="X-Ray Besi" />
              <LayerToggleBtn active={view.explode > 0.05} onClick={() => patchView({ explode: view.explode > 0.05 ? 0 : 1 })} icon={<Box className="h-4 w-4" />} label="Bongkar 3D" />
              <LayerToggleBtn active={view.showAir} onClick={() => patchView({ showAir: !view.showAir })} icon={<Droplets className="h-4 w-4" />} label="Pipa Air" />
              <LayerToggleBtn active={view.showListrik} onClick={() => patchView({ showListrik: !view.showListrik })} icon={<SlidersHorizontal className="h-4 w-4" />} label="Kabel Listrik" />
              <LayerToggleBtn active={view.showLuxHeatmap} onClick={() => patchView({ showLuxHeatmap: !view.showLuxHeatmap })} icon={<Sun className="h-4 w-4" />} label="Heatmap Lux" />
              <LayerToggleBtn active={view.showAirParticles} onClick={() => patchView({ showAirParticles: !view.showAirParticles })} icon={<Wind className="h-4 w-4" />} label="Angin 3D" />
              <LayerToggleBtn
                active={view.showFloodWater || view.showRain}
                onClick={() => patchView({ showFloodWater: !(view.showFloodWater || view.showRain), showRain: !(view.showFloodWater || view.showRain) })}
                icon={<Droplets className="h-4 w-4" />}
                label="Banjir & Hujan"
              />
              <LayerToggleBtn active={view.showLabels} onClick={() => patchView({ showLabels: !view.showLabels })} icon={<Compass className="h-4 w-4" />} label="Label Ruang" />
              <LayerToggleBtn
                active={stageTimelineOpen || view.stage > 0}
                onClick={() => {
                  const next = !stageTimelineOpen;
                  setStageTimelineOpen(next);
                  if (!next && view.stage > 0) patchView({ stage: 0 });
                  setOptionsOpen(false);
                }}
                icon={<Layers className="h-4 w-4" />}
                label="12 Tahap Bangun"
              />
              <LayerToggleBtn
                active={neighborsVisible}
                onClick={() => {
                  const next = !neighborsVisible;
                  toggleNeighbors();
                  patchView({ showNeighbors: next });
                }}
                icon={<Layers className="h-4 w-4" />}
                label="Tembok Tetangga"
              />
              <LayerToggleBtn active={snap90Enabled} onClick={toggleSnap90} icon={<Compass className="h-4 w-4" />} label="Kunci 90°" />
            </div>
          </div>

          {/* Render Tier */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Kualitas Render</span>
              <button
                type="button"
                onClick={() => setRtLook(!rtLook)}
                className={cn(
                  "flex min-h-9 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold",
                  rtLook ? "bg-primary/20 text-[#f6ba86]" : "bg-white/[0.06] text-muted-foreground",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Sinematik {rtLook ? "ON" : "OFF"}</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
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
                    "min-h-11 rounded-xl border text-xs font-semibold",
                    renderTier === tier ? "border-[#f2efe8] bg-[#f2efe8] text-[#14171c]" : "border-white/10 bg-black/25 text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Guide & Reset */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setOptionsOpen(false);
                onOpenHelp();
              }}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] text-xs font-semibold"
            >
              <HelpCircle className="h-4 w-4 text-primary" />
              <span>Panduan Gestur</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOptionsOpen(false);
                onOpenResetLot();
              }}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/15 text-xs font-semibold text-rose-200"
            >
              <Trash2 className="h-4 w-4" />
              <span>Atur Ulang Kavling</span>
            </button>
          </div>
        </div>
      </MobileBottomSheet>

      {/* 8. ROOM EDIT SHEET (16px inputs to prevent iOS Safari zoom) */}
      <MobileBottomSheet
        open={roomSheetOpen && selected?.kind === "room"}
        onClose={() => setRoomSheetOpen(false)}
        title="Edit Ruangan"
        defaultSnap="half"
        modalBackdrop
      >
        {selected?.kind === "room" && (() => {
          const lvIdx = selected.levelIndex as 0 | 1;
          const r = project.levels[lvIdx]?.rooms.find((x) => x.id === selected.id);
          if (!r) return null;
          return (
            <div className="space-y-3 p-4 pb-8">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Nama Ruangan</span>
                <input
                  value={r.name}
                  onChange={(e) => useStudioStore.getState().updateRoom(lvIdx, r.id, { name: e.target.value })}
                  className="min-h-11 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-base text-foreground focus:border-primary focus:outline-none"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Fungsi / Program Ruang</span>
                <select
                  value={r.program}
                  onChange={(e) =>
                    useStudioStore.getState().updateRoom(lvIdx, r.id, { program: e.target.value as RoomProgram })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/15 bg-[#141820] px-3 text-base text-foreground focus:border-primary focus:outline-none"
                >
                  {ROOM_PROGRAM_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setRoomSheetOpen(false)}
                className="min-h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground"
              >
                Selesai
              </button>
            </div>
          );
        })()}
      </MobileBottomSheet>

      {/* 9. FURNITURE COLOR SWATCH SHEET */}
      <MobileBottomSheet
        open={swatchSheetOpen && selected?.kind === "furniture"}
        onClose={() => setSwatchSheetOpen(false)}
        title="Pilih Warna Furnitur"
        defaultSnap="half"
        modalBackdrop
      >
        {selected?.kind === "furniture" && (() => {
          const lv = project.levels[selected.levelIndex];
          const f = lv?.furniture.find((x) => x.id === selected.id);
          const cat = f ? UNIFIED_BUILD_CATALOG.find((c) => c.materialId === f.catalogId) : null;
          if (!f || !cat?.swatches?.length) {
            return <div className="p-4 text-xs text-muted-foreground">Tidak ada pilihan warna tambahan untuk item ini.</div>;
          }
          return (
            <div className="space-y-3 p-4 pb-8">
              <div className="flex flex-wrap gap-3">
                {cat.swatches.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    onClick={() => {
                      useStudioStore.getState().updateFurniture(selected.levelIndex as 0 | 1, f.id, { colorHex: sw.hex });
                    }}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold",
                      f.colorHex === sw.hex ? "border-primary bg-primary/20 text-foreground" : "border-white/15 bg-black/25 text-muted-foreground",
                    )}
                  >
                    <span className="h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: sw.hex }} />
                    <span>{sw.name}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  const updates = (lv?.furniture ?? [])
                    .filter((sib) => sib.catalogId === f.catalogId && sib.id !== f.id)
                    .map((sib) => ({ id: sib.id, patch: { colorHex: f.colorHex } }));
                  if (updates.length > 0) {
                    useStudioStore.getState().updateFurnitureBatch(selected.levelIndex as 0 | 1, updates);
                  }
                  toast.success(`Warna diterapkan ke seluruh ${f.name}.`);
                  setSwatchSheetOpen(false);
                }}
                className="min-h-11 w-full rounded-xl bg-white/[0.08] text-xs font-semibold text-foreground"
              >
                Terapkan ke Semua Item Sejenis
              </button>
            </div>
          );
        })()}
      </MobileBottomSheet>
    </>
  );
}

function LayerToggleBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-xs font-semibold transition",
        active ? "border-primary/60 bg-primary/20 text-[#f6ba86]" : "border-white/10 bg-black/25 text-muted-foreground",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
