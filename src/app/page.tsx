"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { computeStructuralReport } from "@/lib/structure/sniEngine";
import { buildRabSummary } from "@/lib/quantities/rabEngine";
import { buildScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { runLightingSimulation } from "@/lib/simulation/lightingEngine";
import { runAirflowSimulation } from "@/lib/simulation/airflowEngine";
import { runFloodSimulation } from "@/lib/simulation/floodEngine";
import { evaluateGamification } from "@/lib/gamification/simsEngine";
import { parseVersionedProjectSave } from "@/lib/model/schema";
import { loadLatestProject, saveAutosaveProject, saveProjectSnapshot } from "@/lib/store/db";
import { useStudioStore, type WorkspaceId } from "@/lib/store/useStudioStore";
import type { HouseScene } from "@/lib/scene/HouseScene";
import { TopBar } from "@/components/shell/TopBar";
import { StatusBar } from "@/components/shell/StatusBar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { BuildWorkspace } from "@/components/build/BuildWorkspace";
import { cn } from "@/lib/utils";

function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[240px] w-full flex-1 items-center justify-center bg-[#0d1015] text-xs font-medium text-muted-foreground">
      Memuat {label}...
    </div>
  );
}

const Viewport3D = dynamic(
  () => import("@/components/viewport/Viewport3D").then((m) => m.Viewport3D),
  { ssr: false, loading: () => <WorkspaceLoading label="Viewport 3D" /> },
);
const OutlinerPanel = dynamic(
  () => import("@/components/panels/OutlinerPanel").then((m) => m.OutlinerPanel),
  { ssr: false },
);
const InspectorPanel = dynamic(
  () => import("@/components/panels/InspectorPanel").then((m) => m.InspectorPanel),
  { ssr: false },
);
const StageTimelineBar = dynamic(
  () => import("@/components/panels/StageTimelineBar").then((m) => m.StageTimelineBar),
  { ssr: false },
);
const WalkWorkspace = dynamic(
  () => import("@/components/walk/WalkWorkspace").then((m) => m.WalkWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Walk Mode 3D" /> },
);
const StructureWorkspace = dynamic(
  () => import("@/components/workspaces/StructureWorkspace").then((m) => m.StructureWorkspace),
  { ssr: false },
);
const LightingWorkspace = dynamic(
  () => import("@/components/workspaces/LightingWorkspace").then((m) => m.LightingWorkspace),
  { ssr: false },
);
const AirflowWorkspace = dynamic(
  () => import("@/components/workspaces/AirflowWorkspace").then((m) => m.AirflowWorkspace),
  { ssr: false },
);
const FloodWorkspace = dynamic(
  () => import("@/components/workspaces/FloodWorkspace").then((m) => m.FloodWorkspace),
  { ssr: false },
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
  { ssr: false, loading: () => <WorkspaceLoading label="Jadwal Konstruksi" /> },
);
const DeliverWorkspace = dynamic(
  () => import("@/components/workspaces/DeliverWorkspace").then((m) => m.DeliverWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Pusat Ekspor" /> },
);
const SiteModeWorkspace = dynamic(
  () => import("@/components/workspaces/SiteModeWorkspace").then((m) => m.SiteModeWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Mode Lapangan" /> },
);
const GuideWorkspace = dynamic(
  () => import("@/components/workspaces/GuideWorkspace").then((m) => m.GuideWorkspace),
  { ssr: false, loading: () => <WorkspaceLoading label="Panduan Studio" /> },
);
import { Eye, SlidersHorizontal, X } from "lucide-react";

const SIM_SPLIT_WORKSPACES: WorkspaceId[] = ["structure", "lighting", "airflow", "flood"];

export default function HomePage() {
  const project = useStudioStore((s) => s.project);
  const workspace = useStudioStore((s) => s.workspace);
  const scheduleScenario = useStudioStore((s) => s.scheduleScenario);
  const loadProject = useStudioStore((s) => s.loadProject);
  const setSelected = useStudioStore((s) => s.setSelected);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const sceneRef = useRef<HouseScene | null>(null);
  const lastSnapshotRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [mobileSimTab, setMobileSimTab] = useState<"panel" | "3d">("panel");
  const [buildSniOpen, setBuildSniOpen] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Load latest IndexedDB autosave post-mount
  useEffect(() => {
    let active = true;
    loadLatestProject()
      .then((saved) => {
        if (!active) return;
        if (saved) {
          const check = parseVersionedProjectSave(saved);
          if (check.status === "ok") {
            loadProject(check.data);
          } else if (check.status === "legacy_ignored") {
            showToast(check.message);
          }
        }
        setHydrated(true);
        setSaveStatus("saved");
      })
      .catch(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [loadProject, showToast]);

  const handleSceneReady = useCallback((sc: HouseScene | null) => {
    sceneRef.current = sc;
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
        sceneRef.current?.getCanvas() ??
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

  // Global studio keyboard shortcuts
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
        setSelected(null);
        if (useStudioStore.getState().workspace === "walk") {
          setWorkspace("build");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSelected, setWorkspace]);

  // Core reactive computation pipeline
  const derived = useMemo(() => buildDerivedModel(project), [project]);
  const struct = useMemo(() => computeStructuralReport(derived), [derived]);
  const rab = useMemo(() => buildRabSummary(derived, struct), [derived, struct]);
  const schedule = useMemo(() => buildScheduleSummary(project, rab, scheduleScenario), [project, rab, scheduleScenario]);
  const lighting = useMemo(() => runLightingSimulation(derived), [derived]);
  const airflow = useMemo(() => runAirflowSimulation(derived), [derived]);
  const flood = useMemo(() => runFloodSimulation(derived), [derived]);
  const gamification = useMemo(
    () => evaluateGamification(derived, rab, struct, lighting, airflow, flood),
    [derived, rab, struct, lighting, airflow, flood],
  );

  const handleExportJson = useCallback(() => {
    const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "rumah-5x17";
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.rumahstudio.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("File proyek .json berhasil diunduh.");
  }, [project, showToast]);

  const handleImportJson = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const res = parseVersionedProjectSave(parsed);
        if (res.status === "legacy_ignored") {
          showToast(res.message);
          return;
        }
        if (res.status === "invalid") {
          showToast(res.message);
          return;
        }
        loadProject(res.data);
        showToast(`Proyek "${res.data.name}" dimuat.`);
      } catch {
        showToast("Gagal membaca file JSON proyek.");
      }
    },
    [loadProject, showToast],
  );

  const handleSaveSnapshot = useCallback(async () => {
    try {
      const label = `Snapshot ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
      await saveProjectSnapshot(project, label);
      await saveAutosaveProject(project);
      setSaveStatus("saved");
      showToast(`Tersimpan ke IndexedDB (${label}).`);
    } catch {
      showToast("Gagal menyimpan snapshot lokal.");
    }
  }, [project, showToast]);

  const isBuildStub = workspace === "build";
  const isWalkStub = workspace === "walk";
  const isSimSplit = SIM_SPLIT_WORKSPACES.includes(workspace);

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
      />

      {/* Mobile switcher inside split simulation workspaces */}
      {isSimSplit && (
        <div className="no-print flex shrink-0 items-center gap-1.5 border-b border-border bg-[#15181e] px-3 py-1.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSimTab("panel")}
            className={cn(
              "flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition",
              mobileSimTab === "panel" ? "bg-[#f2efe8] text-[#14171c]" : "bg-card text-muted-foreground",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Panel Analisis
          </button>
          <button
            type="button"
            onClick={() => setMobileSimTab("3d")}
            className={cn(
              "flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition",
              mobileSimTab === "3d" ? "bg-[#f2efe8] text-[#14171c]" : "bg-card text-muted-foreground",
            )}
          >
            <Eye className="h-3.5 w-3.5" /> Tampilan 3D Live
          </button>
        </div>
      )}

      {/* Main Studio Shell */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {isBuildStub && (
          <BuildWorkspace
            derived={derived}
            struct={struct}
            lighting={lighting}
            airflow={airflow}
            buildSniOpen={buildSniOpen}
            onToggleBuildSni={() => setBuildSniOpen((v) => !v)}
            onSnapshotCapture={handleSnapshotCapture}
          />
        )}
        {isWalkStub && (
          <WalkWorkspace
            derived={derived}
            struct={struct}
            onSnapshotCapture={handleSnapshotCapture}
          />
        )}

        {/* Analytical 3D Viewport + Timeline */}
        {isSimSplit && (
          <section
            className={cn(
              "min-h-0 flex-1 flex-col overflow-hidden",
              mobileSimTab === "panel" ? "hidden lg:flex" : "flex",
            )}
          >
            <Viewport3D
              derived={derived}
              struct={struct}
              rab={rab}
              lighting={lighting}
              airflow={airflow}
              flood={flood}
              gamification={gamification}
              onSceneReady={handleSceneReady}
              onSnapshotCapture={handleSnapshotCapture}
            />
            <StageTimelineBar />
          </section>
        )}

        {/* Right Dock: Outliner + Inspector when opened in Build Mode */}
        {isBuildStub && buildSniOpen && (
          <aside className="no-print absolute bottom-0 right-0 top-0 z-30 flex w-[310px] shrink-0 flex-col border-l border-border bg-[#14181f]/98 shadow-2xl backdrop-blur-xl lg:static lg:z-auto lg:w-[332px] lg:shadow-none xl:w-[356px]">
            <div className="flex h-[36%] min-h-[175px] flex-col">
              <OutlinerPanel derived={derived} struct={struct} onCloseDrawer={() => setBuildSniOpen(false)} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <InspectorPanel derived={derived} />
            </div>
          </aside>
        )}

        {/* Analytical Split Panel (container-queried so controls never squeeze into narrow cols!) */}
        {isSimSplit && (
          <aside
            className={cn(
              "@container min-h-0 w-full shrink-0 flex-col border-l border-border bg-background lg:flex lg:w-[500px] xl:w-[570px] 2xl:w-[630px]",
              mobileSimTab === "panel" ? "flex" : "hidden lg:flex",
            )}
          >
            {workspace === "structure" && <StructureWorkspace derived={derived} struct={struct} />}
            {workspace === "lighting" && <LightingWorkspace lighting={lighting} />}
            {workspace === "airflow" && <AirflowWorkspace derived={derived} airflow={airflow} />}
            {workspace === "flood" && <FloodWorkspace derived={derived} flood={flood} />}
          </aside>
        )}

        {/* Full-Width Workspaces */}
        {workspace === "drawings" && <DrawingsWorkspace derived={derived} struct={struct} />}
        {workspace === "rab" && <RabWorkspace derived={derived} rab={rab} />}
        {workspace === "timeline" && <TimelineWorkspace schedule={schedule} />}
        {workspace === "deliver" && (
          <DeliverWorkspace
            bundleBase={{ derived, struct, rab, schedule, lighting, airflow, flood }}
            getSnapshotDataUrl={captureSnapshot}
            getCanvas={() => sceneRef.current?.getCanvas() ?? null}
          />
        )}
        {workspace === "site" && <SiteModeWorkspace derived={derived} struct={struct} schedule={schedule} />}
        {workspace === "guide" && <GuideWorkspace derived={derived} />}
      </main>

      <StatusBar
        derived={derived}
        struct={struct}
        rab={rab}
        lighting={lighting}
        airflow={airflow}
        flood={flood}
        gamification={gamification}
        saveStatus={saveStatus}
      />

      <CommandPalette />

      {toast && (
        <div
          role="status"
          className="studio-glass no-print fixed bottom-10 right-4 z-50 flex items-center gap-2 rounded-xl border-primary/40 px-3.5 py-2 text-xs font-medium text-foreground shadow-xl"
        >
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
