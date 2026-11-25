"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import type {
  ArchitectureSystemConfig,
  BrickSpec,
  BuildPoolOverride,
  BuildTileOverride,
  FloodMitigationConfig,
  FurnitureItem,
  HvacUnit,
  LightFixture,
  Opening,
  PeilConfig,
  Project,
  RabSettings,
  Room,
  SimulationSettings,
  SoilAssumption,
  StageProgress,
  Stair,
  StructuralParams,
  Wall,
} from "@/lib/model/types";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { BRICK_PRESETS } from "@/lib/model/priceBook";
import { simsAudio } from "@/lib/audio/simsAudio";

export type WorkspaceId =
  | "build"
  | "walk"
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

export type CameraPreset = "3d" | "front" | "back" | "side" | "top";

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
  activeLevelIndex: 0 | 1;
  selected: SelectionTarget;
  view: ViewState;
  scheduleScenario: "baseline" | "accelerated" | "delayed";
  dockOpen: boolean;
  commandPaletteOpen: boolean;

  setWorkspace: (w: WorkspaceId) => void;
  setActiveLevelIndex: (idx: 0 | 1) => void;
  setSelected: (sel: SelectionTarget) => void;
  patchView: (patch: Partial<ViewState>) => void;
  toggleHiddenPart: (partId: string) => void;
  setDockOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setScheduleScenario: (s: "baseline" | "accelerated" | "delayed") => void;

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

  // Build & Design Studio mutations (tracked by Zundo undo/redo & synced across all tabs!)
  addWall: (levelIndex: 0 | 1, wall: Wall) => void;
  addRoomAndWalls: (levelIndex: 0 | 1, walls: Wall[], room?: Room) => void;
  updateWall: (levelIndex: 0 | 1, wallId: string, patch: Partial<Wall>) => void;
  deleteWall: (levelIndex: 0 | 1, wallId: string) => void;
  addOpening: (levelIndex: 0 | 1, wallId: string, opening: Opening) => void;
  updateOpening: (levelIndex: 0 | 1, wallId: string, openingId: string, patch: Partial<Opening>) => void;
  deleteOpening: (levelIndex: 0 | 1, wallId: string, openingId: string) => void;
  paintRoomFloor: (levelIndex: 0 | 1, roomId: string, floorMaterialId: string) => void;
  setFloorTileOverrides: (tiles: BuildTileOverride[]) => void;
  addStairWithCutout: (levelIndex: 0 | 1, stair: Stair, voidPolygon?: { x: number; z: number }[]) => void;
  deleteStair: (levelIndex: 0 | 1, stairId: string) => void;
  addFurniture: (levelIndex: 0 | 1, item: FurnitureItem) => void;
  updateFurniture: (levelIndex: 0 | 1, id: string, patch: Partial<FurnitureItem>) => void;
  deleteFurniture: (levelIndex: 0 | 1, id: string) => void;
  addLight: (levelIndex: 0 | 1, light: LightFixture) => void;
  updateLight: (levelIndex: 0 | 1, id: string, patch: Partial<LightFixture>) => void;
  deleteLight: (levelIndex: 0 | 1, id: string) => void;
  addHvac: (levelIndex: 0 | 1, item: HvacUnit) => void;
  updateHvac: (levelIndex: 0 | 1, id: string, patch: Partial<HvacUnit>) => void;
  deleteHvac: (levelIndex: 0 | 1, id: string) => void;
  addPool: (pool: BuildPoolOverride) => void;
  deletePool: (poolId: string) => void;
  setTerrainHeights: (heights: number[]) => void;
  resetLotClean: () => void;
}

const initialProject = createDefaultProject();

export const useStudioStore = create<StudioStore>()(
  temporal(
    immer((set) => ({
      project: initialProject,
      baselineProject: structuredClone(initialProject),
      workspace: "build",
      activeLevelIndex: 0,
      selected: null,
      view: DEFAULT_VIEW_STATE,
      scheduleScenario: "baseline",
      dockOpen: true,
      commandPaletteOpen: false,

      setWorkspace: (w) =>
        set((state) => {
          state.workspace = w;
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

      addWall: (levelIndex, wall) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.walls.push(wall);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      addRoomAndWalls: (levelIndex, walls, room) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          const dup = (a: Wall, b: Wall) =>
            (Math.hypot(a.start.x - b.start.x, a.start.z - b.start.z) < 0.08 &&
              Math.hypot(a.end.x - b.end.x, a.end.z - b.end.z) < 0.08) ||
            (Math.hypot(a.start.x - b.end.x, a.start.z - b.end.z) < 0.08 &&
              Math.hypot(a.end.x - b.start.x, a.end.z - b.start.z) < 0.08);
          for (const w of walls) {
            if (Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) < 0.1) continue;
            if (!lv.walls.some((existing) => dup(existing, w))) lv.walls.push(w);
          }
          if (room) lv.rooms.push(room);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      updateWall: (levelIndex, wallId, patch) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (w) {
            Object.assign(w, patch);
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("paint");
          }
        }),

      deleteWall: (levelIndex, wallId) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.walls = lv.walls.filter((w) => w.id !== wallId);
          if (state.selected?.kind === "wall" && state.selected.id === wallId) state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      addOpening: (levelIndex, wallId, opening) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (!w) return;
          w.openings.push(opening);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      updateOpening: (levelIndex, wallId, openingId, patch) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          const op = w?.openings.find((o) => o.id === openingId);
          if (op) {
            Object.assign(op, patch);
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("rotate");
          }
        }),

      deleteOpening: (levelIndex, wallId, openingId) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (!w) return;
          w.openings = w.openings.filter((o) => o.id !== openingId);
          if (state.selected?.kind === "opening" && state.selected.id === openingId) state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      paintRoomFloor: (levelIndex, roomId, floorMaterialId) =>
        set((state) => {
          const r = state.project.levels[levelIndex]?.rooms.find((x) => x.id === roomId);
          if (r) {
            r.floorMaterialId = floorMaterialId;
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("paint");
          }
        }),

      setFloorTileOverrides: (tiles) =>
        set((state) => {
          const curr = state.project.buildExtras ?? { floorTiles: [], pools: [], terrainHeights: [] };
          const map = new Map(curr.floorTiles.map((t) => [`${t.levelIndex}:${t.gx}:${t.gz}`, t]));
          for (const t of tiles) map.set(`${t.levelIndex}:${t.gx}:${t.gz}`, t);
          state.project.buildExtras = { ...curr, floorTiles: [...map.values()] };
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("paint");
        }),

      addStairWithCutout: (levelIndex, stair, voidPolygon) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.stairs.push(stair);
          if (voidPolygon && levelIndex === 0 && state.project.levels[1]) {
            state.project.levels[1].slabs.push({
              id: `slab-void-${stair.id}`,
              name: "Lubang Tangga",
              polygon: voidPolygon,
              thickness: 0.12,
              materialId: "void",
              isVoid: true,
            });
          }
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      deleteStair: (levelIndex, stairId) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.stairs = lv.stairs.filter((s) => s.id !== stairId);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      addFurniture: (levelIndex, item) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.furniture.push(item);
          state.selected = { kind: "furniture", id: item.id, levelIndex };
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      updateFurniture: (levelIndex, id, patch) =>
        set((state) => {
          const item = state.project.levels[levelIndex]?.furniture.find((f) => f.id === id);
          if (item) {
            Object.assign(item, patch);
            state.project.updatedAt = new Date().toISOString();
          }
        }),

      deleteFurniture: (levelIndex, id) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.furniture = lv.furniture.filter((f) => f.id !== id);
          if (state.selected?.kind === "furniture" && state.selected.id === id) state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      addLight: (levelIndex, light) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.lights.push(light);
          state.selected = { kind: "light", id: light.id, levelIndex };
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      updateLight: (levelIndex, id, patch) =>
        set((state) => {
          const item = state.project.levels[levelIndex]?.lights.find((f) => f.id === id);
          if (item) {
            Object.assign(item, patch);
            state.project.updatedAt = new Date().toISOString();
          }
        }),

      deleteLight: (levelIndex, id) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.lights = lv.lights.filter((f) => f.id !== id);
          if (state.selected?.kind === "light" && state.selected.id === id) state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      addHvac: (levelIndex, item) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.hvac.push(item);
          state.selected = { kind: "hvac", id: item.id, levelIndex };
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      updateHvac: (levelIndex, id, patch) =>
        set((state) => {
          const item = state.project.levels[levelIndex]?.hvac.find((f) => f.id === id);
          if (item) {
            Object.assign(item, patch);
            state.project.updatedAt = new Date().toISOString();
          }
        }),

      deleteHvac: (levelIndex, id) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          lv.hvac = lv.hvac.filter((f) => f.id !== id);
          if (state.selected?.kind === "hvac" && state.selected.id === id) state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      addPool: (pool) =>
        set((state) => {
          const curr = state.project.buildExtras ?? { floorTiles: [], pools: [], terrainHeights: [] };
          state.project.buildExtras = { ...curr, pools: [...curr.pools, pool] };
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      deletePool: (poolId) =>
        set((state) => {
          if (!state.project.buildExtras) return;
          state.project.buildExtras.pools = state.project.buildExtras.pools.filter((p) => p.id !== poolId);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      setTerrainHeights: (heights) =>
        set((state) => {
          const curr = state.project.buildExtras ?? { floorTiles: [], pools: [], terrainHeights: [] };
          state.project.buildExtras = { ...curr, terrainHeights: [...heights] };
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("paint");
        }),

      resetLotClean: () =>
        set((state) => {
          for (const lv of state.project.levels) {
            lv.walls = [];
            lv.rooms = [];
            lv.slabs = [];
            lv.stairs = [];
            lv.furniture = [];
            lv.lights = [];
            lv.hvac = [];
          }
          state.project.buildExtras = { floorTiles: [], pools: [], terrainHeights: [] };
          state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),
    })),
    {
      partialize: (state) => ({ project: state.project }),
      limit: 60,
    },
  ),
);
