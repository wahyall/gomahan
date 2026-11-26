import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { SAFE_MCB_HEIGHT_M, SAFE_OUTLET_HEIGHT_M } from "@/lib/model/constants";

export interface FloodZoneImpact {
  zoneName: string;
  floorPeilCm: number;
  waterDepthInsideCm: number;
  status: "KERING" | "TERGENANG" | "TERENDAM";
  entryCause: string;
}

export interface FloodSimulationResult {
  rainfallMmH: number;
  roofRunoffLps: number; // liters per second onto front gutter
  gutterCapacityLps: number;
  downspoutCapacityLps: number;
  gutterOverflowRisk: boolean;
  rearVoidSplashDepthM: number;
  infiltrationCapacityLph: number; // SNI 03-2453-2002 infiltration wells
  pumpCapacityLph: number;
  streetFloodCm: number;
  effectiveBarrierHeightCm: number;
  lt1FloorFloodCm: number;
  carportFloodCm: number;
  terraceFloodCm: number;
  backflowActive: boolean;
  electricalHazardOutlets: boolean;
  electricalHazardMcb: boolean;
  lt2EvacuationSafe: boolean;
  zoneImpacts: FloodZoneImpact[];
  floodResilienceScore: number; // 0..100
  warnings: string[];
  mitigationTips: string[];
}

/**
 * Rain & Surabaya Flood Projection Engine:
 * - Rational formula Q = C * I * A / 3600 for forward 10° shed roof runoff
 * - Front gutter & downspout capacity vs overflow risk
 * - Flood water level (0..150 cm) vs Carport, Terrace, and LT1 floor Peil
 * - Sanitary backflow (WC/floor drain LT1), PUIL electrical height safety, and SNI 03-2453 infiltration wells
 */
export function runFloodSimulation(derived: DerivedProjectModel): FloodSimulationResult {
  const { project, roof } = derived;
  const sim = project.simulation;
  const peil = project.site.peil;
  const sys = project.systems;
  const fm = project.floodMitigation;
  const soil = project.site.soil;

  const rainfallMmH = sim.rainIntensityMmH;
  // Rational method: runoff coefficient C = 0.95 for metal roof
  const roofRunoffLps = (0.95 * rainfallMmH * roof.areaM2) / 3600;

  // Front rectangular/U gutter hydraulic capacity estimate (Manning's approximation, 0.7% slope)
  const wM = sys.gutterWidthMm / 1000;
  const hM = wM * 0.65;
  const areaGutter = wM * hM;
  const wetPerim = wM + 2 * hM;
  const rHyd = areaGutter / Math.max(0.01, wetPerim);
  const vManning = (1 / 0.012) * Math.pow(rHyd, 2 / 3) * Math.sqrt(0.008);
  const gutterCapacityLps = areaGutter * vManning * 1000;

  // Downspout orifice/pipe capacity per vertical PVC pipe (C_d ~ 0.65)
  const diaM = sys.downspoutDiaMm / 1000;
  const areaPipe = Math.PI * (diaM / 2) * (diaM / 2);
  const downspoutCapacityLps = sys.downspoutCount * areaPipe * 2.1 * 1000;

  const gutterOverflowRisk =
    rainfallMmH > 0 && (roofRunoffLps > gutterCapacityLps || roofRunoffLps > downspoutCapacityLps);

  // Wind-driven rain splash entering rear void & front terrace
  const windFactor = Math.min(0.45, sim.windSpeedMs * 0.055);
  const rearVoidSplashDepthM = Math.max(0.25, 3.6 * windFactor - sys.overhangBackM * 0.4);

  // SNI 03-2453-2002 infiltration well storage + soil percolation (L/hour)
  const wellRadius = 0.4;
  const wellArea = Math.PI * wellRadius * wellRadius + 2 * Math.PI * wellRadius * 1.5;
  const kMetersPerH = soil.permeabilityCmH / 100;
  const infiltrationCapacityLph = fm.infiltrationWells * wellArea * kMetersPerH * 1000 + fm.infiltrationWells * 1000;
  const pumpCapacityLph = fm.submersiblePump ? 6500 : 0;

  // Flood level analysis (cm above street datum 0)
  const streetFloodCm = sim.floodDepthCm;
  const carportPeilCm = Math.round(peil.carportPeilM * 100);
  const terracePeilCm = Math.round(peil.terracePeilM * 100);
  const floor1PeilCm = Math.round(peil.floor1PeilM * 100);

  const carportFloodCm = Math.max(0, streetFloodCm - carportPeilCm);
  const terraceFloodCm = Math.max(0, streetFloodCm - terracePeilCm);

  // Check if water breaches LT1 threshold (considering door flood barrier + sanitary backflow)
  const effectiveBarrierHeightCm = fm.doorFloodBarrier ? fm.barrierHeightCm : 0;
  const thresholdOvertoppedCm = Math.max(0, streetFloodCm - (floor1PeilCm + effectiveBarrierHeightCm));
  const backflowActive = streetFloodCm > floor1PeilCm - 12 && !fm.backflowValve;
  const backflowWaterCm = backflowActive ? Math.max(0, Math.min(streetFloodCm - floor1PeilCm + 5, 35)) : 0;

  let lt1FloorFloodCm = Math.max(thresholdOvertoppedCm, backflowWaterCm);
  if (lt1FloorFloodCm > 0 && fm.submersiblePump && streetFloodCm <= floor1PeilCm + effectiveBarrierHeightCm) {
    // Submersible pump helps drain backflow/seepage if exterior barrier holds
    lt1FloorFloodCm = Math.max(0, lt1FloorFloodCm - 12);
  }

  // Electrical hazard checks (PUIL safety against flood level above LT1 floor)
  const outletHeightCm = Math.round(fm.outletHeightM * 100);
  const mcbHeightCm = Math.round(fm.mcbHeightM * 100);
  const electricalHazardOutlets = lt1FloorFloodCm > 0 && lt1FloorFloodCm >= outletHeightCm - 5;
  const electricalHazardMcb = lt1FloorFloodCm > 0 && lt1FloorFloodCm >= mcbHeightCm - 5;

  const hasRooms = derived.floors.some((f) => f.rooms.length > 0);
  const lt2EvacElevCm = floor1PeilCm + Math.round((project.levels[0]?.height ?? 3.6) * 100);
  const hasLt2 = (project.levels[1]?.rooms.length ?? 0) > 0;

  const zoneImpacts: FloodZoneImpact[] = [
    {
      zoneName: "Jalan & Taman Depan",
      floorPeilCm: 0,
      waterDepthInsideCm: streetFloodCm,
      status: streetFloodCm > 15 ? "TERENDAM" : streetFloodCm > 0 ? "TERGENANG" : "KERING",
      entryCause: streetFloodCm > 0 ? "Limpasan jalan raya / drainase kota" : "Kering",
    },
    {
      zoneName: "Carport",
      floorPeilCm: carportPeilCm,
      waterDepthInsideCm: carportFloodCm,
      status: carportFloodCm > 25 ? "TERENDAM" : carportFloodCm > 0 ? "TERGENANG" : "KERING",
      entryCause: carportFloodCm > 0 ? `Elevasi jalan ${streetFloodCm} cm > peil carport ${carportPeilCm} cm` : "Aman di atas genangan",
    },
    {
      zoneName: "Teras Depan",
      floorPeilCm: terracePeilCm,
      waterDepthInsideCm: terraceFloodCm,
      status: terraceFloodCm > 15 ? "TERENDAM" : terraceFloodCm > 0 ? "TERGENANG" : "KERING",
      entryCause: terraceFloodCm > 0 ? `Air naik melewati peil teras (+${terracePeilCm} cm)` : "Aman",
    },
    ...(hasRooms
      ? [
          {
            zoneName: "Interior Lantai 1",
            floorPeilCm: floor1PeilCm,
            waterDepthInsideCm: lt1FloorFloodCm,
            status: (lt1FloorFloodCm > 15 ? "TERENDAM" : lt1FloorFloodCm > 0 ? "TERGENANG" : "KERING") as FloodZoneImpact["status"],
            entryCause:
              lt1FloorFloodCm === 0
                ? fm.doorFloodBarrier && streetFloodCm > floor1PeilCm
                  ? `Tertahan Flood Barrier pintu (+${effectiveBarrierHeightCm} cm) & Backflow Valve`
                  : `Peil LT1 (+${floor1PeilCm} cm) lebih tinggi dari banjir`
                : backflowActive && thresholdOvertoppedCm === 0
                  ? "Air banjir masuk lewat arus balik (backflow) floor drain & WC LT1!"
                  : `Air melampaui peil lantai (${floor1PeilCm} cm)${fm.doorFloodBarrier ? ` + sekat (${effectiveBarrierHeightCm} cm)` : ""}`,
          },
          ...(hasLt2
            ? [
                {
                  zoneName: "Lantai 2",
                  floorPeilCm: lt2EvacElevCm,
                  waterDepthInsideCm: 0,
                  status: "KERING" as const,
                  entryCause: `Zona evakuasi vertikal aman (+${(lt2EvacElevCm / 100).toFixed(1)} m di atas jalan)`,
                },
              ]
            : []),
        ]
      : []),
  ];

  const warnings: string[] = [];
  const mitigationTips: string[] = [];

  if (gutterOverflowRisk) {
    warnings.push(
      `Debit hujan atap (${roofRunoffLps.toFixed(1)} L/dt) melebihi kapasitas talang/downspout (${Math.min(gutterCapacityLps, downspoutCapacityLps).toFixed(1)} L/dt). Perbesar talang atau tambah jumlah pipa turun!`,
    );
  }
  if (backflowActive) {
    warnings.push("Risiko ARUS BALIK (backflow) dari saluran drainase kota melalui WC / floor drain LT1.");
    mitigationTips.push("Aktifkan Backflow Valve PVC 4\" pada pipa utama keluar rumah.");
  }
  if (electricalHazardOutlets) {
    warnings.push(
      `BAHAYA SENGATAN LISTRIK: Muka air LT1 (${lt1FloorFloodCm} cm) mencapai stop kontak (${outletHeightCm} cm)!`,
    );
    mitigationTips.push(
      `Naikkan ketinggian stop kontak LT1 menjadi ≥ ${Math.round(SAFE_OUTLET_HEIGHT_M * 100)} cm dari lantai (standar rumah rawan banjir).`,
    );
  }
  if (electricalHazardMcb) {
    warnings.push(
      `BAHAYA KRITIS: Panel MCB (${mcbHeightCm} cm) terendam — wajib pindahkan panel MCB ke ≥ ${Math.round(SAFE_MCB_HEIGHT_M * 100)} cm atau LT2.`,
    );
  }
  if (lt1FloorFloodCm > 0 && !fm.wallWaterproofing) {
    mitigationTips.push("Aktifkan Waterproofing dinding bawah LT1 (0–1,2 m) untuk mencegah cat menggelembung & rembesan kapiler.");
  }
  if (fm.infiltrationWells === 0) {
    mitigationTips.push("Tambahkan minimal 1 Sumur Resapan SNI 03-2453-2002 di taman depan/carport agar air atap tidak langsung membanjiri jalan.");
  }

  let score = 45;
  if (floor1PeilCm >= 50) score += 15;
  else if (floor1PeilCm >= 35) score += 8;
  if (fm.backflowValve) score += 10;
  if (fm.doorFloodBarrier) score += 12;
  if (fm.infiltrationWells >= 1) score += 6;
  if (fm.outletHeightM >= SAFE_OUTLET_HEIGHT_M) score += 7;
  if (fm.wallWaterproofing) score += 5;
  if (gutterOverflowRisk) score -= 12;
  if (backflowActive) score -= 12;
  if (lt1FloorFloodCm > 0) score -= Math.min(35, 12 + Math.round(lt1FloorFloodCm * 0.6));
  if (lt1FloorFloodCm > 0 && !fm.wallWaterproofing) score -= 6;
  if (electricalHazardOutlets) score -= 20;
  if (electricalHazardMcb) score -= 25;
  const floodResilienceScore = Math.max(0, Math.min(100, score));

  return {
    rainfallMmH,
    roofRunoffLps,
    gutterCapacityLps,
    downspoutCapacityLps,
    gutterOverflowRisk,
    rearVoidSplashDepthM,
    infiltrationCapacityLph,
    pumpCapacityLph,
    streetFloodCm,
    effectiveBarrierHeightCm,
    lt1FloorFloodCm,
    carportFloodCm,
    terraceFloodCm,
    backflowActive,
    electricalHazardOutlets,
    electricalHazardMcb,
    lt2EvacuationSafe: hasLt2,
    zoneImpacts,
    floodResilienceScore,
    warnings,
    mitigationTips,
  };
}
