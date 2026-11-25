import type { FurnitureCategory, HvacType, LightType, Vec3 } from "@/lib/model/types";

export interface FurnitureCatalogEntry {
  catalogId: string;
  name: string;
  category: FurnitureCategory;
  defaultSize: Vec3;
  colorHex: string;
  accentHex?: string;
  description: string;
  swatches: { name: string; hex: string }[];
}

export const FURNITURE_CATALOG: FurnitureCatalogEntry[] = [
  {
    catalogId: "sofa_l",
    name: "Sofa L Tropis",
    category: "seating",
    defaultSize: { x: 2.2, y: 0.78, z: 1.5 },
    colorHex: "#d8d1c5",
    accentHex: "#7c9473",
    description: "Sofa L linen dengan kaki kayu jati",
    swatches: [
      { name: "Oat Linen", hex: "#d8d1c5" },
      { name: "Sage Leaf", hex: "#7c9473" },
      { name: "Terracotta", hex: "#b86b52" },
      { name: "Charcoal", hex: "#4a4e54" },
    ],
  },
  {
    catalogId: "sofa_2",
    name: "Sofa 2 Dudukan",
    category: "seating",
    defaultSize: { x: 1.6, y: 0.78, z: 0.85 },
    colorHex: "#c9bba6",
    accentHex: "#8d623b",
    description: "Sofa ruang tamu / ruang santai kompak",
    swatches: [
      { name: "Warm Sand", hex: "#c9bba6" },
      { name: "Teak & Cream", hex: "#e4ddd0" },
      { name: "Forest Moss", hex: "#5f745c" },
    ],
  },
  {
    catalogId: "coffee_table",
    name: "Meja Kopi Jati",
    category: "table",
    defaultSize: { x: 1.0, y: 0.42, z: 0.58 },
    colorHex: "#9b6b43",
    description: "Meja tamu kayu jati solid berpinggul halus",
    swatches: [
      { name: "Jati Natural", hex: "#9b6b43" },
      { name: "Walnut Gelap", hex: "#5a3c24" },
      { name: "Putih Oak", hex: "#d8c3a5" },
    ],
  },
  {
    catalogId: "tv_console",
    name: "Credenza & TV 55\"",
    category: "decor",
    defaultSize: { x: 1.8, y: 1.15, z: 0.42 },
    colorHex: "#7c5231",
    accentHex: "#202428",
    description: "Kabinet TV kayu jati dengan layar tipis",
    swatches: [
      { name: "Jati Hangat", hex: "#7c5231" },
      { name: "Oak Muda", hex: "#c4a379" },
      { name: "Graphite", hex: "#3c4046" },
    ],
  },
  {
    catalogId: "dining_table",
    name: "Meja Makan 4-6 Kursi",
    category: "table",
    defaultSize: { x: 1.5, y: 0.76, z: 0.9 },
    colorHex: "#94643b",
    accentHex: "#e6dfd3",
    description: "Meja makan keluarga lengkap dengan kursi",
    swatches: [
      { name: "Jati Solid", hex: "#94643b" },
      { name: "Oak Terang", hex: "#cca97e" },
    ],
  },
  {
    catalogId: "kitchen_l",
    name: "Kitchen Set L-Shape",
    category: "kitchen",
    defaultSize: { x: 2.1, y: 0.88, z: 1.5 },
    colorHex: "#f0ece3",
    accentHex: "#555d63",
    description: "Meja dapur top granite + sink + kompor 2 tungku",
    swatches: [
      { name: "Ivory & Granite", hex: "#f0ece3" },
      { name: "Sage Matte", hex: "#8da187" },
      { name: "Walnut Modern", hex: "#6b4a32" },
    ],
  },
  {
    catalogId: "fridge",
    name: "Kulkas 2 Pintu",
    category: "kitchen",
    defaultSize: { x: 0.7, y: 1.75, z: 0.7 },
    colorHex: "#aeb5bc",
    description: "Lemari es inverter dua pintu",
    swatches: [
      { name: "Brushed Silver", hex: "#aeb5bc" },
      { name: "Matte Black", hex: "#2d3035" },
    ],
  },
  {
    catalogId: "bed_queen",
    name: "Ranjang Queen (160×200)",
    category: "bed",
    defaultSize: { x: 1.7, y: 0.95, z: 2.1 },
    colorHex: "#8c613c",
    accentHex: "#f4f1ea",
    description: "Tempat tidur utama kayu jati dengan sprei katun linen",
    swatches: [
      { name: "Linen Putih", hex: "#f4f1ea" },
      { name: "Sage Tropis", hex: "#92a48a" },
      { name: "Terracotta", hex: "#c47d64" },
    ],
  },
  {
    catalogId: "bed_single",
    name: "Ranjang Single / Anak (120×200)",
    category: "bed",
    defaultSize: { x: 1.25, y: 0.9, z: 2.05 },
    colorHex: "#9e734e",
    accentHex: "#dce5ea",
    description: "Tempat tidur anak/tamu ukuran 120×200 cm",
    swatches: [
      { name: "Biru Pucat", hex: "#dce5ea" },
      { name: "Krem Hangat", hex: "#ede5d6" },
      { name: "Olive Muda", hex: "#b4c1a5" },
    ],
  },
  {
    catalogId: "wardrobe",
    name: "Lemari Pakaian",
    category: "storage",
    defaultSize: { x: 1.4, y: 2.1, z: 0.58 },
    colorHex: "#a87e55",
    description: "Lemari pakaian 2-3 pintu kayu rotan/HPL",
    swatches: [
      { name: "Jati Rotan", hex: "#a87e55" },
      { name: "Putih Doff", hex: "#eceae4" },
    ],
  },
  {
    catalogId: "desk",
    name: "Meja Kerja & Kursi",
    category: "table",
    defaultSize: { x: 1.2, y: 0.75, z: 0.6 },
    colorHex: "#a87e55",
    accentHex: "#3e4247",
    description: "Meja belajar/kerja dengan kursi ergonomis",
    swatches: [
      { name: "Oak Natural", hex: "#c39d72" },
      { name: "Walnut", hex: "#6a482f" },
    ],
  },
  {
    catalogId: "kloset_set",
    name: "Kloset Duduk + Wastafel",
    category: "sanitary",
    defaultSize: { x: 0.65, y: 0.8, z: 0.72 },
    colorHex: "#f7f7f5",
    description: "Kloset keramik dual-flush hemat air",
    swatches: [{ name: "Keramik Putih", hex: "#f7f7f5" }],
  },
  {
    catalogId: "car_city",
    name: "Mobil Keluarga (LCGC/MPV)",
    category: "vehicle",
    defaultSize: { x: 1.75, y: 1.55, z: 4.1 },
    colorHex: "#d6dade",
    accentHex: "#202428",
    description: "Referensi skala parkir carport 3,5×4,5 m",
    swatches: [
      { name: "Silver Metalik", hex: "#d6dade" },
      { name: "Putih Mutiara", hex: "#f2f4f6" },
      { name: "Abu Grafit", hex: "#4d5359" },
    ],
  },
  {
    catalogId: "motorbike",
    name: "Sepeda Motor Skutik",
    category: "vehicle",
    defaultSize: { x: 0.7, y: 1.1, z: 1.85 },
    colorHex: "#2f353b",
    accentHex: "#c95b3c",
    description: "Motor harian di carport samping mobil",
    swatches: [
      { name: "Hitam Matte", hex: "#2f353b" },
      { name: "Merah Marun", hex: "#8e3429" },
    ],
  },
  {
    catalogId: "tropical_plant",
    name: "Pot Tanaman Tropis (Monstera/Palem)",
    category: "plant",
    defaultSize: { x: 0.65, y: 1.2, z: 0.65 },
    colorHex: "#4f7a47",
    accentHex: "#b86b52",
    description: "Tanaman hias pot terakota untuk taman/balkon/void",
    swatches: [{ name: "Daun Hijau Tropis", hex: "#4f7a47" }],
  },
];

export interface HvacCatalogEntry {
  type: HvacType;
  name: string;
  pkRating?: 0.5 | 1 | 1.5 | 2;
  flowRateM3h: number;
  coolingCapacityW: number;
  powerW: number;
  setpointC: number;
  defaultElevationM: number;
  notes: string;
}

export const HVAC_CATALOG: HvacCatalogEntry[] = [
  {
    type: "ac_split",
    name: "AC Split Inverter 0.5 PK",
    pkRating: 0.5,
    flowRateM3h: 420,
    coolingCapacityW: 1465,
    powerW: 360,
    setpointC: 24,
    defaultElevationM: 2.35,
    notes: "Cocok untuk kamar tidur 7–11 m²",
  },
  {
    type: "ac_split",
    name: "AC Split Inverter 1 PK",
    pkRating: 1,
    flowRateM3h: 580,
    coolingCapacityW: 2638,
    powerW: 720,
    setpointC: 24,
    defaultElevationM: 2.35,
    notes: "Cocok untuk kamar utama / ruang kerja 12–18 m²",
  },
  {
    type: "ac_split",
    name: "AC Split Inverter 1.5 PK",
    pkRating: 1.5,
    flowRateM3h: 780,
    coolingCapacityW: 3517,
    powerW: 1050,
    setpointC: 24,
    defaultElevationM: 2.45,
    notes: "Cocok untuk ruang keluarga / open plan 20–30 m²",
  },
  {
    type: "ceiling_fan",
    name: "Kipas Plafon Tropis (Ceiling Fan)",
    flowRateM3h: 2200,
    coolingCapacityW: 0,
    powerW: 48,
    setpointC: 26,
    defaultElevationM: 2.88,
    notes: "Menciptakan efek sejuk -2 hingga -3°C lewat kecepatan udara",
  },
  {
    type: "stand_fan",
    name: "Kipas Angin Berdiri / Dinding",
    flowRateM3h: 1350,
    coolingCapacityW: 0,
    powerW: 45,
    setpointC: 27,
    defaultElevationM: 0.0,
    notes: "Fleksibel diarahkan ke bukaan untuk mendorong cross-ventilation",
  },
  {
    type: "exhaust_fan",
    name: "Exhaust Fan KM / Dapur",
    flowRateM3h: 260,
    coolingCapacityW: 0,
    powerW: 28,
    setpointC: 27,
    defaultElevationM: 2.65,
    notes: "Membuang kelembapan & bau ke void/area luar",
  },
];

export interface LightCatalogEntry {
  type: LightType;
  name: string;
  lumens: number;
  colorTempK: number;
  beamAngleDeg: number;
  defaultElevationM: number;
}

export const LIGHT_CATALOG: LightCatalogEntry[] = [
  { type: "ceiling", name: "Downlight LED Plafon 12W", lumens: 1080, colorTempK: 4000, beamAngleDeg: 110, defaultElevationM: 3.08 },
  { type: "pendant", name: "Lampu Gantung Ruang Makan", lumens: 900, colorTempK: 3000, beamAngleDeg: 100, defaultElevationM: 2.35 },
  { type: "wall", name: "Lampu Dinding Fasad / Teras", lumens: 700, colorTempK: 3000, beamAngleDeg: 90, defaultElevationM: 2.2 },
  { type: "spot", name: "Spotlight Aksen Hangat", lumens: 650, colorTempK: 2700, beamAngleDeg: 45, defaultElevationM: 3.05 },
  { type: "strip", name: "LED Strip Tangga / Plafon", lumens: 800, colorTempK: 3000, beamAngleDeg: 150, defaultElevationM: 2.95 },
  { type: "garden", name: "Lampu Taman Bollard", lumens: 500, colorTempK: 3000, beamAngleDeg: 120, defaultElevationM: 0.45 },
];

export const PAINT_SWATCHES = [
  { hex: "#f2ece1", name: "Ivory Kapur Hangat" },
  { hex: "#ccd8c2", name: "Sage Hijau Tropis" },
  { hex: "#d8b294", name: "Terakota Pasir" },
  { hex: "#d9cfc1", name: "Greige Semen Halus" },
  { hex: "#bdd2e2", name: "Biru Langit Pucat" },
  { hex: "#e9e6df", name: "Putih Alabaster" },
];

export const ROOF_SWATCHES = [
  { hex: "#363b40", name: "Charcoal Zincalume" },
  { hex: "#4d555e", name: "Slate Metal" },
  { hex: "#7e463b", name: "Terracotta Clay" },
  { hex: "#2f3d37", name: "Deep Moss Metal" },
];
