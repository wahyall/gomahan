import { create } from "zustand";
import { UNIFIED_BUILD_CATALOG } from "@/features/buildMode/projectCatalog";
import type {
  BuildCameraSnapshot,
  BuildCatalogEntry,
  BuildCategoryId,
  BuildToolId,
  RoofVisibilityMode,
  WallVisibilityMode,
} from "@/features/buildMode/types";
import type { BuildSceneStats } from "@/features/buildMode/BuildScene";
import type { RoofType } from "@/lib/model/types";

export interface BuildHoverState {
  gx: number;
  gz: number;
  worldX: number;
  worldZ: number;
  inBounds: boolean;
}

export interface BuildPreviewHud {
  label: string;
  valid: boolean;
}

export type FloorBrushMode = "tile" | "rect" | "fill";
export type TerrainBrushMode = "raise" | "lower" | "flatten";
export type WallPaintMode = "side" | "room";
export type FurnitureSubcategory = "all" | "living" | "bedroom" | "kitchen" | "bath" | "outdoor";
export type BuildRenderTier = "auto" | "high" | "medium" | "low";
export type MobileDrawMode = "draw" | "orbit";

const POINT_PLACEMENT_TOOLS = new Set<BuildToolId>([
  "opening",
  "stair",
  "furniture",
  "hvac",
  "light",
]);

const INTERIOR_TOOLS = new Set<BuildToolId>([
  "wall_straight",
  "wall_room",
  "wall_diagonal",
  "wall_paint",
  "fence",
  "floor_tile",
  "opening",
  "stair",
  "pool",
  "furniture",
  "hvac",
  "light",
]);

interface BuildModeViewState {
  activeLevel: 0 | 1 | 2;
  wallVisibility: WallVisibilityMode;
  roofVisibility: RoofVisibilityMode;
  gridVisible: boolean;
  snap90Enabled: boolean;
  edgeScrollEnabled: boolean;
  neighborsVisible: boolean;
  showBricksOverlay: boolean;
  activeCategory: BuildCategoryId;
  activeTool: BuildToolId;
  selectedCatalogId: string;
  selectedSwatchHex: string | null;
  activeFurnitureSubcat: FurnitureSubcategory;
  floorBrushMode: FloorBrushMode;
  terrainBrushMode: TerrainBrushMode;
  wallPaintMode: WallPaintMode;
  placementRotationStep: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  placementFlipSwing: 1 | -1;
  pendingRoofType: RoofType | null;
  freePlacementEnabled: boolean;
  multiPlaceEnabled: boolean;
  mobileDrawMode: MobileDrawMode;
  mobilePlacementActive: boolean;
  mobileMoveEntityArmed: boolean;
  mobileCatalogOpen: boolean;
  hover: BuildHoverState | null;
  previewHud: BuildPreviewHud | null;
  stats: BuildSceneStats | null;
  savedCameraSnapshot: BuildCameraSnapshot | null;
  /** Cinematic ray-traced-look post stack (Baked AO + sun shafts + bloom + MSAA HDR). */
  rtLook: boolean;
  renderTier: BuildRenderTier;

  setRtLook: (enabled: boolean) => void;
  setRenderTier: (tier: BuildRenderTier) => void;

  setActiveLevel: (level: 0 | 1 | 2) => void;
  stepLevel: (delta: -1 | 1) => void;
  setWallVisibility: (mode: WallVisibilityMode) => void;
  cycleWallVisibility: () => void;
  setRoofVisibility: (mode: RoofVisibilityMode) => void;
  toggleGrid: () => void;
  toggleSnap90: () => void;
  toggleEdgeScroll: () => void;
  toggleNeighbors: () => void;
  toggleBricksOverlay: () => void;
  setCategory: (category: BuildCategoryId) => void;
  selectCatalogItem: (item: BuildCatalogEntry) => void;
  selectCatalogById: (id: string, swatchHex?: string | null) => void;
  setSelectedSwatchHex: (hex: string | null) => void;
  setActiveFurnitureSubcat: (sub: FurnitureSubcategory) => void;
  setFloorBrushMode: (mode: FloorBrushMode) => void;
  setTerrainBrushMode: (mode: TerrainBrushMode) => void;
  setWallPaintMode: (mode: WallPaintMode) => void;
  rotatePlacementStep: (delta: -1 | 1) => void;
  togglePlacementFlipSwing: () => void;
  setPendingRoofType: (roofType: RoofType | null) => void;
  toggleFreePlacement: () => void;
  setFreePlacementEnabled: (enabled: boolean) => void;
  toggleMultiPlace: () => void;
  setMultiPlaceEnabled: (enabled: boolean) => void;
  setMobileDrawMode: (mode: MobileDrawMode) => void;
  setMobilePlacementActive: (active: boolean) => void;
  setMobileMoveEntityArmed: (armed: boolean) => void;
  setMobileCatalogOpen: (open: boolean) => void;
  setHover: (hover: BuildHoverState | null) => void;
  setPreviewHud: (hud: BuildPreviewHud | null) => void;
  setStats: (stats: BuildSceneStats | null) => void;
  saveCameraSnapshot: (snap: BuildCameraSnapshot) => void;
}

export const useBuildModeStore = create<BuildModeViewState>((set, get) => ({
  activeLevel: 0,
  wallVisibility: "cutaway",
  roofVisibility: "auto",
  gridVisible: true,
  snap90Enabled: false,
  edgeScrollEnabled: false,
  neighborsVisible: true,
  showBricksOverlay: false,
  activeCategory: "build",
  activeTool: "select",
  selectedCatalogId: UNIFIED_BUILD_CATALOG[0]!.id,
  selectedSwatchHex: null,
  activeFurnitureSubcat: "all",
  floorBrushMode: "fill",
  terrainBrushMode: "raise",
  wallPaintMode: "side",
  placementRotationStep: 0,
  placementFlipSwing: 1,
  pendingRoofType: null,
  freePlacementEnabled: false,
  multiPlaceEnabled: false,
  mobileDrawMode: "draw",
  mobilePlacementActive: false,
  mobileMoveEntityArmed: false,
  mobileCatalogOpen: false,
  hover: null,
  previewHud: null,
  stats: null,
  savedCameraSnapshot: null,
  rtLook: true,
  renderTier: "auto",

  setRtLook: (rtLook) => set({ rtLook }),
  setRenderTier: (renderTier) => set({ renderTier }),

  setActiveLevel: (activeLevel) => set({ activeLevel }),
  stepLevel: (delta) => {
    const next = Math.max(0, Math.min(2, get().activeLevel + delta)) as 0 | 1 | 2;
    set({ activeLevel: next });
  },
  setWallVisibility: (wallVisibility) => set({ wallVisibility }),
  cycleWallVisibility: () => {
    const order: WallVisibilityMode[] = ["up", "cutaway", "down"];
    const next = order[(order.indexOf(get().wallVisibility) + 1) % order.length]!;
    set({ wallVisibility: next });
  },
  setRoofVisibility: (roofVisibility) => set({ roofVisibility }),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  toggleSnap90: () => set((s) => ({ snap90Enabled: !s.snap90Enabled })),
  toggleEdgeScroll: () => set((s) => ({ edgeScrollEnabled: !s.edgeScrollEnabled })),
  toggleNeighbors: () => set((s) => ({ neighborsVisible: !s.neighborsVisible })),
  toggleBricksOverlay: () => set((s) => ({ showBricksOverlay: !s.showBricksOverlay })),

  // Clicking a category tab only shows its catalog items without mutating activeTool (BM-15)
  setCategory: (activeCategory) =>
    set({
      activeCategory,
      pendingRoofType: null,
      previewHud: null,
    }),

  selectCatalogItem: (item) =>
    set((s) => {
      let nextLevel = s.activeLevel;
      if (s.activeLevel === 2 && INTERIOR_TOOLS.has(item.toolId)) {
        nextLevel = item.toolId === "pool" || item.toolId === "stair" ? 0 : 1;
      } else if (item.toolId === "pool" || item.toolId === "stair") {
        nextLevel = 0;
      }
      return {
        activeLevel: nextLevel,
        selectedCatalogId: item.id,
        activeTool: item.toolId,
        activeCategory: item.category,
        selectedSwatchHex: item.swatches?.[0]?.hex ?? null,
        pendingRoofType: item.toolId === "roof" ? (item.roofType ?? null) : null,
        mobilePlacementActive: POINT_PLACEMENT_TOOLS.has(item.toolId),
        mobileDrawMode: "draw",
        mobileMoveEntityArmed: false,
        previewHud: null,
      };
    }),

  selectCatalogById: (id, swatchHex) => {
    const found = UNIFIED_BUILD_CATALOG.find((c) => c.id === id);
    if (!found) return;
    set((s) => {
      let nextLevel = s.activeLevel;
      if (s.activeLevel === 2 && INTERIOR_TOOLS.has(found.toolId)) {
        nextLevel = found.toolId === "pool" || found.toolId === "stair" ? 0 : 1;
      } else if (found.toolId === "pool" || found.toolId === "stair") {
        nextLevel = 0;
      }
      return {
        activeLevel: nextLevel,
        selectedCatalogId: found.id,
        activeTool: found.toolId,
        activeCategory: found.category,
        selectedSwatchHex: swatchHex !== undefined ? swatchHex : (found.swatches?.[0]?.hex ?? null),
        pendingRoofType: found.toolId === "roof" ? (found.roofType ?? null) : null,
        mobilePlacementActive: POINT_PLACEMENT_TOOLS.has(found.toolId),
        mobileDrawMode: "draw",
        mobileMoveEntityArmed: false,
        previewHud: null,
      };
    });
  },

  setSelectedSwatchHex: (selectedSwatchHex) => set({ selectedSwatchHex }),
  setActiveFurnitureSubcat: (activeFurnitureSubcat) => set({ activeFurnitureSubcat }),
  setFloorBrushMode: (floorBrushMode) => set({ floorBrushMode }),
  setTerrainBrushMode: (terrainBrushMode) => set({ terrainBrushMode }),
  setWallPaintMode: (wallPaintMode) => set({ wallPaintMode }),
  rotatePlacementStep: (delta) =>
    set((s) => ({
      placementRotationStep: (((s.placementRotationStep + delta + 8) % 8) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7),
    })),
  togglePlacementFlipSwing: () =>
    set((s) => ({
      placementFlipSwing: s.placementFlipSwing === 1 ? -1 : 1,
    })),
  setPendingRoofType: (pendingRoofType) => set({ pendingRoofType }),
  toggleFreePlacement: () => set((s) => ({ freePlacementEnabled: !s.freePlacementEnabled })),
  setFreePlacementEnabled: (freePlacementEnabled) => set({ freePlacementEnabled }),
  toggleMultiPlace: () => set((s) => ({ multiPlaceEnabled: !s.multiPlaceEnabled })),
  setMultiPlaceEnabled: (multiPlaceEnabled) => set({ multiPlaceEnabled }),
  setMobileDrawMode: (mobileDrawMode) => set({ mobileDrawMode }),
  setMobilePlacementActive: (mobilePlacementActive) => set({ mobilePlacementActive }),
  setMobileMoveEntityArmed: (mobileMoveEntityArmed) => set({ mobileMoveEntityArmed }),
  setMobileCatalogOpen: (mobileCatalogOpen) => set({ mobileCatalogOpen }),

  setHover: (hover) =>
    set((s) => {
      if (
        s.hover?.gx === hover?.gx &&
        s.hover?.gz === hover?.gz &&
        s.hover?.inBounds === hover?.inBounds
      ) {
        return s;
      }
      return { hover };
    }),
  setPreviewHud: (previewHud) =>
    set((s) => {
      if (
        s.previewHud?.label === previewHud?.label &&
        s.previewHud?.valid === previewHud?.valid
      ) {
        return s;
      }
      return { previewHud };
    }),
  setStats: (stats) =>
    set((s) => {
      if (
        s.stats?.fps === stats?.fps &&
        s.stats?.tier === stats?.tier &&
        s.stats?.calls === stats?.calls &&
        s.stats?.dpr === stats?.dpr
      ) {
        return s;
      }
      return { stats };
    }),
  saveCameraSnapshot: (savedCameraSnapshot) => set({ savedCameraSnapshot }),
}));
