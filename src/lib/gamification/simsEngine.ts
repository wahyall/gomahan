import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";

export interface GamificationBadge {
  id: string;
  title: string;
  subtitle: string;
  unlocked: boolean;
  progressPct: number;
}

export interface RenovationQuest {
  id: string;
  title: string;
  description: string;
  done: boolean;
  targetWorkspace: string;
}

export interface GamificationEvaluation {
  overallComfortScore: number; // 0..100
  spaceEfficiencyScore: number;
  budgetScore: number;
  badges: GamificationBadge[];
  quests: RenovationQuest[];
  clientBriefChecks: { label: string; pass: boolean }[];
}

export function evaluateGamification(
  derived: DerivedProjectModel,
  rab: RabSummary,
  struct: StructuralReport,
  lighting: LightingSimulationResult,
  airflow: AirflowSimulationResult,
  flood: FloodSimulationResult,
): GamificationEvaluation {
  const bedrooms = derived.floors
    .flatMap((f) => f.rooms)
    .filter((r) => r.room.program === "bedroom");
  const has3Bedrooms = bedrooms.length >= 3;

  const netRatio = derived.totalGrossAreaM2 > 0 ? derived.totalNetFloorM2 / derived.totalGrossAreaM2 : 0.9;
  const spaceEfficiencyScore = Math.min(100, Math.round(netRatio * 100));

  const underBudget = !rab.overBudget;
  const budgetRatio = rab.budgetCapIdr > 0 ? rab.grandTotal / rab.budgetCapIdr : 1;
  const budgetScore = Math.max(0, Math.min(100, Math.round((1.3 - Math.max(0.5, budgetRatio)) * 125)));

  const overallComfortScore = Math.round(
    lighting.daylightScore * 0.28 +
      airflow.airflowScore * 0.32 +
      flood.floodResilienceScore * 0.22 +
      spaceEfficiencyScore * 0.18,
  );

  const sniIssuesCritical = derived.validation.filter((v) => v.severity === "critical").length;

  const badges: GamificationBadge[] = [
    {
      id: "budget-keeper",
      title: "Budget Keeper",
      subtitle: `Total RAB ≤ Rp ${(rab.budgetCapIdr / 1_000_000).toFixed(0)} Juta`,
      unlocked: underBudget,
      progressPct: Math.min(100, Math.round((rab.budgetCapIdr / Math.max(1, rab.grandTotal)) * 100)),
    },
    {
      id: "ventilation-master",
      title: "Ventilation Master",
      subtitle: "Sirkulasi silang & kipas/AC optimal (≥ 80%)",
      unlocked: airflow.airflowScore >= 80,
      progressPct: airflow.airflowScore,
    },
    {
      id: "daylight-designer",
      title: "Daylight Designer",
      subtitle: "Pencahayaan alami & lampu sesuai SNI (≥ 80%)",
      unlocked: lighting.daylightScore >= 80,
      progressPct: lighting.daylightScore,
    },
    {
      id: "flood-ready",
      title: "Flood Ready Surabaya",
      subtitle: "Rumah tangguh banjir (Peil + Backflow + Resapan)",
      unlocked: flood.floodResilienceScore >= 80,
      progressPct: flood.floodResilienceScore,
    },
    {
      id: "sni-compliant",
      title: "SNI Compliant",
      subtitle: "Struktur 2 lantai & aturan batas tetangga aman",
      unlocked: struct.overallSafe && sniIssuesCritical === 0,
      progressPct: struct.overallSafe && sniIssuesCritical === 0 ? 100 : 65,
    },
  ];

  const quests: RenovationQuest[] = [
    {
      id: "q-brick",
      title: "1. Uji Ukuran Bata & Efisiensi Ruang",
      description: "Coba ubah jenis atau ukuran custom bata untuk melihat susunan bata 3D & dampaknya terhadap luas bersih 5×17 m.",
      done: derived.project.systems.brick.preset !== "hebel" || derived.project.systems.brick.outerThicknessMm !== 100 || derived.project.gamification.completedQuests.includes("q-brick"),
      targetWorkspace: "build",
    },
    {
      id: "q-hvac",
      title: "2. Optimalkan Kipas & AC yang Bisa Dipindah",
      description: "Geser atau tambahkan AC/Kipas pada panel Udara di Build Mode hingga skor kenyamanan udara ≥ 80.",
      done: airflow.airflowScore >= 80,
      targetWorkspace: "build",
    },
    {
      id: "q-flood",
      title: "3. Simulasi Banjir 60 cm & Mitigasi",
      description: "Uji ketinggian banjir, aktifkan backflow valve / sekat pintu, dan naikkan stop kontak aman.",
      done:
        derived.project.floodMitigation.backflowValve &&
        derived.project.floodMitigation.infiltrationWells >= 1 &&
        derived.project.floodMitigation.outletHeightM >= 0.9,
      targetWorkspace: "build",
    },
    {
      id: "q-budget",
      title: "4. Jaga Anggaran di Bawah Target Rp 450 Juta",
      description: "Sesuaikan sistem struktur, finishing, dan RAB agar total estimasi masuk target anggaran.",
      done: underBudget,
      targetWorkspace: "rab",
    },
    {
      id: "q-deliver",
      title: "5. Review Struktur & Ekspor Paket Tukang",
      description: "Centang review struktur SNI dan siapkan paket PDF/Excel/ZIP untuk mandor & kontraktor.",
      done: derived.project.structuralParams.engineerReviewed,
      targetWorkspace: "deliver",
    },
  ];

  const clientBriefChecks = [
    { label: "3 Kamar Tidur (1 LT1 + 2 LT2)", pass: has3Bedrooms },
    { label: `Anggaran ≤ Rp ${(rab.budgetCapIdr / 1_000_000).toFixed(0)} Juta`, pass: underBudget },
    { label: "Bukaan Cahaya ≥ 5% SNI", pass: derived.lightingRatioPct >= 5 },
    { label: "Tanpa Jendela di Batas Tetangga", pass: !derived.validation.some((v) => v.category === "boundary" && v.severity === "critical") },
    { label: "Struktur 2 Lantai SNI Aman", pass: struct.overallSafe },
  ];

  return {
    overallComfortScore,
    spaceEfficiencyScore,
    budgetScore,
    badges,
    quests,
    clientBriefChecks,
  };
}
