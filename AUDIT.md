# Audit Teknis & Rencana Peningkatan — Rumah Studio 5×17 (Three.js + Next.js)

> Tanggal Audit: 2026-11-25  
> Lokasi Proyek: `d:\homahan\rumah-studio`  
> Standar Acuan: `d:\homahan\agent-skills` (`3d/`, `game-development/`, `web-design/`, `ui/`, `workflow/`)

---

## Ringkasan Aturan Skill yang Diterapkan (15 Baris)

1. **Proporsi & 3 Skala Detail (`3d-high-poly-models`)**: Bentuk silhouette dulu, bevel/chamfer tepi keras untuk menangkap highlight, microdetail lewat texture/normal/roughness.
2. **Instancing & LOD 3 Tier (`3d-high-poly-models`, `optimize-threejs-games`)**: Batch/instancing elemen berulang dan `THREE.LOD` (High/Med/Low) ber-histeresis + frustum culling.
3. **Material PBR & Color Space (`3d-high-resolution-textures`)**: Albedo/emissive pakai `SRGBColorSpace`, map data (normal/roughness/metalness/AO) pakai `NoColorSpace` + mipmap + max anisotropy.
4. **Kayu, Logam Konduktor & Kain Fisik (`3d-wood-material`, `3d-metal-material`, `3d-cloth-material`)**: Pori/serat searah member & bevel arris; logam murni (`metalness: 1`, F0 linear) memantul PMREM + `envMap` eksplisit; kain dengan `sheen > 0.0001`.
5. **Pencahayaan, Bayangan & Tone Mapping (`3d-wood-lighting-scorecard`, `3d-kasumidera-ultra-realism`)**: Satu ACES pass, key/fill kontras terukur, `normalBias` terkalibrasi tanpa peter-panning, dan baked contact shadow pool.
6. **Air Banjir & Hujan Realistis (`3d-harbour-water`, `3d-ultra-realistic-water`)**: Normal riak kapiler multi-skala animasi delta-time, Fresnel reflektif, dan cincin cipratan hujan terikat intensitas.
7. **Retina & Resize (`3d-retina-resolution`)**: `ResizeObserver` pada container, cap DPR maksimal 2×, update dinamis saat zoom/resize, dan skip zero-sized hidden view.
8. **Loop Render Tanpa Alokasi (`optimize-threejs-games`)**: Dilarang alokasi `new Vector3/Matrix4/Color/Quaternion` di dalam `animate()` maupun pointer handler; gunakan scratch objects.
9. **Lifecycle & Pembersihan GPU (`threejs`, `optimize-threejs-games`)**: Dispose seluruh geometry, material, texture, renderTarget & lepas event listener saat unmount; jeda loop saat `document.hidden`; hormati `prefers-reduced-motion`.
10. **Mobile & Aksesibilitas (`build-mobile-threejs-games`, `no-ai-design-slop`)**: Target sentuh ≥ 44 px, HUD bebas tumpang-tindih di `390×844` & `844×390`, tombol semantik, focus ring kontras AA, anti-slop UI koheren.
11. **Bukti Nyata & Anti-Regresi (`workflow-progress-screenshots`, `test-playable-web-games`)**: Ukur metrik + tangkap screenshot nyata (desktop & mobile) sebelum dan sesudah tiap fase tanpa merusak fitur aplikasi.

---

## Fase 0 — Ringkasan Kondisi & Metrik Baseline

### Struktur Repo
- **Entry & Shell**: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- **State & Persistence**: `src/lib/store/useStudioStore.ts` (Zustand + Immer + Zundo Undo/Redo), `src/lib/store/db.ts` (Dexie IndexedDB)
- **Model & Kalkulasi**: `src/lib/model/*` (5×17 3KT default + custom brick), `src/lib/geometry/*` (`masonry.ts`, `rooms.ts`, `roofAndStairs.ts`, `projectModel.ts`), `src/lib/structure/sniEngine.ts`, `src/lib/quantities/rabEngine.ts`, `src/lib/timeline/scheduleEngine.ts`, `src/lib/simulation/*` (`lightingEngine.ts`, `airflowEngine.ts`, `floodEngine.ts`), `src/lib/gamification/simsEngine.ts`, `src/lib/audio/simsAudio.ts`, `src/lib/export/exporters.ts`
- **3D Renderer**: `src/lib/scene/HouseScene.ts`, `src/lib/scene/materials.ts`, `src/lib/scene/propsBuilder.ts`
- **UI & 12 Workspaces**: `src/components/shell/*`, `src/components/viewport/Viewport3D.tsx`, `src/components/panels/*`, `src/components/workspaces/*`

### Baseline Metrik Terukur (Sebelum Revisi)
| Metrik | Desktop (`1600×900 @1x`, SwiftShader Headless) | Mobile Portrait (`390×844 @2x`) |
|---|---:|---:|
| **FPS / Avg Frame Time** | `60 FPS` (`16.67 ms`) | `60 FPS` (`16.66 ms`) |
| **Canvas CSS / Drawing Buffer** | `948×711` / `948×711 px` | `346×646` / `692×1292 px` |
| **WebGL Draw Calls / Frame** | **`1.016 calls`** | **`989 calls`** |
| **WebGL Triangles / Frame** | `108.190 tris` | `107.570 tris` |
| **Bundle `.next/static` Total** | `4.051.855 bytes` (~`3,86 MiB`) — chunk terbesar `2.846.266 B` (~`2,71 MiB`) | sama |
| **Aset Eksternal (`public/`)** | `0 B` (100% prosedural + font Google lokal Next) | `0 B` |
| **Console Errors / Warnings** | `0 errors` / **`2 warnings`** (`THREE.Clock` deprecated, `PCFSoftShadowMap` removed) | `0 errors` / **`2 warnings`** |
| **Vitest & Typecheck & Lint** | `6/6 pass`, `0 TS errors`, `0 ESLint errors/warnings`, `next build` exit 0 | — |

### Daftar Fitur "Jangan Rusak"
1. Kavling `5×17 m` 2 lantai 3 kamar tidur + Ruang Santai LT2 diperluas + Void Taman Belakang + Skylight Tangga + dinding batas tetangga Kiri/Kanan tanpa jendela samping.
2. Atap default `shed_front` 10° ke depan + switch ke `shed_back`, `gable`, `hip`, `flat_deck` + multi-cover.
3. Custom ukuran batu bata (`L × H × T mm`), tebal dinding luar/dalam, tebal nat `mortarMm`, thinbed vs semen-pasir 1:5, bond pattern, waste %, pengurangan luas lantai bersih, instanced brick 3D.
4. Multi-sistem struktur (5 pondasi, 2 rangka, 3 pelat LT2), BBS tulangan SNI, RAB Permen PUPR 8/2023 (AHSP OH & Borongan %), Timeline 12 tahap & S-Curve.
5. Simulasi Cahaya Surabaya, Sirkulasi Udara + **AC/Kipas yang bisa dipindah/putar/nyala-mati di 3D**, serta **Simulasi Hujan Deras & Banjir Surabaya (0–150 cm)** dengan mitigasi.
6. Sims 4 Build/Buy drag-move, Undo/Redo (`Ctrl+Z`/`Ctrl+Y`), IndexedDB autosave + Snapshot + Export/Import JSON, Sound FX, Mode Sims vs Pro, Gambar Kerja SVG, Site Mode, Export PDF/Excel/CSV/JPG/ZIP.

---

## Fase 1 — Tabel Temuan Audit

| ID | Area | Masalah (`file:line`) | Keparahan | Dampak | Rencana Perbaikan | Aturan Skill Terkait |
|---|---|---|---|---|---|---|
| **C-01** | 3D Geometry | Furnitur menembus dinding batas tetangga kanan `X=5`: `f1-lemari1` (`defaultProject.ts:443`, `X=4.03..5.13`) dan headboard `f2-bed2` (`defaultProject.ts:670`, `X=3.02..5.07`) terlihat menonjol keluar bangunan di desktop & mobile screenshot | **Critical** | Artefak visual parah (barang menembus tembok ke lahan tetangga) | Reposisi `f1-lemari1` & `f2-bed2` bersih di dalam bidang dinding; perketat clamp batas X/Z di `useStudioStore.ts` | `3d-modular-buildings`, `workflow-progress-screenshots` |
| **C-02** | 3D Structure | Grid kolom `sniEngine.ts:131-143` (`gridX=[0.05, 2.25, 4.95]`) menaruh kolom utama `(2.25, 12.5)` tepat di daun pintu KT Utama, `(2.25, 10.5)` di tengah Ruang Keluarga/Santai, & `(2.25, 15.35)` di depan pintu geser dapur | **Critical** | Kolom menghalangi pintu & ruang terbuka | Terapkan portal span 5,0 m di perimeter (`X=0.05` & `4.95`) + kolom sejajar sekat dinding nyata & dinding tangga (`X=1.35`) tanpa menghalangi bukaan | `3d-modular-buildings`, standar struktur praktis SNI |
| **C-03** | 3D Roof & Void | Atap `HouseScene.ts:909-937` menutup penuh `X:0..5, Z:3.4..17.4` menimpa Void Taman Belakang (`1.7..5.0, 15.35..17.0`); kanopi carport (`956-965`) menutup penuh Taman Depan terbuka; pipa downspout mengambang lurus | **Critical** | Void taman belakang tertutup gelap/hujan tak masuk; detail eave/kanopi/downspout kurang logis | Buat bukaan atap di atas Void Taman Belakang (L-shape extrude + rangka skylight), batasi kanopi tepat atas carport & teras, tambah soffit, lisplank & siku pipa turun ke dinding | `3d-modular-buildings`, `3d-high-poly-models` |
| **C-04** | UI Mobile | Pada `390×844` (`baseline-mobile.jpg`), `Budget Meter` menabrak `ViewCube` kanan-atas (`Viewport3D.tsx:363-501`), tab workspace `TopBar.tsx:86` terjepit tak terbaca, dan tombol tool `h-6/h-7/h-8` di bawah `44px` | **Critical** | Kontrol & badge terpotong tumpang-tindih di ponsel | Pisahkan bar tab workspace scrollable pada mobile, rapikan HUD viewport kompak anti-tabrakan, dan besarkan tap target kontrol utama menjadi `≥ 44px` (`min-h-11` / touch targets) | `build-mobile-threejs-games`, `no-ai-design-slop` |
| **H-01** | Perf (Draw Calls) | Terukur **1.016 draw calls/frame** hanya untuk 108k tris (`HouseScene.ts:537-966`) akibat mesh individual per kolom, balok, rangka, anak tangga, rooster, dan kusen | **High** | Bottleneck CPU/driver GPU di mobile & laptop lemah | Merge/instance geometri statis berulang (`InstancedMesh` / `mergeGeometries` per material) & tambah `THREE.LOD` 3-tier untuk properti hero; target `≤ 250` draw calls | `optimize-threejs-games`, `3d-high-poly-models` |
| **H-02** | Perf (GC Loop) | Alokasi `new Matrix4/Quaternion/Vector3/Color` per partikel (~420/frame) di `HouseScene.ts:1581-1616`, `1321`, `1385`, `1452-1456`, `1264-1267` | **High** | Garbage collection stutter saat simulasi aktif | Hoist objek scratch reusable pada class `HouseScene` untuk animasi partikel udara, explode, pan kamera, & raycast | `optimize-threejs-games` |
| **H-03** | Memory & Context | `HouseScene.ts:214-272, 1530, 1674-1696` tidak men-`dispose()` geometri/material `envGroup` & `gridHelper` & `skyMesh`, serta `contextmenu` listener tak dilepas; belum ada UI fallback WebGL & context-lost | **High** | Memory leak saat remount / tab switching & crash tanpa fallback | Simpan daftar `staticResources`, lepas semua event listener saat `dispose()`, tambah `webglcontextlost`/`restored` & fallback banner | `threejs`, `optimize-threejs-games` |
| **H-04** | Console Warnings | 2 warning konsol Three.js r187 (`baseline-desktop` & `mobile`): `THREE.Clock` deprecated (`HouseScene.ts:114, 1537, 1662`) dan `PCFSoftShadowMap` removed (`HouseScene.ts:124`) | **High** | API usang dapat gagal pada rilis Three.js mendatang | Ganti `THREE.Clock` ke timer `performance.now()` terkalibrasi + `PCFShadowMap` -> 0 console warnings | `threejs`, `test-playable-web-games` |
| **H-05** | Lifecycle & Tiering | DPR tidak di-update saat zoom/resize (`HouseScene.ts:1349`), tidak pause saat `document.hidden`, `dt` cap `0.05` (> `1/30s`), mengabaikan `prefers-reduced-motion`, & belum ada adaptive 3-tier GPU governor (`High/Medium/Low`) | **High** | Boros baterai, lag di GPU lemah, tidak ramah motion-sensitivity | Tambah 3-tier `QualityManager` adaptif (auto step-down DPR/shadow/partikel ber-histeresis), `ResizeObserver` container + DPR dinamis cap 2, pause on hidden (`dt=0` on resume), & `prefers-reduced-motion` | `3d-retina-resolution`, `3d-wood-lighting-scorecard`, `optimize-threejs-games` |
| **H-06** | Data & Nav Sync | `TopBar.tsx:86-201` memotong label `"Site"` di `1600px` kanan tab strip; `Viewport3D.tsx:424` (`3.699` potongan) vs `StatusBar.tsx:55` (`3.229` ekuivalen beli) membingungkan user (`totalBuy < totalPlaced`) | **High** | Tab `Site` terpotong & angka bata terkesan bertentangan | Sinkronkan perhitungan `totalBuyBricks = max(buyEquiv, ceil(placed * 0.85))` atau tampilkan rincian jelas "Beli X bh (Utuh+Potongan Y pcs)" seragam; buat `TopBar` wrap/scroll halus agar semua 12 workspace terlihat utuh | `no-ai-design-slop`, `audit-ai-design-slop` |
| **M-01** | 3D Detail (Fase 4A) | Prop hero (`car_city`, `motorbike`, `sofa_l`, `bed_queen`, `tropical_plant`, pintu, jendela, tangga) masih memakai kotak tajam tanpa chamfer/bevel & tanpa detail sekunder (handle, kusen bertingkat, grill AC outdoor + pipa tembaga, velg mobil, daun palm berlapis) | **Medium** | Model tampak kotak kaku pada jarak dekat & 3/4 | Naikkan fidelitas bertahap (bevel extrude, chamfer, sub-part berhierarki, AC outdoor unit, kusen bertingkat, tangga dengan stringer/post, LOD 3 level) | `3d-high-poly-models`, `3d-wood-material`, `3d-metal-material` |
| **M-02** | 3D Material & PBR | Tekstur `materials.ts:8-100` baru `256px` tanpa `normalMap`, logam pakai `metalness < 1` & roughness konstan, `envMapIntensity` tidak disetel per material (lantai/rumput/plester memantulkan langit merata) | **Medium** | Permukaan terasa datar / plastis pada close-up | Tingkatkan tekstur prosedural ke `512–1024px` + paired `normalMap` & `roughnessMap` (`NoColorSpace`), logam konduktor `metalness: 1` + F0 linear + `envMap` bound, & contact-darkening AO | `3d-high-resolution-textures`, `3d-wood-material`, `3d-metal-material` |
| **M-03** | 3D Light & Flood | Frustum bayangan `±16` longgar, `normalBias: 0.02` berisiko peter-panning, belum ada contact shadow pools; air banjir hanyalah plane miring polos (`HouseScene.ts:1147-1166`) tanpa riak kapiler atau cincin tetesan hujan | **Medium** | Bayangan kontak lemah & visual banjir kurang realistis | Rapatkan frustum bayangan ke tapak 5×17 + `normalBias 0.006`, tambah contact shadow decals, dan shader permukaan air banjir berombak kapiler + rain ripple rings (dengan fallback tier rendah) | `3d-wood-lighting-scorecard`, `3d-harbour-water`, `3d-ultra-realistic-water` |
| **M-04** | 3D Environment | Rumah tetangga berupa kotak abu transparan polos (`0.24`) & pohon berupa dodecahedron (`HouseScene.ts:249-272`) | **Medium** | Konteks lingkungan The Sims 4 kurang hidup | Percantik lingkungan tetangga bertingkat dengan atap/pagar kontekstual bersih, trotoar + marka jalan + saluran drainase nyata, rumput bervariasi, & tajuk pohon tropis ber-LOD | `3d-kasumidera-ultra-realism`, `3d-high-poly-models` |
| **M-05** | 3D Camera Feel | Orbit & preset kamera langsung melompat kaku tanpa damping/easing; ViewCube kanan-atas (`Viewport3D.tsx:473`) statis | **Medium** | Transisi kamera terasa kaku saat review bangunan | Tambah critical damping pada target/orbit & animasi terbang preset kamera (instant saat `prefers-reduced-motion`) | `build-game-camera-controls`, `3d-orbit-inspect-demo` |
| **M-06** | UI/UX & A11y | Elemen interaktif `<div onClick>` di `TopBar.tsx:183`, `OutlinerPanel.tsx:61`, `DeliverWorkspace.tsx:151`; kurang focus ring kontras tinggi & rule `@media (prefers-reduced-motion: reduce)` di `globals.css` | **Medium** | Aksesibilitas keyboard & motion safety kurang lengkap | Ganti ke semantic `<button>`, terapkan `focus-visible:ring-2 focus-visible:ring-primary`, hormati `prefers-reduced-motion` di CSS & animasi UI | `no-ai-design-slop`, `audit-ai-design-slop` |

---

## Fase 2 — Asumsi & Anggaran Performa 3-Tier

### Asumsi yang Ditetapkan (Sesuai Spesifikasi Terkunci Pengguna)
1. **Default Budget Cap Rp 450 Juta vs Realitas HSPK Surabaya 2026**: Setelah perbaikan grid kolom berlebihan (`C-02`), RAB tetap dihitung jujur mengikuti koefisien Permen PUPR 8/2023 & harga material riil Surabaya (`~Rp 540–660 jt` untuk 2 lantai full finishing + 3 AC). Kami **tidak memalsukan** harga material di bawah pasar; Budget Meter menampilkan selisih riil + rekomendasi optimasi (`Mode Borongan`, ganti `Hebel/Batako`, pelat `Bondek/AAC`, atau penyesuaian spek) agar pemilik rumah dapat mensimulasikan penghematan menuju `≤ Rp 450 jt`.
2. **Git Versioning Lokal**: Karena folder belum memakai repo `.git`, inisialisasi `git` dilakukan di `d:\homahan\rumah-studio` pada awal Fase 3 agar tiap perbaikan dapat di-commit secara atomik dan dapat di-rollback.

### Anggaran Performa 3 Tier (`QualityTier` + Adaptive Governor)
| Parameter | Tier High (Desktop GPU) | Tier Medium (Laptop / Tablet) | Tier Low (Mobile / Software / GPU Lemah) |
|---|---|---|---|
| **Draw Calls / Frame Target** | `≤ 250 calls` (turun dari `1.016`) | `≤ 180 calls` | `≤ 120 calls` |
| **Segitiga Scene Terlihat** | `≤ 300k tris` (rumah & props detail tinggi + chamfer) | `≤ 160k tris` (~50% High via LOD1) | `≤ 75k tris` (~25% High via LOD2) |
| **Pixel Ratio (DPR Cap)** | `min(dpr, 2)` | `min(dpr, 1.5)` | `1.0` |
| **Shadow Map** | `2048×2048` (`PCFShadowMap`) | `1024×1024` (`PCFShadowMap`) | `1024×1024` / off saat FPS < 24 |
| **Airflow / Rain Particles** | `420` aliran + `2400` hujan | `240` aliran + `1200` hujan | `120` aliran + `600` hujan |
| **Shader / Air / Tekstur** | Full `512–1024px` PBR + Flood Wave Shader + PMREM | `512px` PBR + Flood Wave sederhana | Material standar hemat bandwidth |
| **Target FPS** | `60 FPS` (auto turunkan tier jika avg 60f < `38 FPS`) | `45–60 FPS` | `30–60 FPS` |

---

## Urutan Eksekusi (Dampak Terbesar, Risiko Terkecil Lebih Dulu)
1. **Fase 3A (Critical Fixes)**: `C-01` (furnitur tembus dinding), `C-02` (kolom menabrak pintu/ruang tengah), `C-03` (roof cutout rear void & carport canopy), `C-04` (mobile HUD overlap, TopBar workspace access, ≥44px touch targets).
2. **Fase 3B (High Fixes)**: `H-04` (`THREE.Timer`/clock + `PCFShadowMap` -> 0 warnings), `H-02` (zero alloc loop), `H-03` (`dispose()` lengkap + listener cleanup + WebGL fallback/context-lost), `H-05` (`QualityTier` 3-tier + DPR dynamic + pause `document.hidden` + `prefers-reduced-motion` + telemetry `window.__RUMAH_STATS__`), `H-01` (instancing/merge static & batching -> draw calls drop `75%+`), `H-06` (sinkronisasi tampilan bata + TopBar non-clipped).
3. **Fase 4A (High-Fidelity 3D Upgrade)**:
   - Model Hero bertahap (Tahap 1 Silhouette → Tahap 2 Bevel/Sub-parts → Tahap 3 PBR/Normal/Roughness → Tahap 4 IBL/Lighting/Contact Shadows/Flood Water Shader → Tahap 5 3-Level `THREE.LOD` → Tahap 6 Capture dekat/sedang/jauh & siang/malam/banjir).
   - Urutan Hero Models: (1) Arsitektur Rumah 5×17 (fasad, atap, talang, kusen, void skylight, tangga), (2) Kendaraan Carport (`Mobil` + `Motor`), (3) Furnitur & HVAC Interior (`Sofa`, `Bed`, `Kitchen`, `Dining`, `AC Split & Outdoor`, `Fans`, `Tropical Plants`), (4) Lingkungan Sekitar & Banjir Sims 4 (tetangga kontekstual, trotoar/jalan/got, air banjir beriak + tetesan hujan).
4. **Fase 4B (UI/UX Polish & Interaction Feel)**: Damped camera orbit & smooth preset transitions, semantic a11y buttons & high-contrast focus rings, `prefers-reduced-motion` CSS, konsistensi HUD & feedback interaksi.
5. **Fase 5 & 6 (Verifikasi & Laporan Akhir)**: `typecheck` + `vitest` + `eslint` + `next build`, screenshot Desktop (`1600×900`) & Mobile (`390×844` + `844×390`) Before vs After, pengujian resize / hidden tab / repeated unmount-mount / context-loss, pembaruan status akhir di `AUDIT.md`.
