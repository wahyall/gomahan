import type { Project, Vec3 } from "@/lib/model/types";
import { computeMasonryTakeoff, type MasonryTakeoff } from "@/lib/geometry/masonry";
import { computeLevelRoomsMetrics, type FloorLevelMetrics } from "@/lib/geometry/rooms";
import { computeRoofMetrics, validateProjectModel, type RoofDerivedMetrics, type ValidationIssue } from "@/lib/geometry/roofAndStairs";

export interface DerivedMepSummary {
  airBersihM: number;
  airKotorM: number;
  airHujanM: number;
  conduitM: number;
  kabelLampuM: number;
  kabelKontakM: number;
  kabelAcM: number;
  titikLampu: number;
  saklar: number;
  stopkontak: number;
  kloset: number;
  sink: number;
  acCount: number;
  fanCount: number;
  exhaustCount: number;
  totalElectricalWatts: number;
  recommendedPlnVa: number;
}

export interface DerivedProjectModel {
  project: Project;
  masonry: MasonryTakeoff;
  floors: FloorLevelMetrics[];
  roof: RoofDerivedMetrics;
  mep: DerivedMepSummary;
  validation: ValidationIssue[];
  totalGrossAreaM2: number;
  totalNetFloorM2: number;
  totalLotAreaM2: number;
  totalWallDeductionM2: number;
  totalWallDeductionPct: number;
  totalWallLengthM: number;
  totalDoors: number;
  totalWindows: number;
  totalVents: number;
  totalWindowAreaM2: number;
  lightingRatioPct: number;
}

function polylineLen(pts: Vec3[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

export function buildDerivedModel(project: Project): DerivedProjectModel {
  const roof = computeRoofMetrics(project);
  const masonry = computeMasonryTakeoff(project.levels, project.systems.brick, roof.extraWallHeightAt);
  const floors = project.levels.map((lv) =>
    computeLevelRoomsMetrics(lv, project.systems.brick, project.systems.tileSizeCm),
  );
  const validation = validateProjectModel(project, floors, roof);

  let airBersihM = 0;
  let airKotorM = 0;
  let airHujanM = 0;
  let kabelLampuM = 0;
  let kabelKontakM = 0;
  let kabelAcM = 0;
  let saklar = 0;
  let stopkontak = 0;
  let kloset = 0;
  let sink = 0;
  let titikLampu = 0;
  let acCount = 0;
  let fanCount = 0;
  let exhaustCount = 0;
  let totalElectricalWatts = 0;

  for (const lv of project.levels) {
    for (const r of lv.mepRoutes) {
      const len = polylineLen(r.pts);
      if (r.kind === "air_bersih") airBersihM += len;
      else if (r.kind === "air_kotor") airKotorM += len;
      else if (r.kind === "air_hujan") airHujanM += len;
      else if (r.kind === "listrik_lampu") kabelLampuM += len;
      else if (r.kind === "listrik_kontak") kabelKontakM += len;
      else if (r.kind === "listrik_ac") kabelAcM += len;
    }
    for (const p of lv.mepPoints) {
      if (p.kind === "saklar") saklar++;
      else if (p.kind === "stopkontak") stopkontak++;
      else if (p.kind === "kloset") kloset++;
      else if (p.kind === "sink") sink++;
    }
    titikLampu += lv.lights.length;
    for (const l of lv.lights) {
      totalElectricalWatts += Math.round(l.lumens / 90);
    }
    for (const h of lv.hvac) {
      totalElectricalWatts += h.powerW;
      if (h.type === "ac_split") {
        acCount++;
        // Dynamic AC power feeder per placed unit
        kabelAcM += Math.max(4, Math.hypot(h.position.x - 0.35, h.position.z - 4.15) * 0.5);
      } else if (h.type === "exhaust_fan") {
        exhaustCount++;
      } else {
        fanCount++;
      }
    }
  }

  // Approximate switch count matched to lights when no explicit switches placed
  saklar = Math.max(saklar, Math.ceil(titikLampu * 0.7));
  const conduitM = kabelLampuM + kabelKontakM + kabelAcM;
  // Base appliance reserve (refrigerator, pump, iron, rice cooker ~ 1100 W) + simultaneous factor 0.75
  const peakWatts = totalElectricalWatts * 0.75 + 900;
  const recommendedPlnVa =
    peakWatts <= 1150 ? 1300 : peakWatts <= 1950 ? 2200 : peakWatts <= 3150 ? 3500 : peakWatts <= 3950 ? 4400 : 5500;

  const totalLotAreaM2 = project.site.width * project.site.depth;
  const totalGrossAreaM2 = floors.reduce((s, f) => s + f.grossAreaM2, 0);
  const totalNetFloorM2 = floors.reduce((s, f) => s + f.netFloorAreaM2, 0);
  const totalWallDeductionM2 = Math.max(0, totalGrossAreaM2 - totalNetFloorM2);
  const totalWallDeductionPct = totalGrossAreaM2 > 0 ? (totalWallDeductionM2 / totalGrossAreaM2) * 100 : 0;

  let totalWallLengthM = 0;
  let totalDoors = 0;
  let totalWindows = 0;
  let totalVents = 0;
  let totalWindowAreaM2 = 0;
  for (const lv of project.levels) {
    for (const w of lv.walls) {
      totalWallLengthM += Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
      for (const o of w.openings) {
        if (o.kind === "door") totalDoors++;
        else if (o.kind === "window") {
          totalWindows++;
          totalWindowAreaM2 += o.width * o.height;
        } else if (o.kind === "vent") totalVents++;
      }
    }
  }

  const enclosedNet = floors.reduce(
    (s, lv) =>
      s +
      lv.rooms
        .filter((r) => r.room.program !== "garden" && r.room.program !== "carport" && r.room.program !== "balcony" && r.room.program !== "void")
        .reduce((a, r) => a + r.netAreaM2, 0),
    0,
  );

  return {
    project,
    masonry,
    floors,
    roof,
    mep: {
      airBersihM,
      airKotorM,
      airHujanM,
      conduitM,
      kabelLampuM,
      kabelKontakM,
      kabelAcM,
      titikLampu,
      saklar,
      stopkontak,
      kloset,
      sink,
      acCount,
      fanCount,
      exhaustCount,
      totalElectricalWatts,
      recommendedPlnVa,
    },
    validation,
    totalGrossAreaM2,
    totalNetFloorM2,
    totalLotAreaM2,
    totalWallDeductionM2,
    totalWallDeductionPct,
    totalWallLengthM,
    totalDoors,
    totalWindows,
    totalVents,
    totalWindowAreaM2,
    lightingRatioPct: enclosedNet > 0 ? (totalWindowAreaM2 / enclosedNet) * 100 : 0,
  };
}
