"use client";

import type { ExportBundleInput } from "@/lib/export/exporters";
import {
  exportCanvasJpg,
  exportContractorZipPackage,
  exportExcelWorkbook,
  exportPdfDrawingsAndReport,
  exportTakeoffCsv,
} from "@/lib/export/exporters";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { SectionHeader, StudioCard, StudioSwitch } from "@/components/ui/StudioPrimitives";
import { AlertTriangle, CheckCircle2, Download, FileArchive, FileSpreadsheet, FileText, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

interface Props {
  bundleBase: Omit<ExportBundleInput, "isDraft" | "canvasSnapshotDataUrl">;
  getSnapshotDataUrl: () => string | null;
  getCanvas: () => HTMLCanvasElement | null;
}

export function DeliverWorkspace({ bundleBase, getSnapshotDataUrl, getCanvas }: Props) {
  const project = useStudioStore((s) => s.project);
  const patchStructuralParams = useStudioStore((s) => s.patchStructuralParams);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const openBuildPanel = useStudioStore((s) => s.openBuildPanel);
  const setInspectSubTab = useStudioStore((s) => s.setInspectSubTab);
  const setInspectorTab = useStudioStore((s) => s.setInspectorTab);

  const criticalVal = bundleBase.derived.validation.filter((v) => v.severity === "critical");
  const missingPrices = bundleBase.rab.warnings.filter((w) => w.severity === "critical");
  const revSet = project.structuralParams.drawingRevision.trim().length > 0;
  const reviewerSet = project.structuralParams.reviewerName.trim().length > 0;
  const engChecked = project.structuralParams.engineerReviewed && reviewerSet;

  const passedCount = [criticalVal.length === 0, missingPrices.length === 0, engChecked, revSet].filter(Boolean).length;
  const readyToIssue = passedCount === 4;

  const makeBundle = (forceDraft: boolean): ExportBundleInput => ({
    ...bundleBase,
    isDraft: forceDraft,
    canvasSnapshotDataUrl: getSnapshotDataUrl(),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <StudioCard className="space-y-4">
          <SectionHeader
            title="Paket Delegasi Kontraktor, Mandor & Tukang"
            subtitle="Ekspor dokumen kerja lengkap: Gambar PDF, Workbook RAB/BBS/Jadwal Excel, Takeoff CSV, Render 3D JPG, hingga Arsip ZIP terintegrasi."
            action={
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold",
                  readyToIssue
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/15 text-amber-200",
                )}
              >
                {readyToIssue ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {readyToIssue ? "Siap Terbit Final (4/4)" : `Mode Draft (${passedCount}/4 Syarat)`}
              </span>
            }
          />

          <div className="grid gap-2.5 sm:grid-cols-2">
            <GateItem
              pass={criticalVal.length === 0}
              label={`Validasi Desain Bebas Error Kritis (${criticalVal.length} error)`}
              action={
                !criticalVal.length
                  ? undefined
                  : () => {
                      setInspectSubTab("inspector");
                      setInspectorTab("validasi");
                      openBuildPanel("inspection");
                    }
              }
            />
            <GateItem
              pass={missingPrices.length === 0}
              label={`Harga Satuan RAB Lengkap (${missingPrices.length} kosong)`}
              action={!missingPrices.length ? undefined : () => setWorkspace("rab")}
            />
            <GateItem
              pass={engChecked}
              label={
                reviewerSet
                  ? "Checklist Review & Nama Peninjau Terisi"
                  : "Isi Nama Peninjau & Centang Review Teknis"
              }
              action={engChecked ? undefined : () => openBuildPanel("structure")}
            />
            <GateItem pass={revSet} label={`Revisi Gambar Kerja Terisi (${project.structuralParams.drawingRevision || "-"})`} />
          </div>

          <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[180px_1fr] sm:items-center">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Kode Revisi Gambar</span>
              <input
                type="text"
                value={project.structuralParams.drawingRevision}
                onChange={(e) => patchStructuralParams({ drawingRevision: e.target.value })}
                className="h-9 w-full rounded-lg border border-input bg-[#111418] px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Nama Peninjau / No. SKK (Wajib untuk Final)</span>
              <input
                type="text"
                placeholder="Contoh: Ir. Budi Santoso, ST (SKK Muda)"
                value={project.structuralParams.reviewerName}
                onChange={(e) => patchStructuralParams({ reviewerName: e.target.value })}
                className="h-9 w-full rounded-lg border border-input bg-[#111418] px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </label>
          </div>
          <div className="pt-1">
            <StudioSwitch
              label="Setujui Asumsi & Review Teknis Sebelum Delegasi"
              description="Mengaktifkan cap terbit Final pada kop gambar PDF dan dokumen paket ZIP (syarat: nama peninjau & kode revisi terisi)"
              checked={project.structuralParams.engineerReviewed}
              onChange={(v) => patchStructuralParams({ engineerReviewed: v })}
            />
          </div>
        </StudioCard>

        {/* Export Cards */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <ExportCard
            icon={<FileText className="h-5 w-5 text-rose-400" />}
            title="01. Gambar & Laporan PDF"
            desc="Cover proyek, denah LT1 & LT2 (5×17 m), ringkasan struktur SNI, daftar besi BBS, dan rekap divisi RAB."
            btnLabel={readyToIssue ? "Unduh PDF Final" : "Unduh PDF Draft"}
            onClick={() => exportPdfDrawingsAndReport(makeBundle(!readyToIssue))}
          />
          <ExportCard
            icon={<FileSpreadsheet className="h-5 w-5 text-emerald-400" />}
            title="02. Workbook RAB & Jadwal Excel"
            desc="5 sheet berformula: Ringkasan RAB, BOQ AHSP, Takeoff Bata, Bar Bending Schedule, dan Jadwal Belanja."
            btnLabel="Unduh Excel (.xlsx)"
            onClick={() => exportExcelWorkbook(makeBundle(!readyToIssue))}
          />
          <ExportCard
            icon={<Download className="h-5 w-5 text-sky-400" />}
            title="03. Data Takeoff Mentah (CSV)"
            desc="Volume material terhitung langsung dari model 3D untuk impor ke aplikasi estimator eksternal."
            btnLabel="Unduh CSV"
            onClick={() => exportTakeoffCsv(bundleBase.rab, bundleBase.derived)}
          />
          <ExportCard
            icon={<ImageIcon className="h-5 w-5 text-amber-400" />}
            title="04. Render Viewport 3D (JPG)"
            desc="Tangkapan resolusi tinggi dari sudut kamera viewport 3D aktif saat ini."
            btnLabel="Unduh JPG"
            onClick={() => {
              const ok = exportCanvasJpg(getCanvas(), undefined, getSnapshotDataUrl());
              if (!ok) {
                toast.warning("Snapshot viewport 3D belum tersedia. Buka Build Studio terlebih dahulu.");
              }
            }}
          />
          <ExportCard
            icon={<FileArchive className="h-5 w-5 text-primary" />}
            title="05. Paket Kontraktor Lengkap (ZIP)"
            desc="Gabungan PDF + Excel + CSV + Render JPG + Checklist QC Mandor dalam satu arsip siap kirim."
            btnLabel={readyToIssue ? "Unduh Paket ZIP FINAL" : "Unduh Paket ZIP (DRAFT)"}
            primary
            onClick={() => exportContractorZipPackage(makeBundle(!readyToIssue))}
          />
        </div>
      </div>
    </div>
  );
}

function GateItem({ pass, label, action }: { pass: boolean; label: string; action?: () => void }) {
  if (action) {
    return (
      <button
        type="button"
        onClick={action}
        className="flex min-h-11 w-full items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-left text-xs text-amber-200 transition hover:bg-amber-500/20"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          {label}
        </span>
        <span className="shrink-0 font-semibold underline">Perbaiki</span>
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between rounded-xl border px-3.5 py-2 text-xs",
        pass ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200",
      )}
    >
      <span className="flex items-center gap-2">
        {pass ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />}
        {label}
      </span>
    </div>
  );
}

function ExportCard({
  icon,
  title,
  desc,
  btnLabel,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  btnLabel: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <StudioCard highlight={primary} className="flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          {icon} {title}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "mt-4 flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition active:scale-[0.985]",
          primary
            ? "bg-[#f2efe8] text-[#14171c] hover:brightness-95"
            : "border border-border bg-black/25 text-foreground hover:border-primary/60",
        )}
      >
        <Download className="h-3.5 w-3.5" /> {btnLabel}
      </button>
    </StudioCard>
  );
}
