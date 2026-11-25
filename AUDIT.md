# Audit Kualitas & Rencana Peningkatan — Rumah Studio 3D

Dokumen audit ini disusun berdasarkan pemeriksaan langsung kode sumber, build produksi (`next build`), unit test (`vitest`), pengecekan tipe/lint, serta pengujian runtime & tangkapan layar headless Chrome (desktop `1600×900`, laptop `1280×720`, mobile `390×844`, mobile landscape `844×390`) sebelum eksekusi peningkatan.

## 1. Metrik & Kondisi Awal (Baseline)

- **Checks Statis**:
  - `tsc --noEmit`: lulus (`0` error)
  - `eslint .`: lulus (`0` error/warning)
  - `vitest run`: `3` test file (`18/18` test lulus)
- **Production Build & Bundle (`next build`)**:
  - Waktu kompilasi: `26.9s` (`TypeScript 7.4s`, static pages `1.0s`, total run `45.5s`)
  - Total aset `.next/static`: `26` file, `4.359.088` byte (`~4.16 MB`)
  - Chunk JS terbesar: `3.054,2 KB` (`0_7g3edq3fufd.js` — hampir seluruh aplikasi terbundel di halaman awal `/`)
- **Runtime & Rendering (`http://localhost:3001`, headless Chrome WebGL)**:
  - Muat awal: DCL `309 ms`, Load `2.186 ms`, Console error/warning: `0`, Overflow-X: `false` pada semua viewport uji
  - **Build Mode (`1600×900`)**: `56 FPS` (RAF), `230` draw calls, `17.872` triangles, `66` kontrol berdimensi `< 40px`
  - **Build Mode Mobile (`390×844`)**: `102 FPS`, `203` calls, `56` kontrol `< 40px`; HUD atas + dock bawah memakan ~68% tinggi layar sehingga jendela 3D terasa sempit
  - **Walk Mode Desktop (`1600×900`)**: **`12 FPS` (RAF)**, **`407` draw calls**, `37.810` triangles (anjlok berat akibat lampu ganda + telemetry loop)
  - **Walk Mode Mobile (`390×844`)**: **`13 FPS` (RAF)**, `385` draw calls, kanvas `780×1446` (`dpr 2`)
  - **Walk Mode Landscape (`844×390`)**: **`17 FPS` (RAF)**, TopBar + floating HUD menyisakan kanvas vertikal sempit (`269px`)
  - **Simulasi Banjir / Viewport3D (`1600×900`)**: `55 FPS` (RAF), `453` draw calls, `123.576` triangles

## 2. Daftar Temuan (Diurutkan: Dampak Terbesar, Usaha & Risiko Terkecil)

| ID | Tipe | Area | Deskripsi | Dampak | Usaha | Risiko | Status |
|---|---|---|---|---|---|---|---|
| **A01** | Fix | Walk Mode / 3D Lighting | `WalkScene` menambah `SpotLight` ganda di atas lampu yang sudah dibuat `buildProjectHouse` (hingga 28 hardware light aktif), ditambah `emitTelemetry` tiap 90ms tanpa henti ketika idle sehingga Walk Mode jatuh ke **12–17 FPS** (`407` draw calls). | Tinggi | Rendah | Rendah | Pending |
| **A03** | Fix | Global / Snapshots | `HomePage` menjalankan `setInterval(..., 2500)` yang membaca GPU framebuffer via `toDataURL()` di sim viewport sekaligus gagal mengambil snapshot ketika user berada di Build Mode atau Walk Mode. **Target:** hapus polling periodik 2.5s, tangkap snapshot dari kanvas workspace aktif secara on-demand dan sebelum berpindah tab. | Tinggi | Rendah | Rendah | Pending |
| **A04** | Improve | Bundle & Load Speed | `page.tsx` mengimpor statis semua 12 workspace (termasuk engine ekspor PDF/Excel/ZIP), membuat satu chunk JS awal mencapai **3.054,2 KB**. **Target hasil:** memecah workspace sekunder dan fitur ekspor memakai `next/dynamic` agar muat awal Build Mode jauh lebih ramping dan cepat. | Tinggi | Rendah | Rendah | Pending |
| **A02** | Improve | Build Mode / Interaksi Drag | Menyeret furnitur, HVAC, atau lampu di 3D memicu mutasi store Zustand, entri undo Zundo, kalkulasi ulang SNI/RAB/simulasi, dan rebuild penuh scene 3D di setiap `pointermove`. **Target hasil:** geser objek 60fps secara langsung di mesh Three.js dengan boundary clamp & panduan visual, lalu commit 1 perubahan + 1 entri undo pada `pointerup` sambil meredam re-render React saat hover sel. | Tinggi | Sedang | Rendah | Pending |
| **A05** | Fix | Arsitektur 3D & Material | (1) `site:entry-step` di `projectHouseBuilder.ts` diletakkan di `(lt1Y + trH) * 0.25` sehingga terbenam di pelat teras; (2) Dinding cutaway (`makeStub`) mengabaikan `openings` sehingga pintu/jendela tertutup balok padat; (3) Material custom dialokasikan ulang di tiap rebuild; (4) Material atap/carport tampak hitam di pencahayaan hujan `HouseScene` dan langit/hujan belum sinkron di Build/Walk. **Target hasil:** detail tangga/bukaan cutaway akurat, material ter-cache, atap natural, dan visual cuaca konsisten. | Tinggi | Sedang | Rendah | Pending |
| **A06** | Improve | Walk Mode UX & Mobile | Kamera awal Walk Mode menatap langsung bingkai & daun pintu terbuka 45% + punggung meja tamu; putar tombol Q/E bergantung FPS (tidak memakai `dt`); tap sentuh memicu `requestPointerLock`; kisi plafon terlalu industrial; HUD landscape mobile bertumpuk. **Target hasil:** titik spawn/pandang lebih nyaman, gerakan/rotasi mulus `dt`-independent, navigasi sentuh nyaman tanpa error pointer-lock, plafon & pencahayaan interior hangat alami, dan HUD mobile landscape ringkas. | Tinggi | Sedang | Rendah | Pending |
| **A07** | Improve | Build Mode HUD & Touch | Kanvas 3D belum memakai `touch-action: none` (`touch-none`) maupun pointer capture; toolbar Build Mode & tombol kecil (`28–32px`) padat serta memakan terlalu banyak ruang vertikal di laptop `1280×720` dan mobile `390×844`; daftar tool pill atas terpotong horizontal tanpa isyarat scroll. **Target hasil:** gestur sentuh kanvas mulus tanpa memicu scroll halaman, HUD mobile/laptop jauh lebih lega untuk kanvas 3D, tombol touch lebih nyaman, dan scroll hint horizontal jelas. | Tinggi | Sedang | Rendah | Pending |
| **A08** | Improve | Denah 2D & RAB | (1) `DenahFloorSvg` meng-hardcode koordinat tangga & `PotonganMemanjangSvg` meng-hardcode tinggi lantai `3.6m` serta caption `"ATAP SHED"` terlepas dari `roofType`; (2) Jalur pipa/listrik menggambar garis diagonal memotong ruang & label; (3) Satuan `"m²"` di panel kanan Denah terbungkus ke baris baru; (4) Input target anggaran RAB tampil mentah (`450000000`). **Target hasil:** gambar teknik 2D akurat mengikuti parameter model aktif, rute instalasi ortogonal rapi tidak menutupi teks, dan format angka RAB/Denah nyaman dibaca. | Sedang | Rendah | Rendah | Pending |
| **A09** | Fix | 3D Lifecycle & Memory | `BuildScene` & `WalkScene` belum men-dispose geometri/material `envGroup` & `neighborsGroup` saat unmount; `BuildScene.updateToolPreview` & `BuildCameraController` membuat objek `Box3`/`Vector3`/`BoxGeometry` tiap frame/event; RAF tetap berputar saat `document.hidden`, dan belum ada penangan `webglcontextlost`/`restored` maupun `prefers-reduced-motion`. **Target hasil:** bebas kebocoran memori GPU saat berpindah mode, hot loop bebas alokasi berulang, patuh reduced-motion & hemat daya di background tab. | Sedang | Sedang | Rendah | Pending |
| **A10** | Improve | Aksesibilitas & Shell UI | `TopBar` membaca state Undo/Redo secara non-reaktif; `OutlinerPanel` bersarang `<button>` dalam `<div role="button">`; `RabWorkspace` memakai `<tr onClick>` tanpa akses keyboard; `CommandPalette` belum punya `aria-modal`/pengembalian fokus Esc serta perintah cepat Build/Walk; status bar & card kiri-atas pada sim mengulang metrik identik. **Target hasil:** kontrol keyboard & pembaca layar patuh a11y, Undo/Redo reaktif presisi, dan hirarki informasi lebih bersih. | Sedang | Rendah | Rendah | Pending |
