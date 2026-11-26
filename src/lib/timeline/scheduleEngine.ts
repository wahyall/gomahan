import { CONSTRUCTION_STAGES } from "@/lib/house/knowledge";
import type { Project } from "@/lib/model/types";
import type { RabSummary } from "@/lib/quantities/rabEngine";

export interface ScheduleStage {
  id: string;
  order: number;
  name: string;
  dependsOn: string[];
  baseCrew: number;
  baseDurationDays: number;
  durationDays: number;
  startDay: number;
  endDay: number;
  budgetIdr: number;
  progressPct: number;
  actualCostIdr: number;
  leadTimeDays: number;
  procurementItems: string[];
  qcChecklist: string[];
}

export interface WeeklyCashFlow {
  week: number;
  label: string;
  weeklyCostIdr: number;
  cumulativePlannedIdr: number;
  cumulativeActualIdr: number;
  peakCrew: number;
}

export interface ProcurementOrder {
  stageId: string;
  stageName: string;
  orderByDay: number;
  neededByDay: number;
  materials: string[];
  estimatedCostIdr: number;
}

export interface ScheduleSummary {
  stages: ScheduleStage[];
  totalDurationDays: number;
  totalWeeks: number;
  weeklyCashFlow: WeeklyCashFlow[];
  procurementOrders: ProcurementOrder[];
  nextStageFunding: {
    stageName: string;
    amountIdr: number;
    startDay: number;
  } | null;
  earnedValue: {
    pv: number;
    ev: number;
    ac: number;
    cpi: number;
    spi: number;
    eac: number;
    vac: number;
  };
  scenarios: {
    baselineDays: number;
    acceleratedDays: number;
    acceleratedCostIdr: number;
    delayedDays: number;
    delayedCostIdr: number;
  };
}

function computeCpmDurationDays(project: Project, factorTime: number): number {
  const endByStage = new Map<string, number>();
  let maxEnd = 0;
  for (const def of CONSTRUCTION_STAGES) {
    const prog = project.stageProgress[def.id];
    const depEnd = def.dependsOn.reduce((m, dep) => Math.max(m, endByStage.get(dep) ?? 0), 0);
    const startDay = Math.max(0, depEnd + (prog?.startOffsetDays ?? 0));
    const dur = Math.max(2, Math.ceil((prog?.durationOverrideDays ?? def.days) * factorTime));
    const endDay = startDay + dur;
    endByStage.set(def.id, endDay);
    if (endDay > maxEnd) maxEnd = endDay;
  }
  return maxEnd;
}

export function buildScheduleSummary(
  project: Project,
  rab: RabSummary,
  mode: "baseline" | "accelerated" | "delayed" = "baseline",
  currentWorkDay?: number,
): ScheduleSummary {
  const factorTime = mode === "accelerated" ? 0.78 : mode === "delayed" ? 1.25 : 1.0;
  const endByStage = new Map<string, number>();
  const stages: ScheduleStage[] = [];

  for (const def of CONSTRUCTION_STAGES) {
    const prog = project.stageProgress[def.id];
    const stageRows = rab.rows.filter((r) => r.stageId === def.id);
    const directStageCost = stageRows.reduce((s, r) => s + r.subtotal, 0);
    const ratio = rab.directSubtotal > 0 ? directStageCost / rab.directSubtotal : 0;
    const budgetIdr = Math.round(rab.grandTotal * ratio);

    const depEnd = def.dependsOn.reduce((m, dep) => Math.max(m, endByStage.get(dep) ?? 0), 0);
    const startOffset = prog?.startOffsetDays ?? 0;
    const startDay = Math.max(0, depEnd + startOffset);
    const rawDuration = prog?.durationOverrideDays ?? def.days;
    const durationDays = Math.max(2, Math.ceil(rawDuration * factorTime));
    const endDay = startDay + durationDays;
    endByStage.set(def.id, endDay);

    const crew = prog?.crewOverride ?? (mode === "accelerated" ? def.crew + 2 : def.crew);
    const procurementItems = stageRows.map((r) => `${r.uraian} (${Math.ceil(r.qty)} ${r.unit})`);

    stages.push({
      id: def.id,
      order: def.order,
      name: def.nama,
      dependsOn: def.dependsOn,
      baseCrew: crew,
      baseDurationDays: def.days,
      durationDays,
      startDay,
      endDay,
      budgetIdr,
      progressPct: prog?.progressPct ?? 0,
      actualCostIdr: prog?.actualCost ?? 0,
      leadTimeDays: def.leadDays,
      procurementItems,
      qcChecklist: def.cekMutu,
    });
  }

  // Normalize final stage rounding delta so sum(stages.budgetIdr) === rab.grandTotal
  if (stages.length > 0 && rab.grandTotal > 0) {
    const budgetSum = stages.reduce((s, st) => s + st.budgetIdr, 0);
    const largest = stages.reduce((best, st) => (st.budgetIdr > best.budgetIdr ? st : best), stages[0]!);
    largest.budgetIdr += rab.grandTotal - budgetSum;
  }

  const totalDurationDays = stages.reduce((m, s) => Math.max(m, s.endDay), 0);
  const totalWeeks = Math.max(1, Math.ceil(totalDurationDays / 6));

  const weeklyCashFlow: WeeklyCashFlow[] = [];
  let cumPlanned = 0;
  let cumActual = 0;
  for (let w = 1; w <= totalWeeks; w++) {
    const wStart = (w - 1) * 6;
    const wEnd = w * 6;
    let weeklyCost = 0;
    let weeklyActual = 0;
    let peakCrew = 0;
    for (const st of stages) {
      const overlap = Math.max(0, Math.min(wEnd, st.endDay) - Math.max(wStart, st.startDay));
      if (overlap > 0) {
        const frac = overlap / st.durationDays;
        weeklyCost += st.budgetIdr * frac;
        weeklyActual += st.actualCostIdr * frac;
        peakCrew += st.baseCrew;
      }
    }
    cumPlanned += Math.round(weeklyCost);
    cumActual += Math.round(weeklyActual);
    weeklyCashFlow.push({
      week: w,
      label: `M${w}`,
      weeklyCostIdr: Math.round(weeklyCost),
      cumulativePlannedIdr: cumPlanned,
      cumulativeActualIdr: cumActual,
      peakCrew,
    });
  }

  const procurementOrders: ProcurementOrder[] = stages
    .filter((s) => s.procurementItems.length > 0)
    .map((s) => ({
      stageId: s.id,
      stageName: s.name,
      orderByDay: Math.max(0, s.startDay - s.leadTimeDays),
      neededByDay: s.startDay,
      materials: s.procurementItems,
      estimatedCostIdr: s.budgetIdr,
    }));

  const nextStage = stages.find((s) => s.progressPct < 100) ?? null;

  const evalDay = currentWorkDay ?? Math.round(totalDurationDays * 0.35);
  const pv = stages.reduce((s, st) => {
    if (evalDay <= st.startDay) return s;
    const frac = Math.min(1, (evalDay - st.startDay) / Math.max(1, st.durationDays));
    return s + st.budgetIdr * frac;
  }, 0);
  const ev = stages.reduce((s, st) => s + st.budgetIdr * (st.progressPct / 100), 0);
  const ac = stages.reduce((s, st) => s + st.actualCostIdr, 0);
  const cpi = ac > 0 ? ev / ac : 1.0;
  const spi = pv > 0 ? ev / pv : 1.0;
  const eac = ev > 0 ? rab.grandTotal / cpi : ac > 0 ? rab.grandTotal + ac : rab.grandTotal;
  const vac = rab.grandTotal - eac;

  const baselineDays = computeCpmDurationDays(project, 1.0);
  const acceleratedDays = computeCpmDurationDays(project, 0.78);
  const delayedDays = computeCpmDurationDays(project, 1.25);

  return {
    stages,
    totalDurationDays,
    totalWeeks,
    weeklyCashFlow,
    procurementOrders,
    nextStageFunding: nextStage
      ? {
          stageName: nextStage.name,
          amountIdr: nextStage.budgetIdr,
          startDay: nextStage.startDay,
        }
      : null,
    earnedValue: { pv: Math.round(pv), ev: Math.round(ev), ac: Math.round(ac), cpi, spi, eac: Math.round(eac), vac: Math.round(vac) },
    scenarios: {
      baselineDays,
      acceleratedDays,
      acceleratedCostIdr: Math.round(rab.grandTotal * 1.045),
      delayedDays,
      delayedCostIdr: Math.round(rab.grandTotal * 1.03),
    },
  };
}
