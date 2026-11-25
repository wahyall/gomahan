"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import type {
  ArchitectureSystemConfig,
  BrickSpec,
  FloodMitigationConfig,
  FurnitureItem,
  HvacUnit,
  LightFixture,
  Opening,
  PeilConfig,
  Project,
  RabSettings,
  SimulationSettings,
  SoilAssumption,
  StageProgress,
  StructuralParams,
  Vec2,
  Wall,
} from "@/lib/model/types";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { BRICK_PRESETS } from "@/lib/model/priceBook";
import { simsAudio } from "@/lib/audio/simsAudio";

export type WorkspaceId =
  | "build"
  | "furnish"
  | "structure"
  | "lighting"
  | "airflow"
  | "flood"
  | "drawings"
  | "rab"
  | "timeline"
  | "deliver"
  | "guide"
  | "site";

export type BuildTool =
  | "select"
  | "wall"
  | "door"
  | "window"
  | "vent"
  | "furniture"
  | "light"
  | "hvac"
  | "paint"
  | "eyedropper"
  | "demolish"
  | "measure";

export type CameraPreset = "3d" | "front" | "back" | "side" | "top" | "walkthrough";

export type SelectionTarget =
  | { kind: "part"; id: string }
  | { kind: "wall"; id: string; levelIndex: number }
  | { kind: "opening"; id: string; wallId: string; levelIndex: number }
  | { kind: "furniture"; id: string; levelIndex: number }
  | { kind: "light"; id: string; levelIndex: number }
  | { kind: "hvac"; id: string; levelIndex: number }
  | null;

export interface ViewState {
  cameraPreset: CameraPreset;
  ortho: boolean;
  wireframe: boolean;
  xrayRebar: boolean;
  activeLevelView: "all" | "lt1" | "lt2_cut";
  cutH: number; // >= 100 disabled
  explode: number; // 0..1
  stage: number; // 0 = complete model, 1..10 = construction sequence
  showBricks: boolean;
  showStructure: boolean;
  showRoof: boolean;
  showRangka: boolean;
  showFinishing: boolean;
  showAir: boolean;
  showListrik: boolean;
  showLuxHeatmap: boolean;
  showAirParticles: boolean;
  showFloodWater: boolean;
  showRain: boolean;
  showLabels: boolean;
  showDims: boolean;
  showGrid: boolean;
  showNeighbors: boolean;
  hiddenParts: string[];
  beforeAfterSplit: number; // 0..1 when comparing baseline vs modified
  beforeAfterEnabled: boolean;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  cameraPreset: "3d",
  ortho: false,
  wireframe: false,
  xrayRebar: false,
  activeLevelView: "all",
  cutH: 100,
  explode: 0,
  stage: 0,
  showBricks: true,
  showStructure: true,
  showRoof: true,
  showRangka: true,
  showFinishing: true,
  showAir: false,
  showListrik: false,
  showLuxHeatmap: false,
  showAirParticles: false,
  showFloodWater: false,
  showRain: false,
  showLabels: false,
  showDims: false,
  showGrid: true,
  showNeighbors: true,
  hiddenParts: [],
  beforeAfterSplit: 0.5,
  beforeAfterEnabled: false,
};

export interface StudioStore {
  project: Project;
  baselineProject: Project;
  workspace: WorkspaceId;
  activeTool: BuildTool;
  activeLevelIndex: 0 | 1;
  selected: SelectionTarget;
  view: ViewState;
  scheduleScenario: "baseline" | "accelerated" | "delayed";
  dockOpen: boolean;
  commandPaletteOpen: boolean;
  placeTemplate: {
    furnitureCatalogId: string;
    hvacType: HvacUnit["type"];
    hvacPk?: 0.5 | 1 | 1.5 | 2;
    lightType: LightFixture["type"];
    openingWidth: number;
    openingHeight: number;
  };

  setWorkspace: (w: WorkspaceId) => void;
  setActiveTool: (t: BuildTool) => void;
  setActiveLevelIndex: (idx: 0 | 1) => void;
  setSelected: (sel: SelectionTarget) => void;
  patchView: (patch: Partial<ViewState>) => void;
  toggleHiddenPart: (partId: string) => void;
  setDockOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setScheduleScenario: (s: "baseline" | "accelerated" | "delayed") => void;
  patchPlaceTemplate: (patch: Partial<StudioStore["placeTemplate"]>) => void;

  // Project mutations (tracked by Zundo undo/redo!)
  loadProject: (p: Project) => void;
  resetProject: () => void;
  lockBaseline: () => void;
  patchSystems: (patch: Partial<ArchitectureSystemConfig>) => void;
  setBrickPreset: (preset: BrickSpec["preset"]) => void;
  patchBrickSpec: (patch: Partial<BrickSpec>) => void;
  patchPeil: (patch: Partial<PeilConfig>) => void;
  patchSoil: (patch: Partial<SoilAssumption>) => void;
  patchSiteOrientation: (deg: number) => void;
  patchFloodMitigation: (patch: Partial<FloodMitigationConfig>) => void;
  patchSimulation: (patch: Partial<SimulationSettings>) => void;
  patchRabSettings: (patch: Partial<RabSettings>) => void;
  patchStructuralParams: (patch: Partial<StructuralParams>) => void;
  updatePriceItem: (priceId: string, field: "materialPrice" | "laborPrice", value: number) => void;
  resetPriceBook: () => void;
  patchStageProgress: (stageId: string, patch: Partial<StageProgress>) => void;
  setGamificationMode: (mode: "simple" | "pro") => void;
  setBudgetCap: (capIdr: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
  toggleSiteChecklist: (key: string) => void;
  completeQuest: (questId: string) => void;

  // Direct manipulation Sims-4 editing
  addWall: (levelIndex: 0 | 1, start: Vec2, end: Vec2, exterior?: boolean) => void;
  updateWall: (levelIndex: 0 | 1, wallId: string, patch: Partial<Wall>) => void;
  deleteWall: (levelIndex: 0 | 1, wallId: string) => void;
  addOpening: (levelIndex: 0 | 1, wallId: string, opening: Opening) => void;
  updateOpening: (levelIndex: 0 | 1, wallId: string, openingId: string, patch: Partial<Opening>) => void;
  deleteOpening: (levelIndex: 0 | 1, wallId: string, openingId: string) => void;

  addFurniture: (levelIndex: 0 | 1, item: FurnitureItem) => void;
  updateFurniture: (levelIndex: 0 | 1, id: string, patch: Partial<FurnitureItem>) => void;
  deleteFurniture: (levelIndex: 0 | 1, id: string) => void;

  addLight: (levelIndex: 0 | 1, item: LightFixture) => void;
  updateLight: (levelIndex: 0 | 1, id: string, patch: Partial<LightFixture>) => void;
  deleteLight: (levelIndex: 0 | 1, id: string) => void;

  addHvac: (levelIndex: 0 | 1, item: HvacUnit) => void;
  updateHvac: (levelIndex: 0 | 1, id: string, patch: Partial<HvacUnit>) => void;
  deleteHvac: (levelIndex: 0 | 1, id: string) => void;

  moveSelectedBy: (dx: number, dz: number) => void;
  rotateSelected: (deltaRad?: number) => void;
  deleteSelected: () => void;
}

const initialProject = createDefaultProject();

export const useStudioStore = create<StudioStore>()(
  temporal(
    immer((set, get) => ({
      project: initialProject,
      baselineProject: structuredClone(initialProject),
      workspace: "build",
      activeTool: "select",
      activeLevelIndex: 0,
      selected: null,
      view: DEFAULT_VIEW_STATE,
      scheduleScenario: "baseline",
      dockOpen: true,
      commandPaletteOpen: false,
      placeTemplate: {
        furnitureCatalogId: "sofa_2",
        hvacType: "ac_split",
        hvacPk: 1,
        lightType: "ceiling",
        openingWidth: 0.9,
        openingHeight: 1.4,
      },

      setWorkspace: (w) =>
        set((state) => {
          state.workspace = w;
          // Auto-enable helpful overlays when entering simulation workspaces
          if (w === "lighting") {
            state.view.showLuxHeatmap = true;
            state.view.showAirParticles = false;
          } else if (w === "airflow") {
            state.view.showAirParticles = true;
            state.view.showLuxHeatmap = false;
          } else if (w === "flood") {
            state.view.showFloodWater = true;
            state.view.showRain = true;
            if (state.project.simulation.rainIntensityMmH === 0) {
              state.project.simulation.rainIntensityMmH = 65;
            }
            if (state.project.simulation.floodDepthCm === 0) {
              state.project.simulation.floodDepthCm = 45;
            }
          } else if (w === "structure") {
            state.view.showStructure = true;
            state.view.xrayRebar = true;
          }
        }),
      setActiveTool: (t) => set((state) => { state.activeTool = t; }),
      setActiveLevelIndex: (idx) =>
        set((state) => {
          state.activeLevelIndex = idx;
          state.view.activeLevelView = idx === 0 ? "lt1" : "all";
        }),
      setSelected: (sel) =>
        set((state) => {
          state.selected = sel;
          if (sel) simsAudio.play("select");
        }),
      patchView: (patch) =>
        set((state) => {
          Object.assign(state.view, patch);
        }),
      toggleHiddenPart: (partId) =>
        set((state) => {
          const idx = state.view.hiddenParts.indexOf(partId);
          if (idx >= 0) state.view.hiddenParts.splice(idx, 1);
          else state.view.hiddenParts.push(partId);
        }),
      setDockOpen: (open) => set((state) => { state.dockOpen = open; }),
      setCommandPaletteOpen: (open) => set((state) => { state.commandPaletteOpen = open; }),
      setScheduleScenario: (s) => set((state) => { state.scheduleScenario = s; }),
      patchPlaceTemplate: (patch) =>
        set((state) => {
          Object.assign(state.placeTemplate, patch);
        }),

      loadProject: (p) =>
        set((state) => {
          state.project = p;
          state.selected = null;
        }),
      resetProject: () =>
        set((state) => {
          const fresh = createDefaultProject();
          state.project = fresh;
          state.baselineProject = structuredClone(fresh);
          state.selected = null;
        }),
      lockBaseline: () =>
        set((state) => {
          state.baselineProject = structuredClone(state.project);
        }),

      patchSystems: (patch) =>
        set((state) => {
          Object.assign(state.project.systems, patch);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      setBrickPreset: (preset) =>
        set((state) => {
          state.project.systems.brick = { ...BRICK_PRESETS[preset] };
          // Propagate new wall thickness to walls
          const tO = state.project.systems.brick.outerThicknessMm / 1000;
          const tI = state.project.systems.brick.innerThicknessMm / 1000;
          for (const lv of state.project.levels) {
            for (const w of lv.walls) {
              w.thickness = w.exterior ? tO : tI;
            }
          }
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      patchBrickSpec: (patch) =>
        set((state) => {
          Object.assign(state.project.systems.brick, patch);
          const tO = state.project.systems.brick.outerThicknessMm / 1000;
          const tI = state.project.systems.brick.innerThicknessMm / 1000;
          for (const lv of state.project.levels) {
            for (const w of lv.walls) {
              w.thickness = w.exterior ? tO : tI;
            }
          }
          state.project.updatedAt = new Date().toISOString();
        }),

      patchPeil: (patch) =>
        set((state) => {
          Object.assign(state.project.site.peil, patch);
          state.project.updatedAt = new Date().toISOString();
        }),
      patchSoil: (patch) =>
        set((state) => {
          Object.assign(state.project.site.soil, patch);
          state.project.updatedAt = new Date().toISOString();
        }),
      patchSiteOrientation: (deg) =>
        set((state) => {
          state.project.site.orientationDeg = deg;
        }),
      patchFloodMitigation: (patch) =>
        set((state) => {
          Object.assign(state.project.floodMitigation, patch);
          // Sync physical MEP outlet heights in LT1
          if (patch.outletHeightM !== undefined) {
            for (const pt of state.project.levels[0]!.mepPoints) {
              if (pt.kind === "stopkontak") pt.y = Math.max(pt.y, patch.outletHeightM);
            }
          }
          if (patch.mcbHeightM !== undefined) {
            for (const pt of state.project.levels[0]!.mepPoints) {
              if (pt.kind === "panel_mcb") pt.y = patch.mcbHeightM;
            }
          }
          simsAudio.play("place");
        }),
      patchSimulation: (patch) =>
        set((state) => {
          Object.assign(state.project.simulation, patch);
          if (patch.rainIntensityMmH !== undefined) {
            state.view.showRain = patch.rainIntensityMmH > 0;
          }
          if (patch.floodDepthCm !== undefined) {
            state.view.showFloodWater = patch.floodDepthCm > 0;
          }
        }),
      patchRabSettings: (patch) =>
        set((state) => {
          Object.assign(state.project.rabSettings, patch);
        }),
      patchStructuralParams: (patch) =>
        set((state) => {
          Object.assign(state.project.structuralParams, patch);
        }),
      updatePriceItem: (priceId, field, value) =>
        set((state) => {
          const item = state.project.priceBook.items[priceId];
          if (item) {
            item[field] = Math.max(0, value);
            state.project.updatedAt = new Date().toISOString();
          }
        }),
      resetPriceBook: () =>
        set((state) => {
          state.project.priceBook = createDefaultProject().priceBook;
        }),
      patchStageProgress: (stageId, patch) =>
        set((state) => {
          const curr = state.project.stageProgress[stageId] ?? { progressPct: 0, actualCost: 0 };
          state.project.stageProgress[stageId] = { ...curr, ...patch };
        }),
      setGamificationMode: (mode) =>
        set((state) => {
          state.project.gamification.mode = mode;
        }),
      setBudgetCap: (capIdr) =>
        set((state) => {
          state.project.gamification.budgetCapIdr = Math.max(50_000_000, capIdr);
        }),
      setSoundEnabled: (enabled) => {
        simsAudio.setEnabled(enabled);
        set((state) => {
          state.project.gamification.soundEnabled = enabled;
        });
      },
      toggleSiteChecklist: (key) =>
        set((state) => {
          const curr = Boolean(state.project.gamification.siteChecklistDone[key]);
          state.project.gamification.siteChecklistDone[key] = !curr;
        }),
      completeQuest: (questId) =>
        set((state) => {
          if (!state.project.gamification.completedQuests.includes(questId)) {
            state.project.gamification.completedQuests.push(questId);
            simsAudio.play("quest");
          }
        }),

      addWall: (levelIndex, start, end, exterior = false) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          const id = `w-${Date.now().toString(36)}`;
          const t = exterior
            ? state.project.systems.brick.outerThicknessMm / 1000
            : state.project.systems.brick.innerThicknessMm / 1000;
          lv.walls.push({
            id,
            name: exterior ? "Dinding Luar Baru" : "Sekat Ruangan Baru",
            start: { x: Math.round(start.x * 10) / 10, z: Math.round(start.z * 10) / 10 },
            end: { x: Math.round(end.x * 10) / 10, z: Math.round(end.z * 10) / 10 },
            thickness: t,
            height: lv.height,
            materialId: exterior ? "wall_ext_ivory" : "wall_int_ivory",
            exterior,
            openings: [],
          });
          state.selected = { kind: "wall", id, levelIndex };
          simsAudio.play("place");
        }),

      updateWall: (levelIndex, wallId, patch) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (w) Object.assign(w, patch);
        }),

      deleteWall: (levelIndex, wallId) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.walls = lv.walls.filter((w) => w.id !== wallId);
          if (state.selected?.kind === "wall" && state.selected.id === wallId) state.selected = null;
          simsAudio.play("demolish");
        }),

      addOpening: (levelIndex, wallId, opening) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (!w) return;
          w.openings.push(opening);
          state.selected = { kind: "opening", id: opening.id, wallId, levelIndex };
          simsAudio.play("place");
        }),

      updateOpening: (levelIndex, wallId, openingId, patch) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          const op = w?.openings.find((o) => o.id === openingId);
          if (op) Object.assign(op, patch);
        }),

      deleteOpening: (levelIndex, wallId, openingId) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (!w) return;
          w.openings = w.openings.filter((o) => o.id !== openingId);
          if (state.selected?.kind === "opening" && state.selected.id === openingId) state.selected = null;
          simsAudio.play("demolish");
        }),

      addFurniture: (levelIndex, item) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.furniture.push(item);
          state.selected = { kind: "furniture", id: item.id, levelIndex };
          simsAudio.play("place");
        }),

      updateFurniture: (levelIndex, id, patch) =>
        set((state) => {
          const item = state.project.levels[levelIndex]?.furniture.find((f) => f.id === id);
          if (item) Object.assign(item, patch);
        }),

      deleteFurniture: (levelIndex, id) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.furniture = lv.furniture.filter((f) => f.id !== id);
          if (state.selected?.kind === "furniture" && state.selected.id === id) state.selected = null;
          simsAudio.play("demolish");
        }),

      addLight: (levelIndex, item) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.lights.push(item);
          state.selected = { kind: "light", id: item.id, levelIndex };
          simsAudio.play("place");
        }),

      updateLight: (levelIndex, id, patch) =>
        set((state) => {
          const item = state.project.levels[levelIndex]?.lights.find((f) => f.id === id);
          if (item) Object.assign(item, patch);
        }),

      deleteLight: (levelIndex, id) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.lights = lv.lights.filter((f) => f.id !== id);
          if (state.selected?.kind === "light" && state.selected.id === id) state.selected = null;
          simsAudio.play("demolish");
        }),

      addHvac: (levelIndex, item) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.hvac.push(item);
          state.selected = { kind: "hvac", id: item.id, levelIndex };
          simsAudio.play("place");
        }),

      updateHvac: (levelIndex, id, patch) =>
        set((state) => {
          const item = state.project.levels[levelIndex]?.hvac.find((f) => f.id === id);
          if (item) Object.assign(item, patch);
        }),

      deleteHvac: (levelIndex, id) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.hvac = lv.hvac.filter((f) => f.id !== id);
          if (state.selected?.kind === "hvac" && state.selected.id === id) state.selected = null;
          simsAudio.play("demolish");
        }),

      moveSelectedBy: (dx, dz) =>
        set((state) => {
          const sel = state.selected;
          if (!sel || sel.kind === "part") return;
          const lv = state.project.levels[sel.levelIndex];
          if (!lv) return;
          const clampX = (x: number) => Math.max(0.35, Math.min(state.project.site.width - 0.35, Math.round(x * 20) / 20));
          const clampZ = (z: number) => Math.max(0.35, Math.min(state.project.site.depth - 0.35, Math.round(z * 20) / 20));

          if (sel.kind === "furniture") {
            const it = lv.furniture.find((f) => f.id === sel.id);
            if (it) {
              it.position.x = clampX(it.position.x + dx);
              it.position.z = clampZ(it.position.z + dz);
            }
          } else if (sel.kind === "light") {
            const it = lv.lights.find((l) => l.id === sel.id);
            if (it) {
              it.position.x = clampX(it.position.x + dx);
              it.position.z = clampZ(it.position.z + dz);
            }
          } else if (sel.kind === "hvac") {
            const it = lv.hvac.find((h) => h.id === sel.id);
            if (it) {
              it.position.x = clampX(it.position.x + dx);
              it.position.z = clampZ(it.position.z + dz);
            }
          } else if (sel.kind === "wall") {
            const w = lv.walls.find((x) => x.id === sel.id);
            if (w && !w.partyWallSide) {
              w.start.x = clampX(w.start.x + dx);
              w.start.z = clampZ(w.start.z + dz);
              w.end.x = clampX(w.end.x + dx);
              w.end.z = clampZ(w.end.z + dz);
            }
          } else if (sel.kind === "opening") {
            const w = lv.walls.find((x) => x.id === sel.wallId);
            const op = w?.openings.find((o) => o.id === sel.id);
            if (w && op) {
              const wLen = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
              const delta = Math.abs(w.end.x - w.start.x) > Math.abs(w.end.z - w.start.z) ? dx : dz;
              op.offset = Math.max(op.width * 0.5 + 0.05, Math.min(wLen - op.width * 0.5 - 0.05, op.offset + delta));
            }
          }
          simsAudio.play("rotate");
        }),

      rotateSelected: (deltaRad = Math.PI / 4) =>
        set((state) => {
          const sel = state.selected;
          if (!sel || sel.kind === "part") return;
          const lv = state.project.levels[sel.levelIndex];
          if (!lv) return;
          if (sel.kind === "furniture") {
            const it = lv.furniture.find((f) => f.id === sel.id);
            if (it) it.rotationY = (it.rotationY + deltaRad) % (Math.PI * 2);
          } else if (sel.kind === "hvac") {
            const it = lv.hvac.find((h) => h.id === sel.id);
            if (it) it.rotationY = (it.rotationY + deltaRad) % (Math.PI * 2);
          } else if (sel.kind === "opening") {
            const w = lv.walls.find((x) => x.id === sel.wallId);
            const op = w?.openings.find((o) => o.id === sel.id);
            if (op) op.swing = op.swing === 1 ? -1 : 1;
          }
          simsAudio.play("rotate");
        }),

      deleteSelected: () => {
        const { selected, deleteWall, deleteOpening, deleteFurniture, deleteLight, deleteHvac } = get();
        if (!selected || selected.kind === "part") return;
        if (selected.kind === "wall") deleteWall(selected.levelIndex as 0 | 1, selected.id);
        else if (selected.kind === "opening") deleteOpening(selected.levelIndex as 0 | 1, selected.wallId, selected.id);
        else if (selected.kind === "furniture") deleteFurniture(selected.levelIndex as 0 | 1, selected.id);
        else if (selected.kind === "light") deleteLight(selected.levelIndex as 0 | 1, selected.id);
        else if (selected.kind === "hvac") deleteHvac(selected.levelIndex as 0 | 1, selected.id);
      },
    })),
    {
      partialize: (state) => ({ project: state.project }),
      limit: 60,
    },
  ),
);
