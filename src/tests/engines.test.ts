import { describe, expect, it } from "vitest";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { validateProjectImport } from "@/lib/model/schema";
import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { computeStructuralReport } from "@/lib/structure/sniEngine";
import { buildRabSummary } from "@/lib/quantities/rabEngine";
import { buildScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { runLightingSimulation } from "@/lib/simulation/lightingEngine";
import { runAirflowSimulation } from "@/lib/simulation/airflowEngine";
import { runFloodSimulation } from "@/lib/simulation/floodEngine";
import { evaluateGamification } from "@/lib/gamification/simsEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";

describe("Rumah Studio 5x17 Engineering & Simulation Engines", () => {
  it("validates default 5x17 2-storey 3-bedroom project and neighbor boundary rules", () => {
    const proj = createDefaultProject();
    const parsed = validateProjectImport(proj);
    if (!parsed.success) {
      throw new Error(`Zod validation failed: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    expect(parsed.success).toBe(true);
    expect(proj.site.width).toBe(5);
    expect(proj.site.depth).toBe(17);
    expect(proj.gamification.budgetCapIdr).toBe(450_000_000);
    expect(proj.systems.roofType).toBe("shed_front");
    expect(proj.systems.roofSlopeDeg).toBe(10);

    const derived = buildDerivedModel(proj);
    const bedrooms = derived.floors.flatMap((f) => f.rooms).filter((r) => r.room.program === "bedroom");
    expect(bedrooms.length).toBe(3);

    // Party walls (left & right) must not throw critical window violations in default plan
    const criticals = derived.validation.filter((v) => v.severity === "critical");
    expect(criticals).toHaveLength(0);
    expect(derived.totalWallDeductionM2).toBeGreaterThan(2);
    expect(derived.totalNetFloorM2).toBeLessThan(derived.totalGrossAreaM2);
  });

  it("recalculates brick piece count, mortar/thinbed, net floor area, and RAB when customizing brick dimensions", () => {
    const base = createDefaultProject();
    const dBase = buildDerivedModel(base);
    const sBase = computeStructuralReport(dBase);
    const rBase = buildRabSummary(dBase, sBase);

    const customProj = createDefaultProject();
    customProj.systems.brick = {
      ...customProj.systems.brick,
      preset: "custom",
      name: "Bata Custom Tebal 180mm",
      lengthMm: 300,
      heightMm: 150,
      depthMm: 180,
      outerThicknessMm: 200,
      innerThicknessMm: 160,
      mortarMm: 15,
      mortarKind: "cement_sand",
    };
    for (const lv of customProj.levels) {
      for (const w of lv.walls) {
        w.thickness = w.exterior ? 0.2 : 0.16;
      }
    }
    const dCustom = buildDerivedModel(customProj);
    const sCustom = computeStructuralReport(dCustom);
    const rCustom = buildRabSummary(dCustom, sCustom);

    // Larger bricks -> fewer bricks needed vs 600x200x100 vs smaller? Actually 300x150 has half length -> MORE bricks!
    expect(dCustom.masonry.totalBuyBricks).not.toBe(dBase.masonry.totalBuyBricks);
    expect(dCustom.masonry.totalBuyBricks).toBeGreaterThan(dBase.masonry.totalBuyBricks);
    // Thicker walls deduce more net floor area
    expect(dCustom.totalWallDeductionM2).toBeGreaterThan(dBase.totalWallDeductionM2);
    expect(dCustom.totalNetFloorM2).toBeLessThan(dBase.totalNetFloorM2);
    // Cement + sand takeoff active for cement_sand mortar
    expect(dCustom.masonry.cementZak50kg).toBeGreaterThan(0);
    expect(dCustom.masonry.sandM3).toBeGreaterThan(0);
    expect(rCustom.grandTotal).not.toBe(rBase.grandTotal);
  });

  it("supports switching foundation, structural frame, and LT2 slab systems cleanly", () => {
    const p1 = createDefaultProject();
    p1.systems.foundation = "strauss_pile";
    p1.systems.frame = "steel_wf";
    p1.systems.slab = "bondek_wiremesh";

    const d1 = buildDerivedModel(p1);
    const s1 = computeStructuralReport(d1);
    const r1 = buildRabSummary(d1, s1);

    expect(s1.foundations.length).toBeGreaterThan(0);
    expect(s1.bbs.length).toBeGreaterThan(0);
    expect(s1.totalRebarKg).toBeGreaterThan(500);
    expect(r1.divisions.length).toBeGreaterThanOrEqual(8);
    expect(r1.grandTotal).toBeGreaterThan(200_000_000);
  });

  it("produces consistent schedule S-Curve cumulative cost matching RAB grand total", () => {
    const p = createDefaultProject();
    const d = buildDerivedModel(p);
    const s = computeStructuralReport(d);
    const rab = buildRabSummary(d, s);
    const baseSched = buildScheduleSummary(p, rab, "baseline");
    const accelSched = buildScheduleSummary(p, rab, "accelerated");
    const delaySched = buildScheduleSummary(p, rab, "delayed");

    expect(baseSched.stages.length).toBe(12);
    const lastWeek = baseSched.weeklyCashFlow[baseSched.weeklyCashFlow.length - 1]!;
    expect(Math.abs(lastWeek.cumulativePlannedIdr - rab.grandTotal)).toBeLessThan(200);
    expect(accelSched.totalDurationDays).toBeLessThan(baseSched.totalDurationDays);
    expect(delaySched.totalDurationDays).toBeGreaterThan(baseSched.totalDurationDays);
  });

  it("models daylight, airflow velocity/HVAC cooling, and Surabaya rain/flood risk accurately", () => {
    const p = createDefaultProject();
    p.simulation.hourOfDay = 10;
    const d = buildDerivedModel(p);
    const light = runLightingSimulation(d);
    expect(light.solar.isDaylight).toBe(true);
    expect(light.avgHouseLux).toBeGreaterThan(50);

    // Turn off all HVAC first -> 0 W, then turn on -> > 0 W
    p.levels.forEach((lv) =>
      lv.hvac.forEach((h) => {
        h.on = false;
      }),
    );
    const airNoHvac = runAirflowSimulation(buildDerivedModel(p));
    expect(airNoHvac.totalHvacPowerW).toBe(0);

    p.levels.forEach((lv) =>
      lv.hvac.forEach((h) => {
        h.on = true;
      }),
    );
    const dWithHvac = buildDerivedModel(p);
    const airWithHvac = runAirflowSimulation(dWithHvac);
    expect(airWithHvac.totalHvacPowerW).toBeGreaterThan(0);

    // Flood test: dry vs extreme 150 cm Surabaya flood on low 0.35m peil without barrier vs mitigated
    p.simulation.rainIntensityMmH = 120;
    p.simulation.floodDepthCm = 150;
    p.site.peil.floor1PeilM = 0.35;
    p.floodMitigation.doorFloodBarrier = false;
    p.floodMitigation.outletHeightM = 0.3;
    p.floodMitigation.mcbHeightM = 1.1;

    const dFlood = buildDerivedModel(p);
    const floodBad = runFloodSimulation(dFlood);
    expect(floodBad.lt1FloorFloodCm).toBeGreaterThan(0);
    expect(floodBad.electricalHazardMcb).toBe(true);
    expect(floodBad.electricalHazardOutlets).toBe(true);

    // Apply mitigations: higher peil 0.90m + flood barrier 70cm + elevated MCB & outlets
    p.site.peil.floor1PeilM = 0.9;
    p.floodMitigation.doorFloodBarrier = true;
    p.floodMitigation.barrierHeightCm = 70;
    p.floodMitigation.outletHeightM = 0.6;
    p.floodMitigation.mcbHeightM = 1.75;
    const floodSafe = runFloodSimulation(buildDerivedModel(p));
    expect(floodSafe.lt1FloorFloodCm).toBe(0);
    expect(floodSafe.electricalHazardMcb).toBe(false);
    expect(floodSafe.floodResilienceScore).toBeGreaterThan(floodBad.floodResilienceScore);

    const gami = evaluateGamification(
      d,
      buildRabSummary(d, computeStructuralReport(d)),
      computeStructuralReport(d),
      light,
      airWithHvac,
      floodSafe,
    );
    expect(gami.overallComfortScore).toBeGreaterThan(0);
    expect(gami.badges.length).toBeGreaterThanOrEqual(4);
  });

  it("supports Zustand store mutations, movable HVAC addition, custom brick, and Zundo undo/redo", () => {
    const store = useStudioStore.getState();
    store.resetProject();
    useStudioStore.temporal.getState().clear();

    const initialWallThickness = useStudioStore.getState().project.levels[0]!.walls[0]!.thickness;
    store.setBrickPreset("merah");
    expect(useStudioStore.getState().project.systems.brick.preset).toBe("merah");
    expect(useStudioStore.getState().project.levels[0]!.walls[0]!.thickness).not.toBe(initialWallThickness);

    store.addHvac(0, {
      id: "hvac-test-fan",
      type: "stand_fan",
      name: "Kipas Uji",
      position: { x: 2.5, y: 0.9, z: 7.0 },
      rotationY: 0,
      flowRateM3h: 1800,
      coolingCapacityW: 0,
      powerW: 55,
      setpointC: 25,
      speedLevel: 2,
      on: true,
    });
    expect(useStudioStore.getState().project.levels[0]!.hvac.some((h) => h.id === "hvac-test-fan")).toBe(true);

    useStudioStore.temporal.getState().undo();
    expect(useStudioStore.getState().project.levels[0]!.hvac.some((h) => h.id === "hvac-test-fan")).toBe(false);

    useStudioStore.temporal.getState().redo();
    expect(useStudioStore.getState().project.levels[0]!.hvac.some((h) => h.id === "hvac-test-fan")).toBe(true);

    store.resetProject();
  });
});
