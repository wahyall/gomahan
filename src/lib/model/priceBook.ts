import type { BrickSpec, MasonryPreset, PriceBook, PriceItem } from "@/lib/model/types";

export const BRICK_PRESETS: Record<MasonryPreset, BrickSpec> = {
  hebel: {
    preset: "hebel",
    name: "Bata Ringan / Hebel AAC (600×200×100)",
    lengthMm: 600,
    heightMm: 200,
    depthMm: 100,
    outerThicknessMm: 100,
    innerThicknessMm: 75,
    mortarMm: 3,
    bondPattern: "running",
    wastePct: 5,
    mortarKind: "thinbed",
    plasterBothSides: false,
  },
  merah: {
    preset: "merah",
    name: "Bata Merah Standar SNI (200×50×100)",
    lengthMm: 200,
    heightMm: 50,
    depthMm: 100,
    outerThicknessMm: 110,
    innerThicknessMm: 110,
    mortarMm: 12,
    bondPattern: "running",
    wastePct: 10,
    mortarKind: "cement_sand",
    plasterBothSides: true,
  },
  batako: {
    preset: "batako",
    name: "Batako Press Semen (400×200×100)",
    lengthMm: 400,
    heightMm: 200,
    depthMm: 100,
    outerThicknessMm: 100,
    innerThicknessMm: 100,
    mortarMm: 10,
    bondPattern: "running",
    wastePct: 7,
    mortarKind: "cement_sand",
    plasterBothSides: true,
  },
  precast: {
    preset: "precast",
    name: "Panel Dinding Precast Modular (600×300×80)",
    lengthMm: 600,
    heightMm: 300,
    depthMm: 80,
    outerThicknessMm: 100,
    innerThicknessMm: 80,
    mortarMm: 4,
    bondPattern: "stack",
    wastePct: 3,
    mortarKind: "thinbed",
    plasterBothSides: false,
  },
  custom: {
    preset: "custom",
    name: "Bata Custom (Ukuran Bebas)",
    lengthMm: 230,
    heightMm: 55,
    depthMm: 110,
    outerThicknessMm: 110,
    innerThicknessMm: 110,
    mortarMm: 10,
    bondPattern: "running",
    wastePct: 8,
    mortarKind: "cement_sand",
    plasterBothSides: true,
  },
};

function item(
  id: string,
  code: string,
  name: string,
  unit: string,
  materialPrice: number,
  laborPrice: number,
  equipmentPrice = 0,
  oh?: { p?: number; t?: number; k?: number; m?: number },
  notes?: string,
): PriceItem {
  return {
    id,
    code,
    name,
    unit,
    materialPrice,
    laborPrice,
    equipmentPrice,
    ohPekerja: oh?.p,
    ohTukang: oh?.t,
    ohKepala: oh?.k,
    ohMandor: oh?.m,
    notes,
  };
}

export function createSurabayaPriceBook(): PriceBook {
  const rows: PriceItem[] = [
    // Divisi I: Persiapan & Pembersihan
    item("bouwplank", "AHSP-A.2.2.1.4", "Pengukuran & pemasangan bouwplank", "m1", 48000, 32000, 0, { p: 0.1, t: 0.1, k: 0.01, m: 0.005 }, "Profil kayu meranti + patok as"),
    item("pembersihan", "AHSP-A.2.2.1.9", "Pembersihan & perapihan lapangan", "m2", 0, 18000, 5000, { p: 0.1, m: 0.005 }),

    // Divisi II: Pekerjaan Tanah, Peil & Pondasi
    item("galian", "AHSP-A.2.3.1.1", "Galian tanah pondasi sedalam 1-2 m", "m3", 0, 98000, 0, { p: 0.75, m: 0.025 }),
    item("urugan_tanah", "AHSP-A.2.3.1.11", "Urugan tanah sirtu peninggian peil + pemadatan", "m3", 145000, 48000, 15000, { p: 0.3, m: 0.01 }),
    item("urugan_pasir", "AHSP-A.2.3.1.11a", "Urugan pasir bawah pondasi / lantai kerja", "m3", 230000, 42000, 0, { p: 0.3, m: 0.01 }),
    item("lantai_kerja", "AHSP-A.4.1.1.4", "Lantai kerja beton tumbuk 1:3:5 (t=5 cm)", "m3", 780000, 165000, 0, { p: 1.2, t: 0.2, k: 0.02, m: 0.06 }),
    item("pondasi_batukali", "AHSP-A.3.2.1.2", "Pondasi batu belah/kali campuran 1:5", "m3", 685000, 245000, 0, { p: 1.5, t: 0.75, k: 0.075, m: 0.075 }),
    item("footplate_beton", "AHSP-A.4.1.1.7", "Beton K-250 pondasi footplate / pile cap", "m3", 1020000, 220000, 45000, { p: 1.65, t: 0.275, k: 0.028, m: 0.083 }),
    item("strauss_pile", "SBY-STR-30", "Pengeboran & cor Strauss Pile Ø30 cm (dalam 3 m)", "m1", 165000, 115000, 35000, { p: 0.4, t: 0.2, m: 0.02 }),
    item("cakar_beton", "SBY-CKR-01", "Pondasi Cakar Ayam (pelat beton + buis Ø40)", "m3", 1180000, 290000, 45000, { p: 1.65, t: 0.35, k: 0.035, m: 0.083 }),

    // Divisi III: Struktur Utama (Beton Bertulang SNI / Baja WF)
    item("beton_k250", "AHSP-A.4.1.1.8", "Beton struktur K-250 / fc' 21,7 MPa (sloof, kolom, balok, pelat)", "m3", 1040000, 235000, 55000, { p: 1.65, t: 0.275, k: 0.028, m: 0.083 }),
    item("besi_ulir", "AHSP-A.4.1.1.17", "Pembesian baja tulangan ulir BJTS 420B + polos", "kg", 13800, 2400, 0, { p: 0.007, t: 0.007, k: 0.0007, m: 0.0004 }),
    item("bekisting_struktur", "AHSP-A.4.1.1.22", "Bekisting sloof, kolom, balok & pelat (2x pakai)", "m2", 115000, 68000, 0, { p: 0.52, t: 0.26, k: 0.026, m: 0.026 }),
    item("baja_wf", "AHSP-A.4.2.1.1", "Struktur baja profil IWF/H-Beam + sambungan baut", "kg", 19500, 6500, 1500, { p: 0.03, t: 0.03, k: 0.003, m: 0.002 }),
    item("bondek", "SBY-BND-075", "Pelat dek baja galvanis (Bondek) t=0.75 mm", "m2", 135000, 28000, 0, { p: 0.12, t: 0.12, m: 0.01 }),
    item("wiremesh_m8", "SBY-WM-M8", "Wiremesh M8 untuk pelat lantai / lantai kerja", "m2", 78000, 16000, 0, { p: 0.06, t: 0.06, m: 0.005 }),
    item("panel_lantai_aac", "SBY-AAC-FLR", "Panel lantai AAC hebel t=12,5 cm terpasang", "m2", 345000, 85000, 25000, { p: 0.25, t: 0.25, m: 0.02 }),

    // Divisi IV: Pekerjaan Dinding & Bata (Unit per buah bata + mortar / perekat)
    item("bata_hebel", "AHSP-A.4.4.1.25", "Bata ringan / Hebel AAC (per buah setara 600×200×100)", "bh", 8600, 1950, 0, { p: 0.01, t: 0.017, m: 0.005 }, "Permen PUPR 8/2023 koefisien thinbed"),
    item("bata_merah", "AHSP-A.4.4.1.9", "Bata merah lokal Surabaya (per buah)", "bh", 850, 480, 0, { p: 0.0043, t: 0.0014, m: 0.0002 }),
    item("bata_batako", "AHSP-A.4.4.1.19", "Batako semen press (per buah)", "bh", 4200, 1450, 0, { p: 0.012, t: 0.006, m: 0.001 }),
    item("bata_custom", "SBY-BRK-CST", "Bata / blok pasangan custom (per buah sesuai dimensi)", "bh", 5500, 1500, 0, { p: 0.01, t: 0.01, m: 0.002 }),
    item("perekat_hebel", "AHSP-A.4.4.1.25m", "Mortar instan perekat bata ringan (zak 40 kg)", "zak", 76000, 0, 0, undefined, "Konsumsi sesuai tebal nat 2-4 mm"),
    item("semen_pc", "SBY-PC-50", "Semen Portland Gresik/Tiga Roda (zak 50 kg)", "zak", 67000, 0, 0),
    item("pasir_pasang", "SBY-PSR-01", "Pasir pasang Lumajang", "m3", 340000, 0, 0),
    item("plesteran", "AHSP-A.4.4.2.5", "Plesteran 1SP:5PP tebal 15 mm (2 sisi)", "m2", 34000, 38000, 0, { p: 0.3, t: 0.15, k: 0.015, m: 0.015 }),
    item("acian", "AHSP-A.4.4.2.27", "Acian semen halus / skim coat", "m2", 14500, 24000, 0, { p: 0.2, t: 0.1, k: 0.01, m: 0.01 }),
    item("roster", "SBY-RST-20", "Lubang angin permanen roster beton 20×20 cm", "bh", 28000, 18000, 0, { p: 0.08, t: 0.08, m: 0.005 }),

    // Divisi V: Atap, Talang, Plafon & Insulasi
    item("rangka_atap", "AHSP-A.4.5.2.32", "Rangka atap baja ringan C75.75 + reng", "m2", 118000, 48000, 0, { p: 0.15, t: 0.15, m: 0.01 }),
    item("atap_standing_seam", "SBY-RF-SS", "Penutup atap metal standing seam + clip", "m2", 185000, 42000, 0, { p: 0.1, t: 0.12, m: 0.008 }),
    item("atap_spandek", "SBY-RF-SPD", "Penutup atap spandek pasir peredam", "m2", 95000, 32000, 0, { p: 0.1, t: 0.1, m: 0.008 }),
    item("atap_genteng_beton", "AHSP-A.4.5.2.33", "Genteng beton flat + nok", "m2", 88000, 38000, 0, { p: 0.15, t: 0.1, m: 0.008 }),
    item("atap_genteng_keramik", "AHSP-A.4.5.2.34", "Genteng keramik glazur M-Class + nok", "m2", 145000, 42000, 0, { p: 0.15, t: 0.12, m: 0.008 }),
    item("insulasi_atap", "SBY-INS-AL", "Insulasi atap aluminium foil bubble 8 mm", "m2", 34000, 12000, 0, { p: 0.05, t: 0.05 }),
    item("talang_galvalum", "AHSP-A.4.5.2.40", "Talang jurai dalam / parapet galvalum lebar 30 cm", "m1", 95000, 45000, 0, { p: 0.15, t: 0.15 }),
    item("pipa_hujan", "SBY-DP-3", "Pipa turun air hujan PVC AW 3\" + klem", "m1", 52000, 24000, 0, { p: 0.08, t: 0.08 }),
    item("lisplank", "AHSP-A.4.6.1.21", "Lisplank GRC woodplank 20 cm", "m1", 42000, 26000, 0, { p: 0.1, t: 0.1 }),
    item("plafon", "AHSP-A.4.5.1.7", "Plafon gypsum 9 mm + rangka hollow galvalum", "m2", 92000, 48000, 0, { p: 0.15, t: 0.15, m: 0.01 }),
    item("skylight_glass", "SBY-SKY-T10", "Skylight kaca tempered 10 mm laminated + rangka", "m2", 950000, 220000, 0, { p: 0.4, t: 0.4 }),

    // Divisi VI: Lantai, Rabat & Carport
    item("rabat_carport", "SBY-CRP-10", "Cor rabat carport 10 cm + keramik batu sikat/anti-slip", "m2", 175000, 68000, 0, { p: 0.3, t: 0.25, m: 0.015 }),
    item("keramik30", "AHSP-A.4.4.3.34a", "Keramik lantai 30×30 cm anti-slip + spesi", "m2", 85000, 52000, 0, { p: 0.35, t: 0.35, m: 0.018 }),
    item("keramik40", "AHSP-A.4.4.3.34", "Keramik lantai 40×40 cm + spesi perekat", "m2", 98000, 52000, 0, { p: 0.35, t: 0.35, m: 0.018 }),
    item("keramik60", "AHSP-A.4.4.3.35", "Granit tile / homogeneous 60×60 cm + mortar", "m2", 165000, 65000, 0, { p: 0.4, t: 0.4, m: 0.02 }),
    item("plint_lantai", "AHSP-A.4.4.3.42", "Plint / skirting keramik 10 cm", "m1", 22000, 18000, 0, { p: 0.08, t: 0.08 }),

    // Divisi VII: Pintu, Jendela & Railing
    item("pintu_utama", "SBY-DR-MAIN", "Pintu utama kayu solid engineering + kusen + smart/handle", "unit", 2850000, 450000, 0, { p: 0.8, t: 1.2, m: 0.05 }),
    item("pintu_kamar", "SBY-DR-BED", "Pintu kamar kayu kamper/WPC + kusen + kunci", "unit", 1450000, 320000, 0, { p: 0.6, t: 1.0, m: 0.04 }),
    item("pintu_km", "SBY-DR-PVC", "Pintu KM/WC UPVC/Aluminium tahan air", "unit", 950000, 220000, 0, { p: 0.4, t: 0.6, m: 0.02 }),
    item("pintu_geser", "SBY-DR-SLD", "Pintu geser aluminium YKK/Alexindo + kaca 8 mm", "m2", 1150000, 260000, 0, { p: 0.4, t: 0.5, m: 0.02 }),
    item("jendela", "SBY-WN-AL", "Jendela kusen aluminium + kaca 5 mm + aksesoris", "m2", 820000, 195000, 0, { p: 0.3, t: 0.4, m: 0.02 }),
    item("railing_tangga", "SBY-RL-STL", "Railing tangga & balkon/void besi hollow + handrail kayu", "m1", 480000, 165000, 0, { p: 0.2, t: 0.3 }),

    // Divisi VIII: MEP (Air, Sanitasi, Listrik, HVAC, Mitigasi Banjir)
    item("pipa_air_bersih", "AHSP-A.5.1.1.25", "Pipa air bersih PVC AW 1/2\" + 3/4\" + fitting", "m1", 32000, 18000, 0, { p: 0.05, t: 0.08 }),
    item("pipa_air_kotor", "AHSP-A.5.1.1.32", "Pipa air limbah PVC D-3\" & 4\" + fitting", "m1", 88000, 34000, 0, { p: 0.1, t: 0.12 }),
    item("septic_biotank", "SBY-BIO-1500", "Bio septic tank 1.500 L + sumur resapan limbah", "unit", 4200000, 850000, 0, { p: 2.0, t: 1.0, m: 0.1 }),
    item("kloset_duduk", "AHSP-A.5.1.1.1", "Kloset duduk Toto/setara + jet washer", "unit", 1850000, 320000, 0, { p: 0.8, t: 1.0, m: 0.05 }),
    item("shower_set", "SBY-SAN-SHW", "Shower set mixer + kran dinding", "set", 680000, 180000, 0, { p: 0.4, t: 0.6 }),
    item("wastafel", "AHSP-A.5.1.1.5", "Wastafel keramik + kran + siphon", "unit", 720000, 210000, 0, { p: 0.5, t: 0.7 }),
    item("kitchen_sink", "SBY-KIT-SNK", "Bak cuci piring stainless + meja beton keramik", "unit", 1150000, 350000, 0, { p: 0.7, t: 0.9 }),
    item("floor_drain", "AHSP-A.5.1.1.14", "Floor drain stainless anti bau", "bh", 85000, 35000, 0, { p: 0.08, t: 0.1 }),
    item("conduit", "SBY-EL-CND", "Pipa conduit PVC Ø20 mm + aksesoris", "m1", 9500, 6500, 0, { p: 0.03, t: 0.05 }),
    item("kabel_nym15", "SBY-EL-15", "Kabel NYM 2×1,5 mm² (sirkuit lampu PUIL)", "m1", 16500, 7500, 0, { p: 0.02, t: 0.04 }),
    item("kabel_nym25", "SBY-EL-25", "Kabel NYM 3×2,5 mm² (stop kontak & AC PUIL)", "m1", 28500, 9500, 0, { p: 0.03, t: 0.05 }),
    item("titik_lampu", "SBY-EL-LMP", "Titik instalasi lampu + armatur LED downlight", "bh", 115000, 55000, 0, { p: 0.1, t: 0.2 }),
    item("saklar", "SBY-EL-SW", "Saklar inbow Schneider/Panasonic", "bh", 52000, 32000, 0, { p: 0.05, t: 0.1 }),
    item("stopkontak", "SBY-EL-SK", "Stop kontak inbow arde (+ tipe waterproof area basah)", "bh", 58000, 35000, 0, { p: 0.05, t: 0.1 }),
    item("panel_mcb", "SBY-EL-MCB", "Box MCB 8 grup + ELCB anti-kontak + grounding arde", "unit", 1250000, 380000, 0, { p: 0.5, t: 1.0 }),
    item("ac_split", "SBY-HVAC-AC", "Unit AC Split Inverter + pipa refrigerant + pasang", "unit", 3950000, 550000, 0, { p: 0.5, t: 1.0 }),
    item("kipas_plafon", "SBY-HVAC-CF", "Kipas angin plafon / dinding + instalasi", "unit", 580000, 145000, 0, { p: 0.2, t: 0.4 }),
    item("exhaust_fan", "SBY-HVAC-EX", "Exhaust fan kamar mandi / dapur + ducting", "unit", 360000, 120000, 0, { p: 0.15, t: 0.3 }),

    // Mitigasi Banjir (opsional, otomatis aktif di RAB jika dipilih)
    item("sumur_resapan", "SNI-03-2453", "Sumur resapan air hujan Ø80 cm dalam 2 m (buis + ijuk + kerikil)", "unit", 1450000, 650000, 0, { p: 2.0, t: 1.0, m: 0.1 }),
    item("backflow_valve", "SBY-FLD-BFV", "Backflow valve PVC 4\" anti arus balik banjir", "bh", 420000, 140000, 0, { p: 0.2, t: 0.3 }),
    item("flood_barrier", "SBY-FLD-BAR", "Sekat pintu tahan banjir aluminium removable + seal karet", "unit", 1850000, 350000, 0, { p: 0.3, t: 0.5 }),
    item("pompa_kuras", "SBY-FLD-PMP", "Pompa celup submersible otomatis + selang buang", "unit", 1250000, 220000, 0, { p: 0.2, t: 0.3 }),

    // Divisi IX: Pengecatan, Waterproofing & Finishing
    item("cat_eksterior", "AHSP-A.4.7.1.10e", "Cat dinding eksterior tahan cuaca (sealer + 2 lapis)", "m2", 29000, 24000, 0, { p: 0.08, t: 0.1, m: 0.005 }),
    item("cat_interior", "AHSP-A.4.7.1.10", "Cat dinding interior + plafon (plamir + 2 lapis)", "m2", 22000, 21000, 0, { p: 0.07, t: 0.09, m: 0.004 }),
    item("waterproofing", "SBY-WP-01", "Waterproofing coating dinding bawah / KM / balkon / dak", "m2", 48000, 28000, 0, { p: 0.1, t: 0.12 }),
  ];

  const items: Record<string, PriceItem> = {};
  for (const r of rows) {
    items[r.id] = r;
  }

  return {
    id: "sby-2026",
    region: "Surabaya / Jawa Timur (HSPK + Permen PUPR 8/2023)",
    currency: "IDR",
    effectiveDate: "2026-01-15",
    source: "Estimasi HSPK Kota Surabaya 2026 & Koefisien Permen PUPR No. 8 Tahun 2023 (dapat diedit)",
    items,
  };
}
