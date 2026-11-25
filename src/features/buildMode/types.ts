import type { FurnitureCategory, HvacType, LightType, RoofType } from "@/lib/model/types";

export const CELL_SIZE = 0.5;
export const LOT_COLS = 10; // 5.0 m / 0.5 m
export const LOT_ROWS = 34; // 17.0 m / 0.5 m

export type WallVisibilityMode = "up" | "cutaway" | "down";
export type RoofVisibilityMode = "auto" | "show" | "hide";

export type BuildCategoryId =
  | "build"
  | "walls"
  | "floors"
  | "openings"
  | "stairs_roof"
  | "outdoor"
  | "furniture"
  | "hvac"
  | "lighting";

export type BuildToolId =
  | "select"
  | "wall_straight"
  | "wall_room"
  | "wall_diagonal"
  | "wall_paint"
  | "fence"
  | "floor_tile"
  | "floor_rect"
  | "floor_fill"
  | "opening"
  | "stair"
  | "roof"
  | "pool"
  | "terrain"
  | "furniture"
  | "hvac"
  | "light"
  | "eyedropper"
  | "sledgehammer";

export interface BuildCameraSnapshot {
  target: [number, number, number];
  yaw: number;
  pitch: number;
  distance: number;
}

export interface CatalogSwatch {
  id: string;
  name: string;
  hex: string;
}

export interface BuildCatalogEntry {
  id: string;
  category: BuildCategoryId;
  kind:
    | "tool"
    | "wall_material"
    | "floor_material"
    | "opening"
    | "stair"
    | "roof"
    | "outdoor"
    | "furniture"
    | "hvac"
    | "light";
  name: string;
  toolId: BuildToolId;
  specLabel: string;
  description: string;
  swatchHex: string;
  swatches?: CatalogSwatch[];
  // Payload hints mapped cleanly to `Project` entities (zero price tags!)
  sizeM?: [number, number, number];
  footprintCells?: [number, number];
  openingKind?: "door" | "window" | "vent" | "arch";
  materialId?: string;
  roofType?: RoofType;
  furnitureCategory?: FurnitureCategory;
  accentHex?: string;
  hvacMeta?: {
    type: HvacType;
    pkRating?: 0.5 | 1 | 1.5 | 2;
    flowRateM3h: number;
    coolingCapacityW: number;
    powerW: number;
    setpointC: number;
    defaultElevationM: number;
  };
  lightMeta?: {
    type: LightType;
    lumens: number;
    colorTempK: number;
    beamAngleDeg: number;
    defaultElevationM: number;
  };
}
