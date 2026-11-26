import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTerrainBrushToHeights,
  computeProjectRoomFloodCells,
  createOpeningForWall,
  isWallCutawayCandidate,
  snapOpeningToProjectWalls,
  snapWallEndpoint,
  UNIFIED_BUILD_CATALOG,
  useBuildModeStore,
  validateFootprintPlacement,
  validateProjectStairPlacement,
} from "@/features/buildMode";
import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { CURRENT_PROJECT_SCHEMA_VERSION, parseVersionedProjectSave } from "@/lib/model/schema";
import { buildRabSummary } from "@/lib/quantities/rabEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { computeStructuralReport } from "@/lib/structure/sniEngine";

describe("Unified Single-Source Build Mode (Project + Zundo Undo/Redo)", () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
    useStudioStore.temporal.getState().clear();
    useBuildModeStore.getState().setActiveLevel(0);
    useBuildModeStore.getState().setWallVisibility("cutaway");
  });

  it("loads the exact original 5x17m house & price-free catalog items", () => {
    const { project } = useStudioStore.getState();
    expect(project.site.width).toBe(5);
    expect(project.site.depth).toBe(17);
    expect(project.levels[0]!.walls.length).toBeGreaterThan(8);
    expect(project.levels[0]!.furniture.some((f) => f.category === "vehicle")).toBe(true);
    expect(UNIFIED_BUILD_CATALOG.length).toBeGreaterThanOrEqual(45);
    expect(UNIFIED_BUILD_CATALOG.every((c) => !("priceIdr" in c))).toBe(true);
  });

  it("mutates Project directly via Zundo Undo/Redo and stays 100% synced with RAB & Masonry", () => {
    const beforeProj = useStudioStore.getState().project;
    const beforeDerived = buildDerivedModel(beforeProj);
    const beforeStruct = computeStructuralReport(beforeDerived);
    const beforeRab = buildRabSummary(beforeDerived, beforeStruct);

    // Add a new 4m wall on LT1 via Build Mode store action
    useStudioStore.getState().addWall(0, {
      id: "w-new-test",
      name: "Dinding Uji RAB",
      start: { x: 1.5, z: 10 },
      end: { x: 4.5, z: 10 },
      thickness: 0.1,
      height: 3.6,
      materialId: "wall_ext_ivory",
      exterior: false,
      openings: [],
    });

    const afterProj = useStudioStore.getState().project;
    const afterDerived = buildDerivedModel(afterProj);
    const afterRab = buildRabSummary(afterDerived, computeStructuralReport(afterDerived));

    expect(afterDerived.totalWallLengthM).toBeGreaterThan(beforeDerived.totalWallLengthM + 2.9);
    expect(afterDerived.masonry.totalBuyBricks).toBeGreaterThan(beforeDerived.masonry.totalBuyBricks);
    expect(afterRab.grandTotal).toBeGreaterThan(beforeRab.grandTotal);

    // Zundo Undo reverts both Project and derived RAB/bricks identically
    useStudioStore.temporal.getState().undo();
    const revertedProj = useStudioStore.getState().project;
    const revertedDerived = buildDerivedModel(revertedProj);
    expect(revertedDerived.totalWallLengthM).toBeCloseTo(beforeDerived.totalWallLengthM, 4);

    // Redo restores cleanly
    useStudioStore.temporal.getState().redo();
    expect(useStudioStore.getState().project.levels[0]!.walls.some((w) => w.id === "w-new-test")).toBe(true);
  });

  it("snaps 0.5m grid walls (orthogonal & 45°), openings onto real Project walls, and room flood fill", () => {
    const orth = snapWallEndpoint({ gx: 2, gz: 4 }, { gx: 8, gz: 5 }, 10, 34, false);
    expect(orth).toEqual({ gx: 8, gz: 4 });
    const diag = snapWallEndpoint({ gx: 2, gz: 4 }, { gx: 6, gz: 7 }, 10, 34, true);
    expect(Math.abs(diag.gx - 2)).toBe(Math.abs(diag.gz - 4));

    // Reset clean lot, draw a closed 3x4m room and flood fill it
    useStudioStore.getState().resetLotClean();
    useStudioStore.getState().addRoomAndWalls(0, [
      { id: "bw-1", name: "N", start: { x: 1, z: 5 }, end: { x: 4, z: 5 }, thickness: 0.1, height: 3.6, materialId: "wall_ext_ivory", exterior: true, openings: [] },
      { id: "bw-2", name: "E", start: { x: 4, z: 5 }, end: { x: 4, z: 9 }, thickness: 0.1, height: 3.6, materialId: "wall_ext_ivory", exterior: true, openings: [] },
      { id: "bw-3", name: "S", start: { x: 4, z: 9 }, end: { x: 1, z: 9 }, thickness: 0.1, height: 3.6, materialId: "wall_ext_ivory", exterior: true, openings: [] },
      { id: "bw-4", name: "W", start: { x: 1, z: 9 }, end: { x: 1, z: 5 }, thickness: 0.1, height: 3.6, materialId: "wall_ext_ivory", exterior: true, openings: [] },
    ]);

    const walls = useStudioStore.getState().project.levels[0]!.walls;
    // Enclosed room 3x4m at 0.5m cells = 6x8 = 48 cells
    const floodInside = computeProjectRoomFloodCells(walls, 10, 34, 0.5, 4, 12);
    expect(floodInside.length).toBe(48);

    // Snap door cleanly onto top wall (z = 5.0m, x: 1..4)
    const snapValid = snapOpeningToProjectWalls(walls, 2.5, 5.05, 0.9);
    expect(snapValid?.valid).toBe(true);
    useStudioStore.getState().addOpening(0, "bw-1", createOpeningForWall("op-d1", "door", snapValid!.offsetM, 0.9, 2.15, 0, "Pintu"));

    // Attempting second overlapping door on same center must report invalid collision
    const snapOverlap = snapOpeningToProjectWalls(useStudioStore.getState().project.levels[0]!.walls, 2.5, 5.02, 0.9);
    expect(snapOverlap?.valid).toBe(false);
  });

  it("supports stairs + LT2 void cutout, HVAC/Furniture/Light CRUD, pools & terrain sculpting", () => {
    useStudioStore.getState().resetLotClean();
    const res = validateProjectStairPlacement([], 0, 2, 10, 2, 8, 0, 10, 34, 0.5);
    expect(res.valid).toBe(true);

    useStudioStore.getState().addStairWithCutout(
      0,
      {
        id: "st-new",
        name: "Tangga Baru",
        start: res.start,
        end: res.end,
        width: 1.0,
        floorHeight: 3.6,
        riserCount: 18,
        treadDepth: 0.25,
        shape: "straight",
        landingDepth: 1.0,
      },
      res.voidPoly,
    );
    expect(useStudioStore.getState().project.levels[0]!.stairs.length).toBe(1);
    expect(useStudioStore.getState().project.levels[1]!.slabs.some((s) => s.id === "slab-void-st-new")).toBe(true);

    // Deleting a stair cleans up its paired LT2 void cutout slab (EC-05)
    useStudioStore.getState().deleteStair(0, "st-new");
    expect(useStudioStore.getState().project.levels[0]!.stairs.length).toBe(0);
    expect(useStudioStore.getState().project.levels[1]!.slabs.some((s) => s.id === "slab-void-st-new")).toBe(false);

    useStudioStore.getState().addPool({ id: "p-1", gx1: 4, gz1: 28, gx2: 8, gz2: 32, depth: 1.25 });
    expect(useStudioStore.getState().project.buildExtras?.pools.length).toBe(1);

    const h = applyTerrainBrushToHeights([], 10, 34, 2, 2, "raise", 0.3);
    useStudioStore.getState().setTerrainHeights(h);
    expect(useStudioStore.getState().project.buildExtras?.terrainHeights[2 * 11 + 2]).toBeGreaterThan(0.2);

    useStudioStore.getState().addFurniture(0, {
      id: "f-sofa",
      catalogId: "sofa_l",
      name: "Sofa L",
      category: "seating",
      position: { x: 2.5, y: 0, z: 8.5 },
      size: { x: 2.2, y: 0.78, z: 1.5 },
      rotationY: 0,
      colorHex: "#d8d1c5",
    });
    expect(useStudioStore.getState().project.levels[0]!.furniture.length).toBe(1);

    // Verify wall_fan catalog entry & SNI/Brick automatic store updates
    const wallFanItem = UNIFIED_BUILD_CATALOG.find((c) => c.hvacMeta?.type === "wall_fan");
    expect(wallFanItem).toBeDefined();

    const prevUpdatedAt = useStudioStore.getState().project.updatedAt;
    useStudioStore.getState().patchStructuralParams({ concreteFcMpa: 25.0 });
    expect(useStudioStore.getState().project.structuralParams.concreteFcMpa).toBe(25.0);
    expect(useStudioStore.getState().project.updatedAt).not.toBe("");
    expect(prevUpdatedAt).toBeDefined();
  });

  it("supports Cutaway wall facing detection, 2D stacked openings, and LT2 void footprint validation", () => {
    // Camera at front-right (x=9, z=-5) looking toward house center (x=2.5, z=8.5):
    // Front wall z=4 faces the camera and sits between camera and target -> hides cleanly
    expect(isWallCutawayCandidate(0, 4, 5, 4, 9, -5, 2.5, 8.5)).toBe(true);
    // Rear wall z=15.35 sits behind target away from camera -> stays full
    expect(isWallCutawayCandidate(0, 15.35, 5, 15.35, 9, -5, 2.5, 8.5)).toBe(false);
    // Camera panned directly in front of front street looking straight +Z along left wall (edge-on)
    expect(isWallCutawayCandidate(0, 4, 0, 17, 2.5, -5, 2.5, 8.5)).toBe(false);
    // Panning camera target deeper toward rear bedroom pulls mid wall (z=7.5) in front of target -> hides mid partition
    expect(isWallCutawayCandidate(0, 7.5, 5, 7.5, 2.5, -2, 2.5, 12.0)).toBe(true);

    // 2D opening bounds: tall door rejected on 1.2m fence, stacked high vent allowed over door
    const fence = {
      id: "w-fence",
      name: "Pagar Depan",
      start: { x: 0, z: 0 },
      end: { x: 4, z: 0 },
      thickness: 0.12,
      height: 1.2,
      materialId: "wall_ext_ivory",
      exterior: true,
      openings: [],
    };
    const tallDoorOnFence = snapOpeningToProjectWalls([fence], 2.0, 0.02, 0.9, undefined, 0, 2.15);
    expect(tallDoorOnFence?.valid).toBe(false);

    const doorWall = {
      ...fence,
      id: "w-tall",
      height: 3.6,
      openings: [createOpeningForWall("op-d", "door", 2.0, 0.9, 2.15, 0, "Pintu")],
    };
    const ventAboveDoor = snapOpeningToProjectWalls([doorWall], 2.0, 0.02, 0.8, undefined, 2.4, 0.35);
    expect(ventAboveDoor?.valid).toBe(true);

    // Footprint validation blocks placing furniture outside 5x17 bounds or over LT2 void
    const proj = useStudioStore.getState().project;
    expect(validateFootprintPlacement(proj, 0, 0.1, 8, 2.0, 1.0, 0, "surface").valid).toBe(false);
    const lt2Void = proj.levels[1]!.slabs.find((s) => s.isVoid);
    if (lt2Void && lt2Void.polygon.length >= 3) {
      const vx = lt2Void.polygon.reduce((s, p) => s + p.x, 0) / lt2Void.polygon.length;
      const vz = lt2Void.polygon.reduce((s, p) => s + p.z, 0) / lt2Void.polygon.length;
      expect(validateFootprintPlacement(proj, 1, vx, vz, 0.8, 0.8, 0, "surface").valid).toBe(false);
    }
  });

  it("supports unified Build panels, terrain toggle, Undo selection reconciliation, and v2->v3 save migration", () => {
    const store = useStudioStore.getState();

    // Terrain visibility toggle for foundation inspection
    expect(useStudioStore.getState().view.showTerrain).toBe(true);
    store.patchView({ showTerrain: false, showStructure: true });
    expect(useStudioStore.getState().view.showTerrain).toBe(false);
    expect(useStudioStore.getState().view.showStructure).toBe(true);
    store.patchView({ showTerrain: true });

    // Adding an item & selecting it, then undoing clears dangling selection automatically (EC-05)
    store.addFurniture(0, {
      id: "f-undo-sel",
      catalogId: "coffee_table",
      name: "Meja Uji",
      category: "table",
      position: { x: 2.0, y: 0, z: 6.0 },
      size: { x: 1.0, y: 0.42, z: 0.58 },
      rotationY: 0,
      colorHex: "#9b6b43",
    });
    store.setSelected({ kind: "furniture", levelIndex: 0, id: "f-undo-sel" });
    expect(useStudioStore.getState().selected?.id).toBe("f-undo-sel");
    useStudioStore.temporal.getState().undo();
    expect(useStudioStore.getState().selected).toBeNull();

    // Unified Build Studio panel navigation across structure/lighting/airflow/flood/inspection
    store.setWorkspace("rab");
    store.openBuildPanel("flood");
    expect(useStudioStore.getState().workspace).toBe("build");
    expect(useStudioStore.getState().studioPanel).toBe("flood");
    store.openBuildPanel("structure");
    expect(useStudioStore.getState().studioPanel).toBe("structure");
    store.setStudioPanel("none");
    expect(useStudioStore.getState().studioPanel).toBe("none");

    // Legacy v2 save (without v3 top-level budgetCapIdr) migrates forward cleanly to schemaVersion 3
    const baseProj = useStudioStore.getState().project;
    const { budgetCapIdr: _oldCap, siteChecklistDone: _oldQc, ...restV2 } = baseProj;
    const legacyV2 = {
      ...restV2,
      schemaVersion: 2,
      levels: baseProj.levels.map((lv) => ({ ...lv, mepRoutes: [] })),
      gamification: { mode: "simple", score: 85, budgetCapIdr: 395_000_000, siteChecklistDone: { "qc-1": true } },
    };
    const parsed = parseVersionedProjectSave(legacyV2);
    expect(parsed.status).toBe("ok");
    if (parsed.status === "ok") {
      expect(parsed.migratedFromVersion).toBe(2);
      expect(parsed.data.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
      expect(parsed.data.budgetCapIdr).toBe(395_000_000);
      expect(parsed.data.siteChecklistDone["qc-1"]).toBe(true);
      store.loadProject(parsed.data);
      expect(useStudioStore.getState().project.budgetCapIdr).toBe(395_000_000);
    }
  });
});
