/**
 * Basis Pengetahuan Arsitektur Rumah Tinggal 2 Lantai Indonesia.
 * Sumber rujukan:
 * - SNI 2847:2019 (Persyaratan Beton Struktural untuk Bangunan Gedung)
 * - SNI 1726:2019 (Tata Cara Perencanaan Ketahanan Gempa)
 * - SNI 1727:2020 (Beban Minimum untuk Perancangan Bangunan Gedung)
 * - SNI 8460:2017 (Persyaratan Perancangan Geoteknik)
 * - SNI 8640:2018 (Spesifikasi Bata Ringan AAC)
 * - SNI 03-6572:2001 & SNI 03-2396:2001 (Ventilasi & Pencahayaan Alami)
 * - SNI 03-2453:2002 (Sumur Resapan Air Hujan Lahan Pekarangan)
 * - PUIL 2011 / SNI 0225 (Instalasi Listrik Aman Banjir)
 * - Permen PUPR No. 8 Tahun 2023 (AHSP Konstruksi)
 */

export interface ConstructionStageGuide {
  id: string;
  no: number;
  order: number;
  nama: string;
  dependsOn: string[];
  crew: number;
  days: number;
  leadDays: number;
  durasi: string;
  deskripsi: string;
  cekMutu: string[];
}

/** Canonical 12 construction stages shared by scheduleEngine, 3D Timeline Bar, & Panduan. */
export const CONSTRUCTION_STAGES: ConstructionStageGuide[] = [
  {
    id: "st-01",
    no: 1,
    order: 1,
    nama: "Persiapan & Bouwplank",
    dependsOn: [],
    crew: 3,
    days: 4,
    leadDays: 3,
    durasi: "4 hari",
    deskripsi:
      "Pembersihan lahan 5×17 m, pemasangan bouwplank, pengecekan batas tembok tetangga kiri-kanan, serta penetapan peil elevasi lantai utama di atas jalan.",
    cekMutu: [
      "Diagonal tapak 5×17 m = 17,72 m tepat",
      "As batas tetangga kiri/kanan diverifikasi",
      "Referensi peil jalan & banjir ditandai",
    ],
  },
  {
    id: "st-02",
    no: 2,
    order: 2,
    nama: "Galian, Urugan Peil & Pondasi",
    dependsOn: ["st-01"],
    crew: 5,
    days: 14,
    leadDays: 5,
    durasi: "14 hari",
    deskripsi:
      "Galian tapak footplate / strauss pile / cakar ayam, lantai kerja 5 cm, pembesian tapak, cor beton K-250, urugan peninggian peil, dan sumur resapan SNI 03-2453.",
    cekMutu: [
      "Kedalaman tanah keras tercapai",
      "Lantai kerja 5 cm rata",
      "Tulangan footplate/strauss bebas karat & bersepatu beton 40 mm",
    ],
  },
  {
    id: "st-03",
    no: 3,
    order: 3,
    nama: "Sloof, Kolom Utama & Balok Induk",
    dependsOn: ["st-02"],
    crew: 6,
    days: 16,
    leadDays: 7,
    durasi: "16 hari",
    deskripsi:
      "Pengecoran sloof struktural 20/30, kolom utama 20/25, serta balok induk pemikul pelat lantai 2 dengan pengikatan kait begel gempa 135°.",
    cekMutu: [
      "Sengkang seismic 135° rapat di zona tumpuan",
      "Bekisting tegak & kencang (cek lot/waterpass)",
      "Slump beton sesuai mutu rencana",
    ],
  },
  {
    id: "st-04",
    no: 4,
    order: 4,
    nama: "Pelat Lantai 2 & Tangga",
    dependsOn: ["st-03"],
    crew: 6,
    days: 12,
    leadDays: 7,
    durasi: "12 hari",
    deskripsi:
      "Pengecoran / pemasangan pelat lantai 2 (cor konvensional / Bondek Wiremesh / Panel AAC) dan konstruksi tangga beton menuju lantai 2 lengkap dengan lubang void.",
    cekMutu: [
      "Perancah/steger kuat menahan beban cor",
      "Selimut beton pelat 20 mm terjaga",
      "Curing beton minimal 7 hari sebelum bongkar total",
    ],
  },
  {
    id: "st-05",
    no: 5,
    order: 5,
    nama: "Pasangan Bata & Kolom Praktis",
    dependsOn: ["st-04"],
    crew: 5,
    days: 18,
    leadDays: 5,
    durasi: "18 hari",
    deskripsi:
      "Pemasangan dinding bata hebel / merah / batako / precast batu demi batu, penyusunan roster angin, dan pengecoran kolom praktis tiap jarak <= 3,5 m.",
    cekMutu: [
      "Kelurusan vertikal dicek tiap 1 m",
      "Ikatan berselang min. 10 cm + angkur besi ke kolom tiap 5 lapis",
      "Tebal nat sesuai spek (hebel 3 mm / merah 12 mm)",
    ],
  },
  {
    id: "st-06",
    no: 6,
    order: 6,
    nama: "Pemasangan Kusen Pintu & Jendela",
    dependsOn: ["st-05"],
    crew: 3,
    days: 6,
    leadDays: 14,
    durasi: "6 hari",
    deskripsi:
      "Pemasangan kusen kayu solid, WPC/UPVC kamar mandi, dan kusen aluminium eksterior secara siku sebelum pekerjaan plesteran.",
    cekMutu: [
      "Kusen siku 90° & waterpass",
      "Ambang bawah jendela miring keluar 5° cegah tampias",
    ],
  },
  {
    id: "st-07",
    no: 7,
    order: 7,
    nama: "Ring Balk, Rangka Atap Shed & Talang",
    dependsOn: ["st-05"],
    crew: 4,
    days: 10,
    leadDays: 10,
    durasi: "10 hari",
    deskripsi:
      "Ring balk pengikat di puncak lantai 2, rangka baja ringan C75, penutup atap dengan insulasi aluminium foil, skylight tangga, serta talang & downspout.",
    cekMutu: [
      "Kemiringan atap tepat mengalir ke talang",
      "Talang jurai dalam parapet tetangga diuji genang (tes bocor)",
      "Sekrup atap & insulasi terpasang rapi",
    ],
  },
  {
    id: "st-08",
    no: 8,
    order: 8,
    nama: "Instalasi Rough-in MEP & Backflow",
    dependsOn: ["st-05", "st-07"],
    crew: 3,
    days: 8,
    leadDays: 5,
    durasi: "8 hari",
    deskripsi:
      "Pemasangan jaringan pipa air bersih PVC AW, pipa limbah miring ke Bio Septic Tank + backflow valve, serta conduit listrik NYM tertanam di dinding.",
    cekMutu: [
      "Tes tekan pipa air bersih 4 bar min. 2 jam",
      "Kemiringan pipa limbah 1–2% ke bio septic + backflow valve terpasang",
      "Conduit listrik & grounding arde sesuai PUIL",
    ],
  },
  {
    id: "st-09",
    no: 9,
    order: 9,
    nama: "Plesteran, Acian & Plafon",
    dependsOn: ["st-06", "st-07", "st-08"],
    crew: 5,
    days: 14,
    leadDays: 4,
    durasi: "14 hari",
    deskripsi:
      "Plesteran dan acian dinding, serta pemasangan rangka hollow dan plafon gypsum 9 mm pada seluruh ruang interior.",
    cekMutu: [
      "Kerataan plester pakai jidar 2 m toleransi < 3 mm",
      "Plafon area KM pakai gypsum tahan lembap",
    ],
  },
  {
    id: "st-10",
    no: 10,
    order: 10,
    nama: "Lantai Keramik, Carport & Railing",
    dependsOn: ["st-09"],
    crew: 4,
    days: 12,
    leadDays: 7,
    durasi: "12 hari",
    deskripsi:
      "Cor rabat carport anti-slip, pemasangan keramik/granit tile, plint lantai, serta railing tangga dan balkon pengaman.",
    cekMutu: [
      "Keramik tidak kopong saat diketuk",
      "Lantai KM miring 1,5% ke floor drain",
      "Railing balkon & void kokoh (tinggi min. 95 cm)",
    ],
  },
  {
    id: "st-11",
    no: 11,
    order: 11,
    nama: "Sanitair, Saklar/Lampu, AC & Mitigasi Banjir",
    dependsOn: ["st-10"],
    crew: 3,
    days: 6,
    leadDays: 7,
    durasi: "6 hari",
    deskripsi:
      "Pemasangan sanitair, box MCB/ELCB, saklar & stop kontak elevasi aman banjir, lampu LED, unit AC/kipas, sekat banjir pintu, dan pompa kuras.",
    cekMutu: [
      "Stop kontak LT1 di elevasi aman banjir",
      "Uji vakum & arus AC/kipas",
      "Tes sekat banjir pintu & pompa kuras",
    ],
  },
  {
    id: "st-12",
    no: 12,
    order: 12,
    nama: "Cat, Waterproofing & Serah Terima",
    dependsOn: ["st-11"],
    crew: 4,
    days: 8,
    leadDays: 4,
    durasi: "8 hari",
    deskripsi:
      "Aplikasi waterproofing KM/balkon/dinding bawah, pengecatan eksterior weather-shield & interior 2 lapis, uji sirkulasi, dan serah terima proyek.",
    cekMutu: [
      "Tes genang waterproofing KM & balkon 24 jam",
      "Seluruh checklist SNI & RAB disetujui bersama kontraktor",
    ],
  },
];

export const CONSTRUCTION_STAGES_GUIDE = CONSTRUCTION_STAGES;

export const DETAIL_ELEMEN_2LANTAI = [
  {
    id: "pondasi2lt",
    judul: "Sistem Pondasi Rumah 2 Lantai (Surabaya)",
    ringkas: "Footplate, Strauss Pile, Cakar Ayam, atau Elevated Panggung Anti-Banjir.",
    poin: [
      "Rumah 2 lantai memiliki beban kolom ~140–220 kN per titik; pondasi batu kali saja tidak cukup — wajib dikombinasikan dengan Footplate (tapak beton bertulang min. 100×100×30 cm) atau Strauss Pile.",
      "Untuk tanah lunak/lempung Surabaya dengan lapisan keras di kedalaman 3–6 m, Strauss Pile Ø30 cm atau Cakar Ayam Sedyatmo mencegah penurunan tidak merata (differential settlement).",
      "Pada daerah rawan banjir/rob, peninggian peil lantai +50 cm atau sistem Elevated Pedestal menjaga lantai LT1 tetap kering.",
    ],
  },
  {
    id: "struktur2lt",
    judul: "Struktur Beton Bertulang SNI 2847:2019 & SNI 1726:2019",
    ringkas: "Kolom utama 20/25, Balok induk 20/35, Sloof 20/30, dan detailing tahan gempa.",
    poin: [
      "Mutu beton minimal K-250 (fc' ≈ 21,7 MPa) dan baja tulangan ulir BJTS 420B untuk elemen pemikul momen.",
      "Sengkang/begel pada zona tumpuan (sepanjang 50 cm dari muka kolom/balok) wajib berjarak rapat 100 mm dengan kait tekuk 135° agar kolom tidak pecah saat gempa.",
      "Pelat lantai 2 dapat menggunakan Cor Konvensional 12 cm (tulangan rangkap Ø10-150), Bondek + Wiremesh M8 (tanpa bongkar bekisting), atau Panel Lantai AAC 12,5 cm (lebih ringan & cepat).",
    ],
  },
  {
    id: "dindingcustom",
    judul: "Susunan Bata, Tebal Nat & Pengurangan Luas Tanah 5×17 m",
    ringkas: "Analitik batu demi batu mendukung Hebel AAC, Bata Merah, Batako, hingga ukuran Custom.",
    poin: [
      "Dinding hebel 600×200×100 mm memakai perekat tipis (thinbed) 2–3 mm dengan konsumsi ±3,5–4 kg/m² (Permen PUPR 8/2023) dan memberi beban gempa lebih ringan (±750 kg/m³ vs bata merah 1.700 kg/m³).",
      "Dinding bata merah 200×100×50 mm memakai spesi semen-pasir 1:5 setebal 10–15 mm (±70–75 bata/m²), membutuhkan plesteran 15 mm di kedua sisi.",
      "Pada kavling sempit 5×17 m, ketebalan dinding luar 150 mm vs 100 mm langsung memotong luas bersih dalam ruangan hingga 2–4 m² per lantai — aplikasi ini menghitung luas bersih nyata secara otomatis.",
    ],
  },
  {
    id: "tropis5x17",
    judul: "Strategi Pencahayaan & Penghawaan Kavling Dempet Tetangga",
    ringkas: "Sisi kiri/kanan tertutup tembok tetangga — mengandalkan fasad depan, void belakang & skylight tangga.",
    poin: [
      "Karena sisi kiri/kanan menempel tetangga, dilarang membuka jendela ke lahan sebelah. Solusi tropis: Void belakang 1,65×3,3 m di atas taman belakang + Skylight di atas tangga tengah.",
      "Atap miring satu arah (shed roof) 10° ke depan mengangkat sisi belakang rumah lebih tinggi sehingga udara panas naik (stack effect) dan keluar lewat ventilasi atas/void belakang.",
      "Menggabungkan kipas plafon + AC split inverter menghemat listrik hingga 30% karena suhu setpoint AC cukup 25–26°C dengan bantuan gerak udara.",
    ],
  },
  {
    id: "banjirsurabaya",
    judul: "Arsitektur Tahan Hujan Deras & Banjir Perkotaan",
    ringkas: "Peil lantai tinggi, talang atap shed depan, backflow valve, sumur resapan SNI 03-2453 & PUIL aman banjir.",
    poin: [
      "Atap shed roof 10° mengarahkan 100% air hujan ke talang depan lebar 200 mm & 2 pipa turun PVC 3\" menuju Sumur Resapan di taman depan/carport — mencegah banjir meluber ke tetangga.",
      "Pasang Backflow Valve (katup searah) pada pipa limbah sebelum bio septic tank agar air selokan tidak meluap masuk melalui WC/floor drain LT1 saat banjir.",
      "Di area rawan genangan, naikkan posisi stop kontak LT1 dari 30 cm menjadi 100–120 cm dan gunakan panel MCB/ELCB anti-kontak.",
    ],
  },
];

export const STANDAR_REGULASI = [
  { kode: "SNI 2847:2019", judul: "Beton Struktural Bangunan Gedung", ket: "Ketentuan dimensi minimum, penulangan lentur/geser, dan kait sengkang gempa 135°." },
  { kode: "SNI 1726:2019", judul: "Ketahanan Gempa Struktur Gedung", ket: "Analisis gaya geser dasar gempa ekuivalen untuk wilayah Surabaya (Kelas Situs SE)." },
  { kode: "SNI 1727:2020", judul: "Beban Minimum Bangunan Gedung", ket: "Beban hidup hunian 2,0 kN/m², tangga/balkon 3,0 kN/m², atap 1,5 kN/m², dan angin." },
  { kode: "Permen PUPR 8/2023", judul: "Pedoman AHSP Bidang Cipta Karya", ket: "Koefisien bahan, tenaga kerja (OH), dan peralatan untuk perhitungan RAB transparan." },
  { kode: "SNI 03-2453:2002", judul: "Sumur Resapan Air Hujan", ket: "Desain penampung limpasan atap untuk mengurangi beban drainase kota dan banjir." },
  { kode: "SNI 03-6572 & 2396", judul: "Ventilasi & Pencahayaan Alami", ket: "Rasio bukaan minimal 5% (ideal 10–20%) serta pertukaran udara silang (ACH)." },
  { kode: "PUIL 2011 / SNI 0225", judul: "Instalasi Listrik Rumah Tinggal", ket: "Pemisahan sirkuit lampu (1,5 mm²) vs kontak/AC (2,5 mm²), ELCB, dan grounding." },
];
