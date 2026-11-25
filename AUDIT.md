# Audit Kualitas & Hasil Peningkatan — Rumah Studio 3D

Dokumen audit ini merangkum temuan awal (baseline) hingga hasil verifikasi akhir setelah seluruh perbaikan & peningkatan dijalankan pada codebase, build produksi (`next build`), unit test (`vitest`), pemeriksaan statis (`tsc`, `eslint`), serta pengujian runtime headless Chrome CDP di desktop (`1600×900`), laptop (`1280×720`), mobile (`390×844`), dan landscape (`844×390`).

## 1. Perbandingan Metrik (Sebelum vs Sesudah)

| Metrik | Sebelum (Baseline) | Sesudah (Final) | Perubahan |
|---|---|---|---|
| **Walk Mode Desktop RAF FPS (`1600×900`)** | `12 FPS` (`407` draw calls) | **`68 FPS`** (`382` draw calls, `115` render FPS) | **+467%** (`5.7×`) |
| **Walk Mode Mobile RAF FPS (`390×844`)** | `13 FPS` (`385` calls, `780×1446`) | **`85 FPS`** (`369` calls, `585×1096`) | **+554%** (`6.5×`) |
| **Walk Mode Landscape RAF FPS (`844×390`)** | `17 FPS` | **`86 FPS`** | **+406%** (`5.1×`) |
| **Chunk JS Terbesar (`.next/static/chunks`)** | `3.054,2 KB` (`26` file total) | **`909,1 KB`** (`48` file, code-split) | **-70,2%** |
| **Waktu Kompilasi `next build`** | `26.9s` (`45.5s` total) | **`8.7s`** (Turbopack) | **-67,7%** |
| **Page Load (`http://localhost:3001`)** | `2.186 ms` | **`1.661 ms`** | **-24,0%** |
| **Build Mobile `smallTargetsUnder40`** | `56` | **`51`** (tap target utama & HUD dioptimalkan) | Lebih lega |
| **Checks Statis & Test (`tsc`, `eslint`, `vitest`)** | Lulus (`18/18` test) | **Lulus (`0` error/warn, `18/18` test, `4.85s`)** | Bersih |
| **Console Errors / Page Errors / Overflow-X** | `0 / 0 / false` | **`0 / 0 / false`** | Bersih |

## 2. Status Daftar Temuan

| ID | Tipe | Area | Deskripsi & Target Hasil | Dampak | Usaha | Risiko | Status |
|---|---|---|---|---|---|---|---|
| **A01** | Fix | Walk Mode / 3D Lighting | Menghilangkan duplikasi 28 hardware light (`enableDynamicLights: false` di builder + pool **4 SpotLight lokal lantai aktif**), menekan shadow map `1024×1024`, menerapkan Adaptive DPR (`<= 1.5`), dan throttling telemetry idle (`90ms -> 450ms`). | Tinggi | Rendah | Rendah | **Done** |
| **A03** | Fix | Global / Snapshots | Menghapus `setInterval(..., 2500)` yang melakukan GPU readback `toDataURL()` periodik dan menggantinya dengan tangkapan kanvas on-demand + capture saat unmount dari Build, Walk, maupun Sim Viewport. | Tinggi | Rendah | Rendah | **Done** |
| **A04** | Improve | Bundle & Load Speed | Mengubah 12 workspace sekunder & `Viewport3D` di `page.tsx` menjadi `next/dynamic(..., { ssr: false })` serta lazy-import `exceljs` dan `jszip` di `exporters.ts`; chunk utama menyusut dari `3.054,2 KB` menjadi `909,1 KB`. | Tinggi | Rendah | Rendah | **Done** |
| **A02** | Improve | Build Mode / Interaksi Drag | Menggeser furnitur/HVAC/lampu kini menggerakkan mesh Three.js secara langsung di `60fps` dengan lot clamping, dan hanya melakukan 1 kali commit state & undo Zundo saat `pointerup`; `setHover` disaring hanya saat `(gx, gz, inBounds)` berubah. | Tinggi | Sedang | Rendah | **Done** |
| **A05** | Fix | Arsitektur 3D & Material | Memperbaiki elevasi `site:entry-step` ke `(lt1Y + trH) * 0.5`, memotong segmen dinding cutaway di sekitar bukaan pintu (`makeStub`), menambah plafon gypsum LT2 (`palette.ceiling`), cache custom material di `palette`, menyeimbangkan PBR atap di cuaca badai, dan mengganti partikel hujan kotak dengan tekstur streak lembut. | Tinggi | Sedang | Rendah | **Done** |
| **A06** | Improve | Walk Mode UX & Mobile | Menempatkan spawn Walk Mode di ambang masuk Ruang Tamu bebas halangan daun pintu, membuat putaran `KeyQ` bergantung `dt`, mencegah `requestPointerLock` di input sentuh, menaikkan prompt `[E]` di atas D-pad mobile, dan menyembunyikan legenda WASD pada layar landscape pendek (`<= 500px`). | Tinggi | Sedang | Rendah | **Done** |
| **A07** | Improve | Build Mode HUD & Touch | Menambahkan `touch-action: none` dan pointer capture di seluruh kanvas 3D, merampingkan HUD Build Mode pada laptop `1280×720` (memindahkan kartu statistik redundan ke `>= 1440px` + quick toggle Siang), serta merapikan layout & tap target kontrol di `390×844` (termasuk mencegah label `LT 2` terbungkus dua baris). | Tinggi | Sedang | Rendah | **Done** |
| **A08** | Improve | Denah 2D & RAB | Menyelaraskan gambar tangga (`DenahFloorSvg`) & tinggi/profil atap dinamis semua tipe atap (`PotonganMemanjangSvg`), mengubah garis MEP diagonal menjadi jalur ortogonal rapi, mencegah `"m²"` terbungkus baris baru di tabel Denah, serta menambah pratinjau format Rupiah pada pagu anggaran RAB. | Sedang | Rendah | Rendah | **Done** |
| **A09** | Fix | 3D Lifecycle & Memory | Menghapus alokasi `Box3`/`Vector3`/`BoxGeometry` per frame pada hover preview Build Mode dan `BuildCameraController` wheel event, menghentikan RAF ketika `document.hidden`, mendukung `prefers-reduced-motion`, menangani `webglcontextlost`/`restored`, serta membersihkan group container saat `dispose()`. | Sedang | Sedang | Rendah | **Done** |
| **A10** | Improve | Aksesibilitas & Shell UI | Membuat tombol Undo/Redo di `TopBar` reaktif via `useStore(useStudioStore.temporal, ...)`, menghapus nested interactive elements di `OutlinerPanel`, mengubah header grup Divisi RAB menjadi `<button>` aksesibel keyboard, serta menambah `aria-modal="true"` dan pengembalian fokus `Escape` di `CommandPalette`. | Sedang | Rendah | Rendah | **Done** |
