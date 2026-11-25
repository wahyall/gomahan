"use client";

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
import { Viewport3D } from "@/components/viewport/Viewport3D";
import { OutlinerPanel } from "@/components/panels/OutlinerPanel";
import { InspectorPanel } from "@/components/panels/InspectorPanel";
import { StageTimelineBar } from "@/components/panels/StageTimelineBar";
import { BuildWorkspace } from "@/components/build/BuildWorkspace";
import { WalkWorkspace } from "@/components/walk/WalkWorkspace";
import { StructureWorkspace } from "@/components/workspaces/StructureWorkspace";
import { LightingWorkspace } from "@/components/workspaces/LightingWorkspace";
import { AirflowWorkspace } from "@/components/workspaces/AirflowWorkspace";
import { FloodWorkspace } from "@/components/workspaces/FloodWorkspace";
import { DrawingsWorkspace } from "@/components/workspaces/DrawingsWorkspace";
import { RabWorkspace } from "@/components/workspaces/RabWorkspace";
import { TimelineWorkspace } from "@/components/workspaces/TimelineWorkspace";
import { DeliverWorkspace } from "@/components/workspaces/DeliverWorkspace";
import { SiteModeWorkspace } from "@/components/workspaces/SiteModeWorkspace";
import { GuideWorkspace } from "@/components/workspaces/GuideWorkspace";
import { cn } from "@/lib/utils";
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

  // Load latest IndexedDB autosave post-mount (handles v1 legacy saves safely without crashing or corrupting data)
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
      const cv = sceneRef.current?.getCanvas();
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

  useEffect(() => {
    const id = setInterval(() => {
      if (sceneRef.current) captureSnapshot();
    }, 2500);
    return () => clearInterval(id);
  }, [captureSnapshot]);

  // Global studio keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z, Shift+B Build Stub, Shift+V Walk Stub, Esc)
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
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
        <div className="no-print flex shrink-0 items-center gap-1 border-b border-border bg-[#191c21] px-3 py-1.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSimTab("panel")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded py-1 text-xs font-semibold",
              mobileSimTab === "panel" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Panel Analisis
          </button>
          <button
            type="button"
            onClick={() => setMobileSimTab("3d")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded py-1 text-xs font-semibold",
              mobileSimTab === "3d" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
            )}
          >
            <Eye className="h-3.5 w-3.5" /> Tampilan 3D Live
          </button>
        </div>
      )}

      {/* Main Studio Shell */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* New Sims 4-inspired Unified Single-Source Build Mode + Phase 0 Walk Stub */}
        {isBuildStub && (
          <BuildWorkspace
            derived={derived}
            struct={struct}
            lighting={lighting}
            airflow={airflow}
            onExportJson={handleExportJson}
            onImportJson={handleImportJson}
            onSaveSnapshot={handleSaveSnapshot}
          />
        )}
        {isWalkStub && <WalkWorkspace derived={derived} struct={struct} />}

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
            />
            <StageTimelineBar />
          </section>
        )}

        {/* Optional SNI / Brick Inspector Drawer Toggle inside Build Mode */}
        {isBuildStub && (
          <button
            type="button"
            onClick={() => setBuildSniOpen((v) => !v)}
            className="no-print absolute left-2.5 top-[46px] z-20 flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1a1f27]/92 px-2.5 py-1.5 text-[11px] font-semibold text-foreground shadow-lg backdrop-blur-md hover:border-primary/60 sm:top-2"
            title="Buka / Tutup Panel Sistem Arsitektur SNI & Custom Ukuran Bata"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">{buildSniOpen ? "Tutup Panel SNI" : "Data SNI & Bata"}</span>
            <span className="sm:hidden">SNI</span>
          </button>
        )}

        {/* Right Dock: Outliner + Inspector when opened in Build Mode (responsive desktop + tablet/mobile drawer) */}
        {isBuildStub && buildSniOpen && (
          <aside className="no-print absolute bottom-0 right-0 top-0 z-30 flex w-[300px] shrink-0 flex-col border-l border-border bg-[#181a1f]/98 shadow-2xl backdrop-blur-md lg:static lg:z-auto lg:w-[320px] lg:shadow-none xl:w-[348px]">
            <div className="flex h-[38%] min-h-[180px] flex-col">
              <OutlinerPanel derived={derived} struct={struct} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <InspectorPanel derived={derived} />
            </div>
          </aside>
        )}

        {/* Analytical Split Panel (Structure / Lighting / Airflow / Flood) */}
        {isSimSplit && (
          <aside
            className={cn(
              "min-h-0 w-full shrink-0 flex-col border-l border-border bg-background lg:flex lg:w-[490px] xl:w-[560px]",
              mobileSimTab === "panel" ? "flex" : "hidden lg:flex",
            )}
          >
            {workspace === "structure" && <StructureWorkspace derived={derived} struct={struct} />}
            {workspace === "lighting" && <LightingWorkspace lighting={lighting} />}
            {workspace === "airflow" && <AirflowWorkspace derived={derived} airflow={airflow} />}
            {workspace === "flood" && <FloodWorkspace derived={derived} flood={flood} />}
          </aside>
        )}

        {/* Full-Width Engineering / Business / Site Workspaces */}
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
          className="no-print fixed bottom-10 right-4 z-50 flex items-center gap-2 rounded-lg border border-primary/40 bg-[#1a1d24]/95 px-3.5 py-2 text-xs font-medium text-foreground shadow-xl backdrop-blur"
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
