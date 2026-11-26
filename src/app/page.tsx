"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { computeStructuralReport } from "@/lib/structure/sniEngine";
import { buildRabSummary } from "@/lib/quantities/rabEngine";
import { buildScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { runLightingSimulation } from "@/lib/simulation/lightingEngine";
import { runAirflowSimulation } from "@/lib/simulation/airflowEngine";
import { runFloodSimulation } from "@/lib/simulation/floodEngine";
import { parseVersionedProjectSave, validateProjectImport } from "@/lib/model/schema";
import type { Project } from "@/lib/model/types";
import { loadLatestProject, quarantineCorruptSave, saveAutosaveProject, saveProjectSnapshot } from "@/lib/store/db";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { TopBar } from "@/components/shell/TopBar";
import { StatusBar } from "@/components/shell/StatusBar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { SnapshotModal } from "@/components/shell/SnapshotModal";
import { StudioConfirmDialog } from "@/components/ui/StudioPrimitives";
import { BuildWorkspace } from "@/components/build/BuildWorkspace";
import { GuideDrawer } from "@/components/workspaces/GuideWorkspace";

function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[240px] w-full flex-1 items-center justify-center bg-[#0d1015] text-xs font-medium text-muted-foreground">
      Memuat {label}...
    </div>
  );
}

const WalkWorkspace = dynamic(
  () => import("@/components/walk/WalkWorkspace").then((m) => m.WalkWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Walk Mode 3D" /> },
);
const DrawingsWorkspace = dynamic(
  () => import("@/components/workspaces/DrawingsWorkspace").then((m) => m.DrawingsWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Denah & Potongan 2D" /> },
);
const RabWorkspace = dynamic(
  () => import("@/components/workspaces/RabWorkspace").then((m) => m.RabWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Rencana Anggaran Biaya" /> },
);
const TimelineWorkspace = dynamic(
  () => import("@/components/workspaces/TimelineWorkspace").then((m) => m.TimelineWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Jadwal & Mode Lapangan" /> },
);
const DeliverWorkspace = dynamic(
  () => import("@/components/workspaces/DeliverWorkspace").then((m) => m.DeliverWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Pusat Ekspor" /> },
);

export default function HomePage() {
  const project = useStudioStore((s) => s.project);
  const workspace = useStudioStore((s) => s.workspace);
  const scheduleScenario = useStudioStore((s) => s.scheduleScenario);
  const guideOpen = useStudioStore((s) => s.guideOpen);
  const setGuideOpen = useStudioStore((s) => s.setGuideOpen);
  const loadProject = useStudioStore((s) => s.loadProject);
  const setSelected = useStudioStore((s) => s.setSelected);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSnapshotRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<Project | null>(null);

  // Load latest IndexedDB autosave post-mount; quarantine truly corrupt saves before fallback
  useEffect(() => {
    let active = true;
    loadLatestProject()
      .then(async (saved) => {
        if (!active) return;
        if (saved) {
          const check = parseVersionedProjectSave(saved);
          if (check.status === "ok") {
            loadProject(check.data);
            if (check.migratedFromVersion) {
              toast.info(`Save proyek lama (v${check.migratedFromVersion}) otomatis dimigrasi ke v${check.data.schemaVersion}.`);
            }
          } else {
            await quarantineCorruptSave(check.message, saved);
            toast.warning(`Data save corrupt dikarantina ke IndexedDB: ${check.message}`);
          }
        }
        if (!active) return;
        setHydrated(true);
        setSaveStatus("saved");
      })
      .catch(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [loadProject]);

  const handleCanvasReady = useCallback((cv: HTMLCanvasElement | null) => {
    canvasRef.current = cv;
  }, []);

  // Debounced autosave to IndexedDB
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      setSaveStatus("saving");
      saveAutosaveProject(project)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("idle"));
    }, 600);
    return () => clearTimeout(timer);
  }, [project, hydrated]);

  // Capture snapshot whenever scene canvas is live so Deliver/ZIP works anytime
  const captureSnapshot = useCallback((): string | null => {
    try {
      const cv =
        canvasRef.current ??
        (document.querySelector("main canvas") as HTMLCanvasElement | null);
      if (cv && cv.width > 0 && cv.height > 0) {
        const url = cv.toDataURL("image/jpeg", 0.92);
        lastSnapshotRef.current = url;
        return url;
      }
    } catch {
      // ignore readback failure
    }
    return lastSnapshotRef.current;
  }, []);

  const handleSnapshotCapture = useCallback((url: string) => {
    if (url) lastSnapshotRef.current = url;
  }, []);

  // Coordinated global studio keyboard shortcuts & Escape hierarchy
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editingInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (editingInput) return;
        e.preventDefault();
        if (e.shiftKey) {
          useStudioStore.temporal.getState().redo();
        } else {
          useStudioStore.temporal.getState().undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        if (editingInput) return;
        e.preventDefault();
        useStudioStore.temporal.getState().redo();
        return;
      }
      if (editingInput) return;

      if (e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setWorkspace("build");
      } else if (e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setWorkspace("walk");
      } else if (e.key === "Escape") {
        if (typeof document !== "undefined" && document.pointerLockElement) return;
        const st = useStudioStore.getState();
        if (st.commandPaletteOpen || st.guideOpen || pendingImport || snapshotsOpen) return;
        if (typeof document !== "undefined" && document.querySelector("[data-build-modal='1']")) return;
        if (st.selected !== null) {
          setSelected(null);
        } else if (st.studioPanel !== "none") {
          st.setStudioPanel("none");
        } else if (st.workspace === "walk") {
          setWorkspace("build");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingImport, setSelected, setWorkspace, snapshotsOpen]);

  // Core reactive computation pipeline: synchronous structure for 3D edit responsiveness, deferred heavy sims
  const derived = useMemo(() => buildDerivedModel(project), [project]);
  const struct = useMemo(() => computeStructuralReport(derived), [derived]);
  const deferredProject = useDeferredValue(project);
  const deferredDerived = useMemo(() => buildDerivedModel(deferredProject), [deferredProject]);
  const deferredStruct = useMemo(() => computeStructuralReport(deferredDerived), [deferredDerived]);
  const rab = useMemo(() => buildRabSummary(deferredDerived, deferredStruct), [deferredDerived, deferredStruct]);
  const schedule = useMemo(() => buildScheduleSummary(deferredProject, rab, scheduleScenario), [deferredProject, rab, scheduleScenario]);
  const lighting = useMemo(() => runLightingSimulation(deferredDerived), [deferredDerived]);
  const airflow = useMemo(() => runAirflowSimulation(deferredDerived), [deferredDerived]);
  const flood = useMemo(() => runFloodSimulation(deferredDerived), [deferredDerived]);

  const handleExportJson = useCallback(() => {
    const check = validateProjectImport(project);
    if (!check.success) {
      toast.error(`Proyek mengandung nilai tidak valid: ${check.error.issues[0]?.message ?? "gagal validasi"}`);
      return;
    }
    const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "rumah-5x17";
    const blob = new Blob([JSON.stringify(check.data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.rumahstudio.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast.success("File proyek .json berhasil diunduh.");
  }, [project]);

  const handleImportJson = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = parseVersionedProjectSave(parsed);
      if (res.status === "invalid") {
        toast.error(res.message);
        return;
      }
      setPendingImport(res.data);
    } catch {
      toast.error("Gagal membaca file JSON proyek.");
    }
  }, []);

  const handleSaveSnapshot = useCallback(async () => {
    try {
      const label = `Snapshot ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
      await saveProjectSnapshot(project, label);
      await saveAutosaveProject(project);
      setSaveStatus("saved");
      toast.success(`Tersimpan ke IndexedDB (${label}).`);
    } catch {
      toast.error("Gagal menyimpan snapshot lokal.");
    }
  }, [project]);

  return (
    <div className="flex h-dvh min-h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFileChange}
      />

      <TopBar
        derived={derived}
        rab={rab}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        onSaveSnapshot={handleSaveSnapshot}
        onOpenSnapshots={() => setSnapshotsOpen(true)}
      />

      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {workspace === "build" && (
          <BuildWorkspace
            derived={derived}
            struct={struct}
            rab={rab}
            lighting={lighting}
            airflow={airflow}
            flood={flood}
            onCanvasReady={handleCanvasReady}
            onSnapshotCapture={handleSnapshotCapture}
          />
        )}
        {workspace === "walk" && (
          <WalkWorkspace
            derived={derived}
            struct={struct}
            onSnapshotCapture={handleSnapshotCapture}
          />
        )}
        {workspace === "drawings" && <DrawingsWorkspace derived={derived} struct={struct} />}
        {workspace === "rab" && <RabWorkspace derived={derived} rab={rab} />}
        {workspace === "timeline" && <TimelineWorkspace derived={derived} struct={struct} schedule={schedule} />}
        {workspace === "deliver" && (
          <DeliverWorkspace
            bundleBase={{ derived, struct, rab, schedule, lighting, airflow, flood }}
            getSnapshotDataUrl={captureSnapshot}
            getCanvas={() => canvasRef.current ?? (document.querySelector("main canvas") as HTMLCanvasElement | null)}
          />
        )}
      </main>

      <StatusBar
        derived={derived}
        struct={struct}
        rab={rab}
        lighting={lighting}
        airflow={airflow}
        flood={flood}
        saveStatus={saveStatus}
      />

      <CommandPalette />
      <GuideDrawer open={guideOpen} onClose={() => setGuideOpen(false)} derived={derived} />
      <SnapshotModal open={snapshotsOpen} onClose={() => setSnapshotsOpen(false)} />
      <StudioConfirmDialog
        open={Boolean(pendingImport)}
        title="Muat Proyek dari File JSON?"
        description={
          pendingImport
            ? `Desain saat ini akan digantikan oleh "${pendingImport.name}". Pastikan Anda telah menyimpan snapshot bila diperlukan.`
            : ""
        }
        confirmLabel="Muat Proyek"
        danger={false}
        onConfirm={() => {
          if (pendingImport) {
            loadProject(pendingImport);
            toast.success(`Proyek "${pendingImport.name}" dimuat.`);
          }
          setPendingImport(null);
        }}
        onCancel={() => setPendingImport(null)}
      />
    </div>
  );
}
