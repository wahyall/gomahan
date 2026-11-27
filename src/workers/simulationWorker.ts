import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { generateBrickInstances, type BrickInstance } from "@/lib/geometry/masonry";
import { computeRoofMetrics } from "@/lib/geometry/roofAndStairs";
import type { Project } from "@/lib/model/types";
import { runAirflowSimulation, type AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import { runLightingSimulation, type LightingSimulationResult } from "@/lib/simulation/lightingEngine";

export type SimulationWorkerRequest =
  | { id: number; kind: "lighting"; project: Project }
  | { id: number; kind: "airflow"; project: Project }
  | { id: number; kind: "bricks"; project: Project }
  | { id: number; kind: "sim_all"; project: Project };

export type SimulationWorkerResponse =
  | { id: number; kind: "lighting"; result: LightingSimulationResult }
  | { id: number; kind: "airflow"; result: AirflowSimulationResult }
  | { id: number; kind: "bricks"; result: BrickInstance[] }
  | { id: number; kind: "sim_all"; result: { lighting: LightingSimulationResult; airflow: AirflowSimulationResult } };

const workerScope = self as unknown as {
  postMessage(message: SimulationWorkerResponse, options?: { transfer?: Transferable[] }): void;
  addEventListener: typeof self.addEventListener;
};

workerScope.addEventListener("message", (event: MessageEvent<SimulationWorkerRequest>) => {
  const req = event.data;
  if (req.kind === "sim_all") {
    // OPT-16: one derived-model build feeds both engines (the old path built it
    // twice for two separate messages) and all 8 Float32Array buffers transfer
    // zero-copy in a single postMessage.
    const derived = buildDerivedModel(req.project, { includeBricks: false });
    const lighting = runLightingSimulation(derived);
    const airflow = runAirflowSimulation(derived);
    const transfers: Transferable[] = [
      lighting.lt1LuxGrid.buffer,
      lighting.lt2LuxGrid.buffer,
      airflow.lt1VelX.buffer,
      airflow.lt1VelZ.buffer,
      airflow.lt1Temp.buffer,
      airflow.lt2VelX.buffer,
      airflow.lt2VelZ.buffer,
      airflow.lt2Temp.buffer,
    ];
    workerScope.postMessage({ id: req.id, kind: "sim_all", result: { lighting, airflow } }, { transfer: transfers });
    return;
  }

  if (req.kind === "lighting") {
    const derived = buildDerivedModel(req.project, { includeBricks: false });
    const result = runLightingSimulation(derived);
    const transfers: Transferable[] = [result.lt1LuxGrid.buffer, result.lt2LuxGrid.buffer];
    workerScope.postMessage({ id: req.id, kind: "lighting", result }, { transfer: transfers });
    return;
  }

  if (req.kind === "airflow") {
    const derived = buildDerivedModel(req.project, { includeBricks: false });
    const result = runAirflowSimulation(derived);
    const transfers: Transferable[] = [
      result.lt1VelX.buffer,
      result.lt1VelZ.buffer,
      result.lt1Temp.buffer,
      result.lt2VelX.buffer,
      result.lt2VelZ.buffer,
      result.lt2Temp.buffer,
    ];
    workerScope.postMessage({ id: req.id, kind: "airflow", result }, { transfer: transfers });
    return;
  }

  if (req.kind === "bricks") {
    const roof = computeRoofMetrics(req.project);
    const result = generateBrickInstances(req.project.levels, req.project.systems.brick, roof.extraWallHeightAt);
    workerScope.postMessage({ id: req.id, kind: "bricks", result });
  }
});
