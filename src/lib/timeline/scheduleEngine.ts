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

const STAGE_DEFS: {
  id: string;
  order: number;
  name: string;
  dependsOn: string[];
  crew: number;
  days: number;
  leadDays: number;
  qc: string[];
}[] = [
  {
    id: "st-01",
    order: 1,
    name: "Persiapan & Bouwplank",
    dependsOn: [],
    crew: 3,
    days: 4,
    leadDays: 3,
    qc: [
      "Diagonal tapak 5×17 m = 17,72 m tepat",
      "As batas tetangga kiri/kanan diverifikasi",
      "Referensi peil jalan & banjir ditandai",
    ],
  },
  {
    id: "st-02",
    order: 2,
    name: "Galian, Urugan Peil & Pondasi",
    dependsOn: ["st-01"],
    crew: 5,
    days: 14,
    leadDays: 5,
    qc: [
      "Kedalaman tanah keras tercapai",
      "Lantai kerja 5 cm rata",
      "Tulangan footplate/strauss bebas karat & bersepatu beton 40 mm",
    ],
  },
  {
    id: "st-03",
    order: 3,
    name: "Sloof, Kolom Utama & Balok Induk",
    dependsOn: ["st-02"],
    crew: 6,
    days: 16,
    leadDays: 7,
    qc: [
      "Sengkang seismic 135° rapat di zona tumpuan",
      "Bekisting tegak & kencang (cek lot/waterpass)",
      "Slump beton sesuai mutu K-250",
    ],
  },
  {
    id: "st-04",
    order: 4,
    name: "Pelat Lantai 2 & Tangga",
    dependsOn: ["st-03"],
    crew: 6,
    days: 12,
    leadDays: 7,
    qc: [
      "Perancah/steger kuat menahan beban cor",
      "Selimut beton pelat 20 mm terjaga",
      "Curing beton minimal 7 hari sebelum bongkar total",
    ],
  },
  {
    id: "st-05",
    order: 5,
    name: "Pasangan Bata & Kolom Praktis",
    dependsOn: ["st-04"],
    crew: 5,
    days: 18,
    leadDays: 5,
    qc: [
      "Kelurusan vertikal dicek tiap 1 m",
      "Ikatan berselang min. 10 cm + angkur besi ke kolom tiap 5 lapis",
      "Tebal nat sesuai spek (hebel 3 mm / merah 12 mm)",
    ],
  },
  {
    id: "st-06",
    order: 6,
    name: "Pemasangan Kusen Pintu & Jendela",
    dependsOn: ["st-05"],
    crew: 3,
    days: 6,
    leadDays: 14,
    qc: [
      "Kusen siku 90° & waterpass",
      "Ambang bawah jendela miring keluar 5° cegah tampias",
    ],
  },
  {
    id: "st-07",
    order: 7,
    name: "Ring Balk, Rangka Atap Shed & Talang",
    dependsOn: ["st-05"],
    crew: 4,
    days: 10,
    leadDays: 10,
    qc: [
      "Kemiringan atap 10° tepat ke depan",
      "Talang jurai dalam parapet tetangga diuji genang (tes bocor)",
      "Sekrup atap & insulasi terpasang rapi",
    ],
  },
  {
    id: "st-08",
    order: 8,
    name: "Instalasi Rough-in MEP & Backflow",
    dependsOn: ["st-05", "st-07"],
    crew: 3,
    days: 8,
    leadDays: 5,
    qc: [
      "Tes tekan pipa air bersih 4 bar min. 2 jam",
      "Kemiringan pipa limbah 1–2% ke bio septic + backflow valve terpasang",
      "Conduit listrik & grounding arde sesuai PUIL",
    ],
  },
  {
    id: "st-09",
    order: 9,
    name: "Plesteran, Acian & Plafon",
    dependsOn: ["st-07", "st-08"],
    crew: 5,
    days: 14,
    leadDays: 4,
    qc: [
      "Kerataan plester pakai jidar 2 m toleransi < 3 mm",
      "Plafon area KM pakai gypsum tahan lembap",
    ],
  },
  {
    id: "st-10",
    order: 10,
    name: "Lantai Keramik, Carport & Railing",
    dependsOn: ["st-09"],
    crew: 4,
    days: 12,
    leadDays: 7,
    qc: [
      "Keramik tidak kopong saat diketuk",
      "Lantai KM miring 1,5% ke floor drain",
      "Railing balkon & void kokoh (tinggi min. 95 cm)",
    ],
  },
  {
    id: "st-11",
    order: 11,
    name: "Sanitair, Saklar/Lampu, AC & Mitigasi Banjir",
    dependsOn: ["st-10"],
    crew: 3,
    days: 6,
    leadDays: 7,
    qc: [
      "Stop kontak LT1 di elevasi aman banjir",
      "Uji vakum & arus AC/kipas",
      "Tes sekat banjir pintu & pompa kuras",
    ],
  },
  {
    id: "st-12",
    order: 12,
    name: "Cat, Waterproofing & Serah Terima",
    dependsOn: ["st-11"],
    crew: 4,
    days: 8,
    leadDays: 4,
    qc: [
      "Tes genang waterproofing KM & balkon 24 jam",
      "Seluruh checklist SNI & RAB disetujui bersama kontraktor",
    ],
  },
];

export function buildScheduleSummary(
  project: Project,
  rab: RabSummary,
  mode: "baseline" | "accelerated" | "delayed" = "baseline",
): ScheduleSummary {
  const factorTime =
    mode === "accelerated" ? 0.78 : mode === "delayed" ? 1.25 : 1.0;
  const endByStage = new Map<string, number>();
  const stages: ScheduleStage[] = [];

  for (const def of STAGE_DEFS) {
    const prog = project.stageProgress[def.id];
    const stageRows = rab.rows.filter((r) => r.stageId === def.id);
    const directStageCost = stageRows.reduce((s, r) => s + r.subtotal, 0);
    // Allocate indirect markups proportionally
    const ratio =
      rab.directSubtotal > 0 ? directStageCost / rab.directSubtotal : 0;
    const budgetIdr = Math.round(rab.grandTotal * ratio);

    const depEnd = def.dependsOn.reduce(
      (m, dep) => Math.max(m, endByStage.get(dep) ?? 0),
      0,
    );
    const startOffset = prog?.startOffsetDays ?? 0;
    const startDay = Math.max(0, depEnd + startOffset);
    const rawDuration = prog?.durationOverrideDays ?? def.days;
    const durationDays = Math.max(2, Math.ceil(rawDuration * factorTime));
    const endDay = startDay + durationDays;
    endByStage.set(def.id, endDay);

    const crew =
      prog?.crewOverride ?? (mode === "accelerated" ? def.crew + 2 : def.crew);
    const procurementItems = stageRows
      .slice(0, 5)
      .map((r) => `${r.uraian} (${Math.ceil(r.qty)} ${r.unit})`);

    stages.push({
      id: def.id,
      order: def.order,
      name: def.name,
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
      qcChecklist: def.qc,
    });
  }

  const totalDurationDays = stages.reduce((m, s) => Math.max(m, s.endDay), 0);
  const totalWeeks = Math.max(1, Math.ceil(totalDurationDays / 6)); // 6 workdays/week

  // Build weekly cash flow S-curve
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
      const overlap = Math.max(
        0,
        Math.min(wEnd, st.endDay) - Math.max(wStart, st.startDay),
      );
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

  const nextStage =
    stages.find((s) => s.progressPct < 100) ?? stages[0] ?? null;

  // Earned Value (EVM)
  const pv = stages.reduce(
    (s, st) =>
      s + st.budgetIdr * (st.endDay <= totalDurationDays * 0.35 ? 1 : 0),
    0,
  );
  const ev = stages.reduce(
    (s, st) => s + st.budgetIdr * (st.progressPct / 100),
    0,
  );
  const ac = stages.reduce((s, st) => s + st.actualCostIdr, 0);
  const cpi = ac > 0 ? ev / ac : 1.0;
  const spi = pv > 0 ? ev / pv : 1.0;
  const eac = cpi > 0 ? rab.grandTotal / cpi : rab.grandTotal;
  const vac = rab.grandTotal - eac;

  const baseDays = STAGE_DEFS.reduce((s, d) => s + d.days, 0) * 0.72;
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
    earnedValue: { pv, ev, ac, cpi, spi, eac, vac },
    scenarios: {
      baselineDays: Math.round(baseDays),
      acceleratedDays: Math.round(baseDays * 0.78),
      acceleratedCostIdr: Math.round(rab.grandTotal * 1.045),
      delayedDays: Math.round(baseDays * 1.25),
      delayedCostIdr: Math.round(rab.grandTotal * 1.03),
    },
  };
}
