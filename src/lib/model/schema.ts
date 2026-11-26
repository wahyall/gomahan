import { z } from "zod";
import {
  AMBIENT_TEMP_MAX_C,
  AMBIENT_TEMP_MIN_C,
  FC_MAX_MPA,
  FC_MIN_MPA,
  FY_MAX_MPA,
  FY_MIN_MPA,
  LEVEL_COUNT,
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
  SITE_DEPTH_M,
  SITE_WIDTH_M,
  WIND_SPEED_MAX_MS,
  WIND_SPEED_MIN_MS,
} from "@/lib/model/constants";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { createSurabayaPriceBook } from "@/lib/model/priceBook";

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
  lengthMm: z.number().finite().min(80).max(1200),
  heightMm: z.number().finite().min(30).max(600),
  depthMm: z.number().finite().min(50).max(300),
  outerThicknessMm: z.number().finite().min(60).max(350),
  innerThicknessMm: z.number().finite().min(50).max(300),
  mortarMm: z.number().finite().min(1).max(30),
  bondPattern: z.enum(["running", "stack", "english"]),
  wastePct: z.number().finite().min(0).max(30),
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
  roofSlopeDeg: z.number().finite().min(2).max(45),
  overhangFrontM: z.number().finite().min(0).max(1.5),
  overhangBackM: z.number().finite().min(0).max(1.5),
  overhangSideM: z.number().finite().min(0).max(1.0),
  insulationMm: z.number().finite().min(0).max(100),
  gutterWidthMm: z.number().finite().min(100).max(350),
  downspoutCount: z.number().int().min(1).max(8),
  downspoutDiaMm: z.number().finite().min(63).max(160),
  brick: brickSpecSchema,
  tileSizeCm: z.union([z.literal(30), z.literal(40), z.literal(60)]),
});

export const openingSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["door", "window", "vent", "skylight", "arch"]),
  width: z.number().finite().min(0.2).max(4.8),
  height: z.number().finite().min(0.15).max(3.4),
  sill: z.number().finite().min(0).max(3.4),
  offset: z.number().finite().min(0).max(20),
  swing: z.union([z.literal(1), z.literal(-1)]),
  openPct: z.number().finite().min(0).max(100),
  frameMaterialId: z.string(),
  glassMaterialId: z.string().optional(),
  label: z.string(),
});

export const wallSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    start: vec2Schema,
    end: vec2Schema,
    thickness: z.number().finite().min(0.05).max(0.4),
    height: z.number().finite().min(0.5).max(6),
    materialId: z.string(),
    exterior: z.boolean(),
    partyWallSide: z.enum(["left", "right"]).nullable().optional(),
    openings: z.array(openingSchema),
  })
  .refine(
    (w) => {
      const len = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      return w.openings.every(
        (op) => op.offset >= 0 && op.offset <= len + 0.02 && op.sill + op.height <= w.height + 0.05,
      );
    },
    "Bukaan dinding melebihi panjang atau tinggi dinding",
  );

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
  ceilingHeight: z.number().finite().min(2).max(12),
});

export const slabSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  polygon: z.array(vec2Schema).min(3),
  thickness: z.number().finite().min(0.05).max(0.5),
  materialId: z.string(),
  isVoid: z.boolean().optional(),
  isOverhang: z.boolean().optional(),
});

export const stairSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  start: vec2Schema,
  end: vec2Schema,
  width: z.number().finite().min(0.6).max(2.0),
  floorHeight: z.number().finite().min(2.4).max(4.5),
  riserCount: z.number().int().min(10).max(28),
  treadDepth: z.number().finite().min(0.22).max(0.35),
  shape: z.enum(["straight", "L", "U"]),
  landingDepth: z.number().finite().min(0.6).max(2.0),
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
  size: z.object({
    x: z.number().finite().positive(),
    y: z.number().finite().positive(),
    z: z.number().finite().positive(),
  }),
  rotationY: z.number().finite(),
  colorHex: z.string(),
  accentHex: z.string().optional(),
});

export const lightFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["ceiling", "pendant", "wall", "spot", "strip", "garden"]),
  position: vec3Schema,
  rotationY: z.number().finite().optional(),
  lumens: z.number().finite().min(100).max(10000),
  colorTempK: z.number().finite().min(2000).max(7000),
  beamAngleDeg: z.number().finite().min(15).max(180),
  dimmer: z.number().finite().min(0).max(1),
  on: z.boolean(),
});

export const hvacUnitSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["ac_split", "ceiling_fan", "stand_fan", "wall_fan", "exhaust_fan"]),
  position: vec3Schema,
  rotationY: z.number().finite(),
  pkRating: z
    .union([z.literal(0.5), z.literal(1), z.literal(1.5), z.literal(2)])
    .optional(),
  flowRateM3h: z.number().finite().min(40).max(4000),
  coolingCapacityW: z.number().finite().min(0).max(8000),
  powerW: z.number().finite().min(10).max(3000),
  setpointC: z.number().finite().min(16).max(30),
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

export const levelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  index: z.number().int().min(0).max(LEVEL_COUNT - 1),
  elevation: z.number().finite(),
  height: z.number().finite().min(2.4).max(5),
  walls: z.array(wallSchema),
  slabs: z.array(slabSchema),
  stairs: z.array(stairSchema),
  rooms: z.array(roomSchema),
  furniture: z.array(furnitureSchema),
  lights: z.array(lightFixtureSchema),
  hvac: z.array(hvacUnitSchema),
  mepPoints: z.array(mepPointSchema),
});

export const CURRENT_PROJECT_SCHEMA_VERSION = 3 as const;

export const projectSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CURRENT_PROJECT_SCHEMA_VERSION),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  site: z.object({
    width: z
      .number()
      .finite()
      .refine((v) => Math.abs(v - SITE_WIDTH_M) <= 0.001, "Ukuran lebar kavling dikunci 5 m"),
    depth: z
      .number()
      .finite()
      .refine((v) => Math.abs(v - SITE_DEPTH_M) <= 0.001, "Ukuran panjang kavling dikunci 17 m"),
    orientationDeg: z.number().finite().min(0).max(360),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    partyWallLeft: z.boolean(),
    partyWallRight: z.boolean(),
    soil: z.object({
      city: z.string(),
      allowableBearingKpa: z.number().finite().min(30).max(500),
      siteClass: z.enum(["SC", "SD", "SE"]),
      groundwaterDepthM: z.number().finite().min(0.2).max(15),
      permeabilityCmH: z.number().finite().min(0.2).max(20),
    }),
    peil: z
      .object({
        streetLevelM: z.number().finite().min(PEIL_STREET_MIN_M).max(PEIL_STREET_MAX_M),
        carportPeilM: z.number().finite().min(PEIL_CARPORT_MIN_M).max(PEIL_CARPORT_MAX_M),
        terracePeilM: z.number().finite().min(PEIL_TERRACE_MIN_M).max(PEIL_TERRACE_MAX_M),
        floor1PeilM: z.number().finite().min(PEIL_FLOOR1_MIN_M).max(PEIL_FLOOR1_MAX_M),
      })
      .refine(
        (p) =>
          p.streetLevelM <= p.carportPeilM + 1e-6 &&
          p.carportPeilM <= p.terracePeilM + 1e-6 &&
          p.terracePeilM <= p.floor1PeilM + 1e-6,
        "Urutan elevasi peil tidak valid (jalan <= carport <= teras <= lantai 1)",
      ),
  }),
  systems: architectureSystemSchema,
  floodMitigation: z.object({
    infiltrationWells: z.number().int().min(0).max(6),
    backflowValve: z.boolean(),
    doorFloodBarrier: z.boolean(),
    barrierHeightCm: z.number().finite().min(30).max(120),
    submersiblePump: z.boolean(),
    wallWaterproofing: z.boolean(),
    outletHeightM: z.number().finite().min(OUTLET_HEIGHT_MIN_M).max(OUTLET_HEIGHT_MAX_M),
    mcbHeightM: z.number().finite().min(MCB_HEIGHT_MIN_M).max(MCB_HEIGHT_MAX_M),
  }),
  levels: z.array(levelSchema).min(1).max(LEVEL_COUNT),
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
        materialPrice: z.number().finite().min(0),
        laborPrice: z.number().finite().min(0),
        equipmentPrice: z.number().finite().min(0),
        ohPekerja: z.number().finite().min(0).optional(),
        ohTukang: z.number().finite().min(0).optional(),
        ohKepala: z.number().finite().min(0).optional(),
        ohMandor: z.number().finite().min(0).optional(),
        notes: z.string().optional(),
      }),
    ),
  }),
  rabSettings: z.object({
    laborMode: z.enum(["ahsp_oh", "borongan_pct"]),
    boronganPct: z.number().finite().min(0).max(60),
    overheadPct: z.number().finite().min(0).max(25),
    profitPct: z.number().finite().min(0).max(25),
    vatPct: z.number().finite().min(0).max(15),
    contingencyPct: z.number().finite().min(0).max(25),
    plnVaTier: z.union([
      z.literal(1300),
      z.literal(2200),
      z.literal(3500),
      z.literal(4400),
      z.literal(5500),
    ]),
  }),
  structuralParams: z.object({
    concreteFcMpa: z.number().finite().min(FC_MIN_MPA).max(FC_MAX_MPA),
    rebarFyMpa: z.number().finite().min(FY_MIN_MPA).max(FY_MAX_MPA),
    liveLoadRoomKpa: z.number().finite().min(1.5).max(5),
    liveLoadStairBalconyKpa: z.number().finite().min(2).max(5),
    liveLoadRoofKpa: z.number().finite().min(0.5).max(3),
    seismicR: z.number().finite().min(SEISMIC_R_MIN).max(SEISMIC_R_MAX),
    seismicI: z.number().finite().min(1).max(1.5),
    windPressureKpa: z.number().finite().min(0.1).max(1.5),
    coverFoundationMm: z.number().finite().min(30).max(75),
    coverBeamColMm: z.number().finite().min(20).max(50),
    coverSlabMm: z.number().finite().min(15).max(40),
    engineerReviewed: z.boolean(),
    reviewerName: z.string(),
    drawingRevision: z.string(),
  }),
  simulation: z.object({
    hourOfDay: z.number().finite().min(0).max(24),
    season: z.enum(["kemarau", "hujan"]),
    windDirectionDeg: z.number().finite().min(0).max(360),
    windSpeedMs: z.number().finite().min(WIND_SPEED_MIN_MS).max(WIND_SPEED_MAX_MS),
    ambientTempC: z.number().finite().min(AMBIENT_TEMP_MIN_C).max(AMBIENT_TEMP_MAX_C),
    humidityPct: z.number().finite().min(30).max(100),
    rainIntensityMmH: z.number().finite().min(RAIN_MIN_MM_H).max(RAIN_MAX_MM_H),
    lightningEnabled: z.boolean(),
    floodDepthCm: z.number().finite().min(0).max(150),
    paintExtHex: z.string(),
    paintIntHex: z.string(),
    roofColorHex: z.string(),
  }),
  stageProgress: z.record(
    z.string(),
    z.object({
      progressPct: z.number().finite().min(0).max(100),
      actualCost: z.number().finite().min(0),
      crewOverride: z.number().finite().min(1).max(30).optional(),
      durationOverrideDays: z.number().finite().min(1).max(120).optional(),
      startOffsetDays: z.number().finite().min(-30).max(180).optional(),
    }),
  ),
  budgetCapIdr: z.number().finite().min(50_000_000),
  siteChecklistDone: z.record(z.string(), z.boolean()),
  buildExtras: z
    .object({
      floorTiles: z.array(
        z.object({
          levelIndex: z.number().int().min(0).max(1),
          gx: z.number().int(),
          gz: z.number().int(),
          materialId: z.string(),
        }),
      ),
      pools: z.array(
        z
          .object({
            id: z.string(),
            gx1: z.number().int(),
            gz1: z.number().int(),
            gx2: z.number().int(),
            gz2: z.number().int(),
            depth: z.number().finite().min(0.4).max(3),
          })
          .refine((p) => p.gx1 <= p.gx2 && p.gz1 <= p.gz2, "Koordinat kolam gx1 <= gx2 & gz1 <= gz2"),
      ),
      terrainHeights: z.array(z.number().finite()),
    })
    .optional(),
});

export type VersionedSaveParseResult =
  | { status: "ok"; data: z.infer<typeof projectSchema>; migratedFromVersion?: number }
  | { status: "invalid"; message: string };

/**
 * Normalize v1/v2 save structures forward to v3 while keeping core user geometry intact.
 * Preserves legacy budgetCapIdr & siteChecklistDone and merges missing default priceBook items.
 */
export function migrateProjectSave(raw: unknown): VersionedSaveParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "invalid", message: "Data JSON bukan objek proyek yang valid." };
  }
  const src = raw as Record<string, unknown>;
  const rawVer =
    typeof src.schemaVersion === "number"
      ? src.schemaVersion
      : typeof src.schemaVersion === "string"
        ? Number(src.schemaVersion)
        : 1;

  if (!Number.isFinite(rawVer) || rawVer < 1 || rawVer > CURRENT_PROJECT_SCHEMA_VERSION) {
    return {
      status: "invalid",
      message: `Versi skema save tidak dikenal (v${String(src.schemaVersion ?? "?")}).`,
    };
  }

  let draft: Record<string, unknown>;
  try {
    draft = structuredClone(src);
  } catch {
    return { status: "invalid", message: "Data JSON mengandung referensi yang tidak dapat dibaca." };
  }

  const defaults = createDefaultProject();
  const defaultPb = createSurabayaPriceBook();
  const legacyGam =
    draft.gamification && typeof draft.gamification === "object"
      ? (draft.gamification as Record<string, unknown>)
      : undefined;

  // Migrate top-level fields from v1/v2 defaults & remove obsolete gamification block
  if (typeof draft.budgetCapIdr !== "number" || !Number.isFinite(draft.budgetCapIdr)) {
    const legacyCap = typeof legacyGam?.budgetCapIdr === "number" && Number.isFinite(legacyGam.budgetCapIdr)
      ? legacyGam.budgetCapIdr
      : defaults.budgetCapIdr;
    draft.budgetCapIdr = Math.max(50_000_000, legacyCap);
  }
  if (!draft.siteChecklistDone || typeof draft.siteChecklistDone !== "object") {
    draft.siteChecklistDone =
      legacyGam?.siteChecklistDone && typeof legacyGam.siteChecklistDone === "object"
        ? legacyGam.siteChecklistDone
        : {};
  }
  delete draft.gamification;

  if (!draft.floodMitigation || typeof draft.floodMitigation !== "object") {
    draft.floodMitigation = { ...defaults.floodMitigation };
  } else {
    draft.floodMitigation = { ...defaults.floodMitigation, ...(draft.floodMitigation as Record<string, unknown>) };
  }
  if (!draft.structuralParams || typeof draft.structuralParams !== "object") {
    draft.structuralParams = { ...defaults.structuralParams };
  } else {
    draft.structuralParams = { ...defaults.structuralParams, ...(draft.structuralParams as Record<string, unknown>) };
  }
  if (!draft.rabSettings || typeof draft.rabSettings !== "object") {
    draft.rabSettings = { ...defaults.rabSettings };
  } else {
    draft.rabSettings = { ...defaults.rabSettings, ...(draft.rabSettings as Record<string, unknown>) };
  }
  if (!draft.simulation || typeof draft.simulation !== "object") {
    draft.simulation = { ...defaults.simulation };
  } else {
    draft.simulation = { ...defaults.simulation, ...(draft.simulation as Record<string, unknown>) };
  }
  if (!draft.stageProgress || typeof draft.stageProgress !== "object") {
    draft.stageProgress = {};
  }

  // Merge missing priceBook entries cleanly without overwriting user edits
  const pb = draft.priceBook && typeof draft.priceBook === "object"
    ? (draft.priceBook as Record<string, unknown>)
    : {};
  const existingItems = pb.items && typeof pb.items === "object"
    ? (pb.items as Record<string, unknown>)
    : {};
  draft.priceBook = {
    ...defaultPb,
    ...pb,
    items: {
      ...defaultPb.items,
      ...existingItems,
    },
  };

  // Strip dead mepRoutes and ensure 1..2 levels
  if (Array.isArray(draft.levels)) {
    draft.levels = draft.levels.slice(0, LEVEL_COUNT).map((lv) => {
      if (!lv || typeof lv !== "object") return lv;
      const copy = { ...(lv as Record<string, unknown>) };
      delete copy.mepRoutes;
      return copy;
    });
  }

  // Normalize swapped pool corners cleanly when importing older builds
  if (draft.buildExtras && typeof draft.buildExtras === "object") {
    const ext = draft.buildExtras as Record<string, unknown>;
    if (Array.isArray(ext.pools) && rawVer < CURRENT_PROJECT_SCHEMA_VERSION) {
      ext.pools = ext.pools.map((pl) => {
        if (!pl || typeof pl !== "object") return pl;
        const p = pl as Record<string, unknown>;
        if (
          typeof p.gx1 === "number" &&
          typeof p.gx2 === "number" &&
          typeof p.gz1 === "number" &&
          typeof p.gz2 === "number"
        ) {
          return {
            ...p,
            gx1: Math.min(p.gx1, p.gx2),
            gx2: Math.max(p.gx1, p.gx2),
            gz1: Math.min(p.gz1, p.gz2),
            gz2: Math.max(p.gz1, p.gz2),
          };
        }
        return pl;
      });
    }
  }

  draft.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;

  const res = projectSchema.safeParse(draft);
  if (!res.success) {
    const issue = res.error.issues[0];
    return {
      status: "invalid",
      message: `Format JSON v${rawVer} tidak valid (${issue?.path.join(".") || "root"}): ${issue?.message ?? "schema error"}`,
    };
  }
  return {
    status: "ok",
    data: res.data,
    migratedFromVersion: rawVer < CURRENT_PROJECT_SCHEMA_VERSION ? rawVer : undefined,
  };
}

export function parseVersionedProjectSave(raw: unknown): VersionedSaveParseResult {
  return migrateProjectSave(raw);
}

export function validateProjectImport(raw: unknown) {
  const migrated = migrateProjectSave(raw);
  if (migrated.status === "ok") {
    return { success: true as const, data: migrated.data };
  }
  return projectSchema.safeParse(raw);
}
