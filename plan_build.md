# Rencana Implementasi Komprehensif Build Mode (The Sims 4 Standard) — Gomahan

> **Referensi Audit:** `AUDIT_BUILD.md` (`BM-01` s.d. `BM-18`)  
> **Tujuan Utama:** Mengubah Build Mode `gomahan` dari kumpulan primitif terpisah menjadi editor arsitektur berbasis ruangan (*room-centric*) yang responsif, konsisten, dan selaras dengan *muscle memory* **The Sims 4 Build/Buy Mode**, tanpa memutus kompatibilitas data proyek lama maupun engine analitik (RAB, SNI, Simulasi, Denah 2D, Walk Mode).

---

## 1. Prinsip Arsitektur & Invariant Wajib

Sebelum menulis kode, seluruh perubahan wajib memenuhi 5 invariant berikut:
1. **Satu Sumber Kebenaran (*Single Source of Truth*)**: Topologi ruangan (`lv.rooms`, `lv.slabs` LT2, `wall.exterior`) diturunkan secara deterministik dari graf dinding (`lv.walls`), bukan dipelihara manual secara terpisah. State visibilitas bersama (`showNeighbors`, `showRoof`, `showBricks`, `activeLevel`) bersumber tunggal di `useStudioStore`.
2. **Kompatibilitas Mundur & Migrasi Aman**: File proyek `.json` dan data IndexedDB versi lama (`schemaVersion: 1` & `2`) tetap dapat dibuka tanpa kehilangan data; save corrupt dikarantina ke tabel backup sebelum memuat proyek default.
3. **Atomicity Undo/Redo (`zundo`)**: Setiap aksi pengguna (termasuk geser dinding *push-pull*, cat seluruh ruangan, hapus tangga + void, atau `"Semua Sejenis"`) menghasilkan **tepat 1 transaksi Undo**, dan aksi UI murni (pilih objek, pindah tab, klik panel) tidak pernah masuk stack Undo (`equality` guard).
4. **Update 3D Bertingkat (Tanpa Full Rebuild Tak Perlu)**: Edit lingkungan (jam matahari, cat fasad global), seleksi objek, dan edit transform/warna 1 furnitur/lampu/HVAC tidak boleh memicu `rebuildFromProject()` penuh.
5. **Integritas Lintas Modul**: Perubahan pada `Wall`, `Room`, `Slab`, `Stair`, `Pool`, dan `floorTiles` tetap dibaca secara valid oleh `projectModel.ts`, `masonry.ts`, `rabEngine.ts`, `sniEngine.ts`, `DrawingsWorkspace.tsx`, dan `WalkScene.ts` / `collisionBuilder.ts`.

---

## 2. Desain Skema Data & Strategi Migrasi (`v2 → v3`)

### 2.1 Penambahan Field Model (`src/lib/model/types.ts` & `src/lib/model/schema.ts`)
Semua field baru bersifat **opsional pada input** dan dinormalisasi pada migrator sehingga 100% kompatibel dengan save v2:

```ts
// 1. Wall — pisahkan pagar & dukung cat 2 sisi
export interface Wall {
  // ...field eksisting tetap dipertahankan
  kind?: "wall" | "fence";       // default "wall"; fence tidak menerima opening & tidak dihitung bata penuh
  frontMaterialId?: ID;          // sisi +normal (kanan vektor start->end); fallback ke materialId
  backMaterialId?: ID;           // sisi -normal (kiri vektor start->end); fallback ke materialId
}

// 2. Slab — ikat void tangga ke stair.id
export interface Slab {
  // ...field eksisting
  linkedStairId?: ID;            // diisi otomatis saat addStairWithCutout; dihapus otomatis saat deleteStair
}

// 3. SelectionTarget — dukung seleksi Room, Stair, Pool, dan FloorTile
export type SelectionTarget =
  | { kind: "wall"; levelIndex: number; id: ID }
  | { kind: "opening"; levelIndex: number; wallId: ID; id: ID }
  | { kind: "room"; levelIndex: number; id: ID }
  | { kind: "stair"; levelIndex: number; id: ID }
  | { kind: "pool"; id: ID }
  | { kind: "floorTile"; levelIndex: number; gx: number; gz: number }
  | { kind: "furniture"; levelIndex: number; id: ID }
  | { kind: "hvac"; levelIndex: number; id: ID }
  | { kind: "light"; levelIndex: number; id: ID }
  | { kind: "part"; id: string };
```

### 2.2 Migrasi Data Eksisting (`migrateProjectSave`)
- **Lokasi**: `src/lib/model/schema.ts` & `src/lib/store/db.ts`.
- **Aturan Normalisasi**:
  - Jika `wall.kind` kosong: set `"fence"` bila `wall.height <= 1.35 && wall.thickness <= 0.1`, selain itu `"wall"`.
  - Jika `frontMaterialId` / `backMaterialId` kosong: biarkan `undefined` (renderer fallback ke `wall.materialId`).
  - Jika `slab.isVoid && !slab.linkedStairId && slab.id.startsWith("slab-void-")`: isi `linkedStairId = slab.id.replace("slab-void-", "")`.
  - Jika JSON/IndexedDB gagal parse: simpan salinan mentah ke `db.backups` (tabel baru di Dexie v2) sebelum fallback ke default project, dan tampilkan toast peringatan.

---

## 3. Spesifikasi Teknis Modul Inti

### 3.1 Modul Baru: `src/features/buildMode/wallGraph.ts` (`BM-01`, `BM-02`, `BM-03`)
Mesin topologi 2D berbasis graf planar untuk menyinkronkan dinding, ruangan, dan pelat LT2:
1. **`normalizeAndSplitWalls(walls: Wall[])`**:
   - Snap endpoint dalam toleransi `EPS = 0.04 m` ke simpul eksisting dan segmen dinding lain (T-junction).
   - Pecah segmen yang terpotong di tengah menjadi 2 sub-segmen; **pindahkan setiap `opening`** ke sub-segmen yang memuat pusat `offset`-nya dengan `offset` baru yang dihitung ulang relatif terhadap sub-segmen tersebut (batal & beri warning jika split memotong tepat di tengah bukaan).
   - Deduplikasi segmen tumpang-tindih (hanya buang duplikat persis atau potong bagian overlap).
   - Gabungkan segmen kolinear berderajat-2 yang memiliki `kind`, `height`, `thickness`, `frontMaterialId`, `backMaterialId` identik (dan gabungkan array `openings`-nya).
2. **`extractMinimalRooms(walls: Wall[], prevRooms: Room[])`**:
   - Bangun graf *half-edge* hanya dari `w.kind !== "fence"`.
   - Telusuri wajah (*minimal cycles*) berarah CCW dengan luas shoelace `>= 0.5 m²` (buang wajah terluar/infinite face yang bertanda negatif).
   - **Pelestarian Identitas Ruangan**: Cocokkan setiap siklus baru dengan `prevRooms` menggunakan *overlap area* (atau titik sampel grid 0.25 m) terbesar; warisi `id`, `name`, `program`, `floorMaterialId`, dan `ceilingHeight` dari ruangan induknya. Ruangan pecahan baru mendapat nama otomatis (`"Ruang Baru N"`).
3. **`deriveWallExteriorAndSlabs(levelIndex, walls, rooms, prevSlabs)`**:
   - Untuk setiap dinding `kind === "wall"`: hitung berapa wajah ruangan (`rooms`) yang berbatasan langsung pada kedua sisinya (`leftRoom`, `rightRoom`). Set `w.exterior = !(leftRoom && rightRoom)`.
   - Khusus `levelIndex === 1` (LT2): pertahankan semua slab `isVoid: true` & `isOverhang: true`, dan regenerasi slab solid LT2 mengikuti union/poligon `rooms` LT2 agar setiap ruangan baru di LT2 otomatis memiliki pelat beton + plafon LT1.
4. **`pushPullWall(level, wallId, deltaNormalM, site)`**:
   - Geser kedua titik ujung dinding sepanjang vektor normalnya sebesar `deltaNormalM` (ter-snap 0.5 m atau bebas saat `Alt`).
   - Dinding lain yang terhubung ke titik ujung lama ikut menyesuaikan ujungnya (perpanjang/perpendek); cek semua bukaan pada dinding terkait tetap muat (`offset ± width/2` dalam segmen) dan panjang dinding `>= 0.5 m` serta berada di `[0..site.width, 0..site.depth]`.
   - Panggil `reconcileLevelTopology()` agar `rooms`, `slabs`, dan `exterior` langsung ikut ter-update.

### 3.2 Modul Baru: `src/features/buildMode/placementValidator.ts` (`BM-07`, `BM-09`, `BM-10`, `BM-12`)
Validator murni (*pure functions*, mudah di-unit-test) yang mengembalikan `{ valid: boolean; reason?: string }`:
- **`validateOpeningPlacement2D(wall, opSpec, offsetM, ignoreOpeningId)`**:
  - Tolak jika `wall.kind === "fence"` (`"Pintu/jendela tidak bisa dipasang di pagar"`).
  - Tolak jika `opSpec.sill + opSpec.height > wall.height - 0.05` (`"Melebihi tinggi dinding"`).
  - Tolak jika `offsetM - w/2 < 0.08` atau `offsetM + w/2 > wallLen - 0.08` (`"Terlalu dekat ujung dinding"`).
  - Cek overlap **2D** terhadap setiap bukaan lain di dinding yang sama: tabrakan terjadi HANYA jika proyeksi horizontal bertumpuk (`gapH < 0.05`) **DAN** proyeksi vertikal bertumpuk (`sill1 < top2 + 0.03 && sill2 < top1 + 0.03`). Dengan ini, **Roster (`sill 2.45 m`) lolos dipasang di atas Pintu (`top 2.15 m`) dan Jendela (`top 2.25 m`)**.
- **`validateObjectFootprint(params)`**:
  - Hitung 4 sudut OBB 2D dari `(x, z, size.x, size.z, rotY)`.
  - Cek semua 4 sudut berada di dalam `[0.02..site.width-0.02, 0.02..site.depth-0.02]` → jika tidak: `"Di luar batas kavling"`.
  - Cek `levelIndex === 1`: titik pusat/sudut harus berada di atas poligon slab LT2 dan **tidak** di dalam slab `isVoid: true` → jika tidak: `"Tidak bisa ditaruh di lubang void / udara"`.
  - Jika `!altBypass`:
    - Cek interseksi OBB terhadap `lv.walls` (`"Bertabrakan dengan dinding"`), `lv.stairs` (`"Menghalangi tangga"`), `buildExtras.pools` (`"Menimpa area kolam"`), dan OBB furnitur lantai lain (`"Bertabrakan dengan furnitur lain"`).
  - Cek *surface-stacking*: jika `hostFurniture` ada, izinkan hanya bila `STACKABLE_CATEGORIES.has(item.category)` dan `SURFACE_HOST_TYPES.has(hostFurniture.type)` → jika tidak: `"Objek terlalu besar untuk ditaruh di atas furnitur ini"`.
  - Cek `mountKind === "wall"`: pastikan `wallSnap.valid` dan tidak menutup bukaan jendela/pintu (`"Menghalangi jendela/pintu"`).
- **`validateStairPlacement` & `validatePoolPlacement`**:
  - Perbaiki bug AABB tangga di `geometryUtils.ts:279-282` (bedakan sumbu lebar vs sumbu panjang sesuai `rotY`); cek tabrakan dengan dinding/furnitur/kolam.
  - Kolam hanya valid di `LT 1` (`levelIndex === 0`), di dalam kavling, tidak tumpang-tindih dengan kolam lain atau ruang interior tertutup (kecuali pengguna memang menggali di area outdoor/taman).

### 3.3 Perombakan Rendering 3D (`projectHouseBuilder.ts` & `BuildScene.ts`)
1. **Dinding 2 Sisi (`BM-05`)**:
   - Tambahkan `"wall_ext_ivory": { hex: 0xf2ece1, roughness: 0.85 }` ke `CUSTOM_PAINT_HEX`.
   - Untuk mesh dinding penuh (`fullGroup`), bangun 2 panel sisi (`frontMat` dari `w.frontMaterialId ?? w.materialId`, `backMat` dari `w.backMaterialId ?? w.materialId`) dan sisi tepi/atas (`capMat`), atau pisahkan group material pada geometry dinding.
   - Saat tool `wall_paint` melakukan raycast, tentukan sisi yang diklik melalui dot product `hitFaceNormal · wallRightNormal` → perbarui hanya `frontMaterialId` atau `backMaterialId`. Untuk mode *"Seluruh Ruangan"*, ambil semua dinding yang membatasi `room` yang menghadap ke dalam ruangan dan cat hanya sisi yang menghadap ruangan tersebut.
2. **Wall Cutaway Cerdas & Sinkronisasi Bata/Kolom (`BM-04`)**:
   - Daftarkan mesh bata per dinding (atau toggle visibilitas `bricksGroup` otomatis `false` saat `wallVisibility !== "up" && !showBricksOverlay`) serta daftarkan kolom yang menempel dinding luar ke record cutaway agar turun sejajar stub.
   - Ganti pusat referensi cutaway dari `(lotCX, lotCZ)` ke `cameraTarget` aktif, pisahkan perilaku `rec.exterior` (turun jika menghadap kamera `dot > 0.05`) vs interior (turun jika berada di antara kamera dan ruangan target di `activeLevel`), serta pertahankan dinding belakang tetap berdiri penuh.
   - Tambahkan kusen/ambang tipis di `cutawayGroup`/`downGroup` agar bukaan pintu tetap terlihat.
3. **Lubang Void Slab LT2 Nyata & Railing Dinamis (`BM-12`, `BM-06`)**:
   - Di `projectHouseBuilder.ts:1054-1074`, kumpulkan semua `slab.isVoid` di LT2 dan masukkan poligonnya sebagai `THREE.Path` ke `shape.holes` pada setiap slab solid LT2 yang melingkupinya.
   - Generate railing kaca LT2 secara dinamis dari tepi terbuka poligon `isVoid` tangga (kecuali sisi masuk tangga) dan tepi luar ruangan `program === "balcony"`, menggantikan koordinat hardcoded `1213-1254`.
   - Sejajarkan elevasi `floorTiles` (`ltY + 0.006` dengan `polygonOffset: true`) agar tidak Z-fighting atau menonjol 1.55 cm di atas `lv.rooms`; lewati sel yang jatuh di dalam `isVoid` atau `pools`; dan bersihkan `floorTiles` di dalam poligon ruangan saat `paintRoomFloor` dipanggil.
4. **Arsitektur 3-Tier Signature (`BM-17`)**:
   - Hapus `u: project.updatedAt` dari `buildSignature` di `BuildScene.ts:894`.
   - Pecah menjadi:
     - `structuralSig`: `site`, `systems`, `brickSpec`, `peil`, `levels[].walls/rooms/slabs/stairs`, `buildExtras`, `showBricksOverlay`.
     - `propsSig`: `levels[].furniture/hvac/lights` → terapkan *incremental diff* (`syncPropsIncremental()`): cukup perbarui posisi/rotasi/material/status ON-OFF mesh yang berubah, tambah mesh baru, dan dispose mesh yang dihapus — **0 rebuild rumah, 0 flicker bayangan**.
     - `envSig`: `simulation` (`hourOfDay`, `weather`, `rainIntensityMmH`, `floodDepthCm`, `paintExtHex`, `paintIntHex`, `roofColorHex`) → update lokal pada directional light, skybox, dan material palette saja.
   - Pisahkan `useEffect` seleksi (`buildScene.setSelected(selected)`) dari `updateProjectData`.

---

## 4. Roadmap Eksekusi Bertahap (4 Fase)

### Fase 1 — Stabilitas Kritis, Bug Blocking & Performa Tanpa Flicker
**Target ID:** `BM-04`, `BM-05 (partial)`, `BM-06`, `BM-07`, `BM-10`, `BM-12`, `BM-17`

| Tugas | File Utama | Perubahan Konkret |
|---|---|---|
| **1.1 Fix Cutaway & Bata/Kolom** | `projectHouseBuilder.ts`, `BuildScene.ts`, `useStudioStore.ts` | Sembunyikan bata saat cutaway/down (kecuali *Inspect Bata*), turunkan kolom terkait, ubah rumus cutaway berbasis `cameraTarget` + `rec.exterior`, tambah penanda ambang pintu di stub. |
| **1.2 Fix `activeLevel === 2` & Drag Lintas Lantai** | `features/buildMode/store.ts`, `BuildScene.ts` | Ubah default awal ke `activeLevel: 0` (`LT 1`) + `wallVisibility: "cutaway"`; otomatis turunkan `activeLevel` ke `1` jika alat interior dipilih saat di `Atap`; ambil `lvIdx = hitRes.sel.levelIndex` saat drag. |
| **1.3 Fix Validasi Bukaan 2D** | `placementValidator.ts` *(baru)*, `geometryUtils.ts`, `BuildScene.ts` | Tolak bukaan pada pagar/melebihi `wall.height`; ubah overlap check menjadi 2D agar Roster lolos di atas pintu/jendela; tambahkan `R` flip `swing` saat preview. |
| **1.4 Fix Hapus Tangga/Kolam & Void LT2 Nyata** | `types.ts`, `schema.ts`, `useStudioStore.ts`, `projectHouseBuilder.ts`, `BuildScene.ts`, `BuildWorkspace.tsx` | Tag `stair` & `pool` sebagai pickable; tambah ke `SelectionTarget`, Sledgehammer, & `Delete`; hapus `slab-void` di `deleteStair`; potong `shape.holes` nyata pada slab LT2; buat railing LT2 dinamis. |
| **1.5 Fix `floor_fill` Preview vs Commit & `"wall_ext_ivory"`** | `BuildScene.ts`, `geometryUtils.ts`, `projectHouseBuilder.ts`, `useStudioStore.ts` | Samakan algoritma preview & commit `floor_fill`, blokir void/kolam, bersihkan `floorTiles` saat `paintRoomFloor`, tambah `deleteFloorTile`, perbaiki elevasi `floorTiles` (polygonOffset), tambah `"wall_ext_ivory"` ke `CUSTOM_PAINT_HEX`. |
| **1.6 Arsitektur 3-Tier Signature & Lazy Analytics** | `BuildScene.ts`, `BuildWorkspace.tsx`, `src/app/page.tsx` | Hapus `updatedAt` dari `buildSignature`; implementasikan `syncPropsIncremental` & update lokal `envSig`; pisahkan effect `selected`; jalankan engine analitik berat secara lazy/conditional di `page.tsx`. |

- **Kriteria Selesai Fase 1**: Mode `Cutaway` bersih tanpa bata/kolom menembus; roster bisa dipasang di atas pintu & ditolak di pagar; tangga & kolam bisa dipilih/dihapus dan lubang LT2 benar-benar berlubang; ganti jam matahari/geser kursi 0 full-rebuild; `tsc`, `eslint`, dan `vitest` lulus 100%.

---

### Fase 2 — Mekanisme Inti Ala The Sims 4 (Wall-Graph, Push-Pull, Dual-Side Paint & Placement)
**Target ID:** `BM-01`, `BM-02`, `BM-03`, `BM-05 (full)`, `BM-08`, `BM-09`, `BM-11`

| Tugas | File Utama | Perubahan Konkret |
|---|---|---|
| **2.1 Planar Wall-Graph & Auto-Room Solver** | `features/buildMode/wallGraph.ts` *(baru)*, `useStudioStore.ts`, `rooms.ts` | Implementasi T-junction splitting, collinear merge, minimal cycle room extraction, pelestarian identitas ruangan (IoU), auto-derivation `wall.exterior`, dan auto-slab LT2; perbaiki `polygonCentroid` (shoelace) & `tileCount` berbasis luas aktual. |
| **2.2 Seleksi Ruangan & Wall Push-Pull Handle** | `BuildScene.ts`, `useStudioStore.ts`, `BuildWorkspace.tsx` | Tambah seleksi `kind: "room"` (klik lantai untuk edit nama/program/material/hapus ruangan); tambahkan gizmo panah *push-pull* pada dinding terpilih untuk menggeser dinding tegak lurus dengan mempertahankan bukaan & menyinkronkan ruangan dalam 1 Undo. |
| **2.3 Pemisahan `fence` vs `wall`** | `types.ts`, `schema.ts`, `BuildScene.ts`, `masonry.ts`, `rabEngine.ts` | Simpan `kind: "fence"` eksplisit + migrasi save lama; kecualikan `fence` dari deteksi ruangan tertutup, bukaan dinding, dan hitungan bata dinding penuh. |
| **2.4 Cat Dinding 2 Sisi & Mode *Room Paint*** | `types.ts`, `projectHouseBuilder.ts`, `BuildScene.ts`, `useStudioStore.ts`, `BuildWorkspace.tsx` | Render `frontMaterialId` & `backMaterialId` terpisah; deteksi sisi hadap via *face normal*; tambah toggle `Sisi Tunggal` / `Seluruh Ruangan` (`Shift+Klik`); pisahkan jelas swatch `"Fasad Global"` dari kuas cat dinding. |
| **2.5 Drag-Slide Bukaan Terpasang** | `BuildScene.ts`, `useStudioStore.ts` | Izinkan `opening` di-drag sepanjang dinding atau dipindah ke dinding lain memakai `ignoreOpeningId`, tampilkan highlight seleksi bukaan, dan dukung `R` untuk flip `swing`. |
| **2.6 Validasi Footprint OBB, Surface-Stacking & Grid Snap Sims 4** | `placementValidator.ts`, `BuildScene.ts`, `BuildWorkspace.tsx`, `projectCatalog.ts` | Validasi OBB batas kavling (`sizeM`), tabrakan dinding/void/tangga/furnitur (dengan `Alt` *MoveObjects* bypass), whitelist *surface-stacking*; balik grid snap jadi **default 0.5 m** (`Alt` = free); rotasi **45°** (sinkron saat drag); implementasi `Shift+Klik` penempatan beruntun & batch action `"Semua Sejenis"` (1 Undo). |

- **Kriteria Selesai Fase 2**: Menggambar 4 dinding tertutup otomatis menciptakan ruangan + lantai (+ slab LT2); membelah ruangan memecah 2 poligon; menarik panah dinding memperbesar ruangan tanpa merusak bukaan; cat 1 sisi kamar tidak tembus ke kamar sebelah/fasad; furnitur rapi menempel grid 0.5 m & menolak tembus dinding/kavling dengan alasan jelas.

---

### Fase 3 — Poles Ergonomi UX, Alat Lengkap, Terrain/Atap & Mobile Touch
**Target ID:** `BM-13`, `BM-14`, `BM-15`, `BM-16`

| Tugas | File Utama | Perubahan Konkret |
|---|---|---|
| **3.1 Perombakan UX `BuildWorkspace.tsx`** | `BuildWorkspace.tsx`, `features/buildMode/store.ts`, `src/app/page.tsx` | Klik tab kategori tidak mengubah `activeTool`; tambah sub-kategori untuk `Furnitur` (Tamu, Tidur, Dapur, KM, Outdoor); tambah **pre-placement swatch** di bar katalog; tampilkan kotak pencarian di semua ukuran layar; tampilkan Undo/Redo & Day-Night ringkas di HUD Build Mode; tampilkan **alasan penolakan eksplisit** di pil merah HUD. |
| **3.2 Sledgehammer, Eyedropper & Preview Ghost 3D** | `BuildScene.ts`, `propsBuilder.ts` | Lengkapi Sledgehammer (`stair`, `pool`, `floorTile` + drag-area untuk ubin/dinding) & Eyedropper (`opening`, lantai, swatch furnitur, varian HVAC/lampu spesifik); ganti kotak polos preview ghost dengan clone mesh semi-transparan atau indikator panah arah hadap yang jelas. |
| **3.3 Live Terrain Drag & Atap Kontekstual** | `BuildScene.ts`, `projectHouseBuilder.ts`, `BuildWorkspace.tsx` | Update vertex mesh terrain secara langsung selama drag (kunci elevasi di bawah footprint lantai rumah); tampilkan panel kontrol atap (tipe, kemiringan, overhang, warna) dengan preview/konfirmasi dan footprint mengikuti bangunan aktual. |
| **3.4 Hotkey Sims 4, Single `Escape` & Touch Orbit 2-Jari** | `BuildCameraController.ts`, `BuildScene.ts`, `BuildWorkspace.tsx`, `src/app/page.tsx` | Tambah 2-finger orbit di touch; pisahkan klik kanan singkat (batal tanpa menggoyang kamera) vs drag kanan (`> 5 px` orbit); bind hotkey `B` (Dinding), satukan prioritas `Escape` tunggal agar tidak membatalkan seleksi saat tutup modal. |

---

### Fase 4 — Pengujian Komprehensif, Migrasi & Verifikasi Akhir
**Target ID:** `BM-18`

1. **Unit & Integration Tests (`src/tests/buildMode.test.ts` + `src/tests/wallGraph.test.ts`)**:
   - `wallGraph`: gambar 4 dinding → auto-room + `exterior = true`; belah ruang → 2 ruangan dengan warisan nama/material; hapus sekat → gabung ruangan; T-junction → bukaan pindah ke segmen anak dengan offset akurat; `pushPullWall` → 1 Undo, tolak keluar kavling.
   - `placementValidator`: tolak pintu/jendela di `fence` & dinding pendek; izinkan Roster di atas Pintu/Jendela (overlap 2D); tolak furnitur keluar kavling berdasarkan `sizeM`; tolak sofa di atas meja (surface filter); izinkan `Alt` bypass.
   - `store & migration`: `deleteStair` menghapus `slab-void`; `paintRoomFloor` membersihkan `floorTiles` di dalamnya; `zundo` equality mencegah klik UI masuk stack Undo; `migrateProjectSave` membuka JSON v1/v2 lama tanpa error & mengarantina JSON corrupt.
   - `performance guard`: verifikasi perubahan `hourOfDay`, `paintExtHex`, atau `selected` tidak mengubah `structuralSig`.
2. **Quality Gates Wajib**:
   - `npm run typecheck` (`tsc --noEmit`) — 0 error.
   - `npm run lint` (`eslint .`) — 0 error/warning.
   - `npm run test` (`vitest run`) — 100% lulus.
   - `npm run build` (`next build`) — sukses tanpa error.

---

## 5. Matriks Hotkey Target (Selaras The Sims 4)

| Tombol | Aksi Target | Catatan Perubahan dari Kondisi Lama |
|---|---|---|
| **`V`** | Select / Hand Tool | Tetap |
| **`B`** | Wall Tool (`wall_straight`) | **Baru** (standar Sims 4) |
| **`K`** | Sledgehammer (Hapus) | Tetap (+ dukung `stair`, `pool`, `floorTile`, drag-box) |
| **`I`** | Eyedropper (Salin Item/Cat/Swatch) | Tetap (+ dukung `opening`, lantai, swatch; `E` tetap kamera kanan agar tidak merusak navigasi WASD+QE) |
| **`R` / `,` / `.`** | Putar 45° (atau Flip `swing` bukaan) | Diperbarui dari 90° ke **45°** + sinkron saat drag |
| **`Alt` (tahan)** | *Free Placement* (matikan grid snap & bypass collision) | **Dibalik** agar default = Grid Snap 0.5 m seperti Sims 4 |
| **`Shift` (tahan)** | *Continuous Placement* (taruh beruntun) / Cat Seluruh Ruangan | **Baru** (menggantikan klaim palsu sebelumnya) |
| **`PageUp` / `PageDown`** | Naik / Turun Lantai (`LT 1` ↔ `LT 2` ↔ `Atap`) | Tetap |
| **`Home` / `End`** | Siklus Wall Mode (`Penuh` / `Cutaway` / `Rendah`) | Tetap |
| **`G`** | Toggle Grid | Tetap |
| **`Delete` / `Backspace`** | Hapus Objek Terpilih (termasuk `room`, `stair`, `pool`) | Diperluas cakupannya |
| **`Ctrl/Cmd + Z` / `Y`** | Undo / Redo (1 aksi = 1 transaksi bersih) | Diperbaiki dengan `equality` guard |
| **`Escape`** | Prioritas tunggal: `CommandPalette` → `Modal` → `Cancel Tool/Preview` → `Deselect` → `Tutup Side Panel` | Disatukan (tidak ada lagi konflik dual listener) |

---

## 6. Analisis Risiko & Mitigasi

| Risiko | Dampak Jika Terjadi | Mitigasi |
|---|---|---|
| **Auto-Room Solver merusak denah default 5×17 m** | Ruangan default (termasuk ruang berbentuk L `r1-keluarga` & `r2-santai`) terpecah atau kehilangan nama/program. | Jalankan unit test snapshot terhadap `createDefaultProject()` — `reconcileLevelTopology` hanya dijalankan saat pengguna memutasi dinding, dan verifikasi denah default menghasilkan jumlah & nama ruangan yang 100% identik. |
| **Perubahan struktur `Wall` memengaruhi `masonry.ts` / `rabEngine.ts` / `WalkScene.ts`** | Volume bata/plester atau collider Walk Mode meleset/error. | Jaga `wall.materialId` tetap terisi sebagai fallback; `masonry.ts` & `collisionBuilder.ts` menangani `kind === "fence"` secara eksplisit dengan fallback aman bila `undefined`. |
| **Incremental props sync menyisakan mesh yatim di 3D** | Furnitur yang dihapus/di-undo tetap tampak di viewport. | Kelola `Map<entityKey, THREE.Object3D>` khusus di `BuildScene` dengan disposal eksplisit untuk setiap key yang hilang dari `project` pada tiap sinkronisasi, plus fallback rebuild bila diff inkonsisten. |

---

> **Siap Eksekusi:** Plan ini mencakup seluruh 18 temuan `BM-01` s.d. `BM-18` dalam 4 fase terukur. Jika Anda menyetujui plan ini, beri tahu apakah kita langsung mengeksekusi **Fase 1–4 sekaligus** atau **per fase** (dimulai dari Fase 1).
