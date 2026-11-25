import { z } from "zod";

const vec2Schema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
});

const vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const brickSpecSchema = z.object({
  preset: z.enum(["hebel", "merah", "batako", "precast", "custom"]),
  name: z.string().min(1),
  lengthMm: z.number().min(80).max(1200),
  heightMm: z.number().min(30).max(600),
  depthMm: z.number().min(50).max(300),
  outerThicknessMm: z.number().min(60).max(350),
  innerThicknessMm: z.number().min(50).max(300),
  mortarMm: z.number().min(1).max(30),
  bondPattern: z.enum(["running", "stack", "english"]),
  wastePct: z.number().min(0).max(30),
  mortarKind: z.enum(["thinbed", "cement_sand"]),
  plasterBothSides: z.boolean(),
});

export const architectureSystemSchema = z.object({
  foundation: z.enum([
    "footplate_batukali",
    "footplate_full",
    "strauss_pile",
    "cakar_ayam",
    "elevated_flood",
  ]),
  frame: z.enum(["rc_moment_frame", "steel_wf"]),
  slab: z.enum(["rc_slab_12", "bondek_wiremesh", "aac_panel"]),
  roofType: z.enum(["shed_front", "shed_back", "gable", "hip", "flat_deck"]),
  roofCover: z.enum([
    "standing_seam",
    "spandek_pasir",
    "genteng_beton",
    "genteng_keramik",
  ]),
  roofSlopeDeg: z.number().min(2).max(45),
  overhangFrontM: z.number().min(0).max(1.5),
  overhangBackM: z.number().min(0).max(1.5),
  overhangSideM: z.number().min(0).max(1.0),
  insulationMm: z.number().min(0).max(100),
  gutterWidthMm: z.number().min(100).max(350),
  downspoutCount: z.number().int().min(1).max(8),
  downspoutDiaMm: z.number().min(63).max(160),
  brick: brickSpecSchema,
  tileSizeCm: z.union([z.literal(30), z.literal(40), z.literal(60)]),
});

export const openingSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["door", "window", "vent", "skylight", "arch"]),
  width: z.number().min(0.2).max(4.8),
  height: z.number().min(0.15).max(3.4),
  sill: z.number().min(0).max(3.4),
  offset: z.number().min(0).max(20),
  swing: z.union([z.literal(1), z.literal(-1)]),
  openPct: z.number().min(0).max(100),
  frameMaterialId: z.string(),
  glassMaterialId: z.string().optional(),
  label: z.string(),
});

export const wallSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  start: vec2Schema,
  end: vec2Schema,
  thickness: z.number().min(0.05).max(0.4),
  height: z.number().min(0.5).max(6),
  materialId: z.string(),
  exterior: z.boolean(),
  partyWallSide: z.enum(["left", "right"]).nullable().optional(),
  openings: z.array(openingSchema),
});

export const roomSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  program: z.enum([
    "living",
    "dining",
    "kitchen",
    "bedroom",
    "bathroom",
    "service",
    "circulation",
    "garden",
    "carport",
    "balcony",
    "void",
  ]),
  polygon: z.array(vec2Schema).min(3),
  floorMaterialId: z.string(),
  ceilingHeight: z.number().min(2).max(12),
});

export const slabSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  polygon: z.array(vec2Schema).min(3),
  thickness: z.number().min(0.05).max(0.5),
  materialId: z.string(),
  isVoid: z.boolean().optional(),
  isOverhang: z.boolean().optional(),
});

export const stairSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  start: vec2Schema,
  end: vec2Schema,
  width: z.number().min(0.6).max(2.0),
  floorHeight: z.number().min(2.4).max(4.5),
  riserCount: z.number().int().min(10).max(28),
  treadDepth: z.number().min(0.22).max(0.35),
  shape: z.enum(["straight", "L", "U"]),
  landingDepth: z.number().min(0.6).max(2.0),
});

export const furnitureSchema = z.object({
  id: z.string().min(1),
  catalogId: z.string(),
  name: z.string(),
  category: z.enum([
    "seating",
    "table",
    "bed",
    "storage",
    "kitchen",
    "sanitary",
    "vehicle",
    "plant",
    "decor",
  ]),
  position: vec3Schema,
  size: vec3Schema,
  rotationY: z.number().finite(),
  colorHex: z.string(),
  accentHex: z.string().optional(),
});

export const lightFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["ceiling", "pendant", "wall", "spot", "strip", "garden"]),
  position: vec3Schema,
  lumens: z.number().min(100).max(10000),
  colorTempK: z.number().min(2000).max(7000),
  beamAngleDeg: z.number().min(15).max(180),
  dimmer: z.number().min(0).max(1),
  on: z.boolean(),
});

export const hvacUnitSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["ac_split", "ceiling_fan", "stand_fan", "exhaust_fan"]),
  position: vec3Schema,
  rotationY: z.number().finite(),
  pkRating: z
    .union([z.literal(0.5), z.literal(1), z.literal(1.5), z.literal(2)])
    .optional(),
  flowRateM3h: z.number().min(40).max(4000),
  coolingCapacityW: z.number().min(0).max(8000),
  powerW: z.number().min(10).max(3000),
  setpointC: z.number().min(16).max(30),
  speedLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  on: z.boolean(),
});

export const mepPointSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "meter_air",
    "panel_mcb",
    "lampu",
    "saklar",
    "stopkontak",
    "kran",
    "shower",
    "kloset",
    "wastafel",
    "sink",
    "drain",
    "outdoor_ac",
  ]),
  label: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const mepRouteSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "air_bersih",
    "air_kotor",
    "listrik_lampu",
    "listrik_kontak",
    "listrik_ac",
    "air_hujan",
  ]),
  label: z.string(),
  pts: z.array(vec3Schema).min(2),
});

export const levelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  index: z.number().int().min(0).max(5),
  elevation: z.number().finite(),
  height: z.number().min(2.4).max(5),
  walls: z.array(wallSchema),
  slabs: z.array(slabSchema),
  stairs: z.array(stairSchema),
  rooms: z.array(roomSchema),
  furniture: z.array(furnitureSchema),
  lights: z.array(lightFixtureSchema),
  hvac: z.array(hvacUnitSchema),
  mepPoints: z.array(mepPointSchema),
  mepRoutes: z.array(mepRouteSchema),
});

export const CURRENT_PROJECT_SCHEMA_VERSION = 2 as const;

export const projectSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CURRENT_PROJECT_SCHEMA_VERSION),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  site: z.object({
    width: z.number().min(3).max(30),
    depth: z.number().min(6).max(60),
    orientationDeg: z.number().min(0).max(360),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    partyWallLeft: z.boolean(),
    partyWallRight: z.boolean(),
    soil: z.object({
      city: z.string(),
      allowableBearingKpa: z.number().min(30).max(500),
      siteClass: z.enum(["SC", "SD", "SE"]),
      groundwaterDepthM: z.number().min(0.2).max(15),
      permeabilityCmH: z.number().min(0.2).max(20),
    }),
    peil: z.object({
      streetLevelM: z.number(),
      carportPeilM: z.number().min(0).max(1.5),
      terracePeilM: z.number().min(0).max(2.0),
      floor1PeilM: z.number().min(0.1).max(2.5),
    }),
  }),
  systems: architectureSystemSchema,
  floodMitigation: z.object({
    infiltrationWells: z.number().int().min(0).max(6),
    backflowValve: z.boolean(),
    doorFloodBarrier: z.boolean(),
    barrierHeightCm: z.number().min(30).max(120),
    submersiblePump: z.boolean(),
    wallWaterproofing: z.boolean(),
    outletHeightM: z.number().min(0.2).max(1.6),
    mcbHeightM: z.number().min(1.1).max(2.1),
  }),
  levels: z.array(levelSchema).min(1),
  priceBook: z.object({
    id: z.string(),
    region: z.string(),
    currency: z.literal("IDR"),
    effectiveDate: z.string(),
    source: z.string(),
    items: z.record(
      z.string(),
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        unit: z.string(),
        materialPrice: z.number().min(0),
        laborPrice: z.number().min(0),
        equipmentPrice: z.number().min(0),
        ohPekerja: z.number().min(0).optional(),
        ohTukang: z.number().min(0).optional(),
        ohKepala: z.number().min(0).optional(),
        ohMandor: z.number().min(0).optional(),
        notes: z.string().optional(),
      }),
    ),
  }),
  rabSettings: z.object({
    laborMode: z.enum(["ahsp_oh", "borongan_pct"]),
    boronganPct: z.number().min(0).max(60),
    overheadPct: z.number().min(0).max(25),
    profitPct: z.number().min(0).max(25),
    vatPct: z.number().min(0).max(15),
    contingencyPct: z.number().min(0).max(25),
    plnVaTier: z.union([
      z.literal(1300),
      z.literal(2200),
      z.literal(3500),
      z.literal(4400),
      z.literal(5500),
    ]),
  }),
  structuralParams: z.object({
    concreteFcMpa: z.number().min(15).max(45),
    rebarFyMpa: z.number().min(240).max(550),
    liveLoadRoomKpa: z.number().min(1.5).max(5),
    liveLoadStairBalconyKpa: z.number().min(2).max(5),
    liveLoadRoofKpa: z.number().min(0.5).max(3),
    seismicR: z.number().min(3).max(8),
    seismicI: z.number().min(1).max(1.5),
    windPressureKpa: z.number().min(0.1).max(1.5),
    coverFoundationMm: z.number().min(30).max(75),
    coverBeamColMm: z.number().min(20).max(50),
    coverSlabMm: z.number().min(15).max(40),
    engineerReviewed: z.boolean(),
    reviewerName: z.string(),
    drawingRevision: z.string(),
  }),
  simulation: z.object({
    hourOfDay: z.number().min(0).max(24),
    season: z.enum(["kemarau", "hujan"]),
    windDirectionDeg: z.number().min(0).max(360),
    windSpeedMs: z.number().min(0).max(15),
    ambientTempC: z.number().min(20).max(42),
    humidityPct: z.number().min(30).max(100),
    rainIntensityMmH: z.number().min(0).max(150),
    lightningEnabled: z.boolean(),
    floodDepthCm: z.number().min(0).max(150),
    paintExtHex: z.string(),
    paintIntHex: z.string(),
    roofColorHex: z.string(),
  }),
  stageProgress: z.record(
    z.string(),
    z.object({
      progressPct: z.number().min(0).max(100),
      actualCost: z.number().min(0),
      crewOverride: z.number().min(1).max(30).optional(),
      durationOverrideDays: z.number().min(1).max(120).optional(),
      startOffsetDays: z.number().min(-30).max(180).optional(),
    }),
  ),
  gamification: z.object({
    mode: z.enum(["simple", "pro"]),
    budgetCapIdr: z.number().min(50_000_000),
    soundEnabled: z.boolean(),
    completedQuests: z.array(z.string()),
    siteChecklistDone: z.record(z.string(), z.boolean()),
  }),
});

export type VersionedSaveParseResult =
  | { status: "ok"; data: z.infer<typeof projectSchema> }
  | { status: "legacy_ignored"; legacyVersion: number; message: string }
  | { status: "invalid"; message: string };

export function parseVersionedProjectSave(raw: unknown): VersionedSaveParseResult {
  if (!raw || typeof raw !== "object") {
    return { status: "invalid", message: "Data JSON bukan objek proyek yang valid." };
  }
  const obj = raw as Record<string, unknown>;
  const ver = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 1;
  if (ver < CURRENT_PROJECT_SCHEMA_VERSION) {
    return {
      status: "legacy_ignored",
      legacyVersion: ver,
      message: `Data save versi lama (v${ver}) tidak kompatibel dengan sistem grid Build Mode & Walk Mode baru. Data lama diabaikan dengan aman dan lot standar v${CURRENT_PROJECT_SCHEMA_VERSION} dimuat.`,
    };
  }
  const res = projectSchema.safeParse(raw);
  if (!res.success) {
    return {
      status: "invalid",
      message: `Format JSON v${ver} tidak valid: ${res.error.issues[0]?.message ?? "schema error"}`,
    };
  }
  return { status: "ok", data: res.data };
}

export function validateProjectImport(raw: unknown) {
  return projectSchema.safeParse(raw);
}
