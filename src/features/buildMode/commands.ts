import {
  cloneBuildDocument,
  floorCellKey,
  type BuildDocument,
  type BuildFloorCell,
  type BuildObject,
  type BuildOpening,
  type BuildRoof,
  type BuildStair,
  type BuildWall,
} from "@/features/buildMode/types";

/**
 * Pure Command pattern for Build Mode so every mutation can be undone/redone cleanly (`Ctrl+Z` / `Ctrl+Y`).
 */
export interface BuildCommand {
  readonly id: string;
  readonly label: string;
  execute(doc: BuildDocument): BuildDocument;
  undo(doc: BuildDocument): BuildDocument;
}

let cmdSeq = 0;
function nextCmdId(prefix: string): string {
  cmdSeq += 1;
  return `${prefix}-${cmdSeq}-${Date.now().toString(36)}`;
}

/**
 * Snapshot-paired command helper: guarantees exact symmetrical Undo/Redo without mutating existing history states.
 */
export function createDocumentPatchCommand(
  label: string,
  prefix: string,
  mutator: (draft: BuildDocument) => void,
): BuildCommand {
  let prevSnapshot: BuildDocument | null = null;
  let nextSnapshot: BuildDocument | null = null;

  return {
    id: nextCmdId(prefix),
    label,
    execute(doc: BuildDocument): BuildDocument {
      if (!prevSnapshot) {
        prevSnapshot = cloneBuildDocument(doc);
      }
      if (!nextSnapshot) {
        const draft = cloneBuildDocument(doc);
        mutator(draft);
        draft.updatedAt = new Date().toISOString();
        nextSnapshot = draft;
      }
      return cloneBuildDocument(nextSnapshot);
    },
    undo(doc: BuildDocument): BuildDocument {
      if (!prevSnapshot) return doc;
      return cloneBuildDocument(prevSnapshot);
    },
  };
}

export function makeReplaceDocumentCommand(label: string, replacement: BuildDocument): BuildCommand {
  return createDocumentPatchCommand(label, "replace", (draft) => {
    const clean = cloneBuildDocument(replacement);
    draft.id = clean.id;
    draft.lot = clean.lot;
    draft.levels = clean.levels;
    draft.walls = clean.walls;
    draft.openings = clean.openings;
    draft.floorCells = clean.floorCells;
    draft.stairs = clean.stairs;
    draft.roofs = clean.roofs;
    draft.objects = clean.objects;
  });
}

export function makeUpdateBudgetCommand(budgetIdr: number): BuildCommand {
  return createDocumentPatchCommand("Ubah Target Anggaran", "budget", (draft) => {
    draft.lot.budgetIdr = Math.max(50_000_000, Math.round(budgetIdr));
  });
}

export function makeUpdateFoundationHeightCommand(foundationHeight: number): BuildCommand {
  return createDocumentPatchCommand("Ubah Tinggi Pondasi / Peil", "peil", (draft) => {
    draft.lot.foundationHeight = Math.max(0.1, Math.min(1.5, Number(foundationHeight.toFixed(2))));
  });
}

export function makeAddWallCommand(wall: BuildWall): BuildCommand {
  return createDocumentPatchCommand(`Tambah Dinding`, "wall-add", (draft) => {
    draft.walls.push(structuredClone(wall));
  });
}

export function makeDeleteWallCommand(wallId: string): BuildCommand {
  return createDocumentPatchCommand(`Hapus Dinding`, "wall-del", (draft) => {
    draft.walls = draft.walls.filter((w) => w.id !== wallId);
    draft.openings = draft.openings.filter((o) => o.wallId !== wallId);
  });
}

export function makePaintFloorCellsCommand(cells: BuildFloorCell[]): BuildCommand {
  return createDocumentPatchCommand(`Ubah Lantai (${cells.length} ubin)`, "floor-paint", (draft) => {
    for (const c of cells) {
      draft.floorCells[floorCellKey(c.levelIndex, c.gx, c.gz)] = structuredClone(c);
    }
  });
}

export function makeClearFloorCellsCommand(keys: string[]): BuildCommand {
  return createDocumentPatchCommand(`Hapus Lantai`, "floor-del", (draft) => {
    for (const key of keys) {
      delete draft.floorCells[key];
    }
  });
}

export function makeUpsertOpeningCommand(opening: BuildOpening): BuildCommand {
  return createDocumentPatchCommand(`Pasang Pintu/Jendela`, "opening-upsert", (draft) => {
    const idx = draft.openings.findIndex((o) => o.id === opening.id);
    if (idx >= 0) draft.openings[idx] = structuredClone(opening);
    else draft.openings.push(structuredClone(opening));
  });
}

export function makeUpsertStairCommand(stair: BuildStair): BuildCommand {
  return createDocumentPatchCommand(`Pasang Tangga`, "stair-upsert", (draft) => {
    const idx = draft.stairs.findIndex((s) => s.id === stair.id);
    if (idx >= 0) draft.stairs[idx] = structuredClone(stair);
    else draft.stairs.push(structuredClone(stair));
  });
}

export function makeUpsertRoofCommand(roof: BuildRoof): BuildCommand {
  return createDocumentPatchCommand(`Ubah Atap`, "roof-upsert", (draft) => {
    const idx = draft.roofs.findIndex((r) => r.id === roof.id);
    if (idx >= 0) draft.roofs[idx] = structuredClone(roof);
    else draft.roofs.push(structuredClone(roof));
  });
}

export function makeUpsertObjectCommand(obj: BuildObject): BuildCommand {
  return createDocumentPatchCommand(`Tempatkan Objek`, "obj-upsert", (draft) => {
    const idx = draft.objects.findIndex((o) => o.id === obj.id);
    if (idx >= 0) draft.objects[idx] = structuredClone(obj);
    else draft.objects.push(structuredClone(obj));
  });
}

export function makeDeleteObjectCommand(objectId: string): BuildCommand {
  return createDocumentPatchCommand(`Hapus Objek`, "obj-del", (draft) => {
    draft.objects = draft.objects.filter((o) => o.id !== objectId);
  });
}
