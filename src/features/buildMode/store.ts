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
  floorBrushMode: FloorBrushMode;
  terrainBrushMode: TerrainBrushMode;
  placementRotationQuarter: 0 | 1 | 2 | 3;
  hover: BuildHoverState | null;
  previewHud: BuildPreviewHud | null;
  savedCameraSnapshot: BuildCameraSnapshot | null;

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
  selectCatalogById: (id: string) => void;
  setFloorBrushMode: (mode: FloorBrushMode) => void;
  setTerrainBrushMode: (mode: TerrainBrushMode) => void;
  rotatePlacementQuarter: (delta: -1 | 1) => void;
  setHover: (hover: BuildHoverState | null) => void;
  setPreviewHud: (hud: BuildPreviewHud | null) => void;
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
  floorBrushMode: "fill",
  terrainBrushMode: "raise",
  placementRotationQuarter: 0,
  hover: null,
  previewHud: null,
  savedCameraSnapshot: null,

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

  setCategory: (activeCategory) => {
    const first = UNIFIED_BUILD_CATALOG.find((c) => c.category === activeCategory);
    set({
      activeCategory,
      selectedCatalogId: first ? first.id : get().selectedCatalogId,
      activeTool: first ? first.toolId : get().activeTool,
      previewHud: null,
    });
  },

  selectCatalogItem: (item) =>
    set({
      selectedCatalogId: item.id,
      activeTool: item.toolId,
      activeCategory: item.category,
      previewHud: null,
    }),

  selectCatalogById: (id) => {
    const found = UNIFIED_BUILD_CATALOG.find((c) => c.id === id);
    if (!found) return;
    set({
      selectedCatalogId: found.id,
      activeTool: found.toolId,
      activeCategory: found.category,
      previewHud: null,
    });
  },

  setFloorBrushMode: (floorBrushMode) => set({ floorBrushMode }),
  setTerrainBrushMode: (terrainBrushMode) => set({ terrainBrushMode }),
  rotatePlacementQuarter: (delta) =>
    set((s) => ({
      placementRotationQuarter: (((s.placementRotationQuarter + delta + 4) % 4) as 0 | 1 | 2 | 3),
    })),

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
  setPreviewHud: (previewHud) => set({ previewHud }),
  saveCameraSnapshot: (savedCameraSnapshot) => set({ savedCameraSnapshot }),
}));
