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
  no: number;
  nama: string;
  durasi: string;
  deskripsi: string;
  cekMutu: string[];
}

export const CONSTRUCTION_STAGES_GUIDE: ConstructionStageGuide[] = [
  {
    no: 1,
    nama: "Persiapan, Bouwplank & Peil Banjir",
    durasi: "4 hari",
    deskripsi:
      "Pembersihan lahan 5×17 m, pemasangan bouwplank, pengecekan batas tembok tetangga kiri-kanan, serta penetapan peil elevasi lantai utama (+50 cm di atas jalan).",
    cekMutu: [
      "Diagonal tapak 5×17 m = 17,72 m akurat",
      "Elevasi peil +0,50 m bebas genangan jalan",
      "Jarak batas tetangga kiri/kanan tidak melanggar KDB",
    ],
  },
  {
    no: 2,
    nama: "Pondasi 2 Lantai & Sumur Resapan",
    durasi: "2 minggu",
    deskripsi:
      "Galian tapak footplate / pengeboran strauss pile / cakar ayam, lantai kerja 5 cm, pembesian tapak D13, cor beton K-250, dan pembuatan sumur resapan SNI 03-2453.",
    cekMutu: [
      "Tanah dasar padat & bebas genangan saat cor",
      "Selimut beton pondasi minimal 40 mm",
      "Sumur resapan berjarak aman ≥ 5 m dari bio septic",
    ],
  },
  {
    no: 3,
    nama: "Sloof & Kolom Utama LT1",
    durasi: "2 minggu",
    deskripsi:
      "Sloof struktural 20/30 (6D12 + begel Ø8) dan kolom utama 20/25 (6D13 + begel Ø8-100 tumpuan) dicor dengan pengikatan seismic hook 135°.",
    cekMutu: [
      "Kait begel ditekuk 135° tahan gempa (SNI 2847)",
      "Kolom tegak lot dengan toleransi < 5 mm",
      "Overlap stek besi ke lantai 2 minimal 40× diameter",
    ],
  },
  {
    no: 4,
    nama: "Balok Induk, Pelat LT2 & Tangga",
    durasi: "2 minggu",
    deskripsi:
      "Pengecoran balok induk 20/35, pelat lantai 2 (tebal 12 cm / Bondek / Panel AAC), dan tangga beton 20 anak tangga menuju lantai 2, menyisakan void belakang 1,65×3,3 m.",
    cekMutu: [
      "Tinggi bebas (headroom) tangga minimal 2,05 m",
      "Tulangan rangkap pelat & balok terikat kawat bendrat",
      "Curing beton disiram minimal 7 hari",
    ],
  },
  {
    no: 5,
    nama: "Pasangan Bata LT1 & LT2 + Kolom Praktis",
    durasi: "3 minggu",
    deskripsi:
      "Pemasangan bata putih hebel (nat 3 mm), bata merah (spesi 1:5), atau ukuran bata custom batu demi batu, beserta kusen, roster, dan kolom praktis tiap jarak ≤ 3,5 m.",
    cekMutu: [
      "Ikatan berselang min. 10 cm, tidak segaris antar lajur",
      "Angkur besi ke kolom tiap 4–5 lapis bata",
      "Dinding batas kiri/kanan rapat tanpa jendela ke tetangga",
    ],
  },
  {
    no: 6,
    nama: "Ring Balk & Atap Shed 10° ke Depan",
    durasi: "1,5 minggu",
    deskripsi:
      "Ring balk pengikat di puncak LT2, rangka baja ringan C75, atap miring satu arah 10° ke depan + insulasi foil, skylight tangga, dan talang parapet kiri/kanan.",
    cekMutu: [
      "Kemiringan atap 10° lancar mengalirkan hujan ke talang depan",
      "Talang jurai dalam parapet dites rendam 24 jam tanpa bocor",
      "Overstek samping 0 m (tidak menetes ke atap tetangga)",
    ],
  },
  {
    no: 7,
    nama: "Rough-in MEP, Backflow & Kabel AC",
    durasi: "1 minggu",
    deskripsi:
      "Pipa air bersih PVC AW, pipa limbah dengan kemiringan 1,5% + Backflow Valve menuju Bio Septic bawah carport, serta conduit kabel lampu (1,5 mm²) & kontak/AC (2,5 mm²).",
    cekMutu: [
      "Posisi stop kontak LT1 & MCB aman di atas rencana tinggi banjir",
      "Uji tekan pipa air 4 bar sebelum ditutup plesteran",
      "Backflow valve terpasang menghadap aliran keluar",
    ],
  },
  {
    no: 8,
    nama: "Plesteran, Acian, Plafon & Keramik",
    durasi: "3 minggu",
    deskripsi:
      "Plester + acian 2 sisi dinding, plafon gypsum 9 mm, rabat carport, serta pemasangan keramik lantai 30×30/40×40/60×60 dengan anti-slip di 4 area KM/WC.",
    cekMutu: [
      "Kemiringan lantai KM 1,5% menuju floor drain",
      "Keramik tidak kopong (uji ketuk palu karet)",
      "Waterproofing area basah & dinding bawah 0–1,2 m",
    ],
  },
  {
    no: 9,
    nama: "Pemasangan Pintu, Lampu, Kipas & AC",
    durasi: "1 minggu",
    deskripsi:
      "Daun pintu & jendela aluminium, sanitair Toto/setara, lampu LED, unit AC Split Inverter, kipas plafon/exhaust, serta perlengkapan mitigasi banjir (sekat pintu & pompa).",
    cekMutu: [
      "Pintu & jendela geser lancar & kedap tampias",
      "Arus listrik & ELCB diuji coba tanpa trip",
      "Sekat banjir pintu teruji rapat pada kusen",
    ],
  },
  {
    no: 10,
    nama: "Cat Finishing, Uji Banjir & Serah Terima",
    durasi: "1 minggu",
    deskripsi:
      "Cat eksterior weather-shield + interior 2 lapis, uji sirkulasi udara/lampu/drainase, pembersihan akhir, dan berita acara serah terima ke pemilik.",
    cekMutu: [
      "Seluruh ceklist RAB & Gambar Kerja As-Built sesuai",
      "Saluran talang depan lancar menuju sumur resapan",
      "Kunci & kartu garansi AC/pompa diserahkan",
    ],
  },
];

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
