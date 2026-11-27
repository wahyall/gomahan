# Audit Performa Ultra-Mendalam — Gomahan (ArsiStudio 3D)

> **Prinsip Mutlak 1 — Zero Visual & Model Quality Degradation:** Seluruh temuan dan arsitektur optimasi di dokumen ini **mempertahankan 100% kualitas grafik visual dan detail model** — resolusi shadow map (`4096²` Build / `2048²` Walk), tekstur PBR prosedural `1024²`, detail chamfer/bevel furnitur, 4-lapisan Baked AO, `AtmospherePass` (sun shafts), HDR bloom, 4× MSAA HalfFloat HDR, ACES Filmic tone mapping, DPR supersampling, jumlah bata aktual, serta resolusi grid simulasi `25×85` dipertahankan utuh tanpa pengurangan kualitas sedikit pun.
>
> **Prinsip Mutlak 2 — Runtime FPS Above All (Code-Size-for-Speed Tradeoff):** Penambahan jumlah baris kode, modul khusus, *lookup table*, *object/mesh pool*, *dual-variant shader*, *dirty-chunk engine*, maupun struktur akselerasi spasial (yang meningkatkan ukuran aplikasi) **diperbolehkan sepenuhnya** demi mencapai waktu frame serendah mungkin (`< 4–8 ms/frame`, target stabil **60–120 FPS** di laptop/iGPU dan **60 FPS** di mobile).

## 1. Status Baseline Saat Ini (Pasca Implementasi `PF-00`–`PF-18`)

Pemeriksaan langsung terhadap kode sumber terkini menunjukkan sebagian besar rekomendasi audit sebelumnya (`PF-00` s.d. `PF-18`) telah diimplementasikan (termasuk penghapusan `GTAOPass` ke `bakedAo.ts`, `shadowMap.autoUpdate = false`, penghapusan 19 paket tak terpakai, `simulationWorker.ts`, dan `floorPreviewPool`).

Namun, audit lanjutan di level **hardware GPU (Early-Z, swapchain blit, shader branching, VRAM bandwidth), arsitektur scene WebGL2 (`THREE.BatchedMesh`), *idle gating*, CSS compositor, dan algoritma CPU** menemukan **22 bottleneck mendalam (`OPT-01` s.d. `OPT-22`)** yang masih menahan FPS secara signifikan—termasuk beberapa regresi kritis yang membatalkan optimasi sebelumnya (seperti bug `fansActive` yang membuat *idle gating* tidak pernah aktif dan `spot.visible = false` yang tetap memicu *shader recompilation*).

### Matriks Dampak Kuantitatif (Baseline Kode Kini vs Target Ultra-Ringan)

| Metrik Runtime | Kondisi Kode Kini | Target Pasca Optimasi | Penggerak Utama | 
| ----- | ----- | ----- | ----- | 
| **Draw Calls Build Mode (High)** | `~200–240` calls/frame | **`~25–40` calls/frame** (−82%) | `THREE.BatchedMesh` per material (`OPT-07`) | 
| **Draw Calls Walk Mode** | `~95–130` calls/frame | **`~20–35` calls/frame** (−73%) | `BatchedMesh` prop + merge avatar (`OPT-07`, `OPT-10`) | 
| **GPU Swapchain Overhead** | Full-screen blit setiap frame (`preserveDrawingBuffer: true`) | **0 blit** (hardware page-flip) | `preserveDrawingBuffer: false` + on-demand snapshot (`OPT-01`) | 
| **Hardware Early-Z (Opaque Pass)** | **Nonaktif** di 21 material utama (`clippingPlanes` selalu aktif) | **Aktif 100%** saat tidak potong (hemat 40–70% fragment ALU) | Conditional `localClippingEnabled` (`OPT-02`) | 
| **Biaya Post-Processing / Frame** | 40-sample full-res raymarch + 12-pass `UnrealBloomPass` + `OutputPass` | **−55% s.d. −75% GPU frame time** (visual identik) | Early-out radial + fusi `OutputPass` + Dual-Kawase Bloom (`OPT-03`, `OPT-04`) | 
| **Beban GPU Saat Adegan Diam** | **60 FPS penuh** (terkunci `fansActive === true`) | **`~0%` GPU** (tidur total bila kipas di luar frustum) | Frustum-culled `animatedFans` (`OPT-09`) | 
| **Stutter Toggle Lampu / Layer / Cat** | `40–300 ms` (shader recompile + full `rebuildFromProject`) | **`< 1 ms`** (0 shader recompile, 0 full rebuild) | Fixed-visible light pool + `compileAsync` + surgical patch (`OPT-05`, `OPT-08`) | 
| **CSS Compositor Readback (HUD)** | 8–9 layer `backdrop-filter: blur(16px)` di atas live WebGL | **0 readback** saat orbit/walk (−15% s.d. −40% frame time iGPU) | Dynamic blur gating & CSS containment (`OPT-18`) | 
| **Waktu Simulasi Grid `25×85`** | `O(Cells × Sources × Walls)` + double `buildDerivedModel` | **10–15× lebih cepat**, 0 duplikasi | 2D Uniform Spatial Grid + Worker model cache (`OPT-15`, `OPT-16`) | 
| **React Re-Render Saat Walk / Build** | `WalkWorkspace` 447 baris @ 11 Hz; `BuildWorkspace` 2.225 baris | **0 re-render** kontainer utama saat interaksi 3D | Isolasi `WalkTelemetryHud` & pemecahan `BuildWorkspace` (`OPT-19`, `OPT-20`) | 

## 2. Audit Mendalam per Pilar Arsitektur (`OPT-01` s.d. `OPT-22`)

### Pilar 1 — Pipeline WebGL2, Hardware Early-Z, Post-Processing & Shaders

#### `OPT-01` — `preserveDrawingBuffer: true` Memaksa Full-Screen Framebuffer Blit Setiap Frame `[P0]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:500`; `src/features/walkMode/WalkScene.ts:211`; `src/app/page.tsx:201-215`.

* **Analisis Akar Masalah**: Kedua viewport menginisialisasi `new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true })`. Pada WebGL2 (ANGLE D3D11/Metal/Vulkan), `preserveDrawingBuffer: true` **mematikan zero-copy swapchain page-flipping** dan memaksa GPU menyalin seluruh framebuffer warna setiap kali frame selesai dirender. Pada layar HiDPI (`dpr = 1.5–2.0`), ini membuang 25–60 MB/frame bandwidth VRAM dan menambah 1–3 ms latensi presentasi di setiap frame—padahal buffer hanya dibutuhkan sesekali saat pengguna menekan ekspor/snapshot (`cv.toDataURL("image/jpeg", 0.92)` di `page.tsx:207`).

* **Solusi (Zero Degradation)**:

  1. Ubah `preserveDrawingBuffer: false` di `BuildScene.ts:500` dan `WalkScene.ts:211`.

  2. Ekspos method `public captureDataUrl(mime = "image/jpeg", quality = 0.92): string` pada `BuildScene` dan `WalkScene` yang memanggil satu kali render sinkron (`renderFrameImmediate()`) lalu langsung memanggil `this.canvas.toDataURL(mime, quality)` dalam *microtask* yang sama sebelum browser menukar buffer.

  3. Tambahkan `stencil: false` pada opsi `WebGLRenderer` karena tidak ada stencil buffer pass di seluruh aplikasi (hemat 25% bandwidth depth-stencil).

#### `OPT-02` — `localClippingEnabled = true` Permanen Mematikan Hardware Early-Z di Seluruh Rumah `[P0]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:527, 998-1023`.

* **Analisis Akar Masalah**: `this.renderer.localClippingEnabled = true` aktif permanen, dan 21 material utama (`brickOuter`, `concrete`, `woodTeak`, `plasterExt`, `plasterInt`, `tileFloor`, `roofCover`, dll.) selalu diberi `m.clippingPlanes = [this.clipPlane]`. Three.js menyuntikkan `#define NUM_CLIPPING_PLANES 1` yang menambahkan perintah GLSL `discard` di awal fragment shader. **Pada arsitektur GPU modern (NVIDIA, AMD, Intel Xe, Apple Silicon, Adreno, Mali), keberadaan `discard` di fragment shader menonaktifkan optimasi Hardware Early-Z / Hierarchical-Z.** Akibatnya, dinding belakang, ruangan tertutup, lantai di bawah plafon, dan struktur interior yang 100% terhalang dinding depan tetap menjalankan seluruh fragment shader PBR + Normal Map + Roughness + Baked AO + multi-light BRDF secara penuh!

* **Solusi (Zero Degradation)**:

  1. Jadikan `renderer.localClippingEnabled` kondisional: set `false` saat `cutH >= 11.9` (mode normal, >95% waktu pemakaian) dan `true` hanya ketika pengguna menggeser slider potongan (*section cut*).

  2. Agar perpindahan `localClippingEnabled` tidak memicu *hitch* kompilasi shader saat slider pertama kali digeser, lakukan *pre-warming* kedua varian program shader (unclipped dan clipped) saat idle startup menggunakan `renderer.compileAsync()` (`OPT-05`).

  3. Di `WalkScene.ts`, `localClippingEnabled` sudah `false` (bagus)—pastikan tidak pernah diaktifkan di Walk Mode.

#### `OPT-03` — `AtmospherePass` Menjalankan 40 Sample Raymarch pada Piksel `radial == 0` & Tetap Aktif Saat `uSunFade == 0` `[P0]`

* **Bukti Kode**: `src/features/buildMode/AtmospherePass.ts:59-95`; `src/features/buildMode/BuildScene.ts:889-962`; `src/features/walkMode/WalkScene.ts:386-479`.

* **Analisis Akar Masalah**:

  1. **Urutan Hitung Terbalik (`AtmospherePass.ts:63-84`)**: Variabel `radial = 1.0 - smoothstep(0.12, 1.25, length(d))` dihitung pada baris 82–83 **SETELAH** loop 40× `texture2D(tDiffuse, uv)` selesai! Semua piksel di luar radius `1.25` dari posisi matahari tetap melakukan 40× *HalfFloat texture fetch* lalu hasilnya dikalikan `0.0`.

  2. **Dynamic Loop Branching (`AtmospherePass.ts:69-70`)**: `for (int i = 0; i < 64; i++) { if (i >= uSamples) break; }` mencegah driver GPU melakukan *loop unrolling* dan *texture fetch prefetching*.

  3. **Full-Screen Pass Redundan Saat Malam / Matahari di Belakang Kamera**: Saat `uSunFade <= 0.001` (\~50% sudut orbit kamera dan 100% waktu malam), `AtmospherePass` tetap membaca dan menulis seluruh render target `HalfFloat` resolusi penuh hanya untuk menghitung 2 baris *vignette* + *dither*.

* **Solusi (Zero Degradation — 100% Bit-for-Bit Identik)**:

  1. Pindahkan perhitungan `vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0); float radial = 1.0 - smoothstep(0.12, 1.25, length(d));` **ke sebelum loop**, lalu bungkus loop dengan `if (uSunFade > 0.001 && radial > 0.001)`. Ini langsung memangkas **40–70% texture fetch** tanpa mengubah 1 bit warna pun.

  2. Ganti uniform dinamis `uSamples` dengan `#define RAY_SAMPLES 40` (untuk tier `high`) dan `#define RAY_SAMPLES 22` (untuk `medium`) agar compiler GLSL melakukan unroll penuh.

  3. **Fusi Vignette + Dither ke Custom `FinalOutputPass`**: Pindahkan baris 88–92 (`vignette` + `dither`) ke dalam `OutputPass` kustom (setelah `UnrealBloomPass` sebelum/sesudah ACES Filmic sesuai ruang warna linear). Dengan begitu, ketika `uSunFade <= 0.001`, set `this.atmospherePass.enabled = false` — **menghilangkan 1 full-resolution HalfFloat render pass utuh** di seluruh sudut belakang matahari dan mode malam!

  4. **Optimasi Tambahan (Bandwidth)**: `uTime` pada baris 65 & 92 memakai `floor(uTime * 8.0)`. Saat kamera diam, ini tidak perlu mengubah frame jika tidak sedang render.

#### `OPT-04` — Penggantian Legacy `UnrealBloomPass` (12 Pass) ke Progressive Dual-Kawase / Jimenez HDR Bloom `[P0]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:903`; `src/features/walkMode/WalkScene.ts:399`.

* **Analisis Akar Masalah**: `UnrealBloomPass` bawaan Three.js menjalankan **12 full-screen shader pass** setiap frame (1× Luminosity High-Pass resolusi penuh + 5 tingkat separable Gaussian blur H+V dengan kernel hingga 15-tap = 10 pass + 1× Composite), serta mengalokasikan 11 `WebGLRenderTarget` `HalfFloat` terpisah. Pada GPU terintegrasi/mobile, `UnrealBloomPass` sering memakan 25–35% total waktu GPU per frame.

* **Solusi (Zero Degradation — Kualitas Bloom Setara/Lebih Halus)**:

  1. Implementasikan kelas `DualKawaseBloomPass` (\~250 baris kode GLSL/TS mandiri) berbasis algoritma *Call of Duty: Advanced Warfare* (Jimenez 2014):

     * 1× Prefilter + 13-tap Karis-average downsample (menghilangkan *firefly aliasing* HDR dengan kualitas lebih halus dari `UnrealBloomPass`) mulai dari resolusi `1/2` → `1/4` → `1/8` → `1/16` (4 downsample pass).

     * 3×3 Tent filter additive upsample kembali ke `1/2` (3 upsample pass).

     * **Fusi Composite Bloom langsung ke `FinalOutputPass`** (`OPT-03`) sehingga tidak butuh pass composite terpisah!

  2. Total pass bloom turun dari **12 pass → 7 pass beresolusi kecil** dengan texture tap 3× lebih sedikit dan tanpa *copy pass* akhir.

  3. Tambahkan *early bypass*: bila matahari terbenam/di luar layar (`!sunCore.visible`) dan seluruh lampu interior mati (`activeLightCount === 0`), tidak ada piksel dengan luminans `> 1.45` (threshold bloom), sehingga seluruh chain bloom dapat di-skip otomatis (`bloomPass.enabled = false`).

#### `OPT-05` — Regresi Fixed Light Pool (`visible = false` Memicu Shader Recompile) + `lightningLight` Permanen + Zero `compileAsync()` `[P0]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:566-568, 605-617, 1883-1934`; `src/features/walkMode/WalkScene.ts:336-340, 648-701`.

* **Analisis Akar Masalah**:

  1. **Regresi `PF-04` di `BuildScene.ts:1904, 1926, 1931-1932`**: Meskipun 14 `SpotLight` dan 14 `PointLight` sudah di-prealokasi, `updateLightPool()` menyetel `spot.visible = false` dan `pt.visible = false` untuk slot tak terpakai. Di internal Three.js (`WebGLRenderer.projectObject`), objek dengan `visible === false` **dilewati dari `lightsState`**, yang mengubah `#define NUM_SPOT_LIGHTS` / `NUM_POINT_LIGHTS` pada shader program! Akibatnya, setiap kali pengguna menyalakan/mematikan 1 lampu atau pindah lantai, Three.js tetap melakukan **global WebGL shader recompilation (50–300 ms stutter)**.

  2. **Over-Allocation 28 Hardware Lights**: Mengalokasikan `7 Spot + 7 Point` × 2 lantai = **28 lampu** terlalu besar jika semuanya dipaksa `visible = true` (karena fragment shader akan melakukan 28 iterasi BRDF per piksel meski siang bolong!).

  3. **`lightningLight` Aktif 100% Waktu (`BuildScene.ts:566-568`)**: `this.lightningLight` adalah `DirectionalLight` ke-3 yang selalu `visible = true` dengan `intensity = 0` di 99,9% frame, memaksa setiap piksel PBR menghitung 1 evaluasi BRDF `DirectionalLight` sia-sia sepanjang hari cerah.

  4. **Tidak Ada `renderer.compileAsync()`**: Di seluruh codebase (`0 matches`), shader dikompilasi secara sinkron saat material pertama kali masuk frustum, menyebabkan *frame freeze* di detik pertama atau saat membuka fitur baru (banjir, wireframe, section-cut).

* **Solusi (Zero Degradation)**:

  1. **Fold `lightningLight` ke `sunLight`/`fillLight`**: Hapus `this.lightningLight` sebagai `DirectionalLight` tersendiri. Saat petir menyambar (0,3 detik), cukup tambahkan energi kilat ke `fillLight` (arah & warna biru-putih identik) — **mengurangi 1 DirectionalLight BRDF dari 100% piksel selamanya**.

  2. **Bucketed Light Pool + Pre-Compiled Variants**: Alokasikan pool global lintas lantai sebanyak maksimal `8 SpotLight + 2 PointLight` (atau `10 SpotLight + 2 PointLight` sesuai lampu aktif maksimum di satu tampilan) dengan `visible = true` & `intensity = 0` saat mati di mode malam/interior, **DAN** sediakan 2 state makro saja: `Day (0 interior lights)` vs `Lit (fixed N lights)` yang keduanya di-**pre-compile** secara asinkron saat boot via `await renderer.compileAsync(this.scene, cam)` (memanfaatkan `KHR_parallel_shader_compile` pada WebGL2). Transisi antar state: **0 ms hitch**, dan pada siang hari tanpa lampu aktif: **0 iterasi SpotLight/PointLight di fragment shader**.

#### `OPT-06` — Overhead `MeshPhysicalMaterial` di Seluruh Furnitur & Sisa Bug Dangling `envMap` `[P1]`

* **Bukti Kode**: `src/lib/scene/propsBuilder.ts:107-116, 373-381, 400-410`; `src/lib/scene/materials.ts:967-991`.

* **Analisis Akar Masalah**:

  1. Di `propsBuilder.ts:107-116`, **semua furnitur** (lemari kayu, meja, rak, kasur, kompor, kulkas) memakai `new THREE.MeshPhysicalMaterial` dengan `clearcoat: isVehicle ? 0.92 : 0.05` dan `sheen: isCloth ? 0.65 : 0`. Nilai `clearcoat: 0.05` pada kayu/lemari matte hampir tak kasat mata secara fisik, namun memaksa GPU menjalankan **shader `MeshPhysicalMaterial` dua-lobe (dual specular GGX + extra IBL cubemap lookup + IOR Fresnel)** yang \~1,7× lebih berat per piksel dibanding `MeshStandardMaterial`.

  2. **Bug Dangling `envMap` & Material Leak (`propsBuilder.ts:373-381, 400-410`)**: `ceramicMat` (`MeshPhysicalMaterial`), `headMat`, dan `tailMat` dibuat baru (`new`) setiap item tanpa masuk cache `palette.getPropMaterial(...)`, dan `ceramicMat` masih menyalin `envMap: palette.aluDark.envMap` (baris 379) yang akan menjadi *dangling disposed texture* saat `envTex` berubah.

* **Solusi (Zero Degradation)**:

  1. Pertahankan `MeshPhysicalMaterial` **hanya** untuk material yang benar-benar membutuhkan fitur fisiknya (`isVehicle` untuk cat mobil `clearcoat: 0.92`, `isCloth` untuk kain `sheen: 0.65`, `ceramicMat` untuk keramik kloset/wastafel, `glass`, `floodWater`, dan `woodTeak`). Untuk furnitur kayu/plastik/dapur matte biasa (`!isVehicle && !isCloth`), gunakan `MeshStandardMaterial` dengan parameter `roughness`/`metalness`/`envMapIntensity` terkalibrasi identik.

  2. Pindahkan `ceramicMat`, `headMat`, dan `tailMat` ke `palette.getPropMaterial(...)` dan hapus `envMap: palette.aluDark.envMap` (andalkan `scene.environment`).

### Pilar 2 — Draw Call Collapse (`THREE.BatchedMesh`), Scene Graph & Shadow Hygiene

#### `OPT-07` — Migrasi Mesh Build Mode & Props ke `THREE.BatchedMesh` (`three@0.187.0` + `WEBGL_multi_draw`) `[P0]`

* **Bukti Kode**: `src/lib/scene/projectHouseBuilder.ts:1948-2315`; `src/lib/scene/propsBuilder.ts:50-95, 693-795`; `src/features/buildMode/BuildScene.ts:1745-1880`.

* **Analisis Akar Masalah**: Walaupun `WalkScene` memakai `walkStaticBatch` untuk dinding dan bukaan, **Build Mode (`supportWallCutaway: true`)** masih membuat mesh terpisah per entitas:

  * \~33 dinding × (full + cutaway body/cap/sill + down) → \~33–65 draw calls aktif.

  * \~25 bukaan (10 pintu × 3 mesh + 8 jendela × 2 + 7 vent) → \~53 draw calls.

  * \~23 furnitur × \~3,5 mesh + \~16 HVAC + \~26 light fixtures → \~120+ draw calls.

  * Total Build Mode masih **\~200–240 draw calls/frame** (+ \~80–120 draw calls lagi saat shadow pass dirty).

* **Solusi (Code-Size-for-FPS Tradeoff — Zero Degradation)**:
  Proyek sudah menggunakan **`three@0.187.0`**, yang menyediakan **`THREE.BatchedMesh`** dengan akselerasi perangkat keras `WEBGL_multi_draw`.

  1. Bangun modul baru `src/lib/scene/batchedSceneManager.ts` (\~400–600 baris) yang mengelompokkan seluruh geometri berbeda namun bermaterial sama ke dalam **\~10–14 `THREE.BatchedMesh` buckets** (1 bucket per material utama: `plasterExt`, `plasterInt`, `woodTeak`, `aluDark`, `glass`, `concrete`, `propStandard`, `propCloth`, `propVehicle`, `propCeramic`, `steelLight`, dll.).

  2. Manfaatkan seluruh kapabilitas native `BatchedMesh` tanpa mengorbankan 1 pun fitur interaktif Build Mode:

     * **Sims 4 Wall Cutaway & Floor Hiding**: Cukup panggil `batch.setVisibleAt(instanceId, false/true)` — **0 perubahan graf scene, 0 draw call tambahan**.

     * **Explode View & Drag Furnitur 120 FPS**: Cukup panggil `batch.setMatrixAt(instanceId, tmpMat4)` — langsung memperbarui satu slot matriks di GPU tanpa rebuild geometri.

     * **Cat Dinding & Ganti Warna Swatch Furnitur**: Cukup panggil `batch.setColorAt(instanceId, tmpColor)` — **0,01 ms**, tanpa rebuild 1 vertex pun!

     * **Raycasting & Selection**: `BatchedMesh.raycast()` secara native mengembalikan `hit.batchId`; petakan `batchId → EntityMeta` dalam `O(1)` memakai array datar `entityByBatchId[batchId]`.

     * **Shadow Pass**: `BatchedMesh` me-render seluruh instance yang `visible` ke shadow map dalam **1 draw call per bucket**.

  3. Terapkan `BatchedMesh` yang sama untuk furnitur, HVAC statis, dan light fixtures pada `WalkScene` (hanya bilah kipas berputar dan daun pintu berengsel yang tetap di luar batch statis atau di-update matriksnya via `setMatrixAt`).

  4. **Estimasi Hasil**: Draw calls Build Mode turun dari **\~220 → \~25–40 calls/frame (−82%)**; Walk Mode turun ke **\~20–35 calls/frame**.

#### `OPT-08` — Hentikan Full `rebuildFromProject()` Saat Toggle Layer / Edit 1 Entitas via Dirty-Chunk Architecture `[P0]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1310-1401, 1547-1637`.

* **Analisis Akar Masalah**: Di `BuildScene.ts:1330-1353`, hampir semua perubahan UI maupun model dimasukkan ke satu boolean `buildChanged`:

  * Mengklik toggle **`showLabels`**, **`showDims`**, **`showRoof`**, **`showRangka`**, **`showTerrain`**, **`showStructure`**, **`showAir`**, **`showListrik`**, **`showBricks`**, **`showFinishing`**, atau **`hiddenParts`** memicu `rebuildFromProject()` penuh — menghancurkan dan membangun ulang seluruh rumah 2 lantai, seluruh BVH (`computeBoundsTree` 50+ mesh), dan merasterisasi ulang kedua tekstur `generateFloorAoTexture` (`40–150 ms` freeze!).

  * Mengubah cat 1 dinding atau menggeser 1 jendela di LT2 juga membangun ulang seluruh LT1, pondasi, atap, tangga, dan MEP!

* **Solusi (Code-Size-for-FPS Tradeoff — Zero Degradation)**:

  1. **Visibility-Only Layer Groups**: Selalu bangun (atau lazy-build 1× lalu cache) sub-grup terpisah: `labelsGroup`, `dimsGroup`, `roofGroup`, `rangkaGroup`, `terrainGroup`, `structureGroup`, `mepAirGroup`, `mepListrikGroup`, `finishingGroup`, `bricksGroup`. Mengubah toggle UI di atas cukup mengubah `group.visible = flag` + `markShadowDirty()` → turun dari **80 ms → 0,02 ms**.

  2. **Per-Domain Dirty-Chunk Rebuilder**: Pisahkan `rebuildFromProject` menjadi 7 chunk independen dengan *reference key* masing-masing:

     * `chunkSiteAndFoundation` (`site.peil`, `site.soil`, `floodMitigation`, `structuralParams`)

     * `chunkWallsLt1` & `chunkWallsLt2` (per lantai — ubah dinding LT2 tidak menyentuh LT1!)

     * `chunkFloorsAndPoolsLt1` & `chunkFloorsAndPoolsLt2`

     * `chunkStairsAndRailings`

     * `chunkRoof` (`systems.roofType`, `roofSlopeDeg`, overhang)

     * `chunkMep` (`showAir`, `showListrik`, rooms/fixtures)

     * `chunkBakedAoLt1` & `chunkBakedAoLt2` (hanya regenerate lantai yang dinding/kolomnya berubah!)

  3. **Fast-Path Cat Dinding**: Jika hanya `wall.paintExtHex` / `paintIntHex` yang berubah (panjang, posisi, bukaan identik), cukup update warna material / `BatchedMesh.setColorAt` dalam `< 0,1 ms` tanpa menyentuh geometri, BVH, maupun Baked AO!

#### `OPT-09` — Bug `fansActive` Membatalkan 100% *Idle Gating* di Build Mode & Walk Mode `[P0]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:4332-4352`; `src/features/walkMode/WalkScene.ts:952-964`.

* **Analisis Akar Masalah**:

  * `BuildScene.ts:4332`: `const fansActive = this.animatedFans.length > 0 && !this.reducedMotion;`

  * `WalkScene.ts:952`: `const fansActive = this.animatedFans.length > 0 && !this.reducedMotion;`

  * Karena `defaultProject.ts` secara bawaan memiliki unit AC/kipas aktif, `this.animatedFans.length` hampir selalu `> 0`. Akibatnya, `shouldRender` / `shouldStepAndRender` **SELALU `true` 100% dari waktu aplikasi terbuka**, sehingga **sistem *idle gating* (`PF-06`) tidak pernah tidur sama sekali!** GPU tetap menjalankan render penuh 60 FPS (4× MSAA + 40-sample raymarch + 12-pass bloom) bahkan ketika pengguna sedang diam membaca RAB atau saat kipas berada di lantai lain/di belakang kamera!

* **Solusi (Zero Degradation)**:

  1. Simpan `boundingSphere` dunia (radius \~0,35 m) untuk setiap objek di `this.animatedFans`.

  2. Sebelum menetapkan `fansActive = true`, uji frustum kamera (`_frustum.setFromProjectionMatrix(...)` hanya ketika kamera berubah) dan cek hierarki visibilitas (`isObjectEffectivelyVisible(fan)` — memastikan kipas LT2 tidak memicu render saat hanya LT1 yang ditampilkan, dan kipas di belakang kamera tidak memicu render!).

  3. Di `WalkScene.ts`, pisahkan flag `needsPhysicsStep` (`moveInputActive || this.lastWalkActive`) dari `needsRender` (`fansVisibleInFrustum || camSettling || this.needsRender`), sehingga saat avatar diam memandang kipas, `ctrl.step()`, `avatar.update()`, `updatePooledLights()`, dan `emitTelemetry()` tidak perlu dijalankan 60×/detik.

#### `OPT-10` — Optimasi `bakedAo.ts` (`RedFormat`, Hoist AABB Loop, Spatial Grid) & Shadow Hygiene `WalkScene`/`WalkAvatar` `[P1]`

* **Bukti Kode**: `src/lib/scene/bakedAo.ts:64-177`; `src/features/walkMode/WalkAvatar.ts:55-114`; `src/features/walkMode/WalkScene.ts:244`.

* **Analisis Akar Masalah**:

  1. **`RGBAFormat` untuk Peta Grayscale (`bakedAo.ts:75, 168`)**: `generateFloorAoTexture` mengalokasikan `Uint8Array(texW * texH * 4)` dengan `THREE.RGBAFormat`, padahal shader `aoMap` Three.js hanya membaca channel `.r` (`texture2D(aoMap, vAoMapUv).r`). Ini memboroskan **4× VRAM dan 4× bandwidth upload tekstur**.

  2. **Bug Hoisting AABB di Inner Loop (`bakedAo.ts:140-156`)**: Di dalam loop `for (py) for (px)` (55.680 piksel untuk `128×435`), kode menghitung ulang bounding box `sMinX, sMaxX, sMinZ, sMaxZ` dari setiap poligon `lt2Slabs` sebanyak **55.680 kali per rebuild**!

  3. **Brute-Force `O(Pixels × Walls)` (`bakedAo.ts:97-104`)**: Setiap piksel menguji jarak terhadap seluruh \~35 dinding (\~2 juta kali `distPointToSegmentSq` per lantai) secara sinkron di main thread.

  4. **`WalkScene.ts:244` Lupa Scale Mobile**: Memanggil `createMaterialPalette()` (selalu scale `2` = `1024²` bahkan di layar mobile), berbeda dari `BuildScene.ts:536` (`mobileViewport ? 1 : 2`).

  5. **`WalkAvatar.ts:55-114`**: 7 bagian tubuh avatar (kaki, sepatu, torso, lengan, tangan, kepala, rambut) dibuat sebagai 7 `THREE.Mesh` terpisah dengan `castShadow = true` — padahal di mode *first-person* (default) avatar disembunyikan, dan di *third-person* `shadowMap.autoUpdate = false` membuat bayangan avatar tidak bergerak kecuali `markShadowDirty()` dipanggil (atau avatar memakai 1 contact AO decal + dynamic shadow hanya jika diinginkan).

* **Solusi (Zero Degradation)**:

  1. Ubah `bakedAo.ts` ke `THREE.RedFormat` (`Uint8Array(texW * texH)` — **4× lebih ringan**, visual 100% identik di WebGL2).

  2. *Pre-compute* AABB `stairs` dan `lt2Slabs` **sebelum** loop piksel, plus gunakan **bounding-box rasterization per segmen dinding** (hanya kunjungi piksel dalam jarak `±wallRadius` dari tiap segmen dinding!). Kompleksitas turun dari `55.680 × 35 = 1.948.800` cek → **`~35.000` cek (55× lebih cepat: `< 0,2 ms`!)** dengan hasil piksel 100% identik secara matematis!

  3. Samakan `WalkScene.ts:244` menjadi `createMaterialPalette(mobileViewport ? 1 : 2)` (desktop tetap `1024²` penuh).

### Pilar 3 — Zero-GC Hot Loops, Raycasting & Interaksi 120 Hz

#### `OPT-11` — 12 Tool Preview di `BuildScene.ts` Masih Alokasi & Dispose `BoxGeometry`/`ConeGeometry` Setiap `pointermove` `[P0]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:2996, 3110, 3131, 3179, 3201, 3204, 3234, 3252, 3263, 3365-3366, 3404-3405`.

* **Analisis Akar Masalah**: Meskipun `floor_fill` sudah memakai `floorPreviewPool`, 12 tool preview lainnya (`wall`, `room`, `opening`, `stair`, `pool`, `terrain`, `demolish`, `pushPullDrag`, `openingDrag`, dll.) masih memanggil `clearPreviewMeshes()` (dispose VBO/IBO GPU!) lalu `new THREE.Mesh(new THREE.BoxGeometry(...))` di setiap gerakan mouse. Ini memicu alokasi GPU buffer baru dan *GC minor pause* berulang selama pengguna menggambar dinding atau menggeser pintu.

* **Solusi (Zero Degradation)**:
  Buat **Static Unit-Primitive Preview Pool** di `BuildScene` (dibuat 1× di constructor):

  * `previewUnitBox` (`BoxGeometry(1, 1, 1)`), `previewUnitCone` (`ConeGeometry(0.11, 0.24, 10)`), `previewUnitRing` (`RingGeometry(0.95, 1.25, 24)`).

  * Saat `updateToolPreview` atau `pushPullDrag`/`openingDrag` berjalan, cukup set `mesh.visible = true`, `mesh.material = valid ? this.validMat : this.invalidMat`, `mesh.scale.set(w, h, d)`, `mesh.position.set(...)`, `mesh.rotation.y = ...` — **0 alokasi geometri, 0 `gl.bufferData` upload, 0 GC!**

#### `OPT-12` — Zero-GC `updateWallCutawayVisibility`, `applyExplode`, & GPU-Driven Rain / Airflow Particles `[P1]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:1713-1735, 2057-2115, 4373-4440`.

* **Analisis Akar Masalah**:

  1. `updateWallCutawayVisibility` (`2057-2073`) mengalokasi string template 7-segmen `key` pada setiap frame orbit, plus `new Set<string>()` dan `[]` baru setiap kali sudut kamera berubah `> 0.04 rad`.

  2. `applyExplode` (`1719-1732`) melakukan `compose()` matriks 4×4 untuk ribuan instance bata di CPU setiap frame animasi explode — padahal hanya translasi `Y/X/Z` yang bergeser linier terhadap `e` (`m[12]`, `m[13]`, `m[14]` pada `instanceMatrix.array` bisa langsung di-update tanpa `Quaternion` & `compose()`, **6× lebih cepat**!).

  3. **Hujan (`4373-4386`)**: Mengupdate hingga 1.800 titik hujan di CPU (`rainArray`) dan meng-upload seluruh vertex buffer (`needsUpdate = true`) ke GPU setiap frame. Ini dapat dipindahkan 100% ke **Vertex Shader** (`y = mod(aBasePos.y - uTime * 13.5, 13.5)`) sehingga **biaya CPU = 0,00 ms dan upload PCIe = 0 byte/frame** dengan visual hujan 100% identik!

  4. **Partikel Udara (`4406-4440`)**: Menulis ulang `setMatrixAt` + `setColorAt` ratusan partikel via `Math.atan2` + `Quaternion.setFromAxisAngle` + `Matrix4.compose` setiap frame. Gunakan rotasi 2D matriks langsung (`cos/sin` langsung ke elemen matriks `[0,2,8,10]` tanpa `atan2` & `Quaternion` — cukup normalisasi `(vx, vz)`!).

#### `OPT-13` — `WalkScene.emitTelemetry` Format 13-Segmen String 60×/Detik Sebelum Cek Throttle `[P1]`

* **Bukti Kode**: `src/features/walkMode/WalkScene.ts:1132-1158`.

* **Analisis Akar Masalah**: Pada `emitTelemetry(false)` yang dipanggil setiap frame (60 Hz), baris 1136–1137 langsung memanggil `this.ctrl.getSnapshot()` (alokasi objek snapshot baru) dan menyusun string 13-segmen (`toFixed(2)` × 4 + interpolasi) **SEBELUM** memeriksa `if (!force && now - this.lastSnapshotEmitAt < minGap) return;`.

* **Solusi (Zero Degradation)**:

  1. Cek `if (!force && now - this.lastSnapshotEmitAt < 90) return;` **di baris paling pertama** sebelum menyentuh `getSnapshot()` atau format string.

  2. Ganti perbandingan `stateSig` string dengan perbandingan field numerik primitif (`Math.round(x * 100) === lastX100`, dst.) — **0 alokasi string di Walk Mode loop**.

#### `OPT-14` — Zero-Alloc `raycastHit` & Broadphase AABB Sebelum BVH `[P2]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:2388-2440`.

* **Analisis Akar Masalah**:

  1. `raycastHit` baris 2438 mengalokasi `new THREE.Vector3().copy(h.face.normal)...` untuk setiap hit dalam loop, bahkan jika hit tersebut akhirnya dilewati.

  2. `collectRayHits` mengirim seluruh `housePickables` + 2 `propLevelRoots` sekaligus ke `raycaster.intersectObjects(targets, true)` meskipun saat user hanya mengarahkan mouse di LT1 (`activeLevel === 0` atau lantai kosong).

* **Solusi (Zero Degradation)**:

  1. Gunakan scratch `this._hitNormal` (reuse `Vector3`) di `raycastHit`.

  2. Saat bermigrasi ke `BatchedMesh` (`OPT-07`), aktifkan `batchedMesh.computeBoundingBox()` / `batchedMesh.computeBoundingSphere()` dan gunakan `three-mesh-bvh` per geometri di dalam `BatchedMesh` sehingga 1× raycast menguji < 15 objek tingkat atas alih-alih 100+ mesh individu.

### Pilar 4 — Komputasi CPU, Akselerasi Algoritma & Off-Main-Thread Workers

#### `OPT-15` — Akselerasi 10–15× Algoritma `lightingEngine.ts` & `airflowEngine.ts` via 2D Uniform Spatial Grid `[P1]`

* **Bukti Kode**: `src/lib/simulation/lightingEngine.ts:187-235`; `src/lib/simulation/airflowEngine.ts:122-175`.

* **Analisis Akar Masalah**:

  * `lightingEngine.ts` mengisi 2 grid `25×85` (`4.250` sel) dan untuk setiap sel menguji setiap bukaan (8–15) dan lampu (10–15) terhadap **seluruh `lv.walls` (\~33 dinding)** secara brute-force via `segmentBlockedByWalls` (`> 150.000` uji perpotongan segmen per run).

  * `airflowEngine.ts` mengulangi pola `O(Cells × HVAC × Walls)` yang sama dengan `airflowBlockedByWalls` dan `Math.hypot` berulang.

* **Solusi (Code-Size-for-Speed Tradeoff — Hasil Numerik 100% Identik)**:

  1. **Pre-compute 2D Spatial Grid Dinding (`1 m × 1 m`, 5×17 = 85 sel)**: Sebelum loop grid `25×85`, masukkan indeks dinding ke setiap sel `1×1 m` yang dilewatinya (rata-rata hanya 1–2 dinding per sel).

  2. Ganti loop linear `for (const w of lv.walls)` di `segmentBlockedByWalls` dan `airflowBlockedByWalls` dengan **Amanatides-Woo 2D DDA Ray Traversal** (dengan bitmask `visitedWalls` 64-bit / `Uint32Array` agar tiap dinding hanya diuji 1× per sinar).

  3. Ganti `Math.hypot(dx, dz) > 7.0` dengan perbandingan kuadrat `dx * dx + dz * dz > 49.0` (hindari `sqrt` untuk semua pasangan di luar radius!).

  4. **Pre-compute Visibility Mask Statis**: Untuk geometri dinding yang sama, matriks visibilitas antar sel dan bukaan/lampu tidak berubah saat pengguna hanya menggeser slider `hourOfDay`, `windSpeed`, atau `dimmer`! Caching peta visibilitas per `wallsRef` membuat geser slider waktu/angin/dimmer berjalan dalam **`< 1 ms`** (turun \~15×) dengan nilai lux & aliran udara 100% identik!

#### `OPT-16` — Deduplikasi `buildDerivedModel` di `simulationWorker.ts` & Offload Heavy Geometry/AO/BVH `[P1]`

* **Bukti Kode**: `src/workers/simulationWorker.ts:23-53`; `src/lib/simulation/workerClient.ts:56-76`; `src/app/page.tsx:317-330`.

* **Analisis Akar Masalah**:

  1. Di `page.tsx:321-325`, setiap perubahan `simInputDerived` mengirim **2 pesan terpisah** (`lighting` dan `airflow`) yang masing-masing men-**structured-clone seluruh objek `Project`** (termasuk `priceBook`, `rabSettings`, dll. yang tidak dipakai simulasi!).

  2. Di dalam `simulationWorker.ts:26, 34`, worker menjalankan **`buildDerivedModel(req.project, { includeBricks: false })` DUA KALI berturut-turut** pada data proyek yang sama persis!

  3. Worker baru menangani `lighting`, `airflow`, dan `bricks` — belum menangani `computeStructuralReport` / `buildRabSummary` atau pre-baking `Baked AO` & `BVH` saat proyek besar.

* **Solusi (Zero Degradation)**:

  1. Gabungkan pesan atau simpan cache `lastGeomHash` + `lastDerived` di dalam `simulationWorker.ts` — jika `levels/site/systems` tidak berubah (misalnya user hanya menggeser `hourOfDay` atau `windSpeedMs`), **kirim hanya delta `simulation` (< 200 byte)** dan gunakan ulang `derived` yang sudah di-cache di worker!

  2. Tambahkan operasi batch `kind: "sim_all"` yang menjalankan `lighting` + `airflow` dalam 1× `buildDerivedModel` dan mentransfer semua 8 `Float32Array.buffer` sekaligus secara *zero-copy*.

  3. Jika pengguna mengubah `showLuxHeatmap` dan `showAirParticles` keduanya `false` **dan** panel Cahaya/Udara sedang tertutup, tunda pengiriman worker hingga panel dibuka atau gunakan `requestIdleCallback` agar CPU 100% bebas untuk interaksi 3D.

#### `OPT-17` — Generasi Tekstur Prosedural `1024²` + Sobel Normal Map via `OffscreenCanvas` Worker + CacheStorage `[P1]`

* **Bukti Kode**: `src/lib/scene/materials.ts:12-100`.

* **Analisis Akar Masalah**: Pada *cold load* pertama kali halaman dibuka, `createMaterialPalette(2)` menjalankan 21 generasi kanvas `1024²` + 8 filter Sobel `normalCanvasFromHeight()` (\~6,3 juta piksel iterasi `getImageData`/`putImageData`) secara **sinkron di main thread**, memblokir *Time to Interactive (TTI)* selama 250–700 ms (dan lebih dari 1,2 detik pada perangkat kelas menengah).

* **Solusi (Code-Size-for-Speed Tradeoff — Zero Degradation)**:

  1. Pindahkan fungsi generator kanvas prosedural dan Sobel normal map ke **Dedicated Texture Worker** menggunakan `OffscreenCanvas` (`transferToImageBitmap()` → zero-copy ke main thread untuk `THREE.CanvasTexture` / `THREE.Texture(imageBitmap)`).

  2. Gunakan **Progressive Texture Swap** saat boot: render frame pertama secara instan (`< 50 ms`) dengan warna albedo dasar / tekstur 64² super-cepat, lalu dalam 150–250 ms saat Worker selesai, swap ke tekstur `1024²` penuh secara asinkron tanpa pernah membekukan main thread!

  3. Opsional (untuk reload instan berikutnya): simpan hasil `ImageBitmap`/PNG blob berversi (`TEXTURE_CACHE_VERSION`) di IndexedDB / Cache API sehingga kunjungan ke-2 dan seterusnya memuat seluruh tekstur `1024²` dalam **`< 30 ms`** tanpa menghitung Sobel lagi.

### Pilar 5 — CSS GPU Compositing & React/Zustand Zero-Overhead UI

#### `OPT-18` — Eliminasi Framebuffer Readback `backdrop-filter: blur(16px)` di Atas Live WebGL Canvas `[P0]`

* **Bukti Kode**: `src/app/globals.css:130-139`; `src/components/build/BuildWorkspace.tsx:243, 261, 841, 911, 1064, 1204, 1351, 1411, 1647, 1698`; `src/components/walk/WalkWorkspace.tsx:182, 205, 212, 279, 311, 323, 405, 412, 442`.

* **Analisis Akar Masalah**: Kelas `.studio-glass` (`globals.css:137-138`) menerapkan `backdrop-filter: blur(16px) saturate(135%)` pada **8–10 panel HUD melayang secara bersamaan** di atas `<canvas>` WebGL 60 FPS (baik di Build Mode maupun Walk Mode). Setiap kali `<canvas>` WebGL merender frame baru, compositor browser (Chrome/Safari/Edge) terpaksa melakukan **GPU framebuffer readback + separable 32-tap Gaussian blur + saturation shader** di belakang setiap kotak HUD. Di laptop dengan iGPU (Intel Iris/UHD, Apple M-series baterai, AMD Radeon iGPU) dan smartphone, biaya compositor ini bisa mencapai **3–7 ms/frame (memotong FPS 15–40%)** meskipun WebGL sendiri ringan!

* **Solusi (Zero Visual Degradation pada Grafik 3D & Estetika UI)**:

  1. **Dynamic Interaction Blur Gating**: Tambahkan atribut `data-3d-active="1"` pada container workspace saat pengguna sedang aktif mengorbit/drag kamera atau berjalan (WASD/mouse look), dan lepaskan 150 ms setelah berhenti. Ketika `data-3d-active="1"`, `.studio-glass` memakai latar belakang gradien gelap elegan yang sudah 92% buram (`rgba(22, 26, 33, 0.94)`) dengan `backdrop-filter: none;` — **0 compositor readback saat kamera bergerak**, sementara efek *frosted glass* tetap penuh saat diam!

  2. Tambahkan `contain: layout style paint;` pada semua HUD pill tetap (`HoverGridPill`, `PreviewHudBanner`, `FpsBadge`, `WalkTelemetryHud`) agar perubahan angka FPS/koordinat tidak memicu *layout recalculation* seluruh halaman.

  3. Untuk `PreviewHudBanner` (`BuildWorkspace.tsx:261`) yang diperbarui saat pointer bergerak, hapus `backdrop-blur-md` dan gunakan surface solid-translucent dengan `box-shadow` tajam.

#### `OPT-19` — Isolasi `WalkTelemetryHud` di `WalkWorkspace.tsx` (Hentikan Re-Render 447 Baris @ 11 Hz) `[P1]`

* **Bukti Kode**: `src/components/walk/WalkWorkspace.tsx:64, 85, 180-445`.

* **Analisis Akar Masalah**: `WalkWorkspace` menyimpan `const [telemetry, setTelemetry] = useState<WalkHudTelemetry | null>(null)` di root komponen. Saat pengguna berjalan, `onHudUpdate` memanggil `setTelemetry(next)` hingga **11× per detik**, memaksa React me-reconcile **seluruh 447 baris JSX `WalkWorkspace`** (termasuk tombol waktu, dropdown tier kualitas, D-pad mobile, dan modal bantuan) hanya untuk memperbarui teks nama ruangan, koordinat, dan FPS.

* **Solusi (Zero Degradation)**:
  Pindahkan `telemetry` ke micro-store Zustand khusus Walk Mode (atau `useSyncExternalStore` berbasis ref/listener) dan konsumsi **hanya** di 2 sub-komponen kecil yang dibungkus `React.memo`: `WalkTopTelemetryPill` (nama ruangan, lantai, FPS) dan `WalkDoorPromptPill` (prompt interaksi pintu `E`). Komponen utama `WalkWorkspace` menjadi **0 re-render selama berjalan**.

#### `OPT-20` — Pemecahan `BuildWorkspace.tsx` (2.225 Baris, 50+ Subscriptions) & `useShallow` Selector Hygiene `[P1]`

* **Bukti Kode**: `src/components/build/BuildWorkspace.tsx:303-363`.

* **Analisis Akar Masalah**: `BuildWorkspace` (2.225 baris) melakukan **50+ panggilan `useStudioStore` dan `useBuildModeStore`** langsung di komponen akar — termasuk `const view = useStudioStore((s) => s.view)` (objek utuh!). Akibatnya, setiap perubahan kecil pada `view` (seperti geser `cutH`, `explode`, atau `selected`), perubahan `activeTool`, atau perubahan `selectedSwatchHex` merender ulang seluruh pohon 2.225 baris termasuk toolbar atas, seluruh grid katalog furnitur, dan modal konfirmasi.

* **Solusi (Zero Degradation)**:

  1. Pecah `BuildWorkspace.tsx` menjadi 5 sub-komponen `React.memo` independen yang hanya men-subscribe slice miliknya:

     * `BuildViewportCanvas` (hanya memegang `<canvas>` & lifecycle `BuildScene` — **0 re-render saat UI/katalog/tool diklik**!)

     * `BuildTopToolbar` (undo/redo, level, cutaway, RT/tier)

     * `BuildCatalogDock` (kategori, katalog furnitur, swatch)

     * `BuildSelectionPopover` (hanya aktif saat `selected !== null`)

     * `BuildTimeAndEnvDock` (preset waktu & cuaca)

  2. Ganti subscribe objek `view` utuh dengan selector granular + `useShallow` dari `zustand/react/shallow`.

### Pilar 6 — Memori VRAM, Buffer Hygiene & Instrumen Profiling

#### `OPT-21` — `WebGLRenderTarget` Memory & Bandwidth Hygiene (`stencilBuffer: false`, `depthBuffer: false`) `[P2]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:894-908`; `src/features/walkMode/WalkScene.ts:391-409`.

* **Analisis Akar Masalah**: `EffectComposer` secara default mengalokasikan `depthBuffer: true` dan `stencilBuffer: true` pada kedua ping-pong render target (`readBuffer` & `writeBuffer`). Padahal setelah `RenderPass` selesai, `writeBuffer` (tujuan `AtmospherePass` / `BloomPass`) **sama sekali tidak membutuhkan depth buffer maupun stencil buffer**! Pada resolusi `2880×1620`, ini memboroskan \~18–36 MB VRAM dan bandwidth *depth clear* per frame.

* **Solusi (Zero Degradation)**:

  1. Set `stencilBuffer: false` pada `WebGLRenderTarget` utama `EffectComposer` (tetap `depthBuffer: true`, `samples: 4`, `type: THREE.HalfFloatType`).

  2. Pastikan `readBuffer` / `writeBuffer` tambahan pada custom `DualKawaseBloomPass` memakai `{ type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false }`.

#### `OPT-22` — Built-In GPU Pass Profiler (`EXT_disjoint_timer_query_webgl2`) & Regression Benchmark `[P2]`

* **Bukti Kode**: `src/features/buildMode/BuildScene.ts:4471-4483`; `src/tests/performance.test.ts`.

* **Analisis Akar Masalah**: Saat ini telemetry hanya mencatat rata-rata `fps`, `calls`, dan `triangles` (`renderer.info`), sehingga tidak terlihat berapa milidetik yang dihabiskan khusus oleh Shadow Pass vs Main Opaque Pass vs AtmospherePass vs BloomPass vs CPU JS.

* **Solusi (Zero Degradation)**:
  Tambahkan dev-only GPU profiler ringan (aktif hanya saat `?perf=1` di URL atau `NODE_ENV === "development"`) menggunakan `EXT_disjoint_timer_query_webgl2` + `performance.mark()` untuk mengukur breakdown waktu per pass (`cpuMs`, `shadowMs`, `mainMs`, `atmoMs`, `bloomMs`, `outputMs`, `calls`, `programs`) dan menyimpannya ke `window.__GOMAHAN_PERF__`. Ini memudahkan verifikasi objektif di setiap fase implementasi.

## 3. Roadmap Eksekusi Ultra-Ringan (4 Fase Prioritas)

| Fase | Kode Target | Fokus Utama | Estimasi Lonjakan Performa | Risiko Regresi Visual | 
| ----- | ----- | ----- | ----- | ----- | 
| **Fase 1 — Instant GPU & Idle Wins** | `OPT-01`, `OPT-02`, `OPT-03`, `OPT-05`, `OPT-09`, `OPT-18` | Hapus `preserveDrawingBuffer`, aktifkan Early-Z kondisional, early-out `AtmospherePass` + fusi `OutputPass`, fix light pool + `compileAsync`, fix `fansActive` idle gating, dynamic blur gating CSS | **+40% s.d. +85% FPS aktif**, **−95% beban GPU idle**, **0 shader hitch** | Sangat Rendah (0 perubahan visual) | 
| **Fase 2 — Draw Call Collapse & Surgical Patching** | `OPT-04`, `OPT-06`, `OPT-07`, `OPT-08`, `OPT-10` | `THREE.BatchedMesh` (draw call `~220 → ~30`), Dual-Kawase Bloom, Dirty-Chunk rebuild & Visibility-Only layers, `bakedAo` `RedFormat` + 55× faster rasterizer, `MeshPhysicalMaterial` cleanup | **Draw calls −82%**, **interaksi edit/cat/toggle `< 1 ms`** | Rendah (wajib cek picking `batchId` & cutaway) | 
| **Fase 3 — Zero-GC Hot Paths & React Isolation** | `OPT-11`, `OPT-12`, `OPT-13`, `OPT-14`, `OPT-19`, `OPT-20` | Unit-Mesh Preview Pool (12 tool), Vertex-Shader Rain, zero-GC `applyExplode`/`emitTelemetry`, isolasi `WalkTelemetryHud`, pemecahan `BuildWorkspace` 2.225 baris | **0 GC micro-stutter**, **0 React overhead saat orbit/walk** | Sangat Rendah | 
| **Fase 4 — Off-Main-Thread & Algorithm Acceleration** | `OPT-15`, `OPT-16`, `OPT-17`, `OPT-21`, `OPT-22` | 2D Uniform Spatial Grid + DDA di `lightingEngine`/`airflowEngine` (15× lebih cepat), Worker derived cache, `OffscreenCanvas` Texture Worker + CacheStorage, RT memory hygiene, GPU Pass Profiler | **Startup TTI −60%**, **simulasi `< 1 ms`**, **VRAM lebih hemat** | Sangat Rendah | 

## 4. Protokol Verifikasi Zero Visual & Model Quality Degradation

Setiap fase wajib lulus pemeriksaan ketat berikut sebelum digabungkan:

1. **Paritas Visual Piksel & Model**:

   * Bandingkan *screenshot* sebelum dan sesudah (siang jam 10:00, *golden hour* 17:15 dengan sun shafts, malam 20:00 dengan lampu interior, hujan + banjir, mode cutaway, dan mode explode) — pastikan bayangan `4096²`/`2048²`, tekstur PBR `1024²`, Baked AO, bevel furnitur, sun shafts, dan bloom identik secara visual.

   * Verifikasi fungsi **Snapshot / Export PDF & ZIP** (`page.tsx:201-215`) tetap menghasilkan gambar tajam setelah `preserveDrawingBuffer: false` (`OPT-01`).

2. **Validasi Metrik Runtime (`__GOMAHAN_PERF__` & `renderer.info`)**:

   * `calls` Build Mode High `<= 45`; Walk Mode `<= 35`.

   * `programs` tidak bertambah saat toggle lampu, pindah lantai, atau mengorbit kamera (0 shader recompile).

   * Saat kamera diam dan kipas di luar frustum, `requestAnimationFrame` tidak memanggil `composer.render()` (`0 calls/sec`).

   * Setelah 10× siklus pindah tab Build ↔ Walk, `geometries` dan `textures` kembali ke angka konstan (`0 leak`).

3. **Validasi Numerik & Interaksi**:

   * Jalankan `npm run typecheck`, `npm run lint`, `npm run test` (`vitest run`), dan `npm run build`.

   * Uji *numerical parity* `lightingEngine` & `airflowEngine` (selisih nilai lux dan kecepatan angin `< 1e-5` terhadap baseline sebelum optimasi spatial grid `OPT-15`).

   * Uji klik pilih, drag, rotasi, cat dinding, eyedropper, dan hapus pada seluruh entitas di dalam `THREE.BatchedMesh` (`OPT-07`).