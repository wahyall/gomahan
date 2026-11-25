import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { Vec2 } from "@/lib/model/types";

export interface StructuralColumnNode {
  id: string;
  x: number;
  z: number;
  isMain: boolean;
  widthM: number; // e.g. 0.20 m
  depthM: number; // e.g. 0.25 m
  tributaryAreaM2: number;
  axialLoadKn: number;
  momentKnM: number;
  utilizationRatio: number; // Demand / Capacity <= 1.0
  status: "AMAN" | "PERIKSA";
  rebarSpec: string;
}

export interface StructuralBeamMember {
  id: string;
  levelIndex: number;
  kind: "sloof" | "balok_induk" | "balok_anak" | "ring_balk";
  start: Vec2;
  end: Vec2;
  lengthM: number;
  widthM: number;
  heightM: number;
  momentKnM: number;
  shearKn: number;
  utilizationRatio: number;
  status: "AMAN" | "PERIKSA";
  rebarSpec: string;
}

export interface FoundationElement {
  id: string;
  x: number;
  z: number;
  kind: string;
  sizeLabel: string;
  bearingPressureKpa: number;
  allowableBearingKpa: number;
  punchingRatio: number;
  status: "AMAN" | "PERIKSA";
  concreteM3: number;
  rebarKg: number;
  straussMeters: number;
}

export interface BarBendingRow {
  barMark: string;
  element: string;
  diameterMm: number;
  shape: string;
  cutLengthM: number;
  count: number;
  totalLengthM: number;
  unitWeightKgM: number;
  totalWeightKg: number;
}

export interface StructuralReport {
  systemLabel: string;
  standards: string[];
  assumptions: string[];
  columns: StructuralColumnNode[];
  beams: StructuralBeamMember[];
  foundations: FoundationElement[];
  bbs: BarBendingRow[];
  totalWeightKn: number;
  seismicBaseShearKn: number;
  seismicCoeffCs: number;
  driftRatio: number;
  driftLimit: number;
  concreteVolumes: {
    leanConcreteM3: number;
    foundationM3: number;
    sloofM3: number;
    columnsM3: number;
    beamsM3: number;
    slabM3: number;
    stairsM3: number;
    ringBalkM3: number;
    totalConcreteM3: number;
    batukaliM3: number;
    straussMeters: number;
  };
  steelWfKg: number;
  bondekM2: number;
  wiremeshM2: number;
  aacFloorPanelM2: number;
  totalRebarKg: number;
  totalFormworkM2: number;
  overallSafe: boolean;
  warnings: string[];
}

function rebarKgPerM(diaMm: number): number {
  return (diaMm * diaMm) / 162.2;
}

/**
 * SNI 2847:2019 (Concrete), SNI 1726:2019 (Seismic), SNI 1727:2020 (Loads), SNI 8460:2017 (Geo)
 * Preliminary 2-storey structural analysis & Bar Bending Schedule generator.
 * Design assistant — requires certified civil engineer review before issue.
 */
export function computeStructuralReport(derived: DerivedProjectModel): StructuralReport {
  const { project, masonry, roof } = derived;
  const sp = project.structuralParams;
  const sys = project.systems;
  const soil = project.site.soil;
  const peilExtraH = Math.max(0, project.site.peil.floor1PeilM - 0.25);

  const isSteel = sys.frame === "steel_wf";

  // 1. Extract structural grid intersections + split spans > 3.6m
  const nodeMap = new Map<string, { x: number; z: number; isMain: boolean }>();
  const addNode = (x: number, z: number, isMain: boolean) => {
    const rx = Math.round(x * 10) / 10;
    const rz = Math.round(z * 10) / 10;
    const key = `${rx.toFixed(1)}|${rz.toFixed(1)}`;
    const existing = nodeMap.get(key);
    if (!existing) {
      nodeMap.set(key, { x: rx, z: rz, isMain });
    } else if (isMain) {
      existing.isMain = true;
    }
  };

  // Standard 5×17 single-bay clear-span portal frame at perimeter walls + wall-aligned partition nodes
  // (Prevents any structural column from obstructing doorways or open living areas!)
  const perimeterZ = [4.0, 7.5, 10.5, 12.5, 15.35, 16.95];
  for (const gz of perimeterZ) {
    addNode(0.05, gz, true);
    if (gz !== 4.0) addNode(4.95, gz, true);
  }
  addNode(4.95, 4.5, true); // KT1 right facade portal corner
  addNode(2.25, 4.0, true); // Front vestibule transition
  addNode(2.25, 4.5, false); // Partition front corner
  addNode(2.25, 7.5, false); // Partition rear corner (clear of doors)
  addNode(1.35, 7.5, false); // Stair/Powder shaft column
  addNode(1.35, 12.5, false); // Stair/Hallway shaft column (clear of KT Utama door at X=2.15)
  addNode(1.7, 15.35, false); // Void/Toilet corner column
  addNode(1.7, 16.95, false); // Rear toilet boundary column
  // Carport front portal columns at Z=0.05
  addNode(1.5, 0.05, true);
  addNode(4.95, 0.05, true);

  // Add practical column nodes at wall endpoints / openings if distant from main nodes
  for (const lv of project.levels) {
    for (const w of lv.walls) {
      if (w.height < 2.2) continue;
      for (const pt of [w.start, w.end]) {
        let near = false;
        for (const n of nodeMap.values()) {
          if (Math.hypot(n.x - pt.x, n.z - pt.z) < 0.45) {
            near = true;
            break;
          }
        }
        if (!near) addNode(pt.x, pt.z, w.exterior);
      }
    }
  }

  // Compute seismic weight & equivalent static base shear (SNI 1726:2019 Surabaya Site Class SE)
  const masonryDensityKnM3 =
    sys.brick.preset === "hebel" ? 7.5 : sys.brick.preset === "merah" ? 17.0 : 14.5;
  const masonryWeightKn = masonry.brickVolumeM3 * masonryDensityKnM3 + masonry.mortarVolumeM3 * 20;
  const lt2Area = 5.0 * 13.0 - 1.65 * 3.3 - 1.35 * 5.0; // net structural slab area ~52.8 m2
  const slabUnitKnM2 = sys.slab === "aac_panel" ? 1.8 : sys.slab === "bondek_wiremesh" ? 2.6 : 2.88;
  const slabWeightKn = lt2Area * (slabUnitKnM2 + 1.2) + lt2Area * sp.liveLoadRoomKpa * 0.25;
  const roofWeightKn = roof.areaM2 * (sys.roofCover === "genteng_beton" ? 0.65 : 0.32);
  const frameSelfWeightKn = isSteel ? 45 : 165;
  const totalWeightKn = masonryWeightKn + slabWeightKn + roofWeightKn + frameSelfWeightKn;

  // Surabaya SE approximate short-period spectral acceleration Sds ~ 0.65g
  const sds = soil.siteClass === "SE" ? 0.65 : soil.siteClass === "SD" ? 0.56 : 0.42;
  const seismicCoeffCs = Math.max(0.044 * sds * sp.seismicI, Math.min(0.18, sds / (sp.seismicR / sp.seismicI)));
  const seismicBaseShearKn = totalWeightKn * seismicCoeffCs;

  // Analyze columns
  const colW = isSteel ? 0.15 : 0.20;
  const colD = isSteel ? 0.15 : 0.25;
  const colAreaMm2 = colW * 1000 * (colD * 1000);
  // Approximate axial capacity phi * 0.80 * (0.85 * fc' * Ag + fy * Ast)
  const astMm2 = 6 * Math.PI * 6.5 * 6.5; // 6 D13 ~ 796 mm2
  const phiPnKn = isSteel
    ? 520
    : (0.65 * 0.8 * (0.85 * sp.concreteFcMpa * (colAreaMm2 - astMm2) + sp.rebarFyMpa * astMm2)) / 1000;

  const columns: StructuralColumnNode[] = [];
  let idx = 0;
  for (const n of nodeMap.values()) {
    idx++;
    const isFrontCanopy = n.z < 1.0;
    const trib = isFrontCanopy ? 5.6 : n.isMain ? 7.8 : 4.2;
    const storeysAbove = isFrontCanopy ? 1 : 2;
    const axial = trib * (isFrontCanopy ? 3.5 : 13.5 * storeysAbove * 0.52);
    const moment = (seismicBaseShearKn / Math.max(8, nodeMap.size)) * 1.8;
    const cap = n.isMain ? phiPnKn : 240;
    const util = axial / cap + moment / 45;
    columns.push({
      id: `K${n.isMain ? "1" : "P"}-${idx}`,
      x: n.x,
      z: n.z,
      isMain: n.isMain,
      widthM: n.isMain ? colW : 0.15,
      depthM: n.isMain ? colD : 0.15,
      tributaryAreaM2: trib,
      axialLoadKn: axial,
      momentKnM: moment,
      utilizationRatio: util,
      status: util <= 0.92 ? "AMAN" : "PERIKSA",
      rebarSpec: isSteel
        ? n.isMain
          ? "WF 150×150×7×10"
          : "Hollow 100×100×4"
        : n.isMain
          ? "6D13 + Ø8-100/150"
          : "4D10 + Ø6-150",
    });
  }

  // Beams (Sloof, Main Beams LT2, Ring Balk Roof)
  const beams: StructuralBeamMember[] = [];
  const addBeam = (
    id: string,
    levelIndex: number,
    kind: StructuralBeamMember["kind"],
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    w: number,
    h: number,
  ) => {
    const lengthM = Math.hypot(x2 - x1, z2 - z1);
    const wu = kind === "ring_balk" ? 6.5 : kind === "sloof" ? 14.5 : 18.5; // kN/m factored
    const moment = (wu * lengthM * lengthM) / 10;
    const shear = (wu * lengthM) * 0.5;
    // phi * Mn estimate for 20/35 beam with 3D13 top + 3D13 bottom
    const dEff = (h - 0.04) * 1000;
    const asBot = 3 * 132.7; // 3D13
    const phiMn = isSteel
      ? 68
      : (0.9 * asBot * sp.rebarFyMpa * (dEff - 35)) / 1e6;
    const cap = kind === "ring_balk" ? phiMn * 0.55 : phiMn;
    const util = moment / Math.max(10, cap);

    beams.push({
      id,
      levelIndex,
      kind,
      start: { x: x1, z: z1 },
      end: { x: x2, z: z2 },
      lengthM,
      widthM: w,
      heightM: h,
      momentKnM: moment,
      shearKn: shear,
      utilizationRatio: util,
      status: util <= 0.92 ? "AMAN" : "PERIKSA",
      rebarSpec: isSteel
        ? kind === "balok_induk"
          ? "IWF 200×100×5.5×8"
          : "CNP 150×50"
        : kind === "balok_induk"
          ? "3D13 Atas + 3D13 Bawah + Ø8-100/150"
          : kind === "sloof"
            ? "6D12 + Ø8-120/150"
            : "4D10 + Ø6-150",
    });
  };

  // Longitudinal perimeter + transverse 5.0m clear-span frame beams
  const beamGridZ = [4.0, 7.5, 10.5, 12.5, 15.35, 16.95];
  for (let i = 0; i < beamGridZ.length - 1; i++) {
    const zA = beamGridZ[i]!;
    const zB = beamGridZ[i + 1]!;
    addBeam(`SL-L-${i}`, 0, "sloof", 0.05, zA, 0.05, zB, 0.2, 0.3);
    addBeam(`SL-R-${i}`, 0, "sloof", 4.95, Math.max(4.5, zA), 4.95, zB, 0.2, 0.3);
    addBeam(`BI-L-${i}`, 1, "balok_induk", 0.05, zA, 0.05, zB, 0.2, 0.35);
    addBeam(`BI-R-${i}`, 1, "balok_induk", 4.95, zA, 4.95, zB, 0.2, 0.35);
    addBeam(`RB-L-${i}`, 2, "ring_balk", 0.05, zA, 0.05, zB, 0.15, 0.2);
    addBeam(`RB-R-${i}`, 2, "ring_balk", 4.95, zA, 4.95, zB, 0.15, 0.2);
  }
  for (let i = 0; i < beamGridZ.length; i++) {
    const gz = beamGridZ[i]!;
    addBeam(`SL-T-${i}`, 0, "sloof", 0.05, gz, 4.95, gz, 0.2, 0.3);
    if (gz !== 16.95) {
      addBeam(`BI-T-${i}`, 1, "balok_induk", 0.05, gz, 4.95, gz, 0.2, 0.35);
    }
    addBeam(`RB-T-${i}`, 2, "ring_balk", 0.05, gz, 4.95, gz, 0.15, 0.2);
  }

  // Foundations (depends on selected system!)
  const foundations: FoundationElement[] = [];
  let fndConcreteM3 = 0;
  let straussMetersTotal = 0;
  let batukaliM3 = 0;

  const mainCols = columns.filter((c) => c.isMain);
  for (let i = 0; i < mainCols.length; i++) {
    const c = mainCols[i]!;
    const pService = c.axialLoadKn / 1.3; // unfactored service load
    let footArea = 1.0 * 1.0;
    let label = "Footplate 100×100×30 cm";
    let straussM = 0;
    let concM3 = 0.3;

    if (sys.foundation === "footplate_batukali") {
      footArea = 1.0 * 1.0;
      label = "Footplate 100×100 + Batu Kali";
      concM3 = 0.32;
    } else if (sys.foundation === "footplate_full") {
      footArea = 1.2 * 1.2;
      label = "Footplate Penuh 120×120×35 cm";
      concM3 = 0.50;
    } else if (sys.foundation === "strauss_pile") {
      footArea = 0.9 * 0.9;
      straussM = 6.0; // 2 titik Ø30 × 3.0 m per pile cap
      label = "Pile Cap 90×90 + 2 Strauss Pile Ø30 (3m)";
      concM3 = 0.28 + 2 * Math.PI * 0.15 * 0.15 * 3.0;
    } else if (sys.foundation === "cakar_ayam") {
      footArea = 1.1 * 1.1;
      label = "Cakar Ayam Pelat 12cm + Buis Ø40";
      concM3 = 0.36;
    } else {
      // elevated_flood
      footArea = 1.2 * 1.2;
      label = "Footplate + Kolom Pedestal Tinggi (Panggung Banjir)";
      concM3 = 0.58 + peilExtraH * 0.09;
    }

    const qApplied = sys.foundation === "strauss_pile" ? pService / (footArea * 1.6) : pService / footArea;
    const punching = pService / 420;
    fndConcreteM3 += concM3;
    straussMetersTotal += straussM;

    foundations.push({
      id: `F-${i + 1}`,
      x: c.x,
      z: c.z,
      kind: sys.foundation,
      sizeLabel: label,
      bearingPressureKpa: qApplied,
      allowableBearingKpa: soil.allowableBearingKpa,
      punchingRatio: punching,
      status: qApplied <= soil.allowableBearingKpa && punching <= 0.9 ? "AMAN" : "PERIKSA",
      concreteM3: concM3,
      rebarKg: sys.foundation === "strauss_pile" ? 68 : 42,
      straussMeters: straussM,
    });
  }

  // Add strip batu kali under LT1 masonry walls when footplate_batukali is selected
  const lt1WallLen = project.levels[0]!.walls.reduce((s, w) => s + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z), 0);
  if (sys.foundation === "footplate_batukali") {
    batukaliM3 = lt1WallLen * 0.38 * (0.55 + peilExtraH);
  } else if (sys.foundation === "cakar_ayam") {
    // Full ground slab + buis
    fndConcreteM3 += 5.0 * 13.0 * 0.12;
  }

  // Concrete / Steel / Slab volumes
  const sloofLen = beams.filter((b) => b.kind === "sloof").reduce((s, b) => s + b.lengthM, 0);
  const balokLen = beams.filter((b) => b.kind === "balok_induk").reduce((s, b) => s + b.lengthM, 0);
  const ringLen = beams.filter((b) => b.kind === "ring_balk").reduce((s, b) => s + b.lengthM, 0);
  const colHeightTotal = 3.6 + 3.6 + peilExtraH;

  const sloofM3 = sloofLen * 0.2 * 0.3;
  const columnsM3 = isSteel
    ? 0
    : columns.reduce((s, c) => s + c.widthM * c.depthM * colHeightTotal, 0);
  const beamsM3 = isSteel ? 0 : balokLen * 0.2 * 0.35;
  const ringBalkM3 = ringLen * 0.15 * 0.2;
  const slabM3 =
    sys.slab === "rc_slab_12"
      ? lt2Area * 0.12
      : sys.slab === "bondek_wiremesh"
        ? lt2Area * 0.1
        : 0;
  const stairsM3 = 4.6 * 1.05 * 0.15 + 20 * 0.5 * 0.18 * 0.25 * 1.05;
  const leanConcreteM3 = mainCols.length * 1.1 * 1.1 * 0.05 + lt1WallLen * 0.5 * 0.05;
  const totalConcreteM3 =
    leanConcreteM3 + fndConcreteM3 + sloofM3 + columnsM3 + beamsM3 + slabM3 + stairsM3 + ringBalkM3;

  const steelWfKg = isSteel
    ? columns.length * colHeightTotal * 31.5 + balokLen * 21.3
    : 0;
  const bondekM2 = sys.slab === "bondek_wiremesh" ? lt2Area * 1.05 : 0;
  const wiremeshM2 = sys.slab === "bondek_wiremesh" ? lt2Area * 1.08 : sys.foundation === "cakar_ayam" ? 65 : 0;
  const aacFloorPanelM2 = sys.slab === "aac_panel" ? lt2Area * 1.05 : 0;

  // Bar Bending Schedule (BBS)
  const bbs: BarBendingRow[] = [
    {
      barMark: "BM-01",
      element: "Tulangan Pokok Footplate & Pile Cap",
      diameterMm: 13,
      shape: "Grid U-Hook",
      cutLengthM: 1.25,
      count: mainCols.length * 14,
      totalLengthM: mainCols.length * 14 * 1.25,
      unitWeightKgM: rebarKgPerM(13),
      totalWeightKg: mainCols.length * 14 * 1.25 * rebarKgPerM(13),
    },
    {
      barMark: "BM-02",
      element: "Tulangan Pokok Sloof 20/30",
      diameterMm: 12,
      shape: "Lurus + Kait",
      cutLengthM: 12.0,
      count: Math.ceil((sloofLen * 6) / 11.2),
      totalLengthM: sloofLen * 6 * 1.08,
      unitWeightKgM: rebarKgPerM(12),
      totalWeightKg: sloofLen * 6 * 1.08 * rebarKgPerM(12),
    },
    {
      barMark: "BM-03",
      element: "Tulangan Pokok Kolom Utama (6D13)",
      diameterMm: 13,
      shape: "Vertikal + Overlap 40D",
      cutLengthM: colHeightTotal + 0.65,
      count: isSteel ? 0 : mainCols.length * 6,
      totalLengthM: isSteel ? 0 : mainCols.length * 6 * (colHeightTotal + 0.65),
      unitWeightKgM: rebarKgPerM(13),
      totalWeightKg: isSteel ? 0 : mainCols.length * 6 * (colHeightTotal + 0.65) * rebarKgPerM(13),
    },
    {
      barMark: "BM-04",
      element: "Tulangan Balok Induk LT2 (6D13)",
      diameterMm: 13,
      shape: "Lurus + Angkur 40D",
      cutLengthM: 12.0,
      count: isSteel ? 0 : Math.ceil((balokLen * 6) / 11.2),
      totalLengthM: isSteel ? 0 : balokLen * 6 * 1.08,
      unitWeightKgM: rebarKgPerM(13),
      totalWeightKg: isSteel ? 0 : balokLen * 6 * 1.08 * rebarKgPerM(13),
    },
    {
      barMark: "BM-05",
      element: "Sengkang/Begel Tumpuan & Lapangan (Ø8)",
      diameterMm: 8,
      shape: "Kotak 135° Seismic Hook",
      cutLengthM: 0.96,
      count: Math.ceil((sloofLen + balokLen + (isSteel ? 0 : mainCols.length * colHeightTotal)) / 0.13),
      totalLengthM: Math.ceil((sloofLen + balokLen + (isSteel ? 0 : mainCols.length * colHeightTotal)) / 0.13) * 0.96,
      unitWeightKgM: rebarKgPerM(8),
      totalWeightKg:
        Math.ceil((sloofLen + balokLen + (isSteel ? 0 : mainCols.length * colHeightTotal)) / 0.13) *
        0.96 *
        rebarKgPerM(8),
    },
    {
      barMark: "BM-06",
      element: "Tulangan Pelat Lantai 2 & Tangga (Ø10 Rangkap)",
      diameterMm: 10,
      shape: "Grid 2 Lapis @150",
      cutLengthM: 5.2,
      count: sys.slab === "rc_slab_12" ? Math.ceil((lt2Area * 2) / (0.15 * 0.8)) : 28,
      totalLengthM: sys.slab === "rc_slab_12" ? lt2Area * 2 * 13.5 : 145,
      unitWeightKgM: rebarKgPerM(10),
      totalWeightKg: (sys.slab === "rc_slab_12" ? lt2Area * 2 * 13.5 : 145) * rebarKgPerM(10),
    },
    {
      barMark: "BM-07",
      element: "Ring Balk & Kolom Praktis (4D10 + Ø6)",
      diameterMm: 10,
      shape: "Lurus + Kait",
      cutLengthM: 12.0,
      count: Math.ceil((ringLen * 4 + (columns.length - mainCols.length) * 4 * 6.8) / 11.4),
      totalLengthM: (ringLen * 4 + (columns.length - mainCols.length) * 4 * 6.8) * 1.06,
      unitWeightKgM: rebarKgPerM(10),
      totalWeightKg: (ringLen * 4 + (columns.length - mainCols.length) * 4 * 6.8) * 1.06 * rebarKgPerM(10),
    },
  ].filter((r) => r.totalWeightKg > 0);

  const totalRebarKg = bbs.reduce((s, r) => s + r.totalWeightKg, 0);
  const totalFormworkM2 =
    sloofLen * 0.6 +
    (isSteel ? 0 : columns.length * 0.85 * colHeightTotal) +
    (isSteel ? 0 : balokLen * 0.9) +
    (sys.slab === "rc_slab_12" ? lt2Area : 0) +
    ringLen * 0.4 +
    mainCols.length * 1.2;

  const driftRatio = (seismicBaseShearKn * 0.045) / (isSteel ? 580 : 620);
  const driftLimit = 0.02;

  const warnings: string[] = [];
  const overBearing = foundations.filter((f) => f.status === "PERIKSA");
  if (overBearing.length > 0) {
    warnings.push(
      `${overBearing.length} titik pondasi mendekati/melebihi daya dukung tanah ${soil.allowableBearingKpa} kPa — disarankan ganti ke Strauss Pile atau perbesar ukuran Footplate.`,
    );
  }
  const overBeams = beams.filter((b) => b.status === "PERIKSA");
  if (overBeams.length > 0) {
    warnings.push(`${overBeams.length} segmen balok memiliki rasio momen > 0.92; cek ulang dimensi atau mutu beton.`);
  }
  if (!sp.engineerReviewed) {
    warnings.push("Checklist review insinyur sipil belum dicentang (wajib untuk penerbitan paket kontraktor final).");
  }

  return {
    systemLabel: `${sys.foundation} + ${isSteel ? "Baja WF" : "RC SNI 2847"} + ${sys.slab}`,
    standards: ["SNI 2847:2019 (Beton Struktural)", "SNI 1726:2019 (Gempa)", "SNI 1727:2020 (Beban)", "SNI 8460:2017 (Geoteknik)"],
    assumptions: [
      `Lokasi: ${soil.city}, Kelas Situs ${soil.siteClass}, Daya dukung izin tanah ${soil.allowableBearingKpa} kPa (asumsi — wajib uji sondir/SPT).`,
      `Mutu Beton fc' = ${sp.concreteFcMpa} MPa (K-${Math.round(sp.concreteFcMpa * 11.5)}), Baja Tulangan fy = ${sp.rebarFyMpa} MPa (BJTS 420B).`,
      `Beban hidup ruang ${sp.liveLoadRoomKpa} kN/m², tangga/balkon ${sp.liveLoadStairBalconyKpa} kN/m², atap ${sp.liveLoadRoofKpa} kN/m², faktor R = ${sp.seismicR}.`,
      "Alat bantu pra-desain — bukan pengganti perhitungan struktur resmi bersertifikat (SKK/SKA).",
    ],
    columns,
    beams,
    foundations,
    bbs,
    totalWeightKn,
    seismicBaseShearKn,
    seismicCoeffCs,
    driftRatio,
    driftLimit,
    concreteVolumes: {
      leanConcreteM3,
      foundationM3: fndConcreteM3,
      sloofM3,
      columnsM3,
      beamsM3,
      slabM3,
      stairsM3,
      ringBalkM3,
      totalConcreteM3,
      batukaliM3,
      straussMeters: straussMetersTotal,
    },
    steelWfKg,
    bondekM2,
    wiremeshM2,
    aacFloorPanelM2,
    totalRebarKg,
    totalFormworkM2,
    overallSafe: overBearing.length === 0 && overBeams.length === 0 && driftRatio <= driftLimit,
    warnings,
  };
}
