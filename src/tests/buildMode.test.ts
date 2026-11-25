import { describe, it, expect, beforeEach } from "vitest";
import {
  BUILD_FORMAT_VERSION,
  computeBuildCostSummary,
  createEmpty5x17Document,
  createStarter5x17HouseDocument,
  makeAddWallCommand,
  makePaintFloorCellsCommand,
  makeUpdateBudgetCommand,
  parseBuildDocumentJson,
  useBuildModeStore,
  type BuildWall,
} from "@/features/buildMode";

describe("Build Mode v2 Data Model & Command History", () => {
  beforeEach(() => {
    useBuildModeStore.getState().resetToStarterHouse();
  });

  it("builds a valid 5x17m 2-storey house document strictly aligned to 0.5m sub-grid", () => {
    const doc = createStarter5x17HouseDocument(450_000_000);
    expect(doc.formatVersion).toBe(BUILD_FORMAT_VERSION);
    expect(doc.lot.cols * doc.lot.cellSize).toBeCloseTo(5.0);
    expect(doc.lot.rows * doc.lot.cellSize).toBeCloseTo(17.0);
    expect(doc.levels.length).toBeGreaterThanOrEqual(2);
    expect(doc.walls.length).toBeGreaterThan(15);
    expect(doc.openings.some((o) => o.kind === "door")).toBe(true);
    expect(doc.openings.some((o) => o.kind === "window")).toBe(true);
    expect(doc.stairs.length).toBeGreaterThanOrEqual(1);

    const summary = computeBuildCostSummary(doc);
    expect(summary.totalIdr).toBeGreaterThan(100_000_000);
    expect(summary.builtFloorAreaM2).toBeGreaterThan(80);
  });

  it("executes, undoes, and redoes Command mutations symmetrically", () => {
    const store = useBuildModeStore.getState();
    const startWallCount = store.document.walls.length;

    const testWall: BuildWall = {
      id: "w-unit-1",
      levelIndex: 0,
      x1: 2,
      z1: 2,
      x2: 6,
      z2: 2,
      kind: "wall",
      thickness: 0.15,
      height: 3.4,
      paintInnerId: "plaster_warm",
      paintOuterId: "plaster_warm",
    };

    store.executeCommand(makeAddWallCommand(testWall));
    expect(useBuildModeStore.getState().document.walls.length).toBe(startWallCount + 1);
    expect(useBuildModeStore.getState().canUndo()).toBe(true);

    store.executeCommand(
      makePaintFloorCellsCommand([
        { levelIndex: 0, gx: 2, gz: 2, materialId: "wood_oak" },
        { levelIndex: 0, gx: 3, gz: 2, materialId: "wood_oak" },
      ]),
    );
    expect(useBuildModeStore.getState().document.floorCells["0:2:2"]?.materialId).toBe("wood_oak");

    expect(store.undo()).toBe(true);
    expect(useBuildModeStore.getState().document.floorCells["0:2:2"]?.materialId).toBe("garden_grass");

    expect(store.undo()).toBe(true);
    expect(useBuildModeStore.getState().document.walls.length).toBe(startWallCount);
    expect(useBuildModeStore.getState().canRedo()).toBe(true);

    expect(store.redo()).toBe(true);
    expect(useBuildModeStore.getState().document.walls.length).toBe(startWallCount + 1);

    store.executeCommand(makeUpdateBudgetCommand(520_000_000));
    expect(useBuildModeStore.getState().document.lot.budgetIdr).toBe(520_000_000);
  });

  it("switches levels and cycles wall visibility modes cleanly without touching data", () => {
    const store = useBuildModeStore.getState();
    expect(store.activeLevel).toBe(0);
    store.stepLevel(1);
    expect(useBuildModeStore.getState().activeLevel).toBe(1);
    store.stepLevel(1);
    expect(useBuildModeStore.getState().activeLevel).toBe(2);
    store.stepLevel(1); // clamps at roof level
    expect(useBuildModeStore.getState().activeLevel).toBe(2);

    store.setWallVisibility("up");
    store.cycleWallVisibility();
    expect(useBuildModeStore.getState().wallVisibility).toBe("cutaway");
    store.cycleWallVisibility();
    expect(useBuildModeStore.getState().wallVisibility).toBe("down");
  });

  it("parses valid Build Mode v2 saves and safely ignores legacy v1 files", () => {
    const empty = createEmpty5x17Document();
    const okRes = parseBuildDocumentJson(empty);
    expect(okRes.status).toBe("ok");

    const legacyRes = parseBuildDocumentJson({ formatVersion: 1, walls: [] });
    expect(legacyRes.status).toBe("legacy_ignored");

    const brokenRes = parseBuildDocumentJson({ formatVersion: 2, lot: {} });
    expect(brokenRes.status).toBe("invalid");
  });
});
