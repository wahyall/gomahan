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
import {
  AMBIENT_TEMP_MAX_C,
  AMBIENT_TEMP_MIN_C,
  CUT_PLANE_OFF,
  FC_MAX_MPA,
  FC_MIN_MPA,
  FY_MAX_MPA,
  FY_MIN_MPA,
  MCB_HEIGHT_MAX_M,
  MCB_HEIGHT_MIN_M,
  OUTLET_HEIGHT_MAX_M,
  OUTLET_HEIGHT_MIN_M,
  PEIL_CARPORT_MAX_M,
  PEIL_CARPORT_MIN_M,
  PEIL_FLOOR1_MAX_M,
  PEIL_FLOOR1_MIN_M,
  PEIL_STREET_MAX_M,
  PEIL_STREET_MIN_M,
  PEIL_TERRACE_MAX_M,
  PEIL_TERRACE_MIN_M,
  RAIN_MAX_MM_H,
  RAIN_MIN_MM_H,
  SEISMIC_R_MAX,
  SEISMIC_R_MIN,
  WIND_SPEED_MAX_MS,
  WIND_SPEED_MIN_MS,
} from "@/lib/model/constants";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { BRICK_PRESETS } from "@/lib/model/priceBook";
import { simsAudio } from "@/lib/audio/simsAudio";
import { pointInPolygon } from "@/lib/geometry/rooms";
import { pushPullWall as applyPushPullWall, reconcileLevelTopology } from "@/features/buildMode/wallGraph";

export type WorkspaceId =
  | "build"
  | "walk"
  | "drawings"
  | "rab"
  | "timeline"
  | "deliver";

export type StudioPanelId = "none" | "structure" | "lighting" | "airflow" | "flood" | "inspection";

export type CameraPreset = "3d" | "front" | "back" | "side" | "top" | "foundation";

export type SelectionTarget =
  | { kind: "part"; id: string }
  | { kind: "wall"; id: string; levelIndex: number }
  | { kind: "opening"; id: string; wallId: string; levelIndex: number }
  | { kind: "room"; id: string; levelIndex: number }
  | { kind: "floorTile"; id: string; levelIndex: number; gx: number; gz: number }
  | { kind: "furniture"; id: string; levelIndex: number }
  | { kind: "light"; id: string; levelIndex: number }
  | { kind: "hvac"; id: string; levelIndex: number }
  | { kind: "stair"; id: string; levelIndex: number }
  | { kind: "pool"; id: string; levelIndex: 0 }
  | null;

export interface ViewState {
  cameraPreset: CameraPreset;
  ortho: boolean;
  wireframe: boolean;
  xrayRebar: boolean;
  activeLevelView: "all" | "lt1" | "lt2_cut";
  cutH: number; // >= CUT_PLANE_OFF disabled
  explode: number; // 0..1
  stage: number; // 0 = complete model, 1..12 = construction sequence
  showBricks: boolean;
  showStructure: boolean;
  showTerrain: boolean;
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
}

export const DEFAULT_VIEW_STATE: ViewState = {
  cameraPreset: "3d",
  ortho: false,
  wireframe: false,
  xrayRebar: false,
  activeLevelView: "all",
  cutH: CUT_PLANE_OFF,
  explode: 0,
  stage: 0,
  showBricks: true,
  showStructure: true,
  showTerrain: true,
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
};

function sanitizeNum(val: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

function clampOpeningsToWall(wall: Wall): void {
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
  wall.openings = wall.openings
    .filter((op) => op.width <= len - 0.04 && op.sill < wall.height - 0.1)
    .map((op) => {
      const halfW = op.width * 0.5 + 0.02;
      const offset = Math.max(halfW, Math.min(Math.max(halfW, len - halfW), op.offset));
      const maxH = Math.max(0.15, wall.height - op.sill - 0.02);
      const height = Math.min(op.height, maxH);
      return { ...op, offset, height };
    });
}

export function reconcileSelection(project: Project, selected: SelectionTarget): SelectionTarget {
  if (!selected || selected.kind === "part") return selected;
  if (selected.kind === "pool") {
    return (project.buildExtras?.pools ?? []).some((p) => p.id === selected.id) ? selected : null;
  }
  if (selected.kind === "floorTile") {
    return (project.buildExtras?.floorTiles ?? []).some(
      (t) => t.levelIndex === selected.levelIndex && t.gx === selected.gx && t.gz === selected.gz,
    )
      ? selected
      : null;
  }
  const lv = project.levels[selected.levelIndex];
  if (!lv) return null;
  switch (selected.kind) {
    case "wall":
      return lv.walls.some((w) => w.id === selected.id) ? selected : null;
    case "opening": {
      const w = lv.walls.find((x) => x.id === selected.wallId);
      return w && w.openings.some((o) => o.id === selected.id) ? selected : null;
    }
    case "room":
      return lv.rooms.some((r) => r.id === selected.id) ? selected : null;
    case "furniture":
      return lv.furniture.some((f) => f.id === selected.id) ? selected : null;
    case "light":
      return lv.lights.some((l) => l.id === selected.id) ? selected : null;
    case "hvac":
      return lv.hvac.some((h) => h.id === selected.id) ? selected : null;
    case "stair":
      return lv.stairs.some((s) => s.id === selected.id) ? selected : null;
  }
}

export interface StudioStore {
  project: Project;
  baselineProject: Project;
  workspace: WorkspaceId;
  studioPanel: StudioPanelId;
  inspectSubTab: "inspector" | "outliner";
  inspectorTab: "sistem" | "tampilan" | "validasi";
  stageTimelineOpen: boolean;
  guideOpen: boolean;
  selected: SelectionTarget;
  view: ViewState;
  scheduleScenario: "baseline" | "accelerated" | "delayed";
  commandPaletteOpen: boolean;
  soundEnabled: boolean;

  setWorkspace: (w: WorkspaceId) => void;
  setStudioPanel: (panel: StudioPanelId) => void;
  setInspectSubTab: (sub: "inspector" | "outliner") => void;
  setInspectorTab: (tab: "sistem" | "tampilan" | "validasi") => void;
  openBuildPanel: (panel: StudioPanelId) => void;
  setStageTimelineOpen: (open: boolean) => void;
  setGuideOpen: (open: boolean) => void;
  setSelected: (sel: SelectionTarget) => void;
  patchView: (patch: Partial<ViewState>) => void;
  toggleHiddenPart: (partId: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setScheduleScenario: (s: "baseline" | "accelerated" | "delayed") => void;
  setSoundEnabled: (enabled: boolean) => void;

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
  setBudgetCap: (capIdr: number) => void;
  toggleSiteChecklist: (key: string) => void;

  // Build & Design Studio mutations (tracked by Zundo undo/redo & synced across all tabs!)
  addWall: (levelIndex: 0 | 1, wall: Wall) => void;
  addRoomAndWalls: (levelIndex: 0 | 1, walls: Wall[], room?: Room) => void;
  updateWall: (levelIndex: 0 | 1, wallId: string, patch: Partial<Wall>) => void;
  pushPullWall: (levelIndex: 0 | 1, wallId: string, deltaNormalM: number, altFree?: boolean) => { ok: boolean; reason?: string };
  deleteWall: (levelIndex: 0 | 1, wallId: string) => void;
  deleteWallsBatch: (levelIndex: 0 | 1, wallIds: string[]) => void;
  updateRoom: (
    levelIndex: 0 | 1,
    roomId: string,
    patch: Partial<Pick<Room, "name" | "program" | "floorMaterialId" | "ceilingHeight">>,
  ) => void;
  deleteRoom: (levelIndex: 0 | 1, roomId: string) => void;
  paintRoomWalls: (levelIndex: 0 | 1, roomId: string, materialId: string) => void;
  addOpening: (levelIndex: 0 | 1, wallId: string, opening: Opening) => void;
  updateOpening: (levelIndex: 0 | 1, wallId: string, openingId: string, patch: Partial<Opening>) => void;
  deleteOpening: (levelIndex: 0 | 1, wallId: string, openingId: string) => void;
  paintRoomFloor: (levelIndex: 0 | 1, roomId: string, floorMaterialId: string) => void;
  setFloorTileOverrides: (tiles: BuildTileOverride[]) => void;
  deleteFloorTile: (levelIndex: 0 | 1, gx: number, gz: number) => void;
  deleteFloorTilesBatch: (tiles: { levelIndex: number; gx: number; gz: number }[]) => void;
  addStairWithCutout: (levelIndex: 0 | 1, stair: Stair, voidPolygon?: { x: number; z: number }[]) => void;
  deleteStair: (levelIndex: 0 | 1, stairId: string) => void;
  addFurniture: (levelIndex: 0 | 1, item: FurnitureItem) => void;
  updateFurniture: (levelIndex: 0 | 1, id: string, patch: Partial<FurnitureItem>) => void;
  updateFurnitureBatch: (levelIndex: 0 | 1, updates: { id: string; patch: Partial<FurnitureItem> }[]) => void;
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

function applyPanelOverlayView(view: ViewState, panel: StudioPanelId): void {
  if (panel === "lighting") {
    view.showLuxHeatmap = true;
    view.showAirParticles = false;
  } else if (panel === "airflow") {
    view.showAirParticles = true;
    view.showLuxHeatmap = false;
  } else if (panel === "flood") {
    view.showFloodWater = true;
    view.showRain = true;
  } else if (panel === "structure") {
    view.showStructure = true;
  }
}

export const useStudioStore = create<StudioStore>()(
  temporal(
    immer((set, get) => ({
      project: initialProject,
      baselineProject: structuredClone(initialProject),
      workspace: "build",
      studioPanel: "none",
      inspectSubTab: "inspector",
      inspectorTab: "sistem",
      stageTimelineOpen: false,
      guideOpen: false,
      selected: null,
      view: DEFAULT_VIEW_STATE,
      scheduleScenario: "baseline",
      commandPaletteOpen: false,
      soundEnabled: simsAudio.isEnabled(),

      setWorkspace: (w) =>
        set((state) => {
          state.workspace = w;
        }),
      setStudioPanel: (panel) =>
        set((state) => {
          state.studioPanel = panel;
          applyPanelOverlayView(state.view, panel);
        }),
      setInspectSubTab: (sub) =>
        set((state) => {
          state.inspectSubTab = sub;
        }),
      setInspectorTab: (tab) =>
        set((state) => {
          state.inspectorTab = tab;
        }),
      openBuildPanel: (panel) =>
        set((state) => {
          state.workspace = "build";
          state.studioPanel = panel;
          applyPanelOverlayView(state.view, panel);
        }),
      setStageTimelineOpen: (open) => set((state) => { state.stageTimelineOpen = open; }),
      setGuideOpen: (open) => set((state) => { state.guideOpen = open; }),
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
      setCommandPaletteOpen: (open) => set((state) => { state.commandPaletteOpen = open; }),
      setScheduleScenario: (s) => set((state) => { state.scheduleScenario = s; }),
      setSoundEnabled: (enabled) => {
        simsAudio.setEnabled(enabled);
        set((state) => {
          state.soundEnabled = enabled;
        });
      },

      loadProject: (p) => {
        set((state) => {
          state.project = p;
          state.baselineProject = structuredClone(p);
          state.selected = null;
        });
        useStudioStore.temporal.getState().clear();
      },
      resetProject: () => {
        set((state) => {
          const fresh = createDefaultProject();
          state.project = fresh;
          state.baselineProject = structuredClone(fresh);
          state.selected = null;
        });
        useStudioStore.temporal.getState().clear();
      },
      lockBaseline: () =>
        set((state) => {
          state.baselineProject = structuredClone(state.project);
        }),

      patchSystems: (patch) =>
        set((state) => {
          const sys = state.project.systems;
          Object.assign(sys, patch);
          sys.roofSlopeDeg = sanitizeNum(sys.roofSlopeDeg, 10, 2, 45);
          sys.overhangFrontM = sanitizeNum(sys.overhangFrontM, 0.8, 0, 1.5);
          sys.overhangBackM = sanitizeNum(sys.overhangBackM, 0.6, 0, 1.5);
          sys.overhangSideM = sanitizeNum(sys.overhangSideM, 0, 0, 1.0);
          sys.insulationMm = sanitizeNum(sys.insulationMm, 10, 0, 100);
          sys.gutterWidthMm = sanitizeNum(sys.gutterWidthMm, 200, 100, 350);
          sys.downspoutCount = Math.round(sanitizeNum(sys.downspoutCount, 2, 1, 8));
          sys.downspoutDiaMm = sanitizeNum(sys.downspoutDiaMm, 90, 63, 160);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      setBrickPreset: (preset) =>
        set((state) => {
          state.project.systems.brick = { ...BRICK_PRESETS[preset] };
          const tO = state.project.systems.brick.outerThicknessMm / 1000;
          const tI = state.project.systems.brick.innerThicknessMm / 1000;
          for (const lv of state.project.levels) {
            for (const w of lv.walls) {
              if (w.kind === "fence") continue;
              w.thickness = w.exterior ? tO : tI;
            }
          }
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      patchBrickSpec: (patch) =>
        set((state) => {
          const b = state.project.systems.brick;
          Object.assign(b, patch);
          b.lengthMm = sanitizeNum(b.lengthMm, 600, 80, 1200);
          b.heightMm = sanitizeNum(b.heightMm, 200, 30, 600);
          b.depthMm = sanitizeNum(b.depthMm, 100, 50, 300);
          b.outerThicknessMm = sanitizeNum(b.outerThicknessMm, 100, 60, 350);
          b.innerThicknessMm = sanitizeNum(b.innerThicknessMm, 75, 50, 300);
          b.mortarMm = sanitizeNum(b.mortarMm, 3, 1, 30);
          b.wastePct = sanitizeNum(b.wastePct, 5, 0, 30);
          const tO = b.outerThicknessMm / 1000;
          const tI = b.innerThicknessMm / 1000;
          for (const lv of state.project.levels) {
            for (const w of lv.walls) {
              if (w.kind === "fence") continue;
              w.thickness = w.exterior ? tO : tI;
            }
          }
          state.project.updatedAt = new Date().toISOString();
        }),

      patchPeil: (patch) =>
        set((state) => {
          const p = state.project.site.peil;
          if (patch.streetLevelM !== undefined) p.streetLevelM = sanitizeNum(patch.streetLevelM, p.streetLevelM, PEIL_STREET_MIN_M, PEIL_STREET_MAX_M);
          if (patch.carportPeilM !== undefined) p.carportPeilM = sanitizeNum(patch.carportPeilM, p.carportPeilM, PEIL_CARPORT_MIN_M, PEIL_CARPORT_MAX_M);
          if (patch.terracePeilM !== undefined) p.terracePeilM = sanitizeNum(patch.terracePeilM, p.terracePeilM, PEIL_TERRACE_MIN_M, PEIL_TERRACE_MAX_M);
          if (patch.floor1PeilM !== undefined) p.floor1PeilM = sanitizeNum(patch.floor1PeilM, p.floor1PeilM, PEIL_FLOOR1_MIN_M, PEIL_FLOOR1_MAX_M);
          // Enforce monotonic elevation order: street <= carport <= terrace <= floor1
          p.floor1PeilM = Math.max(p.floor1PeilM, p.streetLevelM);
          p.terracePeilM = Math.min(p.floor1PeilM, Math.max(p.streetLevelM, p.terracePeilM));
          p.carportPeilM = Math.min(p.terracePeilM, Math.max(p.streetLevelM, p.carportPeilM));
          state.project.updatedAt = new Date().toISOString();
        }),

      patchSoil: (patch) =>
        set((state) => {
          const soil = state.project.site.soil;
          Object.assign(soil, patch);
          soil.allowableBearingKpa = sanitizeNum(soil.allowableBearingKpa, 120, 30, 500);
          soil.groundwaterDepthM = sanitizeNum(soil.groundwaterDepthM, 1.5, 0.2, 15);
          soil.permeabilityCmH = sanitizeNum(soil.permeabilityCmH, 3.5, 0.2, 20);
          state.project.updatedAt = new Date().toISOString();
        }),

      patchSiteOrientation: (deg) =>
        set((state) => {
          state.project.site.orientationDeg = sanitizeNum(deg, 0, 0, 360);
          state.project.updatedAt = new Date().toISOString();
        }),

      patchFloodMitigation: (patch) =>
        set((state) => {
          const fm = state.project.floodMitigation;
          Object.assign(fm, patch);
          fm.infiltrationWells = Math.round(sanitizeNum(fm.infiltrationWells, 1, 0, 6));
          fm.barrierHeightCm = sanitizeNum(fm.barrierHeightCm, 60, 30, 120);
          fm.outletHeightM = sanitizeNum(fm.outletHeightM, 0.45, OUTLET_HEIGHT_MIN_M, OUTLET_HEIGHT_MAX_M);
          fm.mcbHeightM = sanitizeNum(fm.mcbHeightM, 1.6, MCB_HEIGHT_MIN_M, MCB_HEIGHT_MAX_M);

          const lt1 = state.project.levels[0];
          if (lt1) {
            if (patch.outletHeightM !== undefined) {
              for (const pt of lt1.mepPoints) {
                if (pt.kind === "stopkontak") pt.y = fm.outletHeightM;
              }
            }
            if (patch.mcbHeightM !== undefined) {
              for (const pt of lt1.mepPoints) {
                if (pt.kind === "panel_mcb") pt.y = fm.mcbHeightM;
              }
            }
          }
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      patchSimulation: (patch) =>
        set((state) => {
          const sim = state.project.simulation;
          Object.assign(sim, patch);
          sim.hourOfDay = sanitizeNum(sim.hourOfDay, 10, 0, 24);
          sim.windDirectionDeg = sanitizeNum(sim.windDirectionDeg, 0, 0, 360);
          sim.windSpeedMs = sanitizeNum(sim.windSpeedMs, 2.4, WIND_SPEED_MIN_MS, WIND_SPEED_MAX_MS);
          sim.ambientTempC = sanitizeNum(sim.ambientTempC, 32, AMBIENT_TEMP_MIN_C, AMBIENT_TEMP_MAX_C);
          sim.humidityPct = sanitizeNum(sim.humidityPct, 72, 30, 100);
          sim.rainIntensityMmH = sanitizeNum(sim.rainIntensityMmH, 0, RAIN_MIN_MM_H, RAIN_MAX_MM_H);
          sim.floodDepthCm = sanitizeNum(sim.floodDepthCm, 0, 0, 150);
          if (patch.rainIntensityMmH !== undefined) {
            state.view.showRain = sim.rainIntensityMmH > 0;
          }
          if (patch.floodDepthCm !== undefined) {
            state.view.showFloodWater = sim.floodDepthCm > 0;
          }
          state.project.updatedAt = new Date().toISOString();
        }),

      patchRabSettings: (patch) =>
        set((state) => {
          const rs = state.project.rabSettings;
          Object.assign(rs, patch);
          rs.boronganPct = sanitizeNum(rs.boronganPct, 28, 0, 60);
          rs.overheadPct = sanitizeNum(rs.overheadPct, 5, 0, 25);
          rs.profitPct = sanitizeNum(rs.profitPct, 5, 0, 25);
          rs.vatPct = sanitizeNum(rs.vatPct, 0, 0, 15);
          rs.contingencyPct = sanitizeNum(rs.contingencyPct, 5, 0, 25);
          state.project.updatedAt = new Date().toISOString();
        }),

      patchStructuralParams: (patch) =>
        set((state) => {
          const sp = state.project.structuralParams;
          Object.assign(sp, patch);
          sp.concreteFcMpa = sanitizeNum(sp.concreteFcMpa, 21.7, FC_MIN_MPA, FC_MAX_MPA);
          sp.rebarFyMpa = sanitizeNum(sp.rebarFyMpa, 420, FY_MIN_MPA, FY_MAX_MPA);
          sp.liveLoadRoomKpa = sanitizeNum(sp.liveLoadRoomKpa, 2.0, 1.5, 5);
          sp.liveLoadStairBalconyKpa = sanitizeNum(sp.liveLoadStairBalconyKpa, 3.0, 2.0, 5);
          sp.liveLoadRoofKpa = sanitizeNum(sp.liveLoadRoofKpa, 1.5, 0.5, 3);
          sp.seismicR = sanitizeNum(sp.seismicR, 5.0, SEISMIC_R_MIN, SEISMIC_R_MAX);
          sp.seismicI = sanitizeNum(sp.seismicI, 1.0, 1.0, 1.5);
          sp.windPressureKpa = sanitizeNum(sp.windPressureKpa, 0.25, 0.1, 1.5);
          sp.coverFoundationMm = sanitizeNum(sp.coverFoundationMm, 40, 30, 75);
          sp.coverBeamColMm = sanitizeNum(sp.coverBeamColMm, 30, 20, 50);
          sp.coverSlabMm = sanitizeNum(sp.coverSlabMm, 20, 15, 40);
          state.project.updatedAt = new Date().toISOString();
        }),

      updatePriceItem: (priceId, field, value) =>
        set((state) => {
          const item = state.project.priceBook.items[priceId];
          if (item && Number.isFinite(value)) {
            item[field] = Math.max(0, value);
            state.project.updatedAt = new Date().toISOString();
          }
        }),

      resetPriceBook: () =>
        set((state) => {
          state.project.priceBook = createDefaultProject().priceBook;
          state.project.updatedAt = new Date().toISOString();
        }),

      patchStageProgress: (stageId, patch) =>
        set((state) => {
          const curr = state.project.stageProgress[stageId] ?? { progressPct: 0, actualCost: 0 };
          const next = { ...curr, ...patch };
          next.progressPct = sanitizeNum(next.progressPct, curr.progressPct, 0, 100);
          next.actualCost = sanitizeNum(next.actualCost, curr.actualCost, 0, 50_000_000_000);
          if (next.crewOverride !== undefined) next.crewOverride = sanitizeNum(next.crewOverride, 4, 1, 30);
          if (next.durationOverrideDays !== undefined) next.durationOverrideDays = sanitizeNum(next.durationOverrideDays, 7, 1, 120);
          if (next.startOffsetDays !== undefined) next.startOffsetDays = sanitizeNum(next.startOffsetDays, 0, -30, 180);
          state.project.stageProgress[stageId] = next;
          state.project.updatedAt = new Date().toISOString();
        }),

      setBudgetCap: (capIdr) =>
        set((state) => {
          if (Number.isFinite(capIdr)) {
            state.project.budgetCapIdr = Math.max(50_000_000, capIdr);
            state.project.updatedAt = new Date().toISOString();
          }
        }),

      toggleSiteChecklist: (key) =>
        set((state) => {
          const curr = Boolean(state.project.siteChecklistDone[key]);
          state.project.siteChecklistDone[key] = !curr;
          state.project.updatedAt = new Date().toISOString();
        }),

      addWall: (levelIndex, wall) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          const prevWalls = lv.walls.map((w) => ({ ...w, openings: [...w.openings] }));
          const candidate = { ...lv, walls: [...lv.walls, wall] };
          const rec = reconcileLevelTopology(candidate, levelIndex, prevWalls);
          if (rec.blockedByOpening) {
            simsAudio.play("warning");
            return;
          }
          state.project.levels[levelIndex] = rec.level;
          state.selected = reconcileSelection(state.project, state.selected);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      addRoomAndWalls: (levelIndex, walls, room) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          const prevWalls = lv.walls.map((w) => ({ ...w, openings: [...w.openings] }));
          const validNew = walls.filter((w) => Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) >= 0.1);
          const candidate = {
            ...lv,
            walls: [...lv.walls, ...validNew],
            rooms: room ? [...lv.rooms, room] : [...lv.rooms],
          };
          const rec = reconcileLevelTopology(candidate, levelIndex, prevWalls);
          if (rec.blockedByOpening) {
            simsAudio.play("warning");
            return;
          }
          state.project.levels[levelIndex] = rec.level;
          state.selected = reconcileSelection(state.project, state.selected);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      updateWall: (levelIndex, wallId, patch) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (w) {
            Object.assign(w, patch);
            w.thickness = sanitizeNum(w.thickness, 0.1, 0.05, 0.4);
            w.height = sanitizeNum(w.height, 3.6, 0.5, 6);
            clampOpeningsToWall(w);
            state.selected = reconcileSelection(state.project, state.selected);
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("paint");
          }
        }),

      pushPullWall: (levelIndex, wallId, deltaNormalM, altFree = false) => {
        const currLv = get().project.levels[levelIndex];
        if (!currLv) return { ok: false, reason: "Lantai tidak ditemukan" };
        const res = applyPushPullWall(currLv, levelIndex, wallId, deltaNormalM, get().project.site, altFree);
        if (!res.ok || !res.level) return { ok: false, reason: res.reason };
        set((state) => {
          state.project.levels[levelIndex] = res.level!;
          state.selected = reconcileSelection(state.project, state.selected);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        });
        return { ok: true };
      },

      deleteWall: (levelIndex, wallId) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          const prevWalls = lv.walls.map((w) => ({ ...w, openings: [...w.openings] }));
          const candidate = { ...lv, walls: lv.walls.filter((w) => w.id !== wallId) };
          const rec = reconcileLevelTopology(candidate, levelIndex, prevWalls);
          state.project.levels[levelIndex] = rec.level;
          state.selected = reconcileSelection(state.project, state.selected);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      deleteWallsBatch: (levelIndex, wallIds) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv || wallIds.length === 0) return;
          const dropSet = new Set(wallIds);
          const prevWalls = lv.walls.map((w) => ({ ...w, openings: [...w.openings] }));
          const candidate = { ...lv, walls: lv.walls.filter((w) => !dropSet.has(w.id)) };
          const rec = reconcileLevelTopology(candidate, levelIndex, prevWalls);
          state.project.levels[levelIndex] = rec.level;
          state.selected = reconcileSelection(state.project, state.selected);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      updateRoom: (levelIndex, roomId, patch) =>
        set((state) => {
          const r = state.project.levels[levelIndex]?.rooms.find((x) => x.id === roomId);
          if (!r) return;
          Object.assign(r, patch);
          if (r.ceilingHeight !== undefined) {
            r.ceilingHeight = sanitizeNum(r.ceilingHeight, 3.1, 2, 12);
          }
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("paint");
        }),

      deleteRoom: (levelIndex, roomId) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv) return;
          const target = lv.rooms.find((r) => r.id === roomId);
          if (!target) return;
          const prevWalls = lv.walls.map((w) => ({ ...w, openings: [...w.openings] }));
          const otherRooms = lv.rooms.filter((r) => r.id !== roomId && r.program !== "garden" && r.program !== "carport" && r.program !== "void");
          // Remove only walls belonging exclusively to this room (not bordering any other room)
          const remainingWalls = lv.walls.filter((w) => {
            if (w.kind === "fence") return true;
            const dx = w.end.x - w.start.x;
            const dz = w.end.z - w.start.z;
            const len = Math.hypot(dx, dz) || 1;
            const nx = -dz / len;
            const nz = dx / len;
            const mx = (w.start.x + w.end.x) * 0.5;
            const mz = (w.start.z + w.end.z) * 0.5;
            const pA = { x: mx + nx * 0.22, z: mz + nz * 0.22 };
            const pB = { x: mx - nx * 0.22, z: mz - nz * 0.22 };
            const touchesTarget = pointInPolygon(pA, target.polygon) || pointInPolygon(pB, target.polygon);
            if (!touchesTarget) return true;
            const touchesOther = otherRooms.some((r) => pointInPolygon(pA, r.polygon) || pointInPolygon(pB, r.polygon));
            return touchesOther;
          });
          if (state.project.buildExtras) {
            state.project.buildExtras.floorTiles = state.project.buildExtras.floorTiles.filter(
              (t) => t.levelIndex !== levelIndex || !pointInPolygon({ x: (t.gx + 0.5) * 0.5, z: (t.gz + 0.5) * 0.5 }, target.polygon),
            );
          }
          const candidate = {
            ...lv,
            walls: remainingWalls,
            rooms: lv.rooms.filter((r) => r.id !== roomId),
          };
          const rec = reconcileLevelTopology(candidate, levelIndex, prevWalls);
          state.project.levels[levelIndex] = rec.level;
          state.selected = reconcileSelection(state.project, state.selected);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      paintRoomWalls: (levelIndex, roomId, materialId) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          const room = lv?.rooms.find((r) => r.id === roomId);
          if (!lv || !room) return;
          let changed = false;
          for (const w of lv.walls) {
            if (w.kind === "fence") continue;
            const dx = w.end.x - w.start.x;
            const dz = w.end.z - w.start.z;
            const len = Math.hypot(dx, dz);
            if (len < 0.05) continue;
            const nx = -dz / len;
            const nz = dx / len;
            const mx = (w.start.x + w.end.x) * 0.5;
            const mz = (w.start.z + w.end.z) * 0.5;
            const frontIn = pointInPolygon({ x: mx + nx * 0.22, z: mz + nz * 0.22 }, room.polygon);
            const backIn = pointInPolygon({ x: mx - nx * 0.22, z: mz - nz * 0.22 }, room.polygon);
            if (frontIn && !backIn) {
              w.frontMaterialId = materialId;
              changed = true;
            } else if (backIn && !frontIn) {
              w.backMaterialId = materialId;
              changed = true;
            } else if (frontIn && backIn) {
              w.frontMaterialId = materialId;
              w.backMaterialId = materialId;
              changed = true;
            }
          }
          if (changed) {
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("paint");
          }
        }),

      addOpening: (levelIndex, wallId, opening) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          if (!w) return;
          w.openings.push(opening);
          clampOpeningsToWall(w);
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      updateOpening: (levelIndex, wallId, openingId, patch) =>
        set((state) => {
          const w = state.project.levels[levelIndex]?.walls.find((x) => x.id === wallId);
          const op = w?.openings.find((o) => o.id === openingId);
          if (w && op) {
            Object.assign(op, patch);
            clampOpeningsToWall(w);
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
            // Clear custom 0.5m floorTiles inside this room so the newly painted floor isn't occluded (BM-06)
            if (state.project.buildExtras?.floorTiles?.length) {
              state.project.buildExtras.floorTiles = state.project.buildExtras.floorTiles.filter(
                (t) =>
                  t.levelIndex !== levelIndex ||
                  !pointInPolygon({ x: (t.gx + 0.5) * 0.5, z: (t.gz + 0.5) * 0.5 }, r.polygon),
              );
            }
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

      deleteFloorTile: (levelIndex, gx, gz) =>
        set((state) => {
          if (!state.project.buildExtras) return;
          const prevLen = state.project.buildExtras.floorTiles.length;
          state.project.buildExtras.floorTiles = state.project.buildExtras.floorTiles.filter(
            (t) => !(t.levelIndex === levelIndex && t.gx === gx && t.gz === gz),
          );
          if (state.project.buildExtras.floorTiles.length !== prevLen) {
            state.selected = reconcileSelection(state.project, state.selected);
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("demolish");
          }
        }),

      deleteFloorTilesBatch: (tiles) =>
        set((state) => {
          if (!state.project.buildExtras || tiles.length === 0) return;
          const drop = new Set(tiles.map((t) => `${t.levelIndex}:${t.gx}:${t.gz}`));
          const prevLen = state.project.buildExtras.floorTiles.length;
          state.project.buildExtras.floorTiles = state.project.buildExtras.floorTiles.filter(
            (t) => !drop.has(`${t.levelIndex}:${t.gx}:${t.gz}`),
          );
          if (state.project.buildExtras.floorTiles.length !== prevLen) {
            state.selected = reconcileSelection(state.project, state.selected);
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("demolish");
          }
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
              linkedStairId: stair.id,
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
          const lt2 = state.project.levels[1];
          if (lt2) {
            lt2.slabs = lt2.slabs.filter((s) => s.id !== `slab-void-${stairId}` && s.linkedStairId !== stairId);
          }
          if (state.selected?.kind === "stair" && state.selected.id === stairId) state.selected = null;
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

      updateFurnitureBatch: (levelIndex, updates) =>
        set((state) => {
          const lv = state.project.levels[levelIndex];
          if (!lv || updates.length === 0) return;
          const byId = new Map(lv.furniture.map((f) => [f.id, f]));
          let changed = false;
          for (const u of updates) {
            const target = byId.get(u.id);
            if (target) {
              Object.assign(target, u.patch);
              changed = true;
            }
          }
          if (changed) {
            state.project.updatedAt = new Date().toISOString();
            simsAudio.play("paint");
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
          const norm: BuildPoolOverride = {
            ...pool,
            gx1: Math.min(pool.gx1, pool.gx2),
            gx2: Math.max(pool.gx1, pool.gx2),
            gz1: Math.min(pool.gz1, pool.gz2),
            gz2: Math.max(pool.gz1, pool.gz2),
            depth: sanitizeNum(pool.depth, 1.2, 0.4, 3),
          };
          state.project.buildExtras = { ...curr, pools: [...curr.pools, norm] };
          state.selected = { kind: "pool", id: norm.id, levelIndex: 0 };
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("place");
        }),

      deletePool: (poolId) =>
        set((state) => {
          if (!state.project.buildExtras) return;
          state.project.buildExtras.pools = state.project.buildExtras.pools.filter((p) => p.id !== poolId);
          if (state.selected?.kind === "pool" && state.selected.id === poolId) state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),

      setTerrainHeights: (heights) =>
        set((state) => {
          const curr = state.project.buildExtras ?? { floorTiles: [], pools: [], terrainHeights: [] };
          state.project.buildExtras = { ...curr, terrainHeights: heights.filter((h) => Number.isFinite(h)) };
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
            lv.mepPoints = [];
          }
          state.project.buildExtras = { floorTiles: [], pools: [], terrainHeights: [] };
          state.project.stageProgress = {};
          state.project.siteChecklistDone = {};
          state.selected = null;
          state.project.updatedAt = new Date().toISOString();
          simsAudio.play("demolish");
        }),
    })),
    {
      partialize: (state) => ({ project: state.project }),
      equality: (past, curr) => past.project === curr.project,
      limit: 60,
    },
  ),
);

// Automatically drop dangling selection if Undo/Redo removes the selected object
useStudioStore.subscribe((state, prev) => {
  if (state.project !== prev.project && state.selected !== null) {
    const nextSel = reconcileSelection(state.project, state.selected);
    if (nextSel !== state.selected) {
      useStudioStore.setState({ selected: nextSel });
    }
  }
});
