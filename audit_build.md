# Audit Mendalam Build Mode (Tolok Ukur: The Sims 4 Build/Buy Mode) — Gomahan

> **Catatan Konteks:** Dokumen ini adalah pendalaman khusus mekanisme **Build Mode** pada codebase `gomahan` dengan tolok ukur ergonomi, topologi ruangan, dan aturan interaksi **The Sims 4 Build/Buy Mode**. Pada tahap ini **belum ada kode, skema, atau data yang diubah** — seluruh temuan (`BM-01` s.d. `BM-18`) menunggu persetujuan sebelum eksekusi.

---

## 1. Ringkasan Kesenjangan vs The Sims 4 Build/Buy Mode

Di The Sims 4, **ruangan (*room*) adalah unit primer yang hidup**: menggambar dinding tertutup otomatis membentuk ruangan (lantai + plafon + deteksi interior/eksterior), dinding dapat ditarik (*push-pull*) untuk memperbesar/memperkecil ruangan, cat dinding bekerja per sisi (*interior vs eksterior* / *room vs single*), bukaan memotong dinding secara 2D, objek memiliki *footprint* & *slot snapping*, dan *wall cutaway* menurunkan dinding secara cerdas di sekitar pandangan kamera.

Di `gomahan` saat ini, Build Mode masih bekerja sebagai **kumpulan primitif terpisah yang tidak saling mengenal**:

| Pilar The Sims 4 | Kondisi Saat Ini di `gomahan` | Keparahan |
|---|---|---|
| **Topologi Ruangan & Dinding** | 4 struktur data terpisah (`lv.rooms`, `lv.walls`, `lv.slabs`, `buildExtras.floorTiles`) tanpa wall-graph, tanpa *auto-room*, tanpa *push-pull*, tanpa `updateRoom`/`deleteRoom`. | **Kritis** |
| **Wall Cutaway & Visibilitas** | Bata `InstancedMesh` & kolom beton tetap berdiri 3.6 m saat `Cutaway`/`Rendah`; `rec.exterior` tidak dipakai; cutaway hanya `dot` dari pusat kavling. | **Kritis** |
| **Cat Dinding & Lantai** | Cat dinding hanya 1 sisi & tanpa mode *room*; bug `"wall_ext_ivory"`; mode lantai `fill` **preview vs commit tidak sama**; `floorTiles` menonjol & Z-fighting di atas `lv.rooms`. | **Kritis** |
| **Bukaan (Pintu/Jendela/Roster)** | Pagar (`fence`) disimpan di `lv.walls` + tidak ada cek tinggi vertikal → pintu/roster bisa dipasang di pagar 1.2 m; overlap hanya 1D → roster di atas pintu ditolak; bukaan tidak bisa digeser. | **Tinggi** |
| **Furnitur / HVAC / Lampu** | Drag 60fps sudah bagus, tapi **zero AABB collision**, clamp pusat saja (tembus dinding/kavling), *surface-stacking* tanpa filter, **bug elevasi + drag saat `activeLevel === 2` (Atap)**. | **Tinggi** |
| **Tangga, Atap, Kolam, Terrain** | **Tangga & Kolam tidak bisa dihapus dari 3D**; void tangga LT2 tidak melubangi slab 3D; railing LT2 & atap hardcoded; klik Atap langsung mutasi; terrain tidak live saat drag. | **Tinggi** |
| **Alat, Hotkey & UX Muscle Memory** | Default level `Atap` + dinding `Penuh`; ganti kategori langsung ubah tool; konflik hotkey (`B`, `E`, dual `Esc`); Sledgehammer tanpa drag-box; Eyedropper parsial; feedback merah tanpa alasan. | **Tinggi** |
| **Performa Edit Interaktif** | `buildSignature` memuat `project.updatedAt` → ganti jam matahari, cat fasad, atau selesai drag 1 kursi memicu **FULL REBUILD** seluruh rumah + BVH + bata + recompile lampu. | **Tinggi** |

---

## 2. Daftar Temuan Mendalam (`BM-01` s.d. `BM-18`)

### A. Topologi Ruangan, Dinding & Pelat Lantai

#### `BM-01` — Fragmentasi 4 Lapisan Data Ruangan Tanpa Wall-Graph & Auto-Room Detection
- **Bukti Kode**: `src/lib/model/types.ts:120-163, 364-369`; `src/lib/store/useStudioStore.ts:424-469, 501-519`; `src/features/buildMode/BuildScene.ts:2052-2110`; `src/lib/geometry/rooms.ts:53-101`.
- **Masalah**:
  1. `lv.rooms` (poligon statis), `lv.walls` (segmen lepas), `lv.slabs` (pelat LT2 statis), dan `buildExtras.floorTiles` (grid 0.5 m) berdiri sendiri-sendiri.
  2. Menggambar dinding tertutup dengan `wall_straight`/`wall_diagonal` **tidak membentuk `Room` atau lantai**.
  3. Membelah ruangan lama dengan dinding baru **tidak memecah `room.polygon`**; menghapus dinding pemisah (`deleteWall`) **tidak menghapus atau menggabungkan `lv.rooms`** (lantai tetap melayang tanpa dinding).
  4. Tidak ada *wall splitting* (T-junction) maupun *collinear merge*; deduplikasi `addRoomAndWalls` (`useStudioStore.ts:437-445`) hanya mengecek kesamaan 2 ujung `< 0.08 m`, sehingga tumpang-tindih parsial membuat dinding ganda (Z-fighting & dobel hitung RAB).
  5. Menambah ruangan di LT2 (`addRoomAndWalls`) tidak membuat `Slab` struktural LT2 maupun plafon gypsum LT1.
  6. `rooms.ts:92-101` mendeteksi hubungan dinding-ruangan hanya dengan mengecek titik tengah *edge* ruangan, sehingga gagal saat dinding terpecah beberapa segmen.
- **Dampak**: Pengguna tidak bisa merombak tata ruang secara bebas seperti The Sims 4; dinding, lantai, plafon, dan RAB cepat kehilangan sinkronisasi.
- **Usulan Aturan & Arsitektur**: Bangun modul **Planar Wall-Graph & Room Solver** (`reconcileLevelTopology(level)`): setiap kali dinding ditambah/diubah/dihapus, pecah segmen di T-junction, gabungkan segmen kolinear identik, deteksi siklus tertutup (*minimal cycles*) untuk menghasilkan/memperbarui `lv.rooms` & `lv.slabs` LT2 secara otomatis (sambil mempertahankan nama/program/material ruangan yang overlap terbesar), serta tentukan `wall.exterior` otomatis dari apakah dinding berbatasan dengan 1 ruangan (`exterior = true`) atau 2 ruangan (`exterior = false`).

#### `BM-02` — Ruangan Tidak Bisa Dipilih, Digeser, Di-resize (*Push-Pull*), atau Dihapus
- **Bukti Kode**: `src/lib/store/useStudioStore.ts:45-52, 161-186`; `src/features/buildMode/BuildScene.ts:1941, 1975-1978`.
- **Masalah**: `SelectionTarget` tidak memiliki `kind: "room"`, dan store tidak punya `updateRoom` atau `deleteRoom`. Tidak ada gizmo panah *push-pull* pada dinding untuk menggeser/memperlebar ruangan seperti The Sims 4.
- **Dampak**: Untuk menggeser 1 dinding kamar sebesar 0.5 m, pengguna harus menghapus dinding lama, menggambar ulang dinding baru, memasang ulang pintu/jendela, dan mengecat ulang — padahal di Sims 4 cukup 1 drag panah.
- **Usulan Aturan**: Tambahkan `kind: "room"` pada `SelectionTarget` (klik lantai ruangan untuk memilih ruangan, ganti nama/program/material lantai, atau hapus ruangan), serta tambahkan **Wall Drag Handle (*Push-Pull*)** saat dinding/ruangan dipilih agar dinding dapat digeser tegak lurus dengan mempertahankan bukaan yang menempel padanya.

#### `BM-03` — `fence` Menyamar sebagai `Wall` & Status `exterior` Dinding Keliru
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:2055-2065, 2087`; `src/lib/scene/projectHouseBuilder.ts:1335`.
- **Masalah**:
  1. `fence` disimpan langsung di `lv.walls` (`height: 1.2`, `thickness: 0.08`, `exterior: true`), sehingga ikut menjadi target snap pintu/jendela, ikut perhitungan bata/plester dinding, dan tidak dibedakan dari dinding struktural.
  2. `wall_straight`/`wall_diagonal` selalu memaksa `exterior: true` (meski dipakai membuat sekat interior kamar), sedangkan `wall_room` selalu memaksa `exterior: false` (meski berada di batas luar bangunan).
- **Dampak**: Sekat kamar ikut berubah warna saat fasad diganti, ikut memanjang ke atas mengikuti kemiringan atap, dan memakai ketebalan dinding luar.
- **Usulan Aturan**: Tambahkan properti eksplisit `kind: "wall" | "fence"` (atau array terpisah `lv.fences`) agar pagar tidak menerima bukaan pintu/jendela dinding dan tidak dihitung sebagai dinding bata penuh; turunkan `exterior` secara otomatis dari topologi ruangan (`BM-01`).

---

### B. Wall Cutaway & Visibilitas Lantai

#### `BM-04` — Bata `InstancedMesh` & Kolom Beton Menembus Mode `Cutaway` / `Rendah`
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:989, 1211-1256`; `src/lib/store/useStudioStore.ts:93`; `src/lib/scene/projectHouseBuilder.ts:941-1010, 1257-1302, 1485-1552`.
- **Masalah**:
  1. `DEFAULT_VIEW_STATE.showBricks` bernilai `true`. Namun `InstancedMesh` bata (`1257-1302`) dan kolom beton (`941-1010`) **tidak masuk `wallCutawayRecords`**. Saat pengguna mengaktifkan `Cutaway` atau `Rendah`, kulit plester turun jadi 44 cm/22 cm, tetapi **tumpukan bata 3D dan kolom tetap menjulang 3.6 m menutupi seluruh ruangan**.
  2. Logika `cutaway` (`BuildScene.ts:1239-1255`) mengabaikan `rec.exterior` yang sudah disiapkan dan hanya memakai `dot > 0.25` dari pusat kavling `(2.5, 8.5)` — sehingga dinding tengah kavling tetap menghalangi, dan dinding LT1/LT2 tidak dibedakan berdasarkan lantai aktif.
  3. Saat cutaway, `opGroup` (pintu/jendela) hilang total tanpa penanda ambang pintu.
- **Dampak**: Mode `Cutaway` dan `Rendah` — fitur paling esensial di Sims 4 untuk menata interior — praktis terhalang oleh bata & dinding tengah.
- **Usulan Aturan**:
  1. Sembunyikan/klip `InstancedMesh` bata & kolom pada dinding yang sedang di-cutaway/down (atau hanya tampilkan bata penuh saat mode *Inspect Bata* aktif).
  2. Perbaiki rumus `cutaway` ala Sims 4: hitung vektor dari **target kamera aktif** (`cameraTarget`, bukan pusat kavling), turunkan dinding `exterior` yang menghadap kamera (`dot > 0.05`) serta dinding interior yang memisahkan kamera dari ruangan target pada `activeLevel`, sambil mempertahankan dinding belakang tetap penuh agar lukisan/AC/jendela belakang terlihat.
  3. Tampilkan kusen/ambang bawah pintu tipis pada `cutawayGroup`/`downGroup` agar posisi pintu tetap terbaca.

---

### C. Pengecatan Dinding & Lantai

#### `BM-05` — Cat Dinding Hanya 1 Sisi, Tanpa Mode *Room*, & Bug `"wall_ext_ivory"`
- **Bukti Kode**: `src/lib/model/types.ts:120-131`; `src/features/buildMode/BuildScene.ts:1604-1634, 2268-2273`; `src/lib/scene/projectHouseBuilder.ts:526-532, 1328-1367`; `src/features/buildMode/projectCatalog.ts:69-78`.
- **Masalah**:
  1. `Wall` hanya memiliki 1 `materialId` dan dirender dengan 1 `ExtrudeGeometry` bermaterial tunggal — mengecat dinding kamar mandi atau kamar tidur otomatis mengecat sisi sebelahnya (kamar lain atau fasad luar).
  2. Tidak ada mode *"Cat Seluruh Ruangan"* (`Shift+Click` atau toggle `Room / Wall` seperti lantai).
  3. Item katalog `"Plester Ivory Hangat"` (`materialId: "wall_ext_ivory"`) tidak terdaftar di `CUSTOM_PAINT_HEX` (`projectHouseBuilder.ts:526-532`), sehingga mengecat dinding dengan item ini justru me-reset ke cat fasad/interior global.
  4. Bar kontekstual di tab `Dinding & Cat` (`BuildWorkspace.tsx:1617-1634`) mencampur swatch global `"Fasad:"` (`simulation.paintExtHex`) dengan kartu `wall_paint` per-dinding tanpa penjelasan bahwa dinding yang sudah dicat putus dari cat global.
- **Dampak**: Tidak mungkin mendesain warna interior berbeda antar ruangan atau menjaga fasad tetap seragam saat mengecat bagian dalam.
- **Usulan Aturan**: Tambah properti opsional `frontMaterialId` & `backMaterialId` pada `Wall` (kompatibel mundur dengan `materialId` lama), pisahkan material sisi depan/belakang saat render dinding, dukung mode cat `Sisi Tunggal` vs `Seluruh Ruangan` (dengan deteksi sisi hadap kursor via *hit face normal*), perbaiki mapping `"wall_ext_ivory"`, dan pisahkan jelas aksi *"Ubah Warna Fasad Global"* dari kuas cat dinding.

#### `BM-06` — Bug Inkonsistensi Preview vs Commit pada `floor_fill`, Z-Fighting, & Menutup Void Tangga
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1677-1689, 2112-2129, 2153-2162`; `src/features/buildMode/geometryUtils.ts:52-135`; `src/lib/scene/projectHouseBuilder.ts:1063-1151`.
- **Masalah**:
  1. **Preview vs Commit berbeda**: Preview mode `fill` (`1677-1689`) menggunakan BFS dinding baru (`computeProjectRoomFloodCells`), tetapi commit (`2153-2162`) mengecek `findRoomAtPoint(lv.rooms)` lebih dulu — sehingga jika ruangan lama dibelah dinding baru, preview menampilkan setengah ruangan, namun saat diklik **seluruh ruangan lama ikut tercat**.
  2. **Z-fighting & undakan 1.55 cm**: `lv.slabs` (`lt2Y`), `lv.rooms` (`lt2Y + 0.008`), dan `floorTiles` (`lt2Y + 0.0205`) bertumpuk dengan jarak tipis; `floorTiles` menonjol 1.55 cm di atas lantai `Room` dan tidak pernah dibersihkan saat `paintRoomFloor` dipanggil (sehingga cat ruangan baru tertutupi ubin lama).
  3. **Lubang tangga (void) tidak diblokir**: `computeProjectRoomFloodCells` dan renderer `floorTiles` mengabaikan `lv.slabs` (`isVoid: true`) sehingga ubin bisa menutup lubang tangga LT2.
  4. **Tidak ada hapus ubin (`deleteFloorTile`)**: Sekali ubin 0.5 m dipasang, tidak bisa dihapus lewat Sledgehammer.
- **Dampak**: Pengecatan lantai terasa rusak, berkedip (*Z-fighting*), dan tidak patuh pada sekat dinding baru.
- **Usulan Aturan**: Gunakan satu algoritma konsisten antara preview dan commit (berbasis topologi ruangan aktual `BM-01` + pemblokiran sel void/kolam); saat `paintRoomFloor` dijalankan, bersihkan `floorTiles` di dalam poligon ruangan tersebut; sejajarkan elevasi `floorTiles` memakai polygon offset (bukan balok menonjol 2.5 cm); dan dukung hapus `floorTile` via Sledgehammer.

---

### D. Bukaan (Pintu, Jendela, Arch, Roster)

#### `BM-07` — Validasi Bukaan Hanya 1D Horizontal: Pintu Melayang di Pagar & Roster Ditolak di Atas Pintu
- **Bukti Kode**: `src/features/buildMode/geometryUtils.ts:147-218`; `src/features/buildMode/BuildScene.ts:1723, 2173`; `src/features/buildMode/projectCatalog.ts:263`; `src/lib/scene/projectHouseBuilder.ts:1347`.
- **Masalah**:
  1. `snapOpeningToProjectWalls` tidak memeriksa tinggi dinding (`wall.height`) maupun `sill + height`. Pintu `2.15 m`, jendela `2.25 m`, dan roster `2.67 m` lolos dipasang pada pagar `1.2 m`.
  2. Cek tabrakan bukaan (`geometryUtils.ts:191-208`) hanya mengecek irisan horizontal 1D tanpa rentang vertikal `[sill, sill + height]`. Akibatnya **Roster (`sill 2.45 m`) selalu ditolak di atas pintu (`top 2.15 m`) atau jendela (`top 2.25 m`)**, bertentangan dengan deskripsi katalognya sendiri.
  3. Tidak ada opsi balik arah bukaan pintu (`swing: 1 | -1`) saat pemasangan (di Sims 4 cukup tekan `R` / geser kursor ke sisi lain dinding).
- **Dampak**: Kombinasi arsitektur tropis paling umum di Indonesia (roster di atas kusen pintu/jendela) mustahil dipasang, sementara pemasangan ilegal di pagar justru lolos.
- **Usulan Aturan**: Tolak bukaan pada dinding bertipe `fence` atau saat `sill + height > wall.height - 0.05`; ubah overlap check menjadi **2D (horizontal AND vertikal)** dengan margin 5 cm; izinkan flip `swing` dengan tombol `R` saat preview bukaan.

#### `BM-08` — Bukaan Terpasang Tidak Bisa Digeser/Dipindah
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1941`; `src/features/buildMode/geometryUtils.ts:152`; `src/lib/store/useStudioStore.ts:480-489`.
- **Masalah**: Meskipun `snapOpeningToProjectWalls` sudah memiliki parameter `ignoreOpeningId` dan store memiliki `updateOpening`, `BuildScene.ts:1941` mengecualikan `opening` dari mekanisme drag, dan `selectedRing` tidak tampil saat `opening` dipilih.
- **Dampak**: Menggeser jendela 0.5 m ke kiri mengharuskan hapus lalu cari lagi di katalog dan pasang ulang.
- **Usulan Aturan**: Aktifkan drag-to-slide di sepanjang dinding (dan pindah ke dinding lain) untuk `opening` saat dipilih, lengkap dengan highlight seleksi dan opsi flip `swing`.

---

### E. Penempatan, Drag, Rotasi & Snapping Furnitur / HVAC / Lampu

#### `BM-09` — Zero AABB Collision, Clamping Pusat Saja, & Surface-Stacking Tanpa Filter
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1494-1586, 1769-1799, 1832-1889, 2209-2264`.
- **Masalah**:
  1. Tidak ada pengecekan tabrakan footprint (AABB/OBB) terhadap dinding, pintu, tangga, kolam, maupun furnitur lain.
  2. Batas kavling hanya mengecek titik pusat `(px, pz)` dengan margin statis `0.08–0.16 m`, mengabaikan `size.x`/`size.z` — mobil (4.1 m) atau sofa (2.2 m) bisa menembus dinding keluar kavling ke rumah tetangga.
  3. `mountKind === "surface"` menerima permukaan horizontal apa pun dengan `normal.y >= 0.65` (`1559-1574`), sehingga tempat tidur/sofa bisa ditumpuk di atas meja/sofa lain.
  4. Fallback dinding saat cutaway (`1526`) tidak mengecek `wallSnap.valid` — AC/lampu dinding bisa ditempel menembus kaca jendela/pintu.
  5. Objek `surface` di LT2 bisa ditaruh melayang di udara di atas lubang void atau di luar pelat LT2.
- **Dampak**: Penataan interior mudah rusak dan melayang tanpa peringatan; berbeda drastis dari rasa "klik rapi" ala The Sims 4.
- **Usulan Aturan**: Tambahkan validasi footprint terorientasi (OBB/AABB sesuai `rotY`) terhadap batas kavling, segmen dinding, area void LT2, dan furnitur lantai lain (dengan bypass opsional ala `Alt` / *MoveObjects* jika pengguna memang menginginkannya); batasi *surface-stacking* hanya untuk item dekorasi/lampu kecil di atas permukaan `table`/`counter`/`desk`; dan cek `wallSnap.valid` + hindari area bukaan untuk item `wall`-mounted.

#### `BM-10` — Bug Kritis Elevasi & Drag saat `activeLevel === 2` (Atap)
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:966-974, 1598, 1788, 1833, 1941-1973, 2045`.
- **Masalah**:
  1. Saat `activeLevel === 2`, `getActiveFloorY()` mengembalikan elevasi atap (`~7.7 m`) sehingga preview ghost melayang di atas atap, tetapi saat diklik `lvIdx = Math.min(1, activeLevel)` menyimpan objek ke **LT2** (`levels[1]`).
  2. Mengklik objek LT1 ketika kamera di LT2/Atap mencari item di `levels[lvIdx]` (LT2), sehingga `curItem` tidak ditemukan (`dragPendingCommit = null`) sementara `draggingEntity` tetap aktif.
- **Dampak**: Pengguna yang langsung mencoba menaruh furnitur saat pertama membuka Build Mode (yang default-nya di level `Atap`!) melihat preview melayang di atap dan barang "hilang" masuk ke LT2.
- **Usulan Aturan**:
  1. Ubah default level saat masuk Build Mode ke **`LT 1` (`activeLevel: 0`)** dengan dinding **`Cutaway`** (atau otomatis turunkan `activeLevel` dari `2` ke `1` ketika pengguna memilih alat interior/dinding/furnitur).
  2. Saat `pointerdown` pada objek terpilih, selalu ambil `lvIdx = hitRes.sel.levelIndex` (bukan `activeLevel`).

#### `BM-11` — Rotasi Terbatas 90°, Grid Snap Terbalik dari Sims 4, & Klaim Palsu `Shift+Klik`
- **Bukti Kode**: `src/components/build/BuildWorkspace.tsx:445-505, 539-540`; `src/features/buildMode/BuildScene.ts:1566-1578, 1862-1876`; `src/features/buildMode/projectCatalog.ts:385`.
- **Masalah**:
  1. Rotasi (`R`, `.`, `,`) hanya 90°, tanpa 45° (standar Sims 4) dan tanpa *click-drag rotate*; menekan `R` saat sedang drag tidak menyinkronkan `dragPendingCommit`.
  2. Default penempatan adalah *free placement* kontinu dan `Shift` justru menyalakan grid snap — **terbalik** dari muscle memory Sims 4 (default snap ke grid 0.5 m, tahan `Alt` untuk *free placement* halus).
  3. Deskripsi furnitur menulis `"Shift+Klik duplikasi"`, padahal fitur tersebut tidak ada di `BuildScene.ts`; duplikasi hanya lewat tombol UI dengan offset hardcode `Math.min(4.6, x + 0.6)`.
- **Dampak**: Pengguna yang terbiasa dengan Sims 4 kesulitan meluruskan furnitur rapi di grid dan bingung dengan petunjuk `Shift+Klik`.
- **Usulan Aturan**: Jadikan **grid snap 0.5 m sebagai default** (tahan `Alt` untuk *free placement*), dukung rotasi step **45°** (`.`, `,`, `R`), sinkronkan rotasi saat sedang drag, dan implementasikan `Shift+Klik` saat penempatan agar item tetap aktif di kursor untuk penempatan beruntun (*continuous placement* ala Sims 4).

---

### F. Tangga, Atap, Kolam, & Terrain

#### `BM-12` — Tangga & Kolam Tidak Bisa Dihapus dari 3D, Void Tangga Tidak Melubangi Pelat LT2, & Railing Hardcoded
- **Bukti Kode**: `src/lib/scene/projectHouseBuilder.ts:1056, 1153-1254`; `src/features/buildMode/BuildScene.ts:53-81, 2179-2206, 2274-2283`; `src/lib/store/useStudioStore.ts:45-52, 521-547, 644-650`; `src/features/buildMode/geometryUtils.ts:279-282`.
- **Masalah**:
  1. Tangga dirender dengan tag generik `{ kind: "part", id: "tangga" }` dan kolam tidak di-`tagPickable` sama sekali → **keduanya tidak bisa dipilih, digeser, maupun dihapus dengan Sledgehammer atau tombol `Delete`** (meski `deleteStair` & `deletePool` ada di store).
  2. `projectHouseBuilder.ts:1056` menulis `if (slab.isVoid) continue;` tanpa memotong `shape.holes` pada slab solid LT2 → **lubang tangga baru di LT2 tidak pernah berlubang secara visual**, dan `deleteStair` tidak menghapus `slab-void-${stair.id}`.
  3. Railing tangga & balkon LT2 (`1213-1254`), taman/carport/plinth (`596-744`), serta lubang skylight & kanopi atap (`1562-1701`) semuanya di-hardcode — tetap melayang di udara meski tangga dipindah atau lot di-reset.
  4. Kolam hanya 2 balok datar di atas lantai/tanah tanpa galian dan tanpa cek tabrakan ruangan/dinding.
  5. Bug AABB overlap tangga (`geometryUtils.ts:279-282`) menambah `width * 0.5` di sumbu panjang tangga juga.
- **Dampak**: Pengguna yang memasang tangga atau kolam di posisi salah terjebak permanen kecuali menekan Undo segera atau mereset seluruh lot.
- **Usulan Aturan**: Tambahkan `kind: "stair"` & `kind: "pool"` pada `SelectionTarget`, `tagPickable`, Sledgehammer, dan `Delete`; potong poligon `isVoid` sebagai `shape.holes` pada slab LT2; hapus void otomatis di `deleteStair`; generate railing LT2 secara dinamis mengikuti tepi `isVoid` tangga aktual; dan tambahkan cek tabrakan tangga/kolam.

#### `BM-13` — Atap Hanya Ganti Preset Global & Terrain Tidak Live-Update Saat Drag
- **Bukti Kode**: `src/components/build/BuildWorkspace.tsx:596-602`; `src/features/buildMode/BuildScene.ts:1901-1904, 2143-2147`; `src/features/buildMode/geometryUtils.ts:291-316`.
- **Masalah**:
  1. Mengklik kartu Atap di katalog langsung mengubah `roofType` seluruh rumah seketika tanpa preview/konfirmasi, dan tidak menyesuaikan bentuk atap terhadap footprint bangunan hasil edit.
  2. Brush terrain hanya memutasi array `terrainScratch` selama drag — **mesh tanah 3D tidak berubah sama sekali hingga mouse dilepas**, tanpa kontrol ukuran/kekuatan brush, dan tanpa proteksi agar tanah tidak menembus lantai rumah.
- **Dampak**: Perubahan atap terasa mengejutkan; memahat terrain terasa "buta" karena hasil baru terlihat setelah lepas klik.
- **Usulan Aturan**: Tampilkan mode *Atap* dengan preview/konfirmasi jelas (atau kontrol kemiringan & overhang kontekstual) dan hitung footprint atap dari bounding box dinding/ruangan aktual; update vertex mesh terrain secara langsung selama drag dan kunci elevasi di bawah footprint lantai rumah agar tanah tidak menembus interior.

---

### G. Alat Manipulasi, UX Muscle Memory & Kamera

#### `BM-14` — Sledgehammer Tanpa Drag-Box, Eyedropper Parsial, & Preview Ghost Hanya Kotak Polos
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1724, 1737, 1787, 2149-2150, 2274-2304`.
- **Masalah**:
  1. Sledgehammer (`K`) hanya mendukung klik tunggal (bukan drag-box untuk menghapus beberapa dinding/ubin/furnitur sekaligus) dan gagal menghapus tangga, kolam, lantai, maupun ruangan.
  2. Eyedropper (`I`) gagal menyalin bukaan (pintu/jendela), material lantai, tangga, kolam, maupun swatch warna spesifik furnitur (hanya mengambil item pertama bertipe sama untuk HVAC/lampu).
  3. Preview ghost furnitur/pintu/jendela/tangga hanya `BoxGeometry` transparan sehingga sulit memperkirakan arah hadap sofa, arah buka pintu, atau bentuk meja sebelum diklik.
- **Usulan Aturan**: Lengkapi cakupan Sledgehammer (termasuk `stair`, `pool`, `floorTile`, dan opsi drag-area untuk ubin/dinding) & Eyedropper (`opening`, lantai, swatch furnitur, varian HVAC/lampu); gunakan clone mesh 3D asli semi-transparan (atau minimal tambahkan panah arah depan yang jelas) untuk preview ghost.

#### `BM-15` — Pelanggaran Muscle Memory The Sims 4 di `BuildWorkspace.tsx`
- **Bukti Kode**: `src/features/buildMode/store.ts:76-77, 117-125`; `src/components/build/BuildWorkspace.tsx:507-571, 691-745, 1188-1226, 1387-1427, 1462-1726`; `src/app/page.tsx:178-183`.
- **Masalah**:
  1. **Default awal tertutup**: Masuk Build Mode langsung di `Atap` + dinding `Penuh`.
  2. **Klik tab kategori langsung mengganti tool aktif**: Menjelajahi tab `Dinding & Cat` / `Lantai` / `Tangga & Atap` langsung mengaktifkan kuas/tangga, rawan mutasi tak sengaja.
  3. **Konflik Hotkey Sims 4**: `B` (Wall Tool) tidak di-bind; `E` dipakai kamera (di Sims 4 `E` = Eyedropper); dual `Escape` listener (`page.tsx` + `BuildWorkspace`) membuat tutup modal ikut menghilangkan seleksi objek.
  4. **Swatch picker tidak ada sebelum penempatan**: Pengguna harus menaruh furnitur dulu, klik pilih, baru ganti warna di pojok kanan atas.
  5. **Undo/Redo & Day-Night tersembunyi/terpisah**: Undo/Redo jauh di `TopBar`, Day/Night disembunyikan di layar `< 1440px` kecuali tombol siklus kecil; kotak pencarian katalog hilang di layar `< sm`.
  6. **Tidak ada sub-kategori furnitur**: Tempat tidur, sofa, meja, sanitair, mobil, dan tanaman bercampur dalam 1 baris scroll datar.
  7. **Feedback validasi merah tanpa alasan**: Saat gagal pasang (di luar kavling, terlalu pendek, dll.), pil merah tetap menulis `"Permukaan Lantai"` / `"Dinding 0.0 m"` tanpa menjelaskan *mengapa* ditolak.
- **Usulan Aturan**:
  - Default masuk Build Mode: `LT 1` + `Cutaway`.
  - Klik tab kategori hanya membuka daftar katalog tanpa mengubah `activeTool` hingga kartu item diklik.
  - Tambahkan pre-placement swatch di kartu/bar katalog, sub-kategori untuk `Furnitur` (Ruang Tamu, Tidur, Dapur, KM, Outdoor), dan alasan penolakan eksplisit pada pil merah HUD (mis. *"Di luar batas kavling"*, *"Minimal panjang 0.5 m"*, *"Bertabrakan dengan dinding"*).
  - Bind hotkey `B` (Dinding), satukan hirarki `Escape` tunggal, dan tampilkan Undo/Redo + Day/Night ringkas di HUD Build Mode.

#### `BM-16` — Kontrol Touch Kamera Tanpa Gesture Orbit 2-Jari & Klik Kanan Cancel Memicu Orbit
- **Bukti Kode**: `src/features/buildMode/BuildCameraController.ts:275-309`; `src/features/buildMode/BuildScene.ts:1922-1927`.
- **Masalah**:
  1. Di perangkat sentuh, 1 jari = pan dan 2 jari = pinch-zoom, tetapi **tidak ada gesture 2-jari putar/orbit** (pengguna mobile hanya bisa memutar kamera lewat tombol View Cube).
  2. Klik kanan untuk membatalkan alat aktif (`BuildScene.ts:1922-1927`) tetap diteruskan ke `BuildCameraController`, sehingga langsung menggeser/memutar kamera sedikit saat pengguna sekadar ingin batal.
- **Usulan Aturan**: Tambahkan 2-finger twist/drag orbit pada touch, dan tahan/stop propagasi orbit pada klik kanan singkat (*click* vs *drag* threshold `> 5 px`) agar klik kanan murni untuk batal/deselect tanpa menggoyang kamera.

---

### H. Performa Edit Interaktif & State Hygiene

#### `BM-17` — Over-Invalidation `buildSignature` Memicu Full 3D Rebuild pada Edit Ringan
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:799-866, 893-935, 976-1048`; `src/components/build/BuildWorkspace.tsx:355-357`; `src/app/page.tsx:190-200`.
- **Masalah**:
  1. `buildSignature` (`BuildScene.ts:894`) memasukkan `u: project.updatedAt`. Karena `patchSimulation` (ganti jam matahari / warna fasad global) dan `updateFurniture`/`updateLight` selalu mengubah `updatedAt`, perubahan yang seharusnya 100% lokal (mengubah `sunDir`, warna material, atau posisi 1 kursi saat `pointerup`) memicu **FULL `rebuildFromProject`** (clear scene, dispose semua geometri, re-extrude dinding + BVH, re-instantiate ribuan bata, recompile semua lampu GPU) → menyebabkan *stutter* dan *flicker* bayangan.
  2. Memasukkan `selected` ke dependency `updateProjectData` (`BuildWorkspace.tsx:355-357`) menjalankan `JSON.stringify` masif dan traversal wireframe setiap kali pengguna sekadar mengklik objek.
  3. Di `page.tsx:190-200`, setiap edit kecil (termasuk geser 1 kursi atau ganti jam matahari) menjalankan 8 engine berat (`masonry`, `sni`, `rab`, `schedule`, `lighting`, `airflow`, `flood`, `gamification`) secara sinkron di main thread, padahal panel analitiknya sedang tertutup.
- **Usulan Aturan**:
  1. Hapus `u: project.updatedAt` dari `buildSignature`; pecah signature menjadi 3 level: **Structural/Geometry Signature** (dinding/ruang/slab/atap/tangga/kolam/terrain), **Props Signature** (furnitur/HVAC/lampu — cukup update transform/material mesh target tanpa rebuild rumah), dan **Environment Signature** (matahari/cuaca/cat global — 100% update lokal tanpa rebuild).
  2. Pisahkan effect update `selected` dari `updateProjectData`.
  3. Jalankan kalkulasi engine analitik yang berat secara *lazy* (hanya saat panel/workspace terkait aktif atau di-debounce untuk `StatusBar`).

#### `BM-18` — Celah Pengujian Build Mode (`src/tests/buildMode.test.ts`)
- **Bukti Kode**: `src/tests/buildMode.test.ts:1-192`.
- **Masalah**: 5 test yang ada baru mencakup *happy path* dasar. Belum ada test untuk wall-graph/room splitting, validasi 2D bukaan terhadap pagar & roster di atas pintu, AABB collision furnitur, elevasi `activeLevel === 2`, konsistensi preview vs commit `floor_fill`, hapus tangga (+ bersihkan void LT2) & kolam, maupun guard `buildSignature` agar tidak full-rebuild pada edit lingkungan/transform.
- **Usulan**: Tambahkan unit test terarah untuk seluruh aturan Build Mode baru sebelum menyatakan selesai.

---

## 3. Usulan Blueprint Arsitektur Target (Bertahap)

Agar perombakan tetap aman, teruji, dan tidak merusak fitur non-Build Mode (RAB, SNI, Simulasi, Denah 2D, Walk Mode):

1. **Fase 1 — Perbaikan Bug Kritis & Stabilitas (Quick Wins, Dampak Instan)**:
   - Perbaiki `BM-04` (bata & kolom ikut cutaway/down + cutaway berbasis target kamera & `rec.exterior`).
   - Perbaiki `BM-07` (tolak bukaan di pagar/melebihi `wall.height`, overlap 2D agar roster bisa di atas pintu/jendela).
   - Perbaiki `BM-10` (default `LT 1` + `Cutaway`, perbaiki bug `activeLevel === 2` & drag lintas lantai).
   - Perbaiki `BM-12` (hapus tangga + bersihkan void LT2, potong lubang void pada slab LT2 secara visual, hapus kolam).
   - Perbaiki `BM-17` (hapus `updatedAt` dari `buildSignature` agar ganti jam matahari/cat global/lepas drag tidak memicu full rebuild & flicker).
   - Perbaiki `BM-05` bagian bug `"wall_ext_ivory"` & `BM-06` (konsistensi preview vs commit `floor_fill` + blokir void).

2. **Fase 2 — Mekanisme Inti Ala The Sims 4 (Room Topology & Placement)**:
   - Implementasi `BM-01` & `BM-02` (Planar Wall-Graph T-junction, auto-room detection, `SelectionTarget` `"room"`, `updateRoom`/`deleteRoom`, serta *push-pull* wall handle).
   - Implementasi `BM-03` (pisahkan `fence` dari `wall`, auto-detect `exterior`).
   - Implementasi `BM-05` penuh (`frontMaterialId`/`backMaterialId` per sisi dinding + mode cat *Room*).
   - Implementasi `BM-08` (geser bukaan terpasang + flip `swing` dengan `R`) & `BM-09` (AABB collision, batas kavling berbasis `sizeM`, filter *surface-stacking*, opsi `Alt` free-placement).
   - Implementasi `BM-11` (default grid snap 0.5 m, rotasi 45°, `Shift+Klik` penempatan beruntun).

3. **Fase 3 — Poles Ergonomi UX, Alat & Visual**:
   - Implementasi `BM-13`, `BM-14`, `BM-15`, `BM-16` (preview ghost 3D/arah hadap, alasan validasi merah eksplisit, pre-placement swatch & sub-kategori furnitur, Sledgehammer & Eyedropper lengkap, live terrain drag, 2-finger orbit touch, klik kategori tidak mengubah tool, hotkey Sims 4 rapi).
   - Tambah test suite lengkap (`BM-18`).

---

> **Status Tahap Audit Build Mode: SELESAI — MENUNGGU PERSETUJUAN.**
> Silakan tentukan temuan `BM-01` s.d. `BM-18` (atau fase mana dari Fase 1–3) yang ingin Anda **setujui, tolak, atau ubah** bersamaan dengan temuan di `AUDIT.md` sebelum saya mulai mengeksekusi perubahan kode.
