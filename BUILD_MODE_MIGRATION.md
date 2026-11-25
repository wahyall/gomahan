# Inventaris Migrasi & Penghapusan Build Mode / Walking Lama (Fase 0)

> Backup Git sebelum penghapusan: branch & tag **`legacy-build-mode`** (commit `330b17f`).

---

## 1. File & Modul Lama yang Dihapus Total

| Item | Lokasi Lama | Keterangan Penghapusan |
|---|---|---|
| **Drawer Katalog Build/Buy Lama** | `src/components/workspaces/BuildFurnishDrawer.tsx` | Panel kiri `"Katalog Sims 4 Build/Buy"` berikut pemicu `setActiveTool`, `patchPlaceTemplate`, dan placement langsung tanpa Command pattern dihapus total. |

---

## 2. Kode, Kamera, Kontroler, Hotkey, Tipe & UI Lama yang Dihapus dari Modul Lain

| Modul | Elemen Lama yang Dihapus |
|---|---|
| **`src/lib/store/useStudioStore.ts`** | Tipe `BuildTool`, `"furnish"` dari `WorkspaceId`, `"walkthrough"` dari `CameraPreset`; state `activeTool`, `placeTemplate`; aksi `setActiveTool`, `patchPlaceTemplate`, `addWall`, `updateWall`, `deleteWall`, `addOpening`, `updateOpening`, `deleteOpening`, `addFurniture`, `updateFurniture`, `deleteFurniture`, `deleteLight`, `moveSelectedBy`, `rotateSelected`, `deleteSelected`. |
| **`src/lib/scene/HouseScene.ts`** | Mode bebas tembus dinding `walkthroughActive`, `walkPos`, `walkYaw`, `walkPitch`, `keysPressed`, listener `keydown`/`keyup` (`onKeyDown`/`onKeyUp`), `onWalkthroughExit`, `onMoveEntity`, `onPlaceAt`, `activeTool`, `draggingEntity`, `dragPlane`, `dragOffset`, `intersectFloorPlane`, cabang `walkthrough` pada `setCameraPreset`/`updateCameraTransform`/`onPointerMove`/`animate`, dan aksi klik-taruh/geser di pointer handler. |
| **`src/components/viewport/Viewport3D.tsx`** | Rail ikon `TOOLS` (`select`, `wall`, `door`, `window`, `furniture`, `hvac`, `light`, `demolish`), tombol & banner `Walkthrough` (`Jalan`), mode toast `activeTool`, branch `demolish` pada `onSelect`, callback `onMoveEntity`/`onPlaceAt`/`onWalkthroughExit`, serta referensi ke store placement lama. |
| **`src/components/panels/PartInfoPanel.tsx`** | Kontrol manipulasi lama (`Contextual Action Bar`: `moveSelectedBy`, `rotateSelected`, `deleteSelected`), editor inline `updateFurniture`, `updateOpening`, `updateHvac`, `updateLight`, serta teks panduan drag-to-move lama. Panel dipertahankan hanya untuk inspeksi baca-saja & editor harga RAB `getPartInfo` untuk workspace analitik. |
| **`src/components/shell/TopBar.tsx`** | Tab workspace `"furnish"` dihapus; diganti tombol titik masuk `"Walk"` (`Walk Mode` baru) di samping `"Build"`. Deskripsi tooltip lama dibersihkan. |
| **`src/components/shell/CommandPalette.tsx`** | Aksi `"furnish"` & aksi `"walk"` lama (`cameraPreset: "walkthrough"`) dihapus dan diarahkan ke stub workspace `"build"` dan `"walk"` baru. |
| **`src/app/page.tsx`** | Import & slot render `<BuildFurnishDrawer />`, kondisi `workspace === "furnish"`, serta hotkey build lama (`Delete`/`Backspace` -> `deleteSelected`, `R` -> `rotateSelected`, `Esc` -> `setActiveTool`). Diganti routing stub `"build"` / `"walk"` + hotkey masuk Build/Walk (`Shift+B` / `Shift+V`). |
| **`src/app/layout.tsx`** | Frasa deskripsi aplikasi lama disederhanakan tanpa referensi UI/Sims lama. |

---

## 3. Titik Masuk (Entry Points) Baru (Stub Kosong Fase 0)

Semua rute/tombol/hotkey di luar fitur tetap tersedia dan mengarah ke stub bersih sebelum implementasi Fase 1–4:
- **Modul Core Stub Build Mode**: `src/features/buildMode/index.ts`
- **Modul Core Stub Walk Mode**: `src/features/walkMode/index.ts`
- **Komponen UI Stub Build Mode**: `src/components/build/BuildModeStub.tsx` (terhubung ke tab `Build`, Command Palette, dan hotkey)
- **Komponen UI Stub Walk Mode**: `src/components/walk/WalkModeStub.tsx` (terhubung ke tab `Walk`, Command Palette, dan hotkey `Esc` keluar ke Build)

---

## 4. Kode Bersama yang Sengaja Dipertahankan (Fitur Non-Build-Mode)

Seluruh fitur rekayasa, simulasi, biaya, dan ekspor di bawah ini **TIDAK dihapus**:
- **Engine Kalkulasi**: `src/lib/geometry/*` (`projectModel.ts`, `masonry.ts`, `rooms.ts`, `roofAndStairs.ts`, `walls.ts`), `src/lib/structure/sniEngine.ts`, `src/lib/quantities/rabEngine.ts`, `src/lib/timeline/scheduleEngine.ts`, `src/lib/simulation/*` (`lightingEngine.ts`, `airflowEngine.ts`, `floodEngine.ts`), `src/lib/gamification/simsEngine.ts`, `src/lib/export/exporters.ts`.
- **Workspace Analitik & Dokumentasi**: `StructureWorkspace`, `LightingWorkspace` (termasuk `updateLight`), `AirflowWorkspace` (termasuk `addHvac`, `updateHvac`, `deleteHvac`), `FloodWorkspace`, `DrawingsWorkspace`, `RabWorkspace`, `TimelineWorkspace`, `DeliverWorkspace`, `SiteModeWorkspace`, `GuideWorkspace`.
- **Renderer Analitik 3D**: `Viewport3D` + `HouseScene` (mode *read-only architectural viewer* untuk tab Struktur, Cahaya, Udara, Banjir, dan snapshot Deliver), `materials.ts`, `propsBuilder.ts`, `geometryHelpers.ts`.
- **Komponen UI Bersama**: `TopBar`, `StatusBar`, `CommandPalette`, `OutlinerPanel`, `InspectorPanel`, `StageTimelineBar`, `PartInfoPanel` (bagian `getPartInfo` + RAB price override), `simsAudio.ts`, `db.ts`.

---

## 5. Kebijakan Format Save & Penanganan Data Lama

- **Versi Baru**: `CURRENT_PROJECT_SCHEMA_VERSION = 2` (di `src/lib/model/schema.ts` dan `src/lib/model/defaultProject.ts`). Format dokumen Build Mode berbasis grid/data pada Fase 1+ akan memakai nomor versi eksplisit (`formatVersion: 2`).
- **Penanganan Save v1 Lama (`schemaVersion === 1` atau tanpa nomor versi)**:
  - Saat startup (`loadLatestProject` di `src/app/page.tsx`) atau import file JSON (`handleFileChange`): fungsi `parseVersionedProjectSave(raw)` mendeteksi versi `< 2`.
  - Karena model Build/Walk lama tidak memakai grid-tile & collision data baru yang konsisten, **data save v1 tidak dikonversi paksa dan diabaikan secara aman** (*non-destructive*: tabel `snapshots` IndexedDB tetap utuh tanpa crash/korupsi).
  - Pengguna diberi toast informasi yang jelas, lalu aplikasi memuat lot standar `schemaVersion: 2`.
