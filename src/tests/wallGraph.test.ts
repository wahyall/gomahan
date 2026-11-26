import { beforeEach, describe, expect, it } from "vitest";
import { createOpeningForWall } from "@/features/buildMode/geometryUtils";
import {
  extractMinimalCycles,
  normalizeAndSplitWalls,
  pushPullWall,
  reconcileLevelTopology,
} from "@/features/buildMode/wallGraph";
import { polygonArea } from "@/lib/geometry/rooms";
import { createDefaultProject } from "@/lib/model/defaultProject";
import type { Level, Wall } from "@/lib/model/types";
import { useStudioStore } from "@/lib/store/useStudioStore";

function makeWall(
  id: string,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  openings: Wall["openings"] = [],
): Wall {
  return {
    id,
    name: id,
    kind: "wall",
    start: { x: x1, z: z1 },
    end: { x: x2, z: z2 },
    thickness: 0.12,
    height: 3.6,
    materialId: "wall_int_ivory",
    exterior: false,
    openings,
  };
}

describe("Wall-Graph & Room Topology Engine (BM-01, BM-02)", () => {
  beforeEach(() => {
    useStudioStore.getState().resetLotClean();
    useStudioStore.temporal.getState().clear();
  });

  it("splits intersecting walls at T-junctions & X-crossings while migrating opening world offsets", () => {
    const door = createOpeningForWall("op-d1", "door", 3.1, 0.9, 2.15, 0, "Pintu");
    const host = makeWall("w-host", 0, 5, 5, 5, [door]);
    const branch = makeWall("w-branch", 2, 5, 2, 10);

    const splitT = normalizeAndSplitWalls([host, branch]);
    const hostPieces = splitT.walls.filter((w) => w.end.z === 5 && w.start.z === 5);
    expect(hostPieces.length).toBe(2);

    // Door originally at world x=3.1m must move onto segment x: 2..5 with local offset 1.1m
    const rightSeg = hostPieces.find((w) => Math.max(w.start.x, w.end.x) > 4.5)!;
    expect(rightSeg.openings.length).toBe(1);
    const d = Math.hypot(rightSeg.end.x - rightSeg.start.x, rightSeg.end.z - rightSeg.start.z);
    const ux = (rightSeg.end.x - rightSeg.start.x) / d;
    const worldX = rightSeg.start.x + ux * rightSeg.openings[0]!.offset;
    expect(worldX).toBeCloseTo(3.1, 2);

    // X-crossing splits both orthogonal walls into 4 segments total
    const crossA = makeWall("xa", 0, 8, 4, 8);
    const crossB = makeWall("xb", 2, 6, 2, 10);
    const splitX = normalizeAndSplitWalls([crossA, crossB]);
    expect(splitX.walls.length).toBe(4);
  });

  it("extracts closed rectangular rooms, splits cleanly, merges on partition delete, and tags exterior walls", () => {
    const boxWalls = [
      makeWall("n", 0.5, 4, 4.5, 4),
      makeWall("e", 4.5, 4, 4.5, 10),
      makeWall("s", 4.5, 10, 0.5, 10),
      makeWall("w", 0.5, 10, 0.5, 4),
    ];
    const baseLv: Level = {
      id: "lv-0",
      index: 0,
      name: "LT 1",
      elevation: 0,
      height: 3.6,
      walls: boxWalls,
      rooms: [],
      slabs: [],
      stairs: [],
      furniture: [],
      lights: [],
      hvac: [],
      mepPoints: [],
    };

    const rec1 = reconcileLevelTopology(baseLv, 0);
    expect(rec1.level.rooms.length).toBe(1);
    expect(polygonArea(rec1.level.rooms[0]!.polygon)).toBeCloseTo(24, 1); // 4m x 6m
    expect(rec1.level.walls.every((w) => w.exterior)).toBe(true);

    // Customize room metadata and add an interior partition wall at z=7 -> 2 child rooms inherit style
    const styledLv: Level = {
      ...rec1.level,
      rooms: [{ ...rec1.level.rooms[0]!, name: "Kamar Besar", floorMaterialId: "wood_oak" }],
      walls: [...rec1.level.walls, makeWall("mid", 0.5, 7, 4.5, 7)],
    };
    const recSplit = reconcileLevelTopology(styledLv, 0);
    expect(recSplit.level.rooms.length).toBe(2);
    expect(recSplit.level.rooms.every((r) => r.floorMaterialId === "wood_oak")).toBe(true);

    const midWall = recSplit.level.walls.find((w) => Math.abs(w.start.z - 7) < 0.05 && Math.abs(w.end.z - 7) < 0.05)!;
    expect(midWall.exterior).toBe(false);

    // Delete interior divider (passing prevWalls) -> merges back into 1 full 24 m² room
    const recMerge = reconcileLevelTopology(
      {
        ...recSplit.level,
        walls: recSplit.level.walls.filter((w) => w.id !== midWall.id),
      },
      0,
      recSplit.level.walls,
    );
    expect(recMerge.level.rooms.length).toBe(1);
    expect(polygonArea(recMerge.level.rooms[0]!.polygon)).toBeCloseTo(24, 1);

    // Verify extractMinimalCycles on LT2 regenerates solid floor slab dynamically
    const cycles = extractMinimalCycles(boxWalls);
    expect(cycles.length).toBe(1);
    const recLt2 = reconcileLevelTopology({ ...baseLv, index: 1 }, 1);
    expect(recLt2.level.slabs.some((s) => !s.isVoid && s.id.startsWith("slab-lt2-"))).toBe(true);
  });

  it("supports perpendicular wall push-pull with bounds enforcement, opening guard, and 1 Zundo undo", () => {
    const store = useStudioStore.getState();
    store.addRoomAndWalls(0, [
      makeWall("wn", 1, 5, 4, 5),
      makeWall("we", 4, 5, 4, 9),
      makeWall("ws", 4, 9, 1, 9, [createOpeningForWall("op-d", "door", 1.5, 0.9, 2.15, 0, "Pintu")]),
      makeWall("ww", 1, 9, 1, 5),
    ]);

    const afterRoom = useStudioStore.getState().project;
    expect(afterRoom.levels[0]!.rooms.length).toBe(1);
    const northId = afterRoom.levels[0]!.walls.find((w) => Math.abs(w.start.z - 5) < 0.05 && Math.abs(w.end.z - 5) < 0.05)!.id;

    // Out of site bounds rejection
    const outFail = pushPullWall(afterRoom.levels[0]!, 0, northId, -8.0, afterRoom.site);
    expect(outFail.ok).toBe(false);

    const pastCountBefore = useStudioStore.temporal.getState().pastStates.length;
    // Push north wall by -1.0m normal delta (check sign via room expansion; deltaNormalM of +1 or -1 shifts z=5 -> z=4 or z=6)
    const eastWall = afterRoom.levels[0]!.walls.find((w) => Math.abs(w.start.x - 4) < 0.05 && Math.abs(w.end.x - 4) < 0.05)!;
    // Push east wall from x=4 out to x=5 (+1m; note for wall (4,5)->(4,9), dx=0, dz=4 -> nx=-dz/len=-1, so -1 normal shifts +X!)
    const pushRes = store.pushPullWall(0, eastWall.id, -0.25);
    expect(pushRes.ok).toBe(true);
    const fineExpanded = useStudioStore.getState().project.levels[0]!;
    expect(polygonArea(fineExpanded.rooms[0]!.polygon)).toBeCloseTo(13, 1); // 3.25m x 4m = 13 m²

    // Undo and verify full 1.0m push-pull still creates 1 Undo transaction
    useStudioStore.temporal.getState().undo();
    expect(polygonArea(useStudioStore.getState().project.levels[0]!.rooms[0]!.polygon)).toBeCloseTo(12, 1);

    const pushFull = store.pushPullWall(0, eastWall.id, -1.0);
    expect(pushFull.ok).toBe(true);
    const expanded = useStudioStore.getState().project.levels[0]!;
    expect(polygonArea(expanded.rooms[0]!.polygon)).toBeCloseTo(16, 1); // 4x4 = 16 m²

    // Exactly 1 Undo transaction created
    expect(useStudioStore.temporal.getState().pastStates.length).toBe(pastCountBefore + 1);
    useStudioStore.temporal.getState().undo();
    const revertedArea = polygonArea(useStudioStore.getState().project.levels[0]!.rooms[0]!.polygon);
    expect(revertedArea).toBeCloseTo(12, 1);
  });

  it("preserves default project open-plan and outdoor rooms during reconciliation", () => {
    const def = createDefaultProject();
    const rec0 = reconcileLevelTopology(def.levels[0]!, 0);
    expect(rec0.level.rooms.some((r) => r.id === "r1-tamu")).toBe(true);
    expect(rec0.level.rooms.some((r) => r.id === "r1-taman-belakang")).toBe(true);
  });
});
