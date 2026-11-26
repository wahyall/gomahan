import { describe, expect, it } from "vitest";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { CURRENT_PROJECT_SCHEMA_VERSION, parseVersionedProjectSave, validateProjectImport } from "@/lib/model/schema";
import { buildDerivedModel } from "@/lib/geometry/projectModel";
import { computeStructuralReport } from "@/lib/structure/sniEngine";
import { buildRabSummary } from "@/lib/quantities/rabEngine";
import { buildScheduleSummary } from "@/lib/timeline/scheduleEngine";
import { runLightingSimulation } from "@/lib/simulation/lightingEngine";
import { runAirflowSimulation } from "@/lib/simulation/airflowEngine";
import { runFloodSimulation } from "@/lib/simulation/floodEngine";
import { buildExcelWorkbookBlob, buildPdfDrawingsAndReportBlob, generateTakeoffCsv } from "@/lib/export/exporters";
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
    expect(proj.budgetCapIdr).toBe(450_000_000);
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
    p.floodMitigation.outletHeightM = 1.1;
    p.floodMitigation.mcbHeightM = 1.75;
    const floodSafe = runFloodSimulation(buildDerivedModel(p));
    expect(floodSafe.lt1FloorFloodCm).toBe(0);
    expect(floodSafe.electricalHazardMcb).toBe(false);
    expect(floodSafe.floodResilienceScore).toBeGreaterThan(floodBad.floodResilienceScore);

    // Night illumination with lights off must produce daylightScore === 0 & failing natural light (BL-05)
    const pNight = createDefaultProject();
    pNight.simulation.hourOfDay = 22;
    pNight.levels.forEach((lv) => lv.lights.forEach((l) => { l.on = false; }));
    const nightLight = runLightingSimulation(buildDerivedModel(pNight));
    expect(nightLight.daylightScore).toBe(0);
    expect(nightLight.sniCompliancePct).toBe(0);

    // Hot weather with all ACs off & calm wind must penalize living room instead of bypassing as NYAMAN (BL-06)
    const pHot = createDefaultProject();
    pHot.simulation.ambientTempC = 36;
    pHot.simulation.windSpeedMs = 0.2;
    pHot.levels.forEach((lv) => lv.hvac.forEach((h) => { h.on = false; }));
    const airHot = runAirflowSimulation(buildDerivedModel(pHot));
    const tamuHot = airHot.zones.find((z) => z.roomId === "r1-tamu")!;
    expect(tamuHot.comfortStatus === "PENGAP" || tamuHot.comfortStatus === "HANGAT").toBe(true);
  });

  it("supports Zustand store mutations, temporal equality (0 UI undo noise), and batch updates", () => {
    const store = useStudioStore.getState();
    store.resetProject();
    useStudioStore.temporal.getState().clear();

    // UI-only actions must NOT pollute Zundo undo stack (EC-03)
    store.setWorkspace("rab");
    store.patchView({ showDims: true, explode: 0.4 });
    store.setSelected({ kind: "part", id: "kolom" });
    expect(useStudioStore.temporal.getState().pastStates.length).toBe(0);

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

    // Batch furniture update must create exactly 1 undo entry
    const undoDepthBeforeBatch = useStudioStore.temporal.getState().pastStates.length;
    const furnUpdates = useStudioStore.getState().project.levels[0]!.furniture.slice(0, 2).map((f) => ({
      id: f.id,
      patch: { colorHex: "#b86b52" },
    }));
    store.updateFurnitureBatch(0, furnUpdates);
    expect(useStudioStore.temporal.getState().pastStates.length).toBe(undoDepthBeforeBatch + 1);
    useStudioStore.temporal.getState().undo();

    useStudioStore.temporal.getState().undo();
    expect(useStudioStore.getState().project.levels[0]!.hvac.some((h) => h.id === "hvac-test-fan")).toBe(false);

    useStudioStore.temporal.getState().redo();
    expect(useStudioStore.getState().project.levels[0]!.hvac.some((h) => h.id === "hvac-test-fan")).toBe(true);

    store.resetProject();
  });

  it("migrates legacy v1/v2 saves forward safely to v3 and rejects corrupt saves", () => {
    const legacyV1 = { ...createDefaultProject(), schemaVersion: 1 };
    const resV1 = parseVersionedProjectSave(legacyV1);
    expect(resV1.status).toBe("ok");
    if (resV1.status === "ok") {
      expect(resV1.migratedFromVersion).toBe(1);
      expect(resV1.data.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
      expect(resV1.data.priceBook.items["bata_precast"]).toBeDefined();
    }

    const corrupt = { notAProject: true, schemaVersion: 3 };
    const resBad = parseVersionedProjectSave(corrupt);
    expect(resBad.status).toBe("invalid");

    const v3 = createDefaultProject();
    const resV3 = parseVersionedProjectSave(v3);
    expect(resV3.status).toBe("ok");
  });

  it("enforces RAB borongan_pct, schedule total reconciliation, pool/tile buildExtras, and SNI column failures", () => {
    const p = createDefaultProject();
    p.rabSettings.laborMode = "borongan_pct";
    p.rabSettings.boronganPct = 30;
    p.systems.brick.preset = "precast";
    p.systems.slab = "bondek_wiremesh";
    p.buildExtras = {
      floorTiles: [{ gx: 4, gz: 12, levelIndex: 0, materialId: "floor_wood_oak" }],
      pools: [{ id: "pool-1", gx1: 5, gz1: 28, gx2: 8, gz2: 31, depth: 1.2 }],
      terrainHeights: [],
    };
    const d = buildDerivedModel(p);
    const s = computeStructuralReport(d);
    const rab = buildRabSummary(d, s);
    const sched = buildScheduleSummary(p, rab, "baseline", 45);

    const divSum = rab.divisions.reduce((sum, dv) => sum + dv.subtotal, 0);
    expect(divSum).toBeCloseTo(rab.directSubtotal, 0);
    expect(rab.rows.some((r) => r.priceKey === "bata_precast")).toBe(true);
    expect(rab.rows.some((r) => r.id === "pool_beton")).toBe(true);
    expect(s.wiremeshM2).toBeGreaterThan(0);

    const stageSum = sched.stages.reduce((sum, st) => sum + st.budgetIdr, 0);
    expect(stageSum).toBe(rab.grandTotal);
    expect(sched.scenarios.baselineDays).toBe(sched.totalDurationDays);

    // Overloaded columns / low-ductility seismic params trigger PERIKSA and set overallSafe === false (BL-03)
    const pWeak = createDefaultProject();
    pWeak.systems.brick.preset = "merah";
    pWeak.structuralParams.concreteFcMpa = 15;
    pWeak.structuralParams.rebarFyMpa = 240;
    pWeak.structuralParams.seismicR = 3;
    pWeak.structuralParams.seismicI = 1.5;
    pWeak.structuralParams.liveLoadRoomKpa = 5;
    const sWeak = computeStructuralReport(buildDerivedModel(pWeak));
    expect(sWeak.overallSafe).toBe(false);
    expect(sWeak.columns.some((c) => c.status === "PERIKSA")).toBe(true);
  });

  it("handles 1-storey houses & empty lot clean-reset without crashing or fake scores, and produces valid exports", async () => {
    // 1-level project (EC-01)
    const oneLevel = createDefaultProject();
    oneLevel.levels = [oneLevel.levels[0]!];
    const d1 = buildDerivedModel(oneLevel);
    const s1 = computeStructuralReport(d1);
    const r1 = buildRabSummary(d1, s1);
    const sch1 = buildScheduleSummary(oneLevel, r1, "baseline");
    const l1 = runLightingSimulation(d1);
    const a1 = runAirflowSimulation(d1);
    const f1 = runFloodSimulation(d1);
    expect(s1.concreteVolumes.slabM3).toBe(0);
    expect(r1.grandTotal).toBeGreaterThan(0);

    // CSV formula-injection escaping, columns & markup rows (BL-10)
    const maliciousRab = {
      ...r1,
      rows: r1.rows.map((row, idx) => (idx === 0 ? { ...row, uraian: "=CMD()" } : row)),
    };
    const csv = generateTakeoffCsv(maliciousRab, d1);
    expect(csv).toContain('"\'=CMD()"');
    expect(csv).toContain("Harga Alat");
    expect(csv).toContain("Overhead");

    const xlsxBlob = await buildExcelWorkbookBlob({
      derived: d1,
      struct: s1,
      rab: r1,
      schedule: sch1,
      lighting: l1,
      airflow: a1,
      flood: f1,
      isDraft: false,
    });
    expect(xlsxBlob.size).toBeGreaterThan(1000);

    const pdfBlob = buildPdfDrawingsAndReportBlob({
      derived: d1,
      struct: s1,
      rab: r1,
      schedule: sch1,
      lighting: l1,
      airflow: a1,
      flood: f1,
      isDraft: false,
    });
    expect(pdfBlob.size).toBeGreaterThan(1000);

    // Empty clean lot yields zero cost/scores and clean validation (EC-08)
    const store = useStudioStore.getState();
    store.resetLotClean();
    const emptyProj = useStudioStore.getState().project;
    expect(Object.keys(emptyProj.stageProgress)).toHaveLength(0);
    expect(Object.keys(emptyProj.siteChecklistDone)).toHaveLength(0);
    const dEmpty = buildDerivedModel(emptyProj);
    const sEmpty = computeStructuralReport(dEmpty);
    const rEmpty = buildRabSummary(dEmpty, sEmpty);
    const lEmpty = runLightingSimulation(dEmpty);
    const aEmpty = runAirflowSimulation(dEmpty);
    expect(rEmpty.grandTotal).toBe(0);
    expect(lEmpty.daylightScore).toBe(0);
    expect(lEmpty.sniCompliancePct).toBe(0);
    expect(aEmpty.airflowScore).toBe(0);
    expect(aEmpty.crossVentPct).toBe(0);
    store.resetProject();
  }, 20_000);

  it("bounds structural columns to their own floor level and couples new lights/AC/wall_fan to simulations", () => {
    const p = createDefaultProject();
    const d = buildDerivedModel(p);
    const s = computeStructuralReport(d);

    // LT1-only partition corner (2.25, 4.5) must NOT pierce LT2; LT2-only toilet corner (3.5, 9.5) must NOT pierce LT1
    const lt1Only = s.columns.find((c) => Math.hypot(c.x - 2.25, c.z - 4.5) < 0.15);
    const lt2Only = s.columns.find((c) => Math.hypot(c.x - 3.5, c.z - 9.5) < 0.15);
    const shared = s.columns.find((c) => Math.hypot(c.x - 0.05, c.z - 7.5) < 0.15);
    expect(lt1Only).toBeDefined();
    expect(lt1Only?.minLevel).toBe(0);
    expect(lt1Only?.maxLevel).toBe(0);
    expect(lt2Only).toBeDefined();
    expect(lt2Only?.minLevel).toBe(1);
    expect(lt2Only?.maxLevel).toBe(1);
    expect(shared?.minLevel).toBe(0);
    expect(shared?.maxLevel).toBe(1);

    // Adding a night light in KT2 increases KT2 totalLux without leaking through solid walls into KM2
    p.simulation.hourOfDay = 21;
    p.levels[1]!.lights.forEach((l) => {
      l.on = false;
    });
    const baseLight = runLightingSimulation(buildDerivedModel(p));
    const kt2Base = baseLight.rooms.find((r) => r.roomId === "r2-kt2")!;
    const km2Base = baseLight.rooms.find((r) => r.roomId === "r2-km2")!;

    p.levels[1]!.lights.push({
      id: "l-test-kt2",
      name: "Lampu Uji KT2",
      type: "ceiling",
      position: { x: 3.75, y: 3.08, z: 5.75 },
      lumens: 1500,
      colorTempK: 4000,
      beamAngleDeg: 110,
      dimmer: 1,
      on: true,
    });
    const afterLight = runLightingSimulation(buildDerivedModel(p));
    const kt2After = afterLight.rooms.find((r) => r.roomId === "r2-kt2")!;
    const km2After = afterLight.rooms.find((r) => r.roomId === "r2-km2")!;
    expect(kt2After.totalLux).toBeGreaterThan(kt2Base.totalLux + 50);
    expect(km2After.artificialLux).toBe(km2Base.artificialLux);

    // Adding a wall_fan in Ruang Tamu increases velocity & lowers effectiveTempC in Ruang Tamu
    const baseAir = runAirflowSimulation(buildDerivedModel(p));
    const tamuBase = baseAir.zones.find((z) => z.roomId === "r1-tamu")!;
    p.levels[0]!.hvac.push({
      id: "hv-wall-fan-test",
      name: "Kipas Angin Dinding Uji",
      type: "wall_fan",
      position: { x: 0.15, y: 2.0, z: 5.8 },
      rotationY: Math.PI / 2,
      flowRateM3h: 1550,
      coolingCapacityW: 0,
      powerW: 50,
      setpointC: 27,
      speedLevel: 3,
      on: true,
    });
    const afterAir = runAirflowSimulation(buildDerivedModel(p));
    const tamuAfter = afterAir.zones.find((z) => z.roomId === "r1-tamu")!;
    expect(tamuAfter.avgVelocityMs).toBeGreaterThan(tamuBase.avgVelocityMs);
    expect(tamuAfter.effectiveTempC).toBeLessThan(tamuBase.effectiveTempC);
    expect(afterAir.totalHvacPowerW).toBe(baseAir.totalHvacPowerW + 50);
  });

  it("generates strictly orthogonal canonical MEP routes shared by 3D, 2D Denah, and RAB", () => {
    const p = createDefaultProject();
    const baseDerived = buildDerivedModel(p);

    // Every segment in every LT1 & LT2 route must be axis-aligned (differs on at most 1 coordinate axis)
    for (const routes of baseDerived.mepNetwork.routesByLevel) {
      expect(routes.length).toBeGreaterThan(0);
      for (const route of routes) {
        expect(route.pts.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < route.pts.length; i++) {
          const a = route.pts[i - 1]!;
          const b = route.pts[i]!;
          const changedAxes =
            (Math.abs(a.x - b.x) > 0.005 ? 1 : 0) +
            (Math.abs(a.y - b.y) > 0.005 ? 1 : 0) +
            (Math.abs(a.z - b.z) > 0.005 ? 1 : 0);
          expect(changedAxes).toBeLessThanOrEqual(1);
        }
      }
    }

    // Adding a light and split AC on LT2 dynamically updates canonical routes, 2D/3D symbols, and takeoff length
    p.levels[1]!.lights.push({
      id: "l-mep-sync",
      name: "Lampu Sinkron MEP",
      type: "ceiling",
      position: { x: 1.5, y: 3.1, z: 7.2 },
      lumens: 1200,
      colorTempK: 4000,
      beamAngleDeg: 110,
      dimmer: 1,
      on: true,
    });
    p.levels[1]!.hvac.push({
      id: "hv-ac-sync",
      name: "AC Split Sinkron",
      type: "ac_split",
      position: { x: 4.85, y: 2.4, z: 8.6 },
      rotationY: -Math.PI / 2,
      flowRateM3h: 520,
      coolingCapacityW: 2600,
      powerW: 720,
      setpointC: 24,
      speedLevel: 2,
      on: true,
    });

    const afterDerived = buildDerivedModel(p);
    const lt2Symbols = afterDerived.mepNetwork.symbolsByLevel[1];
    expect(lt2Symbols.some((s) => s.kind === "lampu" && Math.abs(s.x - 1.5) < 0.02 && Math.abs(s.z - 7.2) < 0.02)).toBe(true);
    expect(lt2Symbols.some((s) => s.kind === "ac_split" && Math.abs(s.x - 4.85) < 0.02 && Math.abs(s.z - 8.6) < 0.02)).toBe(true);
    expect(afterDerived.mep.kabelLampuM).toBeGreaterThan(baseDerived.mep.kabelLampuM);
    expect(afterDerived.mep.conduitM).toBeGreaterThan(baseDerived.mep.conduitM);
    expect(afterDerived.mep.kabelAcM).toBeGreaterThan(baseDerived.mep.kabelAcM);
  });
});
