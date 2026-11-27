# Audit Fungsionalitas & Desain Ulang UI/UX Mobile — Gomahan (ArsiStudio 3D)

> **Fokus Audit:** Evaluasi menyeluruh terhadap pengalaman pengguna perangkat mobile (smartphone portrait & landscape, serta tablet layar sentuh) dari sisi **Flow, UI/UX, Fungsionalitas, Ergonomi Sentuh, dan Kemudahan Penggunaan**.
>
> **Keputusan Arsitektur Utama:** Aplikasi 3D arsitektur + simulasi + RAB tidak dapat sekadar "mengecilkan" UI desktop dengan breakpoint CSS. Dokumen ini memetakan **15 temuan kritis pada kode saat ini (`MOB-01` s.d. `MOB-15`)** sekaligus merancang **Cetak Biru UI/UX Mobile Independen (`MobileStudioShell`)** yang benar-benar berbeda dari desktop agar terasa alami, lega, bebas *mis-tap*, dan selevel aplikasi 3D mobile profesional (*SketchUp Mobile*, *Shapr3D*, *Magicplan*).

---

## 1. Ringkasan Eksekutif & Skor Kesiapan Mobile Saat Ini

Pada layar smartphone standar (`390×844` CSS px portrait atau `844×390` landscape), tampilan saat ini masih mewarisi arsitektur desktop (*multi-bar top chrome + hover-before-click + keyboard modifiers + wide tables*). Akibatnya, **62%–70% layar viewport 3D tertutup panel UI**, beberapa interaksi inti **rusak total akibat konflik multi-touch**, dan sejumlah fitur penting **tidak dapat diakses tanpa mouse klik kanan atau tombol `Shift`/`Alt`**.

| Dimensi Audit | Kondisi Saat Ini | Masalah Paling Fatal | Target Pasca Desain Ulang Mobile |
| :--- | :---: | :--- | :--- |
| **Viewport 3D Terbuka (Build)** | **~30%–38%** (`~522px` chrome dari `844px`) | TopBar 2 baris + 3 blok Top HUD *wrapping* + Bottom Dock + StatusBar | **`>= 80%` layar 3D terbuka** (HUD minimalis + *Draggable Bottom Sheet*) |
| **Kontrol Kamera & Tool 3D** | **Rusak (Konflik)** | 1-jari selalu pan kamera bersamaan dengan gambar dinding/drag furnitur; tanpa `pointercancel` | **1-jari = Orbit** (default) + **Placement Stage 2-Langkah** (*Preview → Confirm*) |
| **Walk Mode (Portrait & Landscape)** | **Rusak (Multi-Touch)** | Tidak ada `activeLookPointerId` (kamera berputar liar saat jalan + lihat); D-Pad hilang di landscape (`sm:hidden`) | **Floating Analog Joystick (kiri) + Look Pad Independen (kanan)** di semua orientasi |
| **Paritas Fitur Tanpa Keyboard** | **Parsial (~60%)** | Klik kanan, `Shift` (multi-place/cat 1 ruang), `Alt` (free-place/5 cm) tak terjangkau | **100% fitur tersedia** lewat *Contextual Floating Action Bar* di zona jempol |
| **Ergonomi Target Sentuh** | **Di Bawah Standar** | 65+ tombol `20×20px` s.d. `28×28px`, input `11px` memicu auto-zoom iOS Safari | **Minimum `44×44px`** (Apple HIG / Material 3), input `>= 16px`, safe-area penuh |
| **Workspace Analitik (RAB/Denah/QC)** | **Desktop-Centric** | Tabel RAB `min-w-[900px]` scroll horizontal; Denah SVG tanpa pinch-zoom | **Card-Based RAB**, **Pinch-Zoom Denah**, **Mode Mandor 1-Tap**, **Share WhatsApp** |

---

## 2. Daftar Temuan Audit Mendalam (`MOB-01` s.d. `MOB-15`)

### A. Konflik Gesture 3D, Multi-Touch & Fitur Desktop-Only yang Rusak

#### `MOB-01` — Konflik Gestur 1-Jari Build Mode, 2-Jari 4-Aksi Serentak & Bug `pointercancel` `[P0 — Blocker]`
- **Bukti Kode**: `src/features/buildMode/BuildCameraController.ts:107-115, 293-355`; `src/features/buildMode/BuildScene.ts:3581-3786`.
- **Masalah**:
  1. **Tabrakan 1-Jari**: `BuildCameraController.ts:323-325` mengeksekusi `if (this.activeTouches.size === 1) this.panByPixels(dx, dy);` pada setiap sentuhan 1 jari, **bersamaan** dengan `BuildScene` yang memakai 1-jari drag untuk menggambar dinding, menggambar ruangan, mengecat lantai, menggeser furnitur, menggeser bukaan, dan menarik gizmo *push-pull* dinding. Saat pengguna menyeret dinding/furnitur di HP, kamera ikut bergeser kabur di bawah jarinya!
  2. **2-Jari Terlalu Sensitif (4 Aksi Sekaligus)**: Pada baris `326-353`, gestur 2 jari secara serentak mengubah *zoom* (`goalDistance`), *twist yaw* (`goalYaw`), *pan* (`panByPixels`), **dan** *tilt pitch* (`goalPitch`). Pengguna hampir mustahil melakukan *pinch-zoom* tanpa memutar dan memiringkan rumah keluar layar.
  3. **Bug Ghost Finger (Tanpa `pointercancel`)**: `BuildCameraController.ts:107-115` hanya memasang `pointerup`, **tidak memasang `pointercancel`**. Pada iOS Safari/Android Chrome, ketika gestur sistem (notifikasi, *edge-back swipe*, *pull-down*) menginterupsi sentuhan, `activeTouches` tidak dibersihkan sehingga kamera terkunci dalam status 2 jari secara permanen sampai halaman di-refresh.
- **Solusi Mobile-Native**:
  - Terapkan standar universal 3D mobile: **1-jari drag pada area kosong = Orbit 360°**, **2-jari pinch = Zoom**, **2-jari drag = Pan** (dengan *gesture lock threshold* agar pinch tidak memicu rotasi tak sengaja).
  - Saat pengguna memegang *gizmo* atau *ghost preview* aktif, `BuildCameraController` secara otomatis dikunci (`cameraLocked = true`) sehingga 1-jari menggerakkan objek dengan mulus tanpa menggeser kamera.
  - Wajib pasang `window.addEventListener("pointercancel", this.onPointerUpBound)` untuk membersihkan `activeTouches`.

#### `MOB-02` — Bug Multi-Touch Fatal di Walk Mode & D-Pad Menghilang Total di Mobile Landscape `[P0 — Blocker]`
- **Bukti Kode**: `src/features/walkMode/WalkScene.ts:329, 803-843, 863-873`; `src/components/walk/WalkWorkspace.tsx:315, 323-341, 344-409, 434-445`.
- **Masalah**:
  1. **Kamera Berputar Liar Saat Berjalan + Melihat Bersamaan**: `WalkScene.ts:803-843` menyimpan `this.dragLookActive = true` tanpa melacak `activeLookPointerId`. Karena `window.addEventListener("pointermove")` menangkap event dari **semua jari**, menekan tombol jalan dengan jempol kiri sambil menggeser kamera dengan jempol kanan menyebabkan `dx = e.clientX - this.lastDragPos.x` melompat-lompat antar koordinat jempol kiri dan kanan — kamera **berputar 180° secara acak setiap frame**!
  2. **Lumpuh Total di Mobile Landscape**: D-Pad dan tombol Lari memakai class `sm:hidden` (`WalkWorkspace.tsx:344, 386`). Pada HP dalam posisi **landscape** (`844×390`, `915×412`, lebar `>= 640px`), D-Pad **hilang total** sementara perangkat tidak punya keyboard — pengguna benar-benar tidak bisa bergerak!
  3. **D-Pad Kaku & Mudah Terputus**: `TouchPadBtn` (`434-445`) memakai `onPointerLeave={() => onActive(false)}` tanpa `setPointerCapture`. Jika jempol bergeser 2 mm keluar kotak `44×44px`, karakter langsung berhenti mendadak dan tidak bisa berjalan diagonal secara mulus.
  4. **Zoom 3rd-Person Hanya `wheel` & Panduan Desktop-Only**: `WalkScene.ts:863` hanya menerima mouse `wheel` (tidak ada pinch-zoom jarak kamera 3rd-person); prompt pintu menulis `[E] Buka Pintu` (`315`) dan modal bantuan (`330-339`) 100% berisi tombol keyboard (`WASD`, `Shift`, `V`, `E`, `F3`, `Esc`).
- **Solusi Mobile-Native**:
  - Tampilkan kontrol sentuh berdasarkan **`(pointer: coarse)`** (bukan `sm:hidden`), sehingga bekerja di Portrait, Landscape, maupun Tablet.
  - Ganti D-Pad 4 tombol dengan **Floating Analog Virtual Joystick** di separuh kiri layar (muncul otomatis di titik sentuh jempol kiri, gerak 360° analog, *auto-sprint* saat didorong penuh ke tepi luar + opsi kunci lari).
  - Isolasi `activeLookPointerId` khusus di `WalkScene.ts` (hanya menerima pointer di separuh kanan layar) dan tambahkan pinch 2-jari untuk jarak kamera 3rd-person.

#### `MOB-03` — Alur *Hover-Before-Click* di Build Mode Tidak Berfungsi di Layar Sentuh `[P0 — Blocker]`
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:2954-3580`.
- **Masalah**: Seluruh alur penempatan furnitur, pintu, jendela, lampu, AC, tangga, dan kolam di `BuildScene` mengasumsikan pengguna menggerakkan mouse (*hover*) untuk melihat preview hijau/merah, mengecek validasi ruangan, memutar arah dengan `R`, lalu klik untuk menaruh. **Layar sentuh tidak memiliki event hover.** Saat pengguna mobile memilih item katalog lalu mengetuk layar, item langsung ditaruh atau ditolak secara buta tanpa kesempatan melihat atau memutar preview terlebih dahulu.
- **Solusi Mobile-Native**:
  - Terapkan **Alur 2-Langkah Khusus Mobile (*Placement Stage*)**:
    1. Saat item dipilih dari katalog mobile, **Ghost 3D langsung muncul** di titik tengah pandangan kamera (dengan validasi hijau/merah instan).
    2. Pengguna menggeser Ghost dengan 1 jari (disertai *offset* visual di atas jari agar objek tidak tertutup jempol!), memutar lewat tombol `↻ 90°` / `⇄ Balik`, lalu menekan tombol hijau **`✓ Taruh`** (atau **`✕ Batal`**).

#### `MOB-04` — 6 Fitur Inti Hanya Bisa Diakses via Klik Kanan atau Modifier Keyboard (`Shift` / `Alt` / `Ctrl`) `[P0 — Fitur Terputus]`
- **Bukti Kode**: `src/features/buildMode/BuildScene.ts:2802, 3020, 3102, 3362, 3583, 3797, 3819, 4010, 4232`; `src/components/build/BuildWorkspace.tsx:711-740`.
- **Masalah**: Fitur-fitur berikut tidak memiliki kontrol UI sentuh yang setara di mobile:
  1. **Klik Kanan (`e.button === 2`)**: Batal tool aktif / keluar mode penempatan (`BuildScene.ts:3583, 3797`).
  2. **`Shift` Multi-Placement**: Menaruh beberapa kursi/lampu/tanaman beruntun tanpa kembali ke mode pilih (`4010, 4144, 4224`).
  3. **`Shift` Cat Seluruh Ruangan**: Mengecat semua dinding satu ruangan sekaligus (`3020, 4232`).
  4. **`Alt` Free-Placement & Dinding Diagonal Bebas**: Melepas *grid snap* (`2802, 3102`) dan menggeser *push-pull* dinding presisi `5 cm` (`3362, 3819`).
  5. **Shortcut `R` / `F` / `Del` / `Esc`**: Rotasi cepat, balik ayunan pintu, hapus objek terpilih, keluar mode.
- **Solusi Mobile-Native**:
  - Sediakan **Contextual Action Pill Bar** tepat di atas bilah bawah saat tool/objek aktif: tombol toggle `[Snap: Grid / Bebas]` (pengganti `Alt`), `[Mode: 1× / Beruntun]` (pengganti `Shift` multi-place), `[Cat: 1 Sisi / 1 Ruang]` (pengganti `Shift` cat), `[↻ Putar]`, `[⇄ Balik]`, `[✕ Selesai]`.

#### `MOB-05` — iOS Auto-Zoom pada Input `< 16px`, Tanpa `viewportFit: "cover"` & Tabrakan Toast `[P1]`
- **Bukti Kode**: `src/app/layout.tsx:16-30`; `src/components/build/BuildWorkspace.tsx:1733`; `src/components/panels/PartInfoPanel.tsx:97`; `src/components/workspaces/RabWorkspace.tsx:346-360`.
- **Masalah**:
  1. `layout.tsx` tidak mengekspor `export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" }`. Tanpa `viewportFit: "cover"`, `env(safe-area-inset-bottom)` di `globals.css:166` bernilai `0px` pada iPhone ber-notch/Dynamic Island sehingga tombol bawah bertabrakan dengan *Home Indicator* iOS.
  2. Input pencarian katalog (`text-[11px]`), input nama ruangan (`text-[11px]`), dan input harga RAB (`text-xs`) berukuran `< 16px`, yang secara otomatis memicu **zoom halaman paksa pada iOS Safari** setiap kali diketik dan merusak layout viewport 3D.
  3. `<Toaster position="bottom-right" />` (`layout.tsx:27`) muncul tepat menimpa Bottom Dock katalog & tombol Lari Walk Mode.
- **Solusi Mobile-Native**:
  - Ekspor `viewport` lengkap dengan `viewportFit: "cover"` dan gunakan `pb-[env(safe-area-inset-bottom)]` + `pt-[env(safe-area-inset-top)]`.
  - Pastikan seluruh `<input>` / `<select>` pada mobile memiliki `text-base` (`16px`) dan `inputMode="decimal"` / `"numeric"` untuk angka harga & dimensi.
  - Pindahkan posisi `<Toaster>` pada mobile ke `top-center` (dengan offset safe-area) agar tidak menutupi kontrol jempol bawah.

---

### B. Okulasi Viewport, Ergonomi Jempol & Hierarki UI Build Studio

#### `MOB-06` — Okulasi Viewport Parah: 62%–70% Layar HP Tertutup Chrome UI `[P0 — UX Kritis]`
- **Bukti Kode**: `src/components/shell/TopBar.tsx:83-293`; `src/components/build/BuildWorkspace.tsx:838-1370, 1697-2115`; `src/components/shell/StatusBar.tsx:54`.
- **Masalah**: Pada layar portrait `390×844`:
  - `TopBar` header (`44px`) + mobile workspace bar (`40px`) = `84px`
  - `BuildWorkspace` Top HUD (`flex-wrap`, 3 kontainer terpisah yang turun menjadi 3–5 baris!) = `~220–240px`
  - `Bottom Catalog Dock` (kategori + opsi kontekstual + rail item) = `~180px`
  - `StatusBar` bawah = `28px`
  - **Total UI menutup `~522px` dari `844px`**, menyisakan celah 3D hanya **~322px (38%)** — dan di HP `360×740` hanya tersisa **< 30%**! Pada orientasi landscape (`844×390`), viewport 3D bahkan nyaris hilang sepenuhnya.
- **Solusi Mobile-Native**:
  - Ganti total struktur chrome di mobile (lihat **Bagian 3 — Blueprint `MobileStudioShell`**): hanya **1 Floating Top Strip tipis (`44px`)** + **1 Bottom Nav (`56px`)** + **1 tombol FAB `+ Bangun`**. Katalog, View Cube, Lapisan, dan Simulasi berpindah ke **Draggable Bottom Sheet** yang tersembunyi rapi saat tidak dipakai → **viewport 3D terbuka `>= 80%` layar!**

#### `MOB-07` — 65+ Target Sentuh di Bawah Standar Minimum `44×44 px` `[P0 — Ergonomi]`
- **Bukti Kode**: `src/components/build/BuildWorkspace.tsx:851, 879, 893, 903, 1286-1314, 1974-2055`; `src/components/panels/StageTimelineBar.tsx:36-52`; `src/components/panels/PartInfoPanel.tsx:45`; `src/components/build/StudioSidePanel.tsx:96`.
- **Masalah**: Standar Apple HIG (`44×44 pt`) dan Material Design 3 (`48×48 dp`) dilanggar secara luas:
  - Tombol `+/-` kemiringan atap, overhang, dan peil (`BuildWorkspace.tsx:1974-2055`): **`h-5 w-5` (`20×20px`)**!
  - Tombol Play / Step Urutan Konstruksi (`StageTimelineBar.tsx:36-52`): **`h-6 w-6` (`24×24px`)**!
  - Seluruh tombol Top HUD (Panel Simulasi, Walk, Undo, Redo, LT1/LT2, Cutaway, Tutup `PartInfoPanel`, Tab `StudioSidePanel`): **`h-7` (`28px`)**!
  - Di layar sentuh, tombol 20–28px yang berdempetan (`gap-0.5` / `gap-1`) menyebabkan tingkat kesalahan klik (*fat-finger error*) sangat tinggi.
- **Solusi Mobile-Native**:
  - Terapkan aturan wajib pada seluruh komponen `MobileStudioShell`: minimum **`min-h-11 min-w-11` (`44×44px`)** dengan jarak antar tombol minimal **`gap-2` (`8px`)**; ganti stepper `20px` dengan kontrol **Large Pill Stepper (`44px` tinggi) + Slider Jempol (`thumb 24×24px`)**.

#### `MOB-08` — Kontrol Frekuensi Tinggi di Luar Zona Jempol & Duplikasi Undo/Redo `[P1 — Ergonomi]`
- **Bukti Kode**: `src/components/shell/TopBar.tsx:128-149, 263-293`; `src/components/build/BuildWorkspace.tsx:887-908, 1202-1340`.
- **Masalah**:
  1. Seluruh aksi yang paling sering disentuh (Pindah Workspace, Lantai LT1/LT2, Cutaway Dinding, Hapus, Pipet, Lapisan, Undo/Redo) diletakkan di **sepertiga atas layar** — zona paling sulit dijangkau jempol pada smartphone `6.1"–6.7"`.
  2. Tombol **Undo & Redo muncul ganda** di layar kecil: sekali di `TopBar.tsx:128-149` dan sekali lagi di `BuildWorkspace.tsx:887-908`, memboroskan ruang berharga.
- **Solusi Mobile-Native**:
  - Pindahkan seluruh navigasi utama dan aksi kontekstual ke **Zona Jempol Bawah (Bottom 35% layar)**.
  - Hapus duplikasi Undo/Redo; tempatkan 1 pasang Undo/Redo yang selalu konsisten dan mudah dijangkau (di sudut kiri bawah atas nav atau pojok kanan atas yang bersih).

#### `MOB-09` — `StudioSidePanel`, `PartInfoPanel`, & Kartu Seleksi Menutupi 100% Layar 3D `[P1 — Flow]`
- **Bukti Kode**: `src/components/build/StudioSidePanel.tsx:82`; `src/components/panels/PartInfoPanel.tsx:35`; `src/components/build/BuildWorkspace.tsx:1411, 2123`.
- **Masalah**:
  - Saat pengguna mobile membuka panel **Cahaya / Udara / Banjir / Struktur** di `StudioSidePanel`, drawer `w-full max-w-[440px]` **menutup 100% layar HP**. Pengguna menggeser slider jam matahari, tinggi banjir, atau kecepatan angin secara buta — harus menutup panel dulu untuk melihat efeknya di model 3D, lalu membuka lagi untuk mengatur ulang!
  - `PartInfoPanel` (`w-[345px]`) melayang kaku di pojok kanan bawah dan sering bertabrakan dengan Top HUD pada layar kecil.
- **Solusi Mobile-Native**:
  - Ganti *full-screen side drawer* menjadi **Draggable 3-State Bottom Sheet (`Peek 18%` / `Half 48%` / `Full 88%`)**. Secara default saat dibuka dari 3D, sheet berhenti di **`Half (48%)`** sehingga **model 3D tetap hidup dan bisa di-orbit di 52% layar bagian atas** sambil pengguna menggeser slider simulasi secara *real-time*!

#### `MOB-10` — Ikon Anonim Tanpa Label & Onboarding Berisi Shortcut Keyboard `[P1 — Discoverability]`
- **Bukti Kode**: `src/components/build/BuildWorkspace.tsx:859, 882, 946, 964, 986-1056, 1253, 1584-1643`.
- **Masalah**: Di layar mobile (`< 640px`), 12+ tombol di Top HUD menyembunyikan teksnya (`hidden sm:inline` / `hidden md:inline` / `hidden lg:inline`), menyisakan deretan ikon kecil tanpa teks sementara atribut `title="..."` tidak berfungsi di perangkat sentuh. Selain itu, modal panduan (`1584-1643`) menjelaskan kontrol desktop (`Klik Kanan`, `WASD`, `Shift+V`, `Q/E`).
- **Solusi Mobile-Native**:
  - Setiap tombol di UI mobile wajib memiliki **Ikon + Label Singkat 1 Kata** (mis. `Bangun`, `Lantai`, `Potong`, `Hapus`) atau berada dalam *Action Sheet* berlabel jelas.
  - Sediakan **Mobile Gesture Onboarding 3-Kartu** saat pertama kali dibuka di perangkat sentuh (*1 Jari Orbit · 2 Jari Zoom/Geser · Ketuk & Konfirmasi untuk Bangun*).

---

### C. Audit Workspace Analitik & Mode Lapangan Mandor di Mobile

#### `MOB-11` — Tabel RAB `min-w-[900px]` Sulit Dibaca & Diedit di Smartphone `[P0 — UX Kritis]`
- **Bukti Kode**: `src/components/workspaces/RabWorkspace.tsx:297-370`.
- **Masalah**: Daftar BOQ RAB dirender sebagai `<table className="w-full min-w-[900px] text-xs">` di dalam `overflow-x-auto`. Pada HP lebar `390px`, pengguna harus menggeser bolak-balik sejauh 2,5× lebar layar hanya untuk mencocokkan nama pekerjaan di kolom kiri dengan input harga satuan dan subtotal di kolom kanan.
- **Solusi Mobile-Native**:
  - Di bawah `md:` (`< 768px`), tampilkan **Mobile BOQ Card List** (bukan `<table>`):
    - **Sticky Budget Header** di atas: Total RAB, selisih Pagu, dan *progress bar* ringkas.
    - **Accordion per Divisi** dengan badge subtotal besar.
    - Setiap item pekerjaan berupa **Kartu 2-Baris**: Baris 1 = Uraian + Subtotal; Baris 2 = Volume × Satuan + tombol chip **`Edit Harga ✎`** yang membuka *Numeric Keypad Bottom Sheet* (`inputMode="numeric"`, preset ±5%/±10%) agar mengetik harga cepat tanpa menggeser tabel.

#### `MOB-12` — Denah 2D (`DrawingsWorkspace`) Tanpa Pinch-to-Zoom & Pan Sentuh Alami `[P1 — Fitur]`
- **Bukti Kode**: `src/components/workspaces/DrawingsWorkspace.tsx:29-45, 145-175`.
- **Masalah**: Lembar kerja gambar teknis (Denah LT1/LT2, Potongan, Struktur, MEP) hanya mendukung zoom lewat klik tombol `+`/`-` (`zoomPct`), tanpa gestur *pinch-to-zoom* dan *1-finger pan* yang diharapkan pengguna mobile saat membaca denah arsitektur. Panel Jadwal Bukaan (`w-[310px]`) juga menimpa hampir seluruh denah saat dibuka.
- **Solusi Mobile-Native**:
  - Pasang wrapper *touch-transform* (CSS `transform: translate3d(...) scale(...)` dengan *pinch-to-zoom* 2 jari, *double-tap* zoom 2×, dan *1-finger pan* mulus 60 FPS) langsung di sekitar SVG denah.
  - Pindahkan pemilih lembar (`A-101`, `A-102`, `S-201`, dll.) ke *horizontal pill bar* rapi dan jadikan Jadwal Bukaan sebagai *Bottom Sheet*.

#### `MOB-13` — Tabel Padat & Slider Tipis di Workspace Struktur, Banjir, Udara & Cahaya `[P1 — UX]`
- **Bukti Kode**: `src/components/workspaces/StructureWorkspace.tsx:233, 272, 307`; `src/components/workspaces/FloodWorkspace.tsx:311`; `src/components/workspaces/AirflowWorkspace.tsx:275`; `src/components/workspaces/LightingWorkspace.tsx:143`; `src/app/globals.css:101-127`.
- **Masalah**: Tabel pemeriksaan kolom SNI, Bar Bending Schedule (BBS), evaluasi lux per ruangan, dan aliran udara masih memakai `<table>` multi-kolom yang menyempit di mobile; slider `.studio-range` memiliki track `5px` dan thumb `15px` yang terlalu kecil untuk digeser jari secara presisi.
- **Solusi Mobile-Native**:
  - Ubah tabel evaluasi ruangan & struktur pada mobile menjadi **Compact Status Cards** (Nama Ruangan + Status Badge Hijau/Kuning/Merah + 2–3 metrik kunci dalam grid 2 kolom).
  - Perbesar `.studio-range` pada `@media (pointer: coarse)` menjadi track `8px` dengan thumb `26×26px` serta area sentuh vertikal `44px`.

#### `MOB-14` — Mode Lapangan Mandor (Use Case Mobile #1) Tersembunyi & Kurang Ramah Lapangan `[P1 — Flow]`
- **Bukti Kode**: `src/components/workspaces/TimelineWorkspace.tsx:44-80, 166-210, 264-365`.
- **Masalah**: Di dunia nyata, **Mode Lapangan Mandor & Kontrol Mutu (QC)** adalah fitur yang paling sering dipakai lewat HP langsung di lokasi proyek (kontraktor/pemilik rumah mencentang mutu pengecoran, pasangan bata, dan progres harian sambil berdiri di bawah sinar matahari). Saat ini fitur tersebut tersembunyi di sub-mode di dalam tab `Timeline`, memakai target sentuh kecil, dan tampilan Gantt chart horizontalnya terlalu sempit untuk HP.
- **Solusi Mobile-Native**:
  - Angkat **Lapangan (QC & Progres)** menjadi **Tab Primer ke-5** di Bottom Navigation Mobile!
  - Rancang kartu tahap konstruksi dengan **kontras tinggi (mudah dibaca di luar ruangan)**, tombol progres cepat (`0% · 25% · 50% · 75% · 100%`), serta kotak centang QC besar (`min-h-12`) agar mudah ditekan dengan satu tangan di proyek.

#### `MOB-15` — Ekspor Kontraktor (`DeliverWorkspace`) & Pencarian (`CommandPalette`) Belum Memanfaatkan Native Mobile Flow `[P2 — Flow]`
- **Bukti Kode**: `src/components/workspaces/DeliverWorkspace.tsx:131-205`; `src/components/shell/CommandPalette.tsx:214`.
- **Masalah**: Di mobile, mengunduh banyak file terpisah (PDF, XLSX, ZIP, PNG) lalu mencarinya di folder *Downloads* untuk dikirim ke tukang/keluarga lewat WhatsApp terasa merepotkan. Selain itu, `CommandPalette` dirancang sebagai dialog `Ctrl+K` desktop.
- **Solusi Mobile-Native**:
  - Tambahkan integrasi **Web Share API (`navigator.share({ files: [file], title })`)** di `DeliverWorkspace` sebagai tombol utama mobile **"Bagikan ke WhatsApp / Aplikasi Lain"** (dengan fallback unduh otomatis jika browser tidak mendukung share file).
  - Jadikan pencarian mobile sebagai *Top Search Sheet* yang langsung fokus ke katalog, ruangan, atau aksi cepat tanpa mencantumkan badge `Ctrl+K`.

---

## 3. Cetak Biru UI/UX Mobile Baru (`MobileStudioShell`) — Berbeda Total dari Desktop

Untuk mencapai pengalaman mobile yang benar-benar ringan, intuitif, dan bebas sesak, **jangan paksakan layout desktop menyusut dengan puluhan class `sm:`/`md:`**. Pisahkan secara bersih pada level *shell* memakai hook `useMobileLayout()` (`(max-width: 767px)` atau `(pointer: coarse) and (max-width: 1024px)`) yang di-lazy-load via `next/dynamic`:

| Komponen / Area | Arsitektur Desktop (Tetap Utuh) | Arsitektur Baru `MobileStudioShell` (Khusus Mobile) |
| :--- | :--- | :--- |
| **Navigasi Utama** | `TopBar` atas + `StatusBar` bawah | **Bottom Navigation Bar 5-Tab** (`56px + safe-area`): `Desain` · `Jelajah` · `Simulasi` · `RAB & Denah` · `Lapangan` |
| **Header Atas (Build 3D)** | 2 baris `TopBar` + 3 blok Top HUD (~315px) | **1 Floating Pill Bar tipis (`44px`)**: Kiri `☰ Menu/RAB`, Tengah `[LT1 \| LT2 \| Atap]`, Kanan `↶ Undo` `↷ Redo` `⋮ Opsi` |
| **Katalog & Tambah Objek** | Dock permanen lebar bawah (~180px) | **Tombol FAB `+ Bangun`** (kanan bawah) → membuka **Draggable Bottom Sheet Katalog** (tersembunyi otomatis begitu item dipilih!) |
| **Alur Penempatan Objek** | Hover mouse → Klik langsung | **Placement Stage 2-Langkah**: Ghost muncul di tengah → Drag 1-jari + Floating Bar `[✕] [↻ Putar] [Snap] [Beruntun] [✓ Taruh]` |
| **Kontrol Kamera Build** | Klik kanan orbit, tengah pan, scroll zoom | **1-Jari = Orbit 360°**, **2-Jari Drag = Pan**, **2-Jari Pinch = Zoom**, plus *Quick Camera Pill* (`3D / Atas / Depan / Potong`) |
| **Kontrol Walk Mode** | Keyboard `WASD` + Pointer Lock mouse | **Floating Analog Joystick** (separuh kiri, auto-sprint di tepi) + **Touch Look Pad** (`lookPointerId` terpisah, separuh kanan) + **Pinch 3rd-Person**, aktif di **Portrait & Landscape** |
| **Panel Simulasi & Info** | Side Drawer kanan `440px` (tutup 100% HP) | **3-Snap Bottom Sheet (`18% / 48% / 88%`)**: default `48%` agar rumah 3D tetap terlihat live di 52% layar atas saat menggeser slider! |
| **Inspeksi / Seleksi Objek** | Floating Card kiri atas + PartInfo kanan | **Compact Bottom Action Bar** (saat 1 objek dipilih): `[Geser]` `[Putar]` `[Warna]` `[Info & Biaya]` `[Hapus]` |
| **RAB & Evaluasi** | Tabel lebar `min-w-[900px]` | **Mobile Card Accordion + Sticky Budget Bar + Numeric Keypad Sheet** |
| **Denah 2D & Ekspor** | Zoom klik tombol + Download file | **Native Pinch-to-Zoom & Pan SVG** + **Share Sheet (`navigator.share`)** langsung ke WhatsApp |

### Diagram Alur Pengguna Utama di Mobile (User Flow)

1. **Flow 1 — Menambah & Mengatur Furnitur / Dinding (3 Tap, 0 Hover)**:
   - Layar 3D terbuka penuh (82% viewport) → Tap FAB **`+ Bangun`** → Pilih kategori/item di Bottom Sheet (sheet otomatis menutup) → Ghost 3D muncul di tengah layar → Seret 1 jari ke posisi, tap `↻` bila perlu → Tap **`✓ Taruh`** (atau aktifkan `Beruntun` untuk menaruh beberapa sekaligus).
2. **Flow 2 — Menguji Simulasi Cahaya / Banjir / Udara Secara Live**:
   - Tap tab **`Simulasi`** di Bottom Nav → Bottom Sheet terbuka setengah layar (**48%**) dengan 4 pill tab (`Cahaya · Udara · Banjir · Struktur`) → Geser slider jam/hujan/angin dengan jempol sambil langsung melihat rumah 3D di **52% layar atas** berubah real-time → Tarik sheet ke bawah (`Peek 18%`) untuk inspeksi penuh atau ke atas (`88%`) untuk membaca detail ruangan.
3. **Flow 3 — Jelajah Rumah 3D (Walk Mode) di Portrait & Landscape**:
   - Tap tab **`Jelajah`** → Masuk Walk Mode layar penuh dengan header super-ringkas (`LT 1 · Ruang Tamu` + `1st/3rd` + `Waktu`) → Sentuh sisi kiri mana saja untuk **Analog Joystick** berjalan mulus, geser sisi kanan untuk melihat 360° tanpa konflik → Dekati pintu, tap tombol besar **`Buka Pintu`** di zona jempol kanan.
4. **Flow 4 — Cek Progres & RAB di Lokasi Proyek (1-Tangan)**:
   - Tap tab **`Lapangan`** → Lihat progres total + kartu tahap aktif → Tap persentase cepat / centang kotak QC besar → Pindah ke tab **`RAB & Denah`** → Edit harga material via *Numeric Sheet* → Tap **`Bagikan PDF/RAB`** langsung ke grup WhatsApp kontraktor.

---

## 4. Roadmap Implementasi Mobile (4 Fase Terukur)

| Fase | Kode Target | Ruang Lingkup Implementasi | Dampak Utama |
| :--- | :--- | :--- | :--- |
| **Fase 1 — Fix Blocker Gesture, Multi-Touch & Viewport** | `MOB-01`, `MOB-02`, `MOB-05` | Fix `pointercancel` & pisahkan 1-jari orbit vs drag objek di `BuildCameraController`; fix `activeLookPointerId` & ganti D-Pad `sm:hidden` → Floating Analog Joystick berbasis `(pointer: coarse)` di Walk Mode; tambah `viewportFit: "cover"`, input `>= 16px`, dan pindahkan Toast ke atas. | Menghilangkan seluruh bug rusak (kamera berputar liar, lumpuh di landscape, konflik drag, iOS auto-zoom). |
| **Fase 2 — Bangun `MobileStudioShell` & Alur 2-Langkah Build** | `MOB-03`, `MOB-04`, `MOB-06`, `MOB-07`, `MOB-08`, `MOB-10` | Buat shell mobile independen (`MobileBottomNav`, `MobileTopBar`, FAB `+ Bangun`, *Draggable Bottom Sheet* katalog, **Placement Stage `Preview → Confirm`**, Contextual Action Bar pengganti `Shift`/`Alt`/klik kanan, semua tombol `>= 44×44px`, Mobile Gesture Onboarding). | Viewport 3D terbuka dari `~35% → >= 80%`; 100% fitur Build bisa diakses nyaman dengan 1–2 jempol. |
| **Fase 3 — 3-Snap Half-Sheet Simulasi & Mobile-Native Workspaces** | `MOB-09`, `MOB-11`, `MOB-12`, `MOB-13` | Ubah panel Simulasi & PartInfo menjadi 3-Snap Bottom Sheet (`18%/48%/88%`); buat Mobile Card BOQ + Numeric Keypad Sheet untuk RAB; tambah Pinch-to-Zoom & Pan sentuh untuk Denah SVG; perbesar slider `.studio-range` dan konversi tabel evaluasi ke kartu ringkas. | Simulasi live terlihat sambil geser slider; RAB & Denah nyaman dibaca tanpa scroll horizontal melelahkan. |
| **Fase 4 — Mode Lapangan 1-Tangan & Native Share Ekspor** | `MOB-14`, `MOB-15` | Angkat Mode Lapangan Mandor ke Tab Primer Bottom Nav dengan tampilan *outdoor high-contrast* & QC checklist besar; integrasikan Web Share API (`navigator.share`) di `DeliverWorkspace` untuk kirim paket kontraktor langsung ke WhatsApp. | Alur lapangan mandor & berbagi dokumen proyek tuntas dalam 2–3 sentuhan. |

---

## 5. Kriteria Uji & Verifikasi Mobile (Device Matrix)

Setiap fase wajib diuji pada profil perangkat nyata / emulator sentuh berikut:

1. **Portrait Kecil (`360×740` Android)** & **Portrait Modern (`390×844` iPhone ber-notch)**:
   - Viewport 3D terbuka minimal `>= 78%` pada kondisi istirahat di Build Mode.
   - Tidak ada tombol interaktif `< 44×44px`, tidak ada teks/tombol terpotong *notch* atau *Home Indicator*, dan tidak terjadi auto-zoom saat mengetik di seluruh input.
2. **Landscape Mobile (`844×390` & `915×412`)**:
   - Walk Mode tetap menampilkan Analog Joystick kiri + Look Pad kanan, dan berjalan sambil memutar kamera serentak berjalan mulus tanpa lompatan sudut.
   - Build Mode menyembunyikan bar non-esensial agar kanvas 3D tetap dominan.
3. **Paritas Fitur Tanpa Mouse & Keyboard**:
   - Seluruh skenario berikut berhasil 100% hanya dengan layar sentuh: bangun dinding lurus & diagonal, pasang pintu/jendela/furnitur (termasuk multi-place & free-place), cat 1 sisi & cat 1 ruangan, geser dinding *push-pull*, ubah lantai & cutaway, uji simulasi sambil melihat 3D, edit harga RAB, zoom denah 2D, centang QC lapangan, dan bagikan hasil ekspor.
