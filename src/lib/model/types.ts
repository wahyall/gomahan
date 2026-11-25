export type ID = string;

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type FoundationSystem =
  | "footplate_batukali"
  | "footplate_full"
  | "strauss_pile"
  | "cakar_ayam"
  | "elevated_flood";

export type FrameSystem = "rc_moment_frame" | "steel_wf";

export type SlabSystem = "rc_slab_12" | "bondek_wiremesh" | "aac_panel";

export type RoofType = "shed_front" | "shed_back" | "gable" | "hip" | "flat_deck";

export type RoofCover = "standing_seam" | "spandek_pasir" | "genteng_beton" | "genteng_keramik";

export type MasonryPreset = "hebel" | "merah" | "batako" | "precast" | "custom";

export type BondPattern = "running" | "stack" | "english";

export interface BrickSpec {
  preset: MasonryPreset;
  name: string;
  lengthMm: number;
  heightMm: number;
  depthMm: number;
  outerThicknessMm: number;
  innerThicknessMm: number;
  mortarMm: number;
  bondPattern: BondPattern;
  wastePct: number;
  mortarKind: "thinbed" | "cement_sand";
  plasterBothSides: boolean;
}

export interface ArchitectureSystemConfig {
  foundation: FoundationSystem;
  frame: FrameSystem;
  slab: SlabSystem;
  roofType: RoofType;
  roofCover: RoofCover;
  roofSlopeDeg: number;
  overhangFrontM: number;
  overhangBackM: number;
  overhangSideM: number;
  insulationMm: number;
  gutterWidthMm: number;
  downspoutCount: number;
  downspoutDiaMm: number;
  brick: BrickSpec;
  tileSizeCm: 30 | 40 | 60;
}

export interface PeilConfig {
  streetLevelM: number;
  carportPeilM: number;
  terracePeilM: number;
  floor1PeilM: number;
}

export interface FloodMitigationConfig {
  infiltrationWells: number;
  backflowValve: boolean;
  doorFloodBarrier: boolean;
  barrierHeightCm: number;
  submersiblePump: boolean;
  wallWaterproofing: boolean;
  outletHeightM: number;
  mcbHeightM: number;
}

export interface SoilAssumption {
  city: string;
  allowableBearingKpa: number;
  siteClass: "SC" | "SD" | "SE";
  groundwaterDepthM: number;
  permeabilityCmH: number;
}

export interface Site {
  width: number; // X: 5.0 m
  depth: number; // Z: 17.0 m (Z=0 street front, Z=17 rear)
  orientationDeg: number; // degrees clockwise from north (+Z)
  latitude: number; // Surabaya -7.25
  longitude: number; // Surabaya 112.75
  partyWallLeft: boolean;
  partyWallRight: boolean;
  soil: SoilAssumption;
  peil: PeilConfig;
}

export type OpeningKind = "door" | "window" | "vent" | "skylight" | "arch";

export interface Opening {
  id: ID;
  kind: OpeningKind;
  width: number;
  height: number;
  sill: number; // elevation from level floor (m)
  offset: number; // centre along wall from start (m)
  swing: 1 | -1;
  openPct: number; // 0..100 for airflow simulation
  frameMaterialId: ID;
  glassMaterialId?: ID;
  label: string;
}

export interface Wall {
  id: ID;
  name: string;
  start: Vec2;
  end: Vec2;
  thickness: number; // m
  height: number; // m
  materialId: ID;
  exterior: boolean;
  partyWallSide?: "left" | "right" | null;
  openings: Opening[];
}

export type RoomProgram =
  | "living"
  | "dining"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "service"
  | "circulation"
  | "garden"
  | "carport"
  | "balcony"
  | "void";

export interface Room {
  id: ID;
  name: string;
  program: RoomProgram;
  polygon: Vec2[]; // centerline or logical room polygon
  floorMaterialId: ID;
  ceilingHeight: number;
}

export interface Slab {
  id: ID;
  name: string;
  polygon: Vec2[];
  thickness: number;
  materialId: ID;
  isVoid?: boolean;
  isOverhang?: boolean;
}

export interface Stair {
  id: ID;
  name: string;
  start: Vec2;
  end: Vec2;
  width: number;
  floorHeight: number;
  riserCount: number;
  treadDepth: number;
  shape: "straight" | "L" | "U";
  landingDepth: number;
}

export type FurnitureCategory =
  | "seating"
  | "table"
  | "bed"
  | "storage"
  | "kitchen"
  | "sanitary"
  | "vehicle"
  | "plant"
  | "decor";

export interface FurnitureItem {
  id: ID;
  catalogId: string;
  name: string;
  category: FurnitureCategory;
  position: Vec3; // x, y (relative to level), z
  size: Vec3; // width, height, depth
  rotationY: number;
  colorHex: string;
  accentHex?: string;
}

export type LightType = "ceiling" | "pendant" | "wall" | "spot" | "strip" | "garden";

export interface LightFixture {
  id: ID;
  name: string;
  type: LightType;
  position: Vec3;
  rotationY?: number;
  lumens: number;
  colorTempK: number;
  beamAngleDeg: number;
  dimmer: number; // 0..1
  on: boolean;
}

export type HvacType = "ac_split" | "ceiling_fan" | "stand_fan" | "wall_fan" | "exhaust_fan";

export interface HvacUnit {
  id: ID;
  name: string;
  type: HvacType;
  position: Vec3;
  rotationY: number;
  pkRating?: 0.5 | 1 | 1.5 | 2;
  flowRateM3h: number;
  coolingCapacityW: number;
  powerW: number;
  setpointC: number;
  speedLevel: 1 | 2 | 3;
  on: boolean;
}

export type MepPointKind =
  | "meter_air"
  | "panel_mcb"
  | "lampu"
  | "saklar"
  | "stopkontak"
  | "kran"
  | "shower"
  | "kloset"
  | "wastafel"
  | "sink"
  | "drain"
  | "outdoor_ac";

export interface MepPoint {
  id: ID;
  kind: MepPointKind;
  label: string;
  x: number;
  y: number; // elevation from level floor (m)
  z: number;
}

export type MepRouteKind = "air_bersih" | "air_kotor" | "listrik_lampu" | "listrik_kontak" | "listrik_ac" | "air_hujan";

export interface MepRoute {
  id: ID;
  kind: MepRouteKind;
  label: string;
  pts: Vec3[];
}

export interface Level {
  id: ID;
  name: string;
  index: number; // 0 = LT1, 1 = LT2
  elevation: number; // m above street datum (or floor1PeilM)
  height: number; // floor-to-floor m (default 3.6)
  walls: Wall[];
  slabs: Slab[];
  stairs: Stair[];
  rooms: Room[];
  furniture: FurnitureItem[];
  lights: LightFixture[];
  hvac: HvacUnit[];
  mepPoints: MepPoint[];
  mepRoutes: MepRoute[];
}

export interface PriceItem {
  id: ID;
  code: string;
  name: string;
  unit: string;
  materialPrice: number;
  laborPrice: number;
  equipmentPrice: number;
  ohPekerja?: number;
  ohTukang?: number;
  ohKepala?: number;
  ohMandor?: number;
  notes?: string;
}

export interface PriceBook {
  id: ID;
  region: string;
  currency: "IDR";
  effectiveDate: string;
  source: string;
  items: Record<string, PriceItem>;
}

export interface RabSettings {
  laborMode: "ahsp_oh" | "borongan_pct";
  boronganPct: number;
  overheadPct: number;
  profitPct: number;
  vatPct: number; // PPN 11%
  contingencyPct: number;
  plnVaTier: 1300 | 2200 | 3500 | 4400 | 5500;
}

export interface StageProgress {
  progressPct: number;
  actualCost: number;
  crewOverride?: number;
  durationOverrideDays?: number;
  startOffsetDays?: number;
}

export interface SimulationSettings {
  hourOfDay: number; // 0..24
  season: "kemarau" | "hujan";
  windDirectionDeg: number; // 0 = from front (+Z toward rear), 180 = from rear
  windSpeedMs: number;
  ambientTempC: number;
  humidityPct: number;
  rainIntensityMmH: number; // 0..120
  lightningEnabled: boolean;
  floodDepthCm: number; // 0..150 cm above street
  paintExtHex: string;
  paintIntHex: string;
  roofColorHex: string;
}

export interface StructuralParams {
  concreteFcMpa: number;
  rebarFyMpa: number;
  liveLoadRoomKpa: number;
  liveLoadStairBalconyKpa: number;
  liveLoadRoofKpa: number;
  seismicR: number;
  seismicI: number;
  windPressureKpa: number;
  coverFoundationMm: number;
  coverBeamColMm: number;
  coverSlabMm: number;
  engineerReviewed: boolean;
  reviewerName: string;
  drawingRevision: string;
}

export interface GamificationState {
  mode: "simple" | "pro";
  budgetCapIdr: number; // default 450_000_000
  soundEnabled: boolean;
  completedQuests: string[];
  siteChecklistDone: Record<string, boolean>;
}

export interface BuildTileOverride {
  levelIndex: number;
  gx: number;
  gz: number;
  materialId: string;
}

export interface BuildPoolOverride {
  id: string;
  gx1: number;
  gz1: number;
  gx2: number;
  gz2: number;
  depth: number;
}

export interface BuildExtras {
  floorTiles: BuildTileOverride[];
  pools: BuildPoolOverride[];
  terrainHeights: number[];
}

export interface Project {
  id: ID;
  schemaVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  site: Site;
  systems: ArchitectureSystemConfig;
  floodMitigation: FloodMitigationConfig;
  levels: Level[];
  priceBook: PriceBook;
  rabSettings: RabSettings;
  structuralParams: StructuralParams;
  simulation: SimulationSettings;
  stageProgress: Record<string, StageProgress>;
  gamification: GamificationState;
  buildExtras?: BuildExtras;
}
