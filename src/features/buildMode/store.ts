import { create } from "zustand";
import type { BuildCommand } from "@/features/buildMode/commands";
import {
  clearBuildAutosave,
  exportBuildDocumentFile,
  loadBuildAutosave,
  parseBuildDocumentJson,
  saveBuildAutosave,
} from "@/features/buildMode/saveFormat";
import {
  computeBuildCostSummary,
  createEmpty5x17Document,
  createStarter5x17HouseDocument,
  STARTER_BUILD_CATALOG,
} from "@/features/buildMode/starterLot";
import {
  cloneBuildDocument,
  type BuildCameraSnapshot,
  type BuildCatalogItem,
  type BuildCategoryId,
  type BuildCostSummary,
  type BuildDocument,
  type BuildTimeOfDay,
  type BuildToolId,
  type RoofVisibilityMode,
  type WallVisibilityMode,
} from "@/features/buildMode/types";

const MAX_HISTORY = 100;

export interface BuildHoverState {
  gx: number;
  gz: number;
  worldX: number;
  worldZ: number;
  inBounds: boolean;
}

export interface BuildSelectedEntity {
  kind: "wall" | "floor" | "opening" | "stair" | "roof" | "object";
  id: string;
  label: string;
  detail: string;
}

interface BuildModeState {
  document: BuildDocument;
  costSummary: BuildCostSummary;
  undoStack: BuildCommand[];
  redoStack: BuildCommand[];
  activeLevel: number;
  wallVisibility: WallVisibilityMode;
  roofVisibility: RoofVisibilityMode;
  timeOfDay: BuildTimeOfDay;
  gridVisible: boolean;
  snap90Enabled: boolean;
  edgeScrollEnabled: boolean;
  neighborsVisible: boolean;
  activeCategory: BuildCategoryId;
  activeTool: BuildToolId;
  selectedCatalogId: string;
  hover: BuildHoverState | null;
  selectedEntity: BuildSelectedEntity | null;
  savedCameraSnapshot: BuildCameraSnapshot | null;
  lastNotice: string | null;
  hydrated: boolean;

  // Actions
  hydrateAutosave: () => void;
  executeCommand: (cmd: BuildCommand) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setActiveLevel: (level: number) => void;
  stepLevel: (delta: -1 | 1) => void;
  setWallVisibility: (mode: WallVisibilityMode) => void;
  cycleWallVisibility: () => void;
  setRoofVisibility: (mode: RoofVisibilityMode) => void;
  setTimeOfDay: (tod: BuildTimeOfDay) => void;
  toggleGrid: () => void;
  toggleSnap90: () => void;
  toggleEdgeScroll: () => void;
  toggleNeighbors: () => void;
  setCategory: (category: BuildCategoryId) => void;
  selectCatalogItem: (item: BuildCatalogItem) => void;
  setHover: (hover: BuildHoverState | null) => void;
  setSelectedEntity: (sel: BuildSelectedEntity | null) => void;
  saveCameraSnapshot: (snap: BuildCameraSnapshot) => void;
  resetToEmptyLot: () => void;
  resetToStarterHouse: () => void;
  exportJson: () => void;
  importJsonRaw: (raw: unknown) => { ok: boolean; message: string };
  clearNotice: () => void;
}

const initialDoc = createStarter5x17HouseDocument();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(doc: BuildDocument) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveBuildAutosave(doc);
  }, 250);
}

export const useBuildModeStore = create<BuildModeState>((set, get) => ({
  document: initialDoc,
  costSummary: computeBuildCostSummary(initialDoc),
  undoStack: [],
  redoStack: [],
  activeLevel: 0,
  wallVisibility: "cutaway",
  roofVisibility: "auto",
  timeOfDay: "noon",
  gridVisible: true,
  snap90Enabled: false,
  edgeScrollEnabled: false,
  neighborsVisible: true,
  activeCategory: "build",
  activeTool: "select",
  selectedCatalogId: STARTER_BUILD_CATALOG[0]!.id,
  hover: null,
  selectedEntity: null,
  savedCameraSnapshot: null,
  lastNotice: null,
  hydrated: false,

  hydrateAutosave: () => {
    if (get().hydrated) return;
    const loaded = loadBuildAutosave();
    if (!loaded) {
      set({ hydrated: true });
      return;
    }
    if (loaded.status === "ok") {
      set({
        document: loaded.document,
        costSummary: computeBuildCostSummary(loaded.document),
        hydrated: true,
      });
      return;
    }
    if (loaded.status === "legacy_ignored") {
      set({
        hydrated: true,
        lastNotice: `Save lama (v${loaded.foundVersion}) diabaikan; memakai denah Build Mode v2.`,
      });
      return;
    }
    set({
      hydrated: true,
      lastNotice: `Autosave tidak valid diabaikan: ${loaded.reason}`,
    });
  },

  executeCommand: (cmd) => {
    const prev = get().document;
    const nextDoc = cmd.execute(prev);
    const nextUndo = [...get().undoStack, cmd];
    if (nextUndo.length > MAX_HISTORY) nextUndo.shift();
    scheduleAutosave(nextDoc);
    set({
      document: nextDoc,
      costSummary: computeBuildCostSummary(nextDoc),
      undoStack: nextUndo,
      redoStack: [],
    });
  },

  undo: () => {
    const { undoStack, redoStack, document } = get();
    if (undoStack.length === 0) return false;
    const cmd = undoStack[undoStack.length - 1]!;
    const nextDoc = cmd.undo(document);
    scheduleAutosave(nextDoc);
    set({
      document: nextDoc,
      costSummary: computeBuildCostSummary(nextDoc),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, cmd],
    });
    return true;
  },

  redo: () => {
    const { undoStack, redoStack, document } = get();
    if (redoStack.length === 0) return false;
    const cmd = redoStack[redoStack.length - 1]!;
    const nextDoc = cmd.execute(document);
    scheduleAutosave(nextDoc);
    set({
      document: nextDoc,
      costSummary: computeBuildCostSummary(nextDoc),
      undoStack: [...undoStack, cmd],
      redoStack: redoStack.slice(0, -1),
    });
    return true;
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  setActiveLevel: (level) => {
    const maxLevel = Math.max(0, get().document.levels.length - 1);
    const clamped = Math.max(0, Math.min(maxLevel, level));
    set({ activeLevel: clamped, selectedEntity: null });
  },

  stepLevel: (delta) => {
    const { activeLevel, document } = get();
    const maxLevel = Math.max(0, document.levels.length - 1);
    const next = Math.max(0, Math.min(maxLevel, activeLevel + delta));
    if (next !== activeLevel) {
      set({ activeLevel: next, selectedEntity: null });
    }
  },

  setWallVisibility: (mode) => set({ wallVisibility: mode }),
  cycleWallVisibility: () => {
    const order: WallVisibilityMode[] = ["up", "cutaway", "down"];
    const curr = get().wallVisibility;
    const next = order[(order.indexOf(curr) + 1) % order.length]!;
    set({ wallVisibility: next });
  },

  setRoofVisibility: (mode) => set({ roofVisibility: mode }),
  setTimeOfDay: (tod) => set({ timeOfDay: tod }),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
  toggleSnap90: () => set((s) => ({ snap90Enabled: !s.snap90Enabled })),
  toggleEdgeScroll: () => set((s) => ({ edgeScrollEnabled: !s.edgeScrollEnabled })),
  toggleNeighbors: () => set((s) => ({ neighborsVisible: !s.neighborsVisible })),

  setCategory: (category) => {
    const first = STARTER_BUILD_CATALOG.find((c) => c.category === category);
    set({
      activeCategory: category,
      selectedCatalogId: first ? first.id : get().selectedCatalogId,
      activeTool: first ? first.toolId : get().activeTool,
    });
  },

  selectCatalogItem: (item) =>
    set({
      selectedCatalogId: item.id,
      activeTool: item.toolId,
      activeCategory: item.category,
    }),

  setHover: (hover) => set({ hover }),
  setSelectedEntity: (selectedEntity) => set({ selectedEntity }),
  saveCameraSnapshot: (savedCameraSnapshot) => set({ savedCameraSnapshot }),

  resetToEmptyLot: () => {
    const budget = get().document.lot.budgetIdr;
    const empty = createEmpty5x17Document(budget);
    clearBuildAutosave();
    saveBuildAutosave(empty);
    set({
      document: empty,
      costSummary: computeBuildCostSummary(empty),
      undoStack: [],
      redoStack: [],
      activeLevel: 0,
      selectedEntity: null,
      lastNotice: "Kavling dikosongkan ke tanah 5×17 m bersih.",
    });
  },

  resetToStarterHouse: () => {
    const budget = get().document.lot.budgetIdr;
    const starter = createStarter5x17HouseDocument(budget);
    clearBuildAutosave();
    saveBuildAutosave(starter);
    set({
      document: starter,
      costSummary: computeBuildCostSummary(starter),
      undoStack: [],
      redoStack: [],
      activeLevel: 0,
      selectedEntity: null,
      lastNotice: "Denah Rumah 5×17 m default dimuat ulang.",
    });
  },

  exportJson: () => {
    exportBuildDocumentFile(cloneBuildDocument(get().document));
  },

  importJsonRaw: (raw) => {
    const parsed = parseBuildDocumentJson(raw);
    if (parsed.status === "legacy_ignored") {
      return {
        ok: false,
        message: `File save versi lama (v${parsed.foundVersion}) tidak kompatibel dengan Build Mode v2.`,
      };
    }
    if (parsed.status === "invalid") {
      return { ok: false, message: parsed.reason };
    }
    saveBuildAutosave(parsed.document);
    set({
      document: parsed.document,
      costSummary: computeBuildCostSummary(parsed.document),
      undoStack: [],
      redoStack: [],
      activeLevel: 0,
      selectedEntity: null,
      lastNotice: `Berhasil memuat "${parsed.document.lot.name}".`,
    });
    return { ok: true, message: "File Build Mode v2 berhasil dimuat." };
  },

  clearNotice: () => set({ lastNotice: null }),
}));
