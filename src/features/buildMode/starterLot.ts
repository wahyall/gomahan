import {
  BUILD_FORMAT_VERSION,
  CELL_SIZE,
  floorCellKey,
  type BuildCatalogItem,
  type BuildCostSummary,
  type BuildDocument,
  type BuildFloorCell,
  type BuildWall,
} from "@/features/buildMode/types";

export const DEFAULT_COLS = 10; // 10 * 0.5m = 5.0m
export const DEFAULT_ROWS = 34; // 34 * 0.5m = 17.0m

export const WALL_MATERIALS: Record<string, { name: string; hex: string; roughness: number; pricePerM2: number }> = {
  plaster_warm: { name: "Plester Putih Hangat", hex: "#ece7df", roughness: 0.86, pricePerM2: 145_000 },
  plaster_cream: { name: "Krem Tropis", hex: "#dfd5c3", roughness: 0.85, pricePerM2: 148_000 },
  plaster_sage: { name: "Sage Lembut", hex: "#cad6c7", roughness: 0.84, pricePerM2: 155_000 },
  hebel_raw: { name: "Bata Putih / Hebel Ekspos", hex: "#dedad1", roughness: 0.92, pricePerM2: 118_000 },
  red_brick: { name: "Bata Merah Ekspos", hex: "#a9523b", roughness: 0.9, pricePerM2: 165_000 },
  timber_cladding: { name: "Kisi Kayu Jati", hex: "#9c6d45", roughness: 0.62, pricePerM2: 295_000 },
  charcoal_accent: { name: "Aksen Batu Andhesit", hex: "#434952", roughness: 0.78, pricePerM2: 270_000 },
};

export const FLOOR_MATERIALS: Record<string, { name: string; hex: string; roughness: number; pricePerM2: number; stepSound: "tile" | "wood" | "grass" | "stone" | "water" }> = {
  granite_warm: { name: "Granit 60×60 Ivory", hex: "#dbd4c8", roughness: 0.42, pricePerM2: 240_000, stepSound: "tile" },
  wood_oak: { name: "Parket Oak Hangat", hex: "#a5794d", roughness: 0.54, pricePerM2: 310_000, stepSound: "wood" },
  concrete_carport: { name: "Rabat Beton Brushed", hex: "#989c9e", roughness: 0.88, pricePerM2: 165_000, stepSound: "stone" },
  terrazzo_bath: { name: "Keramik Kamar Mandi", hex: "#b8c0c4", roughness: 0.62, pricePerM2: 195_000, stepSound: "tile" },
  terrace_deck: { name: "Dek Kayu WPC Teras", hex: "#8e6643", roughness: 0.68, pricePerM2: 285_000, stepSound: "wood" },
  garden_grass: { name: "Rumput Taman Tropis", hex: "#5a8e46", roughness: 0.94, pricePerM2: 75_000, stepSound: "grass" },
  pool_water: { name: "Kolam Renang Mozaik", hex: "#3798c4", roughness: 0.16, pricePerM2: 650_000, stepSound: "water" },
};

export const ROOF_MATERIALS: Record<string, { name: string; hex: string; metalness: number; roughness: number; pricePerM2: number }> = {
  standing_seam_slate: { name: "Metal Standing Seam", hex: "#38414b", metalness: 0.35, roughness: 0.48, pricePerM2: 225_000 },
  terracotta_tile: { name: "Genteng Keramik Klasik", hex: "#aa583d", metalness: 0.04, roughness: 0.68, pricePerM2: 190_000 },
  concrete_flat: { name: "Dak Beton Waterproof", hex: "#7d848b", metalness: 0.05, roughness: 0.82, pricePerM2: 260_000 },
};

/** Starter Fase 1 catalog items (expanded to 40+ procedural Buy objects in Fase 3). */
export const STARTER_BUILD_CATALOG: BuildCatalogItem[] = [
  {
    id: "tool_select",
    category: "build",
    kind: "wall_material",
    name: "Pilih / Seleksi",
    priceIdr: 0,
    toolId: "select",
    swatches: [],
    description: "Klik dinding, lantai, atau elemen untuk melihat detail.",
  },
  {
    id: "tool_wall_straight",
    category: "build",
    kind: "wall_material",
    name: "Dinding Lurus",
    priceIdr: 145_000,
    toolId: "wall_straight",
    swatches: [{ id: "plaster_warm", name: "Putih Hangat", hex: "#ece7df" }],
    description: "Tarik dinding lurus antar titik grid (Fase 2).",
  },
  {
    id: "tool_wall_room",
    category: "build",
    kind: "wall_material",
    name: "Buat Ruangan",
    priceIdr: 145_000,
    toolId: "wall_room",
    swatches: [{ id: "plaster_warm", name: "Putih Hangat", hex: "#ece7df" }],
    description: "Tarik persegi untuk membuat ruangan + lantai sekaligus (Fase 2).",
  },
  {
    id: "tool_floor_tile",
    category: "floors",
    kind: "floor_material",
    name: "Granit 60×60 Ivory",
    priceIdr: 240_000,
    toolId: "floor_tile",
    swatches: [{ id: "granite_warm", name: "Ivory", hex: "#dbd4c8" }],
    description: "Lantai granit terang untuk ruang tamu & keluarga.",
  },
  {
    id: "tool_floor_wood",
    category: "floors",
    kind: "floor_material",
    name: "Parket Oak Hangat",
    priceIdr: 310_000,
    toolId: "floor_rect",
    swatches: [{ id: "wood_oak", name: "Oak", hex: "#a5794d" }],
    description: "Lantai kayu hangat untuk kamar tidur & balkon.",
  },
  {
    id: "tool_floor_grass",
    category: "outdoor",
    kind: "floor_material",
    name: "Rumput Taman",
    priceIdr: 75_000,
    toolId: "floor_fill",
    swatches: [{ id: "garden_grass", name: "Tropis", hex: "#5a8e46" }],
    description: "Area taman depan & halaman belakang.",
  },
  {
    id: "door_single_wood",
    category: "openings",
    kind: "opening",
    name: "Pintu Kayu Jati 90cm",
    priceIdr: 2_350_000,
    toolId: "opening",
    sizeM: [0.9, 2.1, 0.14],
    swatches: [{ id: "teak", name: "Jati", hex: "#8e5f39" }],
    description: "Pintu standar ruangan — bisa dilewati di Walk Mode.",
  },
  {
    id: "win_casement_120",
    category: "openings",
    kind: "opening",
    name: "Jendela Kaca Aluminium",
    priceIdr: 1_850_000,
    toolId: "opening",
    sizeM: [1.2, 1.3, 0.12],
    swatches: [{ id: "charcoal", name: "Hitam Doff", hex: "#2f343a" }],
    description: "Jendela pencahayaan & ventilasi silang.",
  },
  {
    id: "stair_modern_rc",
    category: "stairs_roof",
    kind: "stair",
    name: "Tangga Beton Lurus",
    priceIdr: 14_500_000,
    toolId: "stair",
    footprintCells: [2, 8],
    swatches: [{ id: "oak_steel", name: "Kayu + Besi", hex: "#9b6b43" }],
    description: "Tangga penghubung LT1 → LT2 dengan tinggi pijakan nyaman.",
  },
  {
    id: "roof_shed_10",
    category: "stairs_roof",
    kind: "roof_material",
    name: "Atap Miring 10°",
    priceIdr: 225_000,
    toolId: "roof",
    swatches: [{ id: "standing_seam_slate", name: "Slate", hex: "#38414b" }],
    description: "Atap single-slope 10° ke arah depan kavling.",
  },
  {
    id: "sofa_lounge_warm",
    category: "furniture",
    kind: "furniture",
    name: "Sofa Keluarga Minimalis",
    priceIdr: 6_500_000,
    toolId: "object",
    sizeM: [2.1, 0.82, 0.92],
    hostType: "floor",
    blocking: true,
    swatches: [{ id: "linen", name: "Linen Hangat", hex: "#cfc5b4" }],
    description: "Sofa empuk ruang keluarga (padat / menghalangi langkah).",
  },
  {
    id: "lamp_pendant_warm",
    category: "lighting",
    kind: "light",
    name: "Lampu Gantung Hangat",
    priceIdr: 890_000,
    toolId: "object",
    sizeM: [0.45, 0.4, 0.45],
    hostType: "ceiling",
    blocking: false,
    swatches: [{ id: "brass", name: "Kuningan", hex: "#d6a553" }],
    description: "Sumber cahaya interior Three.js yang menerangi ruangan.",
  },
];

function paintRect(
  cells: Record<string, BuildFloorCell>,
  levelIndex: number,
  gx1: number,
  gz1: number,
  gx2: number,
  gz2: number,
  materialId: string,
  extra?: { isPool?: boolean; poolDepth?: number },
) {
  for (let gx = gx1; gx < gx2; gx++) {
    for (let gz = gz1; gz < gz2; gz++) {
      cells[floorCellKey(levelIndex, gx, gz)] = {
        levelIndex,
        gx,
        gz,
        materialId,
        ...extra,
      };
    }
  }
}

export function createEmpty5x17Document(budgetIdr = 450_000_000): BuildDocument {
  const cols = DEFAULT_COLS;
  const rows = DEFAULT_ROWS;
  const floorCells: Record<string, BuildFloorCell> = {};
  // Clean grassy kavling base on ground level
  paintRect(floorCells, 0, 0, 0, cols, rows, "garden_grass");

  return {
    formatVersion: BUILD_FORMAT_VERSION,
    id: `lot-empty-${Date.now().toString(36)}`,
    updatedAt: new Date().toISOString(),
    lot: {
      name: "Kavling Kosong 5×17 m",
      cols,
      rows,
      cellSize: CELL_SIZE,
      foundationHeight: 0.35,
      budgetIdr,
      terrainHeights: new Array((cols + 1) * (rows + 1)).fill(0),
    },
    levels: [
      { index: 0, name: "Lantai 1", elevation: 0, height: 3.4 },
      { index: 1, name: "Lantai 2", elevation: 3.4, height: 3.2 },
      { index: 2, name: "Atap", elevation: 6.6, height: 2.6 },
    ],
    walls: [],
    openings: [],
    floorCells,
    stairs: [],
    roofs: [],
    objects: [],
  };
}

/**
 * Generates the default 5x17m 2-Storey House (3 Bedrooms, Surabaya tropical semi-realistic layout)
 * aligned strictly to the 0.5m integer sub-grid (`cols=10`, `rows=34`).
 * Z=0..34 goes Front (Street, South/+Z or -Z? Let's make Z=0 Front Street and Z=17m Back Garden!).
 */
export function createStarter5x17HouseDocument(budgetIdr = 450_000_000): BuildDocument {
  const cols = DEFAULT_COLS; // 0..10 (5.0m)
  const rows = DEFAULT_ROWS; // 0..34 (17.0m)
  const floorCells: Record<string, BuildFloorCell> = {};

  // === FLOOR LT1 (0..10 x 0..34) ===
  // Front Z: 0..6 (3.0m Taman & Carport), Carport X: 4..10, Z: 0..9 (4.5m)
  paintRect(floorCells, 0, 0, 0, 4, 7, "garden_grass"); // Taman depan 2x3.5m
  paintRect(floorCells, 0, 4, 0, 10, 9, "concrete_carport"); // Carport 3x4.5m
  paintRect(floorCells, 0, 0, 7, 4, 9, "terrace_deck"); // Teras depan 2x1.0m
  // Main Ground Living/Dining/Kitchen interior Z: 9..31
  paintRect(floorCells, 0, 0, 9, 10, 31, "granite_warm");
  paintRect(floorCells, 0, 4, 9, 10, 15, "wood_oak"); // Kamar Tidur Tamu LT1 (kanan depan, 3x3m)
  paintRect(floorCells, 0, 0, 15, 3, 18, "terrazzo_bath"); // Powder room
  // Back zone Z: 31..34 (WC belakang + Taman belakang)
  paintRect(floorCells, 0, 0, 31, 4, 34, "terrazzo_bath"); // WC belakang
  paintRect(floorCells, 0, 4, 31, 10, 34, "garden_grass"); // Taman belakang

  // === FLOOR LT2 (Z: 7..34, cantilevered balcony over teras at 7..9) ===
  paintRect(floorCells, 1, 0, 7, 10, 9, "terrace_deck"); // Balkon depan
  paintRect(floorCells, 1, 0, 9, 10, 31, "granite_warm"); // Ruang santai & koridor
  paintRect(floorCells, 1, 4, 9, 10, 16, "wood_oak"); // Kamar Anak 2 (depan)
  paintRect(floorCells, 1, 5, 16, 10, 19, "terrazzo_bath"); // Toilet LT2
  paintRect(floorCells, 1, 4, 19, 10, 25, "wood_oak"); // Kamar Anak 3 / Utama front
  paintRect(floorCells, 1, 0, 25, 10, 31, "wood_oak"); // Kamar Utama belakang + area leluasa
  paintRect(floorCells, 1, 0, 31, 4, 34, "terrazzo_bath"); // Toilet utama
  // Stairwell cutout on LT2 at X: 0..2, Z: 16..24 (left blank so you climb cleanly onto LT2!)
  for (let gx = 0; gx < 2; gx++) {
    for (let gz = 16; gz < 24; gz++) {
      delete floorCells[floorCellKey(1, gx, gz)];
    }
  }

  let wallCounter = 0;
  const w = (
    levelIndex: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    opts?: { kind?: BuildWall["kind"]; height?: number; outer?: string; inner?: string },
  ): BuildWall => {
    wallCounter += 1;
    return {
      id: `w-start-${wallCounter}`,
      levelIndex,
      x1,
      z1,
      x2,
      z2,
      kind: opts?.kind ?? "wall",
      thickness: opts?.kind === "fence" ? 0.08 : 0.15,
      height: opts?.height ?? (levelIndex === 0 ? 3.4 : 3.2),
      paintOuterId: opts?.outer ?? "plaster_warm",
      paintInnerId: opts?.inner ?? "plaster_cream",
    };
  };

  const walls: BuildWall[] = [
    // Lot front low fence
    w(0, 0, 0, 4, 0, { kind: "fence", height: 0.9, outer: "charcoal_accent", inner: "charcoal_accent" }),
    // LT1 Main envelope (X:0..10, Z:9..31, plus side boundaries)
    w(0, 0, 9, 10, 9, { outer: "plaster_warm", inner: "plaster_cream" }),
    w(0, 10, 9, 10, 31, { outer: "hebel_raw", inner: "plaster_warm" }),
    w(0, 10, 31, 0, 31, { outer: "plaster_warm", inner: "plaster_cream" }),
    w(0, 0, 31, 0, 9, { outer: "hebel_raw", inner: "plaster_warm" }),
    // LT1 Interior partitions
    w(0, 4, 9, 4, 15, { inner: "plaster_sage", outer: "plaster_cream" }), // KT1 west wall
    w(0, 4, 15, 10, 15, { inner: "plaster_sage", outer: "plaster_cream" }), // KT1 back wall
    w(0, 0, 15, 3, 15), // Powder room north
    w(0, 3, 15, 3, 18), // Powder room east
    w(0, 0, 18, 3, 18), // Powder room south
    // Back WC LT1 (0..4, 31..34)
    w(0, 0, 31, 0, 34),
    w(0, 0, 34, 4, 34),
    w(0, 4, 34, 4, 31),
    // Back garden privacy wall
    w(0, 4, 34, 10, 34, { kind: "halfwall", height: 2.0, outer: "red_brick", inner: "red_brick" }),
    w(0, 10, 31, 10, 34, { kind: "halfwall", height: 2.0, outer: "red_brick", inner: "red_brick" }),

    // LT2 Balcony rail
    w(1, 0, 7, 10, 7, { kind: "fence", height: 1.05, outer: "charcoal_accent", inner: "charcoal_accent" }),
    w(1, 0, 7, 0, 9, { kind: "fence", height: 1.05, outer: "charcoal_accent", inner: "charcoal_accent" }),
    w(1, 10, 7, 10, 9, { kind: "fence", height: 1.05, outer: "charcoal_accent", inner: "charcoal_accent" }),
    // LT2 Main Envelope (Z:9..31)
    w(1, 0, 9, 10, 9, { outer: "timber_cladding", inner: "plaster_warm" }),
    w(1, 10, 9, 10, 31, { outer: "hebel_raw", inner: "plaster_warm" }),
    w(1, 10, 31, 0, 31, { outer: "plaster_warm", inner: "plaster_cream" }),
    w(1, 0, 31, 0, 9, { outer: "hebel_raw", inner: "plaster_warm" }),
    // LT2 Rooms
    w(1, 4, 9, 4, 16, { inner: "plaster_sage", outer: "plaster_cream" }), // KT Anak front
    w(1, 4, 16, 10, 16),
    w(1, 5, 16, 5, 19), // Toilet LT2
    w(1, 4, 19, 10, 19),
    w(1, 4, 19, 4, 25),
    w(1, 0, 25, 10, 25), // Kamar Utama partition
    // LT2 Back toilet
    w(1, 0, 31, 0, 34),
    w(1, 0, 34, 4, 34),
    w(1, 4, 34, 4, 31),
  ];

  const openings: BuildDocument["openings"] = [
    // Front main door on wall w-start-2 (X:0..10, Z=9) -> at X=1.8m (t=0.36)
    {
      id: "op-front-door",
      wallId: "w-start-2",
      kind: "door",
      catalogId: "door_single_wood",
      tCenter: 0.2,
      width: 1.0,
      height: 2.15,
      sillHeight: 0,
      swatchId: "teak",
      isOpen: true,
    },
    {
      id: "op-front-win",
      wallId: "w-start-2",
      kind: "window",
      catalogId: "win_casement_120",
      tCenter: 0.72,
      width: 1.4,
      height: 1.4,
      sillHeight: 0.9,
      swatchId: "charcoal",
    },
    {
      id: "op-kt1-door",
      wallId: "w-start-6",
      kind: "door",
      catalogId: "door_single_wood",
      tCenter: 0.72,
      width: 0.9,
      height: 2.1,
      sillHeight: 0,
      swatchId: "teak",
      isOpen: true,
    },
    {
      id: "op-back-sliding",
      wallId: "w-start-4",
      kind: "door",
      catalogId: "door_single_wood",
      tCenter: 0.3,
      width: 1.5,
      height: 2.2,
      sillHeight: 0,
      swatchId: "teak",
      isOpen: true,
    },
    {
      id: "op-back-win",
      wallId: "w-start-4",
      kind: "window",
      catalogId: "win_casement_120",
      tCenter: 0.72,
      width: 1.4,
      height: 1.3,
      sillHeight: 0.95,
      swatchId: "charcoal",
    },
    // LT2 Balkon door & window
    {
      id: "op-lt2-balkon",
      wallId: "w-start-19",
      kind: "door",
      catalogId: "door_single_wood",
      tCenter: 0.22,
      width: 1.0,
      height: 2.15,
      sillHeight: 0,
      swatchId: "teak",
      isOpen: true,
    },
    {
      id: "op-lt2-win",
      wallId: "w-start-19",
      kind: "window",
      catalogId: "win_casement_120",
      tCenter: 0.7,
      width: 1.6,
      height: 1.35,
      sillHeight: 0.9,
      swatchId: "charcoal",
    },
    {
      id: "op-kt-utama-door",
      wallId: "w-start-28",
      kind: "door",
      catalogId: "door_single_wood",
      tCenter: 0.75,
      width: 0.9,
      height: 2.1,
      sillHeight: 0,
      swatchId: "teak",
      isOpen: true,
    },
  ];

  return {
    formatVersion: BUILD_FORMAT_VERSION,
    id: "house-5x17-default",
    updatedAt: new Date().toISOString(),
    lot: {
      name: "Rumah Modern 5×17 m (Surabaya 2 LT)",
      cols,
      rows,
      cellSize: CELL_SIZE,
      foundationHeight: 0.35,
      budgetIdr,
      terrainHeights: new Array((cols + 1) * (rows + 1)).fill(0),
    },
    levels: [
      { index: 0, name: "Lantai 1", elevation: 0, height: 3.4 },
      { index: 1, name: "Lantai 2", elevation: 3.4, height: 3.2 },
      { index: 2, name: "Atap", elevation: 6.6, height: 2.4 },
    ],
    walls,
    openings,
    floorCells,
    stairs: [
      {
        id: "stair-main-1",
        levelIndex: 0,
        catalogId: "stair_modern_rc",
        gx: 0,
        gz: 19,
        widthCells: 2,
        lengthCells: 8,
        rotationQuarter: 2, // climbs from back (-Z toward front stairwell) or +Z
        style: "wood_steel",
        swatchId: "oak_steel",
        hasLanding: false,
      },
    ],
    roofs: [
      {
        id: "roof-main-shed",
        levelIndex: 2,
        kind: "shed",
        gx1: 0,
        gz1: 6,
        gx2: 10,
        gz2: 34,
        pitchDeg: 10,
        overhang: 0.6,
        eaveHeight: 6.6,
        materialId: "standing_seam_slate",
        autoGenerated: true,
      },
    ],
    objects: [
      {
        id: "obj-sofa-fam",
        levelIndex: 0,
        catalogId: "sofa_lounge_warm",
        x: 3.6,
        y: 0,
        z: 10.6,
        rotationY: -Math.PI / 2,
        swatchId: "linen",
        hostType: "floor",
      },
      {
        id: "obj-lamp-fam",
        levelIndex: 0,
        catalogId: "lamp_pendant_warm",
        x: 2.4,
        y: 2.85,
        z: 11.2,
        rotationY: 0,
        swatchId: "brass",
        hostType: "ceiling",
      },
    ],
  };
}

export function computeBuildCostSummary(doc: BuildDocument): BuildCostSummary {
  const cellArea = doc.lot.cellSize * doc.lot.cellSize;
  let wallsIdr = 0;
  let wallLengthM = 0;
  for (const wall of doc.walls) {
    const len = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) * doc.lot.cellSize;
    wallLengthM += len;
    const mat = WALL_MATERIALS[wall.paintOuterId] ?? WALL_MATERIALS.plaster_warm!;
    const effectiveH = wall.kind === "fence" ? 1.0 : wall.height;
    const rate = wall.kind === "fence" ? 290_000 : 540_000 + mat.pricePerM2;
    wallsIdr += Math.round(len * effectiveH * rate);
  }

  let openingsIdr = 0;
  for (const op of doc.openings) {
    const item = STARTER_BUILD_CATALOG.find((c) => c.id === op.catalogId);
    openingsIdr += item?.priceIdr ?? (op.kind === "door" ? 2_200_000 : 1_650_000);
  }

  let floorsIdr = 0;
  let builtFloorAreaM2 = 0;
  for (const cell of Object.values(doc.floorCells)) {
    const mat = FLOOR_MATERIALS[cell.materialId] ?? FLOOR_MATERIALS.granite_warm!;
    floorsIdr += Math.round(cellArea * mat.pricePerM2);
    if (cell.materialId !== "garden_grass") {
      builtFloorAreaM2 += cellArea;
    }
  }

  const stairsIdr = doc.stairs.length * 12_500_000;
  let roofsIdr = 0;
  for (const roof of doc.roofs) {
    const w = Math.abs(roof.gx2 - roof.gx1) * doc.lot.cellSize + roof.overhang * 2;
    const d = Math.abs(roof.gz2 - roof.gz1) * doc.lot.cellSize + roof.overhang * 2;
    const mat = ROOF_MATERIALS[roof.materialId] ?? ROOF_MATERIALS.standing_seam_slate!;
    roofsIdr += Math.round(w * d * (280_000 + mat.pricePerM2));
  }

  let objectsIdr = 0;
  for (const obj of doc.objects) {
    const item = STARTER_BUILD_CATALOG.find((c) => c.id === obj.catalogId);
    objectsIdr += item?.priceIdr ?? 1_500_000;
  }

  const lotArea = doc.lot.cols * doc.lot.rows * cellArea;
  const foundationIdr = Math.round(lotArea * (340_000 + doc.lot.foundationHeight * 240_000));
  const totalIdr = wallsIdr + openingsIdr + floorsIdr + stairsIdr + roofsIdr + objectsIdr + foundationIdr;
  const remainingIdr = doc.lot.budgetIdr - totalIdr;

  return {
    wallsIdr,
    openingsIdr,
    floorsIdr,
    stairsIdr,
    roofsIdr,
    objectsIdr,
    foundationIdr,
    totalIdr,
    remainingIdr,
    overBudget: remainingIdr < 0,
    builtFloorAreaM2: Number(builtFloorAreaM2.toFixed(1)),
    wallLengthM: Number(wallLengthM.toFixed(1)),
  };
}
