"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { computeStructuralReport } from "@/lib/structure/sniEngine";
import { buildRabSummary } from "@/lib/quantities/rabEngine";
import { buildScheduleSummary, type ScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { type LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import { type AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import { runFloodSimulation, type FloodSimulationResult } from "@/lib/simulation/floodEngine";
import { runAirflowSimulationAsync, generateBricksAsync, runLightingSimulationAsync } from "@/lib/simulation/workerClient";
import { parseVersionedProjectSave, validateProjectImport } from "@/lib/model/schema";
import type { BrickSpec, Level, Project } from "@/lib/model/types";
import type { BrickInstance } from "@/lib/geometry/masonry";
import { loadLatestProject, quarantineCorruptSave, saveAutosaveProject, saveProjectSnapshot } from "@/lib/store/db";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { useBuildModeStore } from "@/features/buildMode/store";
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

const EMPTY_SCHEDULE: ScheduleSummary = {
  stages: [],
  totalDurationDays: 0,
  totalWeeks: 0,
  weeklyCashFlow: [],
  procurementOrders: [],
  nextStageFunding: null,
  earnedValue: { pv: 0, ev: 0, ac: 0, cpi: 1, spi: 1, eac: 0, vac: 0 },
  scenarios: { baselineDays: 0, acceleratedDays: 0, acceleratedCostIdr: 0, delayedDays: 0, delayedCostIdr: 0 },
};

const EMPTY_LIGHTING: LightingSimulationResult = {
  solar: { altitudeDeg: 45, azimuthDeg: 90, sunDir: [0.45, 0.78, -0.42], skyIrradianceLux: 0, isDaylight: true },
  rooms: [],
  gridWidth: 25,
  gridDepth: 85,
  lt1LuxGrid: new Float32Array(25 * 85),
  lt2LuxGrid: new Float32Array(25 * 85),
  avgHouseLux: 0,
  sniCompliancePct: 0,
  daylightScore: 0,
  recommendations: [],
  methodologyNote: "",
};

const EMPTY_AIRFLOW: AirflowSimulationResult = {
  zones: [],
  gridW: 25,
  gridD: 85,
  lt1VelX: new Float32Array(25 * 85),
  lt1VelZ: new Float32Array(25 * 85),
  lt1Temp: new Float32Array(25 * 85).fill(29),
  lt2VelX: new Float32Array(25 * 85),
  lt2VelZ: new Float32Array(25 * 85),
  lt2Temp: new Float32Array(25 * 85).fill(29),
  avgAch: 0,
  crossVentPct: 0,
  totalCoolingLoadW: 0,
  totalHvacPowerW: 0,
  airflowScore: 0,
  recommendations: [],
  methodologyNote: "",
};

const EMPTY_FLOOD: FloodSimulationResult = {
  rainfallMmH: 0,
  roofRunoffLps: 0,
  gutterCapacityLps: 0,
  downspoutCapacityLps: 0,
  gutterOverflowRisk: false,
  rearVoidSplashDepthM: 0,
  infiltrationCapacityLph: 0,
  pumpCapacityLph: 0,
  streetFloodCm: 0,
  effectiveBarrierHeightCm: 0,
  lt1FloorFloodCm: 0,
  carportFloodCm: 0,
  terraceFloodCm: 0,
  backflowActive: false,
  electricalHazardOutlets: false,
  electricalHazardMcb: false,
  lt2EvacuationSafe: true,
  zoneImpacts: [],
  floodResilienceScore: 100,
  warnings: [],
  mitigationTips: [],
};

export default function HomePage() {
  const project = useStudioStore((s) => s.project);
  const workspace = useStudioStore((s) => s.workspace);
  const scheduleScenario = useStudioStore((s) => s.scheduleScenario);
  const showBricksView = useStudioStore((s) => s.view.showBricks);
  const showFinishingView = useStudioStore((s) => s.view.showFinishing);
  const cutHView = useStudioStore((s) => s.view.cutH);
  const explodeView = useStudioStore((s) => s.view.explode);
  const stageView = useStudioStore((s) => s.view.stage);
  const showBricksOverlay = useBuildModeStore((s) => s.showBricksOverlay);
  const guideOpen = useStudioStore((s) => s.guideOpen);
  const setGuideOpen = useStudioStore((s) => s.setGuideOpen);
  const loadProject = useStudioStore((s) => s.loadProject);
  const setSelected = useStudioStore((s) => s.setSelected);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSnapshotRef = useRef<string | null>(null);
  const lastSavedProjectRef = useRef<Project | null>(null);
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
            lastSavedProjectRef.current = check.data;
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

  // Debounced autosave to IndexedDB (skip redundant write immediately after hydration or unchanged ref)
  useEffect(() => {
    if (!hydrated || project === lastSavedProjectRef.current) return;
    const timer = setTimeout(() => {
      setSaveStatus("saving");
      saveAutosaveProject(project)
        .then(() => {
          lastSavedProjectRef.current = project;
          setSaveStatus("saved");
        })
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

  // Core reactive computation pipeline: slice-memoized geometry + lazy bricks + deferred heavy sims
  const needBricks =
    workspace === "build" &&
    showBricksView &&
    (showBricksOverlay || !showFinishingView || explodeView > 0.05 || cutHView < 10 || (stageView > 0 && stageView <= 7));

  const coreGeom = useMemo(
    () => buildDerivedModel(project, { includeBricks: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- project.simulation/priceBook/rabSettings do not alter core geometry
    [project.site, project.levels, project.systems, project.structuralParams],
  );

  // PF-18: brick-by-brick arrays (Bata Merah ~15k instances) are generated in the simulation
  // Web Worker (with an automatic synchronous fallback for SSR/Vitest) and merged into the
  // derived model only when the result matches the current geometry identity.
  const [asyncBricks, setAsyncBricks] = useState<{
    levels: Level[];
    brick: BrickSpec;
    bricks: BrickInstance[];
  } | null>(null);
  useEffect(() => {
    if (!hydrated || !needBricks) return;
    let active = true;
    void generateBricksAsync(project).then((bricks) => {
      if (!active || !bricks) return;
      setAsyncBricks({ levels: project.levels, brick: project.systems.brick, bricks });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bricks depend only on levels, brick spec, and roof-affecting site/systems inputs
  }, [hydrated, needBricks, project.site, project.levels, project.systems]);

  const derived = useMemo(() => {
    const base = coreGeom.project === project ? coreGeom : { ...coreGeom, project };
    if (
      !needBricks ||
      !asyncBricks ||
      asyncBricks.levels !== project.levels ||
      asyncBricks.brick !== project.systems.brick
    ) {
      return base;
    }
    // The merged brick array rides on a fresh `systems` reference (the brick spec is
    // a systems input): BuildScene's incremental rebuild compares input references,
    // so each late-arriving worker result triggers exactly one house rebuild while
    // every system value stays identical.
    return {
      ...base,
      masonry: { ...base.masonry, bricks: asyncBricks.bricks },
      project: { ...project, systems: { ...project.systems } },
    };
  }, [coreGeom, project, needBricks, asyncBricks]);
  const struct = useMemo(() => computeStructuralReport(coreGeom), [coreGeom]);

  const deferredProject = useDeferredValue(project);
  const deferredCoreGeom = useDeferredValue(coreGeom);
  const deferredStruct = useDeferredValue(struct);
  const rabInputDerived = useMemo(
    () => (deferredCoreGeom.project === deferredProject ? deferredCoreGeom : { ...deferredCoreGeom, project: deferredProject }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- RAB ignores simulation sliders and stageProgress
    [
      deferredCoreGeom,
      deferredProject.priceBook,
      deferredProject.rabSettings,
      deferredProject.floodMitigation,
      deferredProject.buildExtras,
    ],
  );
  const rab = useMemo(() => buildRabSummary(rabInputDerived, deferredStruct), [rabInputDerived, deferredStruct]);

  const scheduleNeeded = workspace === "timeline" || workspace === "deliver";
  const schedule = useMemo(
    () => (scheduleNeeded ? buildScheduleSummary(deferredProject, rab, scheduleScenario) : EMPTY_SCHEDULE),
    [scheduleNeeded, deferredProject, rab, scheduleScenario],
  );

  const simInputDerived = useMemo(
    () => (deferredCoreGeom.project === deferredProject ? deferredCoreGeom : { ...deferredCoreGeom, project: deferredProject }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Sims depend only on geometry, site peil/mitigation, and simulation env
    [deferredCoreGeom, deferredProject.simulation, deferredProject.floodMitigation],
  );
  const [lighting, setLighting] = useState<LightingSimulationResult>(EMPTY_LIGHTING);
  const [airflow, setAirflow] = useState<AirflowSimulationResult>(EMPTY_AIRFLOW);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    const simProj = simInputDerived.project;
    void runLightingSimulationAsync(simProj).then((res) => {
      if (active && res) setLighting(res);
    });
    void runAirflowSimulationAsync(simProj).then((res) => {
      if (active && res) setAirflow(res);
    });
    return () => {
      active = false;
    };
  }, [hydrated, simInputDerived]);

  const flood = useMemo(
    () => (hydrated ? runFloodSimulation(simInputDerived) : EMPTY_FLOOD),
    [hydrated, simInputDerived],
  );

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
