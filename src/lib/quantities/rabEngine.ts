import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { isIndoorRoomProgram } from "@/lib/geometry/rooms";
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
    const cleanQty = Math.max(0, qty);
    if (cleanQty <= 0) return;
    const item: PriceItem | undefined = prices[priceKey];
    const matU = item?.materialPrice ?? 0;
    const eqU = item?.equipmentPrice ?? 0;
    const labU = settings.laborMode === "ahsp_oh" ? item?.laborPrice ?? 0 : 0;
    const unitPrice = matU + labU + eqU;
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

  const lotArea = project.site.width * project.site.depth;
  const perimeterLot = 2 * (project.site.width + project.site.depth);
  const peilHeight = project.site.peil.floor1PeilM;
  const lt1Walls = (project.levels[0]?.walls ?? []).filter((w) => w.kind !== "fence");
  const lt2Walls = (project.levels[1]?.walls ?? []).filter((w) => w.kind !== "fence");
  const allWalls = [...lt1Walls, ...lt2Walls];
  const allFences = [...(project.levels[0]?.walls ?? []), ...(project.levels[1]?.walls ?? [])].filter((w) => w.kind === "fence");
  const allRooms = floors.flatMap((f) => f.rooms);
  const pools = project.buildExtras?.pools ?? [];
  const customTiles = project.buildExtras?.floorTiles ?? [];
  const hasBuilding = allWalls.length > 0 || allFences.length > 0 || allRooms.length > 0 || pools.length > 0 || customTiles.length > 0;

  if (hasBuilding) {
    // Divisi I: Persiapan
    push("bouwplank", "d1", "bouwplank", "Pengukuran & bouwplank keliling tapak 5×17 m", "Profil kayu + patok as + selang waterpass", Math.ceil(perimeterLot), true, "st-01", `Keliling kavling ${perimeterLot} m`);
    push("pembersihan", "d1", "pembersihan", "Pembersihan lahan & perapihan akhir", "Lahan 5×17 m", lotArea, true, "st-01", `Luas lahan ${lotArea.toFixed(1)} m²`);

    // Divisi II: Tanah, Peil Banjir & Pondasi
    const lt1WallLen = lt1Walls.reduce((s, w) => s + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z), 0);
    const galianM3 =
      struct.foundations.length * 1.1 * 1.1 * 1.2 +
      (sys.foundation === "footplate_batukali" ? lt1WallLen * 0.55 * 0.65 : 0);
    push("galian", "d2", "galian", "Galian tanah pondasi & footplate", `${struct.foundations.length} titik footplate + jalur pondasi`, Math.ceil(galianM3 * 10) / 10, true, "st-02", "Volume galian tapak & jalur sloof");

    const lt1EnclosedArea = (floors[0]?.rooms ?? [])
      .filter((r) => isIndoorRoomProgram(r.room.program))
      .reduce((s, r) => s + r.grossAreaM2, 0);
    const carportArea = allRooms
      .filter((r) => r.room.program === "carport")
      .reduce((s, r) => s + r.netAreaM2, 0);
    const uruganPeilM3 =
      lt1EnclosedArea * Math.max(0, peilHeight - 0.1) +
      carportArea * Math.max(0, project.site.peil.carportPeilM);
    if (uruganPeilM3 > 0.1) {
      push("urugan_tanah", "d2", "urugan_tanah", `Urugan sirtu peninggian peil (+${Math.round(peilHeight * 100)} cm dari jalan)`, "Dipadatkan per layer 20 cm (mitigasi banjir)", Math.ceil(uruganPeilM3 * 10) / 10, true, "st-02", `Luas tapak indoor × peil lantai +${peilHeight.toFixed(2)} m`);
    }

    const pasirM3 = struct.foundations.length * 1.2 * 0.1 + carportArea * 0.08;
    if (pasirM3 > 0.05) {
      push("urugan_pasir", "d2", "urugan_pasir", "Urugan pasir bawah pondasi & lantai kerja", "Tebal 10 cm", Math.ceil(pasirM3 * 10) / 10, true, "st-02", "Alas pondasi & rabat");
    }
    if (struct.concreteVolumes.leanConcreteM3 > 0) {
      push("lantai_kerja", "d2", "lantai_kerja", "Lantai kerja beton tumbuk 1:3:5 (t=5 cm)", "Di bawah footplate & sloof", Math.ceil(struct.concreteVolumes.leanConcreteM3 * 100) / 100, true, "st-02", "Luas tapak pondasi × 0,05 m");
    }

    if (struct.concreteVolumes.batukaliM3 > 0) {
      push("pondasi_batukali", "d2", "pondasi_batukali", "Pasangan pondasi batu kali 1:5", "Jalur dinding LT1 + peninggian peil", Math.ceil(struct.concreteVolumes.batukaliM3 * 10) / 10, true, "st-02", "Panjang dinding × penampang batu kali");
    }
    if (sys.foundation === "strauss_pile" && struct.concreteVolumes.straussMeters > 0) {
      push("strauss_pile", "d2", "strauss_pile", "Pengeboran & cor Strauss Pile Ø30 cm", `${struct.foundations.length * 2} titik kedalaman 3 m`, Math.ceil(struct.concreteVolumes.straussMeters), true, "st-02", "Jumlah titik × kedalaman 3 m");
    }
    if (sys.foundation === "cakar_ayam" && struct.concreteVolumes.foundationM3 > 0) {
      push("cakar_beton", "d2", "cakar_beton", "Pondasi Cakar Ayam (Pelat + Buis Ø40)", "Sistem Sedyatmo untuk tanah lunak", Math.ceil(struct.concreteVolumes.foundationM3 * 100) / 100, true, "st-02", "Volume pelat + buis beton");
    } else if (struct.concreteVolumes.foundationM3 > 0) {
      const volFoot =
        sys.foundation === "strauss_pile"
          ? struct.concreteVolumes.pileCapConcreteM3
          : struct.concreteVolumes.foundationM3;
      push("footplate_beton", "d2", "footplate_beton", `Beton ${sys.foundation === "elevated_flood" ? "Footplate + Pedestal Panggung" : sys.foundation === "strauss_pile" ? "Pile Cap" : "Footplate"} K-250`, `${struct.foundations.length} titik pondasi struktural`, Math.ceil(volFoot * 100) / 100, true, "st-02", "Sum volume beton footplate / pile cap");
    }

    // Divisi III: Struktur Utama
    const upperConcreteM3 = Math.max(0, struct.concreteVolumes.totalConcreteM3 - struct.concreteVolumes.leanConcreteM3 - struct.concreteVolumes.foundationM3);
    if (upperConcreteM3 > 0) {
      push("beton_k250", "d3", "beton_k250", "Beton struktur K-250 (sloof, kolom, balok, pelat, tangga, ring balk)", `Mutu fc' ${project.structuralParams.concreteFcMpa} MPa`, Math.ceil(upperConcreteM3 * 100) / 100, true, "st-03", "Sloof + Kolom + Balok + Pelat + Tangga + Ring balk");
    }
    if (struct.totalRebarKg > 0) {
      push("besi_ulir", "d3", "besi_ulir", "Baja tulangan beton BJTS 420B + sengkang (BBS)", `${struct.bbs.length} bar mark sesuai SNI 2847:2019`, Math.ceil(struct.totalRebarKg), true, "st-03", "Total berat Bar Bending Schedule");
    }
    if (struct.totalFormworkM2 > 0) {
      push("bekisting_struktur", "d3", "bekisting_struktur", "Bekisting sloof, kolom, balok & pelat", "Multiplek 12 mm + kaso/steger", Math.ceil(struct.totalFormworkM2 * 10) / 10, true, "st-03", "Luas permukaan cetakan elemen beton");
    }
    if (struct.steelWfKg > 0) {
      push("baja_wf", "d3", "baja_wf", "Profil Baja IWF / H-Beam + pelat sambung", "Sistem struktur rangka baja", Math.ceil(struct.steelWfKg), true, "st-03", "Panjang kolom & balok × berat profil/m");
    }
    if (struct.bondekM2 > 0) {
      push("bondek", "d3", "bondek", "Pelat dek baja Bondek t=0,75 mm", "Alas cor pelat LT2", Math.ceil(struct.bondekM2 * 10) / 10, true, "st-04", "Luas pelat LT2 × 1,05");
    }
    if (struct.wiremeshM2 > 0) {
      push("wiremesh_m8", "d3", "wiremesh_m8", "Wiremesh M8 pelat lantai / cakar ayam", "Pengganti tulangan konvensional", Math.ceil(struct.wiremeshM2 * 10) / 10, true, "st-04", "Luas pelat / cakar ayam");
    }
    if (struct.aacFloorPanelM2 > 0) {
      push("panel_lantai_aac", "d3", "panel_lantai_aac", "Panel Lantai AAC Hebel t=12,5 cm", "Sistem lantai pracetak cepat", Math.ceil(struct.aacFloorPanelM2 * 10) / 10, true, "st-04", "Luas lantai 2 × 1,05");
    }

    // Divisi IV: Dinding & Bata
    const bSpec = sys.brick;
    if (masonry.totalBuyBricks > 0) {
      const brickPriceKey =
        bSpec.preset === "hebel"
          ? "bata_hebel"
          : bSpec.preset === "merah"
            ? "bata_merah"
            : bSpec.preset === "batako"
              ? "bata_batako"
              : bSpec.preset === "precast"
                ? "bata_precast"
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
        push("plesteran", "d4", "plesteran", "Plesteran dinding (1SP:5PP t=15 mm)", "Muka dinding yang dapat diplester", Math.ceil(masonry.plasterAreaTwoSidesM2 * 10) / 10, true, "st-09", "Luas netto muka dinding terplester (dinding batas tetangga 1 sisi)");
      }
      push("acian", "d4", "acian", "Acian / skim coat dinding", "Penghalusan sebelum pengecatan", Math.ceil(masonry.plasterAreaTwoSidesM2 * 10) / 10, true, "st-09", "Luas netto muka dinding terplester");
    }
    if (derived.totalVents > 0) {
      push("roster", "d4", "roster", "Lubang angin permanen (roster beton 20×20)", `${derived.totalVents} bukaan roster ventilasi pasif`, derived.totalVents * 2, true, "st-05", "Jumlah bukaan roster dari denah 3D");
    }

    // Divisi V: Atap, Talang & Plafon
    if (allWalls.length > 0) {
      push("rangka_atap", "d5", "rangka_atap", `Rangka atap baja ringan C75 (${roof.trussCount} kuda-kuda)`, `Sudut ${roof.slopeDeg}° (${sys.roofType}), jarak reng 45 cm`, Math.ceil(roof.areaM2), true, "st-07", "Luas bidang atap miring");
      const roofCoverKey =
        sys.roofCover === "standing_seam"
          ? "atap_standing_seam"
          : sys.roofCover === "spandek_pasir"
            ? "atap_spandek"
            : sys.roofCover === "genteng_beton"
              ? "atap_genteng_beton"
              : "atap_genteng_keramik";
      push("penutup_atap", "d5", roofCoverKey, `Penutup atap (${sys.roofCover})`, `Kemiringan ${roof.slopeDeg}°`, Math.ceil(roof.areaM2), true, "st-07", "Luas bidang atap termasuk overstek");
      if (sys.insulationMm > 0) {
        push("insulasi_atap", "d5", "insulasi_atap", `Insulasi peredam panas & suara (${sys.insulationMm} mm)`, "Aluminium foil double bubble di bawah atap", Math.ceil(roof.areaM2), true, "st-07", "Mengikuti luas atap");
      }
      push("talang_galvalum", "d5", "talang_galvalum", "Talang depan & talang jurai parapet tetangga", `Lebar ${sys.gutterWidthMm} mm (mencegah limpasan ke tetangga)`, Math.ceil(roof.gutterMeters * 10) / 10, true, "st-07", "Panjang talang eave + parapet");
      push("pipa_hujan", "d5", "pipa_hujan", `Pipa turun air hujan PVC ${sys.downspoutDiaMm} mm`, `${sys.downspoutCount} jalur downspout ke sumur resapan`, Math.ceil(roof.downspoutMeters), true, "st-07", "Jumlah downspout × tinggi atap");
      push("lisplank", "d5", "lisplank", "Lisplank GRC woodplank 20 cm", "Penutup keliling tepi atap", Math.ceil(roof.fasciaMeters), true, "st-07", "Keliling atap");
    }

    const ceilingArea = derived.indoorNetAreaM2;
    if (ceilingArea > 0) {
      push("plafon", "d5", "plafon", "Plafon gypsum 9 mm + hollow galvalum", "Gypsum tahan lembap untuk area KM/WC", Math.ceil(ceilingArea * 10) / 10, true, "st-09", "Luas ruangan indoor LT1 + LT2");
    }
    const skylightOpeningsArea = allWalls
      .flatMap((w) => w.openings)
      .filter((o) => o.kind === "skylight")
      .reduce((s, o) => s + o.width * o.height, 0);
    const stairCount = (project.levels[0]?.stairs ?? []).length;
    const skylightArea = skylightOpeningsArea > 0 ? skylightOpeningsArea : stairCount > 0 ? 2.4 : 0;
    if (skylightArea > 0) {
      push("skylight_glass", "d5", "skylight_glass", "Skylight kaca tempered void tangga", "Pencahayaan alami pusat bangunan", Math.ceil(skylightArea * 10) / 10, true, "st-07", "Bukaan skylight / tangga");
    }

    // Divisi VI: Lantai, Carport & Custom Tile Build Mode
    const tileKey = sys.tileSizeCm === 30 ? "keramik30" : sys.tileSizeCm === 40 ? "keramik40" : "keramik60";
    const tiledArea = derived.totalTiledAreaM2;
    const totalTiles = floors.reduce((s, f) => s + f.totalTiles, 0);
    if (tiledArea > 0) {
      push("keramik_lantai", "d6", tileKey, `Penutup lantai keramik/granit ${sys.tileSizeCm}×${sys.tileSizeCm} cm`, `${totalTiles} keping di model 3D (termasuk anti-slip KM)`, Math.ceil(tiledArea * 10) / 10, true, "st-10", "Luas bersih ruangan berkeramik");
    }
    if (customTiles.length > 0) {
      const extraTileArea = customTiles.length * 0.25;
      push("keramik_custom_build", "d6", tileKey, "Pelapis lantai kustom (Build Mode grid 50×50 cm)", `${customTiles.length} modul ubin kustom Build Mode`, Math.ceil(extraTileArea * 10) / 10, true, "st-10", `${customTiles.length} modul × 0,25 m²`);
    }
    if (carportArea > 0) {
      push("rabat_carport", "d6", "rabat_carport", "Rabat beton carport + batu sikat anti-slip", `Area parkir ${carportArea.toFixed(1)} m²`, Math.ceil(carportArea * 10) / 10, true, "st-10", "Luas zona carport LT1");
    }
    if (derived.totalWallLengthM > 0) {
      const nonFenceWallLen = allWalls.reduce((s, w) => s + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z), 0);
      if (nonFenceWallLen > 0) {
        push("plint_lantai", "d6", "plint_lantai", "Plint (skirting) keramik 10 cm keliling dinding", "Pelindung pertemuan lantai-dinding", Math.ceil(nonFenceWallLen * 1.15), true, "st-10", "Keliling dalam ruangan");
      }
    }

    // Kolam Renang / Fish Pond (`buildExtras.pools`)
    if (pools.length > 0) {
      let poolExcM3 = 0;
      let poolConcM3 = 0;
      let poolSurfaceM2 = 0;
      for (const pl of pools) {
        const pw = (Math.abs(pl.gx2 - pl.gx1) + 1) * 0.5;
        const pd = (Math.abs(pl.gz2 - pl.gz1) + 1) * 0.5;
        const perim = 2 * (pw + pd);
        poolExcM3 += pw * pd * pl.depth;
        poolConcM3 += (pw * pd + perim * pl.depth) * 0.14;
        poolSurfaceM2 += pw * pd + perim * pl.depth;
      }
      push("pool_galian", "d2", "galian", "Galian kolam renang / taman (Build Mode)", `${pools.length} kolam`, Math.ceil(poolExcM3 * 10) / 10, true, "st-02", "Panjang × lebar × kedalaman kolam");
      push("pool_beton", "d3", "beton_k250", "Beton K-250 struktur bak & dinding kolam", `${pools.length} kolam`, Math.ceil(poolConcM3 * 100) / 100, true, "st-03", "Dasar + dinding beton bertulang 14 cm");
      push("pool_wp", "d9", "waterproofing", "Waterproofing membrane kolam", `${pools.length} kolam`, Math.ceil(poolSurfaceM2 * 10) / 10, true, "st-12", "Luas dasar + dinding dalam kolam");
      push("pool_mosaic", "d6", "keramik30", "Finishing keramik/mozaik kolam", `${pools.length} kolam`, Math.ceil(poolSurfaceM2 * 10) / 10, true, "st-10", "Pelapis dasar & dinding dalam kolam");
    }

    // Divisi VII: Pintu, Jendela & Railing (derived from real openings/stairs/balconies)
    const allOpenings = allWalls.flatMap((w) => w.openings);
    const doorOps = allOpenings.filter((o) => o.kind === "door");
    const slidingArea = doorOps.filter((o) => o.width >= 1.3).reduce((s, o) => s + o.width * o.height, 0);
    const regularDoorCount = doorOps.filter((o) => o.width < 1.3).length;
    const bathroomCount = allRooms.filter((r) => r.room.program === "bathroom").length;
    const mainDoors = regularDoorCount > 0 ? 1 : 0;
    const kmDoors = Math.min(Math.max(0, regularDoorCount - mainDoors), bathroomCount);
    const bedDoors = Math.max(0, regularDoorCount - mainDoors - kmDoors);

    if (mainDoors > 0) push("pintu_utama", "d7", "pintu_utama", "Pintu utama kayu solid engineering", "Lengkap kusen & handle", mainDoors, true, "st-06", "1 unit pintu masuk utama");
    if (bedDoors > 0) push("pintu_kamar", "d7", "pintu_kamar", "Pintu kamar tidur", "Kusen + daun + kunci", bedDoors, true, "st-06", "Jumlah pintu kamar di model");
    if (kmDoors > 0) push("pintu_km", "d7", "pintu_km", "Pintu KM/WC UPVC tahan air", `${kmDoors} pintu area basah`, kmDoors, true, "st-06", "Jumlah pintu kamar mandi/powder room");
    if (slidingArea > 0) push("pintu_geser", "d7", "pintu_geser", "Pintu geser kaca aluminium", "Kusen aluminium + kaca 8 mm", Math.ceil(slidingArea * 10) / 10, true, "st-06", "Luas bukaan pintu lebar ≥ 1,3 m");
    if (derived.totalWindowAreaM2 > 0) push("jendela", "d7", "jendela", "Kusen & kaca jendela aluminium", `${derived.totalWindows} unit jendela di model 3D`, Math.ceil(derived.totalWindowAreaM2 * 10) / 10, true, "st-06", "Sum (lebar × tinggi) semua jendela");

    const stairLenSum = (project.levels[0]?.stairs ?? []).reduce(
      (s, st) => s + Math.hypot(st.end.x - st.start.x, st.end.z - st.start.z),
      0,
    );
    const balconyWidthSum = (floors[1]?.rooms ?? [])
      .filter((r) => r.room.program === "balcony")
      .reduce((s, r) => s + r.bounds.width, 0);
    const railMeters = stairLenSum + (stairLenSum > 0 ? 2.5 : 0) + balconyWidthSum;
    if (railMeters > 0) {
      push("railing_tangga", "d7", "railing_tangga", "Railing tangga, void & balkon LT2", "Hollow galvanized + handrail kayu", Math.ceil(railMeters * 10) / 10, true, "st-10", "Panjang tangga + void + balkon");
    }

    // Divisi VIII: MEP, Sanitair & Mitigasi Banjir
    if (mep.airBersihM > 0) push("pipa_air_bersih", "d8", "pipa_air_bersih", "Pipa air bersih PVC AW 1/2\" & 3/4\"", "PDAM ke semua KM, dapur & kran taman", Math.ceil(mep.airBersihM), true, "st-08", "Panjang polyline 3D jalur air bersih");
    if (mep.airKotorM > 0) push("pipa_air_kotor", "d8", "pipa_air_kotor", "Pipa air kotor & limbah PVC D-3\"/4\"", "Shaft LT2 → LT1 → Bio Septic Tank", Math.ceil(mep.airKotorM), true, "st-08", "Panjang polyline 3D jalur air kotor");
    const hasKitchen = allRooms.some((r) => r.room.program === "kitchen") || mep.sink > 0;
    const hasPlumbing = bathroomCount > 0 || mep.kloset > 0 || hasKitchen;
    if (hasPlumbing) {
      push("septic_biotank", "d8", "septic_biotank", "Bio Septic Tank 1.500 L", "Akses sedot dari jalan depan", 1, true, "st-08", "1 unit kapasitas 4–6 penghuni");
    }
    const klosetQty = Math.max(bathroomCount, mep.kloset);
    if (klosetQty > 0) push("kloset_duduk", "d8", "kloset_duduk", "Kloset duduk dual-flush", `${klosetQty} unit di model`, klosetQty, true, "st-11", "Titik sanitasi kloset pada denah");
    const showerCount = project.levels.flatMap((l) => l.mepPoints).filter((p) => p.kind === "shower").length;
    const showerQty = Math.max(showerCount, Math.max(0, bathroomCount - 1));
    if (showerQty > 0) push("shower_set", "d8", "shower_set", "Shower set mixer", `${showerQty} kamar mandi mandi`, showerQty, true, "st-11", "Titik shower / KM utama");
    const wastafelCount = project.levels.flatMap((l) => l.mepPoints).filter((p) => p.kind === "wastafel").length;
    const wastafelQty = Math.max(wastafelCount, bathroomCount);
    if (wastafelQty > 0) push("wastafel", "d8", "wastafel", "Wastafel keramik + kran", `${wastafelQty} unit`, wastafelQty, true, "st-11", "Titik cuci tangan KM/Powder Room");
    const kitchenSinkQty = hasKitchen ? Math.max(1, mep.sink) : 0;
    if (kitchenSinkQty > 0) push("kitchen_sink", "d8", "kitchen_sink", "Kitchen sink + meja dapur beton", "Area dapur LT1", kitchenSinkQty, true, "st-11", "Bak cuci dapur pada model");
    const drainCount = project.levels.flatMap((l) => l.mepPoints).filter((p) => p.kind === "drain").length;
    const floorDrainQty = Math.max(drainCount, bathroomCount);
    if (floorDrainQty > 0) push("floor_drain", "d8", "floor_drain", "Floor drain anti bau", "Semua kamar mandi & area servis", floorDrainQty, true, "st-11", "1 per KM/WC");

    if (mep.conduitM > 0) push("conduit", "d8", "conduit", "Pipa conduit PVC Ø20 mm", "Pelindung kabel di dinding & plafon", Math.ceil(mep.conduitM), true, "st-08", "Total panjang jalur listrik");
    if (mep.kabelLampuM > 0) push("kabel_nym15", "d8", "kabel_nym15", "Kabel NYM 2×1,5 mm² (sirkuit lampu)", "Sesuai PUIL 2011", Math.ceil(mep.kabelLampuM), true, "st-08", "Panjang sirkuit lampu 3D");
    if (mep.kabelKontakM + mep.kabelAcM > 0) push("kabel_nym25", "d8", "kabel_nym25", "Kabel NYM 3×2,5 mm² (stop kontak & AC)", "Sesuai PUIL 2011", Math.ceil(mep.kabelKontakM + mep.kabelAcM), true, "st-08", "Panjang sirkuit stop kontak + feeder AC");
    if (mep.titikLampu > 0) push("titik_lampu", "d8", "titik_lampu", "Titik lampu + armatur LED", `${mep.titikLampu} titik lampu di model 3D`, mep.titikLampu, true, "st-11", "Jumlah fixture lampu terpasang");
    if (mep.saklar > 0) push("saklar", "d8", "saklar", "Saklar tunggal / ganda inbow", "Tinggi 140 cm", mep.saklar, true, "st-11", "Jumlah grup saklar");
    if (mep.stopkontak > 0) push("stopkontak", "d8", "stopkontak", `Stop kontak arde (tinggi ${Math.round(fm.outletHeightM * 100)} cm)`, "Tahan banjir jika dipasang ≥ 110 cm", mep.stopkontak, true, "st-11", "Titik stop kontak terpasang");
    if (mep.titikLampu > 0 || mep.stopkontak > 0 || allWalls.length > 0) {
      push("panel_mcb", "d8", "panel_mcb", `Panel MCB 8 grup + ELCB + Grounding (${settings.plnVaTier} VA)`, `Posisi tinggi ${Math.round(fm.mcbHeightM * 100)} cm`, 1, true, "st-08", "1 panel utama");
    }

    if (mep.acCount > 0) push("ac_split", "d8", "ac_split", "Unit AC Split Inverter + pasang + pipa", `${mep.acCount} unit terpasang di model 3D`, mep.acCount, true, "st-11", "Jumlah AC di model");
    if (mep.fanCount > 0) push("kipas_plafon", "d8", "kipas_plafon", "Kipas angin plafon / berdiri / dinding + pasang", `${mep.fanCount} unit di model 3D`, mep.fanCount, true, "st-11", "Jumlah kipas di model");
    if (mep.exhaustCount > 0) push("exhaust_fan", "d8", "exhaust_fan", "Exhaust fan KM / dapur", `${mep.exhaustCount} unit di model 3D`, mep.exhaustCount, true, "st-11", "Jumlah exhaust fan di model");

    // Mitigasi banjir items
    if (fm.infiltrationWells > 0) push("sumur_resapan", "d8", "sumur_resapan", "Sumur resapan air hujan (SNI 03-2453-2002)", `${fm.infiltrationWells} unit Ø80 cm dalam 2 m di taman depan/carport`, fm.infiltrationWells, true, "st-02", "Jumlah sumur resapan aktif");
    if (fm.backflowValve && hasPlumbing) push("backflow_valve", "d8", "backflow_valve", "Katup satu arah anti-backflow saluran limbah", "Mencegah air banjir masuk lewat WC/floor drain LT1", 2, true, "st-08", "Jalur utama limbah + drain taman");
    if (fm.doorFloodBarrier && doorOps.length > 0) push("flood_barrier", "d8", "flood_barrier", `Sekat pintu anti-banjir aluminium (${fm.barrierHeightCm} cm)`, "Pintu masuk LT1", Math.min(2, doorOps.length), true, "st-11", "Pintu luar LT1");
    if (fm.submersiblePump) push("pompa_kuras", "d8", "pompa_kuras", "Pompa celup kuras otomatis", "Pit drainase depan/taman", 1, true, "st-11", "1 unit pompa otomatis");

    // Divisi IX: Pengecatan & Waterproofing
    if (masonry.exteriorPaintAreaM2 > 0) {
      push("cat_eksterior", "d9", "cat_eksterior", "Cat eksterior tahan cuaca (sealer + 2 lapis)", "Fasad depan, void belakang & dinding bebas tetangga", Math.ceil(masonry.exteriorPaintAreaM2 * 10) / 10, true, "st-12", "Luas sisi luar dinding eksterior (tanpa batas tetangga)");
    }
    const intPaintArea = masonry.interiorPaintAreaM2 + ceilingArea;
    if (intPaintArea > 0) {
      push("cat_interior", "d9", "cat_interior", "Cat interior dinding & plafon", "Plamir + 2 lapis akhir", Math.ceil(intPaintArea * 10) / 10, true, "st-12", "Dinding interior + plafon");
    }
    const bathArea = allRooms.filter((r) => r.room.program === "bathroom").reduce((s, r) => s + r.netAreaM2, 0);
    const balcArea = allRooms.filter((r) => r.room.program === "balcony").reduce((s, r) => s + r.netAreaM2, 0);
    const lt1ExtWallLen = lt1Walls.filter((w) => w.exterior).reduce((s, w) => s + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z), 0);
    const wpArea = bathArea * 1.35 + balcArea + (fm.wallWaterproofing ? lt1ExtWallLen * 1.2 : 0);
    if (wpArea > 0) {
      push("waterproofing", "d9", "waterproofing", "Waterproofing KM, balkon & dinding bawah anti-banjir", fm.wallWaterproofing ? "Termasuk dinding LT1 0–1,2 m" : "Area KM & balkon", Math.ceil(wpArea * 10) / 10, true, "st-12", "Area basah + proteksi rembesan");
    }
  }

  const directMaterialTotal = rows.reduce((s, r) => s + r.subtotalMaterial, 0);
  const directEquipTotal = rows.reduce((s, r) => s + r.subtotalEquip, 0);
  let directLaborTotal = rows.reduce((s, r) => s + r.subtotalLabor, 0);

  // In borongan_pct mode, distribute borongan labor proportionally across material-bearing rows
  // so every division subtotal & S-Curve stage budget remains 100% consistent with directSubtotal.
  if (settings.laborMode === "borongan_pct" && directMaterialTotal > 0) {
    const boronganTotal = Math.round((directMaterialTotal * settings.boronganPct) / 100);
    const matRows = rows.filter((r) => r.subtotalMaterial > 0);
    let allocated = 0;
    for (let i = 0; i < matRows.length; i++) {
      const r = matRows[i]!;
      const isLast = i === matRows.length - 1;
      const share = isLast ? boronganTotal - allocated : Math.round((r.subtotalMaterial / directMaterialTotal) * boronganTotal);
      allocated += share;
      r.subtotalLabor = share;
      r.laborUnit = r.qty > 0 ? Math.round(share / r.qty) : 0;
      r.unitPrice = r.materialUnit + r.laborUnit + r.equipUnit;
      r.subtotal = r.subtotalMaterial + r.subtotalLabor + r.subtotalEquip;
    }
    directLaborTotal = boronganTotal;
  } else if (settings.laborMode === "borongan_pct") {
    directLaborTotal = 0;
  }

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

  const directSubtotal = directMaterialTotal + directLaborTotal + directEquipTotal;
  const overheadAmount = Math.round((directSubtotal * settings.overheadPct) / 100);
  const profitAmount = Math.round((directSubtotal * settings.profitPct) / 100);
  const preVat = directSubtotal + overheadAmount + profitAmount;
  const vatAmount = Math.round((preVat * settings.vatPct) / 100);
  const contingencyAmount = Math.round((preVat * settings.contingencyPct) / 100);
  const grandTotal = preVat + vatAmount + contingencyAmount;

  const warnings: RabValidationWarning[] = [];
  for (const r of rows) {
    const item = prices[r.priceKey];
    const isMaterialZeroInBorongan =
      settings.laborMode === "borongan_pct" && (item?.materialPrice ?? 0) === 0 && (item?.equipmentPrice ?? 0) === 0 && (item?.laborPrice ?? 0) > 0;
    if (r.unitPrice <= 0 && !isMaterialZeroInBorongan) {
      warnings.push({ id: `zero-price-${r.id}`, severity: "critical", message: `Harga satuan "${r.uraian}" masih Rp 0.` });
    }
    if (r.qty <= 0) {
      warnings.push({ id: `zero-qty-${r.id}`, severity: "warning", message: `Kuantitas "${r.uraian}" bernilai 0.` });
    }
  }
  const budgetCapIdr = project.budgetCapIdr;
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
    perM2GrossBuilding: derived.totalGrossAreaM2 > 0 ? grandTotal / derived.totalGrossAreaM2 : 0,
    perM2NetFloor: derived.totalNetFloorM2 > 0 ? grandTotal / derived.totalNetFloorM2 : 0,
    budgetCapIdr,
    budgetDeltaIdr,
    overBudget: grandTotal > budgetCapIdr,
    warnings,
  };
}
