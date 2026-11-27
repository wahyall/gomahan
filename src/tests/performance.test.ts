import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { computeMasonryTakeoff } from "@/lib/geometry/masonry";
import { applyFloorWorldUv1, applyWallVertexAo, generateFloorAoTexture } from "@/lib/scene/bakedAo";
import { SpatialHashGrid } from "@/features/walkMode/collisionBuilder";
import { runLightingSimulation } from "@/lib/simulation/lightingEngine";
import { runAirflowSimulation } from "@/lib/simulation/airflowEngine";
import { runAirflowSimulationAsync, generateBricksAsync, runLightingSimulationAsync } from "@/lib/simulation/workerClient";
import { useStudioStore } from "@/lib/store/useStudioStore";

describe("Performance Architecture Regression Suite", () => {
  beforeEach(() => {
    useStudioStore.getState().loadProject(createDefaultProject());
    useStudioStore.temporal.getState().clear();
  });

  it("generates accurate CPU Baked AO near walls while keeping open regions bright and attaches uv1/aAoDarken", () => {
    const project = createDefaultProject();
    // Place a clean test wall across z = 4 from x = 0..5 on level 0
    project.levels[0]!.walls = [
      {
        id: "test-wall",
        name: "Test Wall",
        kind: "wall",
        start: { x: 0, z: 4 },
        end: { x: 5, z: 4 },
        height: 3.4,
        thickness: 0.14,
        exterior: false,
        materialId: "brick_plaster",
        openings: [],
      },
    ];
    project.levels[1]!.slabs = [];

    const tex = generateFloorAoTexture(project.levels[0], project, [], 0);
    const data = tex.image.data as Uint8Array;
    const width = tex.image.width;
    const height = tex.image.height;

    const samplePx = (wx: number, wz: number) => {
      const px = Math.max(0, Math.min(width - 1, Math.floor((wx / project.site.width) * width)));
      const py = Math.max(0, Math.min(height - 1, Math.floor((wz / project.site.depth) * height)));
      return data[(py * width + px) * 4]!;
    };

    const nearWallAo = samplePx(2.5, 4.02);
    const openSpaceAo = samplePx(2.5, 13.5);
    expect(nearWallAo).toBeLessThan(150);
    expect(openSpaceAo).toBe(255);
    tex.dispose();

    const floorGeo = applyFloorWorldUv1(new THREE.PlaneGeometry(5, 17).rotateX(-Math.PI / 2), 5, 17, 2.5, 8.5);
    expect(floorGeo.getAttribute("uv1")).toBeDefined();
    floorGeo.dispose();

    const wallGeo = applyWallVertexAo(new THREE.BoxGeometry(5, 3.4, 0.14), 5, 3.4, true, false);
    const aoAttr = wallGeo.getAttribute("aAoDarken") as THREE.BufferAttribute;
    expect(aoAttr).toBeDefined();
    expect(aoAttr.count).toBe(wallGeo.getAttribute("position").count);
    for (let i = 0; i < aoAttr.count; i++) {
      expect(aoAttr.getX(i)).toBeGreaterThanOrEqual(0);
      expect(aoAttr.getX(i)).toBeLessThanOrEqual(1);
    }
    wallGeo.dispose();
  });

  it("excludes UI/camera/selection mutations from Zundo undo history and keeps Immer refs stable", () => {
    const temporal = useStudioStore.temporal;
    temporal.getState().clear();

    const store = useStudioStore.getState();
    const initialProject = store.project;
    const initialLevelsRef = initialProject.levels;
    const initialSiteRef = initialProject.site;

    // UI-only changes must NOT push undo snapshots
    store.setSelected({ kind: "wall", id: "w1", levelIndex: 0 });
    store.patchView({ cutH: 2.2, wireframe: true });
    store.setWorkspace("rab");
    expect(temporal.getState().pastStates.length).toBe(0);

    // Mutating simulation slice must preserve untouched levels & site Immer references
    store.patchSimulation({ hourOfDay: 15.5 });
    const afterSimProject = useStudioStore.getState().project;
    expect(afterSimProject).not.toBe(initialProject);
    expect(afterSimProject.levels).toBe(initialLevelsRef);
    expect(afterSimProject.site).toBe(initialSiteRef);
    expect(temporal.getState().pastStates.length).toBe(1);
  });

  it("SpatialHashGrid integer bit-packing resolves negative and positive coordinates without collisions", () => {
    const grid = new SpatialHashGrid();
    grid.insertBox(0, -10.5, -9.2, -12.4, -11.1);
    grid.insertBox(1, 0.2, 0.8, 0.2, 0.8);
    grid.insertBox(2, 12.1, 13.4, 15.0, 16.5);

    const seen = new Uint32Array(3);
    const out: number[] = [];

    grid.queryAabb(-10.2, -9.5, -12.0, -11.4, seen, 1, out);
    expect(out).toEqual([0]);

    grid.queryAabb(0.3, 0.7, 0.3, 0.7, seen, 2, out);
    expect(out).toEqual([1]);

    grid.queryAabb(12.2, 13.2, 15.2, 16.2, seen, 3, out);
    expect(out).toEqual([2]);
  });

  it("computes lazy masonry metrics cleanly and runs simulation worker fallback with numerical parity", async () => {
    const project = createDefaultProject();
    const eager = computeMasonryTakeoff(project.levels, project.systems.brick, undefined, { includeBricks: true });
    const lazy = computeMasonryTakeoff(project.levels, project.systems.brick, undefined, { includeBricks: false });

    expect(eager.bricks.length).toBe(eager.totalPiecesPlaced);
    expect(lazy.bricks).toHaveLength(0);
    expect(lazy.totalPiecesPlaced).toBe(eager.totalPiecesPlaced);
    expect(lazy.totalBuyBricks).toBe(eager.totalBuyBricks);
    expect(lazy.mortarWithWasteM3).toBeCloseTo(eager.mortarWithWasteM3, 6);

    const derived = buildDerivedModel(project, { includeBricks: false });
    const syncLighting = runLightingSimulation(derived);
    const asyncLighting = await runLightingSimulationAsync(project);
    expect(asyncLighting).not.toBeNull();
    expect(asyncLighting!.avgHouseLux).toBe(syncLighting.avgHouseLux);
    expect(asyncLighting!.daylightScore).toBe(syncLighting.daylightScore);

    const syncAirflow = runAirflowSimulation(derived);
    const asyncAirflow = await runAirflowSimulationAsync(project);
    expect(asyncAirflow).not.toBeNull();
    expect(asyncAirflow!.airflowScore).toBe(syncAirflow.airflowScore);
    expect(asyncAirflow!.avgAch).toBeCloseTo(syncAirflow.avgAch, 5);
  });

  it("offloads brick-instance generation through the simulation worker path with full positional parity", async () => {
    const project = createDefaultProject();
    const syncDerived = buildDerivedModel(project, { includeBricks: true });
    const syncBricks = syncDerived.masonry.bricks;
    const asyncBricks = await generateBricksAsync(project);

    expect(asyncBricks).not.toBeNull();
    expect(asyncBricks!.length).toBe(syncBricks.length);
    expect(asyncBricks!.length).toBe(syncDerived.masonry.totalPiecesPlaced);
    for (let i = 0; i < asyncBricks!.length; i++) {
      const a = asyncBricks![i]!;
      const b = syncBricks[i]!;
      expect(a.levelIndex).toBe(b.levelIndex);
      expect(a.wallId).toBe(b.wallId);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.z).toBeCloseTo(b.z, 6);
      expect(a.rotY).toBeCloseTo(b.rotY, 6);
    }
  });
});
