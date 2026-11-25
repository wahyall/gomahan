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
import { AlertTriangle, CheckCircle2, Download, FileArchive, FileSpreadsheet, FileText, Image as ImageIcon, ShieldCheck } from "lucide-react";

interface Props {
  bundleBase: Omit<ExportBundleInput, "isDraft" | "canvasSnapshotDataUrl">;
  getSnapshotDataUrl: () => string | null;
  getCanvas: () => HTMLCanvasElement | null;
}

export function DeliverWorkspace({ bundleBase, getSnapshotDataUrl, getCanvas }: Props) {
  const project = useStudioStore((s) => s.project);
  const patchStructuralParams = useStudioStore((s) => s.patchStructuralParams);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);

  const criticalVal = bundleBase.derived.validation.filter((v) => v.severity === "critical");
  const missingPrices = bundleBase.rab.warnings.filter((w) => w.severity === "critical");
  const revSet = project.structuralParams.drawingRevision.trim().length > 0;
  const engChecked = project.structuralParams.engineerReviewed;

  const readyToIssue = criticalVal.length === 0 && missingPrices.length === 0 && revSet && engChecked;

  const makeBundle = (forceDraft: boolean): ExportBundleInput => ({
    ...bundleBase,
    isDraft: forceDraft,
    canvasSnapshotDataUrl: getSnapshotDataUrl(),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Paket Delegasi Kontraktor, Mandor & Tukang</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Ekspor dokumen kerja lengkap (Gambar PDF, RAB/BOQ/BBS/Jadwal Excel, Takeoff CSV, Render JPG, dan Paket ZIP).
              </p>
            </div>
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold",
                readyToIssue
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-200",
              )}
            >
              {readyToIssue ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {readyToIssue ? "SIAP TERBIT FINAL" : "MODE DRAFT (Gerbang Review Belum Lengkap)"}
            </span>
          </div>

          {/* Ready-to-Issue Gate Checklist */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <GateItem
              pass={criticalVal.length === 0}
              label={`Validasi Desain Bebas Error Kritis (${criticalVal.length} error)`}
              action={!criticalVal.length ? undefined : () => setWorkspace("build")}
            />
            <GateItem
              pass={missingPrices.length === 0}
              label={`Harga Satuan RAB Lengkap (${missingPrices.length} kosong)`}
              action={!missingPrices.length ? undefined : () => setWorkspace("rab")}
            />
            <GateItem
              pass={engChecked}
              label="Checklist Review Struktur SNI Telah Dicentang"
              action={engChecked ? undefined : () => setWorkspace("structure")}
            />
            <GateItem pass={revSet} label={`Revisi Gambar Kerja Terisi (${project.structuralParams.drawingRevision})`} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Kode Revisi:</span>
              <input
                type="text"
                value={project.structuralParams.drawingRevision}
                onChange={(e) => patchStructuralParams({ drawingRevision: e.target.value })}
                className="h-7 w-28 rounded border border-input bg-secondary px-2 font-mono"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={engChecked}
                onChange={(e) => patchStructuralParams({ engineerReviewed: e.target.checked })}
                className="accent-[#df8949]"
              />
              <ShieldCheck className="h-4 w-4 text-primary" /> Saya menyetujui asumsi & review teknis sebelum delegasi
            </label>
          </div>
        </div>

        {/* Export Cards */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <ExportCard
            icon={<FileText className="h-5 w-5 text-red-400" />}
            title="01. Gambar & Laporan PDF"
            desc="Cover proyek, denah LT1 & LT2 (5×17 m), ringkasan struktur SNI, daftar potongan besi BBS, dan rekap divisi RAB."
            btnLabel={readyToIssue ? "Unduh PDF Final" : "Unduh PDF Draft"}
            onClick={() => exportPdfDrawingsAndReport(makeBundle(!readyToIssue))}
          />
          <ExportCard
            icon={<FileSpreadsheet className="h-5 w-5 text-emerald-400" />}
            title="02. Workbook RAB & Jadwal Excel"
            desc="5 sheet berformula: Ringkasan RAB, BOQ AHSP, Takeoff Bata/Ruang, Bar Bending Schedule (BBS), dan Jadwal Pengadaan."
            btnLabel="Unduh Excel (.xlsx)"
            onClick={() => exportExcelWorkbook(makeBundle(!readyToIssue))}
          />
          <ExportCard
            icon={<Download className="h-5 w-5 text-sky-400" />}
            title="03. Data Takeoff Mentah (CSV)"
            desc="Baris volume material terhitung dari model 3D untuk impor ke software estimator kontraktor."
            btnLabel="Unduh CSV"
            onClick={() => exportTakeoffCsv(bundleBase.rab, bundleBase.derived)}
          />
          <ExportCard
            icon={<ImageIcon className="h-5 w-5 text-amber-400" />}
            title="04. Render Viewport 3D (JPG)"
            desc="Tangkapan resolusi tinggi dari sudut kamera viewport 3D aktif saat ini."
            btnLabel="Unduh JPG"
            onClick={() => exportCanvasJpg(getCanvas())}
          />
          <ExportCard
            icon={<FileArchive className="h-5 w-5 text-primary" />}
            title="05. Paket Kontraktor Lengkap (ZIP)"
            desc="Gabungan PDF + Excel + CSV + Render JPG + Checklist QC Mandor + README Asumsi dalam satu arsip siap kirim."
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
        className="flex min-h-11 w-full items-center justify-between rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200 transition hover:bg-amber-500/20"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          {label}
        </span>
        <span className="text-[10px] font-bold underline">Perbaiki</span>
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between rounded border px-3 py-2 text-xs",
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
    <div className={cn("flex flex-col justify-between rounded-lg border p-4", primary ? "border-primary/50 bg-primary/10" : "border-border bg-card")}>
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          {icon} {title}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "mt-4 flex h-9 items-center justify-center gap-1.5 rounded text-xs font-bold transition",
          primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border bg-secondary text-foreground hover:border-primary",
        )}
      >
        <Download className="h-3.5 w-3.5" /> {btnLabel}
      </button>
    </div>
  );
}
