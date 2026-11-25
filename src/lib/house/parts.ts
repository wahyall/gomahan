import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import { fmtNum } from "@/lib/utils/format";

export type PartId =
  | "pondasi"
  | "sloof"
  | "kolom"
  | "balok"
  | "pelat"
  | "tangga"
  | "ringbalk"
  | "dinding"
  | "pintu"
  | "jendela"
  | "vent"
  | "lantai"
  | "rangka"
  | "lisplank"
  | "genteng"
  | "talang"
  | "plafon"
  | "plester"
  | "cat"
  | "pipaAirBersih"
  | "pipaAirKotor"
  | "septic"
  | "sumurResapan"
  | "meterAir"
  | "kloset"
  | "sink"
  | "listrikLampu"
  | "listrikKontak"
  | "titikLampu"
  | "stopkontak"
  | "panelMcb"
  | "acUnit"
  | "kipas";

export interface PartInfo {
  id: PartId;
  label: string;
  group: string;
  ringkas: string;
  specs: string[];
  praktik?: string;
  rowIds: string[];
  priceKeys: string[];
}

export function getPartInfo(
  id: string,
  derived: DerivedProjectModel,
  struct: StructuralReport,
): PartInfo | null {
  const { project, masonry, roof, mep } = derived;
  const bSpec = project.systems.brick;
  const sys = project.systems;
  const peil = project.site.peil;

  switch (id) {
    case "pondasi":
      return {
        id: "pondasi",
        label: `Pondasi (${sys.foundation.replace("_", " ")})`,
        group: "Struktur Bawah",
        ringkas: `${struct.foundations.length} titik pondasi 2 lantai + peninggian peil +${Math.round(peil.floor1PeilM * 100)} cm.`,
        specs: [
          `Jenis: ${struct.foundations[0]?.sizeLabel ?? sys.foundation}`,
          `Volume beton pondasi: ${fmtNum(struct.concreteVolumes.foundationM3, 2)} m³ (K-250 / fc' ${project.structuralParams.concreteFcMpa} MPa)`,
          `Batu kali: ${fmtNum(struct.concreteVolumes.batukaliM3, 1)} m³ · Strauss pile: ${fmtNum(struct.concreteVolumes.straussMeters, 1)} m'`,
          `Daya dukung izin asumsi: ${project.site.soil.allowableBearingKpa} kPa (${project.site.soil.city})`,
        ],
        praktik: "Wajib lakukan uji sondir/CPT di lapangan Surabaya sebelum pengecoran final.",
        rowIds: ["galian", "urugan_tanah", "footplate_beton", "pondasi_batukali", "strauss_pile", "cakar_beton"],
        priceKeys: ["galian", "urugan_tanah", "footplate_beton", "pondasi_batukali", "strauss_pile", "cakar_beton"],
      };
    case "sloof":
      return {
        id: "sloof",
        label: "Sloof Struktural 20/30",
        group: "Struktur Beton",
        ringkas: "Balok pengikat bawah mengelilingi grid 5×17 m di atas pondasi & peninggian peil.",
        specs: [
          `Volume beton sloof: ${fmtNum(struct.concreteVolumes.sloofM3, 2)} m³`,
          "Tulangan pokok 6D12 + begel Ø8-120/150, selimut beton 40 mm",
        ],
        rowIds: ["beton_k250", "besi_ulir"],
        priceKeys: ["beton_k250", "besi_ulir"],
      };
    case "kolom":
      return {
        id: "kolom",
        label: `Kolom Struktur & Praktis (${struct.columns.length} titik)`,
        group: "Struktur Beton",
        ringkas: `${struct.columns.filter((c) => c.isMain).length} kolom utama 20/25 + ${struct.columns.filter((c) => !c.isMain).length} kolom praktis 15/15.`,
        specs: [
          `Volume beton kolom: ${fmtNum(struct.concreteVolumes.columnsM3, 2)} m³`,
          `Baja WF (jika dipilih): ${fmtNum(struct.steelWfKg, 0)} kg`,
          "Sengkang seismic hook 135° jarak 100 mm di zona sendi plastis (SNI 2847:2019)",
        ],
        rowIds: ["beton_k250", "besi_ulir", "baja_wf"],
        priceKeys: ["beton_k250", "besi_ulir", "baja_wf"],
      };
    case "balok":
      return {
        id: "balok",
        label: "Balok Induk LT2 (20/35)",
        group: "Struktur Beton",
        ringkas: "Pemikul pelat lantai 2 dan beban dinding atas dengan bentang maksimum ~3,65 m.",
        specs: [
          `Volume beton balok induk: ${fmtNum(struct.concreteVolumes.beamsM3, 2)} m³`,
          "Tulangan 3D13 atas + 3D13 bawah + begel Ø8-100/150",
        ],
        rowIds: ["beton_k250", "besi_ulir", "bekisting_struktur"],
        priceKeys: ["beton_k250", "besi_ulir", "bekisting_struktur"],
      };
    case "pelat":
      return {
        id: "pelat",
        label: `Pelat Lantai 2 (${sys.slab})`,
        group: "Struktur Beton",
        ringkas: "Pelat lantai tingkat 2 dengan bukaan tangga tengah dan void taman belakang 1,65×3,3 m.",
        specs: [
          `Beton pelat cor: ${fmtNum(struct.concreteVolumes.slabM3, 2)} m³`,
          `Bondek: ${fmtNum(struct.bondekM2, 1)} m² · Wiremesh M8: ${fmtNum(struct.wiremeshM2, 1)} m² · Panel AAC: ${fmtNum(struct.aacFloorPanelM2, 1)} m²`,
        ],
        rowIds: ["beton_k250", "bondek", "wiremesh_m8", "panel_lantai_aac"],
        priceKeys: ["beton_k250", "bondek", "wiremesh_m8", "panel_lantai_aac"],
      };
    case "tangga":
      return {
        id: "tangga",
        label: "Tangga Beton Utama (20 Anak Tangga)",
        group: "Struktur Beton",
        ringkas: "Tangga lurus sepanjang 4,8 m di sisi kiri dengan Powder Room tepat di bawahnya.",
        specs: [
          `20 optrade @ 18 cm, antrede 25 cm (total naik 3,60 m)`,
          `Volume beton tangga: ${fmtNum(struct.concreteVolumes.stairsM3, 2)} m³`,
        ],
        rowIds: ["beton_k250", "railing_tangga"],
        priceKeys: ["beton_k250", "railing_tangga"],
      };
    case "ringbalk":
      return {
        id: "ringbalk",
        label: "Ring Balk Atap 15/20",
        group: "Struktur Beton",
        ringkas: "Balok pengikat puncak dinding lantai 2 dan dudukan rangka atap shed 10°.",
        specs: [`Volume beton ring balk: ${fmtNum(struct.concreteVolumes.ringBalkM3, 2)} m³`],
        rowIds: ["beton_k250", "besi_ulir"],
        priceKeys: ["beton_k250", "besi_ulir"],
      };
    case "dinding":
      return {
        id: "dinding",
        label: `Pasangan Bata: ${bSpec.name}`,
        group: "Dinding & Bata",
        ringkas: `Ukuran bata ${bSpec.lengthMm}×${bSpec.heightMm}×${bSpec.depthMm} mm, nat ${bSpec.mortarMm} mm, tebal luar ${bSpec.outerThicknessMm} mm / sekat ${bSpec.innerThicknessMm} mm.`,
        specs: [
          `Terpasang di model 3D: ${fmtNum(masonry.totalPiecesPlaced)} bata (potongan ${fmtNum(masonry.cutPiecesCount)} bh)`,
          `Kebutuhan beli (+waste ${bSpec.wastePct}%): ${fmtNum(masonry.totalBuyBricks)} buah`,
          bSpec.mortarKind === "thinbed"
            ? `Perekat thinbed: ${fmtNum(masonry.thinbedZak40kg)} zak @40 kg (${fmtNum(masonry.thinbedKg, 0)} kg)`
            : `Adukan 1:5: ${fmtNum(masonry.cementZak50kg)} zak semen @50 kg + ${fmtNum(masonry.sandM3, 1)} m³ pasir`,
          `Tebal dinding memakai ${fmtNum(derived.totalWallDeductionM2, 2)} m² (${fmtNum(derived.totalWallDeductionPct, 1)}%) dari luas lantai kotor`,
        ],
        rowIds: ["bata_dinding", "perekat_hebel", "semen_pc", "pasir_pasang"],
        priceKeys: ["bata_hebel", "bata_merah", "bata_batako", "bata_custom", "perekat_hebel", "semen_pc", "pasir_pasang"],
      };
    case "pintu":
      return {
        id: "pintu",
        label: `Pintu & Kusen (${derived.totalDoors} unit)`,
        group: "Dinding & Bukaan",
        ringkas: "Pintu utama kayu engineering, pintu kamar, pintu KM UPVC tahan air, & pintu geser taman.",
        specs: [`Total pintu terpasang: ${derived.totalDoors} unit`],
        rowIds: ["pintu_utama", "pintu_kamar", "pintu_km", "pintu_geser"],
        priceKeys: ["pintu_utama", "pintu_kamar", "pintu_km", "pintu_geser"],
      };
    case "jendela":
      return {
        id: "jendela",
        label: `Jendela & Kaca (${derived.totalWindows} unit)`,
        group: "Dinding & Bukaan",
        ringkas: `Total luas kaca ${fmtNum(derived.totalWindowAreaM2, 2)} m² (${fmtNum(derived.lightingRatioPct, 1)}% dari luas ruangan tertutup).`,
        specs: [
          `Status SNI 03-2396 (min. 5%): ${derived.lightingRatioPct >= 5 ? "Memenuhi" : "Kurang"}`,
          "Semua jendela ditempatkan di fasad depan & void belakang (bebas batas tetangga).",
        ],
        rowIds: ["jendela"],
        priceKeys: ["jendela"],
      };
    case "vent":
      return {
        id: "vent",
        label: `Lubang Angin / Roster (${derived.totalVents} titik)`,
        group: "Dinding & Bukaan",
        ringkas: "Roster beton 20×20 cm di atas kusen untuk aliran silang pasif 24 jam.",
        specs: [`Jumlah bukaan roster: ${derived.totalVents} titik`],
        rowIds: ["roster"],
        priceKeys: ["roster"],
      };
    case "lantai":
      return {
        id: "lantai",
        label: `Lantai Keramik/Granit ${sys.tileSizeCm}×${sys.tileSizeCm} cm`,
        group: "Finishing",
        ringkas: `Total luas bersih ${fmtNum(derived.totalNetFloorM2, 2)} m² dengan anti-slip di 4 area KM/WC.`,
        specs: [
          `Total keping grid 3D: ${fmtNum(derived.floors.reduce((s, f) => s + f.totalTiles, 0))} keping`,
          `Peil LT1 +${Math.round(peil.floor1PeilM * 100)} cm di atas jalan (Carport +${Math.round(peil.carportPeilM * 100)} cm)`,
        ],
        rowIds: ["keramik_lantai", "rabat_carport", "plint_lantai"],
        priceKeys: ["keramik30", "keramik40", "keramik60", "rabat_carport"],
      };
    case "rangka":
      return {
        id: "rangka",
        label: "Rangka Atap Baja Ringan C75",
        group: "Atap & Plafon",
        ringkas: `${roof.trussCount} rangka atap miring ${roof.slopeDeg}° (${sys.roofType}).`,
        specs: [`Total panjang gording/reng: ${fmtNum(roof.purlinMeters, 1)} m`],
        rowIds: ["rangka_atap"],
        priceKeys: ["rangka_atap"],
      };
    case "genteng":
      return {
        id: "genteng",
        label: `Penutup Atap (${sys.roofCover}) + Insulasi`,
        group: "Atap & Plafon",
        ringkas: `Atap ${sys.roofType} kemiringan ${roof.slopeDeg}° luas ${fmtNum(roof.areaM2, 1)} m².`,
        specs: [`Kebutuhan: ${fmtNum(roof.coverUnitsCount)} ${roof.coverUnitLabel}`, `Insulasi foil: ${sys.insulationMm} mm`],
        rowIds: ["penutup_atap", "insulasi_atap"],
        priceKeys: ["atap_standing_seam", "atap_spandek", "atap_genteng_beton", "atap_genteng_keramik", "insulasi_atap"],
      };
    case "talang":
      return {
        id: "talang",
        label: "Talang Depan & Parapet Tetangga",
        group: "Atap & Plafon",
        ringkas: `Talang lebar ${sys.gutterWidthMm} mm + ${sys.downspoutCount} pipa turun Ø${sys.downspoutDiaMm} mm ke sumur resapan.`,
        specs: [`Panjang total talang: ${fmtNum(roof.gutterMeters, 1)} m`, `Panjang pipa turun: ${fmtNum(roof.downspoutMeters, 1)} m`],
        rowIds: ["talang_galvalum", "pipa_hujan"],
        priceKeys: ["talang_galvalum", "pipa_hujan"],
      };
    case "lisplank":
      return {
        id: "lisplank",
        label: "Lisplank GRC Woodplank",
        group: "Atap & Plafon",
        ringkas: `Penutup tepi overstek sepanjang ${fmtNum(roof.fasciaMeters, 1)} m.`,
        specs: [`Panjang keliling: ${fmtNum(roof.fasciaMeters, 1)} m`],
        rowIds: ["lisplank"],
        priceKeys: ["lisplank"],
      };
    case "plafon":
      return {
        id: "plafon",
        label: "Plafon Gypsum 9 mm & Skylight Tangga",
        group: "Atap & Plafon",
        ringkas: "Rangka hollow galvalum + plafon tahan lembap di KM + skylight kaca tempered di atas tangga.",
        specs: [`Skylight tangga: 1,2 × 2,0 m`],
        rowIds: ["plafon", "skylight_glass"],
        priceKeys: ["plafon", "skylight_glass"],
      };
    case "plester":
    case "cat":
      return {
        id: id as PartId,
        label: "Plester, Acian, Cat & Waterproofing",
        group: "Finishing",
        ringkas: `Luas dua sisi dinding ${fmtNum(masonry.plasterAreaTwoSidesM2, 1)} m² + proteksi waterproofing anti-banjir.`,
        specs: [
          `Plester aktif: ${bSpec.plasterBothSides ? "Ya" : "Tidak (thinbed acian langsung)"}`,
          `Waterproofing dinding bawah LT1: ${project.floodMitigation.wallWaterproofing ? "Aktif (0–1,2 m)" : "Area KM saja"}`,
        ],
        rowIds: ["plesteran", "acian", "cat_eksterior", "cat_interior", "waterproofing"],
        priceKeys: ["plesteran", "acian", "cat_eksterior", "cat_interior", "waterproofing"],
      };
    case "pipaAirBersih":
    case "meterAir":
    case "kloset":
    case "sink":
      return {
        id: id as PartId,
        label: "Instalasi Air Bersih & Sanitair",
        group: "Instalasi Air",
        ringkas: `Jalur pipa PVC AW ${fmtNum(mep.airBersihM, 1)} m dari PDAM ke dapur, powder room & 3 KM.`,
        specs: [`Kloset: ${Math.max(3, mep.kloset)} unit · Shower: 3 set · Wastafel: 3 unit`],
        rowIds: ["pipa_air_bersih", "kloset_duduk", "shower_set", "wastafel", "kitchen_sink"],
        priceKeys: ["pipa_air_bersih", "kloset_duduk", "shower_set", "wastafel", "kitchen_sink"],
      };
    case "pipaAirKotor":
    case "septic":
      return {
        id: id as PartId,
        label: "Saluran Limbah, Bio Septic & Backflow Valve",
        group: "Instalasi Air",
        ringkas: `Pipa limbah ${fmtNum(mep.airKotorM, 1)} m menuju Bio Septic 1.500 L di bawah carport (mudah disedot dari jalan).`,
        specs: [
          `Backflow Valve anti-banjir: ${project.floodMitigation.backflowValve ? "Terpasang" : "Belum dipasang"}`,
        ],
        rowIds: ["pipa_air_kotor", "septic_biotank", "backflow_valve"],
        priceKeys: ["pipa_air_kotor", "septic_biotank", "backflow_valve"],
      };
    case "sumurResapan":
      return {
        id: "sumurResapan",
        label: "Sumur Resapan Air Hujan (SNI 03-2453)",
        group: "Mitigasi Banjir",
        ringkas: `${project.floodMitigation.infiltrationWells} unit sumur resapan Ø80 cm dalam 2 m di halaman depan.`,
        specs: [`Menerima limpasan atap shed depan melalui 2 pipa downspout`],
        rowIds: ["sumur_resapan", "pompa_kuras", "flood_barrier"],
        priceKeys: ["sumur_resapan", "pompa_kuras", "flood_barrier"],
      };
    case "listrikLampu":
    case "listrikKontak":
    case "titikLampu":
    case "stopkontak":
    case "panelMcb":
      return {
        id: id as PartId,
        label: "Instalasi Listrik (PUIL 2011 Aman Banjir)",
        group: "Instalasi Listrik",
        ringkas: `Conduit ${fmtNum(mep.conduitM, 1)} m · ${mep.titikLampu} titik lampu · MCB ${project.rabSettings.plnVaTier} VA (rekomendasi min. ${mep.recommendedPlnVa} VA).`,
        specs: [
          `Kabel lampu NYM 2×1,5 mm²: ${fmtNum(mep.kabelLampuM, 1)} m`,
          `Kabel stop kontak & AC NYM 3×2,5 mm²: ${fmtNum(mep.kabelKontakM + mep.kabelAcM, 1)} m`,
          `Tinggi stop kontak LT1: ${Math.round(project.floodMitigation.outletHeightM * 100)} cm · MCB: ${Math.round(project.floodMitigation.mcbHeightM * 100)} cm`,
        ],
        rowIds: ["conduit", "kabel_nym15", "kabel_nym25", "titik_lampu", "stopkontak", "panel_mcb"],
        priceKeys: ["conduit", "kabel_nym15", "kabel_nym25", "titik_lampu", "stopkontak", "panel_mcb"],
      };
    case "acUnit":
    case "kipas":
      return {
        id: id as PartId,
        label: "Unit AC Split & Kipas Angin (Dapat Dipindah)",
        group: "Tata Udara (HVAC)",
        ringkas: `${mep.acCount} unit AC Split + ${mep.fanCount} kipas + ${mep.exhaustCount} exhaust fan aktif dalam simulasi aliran udara.`,
        specs: [
          `Total beban listrik HVAC aktif: ${fmtNum(derived.project.levels.flatMap((l) => l.hvac).filter((h) => h.on).reduce((s, h) => s + h.powerW, 0))} W`,
          "Klik unit langsung di viewport 3D untuk menggeser, memutar arah hembusan, atau mengubah PK/kecepatan.",
        ],
        rowIds: ["ac_split", "kipas_plafon", "exhaust_fan"],
        priceKeys: ["ac_split", "kipas_plafon", "exhaust_fan"],
      };
    default:
      return null;
  }
}
