# Audit Performa Mendalam (Zero Visual & Model Quality Degradation) — Gomahan

> **Prinsip Mutlak:** Seluruh temuan dan usulan optimasi di dokumen ini **mempertahankan 100% kualitas grafik visual dan detail model** — resolusi shadow map (`4096²` desktop / `2048²` walk), tekstur PBR prosedural (`1024²`), detail chamfer/bevel furnitur, `GTAOPass`, `AtmospherePass`, `UnrealBloomPass`, jumlah bata aktual, serta resolusi grid simulasi (`25×85`) tetap utuh tanpa pengurangan 1 piksel pun. Pada tahap ini **belum ada kode atau konfigurasi yang diubah**.

---

## 1. Ringkasan Eksekutif & Estimasi Dampak (Identik Secara Visual)

| Prioritas | Kode | Area Bottleneck | Estimasi Dampak Tanpa Menurunkan Kualitas Visual |
| :--- | :--- | :--- | :--- |
| **P0** | `PF-01`, `PF-02` | Shadow Map 4096²/2048² re-render 60×/dtk + bata/mesh terkubur ikut `castShadow` | **−80 s.d. −100 draw calls/frame** & pangkas ~100% beban GPU shadow pass saat matahari/objek diam |
| **P0** | `PF-03`, `PF-04` | Draw call ~369–382 (tanpa batching/instancing) + rebuild 14 hardware lights | Draw calls turun **−62% s.d. −69%** (~115–145 dengan GTAO / ~70–95 tanpa GTAO); hilangkan *stutter* shader recompile 50–300 ms |
| **P0** | `PF-06` | Render loop 60fps tanpa *idle gating* (GTAO + AtmospherePass 40-sample + Bloom) | **−95% beban GPU & baterai saat adegan diam** |
| **P0** | `PF-10`, `PF-13`, `PF-14` | Kaskade 8 engine sinkron + badai re-render `BuildWorkspace` 60–120 Hz + Zundo tanpa `equality` | Hilangkan lag mousemove/ketik harga RAB; pangkas CPU main-thread >80% saat interaksi UI |
| **P1** | `PF-05`, `PF-07`, `PF-11` | Rebuild 21 `CanvasTexture`/Sobel + PMREM per tab/slider + raycast penuh + `JSON.stringify` masif | Transisi Build ↔ Walk dari ratusan ms → **<20 ms**; `pointermove` CPU turun **70–85%**; hashing `O(N)` → `O(1)` |
| **P1** | `PF-09`, `PF-12` | 6 kebocoran GPU/DOM/BVH (shadow map 64 MB/unmount) + startup double-compute | Hentikan kebocoran VRAM/RAM & potong waktu startup interaktif ~40–50% |
| **P2** | `PF-08`, `PF-15`–`PF-18` | GC pressure 60Hz, DOM/SVG re-reconcile, 19 paket tak terpakai, `jspdf` statis, Web Worker | Hilangkan micro-stutter Walk Mode, perkecil bundle awal, & jaga 60+ FPS saat simulasi aktif |

---

## 2. Daftar Temuan Audit Performa (`PF-01` s.d. `PF-18`)

### A. Pipeline GPU, Draw Calls, Shadow Map & Material

#### `PF-01` — Shadow Map 4096²/2048² Dirender Ulang 60×/Detik Saat Adegan Statis
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:321-323, 347`; `src/features/walkMode/WalkScene.ts:202-203, 222`.
- **Masalah**: `renderer.shadowMap.autoUpdate` dibiarkan `true` (default Three.js). Setiap kali pengguna hanya mengorbit kamera, pan, berjalan di Walk Mode, atau bahkan diam total, GPU me-rasterisasi ulang seluruh shadow caster ke tekstur `4096×4096` (Build) / `2048×2048` (Walk) sebanyak 60 kali per detik padahal arah matahari dan posisi bangunan tidak berubah.
- **Dampak**: Membuang ~80–100 draw calls dan bandwidth fill-rate shadow pass di setiap frame.
- **Usulan Optimasi (Zero Degradation)**: Set `renderer.shadowMap.autoUpdate = false` saat init, lalu set `renderer.shadowMap.needsUpdate = true` secara *event-driven* hanya ketika `rebuildFromProject` / `rebuildHouseAndLights`, `envKey` (jam/musim/orientasi) berubah, `explodeCurrent` bergerak, `wallVisibility`/`activeLevel`/cutaway berubah, objek sedang di-drag (`draggingEntity`), atau pintu dibuka/tutup di Walk Mode.

#### `PF-02` — Ribuan Bata `InstancedMesh` & Mesh Terkubur/Transparan Masuk Shadow Pass
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:989`; `src/lib/scene/projectHouseBuilder.ts:317, 597-643, 787-932, 1071, 1078-1090, 1214, 1234, 1275`; `src/lib/scene/geometryHelpers.ts:147, 166`.
- **Masalah**:
  1. Pada mode default (`showFinishing = true`, `showBricksOverlay = false`, `explode = 0`), 4 `InstancedMesh` bata (ribuan instance) tetap `visible = true` dan `castShadow = true` (`projectHouseBuilder.ts:1275`) padahal 100% terbungkus rapat di dalam dinding plester (`skinThickness = w.thickness + 0.022`).
  2. `StaticBatchCollector` men-default `castShadow = true` pada mesh yang tidak berkontribusi bayangan: kaca railing transparan (`rail:glass-stair/balc`, `opacity: 0.32`), pondasi bawah tanah (`y = -0.65..-1.95`) saat `showTerrain === true`, permukaan datar tanah (`site:grass`, `site:carport`, `site:teras`, `fnd:plinth`, pijakan 3 cm), plafon gypsum LT1 (1,4 cm di bawah pelat beton LT2), dan kaca jendela tetangga.
- **Usulan Optimasi (Zero Degradation)**: Set `brickIM.visible = false` saat `showFinishing && !showBricksOverlay && explodeCurrent < 0.001 && clipPlane.constant > 10` (otomatis nyala saat Explode / Cut / Inspect Bata); matikan `castShadow` hanya pada mesh transparan/datar/terkubur di atas (tetap `receiveShadow = true`).

#### `PF-03` — Draw Call Explosion (~369–382 Calls) Akibat Kurangnya Batching & Instancing
- **Bukti Kode**: `src/lib/scene/projectHouseBuilder.ts:108-426, 502-524, 732-735, 1121, 1214-1234, 1307-1554, 1632-1800`; `src/lib/scene/propsBuilder.ts:79-121, 633-755`.
- **Masalah**: Pada tier `high` (`BuildScene.ts:540-575`), setiap mesh opaque digambar hingga 3× (Shadow + GTAO G-Buffer + Main HDR). Dari ~295 base mesh pada `defaultProject.ts`, banyak mesh statis/repetitif belum di-merge atau di-instance:
  - **Bukaan (53 mesh)**: 10 pintu × 3 mesh + 8 jendela × 2 + 7 vent × 1 → bisa di-merge/instance per `(level, material)` (**−41 mesh**).
  - **Furnitur & Contact Shadow Disc (~72 mesh)**: 23 item membuat material baru per item (`propsBuilder.ts:103-121`) + 1 mesh contact disc terpisah per furnitur (`79-93`) → cache material di `palette` + `InstancedMesh` untuk item berulang (`kloset_set`, `tropical_plant`, `sofa_2`, `bed_single`, `wardrobe`, `desk`) + 1 `InstancedMesh` contact disc per lantai (**−40 mesh**).
  - **Dinding Plester (33 mesh)**: 1 mesh per dinding → pada `WalkScene` (`supportWallCutaway: false`) dan mode `up` tanpa explode, merge dinding per `(level, material)` (**−27 mesh**).
  - **HVAC & Condenser (32 mesh)** & **Light Fixtures (26 mesh)**: membuat `whitePlastic`, `indicatorMat`, `bulbMat` baru per unit → share material berdasarkan status (`on`/`off` + 3 suhu warna) + `InstancedMesh` untuk unit repetitif, pisahkan hanya bilah kipas berputar (**−42 mesh**).
  - **Env/Tetangga (~42 mesh)**, **Lantai Ruangan (~14 mesh, bucket per `room.id`)**, & **Railing/Atap (~8 mesh)**: merge bucket dengan material & `explodeOff` identik (**−28 mesh**).
- **Dampak**: Base meshes turun dari **~295 → ~115 (−61%)**; total draw calls turun dari **~369–382 → ~115–145** (dengan GTAO) atau **~70–95** (tanpa GTAO / Walk Mode) dengan visual 100% identik.

#### `PF-04` — Rebuild Hardware Lights di `BuildScene` Memicu Shader Recompilation Global
- **Bukti Kode**: `src/lib/scene/projectHouseBuilder.ts:1758-1800` vs `src/features/walkMode/WalkScene.ts:306-310`.
- **Masalah**: Setiap `rebuildFromProject` di `BuildScene` menghancurkan dan membuat ulang hingga 14 `SpotLight`/`PointLight`. Berubahnya jumlah lampu aktif mengubah `#define NUM_SPOT_LIGHTS` / `NUM_POINT_LIGHTS` pada shader Three.js, memicu kompilasi ulang shader WebGL di seluruh material PBR (*stutter* 50–300 ms).
- **Usulan Optimasi**: Adopsi *fixed-size hardware light pool* (seperti `WalkScene.ts:306-310`) berukuran tetap di `BuildScene` (mis. 14 `SpotLight` + 2 `PointLight` permanen); lampu mati cukup diset `intensity = 0` tanpa add/remove dari scene.

#### `PF-05` — Rebuild 21 `CanvasTexture` + 6,3 Juta Piksel Sobel, Double-Init PMREM, & Dangling `envMap`
- **Bukti Kode**: `src/lib/scene/materials.ts:29, 37-82, 357-382, 465-491, 569-602, 768-778, 990-1004`; `src/features/buildMode/BuildScene.ts:171, 335, 369, 390, 804-815`; `src/features/walkMode/WalkScene.ts:213, 240, 465-471`; `src/lib/scene/propsBuilder.ts:111, 118, 372, 644`.
- **Masalah**:
  1. Unmount/mount saat pindah tab Build ↔ Walk memanggil `createMaterialPalette()` ulang — menjalankan 21 generasi kanvas + 8 `normalMapFromHeight()` Sobel (~6,3 juta iterasi piksel di main thread).
  2. Constructor `BuildScene` & `WalkScene` membuat `skyTex` + PMREM sementara `envKey = ""`, lalu `updateProjectData()` pertama langsung membuang dan membuatnya ulang (**double-init**).
  3. `envKey` memakai `hourOfDay.toFixed(2)` sehingga menggeser slider waktu me-render ulang PMREM di GPU setiap 0,01 jam, padahal `createEnvironmentMap()` hanya punya **3 state diskrit** (`isNight`, `isStorm`, `day`).
  4. `roofCover` memasang `bumpMap` + `normalMap` ganda dari sumber heightmap yang sama (membuang 1 texture sampler & komputasi fragment shader).
  5. **Bug Dangling `envMap`**: Material di `propsBuilder.ts` menyalin `palette.aluDark.envMap` secara manual; saat `envTex` di-dispose waktu berubah, `palette.bindEnvMap()` tidak memperbarui material prop sehingga prop memegang tekstur WebGL yang sudah di-dispose.
- **Usulan Optimasi**: Cache sumber `HTMLCanvasElement`/tekstur prosedural pada modul singleton per sesi; hapus double-init constructor; cache 3 tekstur PMREM berdasarkan `pmremKey = `${isNight}|${isStorm}``; hapus `bumpMap` redundan pada `roofCover`; gunakan `scene.environment` secara standar (tanpa menyalin `envMap` manual ke prop).

---

### B. RAF Loop, Idle Rendering, Raycasting, BVH & Kebocoran Memori

#### `PF-06` — Render Loop 60fps Tanpa *Idle Gating* & `matrixAutoUpdate = true` pada Mesh Statis
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:2335-2477`; `src/features/walkMode/WalkScene.ts:825-926`; `src/features/buildMode/BuildCameraController.ts:399-468`; `src/features/buildMode/AtmospherePass.ts:65, 92`.
- **Masalah**:
  1. `BuildScene` dan `WalkScene` terus merender full post-processing (`RenderPass` + `GTAOPass` + `AtmospherePass` 40-sample raymarch + `UnrealBloomPass` 5-mip + `OutputPass`) 60×/detik bahkan saat kamera diam total dan tidak ada animasi (hujan/banjir/angin/kipas/explode).
  2. `BuildCameraController.update()` selalu memanggil `orthoCamera.updateProjectionMatrix()` (`line 467`) walau `useOrtho === false`.
  3. Tidak ada `matrixAutoUpdate = false` di seluruh codebase — Three.js mengalikan matriks dunia untuk ~300+ mesh statis dan ~150 mesh cutaway tersembunyi di setiap frame.
- **Usulan Optimasi**: Tambahkan *dirty flag* (`needsRender`) + cek konvergensi damping kamera + cek animasi aktif agar GPU istirahat (~0% load) saat diam total; jaga `orthoCamera.updateProjectionMatrix()` di balik `if (this.useOrtho)`; set `mesh.updateMatrix(); mesh.matrixAutoUpdate = false;` pada semua mesh statis rumah/lingkungan.

#### `PF-07` — Raycast Mengabaikan `built.pickables`, 2× Raycast per Mousemove, & Layout Thrashing
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1405-1420, 1467, 1477, 1605, 1806, 1912-1918`; `src/features/buildMode/BuildCameraController.ts:311`; `src/lib/scene/projectHouseBuilder.ts:558, 1938`.
- **Masalah**:
  1. `projectHouseBuilder.ts` sudah membangun array `built.pickables`, tetapi `BuildScene.ts:1409` mengabaikannya dan memanggil `raycaster.intersectObjects(this.houseContainer.children, true)` — menguji 4 `InstancedMesh` bata, ~150 mesh cutaway tersembunyi, pohon, contact disc, dll., tanpa `raycaster.firstHitOnly = true`.
  2. Pada mode `select`, `handlePointerMove` memanggil 2× full raycast dalam 1 event (`1912` dan `1605`).
  3. `getBoundingClientRect()` dipanggil 3–4× per `pointermove` → memicu *forced layout reflow*.
- **Usulan Optimasi**: Gunakan `built.pickables` (hanya yang `visible`) + `raycaster.firstHitOnly = true`, bagikan hasil 1× raycast di `handlePointerMove`, dan cache `canvasRect` pada `ResizeObserver`/`resize`.

#### `PF-08` — Alokasi GC Berat per Mousemove & 60 Hz Loop Walk Mode
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1607, 1642-1799`; `src/features/walkMode/WalkController.ts:290-296, 501`; `src/features/walkMode/collisionBuilder.ts:88, 623-725, 773`; `src/features/walkMode/WalkScene.ts:905, 1003`.
- **Masalah**:
  1. `updateToolPreview()` di `BuildScene` membuang dan mengalokasi `BoxGeometry` baru pada setiap pixel gerakan mouse — pada `floor_fill` (`1680-1685`) mengalokasi & me-merge **hingga 500 `BoxGeometry` per event mousemove**, ditambah `_hoverBox.setFromObject()` (`1607`).
  2. `SpatialHashGrid.key()` (`collisionBuilder.ts:88`) mengalokasi ~500–1.000 string `` `${gx},${gz}` `` per detik di 60 Hz; `WalkController.fixedTick` (`290-296`) mengalokasi `new Set` & `Array.from` 60×/detik; `WalkScene` memakai `fpsSamples.shift()` (`O(N)`) dan menyusun string 13-segmen `stateSig` tiap frame.
- **Usulan Optimasi**: Gunakan pool `InstancedMesh` tunggal untuk preview sel lantai/tool (update matriks tanpa dispose/recreate geometri) dan throttle `updateToolPreview` ke 1× per `requestAnimationFrame`; ganti key string `SpatialHashGrid` dengan integer bit-packing `(gx & 0xffff) | ((gz & 0xffff) << 16)`; reuse `Set`/object scratch di `WalkController`.

#### `PF-09` — 6 Kebocoran Resource GPU, BVH, & DOM Listener
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:457, 464-510, 579, 979, 1184-1190, 1351`; `src/features/walkMode/WalkScene.ts:532, 1026-1071`; `src/lib/scene/projectHouseBuilder.ts:96-144, 382-402, 512, 765, 1161, 1274, 1518, 1667, 1921`.
- **Masalah**:
  1. `disposeBoundsTree()` **tidak pernah dipanggil** sebelum `geometry.dispose()` (kebocoran memori struktur BVH di setiap rebuild), sementara beberapa geometri belum dipasang BVH dan downspout `TubeGeometry` dihitung BVH-nya 2× sia-sia.
  2. `sunLight.shadow.map` (**~64 MB** pada 4096² / **16 MB** pada 2048²) tidak di-dispose di `BuildScene.dispose()` & `WalkScene.dispose()`.
  3. `InstancedMesh.dispose()` tidak dipanggil untuk 4 `InstancedMesh` bata & `airParticlesMesh`.
  4. 12 `BufferGeometry` lingkungan di `buildStaticNeighborhood()` serta `gridMesh` (`BuildScene.ts:1184`) tidak masuk daftar `disposables`.
  5. Event listener `pointerleave` (`BuildScene.ts:457`) tidak dihapus di `dispose()`, dan `window.__RT_DEBUG__` (`579`) tidak dibersihkan — menahan seluruh graf `BuildScene` di heap.
- **Usulan Optimasi**: Buat helper `disposeGeometry(geo)` yang memanggil `geo.disposeBoundsTree?.(); geo.dispose();`; bersihkan `shadow.map`, seluruh `InstancedMesh`, 12 geometri lingkungan, `gridMesh`, `pointerleave`, dan `window.__RT_DEBUG__` di `dispose()`.

---

### C. CPU Main Thread, Engine Cascade & Hashing

#### `PF-10` — Kaskade 8 Engine Sinkron di `page.tsx` pada Setiap Mutasi `project`
- **Bukti Kode**: `src/app/page.tsx:190-200`; `src/lib/geometry/masonry.ts:81-288`; `src/lib/simulation/lightingEngine.ts:5-30, 130-252`; `src/lib/simulation/airflowEngine.ts:5-28, 76-263`.
- **Masalah**: Setiap perubahan kecil di `project` (termasuk ketik 1 angka harga RAB, geser slider jam, toggle suara, atau centang checklist lapangan) mengubah `project.updatedAt` dan menjalankan seluruh 8 `useMemo` secara sinkron:
  - `masonry.ts`: membangun ulang **~1.500–2.000 `BrickInstance`** (Hebel) hingga **~13.000–17.000 `BrickInstance`** (Bata Merah) + puluhan ribu objek `Interval` temporer, bahkan saat `showBricksOverlay === false`.
  - `lightingEngine.ts`: mengisi 2 grid `25×85` (`4.250` sel) × `13` lampu × `33` dinding (`segmentBlockedByWalls` ≈ 100.000+ uji segmen) meski panel Cahaya tertutup.
  - `airflowEngine.ts`: mengisi 6 `Float32Array(2125)` (`12.750` float) + `airflowBlockedByWalls` meski panel Udara tertutup.
  - `scheduleEngine.ts`: berjalan penuh meski workspace aktif adalah `build`/`walk`/`rab`/`drawings` (100% tidak dipakai).
- **Usulan Optimasi**:
  1. Pecah dependency `useMemo` per slice domain (`levels + brickSpec` untuk geometri/bata; `priceBook + rabSettings` untuk RAB; `simulation + levels` untuk simulasi) sehingga edit harga RAB atau jam matahari tidak membangun ulang 15.000 bata.
  2. Pisahkan `computeMasonryMetrics()` (ringkas, tanpa array `bricks[]`) dari `generateBrickInstances()` (lazy hanya saat `showBricksOverlay` / `showBricks` benar-benar dirender).
  3. Jalankan `buildScheduleSummary` hanya saat `workspace` adalah `timeline`/`site`/`deliver`.

#### `PF-11` — `JSON.stringify` Masif Berulang pada State Immer
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:893-929, 1144-1150`; `src/features/walkMode/WalkScene.ts:515-521`; `src/components/build/BuildWorkspace.tsx:355-357`.
- **Masalah**: Setiap klik seleksi objek atau geser slider `view` (`cutH`, `explode`, `ortho`), `BuildScene.updateProjectData()` menjalankan **2× `JSON.stringify()` puluhan KB** atas seluruh array `levels`, plus `applyWireframe()` melakukan `houseContainer.traverse()` meski boolean `wireframe` tidak berubah.
- **Usulan Optimasi**: Karena `useStudioStore` memakai `immer`, ganti `JSON.stringify` dengan **shallow reference comparison (`===`) per slice** (`project.levels`, `project.systems`, `project.site.peil`, `project.buildExtras`) — biaya turun dari `O(N)` (~1–2 ms + GC) ke **`O(1)` (~0,001 ms, 0 alokasi)**, dan hanya panggil `applyWireframe()` jika nilai `wireframe` berubah.

#### `PF-12` — Startup Hydration Double-Compute & Autosave Redundan
- **Bukti Kode**: `src/app/page.tsx:86-124`; `src/lib/store/useStudioStore.ts:188-194`; `src/lib/store/db.ts:34-58`.
- **Masalah**: Saat startup, aplikasi menjalankan seluruh 8 engine + init WebGL 3D untuk `createDefaultProject()`, lalu beberapa milidetik kemudian `loadLatestProject()` dari IndexedDB memanggil `loadProject()` yang **mengulang seluruh 8 engine + full rebuild WebGL untuk kedua kalinya**, lalu 600 ms kemudian autosave menulis ulang data identik kembali ke IndexedDB.
- **Usulan Optimasi**: Tahan komputasi simulasi berat hingga `hydrated === true` (atau gunakan `useDeferredValue`), dan catat `lastSavedProjectRef` saat load dari IndexedDB agar autosave tidak menulis ulang data yang baru dimuat.

---

### D. React Re-Render, Zustand/Zundo & DOM/SVG

#### `PF-13` — Badai Re-Render `BuildWorkspace` (60–120 Hz) & Bug Listener `WalkWorkspace` (11 Hz)
- **Bukti Kode**: `src/components/build/BuildWorkspace.tsx:207-262, 507-571, 592, 1295-1300, 1424`; `src/features/buildMode/store.ts:153-164`; `src/components/walk/WalkWorkspace.tsx:65, 134-148`.
- **Masalah**:
  1. `BuildWorkspace` (1.838 baris) men-subscribe `hover`, `previewHud`, `view` utuh, dan `stats` sekaligus. `setPreviewHud` tidak punya equality check → dipanggil 60–120×/detik saat mouse bergerak, merender ulang seluruh 1.838 baris (termasuk seluruh katalog, dropdown, dan `StudioSidePanel`) hanya untuk 1 pill kecil!
  2. `BuildWorkspace.tsx:507-571` me-rebind listener `keydown` setiap kali salah satu dari 14 dependency (`selected`, `studioPanel`, dll.) berubah.
  3. Di `WalkWorkspace.tsx:134-148`, `useEffect` untuk `KeyT` **tidak punya dependency array** → melepas dan memasang ulang `window.addEventListener("keydown")` ~11×/detik selama berjalan!
- **Usulan Optimasi**: Ekstrak komponen kecil `HoverGridPill`, `PreviewHudBanner`, dan `FpsBadge` agar men-subscribe slice masing-masing; tambahkan equality check pada `setPreviewHud`; tambahkan dependency array `[]` pada `WalkWorkspace.tsx:134-148` dan baca state via `getState()` di handler keyboard.

#### `PF-14` — Zundo Tanpa `equality` & Over-Subscription `StatusBar` / `TopBar`
- **Bukti Kode**: `src/lib/store/useStudioStore.ts:679-682`; `src/components/shell/StatusBar.tsx:37, 40-51`; `src/components/shell/TopBar.tsx:61-69`; `src/app/page.tsx:202-214, 246-256`.
- **Masalah**:
  1. `temporal()` tidak memiliki `equality`, sehingga setiap aksi UI (`setSelected`, `patchView`, `setWorkspace`, `setStudioPanel`) mendorong salinan `{ project }` identik ke stack Undo (memenuhi kuota 60 dan menahan memori).
  2. `StatusBar` men-subscribe objek `view` utuh padahal hanya memakai `view.ortho`; `TopBar` & `StatusBar` tidak memakai `React.memo`.
- **Usulan Optimasi**: Tambahkan `equality: (past, curr) => past.project === curr.project` di `temporal()`; ubah `StatusBar` ke `useStudioStore((s) => s.view.ortho)`; bungkus `TopBar` dan `StatusBar` dengan `React.memo`.

#### `PF-15` — Input Harga `RabWorkspace` Memicu 8 Engine per Keystroke & Tanpa Virtualisasi
- **Bukti Kode**: `src/components/workspaces/RabWorkspace.tsx:30-42, 248-310`; `package.json:30`.
- **Masalah**: `filteredDivisions` dihitung tanpa `useMemo`; setiap ketikan angka pada `<input>` harga langsung memanggil `updatePriceItem` → memicu 8 engine penuh di `page.tsx` per keystroke; `@tanstack/react-virtual` sudah terpasang di `package.json` tetapi tidak digunakan.
- **Usulan Optimasi**: Bungkus `filteredDivisions` dengan `useMemo`; gunakan *uncontrolled/local draft* pada input harga (commit pada `onBlur` / `Enter` atau debounce 250 ms); aktifkan virtualisasi jika daftar BOQ tumbuh panjang.

#### `PF-16` — Re-Reconcile SVG `DrawingsWorkspace` Saat Zoom & Listener `focusin` Permanen
- **Bukti Kode**: `src/components/workspaces/DrawingsWorkspace.tsx:29-43, 138, 152, 220-518`; `src/components/shell/CommandPalette.tsx:30-40`.
- **Masalah**: `DenahFloorSvg` (~220–320 node SVG), `PotonganMemanjangSvg`, dan `StrukturPlanSvg` tidak dibungkus `React.memo` (re-reconcile penuh tiap klik zoom) dan `openingsList` tanpa `useMemo`; `CommandPalette` memasang `document.addEventListener("focusin")` permanen meski tertutup.
- **Usulan Optimasi**: Bungkus komponen SVG dengan `React.memo` dan `openingsList` dengan `useMemo`; pasang listener `focusin` hanya saat `open === true`.

---

### E. Bundle Size, Code-Splitting & Web Worker

#### `PF-17` — 19 Dependensi Tak Terpakai, `jspdf` Statis & `StudioSidePanel` di Chunk Awal
- **Bukti Kode**: `package.json:14-52`; `src/lib/export/exporters.ts:1`; `src/app/page.tsx:19`; `src/components/build/StudioSidePanel.tsx:16-22`; `next.config.ts:3-8`.
- **Masalah**:
  1. **19 paket di `package.json` 0% terpakai**: 14 `@radix-ui/*` (`accordion`, `checkbox`, `dialog`, `label`, `popover`, `progress`, `scroll-area`, `select`, `separator`, `slider`, `slot`, `switch`, `tabs`, `tooltip`), plus `@tanstack/react-virtual`, `class-variance-authority`, `date-fns`, `react-resizable-panels`, `svg2pdf.js`.
  2. `jspdf` (~300+ KB) di-import statis di `exporters.ts:1` (berbeda dari `exceljs`/`jszip` yang sudah dynamic import).
  3. `StudioSidePanel` + 6 workspace panel anak + `StageTimelineBar` di-bundle statis ke chunk utama padahal awalnya tertutup (`studioPanel: "none"`).
  4. `next.config.ts` belum mengaktifkan `experimental: { optimizePackageImports: ["lucide-react"] }`.
- **Usulan Optimasi**: Hapus paket tak terpakai, ubah `jspdf` menjadi `await import("jspdf")`, lazy-load tab `StudioSidePanel` & `StageTimelineBar` via `next/dynamic`, dan aktifkan `optimizePackageImports: ["lucide-react"]`.

#### `PF-18` — Offload Komputasi Grid 25×85 & Bata Merah ke Web Worker (Zero-Copy `Float32Array`)
- **Bukti Kode**: `src/lib/simulation/lightingEngine.ts:135-230`; `src/lib/simulation/airflowEngine.ts:89-213`; `src/lib/geometry/masonry.ts:81-288`.
- **Masalah**: Ketiga komputasi murni numerik ini memblokir main thread (menyebabkan *dropped frames* pada orbit kamera 3D saat user menggeser slider waktu/angin atau mengganti jenis bata ke Bata Merah).
- **Usulan Optimasi**: Pindahkan `lightingEngine`, `airflowEngine`, dan `generateBrickInstances` ke Web Worker dengan *latest-only cancellation* dan transfer *zero-copy* `Float32Array.buffer` (`postMessage(res, [grid.buffer])`). Hasil visual & angka 100% identik, namun UI & kamera 3D tetap 60–120 FPS mulus.

---

## 3. Roadmap Eksekusi Performa yang Disarankan (3 Gelombang)

1. **Gelombang 1 — Quick Wins Zero-Risk (Dampak Terbesar, Cepat)**:
   - `PF-01` (`shadowMap.autoUpdate = false` + event-driven `needsUpdate`), `PF-02` (bata hidden di balik plester + `castShadow` hygiene), `PF-06` (*idle gating* RAF + `matrixAutoUpdate = false`), `PF-09` (tutup 6 kebocoran GPU/BVH/listener), `PF-11` (hapus `JSON.stringify` → shallow ref Immer), `PF-13` & `PF-14` (isolasi `HoverGridPill`/`PreviewHudBanner`/`FpsBadge`, fix `WalkWorkspace` deps, Zundo `equality`).
2. **Gelombang 2 — Pipeline Batching, Material Cache & Slice Memoization**:
   - `PF-03` (batch/instancing bukaan, furnitur, HVAC, lampu, lantai, tetangga → target **~115–145 draw calls**), `PF-04` (fixed-size light pool `BuildScene`), `PF-05` (singleton canvas texture cache + 3-state PMREM cache + fix dangling `envMap`), `PF-07` (pakai `built.pickables` + `firstHitOnly` + cache `canvasRect`), `PF-10` & `PF-12` (pecah 8 `useMemo` per domain slice + hilangkan startup double-compute).
3. **Gelombang 3 — Web Worker, DOM/SVG & Bundle Hygiene**:
   - `PF-08` (pool `InstancedMesh` preview + integer bit-packing `SpatialHashGrid`), `PF-15` & `PF-16` (debounce RAB, `React.memo` SVG `DrawingsWorkspace`), `PF-17` (bersihkan 19 paket, lazy `jspdf` & `StudioSidePanel`, `optimizePackageImports`), `PF-18` (Web Worker zero-copy `Float32Array` untuk lighting/airflow/bata).

---

> **Status Tahap Audit Performa: SELESAI — MENUNGGU PERSETUJUAN.**
> Silakan tinjau `AUDIT_PERFORMA.md` (`PF-01` s.d. `PF-18`) dan beri tahu apakah ingin membuat plan gabungan bersama `PLAN_BUILD.md`, atau langsung mengeksekusi gelombang tertentu.
