import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { PriceItem } from "@/lib/model/types";

export interface RabRow {
  id: string;
  divisionId: string;
  ahspCode: string;
  uraian: string;
  spek: string;
  qty: number;
  unit: string;
  materialUnit: number;
  laborUnit: number;
  equipUnit: number;
  unitPrice: number;
  subtotalMaterial: number;
  subtotalLabor: number;
  subtotalEquip: number;
  subtotal: number;
  exact: boolean;
  priceKey: string;
  stageId: string;
  formulaNote: string;
}

export interface RabDivision {
  id: string;
  kode: string;
  nama: string;
  rows: RabRow[];
  subtotal: number;
}

export interface RabValidationWarning {
  id: string;
  severity: "critical" | "warning";
  message: string;
}

export interface RabSummary {
  rows: RabRow[];
  divisions: RabDivision[];
  directMaterialTotal: number;
  directLaborTotal: number;
  directEquipTotal: number;
  directSubtotal: number;
  overheadAmount: number;
  profitAmount: number;
  vatAmount: number;
  contingencyAmount: number;
  grandTotal: number;
  perM2Lot: number;
  perM2GrossBuilding: number;
  perM2NetFloor: number;
  budgetCapIdr: number;
  budgetDeltaIdr: number;
  overBudget: boolean;
  warnings: RabValidationWarning[];
}

export const RAB_DIVISIONS = [
  { id: "d1", kode: "I", nama: "Pekerjaan Persiapan & Pembersihan" },
  { id: "d2", kode: "II", nama: "Pekerjaan Tanah, Peil Banjir & Pondasi" },
  { id: "d3", kode: "III", nama: "Struktur Utama (Beton Bertulang / Baja / Pelat LT2)" },
  { id: "d4", kode: "IV", nama: "Pekerjaan Dinding, Bata & Plesteran" },
  { id: "d5", kode: "V", nama: "Pekerjaan Atap, Talang & Plafon" },
  { id: "d6", kode: "VI", nama: "Pekerjaan Lantai, Rabat & Carport" },
  { id: "d7", kode: "VII", nama: "Pintu, Jendela & Railing Pengaman" },
  { id: "d8", kode: "VIII", nama: "Instalasi MEP, AC/Kipas & Mitigasi Banjir" },
  { id: "d9", kode: "IX", nama: "Pengecatan, Waterproofing & Finishing" },
] as const;

export function buildRabSummary(derived: DerivedProjectModel, struct: StructuralReport): RabSummary {
  const { project, masonry, floors, roof, mep } = derived;
  const prices = project.priceBook.items;
  const settings = project.rabSettings;
  const sys = project.systems;
  const fm = project.floodMitigation;
  const rows: RabRow[] = [];

  const push = (
    id: string,
    divisionId: string,
    priceKey: string,
    uraian: string,
    spek: string,
    qty: number,
    exact: boolean,
    stageId: string,
    formulaNote: string,
  ) => {
    const item: PriceItem | undefined = prices[priceKey];
    const matU = item?.materialPrice ?? 0;
    const eqU = item?.equipmentPrice ?? 0;
    const labU = settings.laborMode === "ahsp_oh" ? item?.laborPrice ?? 0 : 0;
    const unitPrice = matU + labU + eqU;
    const cleanQty = Math.max(0, qty);
    const subMat = Math.round(cleanQty * matU);
    const subLab = Math.round(cleanQty * labU);
    const subEq = Math.round(cleanQty * eqU);
    rows.push({
      id,
      divisionId,
      ahspCode: item?.code ?? "CUSTOM",
      uraian,
      spek,
      qty: cleanQty,
      unit: item?.unit ?? "unit",
      materialUnit: matU,
      laborUnit: labU,
      equipUnit: eqU,
      unitPrice,
      subtotalMaterial: subMat,
      subtotalLabor: subLab,
      subtotalEquip: subEq,
      subtotal: subMat + subLab + subEq,
      exact,
      priceKey,
      stageId,
      formulaNote,
    });
  };

  const lotArea = project.site.width * project.site.depth; // 85 m2
  const perimeterLot = 2 * (project.site.width + project.site.depth);
  const peilHeight = project.site.peil.floor1PeilM;

  // Divisi I
  push("bouwplank", "d1", "bouwplank", "Pengukuran & bouwplank keliling tapak 5×17 m", "Profil kayu + patok as + selang waterpass", Math.ceil(perimeterLot), true, "st-01", `Keliling kavling ${perimeterLot} m`);
  push("pembersihan", "d1", "pembersihan", "Pembersihan lahan & perapihan akhir", "Lahan 5×17 m", lotArea, true, "st-01", `Luas lahan ${lotArea.toFixed(1)} m²`);

  // Divisi II: Tanah, Peil Banjir & Pondasi
  const lt1WallLen = project.levels[0]!.walls.reduce((s, w) => s + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z), 0);
  const galianM3 =
    struct.foundations.length * 1.1 * 1.1 * 1.2 +
    (sys.foundation === "footplate_batukali" ? lt1WallLen * 0.55 * 0.65 : 0);
  push("galian", "d2", "galian", "Galian tanah pondasi & footplate", `${struct.foundations.length} titik footplate + jalur pondasi`, Math.ceil(galianM3 * 10) / 10, true, "st-02", "Volume galian tapak & jalur sloof");

  // Urugan peninggian peil banjir (selisih elevasi lantai dari muka jalan)
  const uruganPeilM3 = 68 * Math.max(0.15, peilHeight - 0.1) + 17 * Math.max(0.05, project.site.peil.carportPeilM);
  push("urugan_tanah", "d2", "urugan_tanah", `Urugan sirtu peninggian peil (+${Math.round(peilHeight * 100)} cm dari jalan)`, "Dipadatkan per layer 20 cm (mitigasi banjir)", Math.ceil(uruganPeilM3 * 10) / 10, true, "st-02", `Luas tapak × peil lantai +${peilHeight.toFixed(2)} m`);

  push("urugan_pasir", "d2", "urugan_pasir", "Urugan pasir bawah pondasi & lantai kerja", "Tebal 10 cm", Math.ceil((struct.foundations.length * 1.2 * 0.1 + 5.5) * 10) / 10, true, "st-02", "Alas pondasi & rabat");
  push("lantai_kerja", "d2", "lantai_kerja", "Lantai kerja beton tumbuk 1:3:5 (t=5 cm)", "Di bawah footplate & sloof", Math.ceil(struct.concreteVolumes.leanConcreteM3 * 100) / 100, true, "st-02", "Luas tapak pondasi × 0,05 m");

  if (struct.concreteVolumes.batukaliM3 > 0) {
    push("pondasi_batukali", "d2", "pondasi_batukali", "Pasangan pondasi batu kali 1:5", `Jalur dinding LT1 + peninggian peil`, Math.ceil(struct.concreteVolumes.batukaliM3 * 10) / 10, true, "st-02", "Panjang dinding × penampang batu kali");
  }
  if (sys.foundation === "strauss_pile" && struct.concreteVolumes.straussMeters > 0) {
    push("strauss_pile", "d2", "strauss_pile", "Pengeboran & cor Strauss Pile Ø30 cm", `${struct.foundations.length * 2} titik kedalaman 3 m`, Math.ceil(struct.concreteVolumes.straussMeters), true, "st-02", "Jumlah titik × kedalaman 3 m");
  }
  if (sys.foundation === "cakar_ayam") {
    push("cakar_beton", "d2", "cakar_beton", "Pondasi Cakar Ayam (Pelat + Buis Ø40)", "Sistem Sedyatmo untuk tanah lunak", Math.ceil(struct.concreteVolumes.foundationM3 * 100) / 100, true, "st-02", "Volume pelat + buis beton");
  } else {
    push("footplate_beton", "d2", "footplate_beton", `Beton ${sys.foundation === "elevated_flood" ? "Footplate + Pedestal Panggung" : "Footplate / Pile Cap"} K-250`, `${struct.foundations.length} titik pondasi struktural`, Math.ceil(struct.concreteVolumes.foundationM3 * 100) / 100, true, "st-02", "Sum volume beton semua titik pondasi");
  }

  // Divisi III: Struktur Utama
  const upperConcreteM3 = struct.concreteVolumes.totalConcreteM3 - struct.concreteVolumes.leanConcreteM3 - struct.concreteVolumes.foundationM3;
  push("beton_k250", "d3", "beton_k250", "Beton struktur K-250 (sloof, kolom, balok, pelat, tangga, ring balk)", `Mutu fc' ${project.structuralParams.concreteFcMpa} MPa`, Math.ceil(upperConcreteM3 * 100) / 100, true, "st-03", "Sloof + Kolom + Balok + Pelat + Tangga + Ring balk");
  push("besi_ulir", "d3", "besi_ulir", "Baja tulangan beton BJTS 420B + sengkang (BBS)", `${struct.bbs.length} bar mark sesuai SNI 2847:2019`, Math.ceil(struct.totalRebarKg), true, "st-03", "Total berat Bar Bending Schedule");
  push("bekisting_struktur", "d3", "bekisting_struktur", "Bekisting sloof, kolom, balok & pelat", "Multiplek 12 mm + kaso/steger", Math.ceil(struct.totalFormworkM2 * 10) / 10, true, "st-03", "Luas permukaan cetakan elemen beton");

  if (struct.steelWfKg > 0) {
    push("baja_wf", "d3", "baja_wf", "Profil Baja IWF / H-Beam + pelat sambung", "Sistem struktur rangka baja", Math.ceil(struct.steelWfKg), true, "st-03", "Panjang kolom & balok × berat profil/m");
  }
  if (struct.bondekM2 > 0) {
    push("bondek", "d3", "bondek", "Pelat dek baja Bondek t=0,75 mm", "Alas cor pelat LT2", Math.ceil(struct.bondekM2 * 10) / 10, true, "st-04", "Luas pelat LT2 × 1,05");
  }
  if (struct.wiremeshM2 > 0) {
    push("wiremesh_m8", "d3", "wiremesh_m8", "Wiremesh M8 pelat lantai / cakar ayam", "Pengganti tulangan konvensional pelat", Math.ceil(struct.wiremeshM2 * 10) / 10, true, "st-04", "Luas pelat × 1,08");
  }
  if (struct.aacFloorPanelM2 > 0) {
    push("panel_lantai_aac", "d3", "panel_lantai_aac", "Panel Lantai AAC Hebel t=12,5 cm", "Sistem lantai pracetak cepat", Math.ceil(struct.aacFloorPanelM2 * 10) / 10, true, "st-04", "Luas lantai 2 × 1,05");
  }

  // Divisi IV: Dinding & Bata (Custom / Hebel / Merah / Batako)
  const bSpec = sys.brick;
  const brickPriceKey =
    bSpec.preset === "hebel"
      ? "bata_hebel"
      : bSpec.preset === "merah"
        ? "bata_merah"
        : bSpec.preset === "batako"
          ? "bata_batako"
          : "bata_custom";
  push(
    "bata_dinding",
    "d4",
    brickPriceKey,
    `Pasangan bata dinding: ${bSpec.name} (${bSpec.lengthMm}×${bSpec.heightMm}×${bSpec.depthMm} mm)`,
    `Luar ${bSpec.outerThicknessMm} mm, Sekat ${bSpec.innerThicknessMm} mm, Nat ${bSpec.mortarMm} mm, Waste ${bSpec.wastePct}% (terpasang ${masonry.totalPiecesPlaced} bh)`,
    masonry.totalBuyBricks,
    true,
    "st-05",
    `Analitik per lajur (${masonry.outerPiecesEquivalent.toFixed(0)} luar + ${masonry.innerPiecesEquivalent.toFixed(0)} dalam) + ${bSpec.wastePct}% waste`,
  );

  if (bSpec.mortarKind === "thinbed") {
    push("perekat_hebel", "d4", "perekat_hebel", "Mortar instan perekat bata tipis", `Nat ${bSpec.mortarMm} mm (${masonry.thinbedKg.toFixed(0)} kg total)`, masonry.thinbedZak40kg, true, "st-05", "Volume nat mortar / konsumsi area AHSP");
  } else {
    push("semen_pc", "d4", "semen_pc", "Semen Portland pasangan bata (1:5)", `Nat ${bSpec.mortarMm} mm (adukan ${masonry.mortarWithWasteM3.toFixed(2)} m³)`, masonry.cementZak50kg, true, "st-05", "Volume adukan × 315 kg/m³ ÷ 50 kg");
    push("pasir_pasang", "d4", "pasir_pasang", "Pasir pasang adukan bata", "Campuran 1:5", Math.ceil(masonry.sandM3 * 10) / 10, true, "st-05", "Volume adukan × 1,05");
  }

  if (bSpec.plasterBothSides) {
    push("plesteran", "d4", "plesteran", "Plesteran 2 sisi dinding (1SP:5PP t=15 mm)", `Luas netto dinding 2 sisi`, Math.ceil(masonry.plasterAreaTwoSidesM2 * 10) / 10, true, "st-09", "2 × luas netto muka dinding");
  }
  push("acian", "d4", "acian", "Acian / skim coat dinding 2 sisi", "Penghalusan sebelum pengecatan", Math.ceil(masonry.plasterAreaTwoSidesM2 * 10) / 10, true, "st-09", "2 × luas netto muka dinding");
  if (derived.totalVents > 0) {
    push("roster", "d4", "roster", "Lubang angin permanen (roster beton 20×20)", `${derived.totalVents} bukaan roster ventilasi pasif`, derived.totalVents * 2, true, "st-05", "Jumlah bukaan roster dari denah 3D");
  }

  // Divisi V: Atap, Talang & Plafon
  push("rangka_atap", "d5", "rangka_atap", `Rangka atap baja ringan C75 (${roof.trussCount} kuda-kuda)`, `Sudut ${roof.slopeDeg}° (${sys.roofType}), jarak reng 45 cm`, Math.ceil(roof.areaM2), true, "st-07", "Luas bidang atap miring");
  const roofCoverKey =
    sys.roofCover === "standing_seam"
      ? "atap_standing_seam"
      : sys.roofCover === "spandek_pasir"
        ? "atap_spandek"
        : sys.roofCover === "genteng_beton"
          ? "atap_genteng_beton"
          : "atap_genteng_keramik";
  push("penutup_atap", "d5", roofCoverKey, `Penutup atap (${sys.roofCover})`, `Kemiringan ${roof.slopeDeg}° ke arah depan`, Math.ceil(roof.areaM2), true, "st-07", "Luas bidang atap termasuk overstek depan/belakang");
  if (sys.insulationMm > 0) {
    push("insulasi_atap", "d5", "insulasi_atap", `Insulasi peredam panas & suara (${sys.insulationMm} mm)`, "Aluminium foil double bubble di bawah atap", Math.ceil(roof.areaM2), true, "st-07", "Mengikuti luas atap");
  }
  push("talang_galvalum", "d5", "talang_galvalum", "Talang depan & talang jurai parapet tetangga", `Lebar ${sys.gutterWidthMm} mm (mencegah limpasan ke tetangga)`, Math.ceil(roof.gutterMeters * 10) / 10, true, "st-07", "Panjang talang eave depan + parapet kiri/kanan");
  push("pipa_hujan", "d5", "pipa_hujan", `Pipa turun air hujan PVC ${sys.downspoutDiaMm} mm`, `${sys.downspoutCount} jalur downspout ke sumur resapan`, Math.ceil(roof.downspoutMeters), true, "st-07", "Jumlah downspout × tinggi atap");
  push("lisplank", "d5", "lisplank", "Lisplank GRC woodplank 20 cm", "Penutup keliling tepi atap", Math.ceil(roof.fasciaMeters), true, "st-07", "Keliling atap");
  const ceilingArea = floors.reduce(
    (s, f) =>
      s +
      f.rooms
        .filter((r) => r.room.program !== "garden" && r.room.program !== "carport" && r.room.program !== "void")
        .reduce((a, r) => a + r.netAreaM2, 0),
    0,
  );
  push("plafon", "d5", "plafon", "Plafon gypsum 9 mm + hollow galvalum", "Gypsum tahan lembap untuk area KM/WC", Math.ceil(ceilingArea * 10) / 10, true, "st-09", "Luas ruangan tertutup LT1 + LT2");
  push("skylight_glass", "d5", "skylight_glass", "Skylight kaca tempered void tangga tengah", "Pencahayaan alami pusat bangunan", 2.4, true, "st-07", "Bukaan atap 1,2 × 2,0 m di atas tangga");

  // Divisi VI: Lantai & Carport
  const tileKey = sys.tileSizeCm === 30 ? "keramik30" : sys.tileSizeCm === 40 ? "keramik40" : "keramik60";
  const tiledArea = floors.reduce(
    (s, f) =>
      s +
      f.rooms
        .filter((r) => r.room.program !== "garden" && r.room.program !== "void" && r.room.program !== "carport")
        .reduce((a, r) => a + r.netAreaM2, 0),
    0,
  );
  const totalTiles = floors.reduce((s, f) => s + f.totalTiles, 0);
  push("keramik_lantai", "d6", tileKey, `Penutup lantai keramik/granit ${sys.tileSizeCm}×${sys.tileSizeCm} cm`, `${totalTiles} keping di model 3D (termasuk anti-slip KM)`, Math.ceil(tiledArea * 10) / 10, true, "st-10", "Luas bersih ruangan berkeramik");
  push("rabat_carport", "d6", "rabat_carport", "Rabat beton carport + batu sikat anti-slip", "Area parkir 3,5×4,5 m", 15.0, true, "st-10", "Luas zona carport LT1");
  push("plint_lantai", "d6", "plint_lantai", "Plint (skirting) keramik 10 cm keliling dinding", "Pelindung pertemuan lantai-dinding", Math.ceil(derived.totalWallLengthM * 1.15), true, "st-10", "Keliling dalam ruangan");

  // Divisi VII: Pintu, Jendela & Railing
  const mainDoors = 1;
  const kmDoors = 4; // Powder room, WC LT1, Toilet LT2, Ensuite LT2
  const bedDoors = Math.max(0, derived.totalDoors - mainDoors - kmDoors - 1);
  push("pintu_utama", "d7", "pintu_utama", "Pintu utama kayu solid engineering", "Lengkap kusen & handle", mainDoors, true, "st-06", "1 unit pintu masuk utama");
  if (bedDoors > 0) push("pintu_kamar", "d7", "pintu_kamar", "Pintu kamar tidur", "Kusen + daun + kunci", bedDoors, true, "st-06", "Jumlah pintu kamar di model");
  push("pintu_km", "d7", "pintu_km", "Pintu KM/WC UPVC tahan air", "Powder room, WC LT1, Toilet LT2, Ensuite", kmDoors, true, "st-06", "Jumlah kamar mandi/powder room");
  push("pintu_geser", "d7", "pintu_geser", "Pintu geser kaca taman belakang & balkon", "Kusen aluminium + kaca 8 mm", Math.ceil((2.1 * 2.15 + 1.35 * 2.15) * 10) / 10, true, "st-06", "Luas bukaan pintu kaca geser");
  push("jendela", "d7", "jendela", "Kusen & kaca jendela aluminium", `${derived.totalWindows} unit jendela di model 3D`, Math.ceil(derived.totalWindowAreaM2 * 10) / 10, true, "st-06", "Sum (lebar × tinggi) semua jendela");
  push("railing_tangga", "d7", "railing_tangga", "Railing tangga, void & balkon LT2", "Hollow galvanized + handrail kayu", 14.5, true, "st-10", "Panjang tangga + void belakang + balkon");

  // Divisi VIII: MEP, HVAC & Mitigasi Banjir
  push("pipa_air_bersih", "d8", "pipa_air_bersih", "Pipa air bersih PVC AW 1/2\" & 3/4\"", "PDAM ke semua KM, dapur & kran taman", Math.ceil(mep.airBersihM), true, "st-08", "Panjang polyline 3D jalur air bersih");
  push("pipa_air_kotor", "d8", "pipa_air_kotor", "Pipa air kotor & limbah PVC D-3\"/4\"", "Shaft LT2 → LT1 → Bio Septic Tank", Math.ceil(mep.airKotorM), true, "st-08", "Panjang polyline 3D jalur air kotor");
  push("septic_biotank", "d8", "septic_biotank", "Bio Septic Tank 1.500 L (di bawah carport)", "Akses sedot dari jalan depan", 1, true, "st-08", "1 unit kapasitas 4–6 penghuni");
  push("kloset_duduk", "d8", "kloset_duduk", "Kloset duduk dual-flush", "Powder room, WC LT1, Toilet LT2, Ensuite", Math.max(3, mep.kloset), true, "st-11", "Titik sanitasi kloset pada denah");
  push("shower_set", "d8", "shower_set", "Shower set mixer", "WC LT1, Toilet LT2, Ensuite", 3, true, "st-11", "3 kamar mandi utama");
  push("wastafel", "d8", "wastafel", "Wastafel keramik + kran", "Powder room & kamar mandi LT2", 3, true, "st-11", "Titik cuci tangan");
  push("kitchen_sink", "d8", "kitchen_sink", "Kitchen sink + meja dapur beton", "Area dapur LT1", 1, true, "st-11", "1 unit bak cuci dapur");
  push("floor_drain", "d8", "floor_drain", "Floor drain anti bau", "Semua kamar mandi & area servis", 4, true, "st-11", "1 per KM/WC");
  push("conduit", "d8", "conduit", "Pipa conduit PVC Ø20 mm", "Pelindung kabel di dinding & plafon", Math.ceil(mep.conduitM), true, "st-08", "Total panjang jalur listrik");
  push("kabel_nym15", "d8", "kabel_nym15", "Kabel NYM 2×1,5 mm² (sirkuit lampu)", "Sesuai PUIL 2011", Math.ceil(mep.kabelLampuM), true, "st-08", "Panjang sirkuit lampu 3D");
  push("kabel_nym25", "d8", "kabel_nym25", "Kabel NYM 3×2,5 mm² (stop kontak & AC)", "Sesuai PUIL 2011", Math.ceil(mep.kabelKontakM + mep.kabelAcM), true, "st-08", "Panjang sirkuit stop kontak + feeder AC");
  push("titik_lampu", "d8", "titik_lampu", "Titik lampu + armatur LED", `${mep.titikLampu} titik lampu di model 3D`, mep.titikLampu, true, "st-11", "Jumlah fixture lampu terpasang");
  push("saklar", "d8", "saklar", "Saklar tunggal / ganda inbow", "Tinggi 140 cm", mep.saklar, true, "st-11", "Jumlah grup saklar");
  push("stopkontak", "d8", "stopkontak", `Stop kontak arde (tinggi ${Math.round(fm.outletHeightM * 100)} cm)`, "Tahan banjir jika dipasang ≥ 100 cm", mep.stopkontak, true, "st-11", "Titik stop kontak terpasang");
  push("panel_mcb", "d8", "panel_mcb", `Panel MCB 8 grup + ELCB + Grounding (${settings.plnVaTier} VA)`, `Posisi tinggi ${Math.round(fm.mcbHeightM * 100)} cm`, 1, true, "st-08", "1 panel utama");

  if (mep.acCount > 0) push("ac_split", "d8", "ac_split", "Unit AC Split Inverter + pasang + pipa", `${mep.acCount} unit terpasang di model 3D`, mep.acCount, true, "st-11", "Jumlah AC di model");
  if (mep.fanCount > 0) push("kipas_plafon", "d8", "kipas_plafon", "Kipas angin plafon / berdiri + pasang", `${mep.fanCount} unit di model 3D`, mep.fanCount, true, "st-11", "Jumlah kipas di model");
  if (mep.exhaustCount > 0) push("exhaust_fan", "d8", "exhaust_fan", "Exhaust fan KM / dapur", `${mep.exhaustCount} unit di model 3D`, mep.exhaustCount, true, "st-11", "Jumlah exhaust fan di model");

  // Mitigasi banjir items
  if (fm.infiltrationWells > 0) push("sumur_resapan", "d8", "sumur_resapan", "Sumur resapan air hujan (SNI 03-2453-2002)", `${fm.infiltrationWells} unit Ø80 cm dalam 2 m di taman depan/carport`, fm.infiltrationWells, true, "st-02", "Jumlah sumur resapan aktif");
  if (fm.backflowValve) push("backflow_valve", "d8", "backflow_valve", "Katup satu arah anti-backflow saluran limbah", "Mencegah air banjir masuk lewat WC/floor drain LT1", 2, true, "st-08", "Jalur utama limbah + drain taman");
  if (fm.doorFloodBarrier) push("flood_barrier", "d8", "flood_barrier", `Sekat pintu anti-banjir aluminium (${fm.barrierHeightCm} cm)`, "Pintu utama & area taman belakang", 2, true, "st-11", "Pintu masuk LT1");
  if (fm.submersiblePump) push("pompa_kuras", "d8", "pompa_kuras", "Pompa celup kuras otomatis", "Pit drainase depan/taman", 1, true, "st-11", "1 unit pompa otomatis");

  // Divisi IX: Pengecatan & Waterproofing
  const extPaintArea = masonry.netWallAreaM2 * 0.65;
  const intPaintArea = masonry.netWallAreaM2 * 1.35 + ceilingArea;
  push("cat_eksterior", "d9", "cat_eksterior", "Cat eksterior tahan cuaca (sealer + 2 lapis)", "Fasad depan, void belakang & dinding atas", Math.ceil(extPaintArea * 10) / 10, true, "st-12", "Luas dinding eksterior");
  push("cat_interior", "d9", "cat_interior", "Cat interior dinding & plafon", "Plamir + 2 lapis akhir", Math.ceil(intPaintArea * 10) / 10, true, "st-12", "Dinding interior + plafon");
  const wpArea = 18 + (fm.wallWaterproofing ? 38 : 0); // KM/balkon + lower wall flood proofing
  push("waterproofing", "d9", "waterproofing", "Waterproofing KM, balkon & dinding bawah anti-banjir", fm.wallWaterproofing ? "Termasuk dinding LT1 0–1,2 m" : "Hanya area KM & balkon", wpArea, true, "st-12", "Area basah + proteksi rembesan");

  const divisions: RabDivision[] = RAB_DIVISIONS.map((d) => {
    const drows = rows.filter((r) => r.divisionId === d.id);
    return {
      id: d.id,
      kode: d.kode,
      nama: d.nama,
      rows: drows,
      subtotal: drows.reduce((s, r) => s + r.subtotal, 0),
    };
  }).filter((d) => d.rows.length > 0);

  const directMaterialTotal = rows.reduce((s, r) => s + r.subtotalMaterial, 0);
  let directLaborTotal = rows.reduce((s, r) => s + r.subtotalLabor, 0);
  const directEquipTotal = rows.reduce((s, r) => s + r.subtotalEquip, 0);

  if (settings.laborMode === "borongan_pct") {
    directLaborTotal = Math.round((directMaterialTotal * settings.boronganPct) / 100);
  }

  const directSubtotal = directMaterialTotal + directLaborTotal + directEquipTotal;
  const overheadAmount = Math.round((directSubtotal * settings.overheadPct) / 100);
  const profitAmount = Math.round((directSubtotal * settings.profitPct) / 100);
  const preVat = directSubtotal + overheadAmount + profitAmount;
  const vatAmount = Math.round((preVat * settings.vatPct) / 100);
  const contingencyAmount = Math.round((preVat * settings.contingencyPct) / 100);
  const grandTotal = preVat + vatAmount + contingencyAmount;

  const warnings: RabValidationWarning[] = [];
  for (const r of rows) {
    if (r.unitPrice <= 0) {
      warnings.push({ id: `zero-price-${r.id}`, severity: "critical", message: `Harga satuan "${r.uraian}" masih Rp 0.` });
    }
    if (r.qty <= 0) {
      warnings.push({ id: `zero-qty-${r.id}`, severity: "warning", message: `Kuantitas "${r.uraian}" bernilai 0.` });
    }
  }
  const budgetCapIdr = project.gamification.budgetCapIdr;
  const budgetDeltaIdr = budgetCapIdr - grandTotal;

  return {
    rows,
    divisions,
    directMaterialTotal,
    directLaborTotal,
    directEquipTotal,
    directSubtotal,
    overheadAmount,
    profitAmount,
    vatAmount,
    contingencyAmount,
    grandTotal,
    perM2Lot: grandTotal / Math.max(1, lotArea),
    perM2GrossBuilding: grandTotal / Math.max(1, derived.totalGrossAreaM2),
    perM2NetFloor: grandTotal / Math.max(1, derived.totalNetFloorM2),
    budgetCapIdr,
    budgetDeltaIdr,
    overBudget: grandTotal > budgetCapIdr,
    warnings,
  };
}
