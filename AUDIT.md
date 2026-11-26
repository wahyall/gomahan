# Audit Business Logic, Arsitektur Fitur & Alur Pengguna — Gomahan (Rumah Studio 3D)

> **Catatan Konteks:** Dokumen ini adalah audit menyeluruh terhadap *business logic*, konsistensi aturan lintas modul, integritas data/state, dan alur pengguna pada codebase `gomahan` (melengkapi audit performa & rendering 3D sebelumnya). Pada tahap ini **belum ada kode, skema, atau data yang diubah** — seluruh temuan menunggu persetujuan sebelum dieksekusi.

---

## 1. Pemetaan Produk Aktual: Pengguna, Fitur & Alur End-to-End

### Target Pengguna (Disimpulkan dari Codebase)
1. **Pemilik Rumah / Klien (Default: Kavling 5×17 m, Surabaya)**: Merancang tata ruang 1–2 lantai di 3D, mensimulasikan pencahayaan/udara/banjir, memantau pagu anggaran RAB, dan mengeksplorasi rumah lewat *Walk Mode*.
2. **Arsitek / Drafter / Pra-Desain Struktur**: Mengatur sistem pondasi, rangka, pelat, atap, spesifikasi bata, melakukan cek pra-desain SNI (2847/1726/1727), serta menghasilkan gambar kerja 2D (`A-01` s.d. `S-01`).
3. **Estimator / Kontraktor / Mandor Lapangan**: Menyesuaikan harga satuan AHSP, menyusun jadwal konstruksi & pengadaan material, mencatat progres/QC lapangan, dan mengunduh paket dokumen ekspor (PDF, Excel, CSV, JPG, ZIP).

### Alur Pengguna End-to-End Saat Ini
`Build Studio` (desain 3D + 5 panel kanan: Struktur, Cahaya, Udara, Banjir, Inspeksi) → `Walk Mode` (jalan 1st/3rd-person) → `Denah 2D` (SVG CAD) → `RAB` (BOQ & harga AHSP) → `Jadwal` (Gantt/S-Curve/EVM) → `Lapangan` (Site Mode QC) → `Ekspor` (Deliver Workspace, gerbang 4 syarat) → `Panduan` (referensi statis).

### Ringkasan Eksekutif Temuan
| Kategori | Jumlah Temuan | Tingkat Keparahan Utama |
|---|---|---|
| **A. Logika Bisnis Salah / Bertentangan (`BL`)** | 12 | **Kritis** — RAB tidak seimbang, double counting beton, SNI & skor banjir memberi status aman palsu |
| **B. Aturan Tidak Konsisten Antar Modul (`IN`)** | 9 | **Tinggi** — Split-brain state 2 store, 4 ambang banjir berbeda, 10 vs 12 tahap konstruksi |
| **C. Alur Berbelit, Fitur Rusak & UX Friction (`UX`)** | 11 | **Tinggi** — Ekspor JPG selalu gagal diam-diam, tombol Tampilkan Tanah rusak, 4 lapis tab |
| **D. Fitur Tumpang Tindih & Dead Code (`DC`)** | 8 | **Sedang** — `mepRoutes` mati, 64 baris dead code `PartInfoPanel`, EVM `actualCost` tanpa input |
| **E. Edge Case, Validasi & Risiko Korupsi Data (`EC`)** | 9 | **Kritis** — Crash pada 1 lantai, autosave menimpa data lama permanen, Undo penuh oleh klik UI |

---

## 2. Daftar Temuan Audit Detail

### A. Logika Bisnis yang Salah atau Bertentangan (`BL`)

#### `BL-01` — Mode Upah `borongan_pct` Merusak Keseimbangan RAB, Warning, Jadwal, dan Excel
- **Bukti Kode**: `src/lib/quantities/rabEngine.ts:96, 304-323, 333-335`; `src/lib/timeline/scheduleEngine.ts:259-263`; `src/lib/export/exporters.ts:88-99`.
- **Masalah**: Saat `wageMode === "borongan_pct"`, `rabEngine` meng-nol-kan `labU` di setiap baris BOQ lalu menambahkan upah borongan secara global di akhir (`directLaborTotal`). Akibatnya:
  1. `sum(divisions.subtotal) !== directSubtotal`.
  2. Item murni upah tanpa material/alat (seperti `galian` di `priceBook.ts:110`) menjadi `unitPrice === 0` dan memicu *critical warning* palsu.
  3. `scheduleEngine` membagi `directStageCost` (tanpa upah borongan) terhadap `rab.directSubtotal` (dengan upah borongan), sehingga total anggaran semua tahap & kurva-S **kehilangan seluruh porsi upah borongan** dan tidak sama dengan `rab.grandTotal`.
  4. Sheet Excel `"Ringkasan RAB"` menampilkan total porsi divisi `< 100%`.
- **Dampak**: Angka RAB, jadwal kas mingguan, dan laporan Excel saling bertentangan dan menyesatkan estimasi kontraktor.
- **Usulan Aturan yang Benar**: Alokasikan komponen upah borongan secara proporsional ke tiap baris/divisi (atau tampilkan baris eksplisit *"Upah Borongan Konstruksi"* dalam divisi tersendiri yang ikut terdistribusi ke bobot jadwal), kecualikan item murni upah dari warning `unitPrice === 0` saat `borongan_pct`, dan pastikan invariant `sum(divisions.subtotal) + borongan === directSubtotal` serta `sum(stages.budgetIdr) === rab.grandTotal` teruji oleh unit test.

#### `BL-02` — Double Counting Beton Strauss Pile & Wiremesh Cakar Ayam Terlewat
- **Bukti Kode**: `src/lib/structure/sniEngine.ts:422, 436, 496`; `src/lib/quantities/rabEngine.ts:150-156`; `src/lib/model/priceBook.ts:116`.
- **Masalah**:
  1. Untuk `strauss_pile`, `sniEngine` memasukkan volume beton tiang bor (`2 * π * 0.15² * 3.0`) ke `foundationM3`. Lalu `rabEngine` menagih `strauss_pile` (pengeboran **dan cor** per `m1`, Rp 315.000/m1) sekaligus `footplate_beton` dengan `foundationM3` penuh — beton tiang bor tertagih dua kali.
  2. Di `sniEngine.ts:496`, wiremesh memakai ternary `slab === "bondek_wiremesh" ? lt2Area * 1.08 : foundation === "cakar_ayam" ? 65 : 0`, sehingga kombinasi `cakar_ayam` + `bondek_wiremesh` menghilangkan 65 m² wiremesh fondasi.
  3. Preset bata `"precast"` (`priceBook.ts:46-59`) tidak punya cabang di `rabEngine.ts:180-187`, sehingga diam-diam memakai harga `bata_custom`.
- **Dampak**: Over-budget pada `strauss_pile`, under-budget pada `cakar_ayam + bondek_wiremesh`, dan salah harga satuan pada bata `precast`.
- **Usulan Aturan yang Benar**: Pisahkan `pileCapM3` dari `straussPileConcreteM3` di `sniEngine` agar `footplate_beton` hanya menghitung pile cap; jumlahkan wiremesh pelat dan wiremesh cakar ayam secara aditif (`+`, bukan ternary); tambahkan cabang harga eksplisit untuk `precast`.

#### `BL-03` — `sniEngine.overallSafe` Mengabaikan Kolom Overload (`PERIKSA`)
- **Bukti Kode**: `src/lib/structure/sniEngine.ts:293, 595-608, 647`; `src/lib/gamification/simsEngine.ts:95`.
- **Masalah**: Setiap kolom menghitung `status: util <= 0.92 ? "AMAN" : "PERIKSA"`, tetapi `warnings` dan `overallSafe` hanya mengecek `foundations`, `beams`, dan `driftRatio`. Kolom yang overload tetap meloloskan `overallSafe = true` dan membuka lencana `"SNI Compliant"`.
- **Dampak**: Pengguna mendapat status aman palsu padahal elemen vertikal paling kritis (kolom) gagal kapasitas aksial.
- **Usulan Aturan yang Benar**: Sertakan `columns.every(c => c.status === "AMAN")` dalam `overallSafe` dan tambahkan warning spesifik kolom overload pada `warnings`.

#### `BL-04` — Skor Ketahanan Banjir Tetap 100/100 Meski Interior LT1 Terendam
- **Bukti Kode**: `src/lib/simulation/floodEngine.ts:183-193`; `src/lib/gamification/simsEngine.ts:88`.
- **Masalah**: `floodResilienceScore` hanya mengurangi skor bila `gutterOverflowRisk` (-12) atau `electricalHazardOutlets` (-20), **tanpa penalti** untuk `lt1FloorFloodCm > 0`, `backflowActive`, maupun `electricalHazardMcb`. Rumah dengan peil 50 cm + barrier 20 cm + stop kontak 120 cm yang terendam 40 cm saat banjir 110 cm tetap mendapat skor **100/100** dan lencana `"Flood Ready Surabaya"`.
- **Dampak**: Simulasi banjir kehilangan kredibilitas teknis dan memberi rasa aman palsu.
- **Usulan Aturan yang Benar**: Kurangi `floodResilienceScore` secara progresif berdasarkan `lt1FloorFloodCm` (mis. penalti dasar -35 plus -1 per cm genangan dalam rumah), `backflowActive` (-15), dan `electricalHazardMcb` (-30); kunci status `"AMAN"` / badge hanya jika `lt1FloorFloodCm === 0` dan tidak ada bahaya listrik.

#### `BL-05` — Simulasi Pencahayaan Melonggarkan SNI 40% & Mencampur Cahaya Siang/Malam
- **Bukti Kode**: `src/lib/simulation/lightingEngine.ts:158-159, 192-197, 253-276, 306-307, 323`.
- **Masalah**:
  1. Status `"CUKUP"` (`>= 0.6 * targetLux`) dihitung sebagai `passing` pada `sniCompliancePct`, sehingga ruang 40% di bawah standar SNI tetap disebut 100% patuh.
  2. `daylightScore` memakai `sniCompliancePct` berbasis `totalLux` (termasuk lampu buatan), sehingga pada malam hari skor pencahayaan alami tetap bisa 90–100.
  3. `totalLux` (inverse-square grid) dan `artificialLux` (lumen/luas × 0.78) memakai rumus berbeda lalu dikurangkan (`naturalLux = max(0, totalLux - artificialLux)`), sehingga `naturalLux` bisa > 0 di malam hari.
  4. Orientasi matahari `dirX/dirZ` dihitung tetapi tidak dipakai, dan jendela tidak dioklusi dinding.
- **Dampak**: Angka lux alami, kepatuhan SNI, dan skor pencahayaan tidak dapat diandalkan.
- **Usulan Aturan yang Benar**: Hitung `naturalLux` dan `artificialLux` secara terpisah di grid lalu jumlahkan (`totalLux = naturalLux + artificialLux`); pisahkan `sniCompliancePct` (syarat `>= targetLux`) dari kategori `"CUKUP"`; hitung `daylightScore` murni dari komponen alami saat siang (`isDaylight ? ... : null/N/A`).

#### `BL-06` — Simulasi Udara (`airflowEngine`) Memberi Status Nyaman & Cross-Vent Palsu
- **Bukti Kode**: `src/lib/simulation/airflowEngine.ts:230, 297-303, 318-321, 362-366`.
- **Masalah**:
  1. Ruang `living` dan `kitchen` selalu dipaksa `crossVentilated = true` meski tanpa jendela/kipas dan `ACH = 0,6`.
  2. Ruang ber-AC (`hasAc = true`) yang panas & pengap (`avgTemp > 26.2`, `ach < 2.2`) melewati kondisi `"PENGAP"` (yang mensyaratkan `!hasAc`) lalu jatuh ke `"NYAMAN"`.
  3. `airflowScore` mengabaikan `co2Ppm`, `pmv`, dan `ppdPct`.
  4. `totalCoolingLoadW` menjumlahkan kapasitas AC terpasang (`h.coolingCapacityW`), bukan beban pendinginan ruang.
- **Dampak**: Rekomendasi ventilasi dan beban pendinginan menyesatkan.
- **Usulan Aturan yang Benar**: Tentukan `crossVentilated` dari keberadaan minimal 2 bukaan/jalur udara berbeda arah atau kipas exhaust; pisahkan status `"AC KURANG DINGIN / PENGAP"` untuk ruang ber-AC dengan CO₂ > 1.200 ppm atau suhu > 26.5°C; masukkan penalti CO₂/PMV ke `airflowScore`; ganti label `totalCoolingLoadW` menjadi `installedCoolingCapacityW` (atau hitung beban termal ruang terpisah).

#### `BL-07` — Hardcoding Masif Layout 5×17 m di Seluruh Engine Analitik & Ekspor
- **Bukti Kode**: `rabEngine.ts:130-144, 241, 255-277, 292-301`; `sniEngine.ts:141-160, 246-276, 356-393, 461-497, 565-592`; `airflowEngine.ts:84-85, 110-152, 204`; `lightingEngine.ts:135-136, 181-209`; `floodEngine.ts:52, 98-152`; `mepNetwork.ts:141-209, 405-455`; `roofAndStairs.ts:60, 110`; `exporters.ts:69-400`.
- **Masalah**: Meskipun aplikasi memiliki Build Mode interaktif untuk menambah/menghapus dinding, ruang, bukaan, furnitur, tangga, dan `resetLotClean()`, sebagian besar engine masih memakai konstanta layout 5×17 m 2 lantai (mis. `lt2Area = 52.8 m²`, grid kolom/balok tetap, `kloset = max(3, ...)`, `shower = 3`, `wastafel = 3`, `pintu_geser = 7.5 m²`, `railing_tangga = 14.5 m1`, `skylight_glass = 2.4 m²`, `rabat_carport = 15 m²`, grid simulasi tetap `25×85`, zona banjir tetap 5 ruang, koordinat MEP `z = 16.45`).
- **Dampak**: Perubahan desain pengguna di Build Mode tidak tercermin di RAB, Struktur, Simulasi, Denah 2D, maupun PDF/Excel. Bahkan pada lahan kosong pasca `resetLotClean()`, RAB tetap puluhan juta rupiah.
- **Usulan Aturan yang Benar**: Turunkan seluruh volume RAB, pelat LT2, tangga, sanitair, skylight, pintu geser, grid simulasi, zona banjir, dan label ekspor secara dinamis dari `project.site`, `project.levels`, `rooms`, `openings`, `stairs`, `furniture`, dan `mepPoints` (jika kosong, volume = 0). Untuk struktur `sniEngine`, generate grid kolom/balok dari bounding box & dinding struktural aktual atau tandai eksplisit jika elemen masih berupa template pradesain.

#### `BL-08` — Kesalahan Geometri Dinding, Atap, Bata, & Tangga
- **Bukti Kode**: `src/lib/geometry/masonry.ts:115-132, 277`; `src/lib/geometry/rooms.ts:53-56, 147-173`; `src/lib/geometry/roofAndStairs.ts:55-133, 171, 280-291, 408-416`.
- **Masalah**:
  1. `roofAndStairs.ts:408-416`: Validasi genteng hanya error jika `slopeDeg < 5`, padahal pesannya sendiri mensyaratkan `≥ 25°` (rentang `5°–24°` lolos tanpa warning).
  2. `roofAndStairs.ts:55-57`: `partyWallLeft || partyWallRight` menghilangkan overhang **kedua sisi** sekaligus (kavling hook kehilangan overhang di sisi bebas).
  3. `roofAndStairs.ts:72-90, 102`: Elevasi `heightAt` turun di bawah `eaveElevationM` di area overhang `shed_front`/`shed_back`/`flat_deck`, dan `ridgeElevationM` pada `flat_deck` hardcoded `baseTop + 0.25` tidak cocok dengan `heightAt` (`+0.65 m`).
  4. `rooms.ts:53-56, 162, 169-173`: `polygonCentroid` memakai tengah bounding box (jatuh di luar ruang berbentuk L); `tileCount` memakai bounding box (over-estimate keramik); `netArea = Math.max(0.2, ...)` bisa menghasilkan `netArea > grossArea`.
  5. `masonry.ts:118-121, 277`: Bukaan tumpang tindih memotong luas dinding 2×; plesteran & cat (`rabEngine.ts:210, 297-298`) tetap menghitung 2 sisi penuh pada dinding batas tetangga (`partyWallSide`) dan meski `plasterBothSides === false`.
  6. `roofAndStairs.ts:171`: `headroomM` tangga tidak membaca lubang void LT2 aktual (`slabs.isVoid`).
- **Dampak**: Kuantitas bata, plester, cat, keramik, talang, dan elevasi atap meleset dari geometri riil.
- **Usulan Aturan yang Benar**: Gunakan rumus centroid poligon sejati (shoelace) dan luas poligon aktual untuk `tileCount`; pisahkan `overhangLeft` dan `overhangRight`; clamp `z` sebelum menghitung kemiringan atap; samakan aturan kemiringan genteng `< 25°` sebagai warning/error; kecualikan sisi luar `partyWall` dari plester/cat eksterior.

#### `BL-09` — Cacat Logika `scheduleEngine.ts` (EVM, Durasi Skenario, Dependensi, Kas Aktual)
- **Bukti Kode**: `src/lib/timeline/scheduleEngine.ts:150-161, 194, 269-279, 322, 349-368, 383-389`.
- **Masalah**:
  1. `scenarios.normalDays` memakai `sum(days) * 0.72` (**92 hari**), bertentangan dengan jalur kritis aktual `totalDurationDays` (**122 hari** — selisih 30 hari).
  2. `st-09` (Plesteran/Acian) tidak bergantung pada `st-06` (Kusen Pintu/Jendela) sehingga jadwal membolehkan plester sebelum kusen terpasang.
  3. EVM `pv` memakai cutoff statis `endDay <= totalDurationDays * 0.35` (bukan hari/tanggal berjalan), sehingga `SPI` selalu keliru; `ev === 0 && ac > 0` membuat `EAC` fallback ke `rab.grandTotal` (menyembunyikan cost overrun).
  4. `cumulativeActualIdr` menyebar biaya aktual merata ke minggu-minggu masa depan.
  5. `procurementItems` dipotong diam-diam `.slice(0, 5)` dan `nextStageFunding` fallback ke `stages[0]` saat semua tahap 100% selesai.
- **Dampak**: Kurva-S, CPI/SPI, dan daftar order material tidak bisa dipakai di lapangan.
- **Usulan Aturan yang Benar**: Turunkan `normalDays`/`acceleratedDays`/`rainyDays` langsung dari kalkulasi CPM aktual; tambahkan `st-06` ke dependensi `st-09`; tambahkan parameter `currentWorkDay` (atau tanggal mulai proyek) untuk menghitung `PV` EVM yang benar; hapus `.slice(0, 5)` pada pengadaan; kembalikan `null` untuk `nextStageFunding` jika semua tahap selesai.

#### `BL-10` — `exporters.ts` Tidak Lengkap, Tidak Sinkron, dan Kurang Kolom
- **Bukti Kode**: `src/lib/export/exporters.ts:34-65, 72-201, 217-345, 349-401`.
- **Masalah**:
  1. CSV kehilangan kolom `equipUnit` serta baris `overhead`, `profit`, `PPN`, `contingency`, dan upah borongan.
  2. Excel mengabaikan hasil simulasi (`lighting`, `airflow`, `flood`), tidak punya baris total BOQ, tidak mengekspor `progressPct`/`actualCost`/EVM, dan formula `ROUND(E*J, 0)` dapat selisih pembulatan dari `rabEngine`.
  3. PDF menggambar ruangan sebagai persegi bounding-box (ruang L tumpang tindih), tidak mengecek overflow halaman A4, memakai `padEnd` pada font proporsional, dan melewatkan markup RAB & warning SNI.
  4. Paket ZIP tidak menyertakan file backup `project.json`, dan penamaan file tunggal (ID) vs ZIP (EN) tidak konsisten.
- **Dampak**: Paket dokumen kontraktor tidak sesuai dengan angka di aplikasi dan kurang layak cetak/audit.
- **Usulan Aturan yang Benar**: Lengkapi kolom alat + ringkasan markup/borongan di CSV & Excel; tambahkan sheet Ringkasan Simulasi & Progres EVM di Excel; gambar poligon ruangan aktual + pagination otomatis di PDF; sertakan `project.json` di ZIP dan seragamkan penamaan file.

#### `BL-11` — Kontradiksi `buildExtras` (Kolam, Lantai Kustom, Terrain) vs RAB & Validasi
- **Bukti Kode**: `src/lib/store/useStudioStore.ts:511-519, 636-658`; `src/lib/quantities/rabEngine.ts` (tidak membaca `buildExtras`).
- **Masalah**: Pengguna bisa menggali kolam renang, mengubah elevasi tanah, dan mengecat ubin lantai di Build Mode, tetapi tidak satu pun perubahan tersebut memengaruhi RAB, struktur, atau simulasi banjir.
- **Dampak**: Pengguna yang menambahkan kolam renang mengira biayanya sudah masuk estimasi RAB.
- **Usulan Aturan yang Benar**: Integrasikan `buildExtras.pools` (galian, struktur beton kolam, waterproofing, keramik mozaik, pompa) dan `buildExtras.floorTiles` (override harga material lantai per m²) ke `rabEngine`, atau tampilkan indikator jelas jika suatu item hanya visual.

#### `BL-12` — `sniEngine.ts` Menghitung Bekisting & Tulangan Kolom 2 Lantai Penuh untuk Kolom 1 Lantai
- **Bukti Kode**: `src/lib/structure/sniEngine.ts:450, 468, 478, 528-532, 551-557, 576-579, 586`.
- **Masalah**: Beton kolom memakai `colEffHeight(c)` per kolom, tetapi bekisting (`:586`), tulangan pokok `BM-03`, sengkang `BM-05`, dan kolom praktis `BM-07` memakai tinggi total 2 lantai penuh (`colHeightTotal` / `6.8 m`). Selain itu, `FoundationElement.rebarKg` (`:450`) dihitung per pondasi tetapi tidak pernah dipakai di `bbs` maupun `totalRebarKg`.
- **Dampak**: Over-estimate kebutuhan besi tulangan dan bekisting kolom; inkonsistensi antara detail pondasi dan total besi BBS.
- **Usulan Aturan yang Benar**: Gunakan `colEffHeight(c)` secara konsisten untuk beton, bekisting, dan tulangan kolom; sambungkan `FoundationElement.rebarKg` ke `bbs` / `totalRebarKg`.

---

### B. Aturan Tidak Konsisten Antar Modul (`IN`)

| ID | Lokasi Kode | Ketidakkonsistenan | Dampak | Usulan Perbaikan |
|---|---|---|---|---|
| **`IN-01`** | `features/buildMode/store.ts:30-37` vs `useStudioStore.ts:59,78,120` vs `BuildScene.ts:789,946,985,1203` | **Split-brain state 2 store**: `neighborsVisible` vs `view.showNeighbors`, `showBricksOverlay` vs `view.showBricks/showFinishing`, `roofVisibility` vs `view.showRoof`, `activeLevel (0\|1\|2)` vs `activeLevelIndex (0\|1)` & `view.activeLevelView`. | Toggle di Outliner/Inspector dan HUD Build Mode saling menimpa atau tampak tidak berfungsi (mis. Atap `"On"` tetap hilang bila `view.showRoof` off). | Jadikan `useStudioStore` satu-satunya sumber kebenaran untuk state tampilan bersama (`showNeighbors`, `showRoof`, `showBricks`, `activeLevel`); simpan hanya state interaksi tool sementara di `useBuildModeStore`. |
| **`IN-02`** | `StudioSidePanel.tsx:178-186` vs `InspectorPanel.tsx:346-356` | **Slider `cutH` bentrok**: `StudioSidePanel` memakai `[-1.5..9.2]` (maks `9.2`, tidak pernah reset ke `100`); `InspectorPanel` memakai `[0.8..12]` (`>=11.9` = off). | Menggeser `StudioSidePanel` ke "Penuh" tetap dianggap potongan aktif `9.20 m` di `InspectorPanel`. | Hapus duplikasi kontrol `cutH`; pakai satu komponen slider dengan konstanta tunggal (`CUT_OFF = 100`, range konsisten). |
| **`IN-03`** | `simsEngine.ts:122`, `floodEngine.ts:170,189`, `rabEngine.ts:283` | **4 ambang tinggi stop kontak banjir berbeda**: `>= 0.9 m`, `>= 1.0 m`, `≥ 100 cm`, dan `≥ 110–120 cm`. | Quest lolos di 90 cm, tapi simulasi banjir menandai bahaya listrik di < 100 cm dan menyarankan ≥ 110 cm. | Definisikan 1 konstanta bersama (`SAFE_OUTLET_HEIGHT_M = 1.1` atau dinamis `max(1.0, floodDepthM + 0.2)`) dan pakai di seluruh engine. |
| **`IN-04`** | `knowledge.ts:23-144` & `StageTimelineBar.tsx` vs `scheduleEngine.ts:79-235` | **10 tahap konstruksi (statis) vs 12 tahap konstruksi (dinamis)**. | Pengguna melihat jumlah, nama, dan urutan tahap yang berbeda antara bar animasi 3D/Panduan dengan tab Jadwal/Lapangan. | Satukan ke 1 definisi `CONSTRUCTION_STAGES` (12 tahap) yang memuat metadata animasi 3D, durasi CPM, bobot RAB, dan checklist QC sekaligus. |
| **`IN-05`** | `projectModel.ts:125-155` vs `rabEngine.ts:232-252` vs `rooms.ts:175-179` | **Definisi luas lantai & `balcony`/`carport`/`garden` berbeda**: `rabEngine` memasukkan `balcony` ke luas plafon gypsum & keramik interior; `totalGrossAreaM2` memasukkan `garden` & `carport`. | Biaya per m² bangunan terdistorsi taman/carport; balkon terhitung plafon gypsum interior. | Pisahkan eksplisit `indoorFloorAreaM2`, `semiOutdoorAreaM2` (balkon/teras/carport), dan `landscapeAreaM2` (taman) di `projectModel.ts` sebagai sumber tunggal. |
| **`IN-06`** | `InspectorPanel.tsx:230-311` vs `StructureWorkspace.tsx:122-162` vs `FloodWorkspace.tsx:148-163` | **Duplikasi parameter SNI & Peil dengan batas berbeda**: `fc'` (`15–45` vs `17–40`), `fy` (`240–550` vs `240–500`), `floor1PeilM` (`max 1.5` vs `1.4`); `liveLoad` & `seismicR` hanya di Inspector. | Pengguna bingung di mana mengubah parameter dan bisa melampaui batas panel lain. | Pindahkan semua parameter SNI khusus ke `StructureWorkspace`, semua parameter peil/banjir ke `FloodWorkspace`, dan jaga 1 konstanta batas yang sama dengan `schema.ts`. |
| **`IN-07`** | `StatusBar.tsx:110-126` & `StudioSidePanel.tsx:64,101-103` | **Status badge bertentangan**: `StatusBar` bisa menampilkan badge **merah** bertuliskan `"SNI Aman"` saat `struct.overallSafe === false` dan `criticalCount === 0`; titik merah tab `Struktur` malah membaca `derived.validation` (tab `Inspeksi`). | Pengguna salah membaca kondisi keamanan struktur dan mencari error di tab yang salah. | Sinkronkan warna & teks `StatusBar` ke 1 fungsi status; arahkan titik merah tab `Struktur` ke `!struct.overallSafe` dan tab `Inspeksi` ke `criticalCount > 0`. |
| **`IN-08`** | `BuildScene.ts:825-827` vs `WalkScene.ts:462-484, 550`; `collisionBuilder.ts:162-167, 480` vs `projectHouseBuilder.ts:1727` | **Perbedaan visual, matahari, pintu, & collider antara BuildScene vs WalkScene**: WalkScene mengabaikan `orientationDeg` matahari, memaksa pintu terbuka `94%`, tidak punya collider pohon/AC outdoor, memakai ID material lama untuk suara langkah, dan menurunkan semua furnitur carport (bukan hanya kendaraan). | Cahaya dan tabrakan di Walk Mode tidak sesuai desain di Build Mode. | Bagikan helper kalkulasi arah matahari, ID material permukaan, dan elevasi objek antara `BuildScene`, `WalkScene`, dan `collisionBuilder`. |
| **`IN-09`** | `types.ts:331` vs `schema.ts:64,220,338,366` vs `useStudioStore.ts:120` | **Kontrak rentang nilai tidak seragam**: `rainIntensityMmH` (`0..120` vs `0..150`), jumlah lantai (`0..5` vs `0..3` vs `0..1`), `opening.offset` (`max 20` meski `site.depth` bisa `60`). | Data valid di satu lapisan bisa ditolak atau error di lapisan lain. | Definisikan konstanta batas tunggal di `src/lib/model/constants.ts` dan pakai bersama di `schema.ts`, store, engine, dan UI. |

---

### C. Alur Pengguna Terlalu Panjang, Berbelit, & Tombol Bermasalah (`UX`)

#### `UX-01` — Tombol "Unduh JPG" di `DeliverWorkspace` Selalu Gagal Diam-Diam
- **Bukti Kode**: `DeliverWorkspace.tsx:125-131`; `src/app/page.tsx:281-311`; `BuildWorkspace.tsx:342`; `exporters.ts:352-353`.
- **Masalah**: Saat berpindah ke tab `Ekspor`, `BuildWorkspace` di-unmount dan mengeset canvas ke `null`. Klik **"Unduh JPG"** memanggil `exportCanvasJpg(null)` yang langsung `return` tanpa mengunduh apa pun dan tanpa pesan error.
- **Usulan**: Gunakan `getSnapshotDataUrl()` (yang sudah tersimpan saat unmount untuk ZIP) sebagai fallback/sumber utama unduhan JPG, dan tampilkan toast peringatan jika snapshot belum tersedia.

#### `UX-02` — Tombol "Tampilkan Tanah Kembali" Tidak Pernah Menampilkan Tanah
- **Bukti Kode**: `StructureWorkspace.tsx:72-90`; `StudioSidePanel.tsx:190`; `BuildWorkspace.tsx:573-577`.
- **Masalah**: Ketika `view.showTerrain === false`, tombol berlabel *"Tampilkan Tanah Kembali"*, tetapi karena prop `onFocusFoundation` selalu ada, klik selalu menjalankan `onFocusFoundation()` yang mengeset `showTerrain: false`.
- **Usulan**: Pisahkan kondisi handler: jika `view.showTerrain === false`, panggil `patchView({ showTerrain: true })`; hanya panggil `onFocusFoundation()` saat `view.showTerrain === true`.

#### `UX-03` — Toggle "Overlay Pipa & Listrik" di `DrawingsWorkspace` Tidak Berfungsi di A-03 & S-01
- **Bukti Kode**: `DrawingsWorkspace.tsx:72-83, 140-143, 520, 577`.
- **Masalah**: Tombol tetap aktif dan bisa diklik di lembar `A-03` (Potongan) dan `S-01` (Struktur), padahal kedua komponen SVG tidak menerima prop `showMep`.
- **Usulan**: Sembunyikan atau nonaktifkan tombol overlay MEP saat lembar aktif adalah `A-03` / `S-01` (dengan tooltip penjelas), atau tambahkan layer MEP potongan pada `A-03`.

#### `UX-04` — 4 Lapis Hierarki Tab & Kontrol Duplikat di Banyak Lokasi
- **Bukti Kode**: `TopBar.tsx:41-50`; `StudioSidePanel.tsx:40-46, 83-110, 202-229`; `InspectorPanel.tsx:41-51`; `BuildWorkspace.tsx:620-671, 749-767`.
- **Masalah**: Pengguna menghadapi 8 tab top-level + 5 tab di `StudioSidePanel` (yang juga diduplikasi 5 tombol di Top-Left `BuildWorkspace`) + 2 sub-tab `Inspeksi` + 3 sub-tab `InspectorPanel`. Kontrol seperti `Tanah Off`/`Fokus Pondasi` muncul di 5 tempat, `explode` di 3 tempat, `setBrickPreset` di 3 tempat.
- **Usulan**: Pangkas navigasi top-level menjadi **6 workspace utama** (`Build`, `Walk`, `Denah 2D`, `RAB`, `Jadwal & Lapangan`, `Ekspor`, plus `Panduan` sebagai drawer/modal bantu), hapus duplikasi tombol tab kanan yang sudah ada di header `StudioSidePanel`, dan ratakan sub-tab `Inspeksi` maksimal 2 lapis.

#### `UX-05` — Friksi Build Mode: Default Level `Atap`, Ganti Kategori Langsung Ubah Tool, & Tidak Bisa Hapus Tangga/Kolam
- **Bukti Kode**: `features/buildMode/store.ts:76, 117-125`; `BuildWorkspace.tsx:434-443, 596-602, 1617-1653`; `BuildScene.ts:2274-2283`; `projectHouseBuilder.ts:1153-1190`.
- **Masalah**:
  1. Default awal di level `Atap` membuat pengguna yang ingin mengedit interior LT1 harus melakukan 2–3 klik dulu (ganti ke `LT 1` + ganti mode dinding `Cutaway`).
  2. Klik kategori `Dinding & Cat` / `Lantai` otomatis mengganti `activeTool` ke kuas sehingga klik tak sengaja langsung mengecat model.
  3. Klik kartu Atap langsung memutasi atap seketika (tidak konsisten dengan pola *preview-then-place*).
  4. Ada 2 sistem cat dinding berbeda di bar yang sama (`Fasad` global vs `wall_paint` per dinding).
  5. **Tangga dan kolam renang tidak bisa dihapus** lewat UI maupun `sledgehammer` (keduanya tidak ditag `pickable` sebagai `stair`/`pool`), meskipun `deleteStair` & `deletePool` ada di store.
- **Usulan**: Pertahankan `activeTool = "select"` saat sekadar menelusuri kategori (baru aktifkan tool saat kartu item dipilih); tag mesh tangga & kolam agar bisa dipilih/dihapus (serta ikut membersihkan void slab LT2 saat tangga dihapus); satukan atau bedakan visual antara cat global fasad vs cat per dinding.

#### `UX-06` — Menambah/Mengedit AC & Lampu, serta Menindaklanjuti Error `DeliverWorkspace` Memaksa Loncat Antar Tab
- **Bukti Kode**: `AirflowWorkspace.tsx:45-47, 135-154, 189-216`; `LightingWorkspace.tsx:42-44`; `DeliverWorkspace.tsx:65-99`; `StructureWorkspace.tsx:177-193`.
- **Masalah**:
  1. `AirflowWorkspace` selalu menambah AC/kipas ke LT1 `(2.5, 9.5)` (tidak bisa pilih LT2, klik berulang menumpuk di titik sama).
  2. Klik `Perbaiki` di `DeliverWorkspace` membuka `InspectorPanel` pada sub-tab default `Sistem & Bata`, bukan langsung ke sub-tab `Cek`.
  3. `reviewerName` hanya bisa diisi di `StructureWorkspace`, sementara `drawingRevision` hanya di `DeliverWorkspace`, padahal keduanya bagian dari gerbang review yang sama.
- **Usulan**: Tambahkan pemilih lantai & offset otomatis (atau tombol langsung masuk mode penempatan 3D) di `AirflowWorkspace`/`LightingWorkspace`; arahkan tombol `Perbaiki` langsung ke sub-tab validasi; satukan form *Gerbang Review Insinyur* (`engineerReviewed`, `reviewerName`, `drawingRevision`) di satu tempat (atau tampilkan lengkap di `DeliverWorkspace`).

#### `UX-07` — `CommandPalette` Tidak Berpindah Workspace Otomatis & Konflik 3 Listener `Escape`
- **Bukti Kode**: `CommandPalette.tsx:61-63, 106-139`; `src/app/page.tsx:178-183`; `BuildWorkspace.tsx:546-552`; `WalkWorkspace.tsx:276, 423`; `WalkScene.ts:691-698`.
- **Masalah**:
  1. Memicu perintah viewport/simulasi dari `CommandPalette` saat berada di `RAB`/`Jadwal`/`Ekspor` tidak memindahkan pengguna ke `Build Studio` sehingga terlihat tidak berefek.
  2. Menekan `Esc` untuk menutup `CommandPalette` di `Walk Mode` sekaligus mengeluarkan pengguna dari `Walk Mode` karena 3 listener `keydown` global berjalan bersamaan tanpa koordinasi prioritas.
  3. Di `Walk Mode` 1st-person dengan Pointer Lock aktif, `Esc` pertama hanya melepas Pointer Lock sehingga perlu 2× `Esc` untuk kembali ke Build.
- **Usulan**: Arahkan otomatis ke `build` saat perintah visual 3D dipicu dari `CommandPalette`; satukan penanganan `Escape` dalam satu hirarki prioritas (`CommandPalette` → `Modal` → `Pointer Lock` → `Selected` → `StudioSidePanel` → `Walk -> Build`).

#### `UX-08` — `StudioNumberField` Mengunci Ketikan Pengguna per Keystroke
- **Bukti Kode**: `src/components/ui/StudioPrimitives.tsx:256-267`; `InspectorPanel.tsx:144-150`; `RabWorkspace.tsx:121-126`.
- **Masalah**: Clamping `Math.max(min, v)` dijalankan pada setiap `onChange`. Saat `min={80}`, mengetik `200` (dimulai dari digit `2`) langsung dikunci jadi `80`. Selain itu, `max` diabaikan jika `min` tidak diisi.
- **Usulan**: Biarkan pengguna mengetik bebas di state string lokal, lalu lakukan parse, cek `Number.isFinite`, dan clamp `min`/`max` (secara independen) pada `onBlur` atau `Enter`.

#### `UX-09` — 5 Aksi Destruktif Tanpa Dialog Konfirmasi
- **Bukti Kode**: `TopBar.tsx:212-218` (Reset Desain), `RabWorkspace.tsx:136-142` (Reset Harga), `AirflowWorkspace.tsx:225-232` (Hapus HVAC), `SiteModeWorkspace.tsx:93-104` (Reset Progres 100%→0%), `src/app/page.tsx:220-244` (Import JSON menimpa proyek aktif).
- **Masalah**: Satu klik tak sengaja langsung menghapus seluruh perubahan/harga kustom/proyek aktif tanpa peringatan.
- **Usulan**: Tambahkan dialog konfirmasi seragam untuk aksi reset/impor/hapus permanen, atau sediakan toast dengan tombol *"Urungkan (Undo)"* untuk aksi yang dapat di-undo.

#### `UX-10` — Walk Mode: Interaksi `[E]` Tembus Dinding & Mencemari Undo, `KeyT` Re-bind Tiap Render, Kontrol Putar Asimetris
- **Bukti Kode**: `WalkController.ts:367-382, 423-433`; `WalkScene.ts:515-528, 653-661, 813`; `WalkWorkspace.tsx:87, 134-148`.
- **Masalah**:
  1. `[E]` memilih pintu terdekat secara 2D tanpa cek garis pandang (bisa membuka pintu di balik tembok), dan memutasi `useStudioStore` permanen sehingga masuk stack Undo dan memicu full rebuild mesh + collider.
  2. `useEffect` listener `KeyT` tidak memiliki dependency array sehingga dipasang-lepas berkali-kali tiap detik.
  3. Pengecekan lereng curam `WalkController.ts:372-382` tidak pernah aktif karena kondisi `if (deltaY > stepHeight)` sudah tertangkap blok sebelumnya.
- **Usulan**: Simpan status buka/tutup pintu sementara di state lokal `WalkScene` (dengan raycast/dot-product arah pandang) tanpa memutasi `project`/Undo; tambahkan dependency array pada `KeyT`; perbaiki logika cek lereng curam.

#### `UX-11` — Dua Sistem Toast Bersamaan & Panel Overlay Tidak Mati Saat Ditutup
- **Bukti Kode**: `src/app/layout.tsx:27` (`sonner`) vs `src/app/page.tsx:329-339` (toast kustom); `useStudioStore.ts:212-229`.
- **Masalah**: Kedua sistem toast muncul di pojok kanan bawah dan saling menumpuk. Selain itu, membuka tab `Cahaya`/`Udara`/`Banjir` menyalakan overlay 3D otomatis, tetapi menutup panel membiarkan overlay (mis. air banjir/heatmap) tetap menyala di kanvas.
- **Usulan**: Hapus toast kustom di `page.tsx` dan gunakan `sonner` secara tunggal; sediakan opsi/perilaku bersih untuk mematikan overlay simulasi (atau menampilkan chip indikator aktif dengan tombol "Matikan" di HUD).

---

### D. Fitur Tumpang Tindih, Setengah Jadi & Dead Code (`DC`)

1. **`DC-01` — `level.mepRoutes` & `brickSpec.depthMm` Tidak Terpakai**: Ratusan baris `mepRoutes` di `defaultProject.ts:1175-1232, 1694-1732` tidak pernah dibaca (`mepNetwork.ts` meregenerasi dari nol); `brickSpec.depthMm` tidak pernah dipakai di kalkulasi volume bata. → *Usulan*: Hapus `mepRoutes` dari model/defaultProject (atau jadikan opsional murni override) dan dokumentasikan/hapus `depthMm` jika identik dengan `outerThicknessMm`.
2. **`DC-02` — Metrik EVM `Actual Cost (AC)` & `CPI` Tanpa Input UI**: `TimelineWorkspace.tsx:62-73` menampilkan `AC`, `CPI`, dan `EAC`, tetapi tidak ada input untuk mengisi `actualCostIdr` di seluruh aplikasi sehingga `AC` selalu `Rp 0` dan `CPI` selalu `1.00`. → *Usulan*: Tambahkan input `Biaya Aktual (Rp)` per tahap di `TimelineWorkspace` agar fitur EVM benar-benar berfungsi.
3. **`DC-03` — `SiteModeWorkspace` Tumpang Tindih dengan `TimelineWorkspace`**: Keduanya mengedit `stageProgress[id].progressPct`, tetapi `SiteMode` hanya tombol biner `0%/100%`. → *Usulan*: Gabungkan ke `TimelineWorkspace` sebagai mode tampilan *"Mode Lapangan (Sentuh)"* agar progres & QC berada di satu tempat.
4. **`DC-04` — `PartInfoPanel.tsx:28-91` (64 Baris Dead Code)**: Menangani `furniture`, `hvac`, `light`, `opening`, dan `wall`, tetapi pemanggilnya di `BuildWorkspace.tsx:1730` membatasi hanya `selected?.kind === "part"`. → *Usulan*: Bersihkan cabang tak terpakai atau satukan dengan inspector kontekstual objek terpilih.
5. **`DC-05` — Fitur Setengah Jadi (`Before/After Split`, `Gamification`, `Snapshots`, `Props Fallback`)**:
   - `beforeAfterSplit` (`useStudioStore.ts:80`) hanya tampil sebagai bar teks RAB tanpa split-screen 3D.
   - `StatusBar` menampilkan skor & lencana gamifikasi sebagai `<span>` statis tanpa modal detail.
   - `db.snapshots` (`db.ts:50-63`) terus menumpuk tanpa batas retensi dan `listProjectSnapshots` tidak pernah dipakai di UI.
   - Furnitur `coffee_table`, `fridge`, `desk` tidak punya mesh di `propsBuilder.ts` (dirender kotak polos).
   - *Usulan*: Selesaikan UI manajemen Snapshot (lihat/restore/hapus + batas retensi mis. 20 snapshot) dan popover lencana/misi, hapus state `beforeAfterSplit` yang tidak dipakai (atau jadikan murni komparasi RAB), serta lengkapi 3 mesh furnitur tersebut.
6. **`DC-06` — Dead Exports & Listener Bocor**: `walls.ts` (`computeWallMetrics`, `openingCutArea`, `wallPointAt`), `useStudioStore.ts` (`activeLevelIndex`, `dockOpen`, `completeQuest`, `DEFAULT_VIEW_STATE`), `BuildToolId` (`floor_rect`, `floor_fill`), `BuildScene.ts:457` (`pointerleave` tidak dibersihkan saat `dispose()`), `WalkScene.ts:71,906` (`qualityOverride` diabaikan DPR governor), `BUILD_MODE_MIGRATION.md` (masih menyebut file lama yang sudah dihapus). → *Usulan*: Hapus seluruh dead code, perbaiki cleanup listener & `qualityOverride`, serta perbarui dokumentasi.
7. **`DC-07` — Label & Data Statis/Terpotong Diam-Diam di UI**: `"Total Beton K-250"` hardcoded meski `fc'` diubah (`StructureWorkspace.tsx:102`, `SiteModeWorkspace.tsx:65`); `OutlinerPanel.tsx:37` hardcode `"20 Anak Tangga"` & `"3,60 m"`; `StructureWorkspace.tsx:242` memotong `columns.slice(0, 12)` dan `DrawingsWorkspace.tsx:550` memotong `foundations.slice(0, 7)` tanpa indikator; `parts.ts` & `knowledge.ts` hardcode narasi 5×17 m. → *Usulan*: Jadikan seluruh label dinamis dari state proyek dan tampilkan semua baris (atau beri tombol *"Lihat semua N item"*).
8. **`DC-08` — Gerbang Final `DeliverWorkspace` Tidak Memvalidasi `reviewerName`**: `DeliverWorkspace.tsx:30-34` meloloskan status `"Siap Terbit Final (4/4)"` walau `reviewerName` kosong. → *Usulan*: Wajibkan `engineerReviewed && reviewerName.trim().length > 0 && drawingRevision.trim().length > 0`.

---

### E. Edge Case Tidak Tertangani & Data Bisa Masuk Keadaan Tidak Valid (`EC`)

#### `EC-01` — Crash Langsung (`TypeError`) pada Desain 1 Lantai (`levels.length === 1`)
- **Bukti Kode**: `airflowEngine.ts:88, 219`; `lightingEngine.ts:145, 168, 172, 234`; `exporters.ts:275, 302`; `roofAndStairs.ts:49`; `mepNetwork.ts:236, 260`.
- **Masalah**: Non-null assertion `levels[1]!` langsung melempar exception saat proyek hanya memiliki 1 lantai. Sebaliknya, pada ≥ 3 lantai (yang diizinkan `schema.ts:220`), `projectModel.ts:84` menduplikasi rute MEP LT2.
- **Usulan**: Gunakan optional chaining (`levels[1]`) di seluruh engine & exporter agar 1 lantai berjalan mulus tanpa crash, dan selaraskan batas `levelSchema.index` dengan jumlah lantai yang benar-benar didukung.

#### `EC-02` — Autosave Menimpa & Menghapus Permanen Data Lama / Corrupt di IndexedDB
- **Bukti Kode**: `src/app/page.tsx:88-101, 115-124`; `src/lib/store/db.ts:36`; `src/lib/model/schema.ts:392-417`.
- **Masalah**: Saat `loadLatestProject()` mendeteksi save `legacy_ignored` (v1) atau `invalid`, aplikasi memuat default project dengan `id` yang sama (`"rumah-5x17-surabaya"`), lalu 600 ms kemudian autosave memanggil `db.projects.put()` dan **menimpa record lama di IndexedDB secara permanen tanpa backup** (dan tanpa toast jika statusnya `invalid`). Selain itu, `schemaVersion` bertipe string `"2"` salah dideteksi sebagai v1, dan `gamification.mode` masih punya transform `"simple" -> "pro"` yang tidak tercapai oleh v1.
- **Usulan**: Sediakan migrator eksplisit `migrateProjectSave(raw)` (v1 → v2 → v3) yang mempertahankan data kompatibel; bila benar-benar corrupt/tidak terbaca, **pindahkan record asli ke tabel backup/quarantine di IndexedDB** dan tampilkan toast + opsi unduh raw JSON sebelum menulis proyek default baru.

#### `EC-03` — Stack Undo (`zundo`) Tercemar Klik UI, Efek Samping Panel Banjir, & Startup
- **Bukti Kode**: `src/lib/store/useStudioStore.ts:221-226, 244-249, 279-290, 405-422, 679-682`; `BuildWorkspace.tsx:1211-1217`.
- **Masalah**:
  1. `temporal()` tidak memakai opsi `equality`, sehingga setiap aksi UI (`setWorkspace`, `setSelected`, `patchView`, `toggleHiddenPart`, dll.) mendorong salinan `project` identik ke `pastStates` (kuota 60 undo cepat penuh dan `Ctrl+Z` terasa macet).
  2. `loadProject` di startup tidak membersihkan `temporal.clear()`, sehingga menekan `Ctrl+Z` setelah buka aplikasi menghapus seluruh proyek tersimpan kembali ke default; `loadProject` juga tidak mereset `baselineProject`.
  3. Membuka tab `Banjir` memutasi `project.simulation` → masuk stack Undo.
  4. Tombol `"Semua Sejenis"` di `BuildWorkspace` memanggil `updateFurniture` dalam loop → menciptakan N entry Undo sekaligus.
  5. Preferensi `soundEnabled` ada di dalam `project` sehingga ikut ter-undo tanpa sinkronisasi ke `simsAudio`.
- **Usulan**: Tambahkan `equality: (past, curr) => past.project === curr.project` di `temporal()`; panggil `temporal.getState().clear()` & update `baselineProject` di `loadProject`/`resetProject`; pisahkan `soundEnabled` ke UI preference (localStorage); sediakan batch action `updateFurnitureBatch`; hentikan mutasi `project` diam-diam saat membuka tab Banjir.

#### `EC-04` — Mutasi Store Tanpa Validasi Zod & Rentan `NaN` / `Infinity` / Nilai Negatif
- **Bukti Kode**: `src/lib/store/useStudioStore.ts:296-658`; `src/lib/model/schema.ts:145, 257-262, 372-382`; `src/lib/geometry/masonry.ts:89-90`; `src/lib/structure/sniEngine.ts:255, 266, 278`; `src/app/page.tsx:202-214`.
- **Masalah**:
  - `updatePriceItem`/`setBudgetCap` tidak memfilter `NaN`/`Infinity`.
  - `furnitureSchema.size` mengizinkan ukuran `<= 0`; `peil` tidak memvalidasi urutan elevasi (`street <= carport <= terrace <= floor1`); `pools` tidak memvalidasi `gx1 < gx2`.
  - `masonry.ts` bisa masuk *infinite loop* jika `lengthMm/heightMm = 0` & `mortarMm = 0`; `sniEngine.ts` menghasilkan `Infinity`/util negatif (lolos `<= 0.92`) jika `seismicR = 0` atau `fc' <= 0`.
  - Export JSON tidak memvalidasi skema sebelum unduh (`NaN` menjadi `null` dan gagal di-import balik).
- **Usulan**: Tambahkan sanitizer/validator terpusat di aksi store (menolak `NaN`/`Infinity`, enforce `min`/`max` & urutan peil), perketat `schema.ts` (`.positive()` untuk dimensi, `.refine()` untuk urutan peil & batas bukaan terhadap dinding), guard division-by-zero di `masonry.ts` & `sniEngine.ts`, dan validasi JSON sebelum export.

#### `EC-05` — Entitas Yatim (*Orphan Entities*) & Dangling `selected`
- **Bukti Kode**: `src/lib/store/useStudioStore.ts:451-469, 521-547`; `BuildWorkspace.tsx` (Undo pasca tambah objek).
- **Masalah**:
  - `deleteStair()` tidak menghapus slab void `slab-void-${stair.id}` di LT2.
  - `deleteWall()` tidak mereset `selected` bila pengguna memilih `opening` di dinding tersebut, dan tidak melepas/memperingatkan objek `wall`-mounted (AC split, kipas, lampu dinding).
  - `updateWall()` tidak meng-clamp/memvalidasi `w.openings` saat dinding diperpendek.
  - Undo setelah `addFurniture`/`addLight`/`addHvac` menyisakan `selected` menunjuk ke ID yang sudah dihapus.
- **Usulan**: Bersihkan void tangga otomatis di `deleteStair`, bersihkan/clamp bukaan & reset `selected` di `deleteWall`/`updateWall`, serta tambahkan helper reconciler `selected` pasca Undo/Redo.

#### `EC-06` — Celah Validasi Penempatan & Drag 3D di Build Mode
- **Bukti Kode**: `BuildScene.ts:966-974, 1494-1586, 1642-1757, 1858-1859, 1941-1973, 2045-2264`; `geometryUtils.ts:172-289`; `BuildWorkspace.tsx:471-505`.
- **Masalah**:
  1. Saat `activeLevel === 2` (`Atap`), preview melayang di elevasi atap (~7.7 m), tapi objek disimpan ke `levels[1]` (LT2).
  2. Bukaan (`opening`) tidak memvalidasi `sill + height <= wall.height` — pintu 2.15 m bisa dipasang melayang di atas **pagar 1.2 m**; sebaliknya roster di atas pintu ditolak karena cek overlap hanya 1D.
  3. Furnitur/HVAC/lampu hanya dicek titik pusat `(px, pz)` dengan margin `0.08 m` tanpa `sizeM` — mobil atau sofa bisa menembus dinding dan keluar kavling ke rumah tetangga, atau ditaruh melayang di atas void LT2 / menempel di sisi lemari.
  4. Drag objek LT1 saat kamera di LT2/Atap gagal menemukan item (`lvIdx` diambil dari `activeLevel`, bukan `hitRes.sel.levelIndex`).
  5. `handleDuplicateSelected` meng-hardcode `Math.min(4.6, x + 0.6)` tanpa cek lebar kavling/tabrakan.
  6. Kolam renang & ruangan baru bisa ditaruh menimpa ruang tamu, tangga, atau dinding eksisting.
- **Usulan**: Kunci penempatan objek interior saat `activeLevel === 2` (atau otomatis arahkan ke `LT 2` dengan indikator jelas); tambahkan validasi 2D (`offset` & `sill+height <= wall.height`) untuk bukaan; validasi footprint `sizeM` terhadap batas kavling, pelat lantai/void, dan dinding; ambil `levelIndex` dari `hitRes.sel.levelIndex` saat drag.

#### `EC-07` — Sinkronisasi Searah (`Math.max`) pada Tinggi Stop Kontak & MCB
- **Bukti Kode**: `src/lib/store/useStudioStore.ts:350-354`; `src/lib/geometry/mepNetwork.ts:109`.
- **Masalah**: Menaikkan `outletHeightM` menaikkan titik stop kontak fisik, tetapi menurunkannya kembali tidak pernah menurunkan titik tersebut karena memakai `Math.max`.
- **Usulan**: Terapkan nilai `patch.outletHeightM` langsung pada titik stop kontak lantai 1 (kecuali titik yang punya override manual).

#### `EC-08` — Lot Kosong (`resetLotClean`) Menghasilkan Skor & Warning Palsu
- **Bukti Kode**: `useStudioStore.ts:660-677`; `lightingEngine.ts:307,323`; `airflowEngine.ts:347,365`; `simsEngine.ts:46-47`; `roofAndStairs.ts:371-379`.
- **Masalah**: Pada lot kosong (0 ruang, 0 dinding), `lightingEngine` memberi kepatuhan SNI 100%, `airflowEngine` memberi `crossVentPct = 100%`, `simsEngine` memberi `spaceEfficiency = 90%`, `resetLotClean` tidak mereset `stageProgress`/`siteChecklistDone`, dan `rabEngine` tetap menghitung puluhan juta rupiah.
- **Usulan**: Tangani explicit empty-state (`rooms.length === 0`) di seluruh engine (skor `0` / status `"Belum Ada Desain"`, RAB `0`, tanpa warning rasio jendela palsu) dan reset progres proyek di `resetLotClean`.

#### `EC-09` — Celah Besar Cakupan Test (`src/tests/engines.test.ts`)
- **Bukti Kode**: `src/tests/engines.test.ts:15-344`.
- **Masalah**: Hanya ada 8 skenario test dengan assertion sangat longgar (`grandTotal > 200_000_000`). 0% cakupan untuk `exporters.ts`, `borongan_pct`, override harga, kombinasi struktur gagal (`PERIKSA`), EVM/progres jadwal, rumah 1 lantai, lot kosong, dan guard division-by-zero.
- **Usulan**: Setelah perbaikan, tambahkan unit test komprehensif untuk setiap aturan bisnis yang diperbaiki (invariant RAB/borongan/jadwal, SNI kolom gagal, banjir terendam skor rendah, 1 lantai tanpa crash, lot kosong, migrasi save v1/v2, undo equality, dan ekspor CSV/Excel/PDF).

---

## 3. Rencana Migrasi Data & Skema (Bila Disetujui)

Untuk menjaga data pengguna yang sudah tersimpan di IndexedDB maupun file `.json` ekspor lama:
1. **Naikkan versi skema menjadi `CURRENT_PROJECT_SCHEMA_VERSION = 3`** (atau pertahankan `2` dengan migrator *forward-compatible*):
   - **Migrasi v1 → v2/v3**: Alih-alih langsung membuang save v1 (`legacy_ignored`), konversi field proyek inti (`site`, `systems`, `brickSpec`, `peil`, `soil`, `rabSettings`, `priceBook`, `levels`, `stageProgress`) dengan mengisi default aman untuk properti baru (`buildExtras`, `floodMitigation`, `structuralParams`).
   - **Karantina Save Corrupt**: Jika JSON/IndexedDB benar-benar tidak dapat diparsing, simpan salinan mentah ke tabel `db.backups` (atau key terpisah) sebelum memuat default, sehingga autosave tidak pernah menghancurkan data pengguna.
   - **Pembersihan Field Mati**: Terima `level.mepRoutes` dan `gamification.mode = "simple"` secara opsional saat parsing import lama lalu strip saat normalisasi, sehingga file JSON lama tetap 100% bisa dibuka.
   - **Migrasi `soundEnabled`**: Pindahkan preferensi audio ke `localStorage` sambil tetap menerima field lama di JSON tanpa error.

---

## 4. Pertanyaan Klarifikasi (Maks. 3 — Aturan Bisnis Ambigu)

Mohon konfirmasi untuk 3 keputusan produk berikut (jika tidak ada preferensi khusus, saya akan memakai **Asumsi Default** yang tertulis):

1. **Cakupan Ukuran Kavling & Jumlah Lantai**: Apakah aplikasi memang ditujukan untuk mendukung **kavling & denah dinamis (1–2 lantai, ukuran bebas)** dari Build Mode, atau memang dikunci khusus untuk studi kasus kavling 5×17 m 2 lantai?
   - *Asumsi Default*: Mendukung **kavling dinamis 1–2 lantai** — seluruh engine (RAB, Struktur, Simulasi, Denah 2D, Ekspor) dibuat membaca geometri & ukuran kavling aktual tanpa hardcode 5×17 m, dan skema dibatasi 1–2 lantai agar konsisten.
2. **Penyederhanaan Workspace (`Lapangan / Site Mode`, `Panduan`, & `Gamifikasi`)**: Apakah Anda setuju menggabungkan `SiteModeWorkspace` ke dalam `TimelineWorkspace` (sebagai toggle *"Mode Lapangan"* dengan 1 sumber 12 tahap), mengubah `GuideWorkspace` menjadi drawer bantuan kontekstual, dan menambahkan popover detail untuk skor/lencana (atau menghapus gamifikasi dari `StatusBar`)?
   - *Asumsi Default*: Gabungkan `SiteMode` ke `Timeline`, jadikan `Guide` drawer bantuan, dan ubah indikator gamifikasi di `StatusBar` menjadi popover detail misi/lencana yang sinkron dengan kelayakan teknis sebenarnya.
3. **Status Pintu Walk Mode (`[E]`) & Kolam/Lantai Kustom (`buildExtras`) di RAB**:
   - Apakah buka/tutup pintu `[E]` di Walk Mode sebaiknya hanya **sementara di sesi jalan** (tidak mengubah desain permanen / Undo)?
   - Apakah `buildExtras` (kolam renang & ubin lantai kustom di Build Mode) harus **masuk perhitungan RAB** (atau cukup visual dengan label *"belum termasuk RAB"*)?
   - *Asumsi Default*: Pintu Walk Mode bersifat sesi lokal (tidak masuk Undo), sedangkan `buildExtras` (kolam & lantai kustom) bisa dipilih/dihapus dan masuk perhitungan RAB.

---

> **Status Tahap Audit: SELESAI — MENUNGGU PERSETUJUAN.**
> Silakan nyatakan temuan mana (`BL-01..12`, `IN-01..09`, `UX-01..11`, `DC-01..08`, `EC-01..09`) yang **disetujui**, **ditolak**, atau **diubah**, serta jawaban atas 3 pertanyaan di atas sebelum eksekusi perbaikan dimulai.
