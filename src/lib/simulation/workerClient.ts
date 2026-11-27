import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { generateBrickInstances, type BrickInstance } from "@/lib/geometry/masonry";
import { computeRoofMetrics } from "@/lib/geometry/roofAndStairs";
import type { Project } from "@/lib/model/types";
import { runAirflowSimulation, type AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import { runLightingSimulation, type LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { SimulationWorkerRequest, SimulationWorkerResponse } from "@/workers/simulationWorker";

type TaskKind = SimulationWorkerRequest["kind"];

interface PendingEntry {
  kind: TaskKind;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

let workerInstance: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;
const latestIdByKind = new Map<TaskKind, number>();
const pendingMap = new Map<number, PendingEntry>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === "undefined") return null;
  if (workerInstance) return workerInstance;
  try {
    const w = new Worker(new URL("../../workers/simulationWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
      const msg = event.data;
      const entry = pendingMap.get(msg.id);
      if (!entry) return;
      pendingMap.delete(msg.id);
      if (latestIdByKind.get(msg.kind) !== msg.id) {
        entry.resolve(null);
        return;
      }
      entry.resolve(msg.result);
    };
    w.onerror = () => {
      workerFailed = true;
      for (const entry of pendingMap.values()) {
        entry.reject(new Error("Simulation worker error"));
      }
      pendingMap.clear();
      workerInstance?.terminate();
      workerInstance = null;
    };
    workerInstance = w;
    return w;
  } catch {
    workerFailed = true;
    return null;
  }
}

function dispatchWorkerTask<T>(kind: TaskKind, project: Project, syncFallback: () => T): Promise<T | null> {
  const id = nextRequestId++;
  latestIdByKind.set(kind, id);
  const w = getWorker();
  if (!w) {
    return Promise.resolve(syncFallback());
  }
  return new Promise<T | null>((resolve) => {
    pendingMap.set(id, {
      kind,
      resolve: resolve as (v: unknown) => void,
      reject: () => resolve(syncFallback()),
    });
    try {
      w.postMessage({ id, kind, project } satisfies SimulationWorkerRequest);
    } catch {
      pendingMap.delete(id);
      resolve(syncFallback());
    }
  });
}

export function runLightingSimulationAsync(project: Project): Promise<LightingSimulationResult | null> {
  return dispatchWorkerTask("lighting", project, () => {
    const derived = buildDerivedModel(project, { includeBricks: false });
    return runLightingSimulation(derived);
  });
}

export interface SimAllResult {
  lighting: LightingSimulationResult;
  airflow: AirflowSimulationResult;
}

/** OPT-16: batched lighting + airflow request — one structured-clone of the project,
 * one derived-model build in the worker, one zero-copy reply with all 8 buffers. */
export function runSimsAsync(project: Project): Promise<SimAllResult | null> {
  return dispatchWorkerTask("sim_all", project, () => {
    const derived = buildDerivedModel(project, { includeBricks: false });
    return {
      lighting: runLightingSimulation(derived),
      airflow: runAirflowSimulation(derived),
    } satisfies SimAllResult;
  });
}

export function runAirflowSimulationAsync(project: Project): Promise<AirflowSimulationResult | null> {
  return dispatchWorkerTask("airflow", project, () => {
    const derived = buildDerivedModel(project, { includeBricks: false });
    return runAirflowSimulation(derived);
  });
}

export function generateBricksAsync(project: Project): Promise<BrickInstance[] | null> {
  return dispatchWorkerTask("bricks", project, () => {
    const roof = computeRoofMetrics(project);
    return generateBrickInstances(project.levels, project.systems.brick, roof.extraWallHeightAt);
  });
}
