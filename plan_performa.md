# Rencana Eksekusi Komprehensif Optimasi Performa & Migrasi Baked AO — Gomahan

> **Referensi Audit:** `AUDIT_PERFORMA.md` (`PF-01` s.d. `PF-18`) + Keputusan Arsitektur **Penggantian `GTAOPass`/`SSAO` → Baked AO (`PF-00`)**  
> **Prinsip Mutlak:** **Zero Visual & Model Quality Degradation** — resolusi shadow map (`4096²` desktop / `2048²` walk), tekstur PBR prosedural (`1024²`), detail bevel/chamfer furnitur, `AtmospherePass` (sun shafts), `UnrealBloomPass`, MSAA HDR, jumlah bata aktual, dan resolusi grid simulasi (`25×85`) dipertahankan 100%, sementara kualitas *ambient occlusion* justru meningkat (bebas noise/halo screen-space dan aktif di semua tier termasuk mobile, hujan, banjir, dan section-cut).

---

## 1. Target Metrik Kuantitatif (Baseline vs Target)

| Metrik Performa | Baseline Saat Ini | Target Pasca Eksekusi | Sumber Peningkatan Utama |
| :--- | :--- | :--- | :--- |
| **Draw Calls Build Mode (High)** | `~369–382` calls/frame | **`~80–115` calls/frame** (−70%+) | Hapus GTAO G-Buffer pass (`PF-00`), `shadowMap.autoUpdate = false` (`PF-01`), batching/instancing (`PF-03`) |
| **Draw Calls Walk Mode** | `~369` calls/frame | **`~65–95` calls/frame** (−75%+) | Hapus GTAO pass (`PF-00`), merge dinding `WalkScene` + instancing prop (`PF-03`) |
| **Beban GPU Saat Adegan Diam (Idle)** | 60 FPS penuh (GPU aktif terus) | **`~0%` (Idle-Gated RAF)** | Dirty-flag rendering + konvergensi damping (`PF-06`) |
| **Stutter Toggle Lampu / Edit Ringan** | `50–300 ms` (shader recompile + full rebuild) | **`<4 ms`** (0 shader recompile) | Fixed-size light pool (`PF-04`) + Immer shallow-ref hash (`PF-11`) |
| **Transisi Tab Build ↔ Walk** | Ratusan ms (21 canvas + 6,3M px Sobel + PMREM) | **`<25 ms`** | Singleton canvas texture cache + 3-state PMREM cache (`PF-05`) |
| **CPU `pointermove` Build Mode** | 2× full raycast + 3–4× reflow + 60–120 Hz React re-render | **`−80%` CPU time**, 0 re-render `BuildWorkspace` | `built.pickables` + `firstHitOnly` + cache rect (`PF-07`) + isolasi pill HUD (`PF-13`) |
| **VRAM Leak per Unmount Build/Walk** | `~64 MB` shadow map + BVH + 12 geo + `InstancedMesh` | **`0 MB` leak** | `disposeBoundsTree()`, dispose `shadow.map`, `InstancedMesh`, listeners (`PF-09`) |
| **Ketik Harga RAB / Geser Slider Waktu** | Memicu 8 engine sinkron (~15k bata + 2× grid 25×85) | **`<2 ms` main thread** | Pecah `useMemo` per slice (`PF-10`) + debounce RAB (`PF-15`) + Web Worker (`PF-18`) |
| **Bundle & Dependensi** | 19 paket tak terpakai, `jspdf` statis, panel samping statis | **Chunk awal lebih ramping ~350–500 KB** | Hapus 19 paket, lazy `jspdf` & `StudioSidePanel`, `optimizePackageImports` (`PF-17`) |

---

## 2. Desain Arsitektur `PF-00`: Penggantian `GTAOPass`/`SSAO` → Sistem Baked AO 4-Lapisan

### 2.1 Penghapusan Bersih `GTAOPass` di `BuildScene.ts` & `WalkScene.ts`
- **File**: `src/features/buildMode/BuildScene.ts` (`:3, 236, 553-566, 599, 2436`), `src/features/walkMode/WalkScene.ts` (`:3, 65, 355-367, 388`), `src/features/buildMode/store.ts` (`:47`), `src/components/build/BuildWorkspace.tsx` (`:958`).
- **Langkah**:
  1. Hapus seluruh import `GTAOPass`, field `this.gtaoPass`, alokasi render target G-Buffer, panggilan `gtaoPass.setSize()`, `gtaoPass.dispose()`, dan logika bypass `gtaoPass.enabled = false` saat hujan/banjir/section-cut/software-rasterizer.
  2. Pertahankan stack HDR lainnya secara utuh: `RenderPass (MSAA HDR)` → `AtmospherePass` (sun shafts) → `UnrealBloomPass` → `OutputPass` (ACES Filmic + sRGB).
  3. Perbarui deskripsi tooltip di `BuildWorkspace.tsx:958` agar menyebut **Baked AO** alih-alih GTAO.
- **Keuntungan Langsung**: Menghilangkan **1× full-scene Depth+Normal geometry pass**, **3–4 fullscreen post-processing shader pass**, serta **~16–32 MB VRAM render target** di setiap frame pada Build Mode maupun Walk Mode.

### 2.2 Modul Baru: `src/lib/scene/bakedAo.ts` (Fast CPU Baked AO, `<5 ms` per Rebuild)
Karena pengguna dapat mengedit dinding, ruangan, tangga, dan furnitur secara interaktif di Build Mode, baking dilakukan secara deterministik & instan (<5 ms) saat `buildProjectHouse()` dipanggil, terdiri dari 4 lapisan yang saling melengkapi:

| Lapisan Baked AO | Target Geometri | Mekanisme Teknis (Three.js r187) | Biaya Runtime GPU |
| :--- | :--- | :--- | :---: |
| **Lapisan 1: Baked Floor & Ceiling 2D AO Map** | Lantai `lv.rooms`, `floorTiles`, teras, carport, plafon `slab:ceiling` | Generate 1 `CanvasTexture` / `DataTexture` grayscale (`256×512` untuk proporsi 5×17 m, auto-scale sesuai rasio `site`) per lantai: rasterisasi *soft distance-field AO* di sepanjang semua segmen `lv.walls` (radius `0.45 m`, sudut `0.62`, tepi `0.76`), proyeksi tangga & overhang LT2 (`0.72`), serta kolom. Pasang ke `material.aoMap` (`aoMapIntensity: 0.85`) dan set atribut **`uv1`** (standar Three.js r151+/r187) dari koordinat dunia `(x / site.width, z / site.depth)`. | **0 draw call tambahan** (1 texture lookup murah di fragment PBR) |
| **Lapisan 2: Analytical Vertex Crease AO** | Dinding (`fullGroup`, `cutawayGroup`), kolom, balok, soffit atap, tangga | Hitung nilai AO per vertex (`0.72..1.0`) saat membangun geometri: gelap halus di sambungan dinding–lantai (`y = 0..0.38 m`), dinding–plafon (`top - 0.32 m..top`), sudut dinding–dinding (adjacency ujung dinding `<= 120°`, radius `0.28 m`), sekeliling kusen bukaan (`0.84`), dan sisi bawah pelat/tangga (`0.78`). Simpan di atribut `aBakedAo` (1 float/vertex) dan suntikkan 3 baris via `onBeforeCompile` ke `#include <aomap_fragment>` (`ambientOcclusion *= vBakedAo;`) sehingga **hanya menggelapkan cahaya indirect/ambient (physically-based)** tanpa menggelapkan cahaya matahari langsung! | **0 draw call tambahan**, 0 texture sampler tambahan |
| **Lapisan 3: Instanced Contact AO Decals** | Seluruh furnitur, mobil, pohon/semak, plinth, unit outdoor AC | Ganti `addContactDisc` individual (`propsBuilder.ts:79-93`) menjadi **1 `InstancedMesh` per lantai** dengan tekstur *soft rounded-rect / radial contact AO* (`depthWrite: false`, `polygonOffset: true`). Saat furnitur di-drag di Build Mode, perbarui `setMatrixAt(idx, mat)` secara lokal di 60 FPS. | **1 draw call/lantai** (turun dari 23+ draw call) |
| **Lapisan 4: Procedural Micro-Cavity AO** | Material bata, kayu, keramik, batu andesit, atap (`materials.ts`) | Saat generasi tekstur heightmap prosedural di `materials.ts` (1× per sesi di cache singleton), kalikan sedikit *cavity darkening* (`0.88..1.0`) dari heightmap ke alur/nat tekstur albedo atau `aoMap` mikro. | **0 ms runtime** (dihitung 1× saat init tekstur) |

- **Integrasi Shader Aman**: Gunakan `material.customProgramCacheKey = () => "baked-ao-v1"` pada material yang memakai `onBeforeCompile` agar Three.js tetap me-cache & berbagi program shader tanpa kompilasi ganda.

---

## 3. Rencana Eksekusi Detail per Gelombang (4 Gelombang)

### Gelombang 1 — Penggantian Baked AO, Shadow On-Demand, Idle RAF, Leaks & React P0
**Target ID:** `PF-00`, `PF-01`, `PF-02`, `PF-06`, `PF-09`, `PF-11`, `PF-13`, `PF-14`  
**Estimasi Dampak:** Penurunan draw calls ~50%, idle GPU −95%, 0 VRAM leak, 0 React re-render storm saat mousemove.

| Langkah | File Target | Detail Implementasi Konkret |
| :--- | :--- | :--- |
| **1.1 Migrasi `GTAOPass` → Baked AO** | `src/lib/scene/bakedAo.ts` *(baru)*, `BuildScene.ts`, `WalkScene.ts`, `projectHouseBuilder.ts`, `materials.ts`, `BuildWorkspace.tsx` | Hapus `GTAOPass` dari `BuildScene` & `WalkScene`. Implementasikan 4 lapisan `bakedAo.ts`: `generateFloorAoTexture(level, site)`, `applyWallVertexAo(geo, wall, cornerMap)`, `attachBakedAoShader(mat)`, dan `InstancedMesh` contact AO. Pastikan semua mesh lantai/plafon memiliki atribut `uv1`. |
| **1.2 Event-Driven Shadow Map** | `BuildScene.ts:321-347`, `WalkScene.ts:202-222` | Set `renderer.shadowMap.autoUpdate = false`. Buat helper `markShadowDirty()` yang menyetel `renderer.shadowMap.needsUpdate = true` hanya saat: `rebuildFromProject` / `rebuildHouseAndLights`, `envKey` berubah, `explode` bergerak, `wallVisibility`/`activeLevel`/cutaway berubah, `draggingEntity` bergerak, atau pintu Walk Mode berubah. |
| **1.3 Brick Visibility & Shadow Caster Hygiene** | `BuildScene.ts:989`, `projectHouseBuilder.ts:317, 597-643, 787-932, 1071, 1214-1275` | Set `brickIM.visible = false` saat `showFinishing && !showBricksOverlay && explodeCurrent < 0.001 && clipPlane.constant > 10` (otomatis `true` saat Explode / Section Cut / Inspect Bata). Set `castShadow = false` pada `rail:glass-stair/balc`, `site:grass/carport/teras/entry-step`, `fnd:plinth`, `slab:ceiling`, `mergedWinGlass`, dan pondasi bawah tanah saat `showTerrain === true`. |
| **1.4 Idle-Gated RAF & `matrixAutoUpdate = false`** | `BuildScene.ts:2335-2477`, `WalkScene.ts:825-926`, `BuildCameraController.ts:399-468`, `AtmospherePass.ts:65, 92` | Tambah `requestRender()` / `needsRender` dirty flag. Cek `isAnimating = cameraMoving \|\| explodeAnimating \|\| rainVisible \|\| airParticlesActive \|\| floodVisible \|\| fansRunning \|\| draggingEntity`. Jika `!isAnimating && !needsRender`, skip `composer.render()` / `renderer.render()`. Guard `orthoCamera.updateProjectionMatrix()` di balik `if (this.useOrtho)`. Set `mesh.updateMatrix(); mesh.matrixAutoUpdate = false;` untuk semua mesh statis rumah & lingkungan. |
| **1.5 Tutup 6 Kebocoran GPU/BVH/DOM** | `BuildScene.ts:457-510, 579, 979, 1184, 1351`, `WalkScene.ts:532, 1026-1071`, `projectHouseBuilder.ts:96-402, 1274` | Buat `disposeGeometry(geo)` (`geo.disposeBoundsTree?.(); geo.dispose();`). Dispose `sunLight.shadow.map`, 4 `InstancedMesh` bata, `airParticlesMesh`, 12 `BufferGeometry` `buildStaticNeighborhood()`, `gridMesh`, `overlayGroup`, `previewGroup`, `simGroup`. Hapus listener `pointerleave` dan `delete window.__RT_DEBUG__` di `dispose()`. |
| **1.6 Ganti `JSON.stringify` → Immer Shallow Ref** | `BuildScene.ts:893-935, 1144-1150`, `WalkScene.ts:515-521`, `BuildWorkspace.tsx:355-357` | Hapus `JSON.stringify` masif; bandingkan referensi slice Immer (`prevLevels === project.levels`, `prevSystems === project.systems`, dll.) secara `O(1)`. Guard `applyWireframe()` hanya jika nilai boolean `wireframe` berubah. Pisahkan `useEffect` seleksi dari `updateProjectData`. |
| **1.7 Hentikan Badai Re-Render & Zundo Equality** | `useStudioStore.ts:679-682`, `features/buildMode/store.ts:164`, `BuildWorkspace.tsx`, `WalkWorkspace.tsx:134-148`, `StatusBar.tsx:37`, `TopBar.tsx` | Tambah `equality: (past, curr) => past.project === curr.project` di `temporal()`. Tambah equality check di `setPreviewHud`. Ekstrak `HoverGridPill`, `PreviewHudBanner`, `FpsBadge` di `BuildWorkspace.tsx`. Perbaiki `useEffect` `KeyT` di `WalkWorkspace.tsx:134-148` dengan deps `[]` (baca via `getState()`). Ubah `StatusBar` subscribe ke `s.view.ortho` saja + bungkus `TopBar` & `StatusBar` dengan `React.memo`. |

- **Verifikasi Gelombang 1**: Cek `renderer.info.render.calls` turun drastis, verifikasi visual Baked AO di sudut ruangan/bawah furnitur/tangga pada siang & malam, cek heap/VRAM stabil setelah 10× pindah tab Build ↔ Walk, `tsc`/`eslint`/`vitest` 100% lulus.

---

### Gelombang 2 — Batching/Instancing, Fixed Light Pool, Material/PMREM Cache & BVH Pickables
**Target ID:** `PF-03`, `PF-04`, `PF-05`, `PF-07`  
**Estimasi Dampak:** Base mesh turun ~295 → ~115 (−61%), 0 shader recompile saat toggle lampu, transisi Build ↔ Walk `<25 ms`, CPU `pointermove` −70–85%.

| Langkah | File Target | Detail Implementasi Konkret |
| :--- | :--- | :--- |
| **2.1 Singleton Texture Cache & 3-State PMREM Cache** | `src/lib/scene/materials.ts`, `BuildScene.ts:171, 335, 369, 390, 804-815`, `WalkScene.ts:213, 240, 465-471` | Buat cache modul `getCachedTextureCanvases(scale)` sehingga 21 kanvas & 8 Sobel normal map hanya dihitung 1× per sesi browser. Hapus double-init `skyTex` & PMREM di constructor (`envKey` inisialisasi langsung pada update pertama). Cache 3 tekstur PMREM (`day`, `night`, `storm`) berdasarkan `pmremKey = `${isNight}|${isStorm}`` agar geser slider `hourOfDay` 0× render ulang PMREM. Hapus `bumpMap` redundan pada `roofCover`. Hapus manual `envMap: palette.aluDark.envMap` di `propsBuilder.ts` (andalkan `scene.environment`) untuk menutup bug *dangling `envMap`*. |
| **2.2 Material Caching di `propsBuilder.ts`** | `src/lib/scene/propsBuilder.ts:103-121, 366-569, 640-755`, `projectHouseBuilder.ts:502-524, 646-656` | Ganti alokasi `new MeshPhysicalMaterial` / `new MeshStandardMaterial` per-item dengan `palette.getPropMaterial(key, factory)` yang di-cache berdasarkan `(type, hex, roughness, metalness, sheen, on/off, kelvin)`. Pangkas ~85+ material duplikat menjadi ~18–22 shared material. |
| **2.3 Batching & Instancing Mesh Repetitif** | `projectHouseBuilder.ts:108-426, 732-735, 1121, 1214-1234, 1334-1554, 1632-1800`, `propsBuilder.ts` | 1) Gabung bucket lantai ruangan per material (`floor${lvIdx}:${matKey}`), bukan per `room.id` (−10 mesh). 2) Gabung bucket env & tetangga yang bermaterial sama (`curbMat`, `aluDark`, `lisplank`, bollard) (−15 mesh). 3) Gabung `rail:glass` dan bucket atap se-`explodeOff` (−3 mesh). 4) Pada `WalkScene` (`supportWallCutaway: false`), merge dinding plester per `(level, material)` (−27 mesh). 5) Gunakan `InstancedMesh` (dengan map `instanceId → entityId` untuk picking!) untuk bukaan berulang (kusen, kaca, vent), furnitur berulang (`kloset_set`, `tropical_plant`, `sofa_2`, `bed_single`, `wardrobe`, `desk`), HVAC/condenser (pisahkan hanya rotor kipas berputar), dan light fixtures (housing + bulb) (−100+ mesh). |
| **2.4 Fixed-Size Hardware Light Pool di `BuildScene`** | `BuildScene.ts`, `projectHouseBuilder.ts:1758-1800` | Alokasikan pool permanen di `BuildScene` (mis. `14 SpotLight` + `2 PointLight` dengan `intensity = 0` saat tidak terpakai), mencerminkan pola `WalkScene.ts:306-310`. Saat lampu diubah/di-toggle, cukup update posisi, warna, dan intensitas slot pool — **0 add/remove light, 0 shader recompilation**. |
| **2.5 Raycast `built.pickables`, `firstHitOnly` & Cache `canvasRect`** | `BuildScene.ts:1405-1420, 1467, 1477, 1605, 1806, 1912-1918`, `BuildCameraController.ts:311`, `projectHouseBuilder.ts:512, 765, 1161, 1518, 1667, 1921` | Simpan `this.pickableMeshes = built.pickables` dan raycast hanya terhadap mesh visible di array tersebut (melewati 4 `InstancedMesh` bata & ~150 mesh cutaway tersembunyi). Aktifkan `this.raycaster.firstHitOnly = true`. Gabungkan 2× raycast di `handlePointerMove` menjadi 1×. Cache `canvasRect` pada `ResizeObserver`/`resize` di `BuildScene` & `BuildCameraController`. Lengkapi `attachBvh` pada stub/condenser/pool/terrain/septic dan hapus `attachBvh` ganda pada downspout sebelum merge. |

- **Verifikasi Gelombang 2**: Cek draw calls Build Mode ~80–115 & Walk Mode ~65–95; klik/pilih/drag/eyedropper semua instanced prop tetap 100% akurat lewat `instanceId`; toggle lampu 0 ms shader hitch; ganti tab Build ↔ Walk `<25 ms`.

---

### Gelombang 3 — Slice Memoization, Startup Hydration, GC Hygiene & DOM/SVG
**Target ID:** `PF-08`, `PF-10`, `PF-12`, `PF-15`, `PF-16`  
**Estimasi Dampak:** Eliminasi kaskade 8 engine pada edit non-geometris, startup 40–50% lebih cepat, 0 GC stutter di Walk Mode & mousemove.

| Langkah | File Target | Detail Implementasi Konkret |
| :--- | :--- | :--- |
| **3.1 Pecah 8 `useMemo` per Domain Slice & Lazy Masonry Bricks** | `src/app/page.tsx:190-200`, `src/lib/geometry/masonry.ts:81-288`, `src/lib/geometry/projectModel.ts:58-195` | 1) Pisahkan `computeMasonryMetrics()` (tanpa array `bricks[]`) dari `generateBrickInstances()` (hanya dijalankan saat `showBricksOverlay === true` atau `view.showBricks && (explode > 0 \|\| cutH < 12)`). 2) Pecah dependency `useMemo` di `page.tsx`: `derived` bergantung pada `[project.site, project.levels, project.systems, project.brickSpec]`; `rab` pada `[derived, struct, project.priceBook, project.rabSettings, project.floodMitigation]`; `schedule` hanya dihitung jika `workspace === "timeline" \|\| workspace === "site" \|\| workspace === "deliver"`; `flood` hanya pada `[derived, project.site.peil, project.floodMitigation, project.simulation.rainIntensityMmH, project.simulation.floodDepthCm]`. |
| **3.2 Hilangkan Startup Double-Compute & Redundant Autosave** | `src/app/page.tsx:86-124`, `src/lib/store/db.ts` | Tunda komputasi `lighting`, `airflow`, dan `gamification` hingga `hydrated === true`. Catat `lastSavedProjectRef.current = check.data` saat `loadProject` dari IndexedDB agar effect autosave 600 ms tidak menulis ulang data yang baru dimuat. Tambah batas retensi `db.snapshots` (mis. maks 20 snapshot terbaru). |
| **3.3 Pool Preview `InstancedMesh` & Zero-GC Walk Loop** | `BuildScene.ts:1607, 1642-1799`, `WalkController.ts:290-296, 501`, `collisionBuilder.ts:88, 623-725, 773`, `WalkScene.ts:905, 1003` | 1) Di `BuildScene`, ganti alokasi hingga 500 `BoxGeometry` per mousemove pada `floor_fill` dengan 1 `InstancedMesh` pool (kapasitas 500, cukup `count = n` & `setMatrixAt`) + throttle `updateToolPreview` ke 1× per `rAF`. 2) Di `collisionBuilder.ts:88`, ganti key string `` `${gx},${gz}` `` dengan integer bit-packing `((gx + 32768) << 16) | (gz + 32768)`. 3) Reuse scratch `Set`/object di `WalkController.fixedTick` & `sampleWalkSurface`; ganti `fpsSamples.shift()` dengan *ring buffer* berukuran tetap. |
| **3.4 Optimasi `RabWorkspace`, `DrawingsWorkspace` & `CommandPalette`** | `RabWorkspace.tsx:30-42, 248-310`, `DrawingsWorkspace.tsx:29-43, 138, 220-518`, `CommandPalette.tsx:30-40` | Bungkus `filteredDivisions` & `openingsList` dengan `useMemo`. Gunakan local draft state pada `<input>` harga RAB (commit pada `onBlur`/`Enter` atau debounce 250 ms) agar mengetik angka tidak memicu re-compute RAB/8 engine per keystroke. Bungkus `DenahFloorSvg`, `PotonganMemanjangSvg`, `StrukturPlanSvg` dengan `React.memo`. Pasang listener `focusin` di `CommandPalette` hanya saat `open === true`. |

---

### Gelombang 4 — Web Worker Zero-Copy, Bundle Hygiene & Verifikasi Menyeluruh
**Target ID:** `PF-17`, `PF-18`  
**Estimasi Dampak:** Main thread 60–120 FPS mulus saat simulasi cahaya/udara/bata berjalan; bundle lebih kecil & bersih.

| Langkah | File Target | Detail Implementasi Konkret |
| :--- | :--- | :--- |
| **4.1 Web Worker Zero-Copy untuk Simulasi & Bata** | `src/workers/simulationWorker.ts` *(baru)*, `src/lib/simulation/workerClient.ts` *(baru)*, `src/app/page.tsx` | Pindahkan kalkulasi grid `25×85` `lightingEngine.ts`, `airflowEngine.ts`, dan `generateBrickInstances()` (khususnya Bata Merah ~15k bata) ke Web Worker dengan antrean *latest-only cancellation* (request ID). Transfer `Float32Array.buffer` secara *zero-copy* (`postMessage(res, [lt1LuxGrid.buffer, ...])`). Sediakan fallback sinkron otomatis untuk lingkungan SSR/Vitest (`typeof Worker === "undefined"`). |
| **4.2 Pembersihan 19 Paket & Code-Splitting** | `package.json:14-52`, `src/lib/export/exporters.ts:1`, `src/components/build/StudioSidePanel.tsx:16-22`, `src/components/build/BuildWorkspace.tsx:40-52`, `next.config.ts` | 1) Hapus 19 dependensi tak terpakai di `package.json` (14 `@radix-ui/*`, `@tanstack/react-virtual`, `class-variance-authority`, `date-fns`, `react-resizable-panels`, `svg2pdf.js`). 2) Ubah `import { jsPDF } from "jspdf"` menjadi `const { jsPDF } = await import("jspdf")` di fungsi ekspor PDF saja. 3) Lazy-load 6 konten tab `StudioSidePanel` & `StageTimelineBar` via `next/dynamic`. 4) Tambahkan `experimental: { optimizePackageImports: ["lucide-react"] }` di `next.config.ts`. |

---

## 4. Sinkronisasi dengan `PLAN_BUILD.md` (Bila Dieksekusi Bersama)

Karena `PLAN_BUILD.md` dan `PLAN_PERFORMA.md` sama-sama menyentuh `BuildScene.ts`, `projectHouseBuilder.ts`, `useStudioStore.ts`, `BuildWorkspace.tsx`, dan `page.tsx`, urutan paling aman tanpa konflik adalah:
1. **Jalankan Gelombang 1 `PLAN_PERFORMA.md` terlebih dahulu** (Baked AO, shadow on-demand, idle RAF, leaks, Zundo equality, Immer shallow ref, isolasi pill HUD) — ini langsung membersihkan fondasi `BuildScene` & `BuildWorkspace`.
2. **Jalankan Fase 1–2 `PLAN_BUILD.md`** (Cutaway, wall-graph, dual-side paint, validasi 2D/OBB, tangga/kolam) langsung di atas fondasi Baked AO & Immer shallow ref yang sudah bersih.
3. **Jalankan Gelombang 2–3 `PLAN_PERFORMA.md`** (Instancing/batching final yang sudah memahami wall-graph & dual-side wall, light pool, material cache, slice memoization, zero-GC Walk Mode).
4. **Jalankan Fase 3–4 `PLAN_BUILD.md` + Gelombang 4 `PLAN_PERFORMA.md`** (Poles UX Sims 4, Web Worker, pembersihan bundle, dan seluruh test suite).

---

## 5. Protokol Pengujian, Benchmark & Kriteria Lulus

Setiap gelombang wajib lulus 4 gerbang verifikasi sebelum dianggap selesai:
1. **Checks Statis & Build**:
   - `npm run typecheck` (`tsc --noEmit`) — 0 error.
   - `npm run lint` (`eslint .`) — 0 error/warning.
   - `npm run build` (`next build`) — lulus tanpa error & verifikasi ukuran chunk `.next/static/chunks`.
2. **Unit & Regression Tests (`vitest run`)**:
   - Tambah test di `src/tests/performance.test.ts` *(baru)*:
     - `bakedAo`: verifikasi `generateFloorAoTexture` menghasilkan nilai `< 255` di sepanjang dinding & `255` di area terbuka, serta `uv1` terpasang di geometri lantai.
     - `zundo equality`: verifikasi aksi UI (`setSelected`, `patchView`, `setWorkspace`) tidak menambah `pastStates.length`.
     - `Immer shallow ref`: verifikasi mutasi `hourOfDay` / `priceBook` tidak mengubah referensi `project.levels`.
     - `SpatialHashGrid`: verifikasi integer bit-packing key bebas tabrakan untuk seluruh rentang koordinat kavling (termasuk koordinat negatif).
     - `Simulation Worker fallback`: verifikasi hasil `lightingEngine` & `airflowEngine` identik secara numerik dengan baseline sebelum optimasi.
3. **Verifikasi Visual & Runtime Parity**:
   - Pastikan **0 regresi visual**: shadow 4096²/2048² tetap tajam, tekstur PBR 1024² tetap utuh, Baked AO terlihat halus pada sudut dinding-lantai, bawah tangga, dan bawah furnitur di siang & malam, sun shafts & bloom tetap aktif, dan Walk Mode tetap mulus tanpa flicker.
   - Ukur `renderer.info.render.calls`, `renderer.info.memory.geometries` / `.textures` (setelah 5× siklus Build ↔ Walk untuk memastikan 0 leak), serta FPS desktop & mobile.

---

> **Siap Eksekusi:** Plan ini mencakup penggantian **GTAO/SSAO → Baked AO 4-Lapisan (`PF-00`)** beserta seluruh 18 temuan `AUDIT_PERFORMA.md` (`PF-01` s.d. `PF-18`) dalam 4 gelombang terukur. Beri tahu apakah Anda ingin saya langsung mulai mengeksekusi **Gelombang 1** (atau menjalankan urutan gabungan bersama `PLAN_BUILD.md`).
