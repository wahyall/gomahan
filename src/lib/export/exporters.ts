import { jsPDF } from "jspdf";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { StructuralReport } from "@/lib/structure/sniEngine";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import type { ScheduleSummary } from "@/lib/timeline/scheduleEngine";
import type { LightingSimulationResult } from "@/lib/simulation/lightingEngine";
import type { AirflowSimulationResult } from "@/lib/simulation/airflowEngine";
import type { FloodSimulationResult } from "@/lib/simulation/floodEngine";
import { fmtNum, fmtRp } from "@/lib/utils/format";

export interface ExportBundleInput {
  derived: DerivedProjectModel;
  struct: StructuralReport;
  rab: RabSummary;
  schedule: ScheduleSummary;
  lighting: LightingSimulationResult;
  airflow: AirflowSimulationResult;
  flood: FloodSimulationResult;
  isDraft: boolean;
  canvasSnapshotDataUrl?: string | null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function generateTakeoffCsv(rab: RabSummary, derived: DerivedProjectModel): string {
  const lines = [
    ["No", "Divisi", "Kode AHSP", "Uraian Pekerjaan / Material", "Spesifikasi", "Qty", "Satuan", "Harga Material", "Harga Upah", "Harga Satuan Total", "Subtotal (IDR)", "Sumber"].join(","),
  ];
  let idx = 1;
  for (const r of rab.rows) {
    const div = rab.divisions.find((d) => d.id === r.divisionId);
    const esc = (s: string) => `"${String(s).replaceAll('"', '""')}"`;
    lines.push(
      [
        idx++,
        esc(div ? `${div.kode}. ${div.nama}` : r.divisionId),
        esc(r.ahspCode),
        esc(r.uraian),
        esc(r.spek),
        r.qty.toFixed(2),
        esc(r.unit),
        r.materialUnit,
        r.laborUnit,
        r.unitPrice,
        r.subtotal,
        esc(r.exact ? "Model 3D Analitik" : "Estimasi"),
      ].join(","),
    );
  }
  lines.push("");
  lines.push(`"Luas Lahan (m2)",${derived.totalLotAreaM2.toFixed(2)}`);
  lines.push(`"Luas Bersih Lantai (m2)",${derived.totalNetFloorM2.toFixed(2)}`);
  lines.push(`"Total Bata Terbeli (bh)",${derived.masonry.totalBuyBricks}`);
  lines.push(`"Total RAB Grand Total (IDR)",${rab.grandTotal}`);
  return lines.join("\n");
}

export function exportTakeoffCsv(rab: RabSummary, derived: DerivedProjectModel) {
  const csv = generateTakeoffCsv(rab, derived);
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "03_Takeoff_Rumah_5x17.csv");
}

export async function buildExcelWorkbookBlob(input: ExportBundleInput): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const { derived, struct, rab, schedule } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rumah Studio 3D";
  wb.created = new Date();

  // 1. Ringkasan RAB
  const wsSum = wb.addWorksheet("Ringkasan RAB");
  wsSum.addRow(["RINGKASAN RENCANA ANGGARAN BIAYA (RAB) — RUMAH 5×17 M (2 LANTAI)"]);
  wsSum.addRow(["Proyek", derived.project.name]);
  wsSum.addRow(["Lokasi / Acuan Harga", derived.project.priceBook.region]);
  wsSum.addRow(["Sistem Struktur", struct.systemLabel]);
  wsSum.addRow(["Spesifikasi Bata", `${derived.project.systems.brick.name} (${derived.project.systems.brick.lengthMm}×${derived.project.systems.brick.heightMm}×${derived.project.systems.brick.depthMm} mm)`]);
  wsSum.addRow(["Status Dokumen", input.isDraft ? "DRAFT (Belum Final Review)" : `FINAL (${derived.project.structuralParams.drawingRevision})`]);
  wsSum.addRow([]);
  wsSum.addRow(["Kode", "Divisi Pekerjaan", "Subtotal (IDR)", "Porsi (%)"]);
  for (const d of rab.divisions) {
    wsSum.addRow([d.kode, d.nama, d.subtotal, rab.directSubtotal > 0 ? Number(((d.subtotal / rab.directSubtotal) * 100).toFixed(1)) : 0]);
  }
  wsSum.addRow([]);
  wsSum.addRow(["", "Subtotal Langsung (Material + Upah + Alat)", rab.directSubtotal]);
  wsSum.addRow(["", `Overhead (${derived.project.rabSettings.overheadPct}%)`, rab.overheadAmount]);
  wsSum.addRow(["", `Profit Kontraktor (${derived.project.rabSettings.profitPct}%)`, rab.profitAmount]);
  wsSum.addRow(["", `PPN (${derived.project.rabSettings.vatPct}%)`, rab.vatAmount]);
  wsSum.addRow(["", `Cadangan / Contingency (${derived.project.rabSettings.contingencyPct}%)`, rab.contingencyAmount]);
  wsSum.addRow(["", "GRAND TOTAL RAB", rab.grandTotal]);
  wsSum.addRow(["", "Biaya per m2 Lantai Bersih", Math.round(rab.perM2NetFloor)]);
  wsSum.columns = [{ width: 10 }, { width: 48 }, { width: 22 }, { width: 14 }];

  // 2. Detail BOQ
  const wsBoq = wb.addWorksheet("BOQ Detail AHSP");
  wsBoq.addRow(["Divisi", "Kode AHSP", "Uraian Pekerjaan", "Spesifikasi", "Qty", "Satuan", "Material", "Upah", "Alat", "Harga Satuan", "Jumlah (IDR)", "Rumus / Sumber"]);
  for (const r of rab.rows) {
    const idx = wsBoq.rowCount + 1;
    wsBoq.addRow([
      r.divisionId.toUpperCase(),
      r.ahspCode,
      r.uraian,
      r.spek,
      r.qty,
      r.unit,
      r.materialUnit,
      r.laborUnit,
      r.equipUnit,
      { formula: `G${idx}+H${idx}+I${idx}`, result: r.unitPrice },
      { formula: `ROUND(E${idx}*J${idx},0)`, result: r.subtotal },
      r.formulaNote,
    ]);
  }
  wsBoq.columns = [
    { width: 8 },
    { width: 16 },
    { width: 40 },
    { width: 38 },
    { width: 10 },
    { width: 8 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
    { width: 18 },
    { width: 34 },
  ];

  // 3. Rekap Bata & Ruangan
  const wsMat = wb.addWorksheet("Takeoff Bata & Luas");
  wsMat.addRow(["ANALITIK BATA & LUAS BERSIH RUANGAN (5×17 M)"]);
  wsMat.addRow(["Total Bata Terpasang di Model 3D", derived.masonry.totalPiecesPlaced, "buah"]);
  wsMat.addRow(["Total Bata Potongan", derived.masonry.cutPiecesCount, "buah"]);
  wsMat.addRow(["Total Bata Dibeli (+Waste)", derived.masonry.totalBuyBricks, "buah"]);
  wsMat.addRow(["Volume Adukan / Mortar", Number(derived.masonry.mortarWithWasteM3.toFixed(3)), "m3"]);
  wsMat.addRow(["Perekat Hebel (40kg)", derived.masonry.thinbedZak40kg, "zak"]);
  wsMat.addRow(["Semen PC (50kg)", derived.masonry.cementZak50kg, "zak"]);
  wsMat.addRow(["Pasir Pasang", Number(derived.masonry.sandM3.toFixed(2)), "m3"]);
  wsMat.addRow(["Total Reduksi Luas oleh Tebal Dinding", Number(derived.totalWallDeductionM2.toFixed(2)), "m2"]);
  wsMat.addRow([]);
  wsMat.addRow(["Lantai", "Ruangan", "Program", "Luas Kotor (m2)", "Potongan Dinding (m2)", "Luas Bersih (m2)", "Keramik (kpg)"]);
  for (const fl of derived.floors) {
    for (const r of fl.rooms) {
      wsMat.addRow([fl.levelName, r.room.name, r.room.program, Number(r.grossAreaM2.toFixed(2)), Number(r.wallDeductionM2.toFixed(2)), Number(r.netAreaM2.toFixed(2)), r.tileCount]);
    }
  }
  wsMat.columns = [{ width: 22 }, { width: 32 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 18 }, { width: 14 }];

  // 4. Bar Bending Schedule (BBS)
  const wsBbs = wb.addWorksheet("Daftar Besi (BBS)");
  wsBbs.addRow(["Bar Mark", "Elemen Struktur", "Diameter (mm)", "Bentuk", "Panjang Potong (m)", "Jumlah Batang", "Total Panjang (m)", "Berat/m (kg)", "Total Berat (kg)"]);
  for (const b of struct.bbs) {
    wsBbs.addRow([
      b.barMark,
      b.element,
      b.diameterMm,
      b.shape,
      Number(b.cutLengthM.toFixed(2)),
      b.count,
      Number(b.totalLengthM.toFixed(1)),
      Number(b.unitWeightKgM.toFixed(3)),
      Number(b.totalWeightKg.toFixed(1)),
    ]);
  }
  wsBbs.addRow(["", "TOTAL BESI TULANGAN", "", "", "", "", "", "", Number(struct.totalRebarKg.toFixed(1))]);
  wsBbs.columns = [{ width: 10 }, { width: 36 }, { width: 14 }, { width: 24 }, { width: 18 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 16 }];

  // 5. Jadwal, Cash Flow & Belanja Material
  const wsSch = wb.addWorksheet("Jadwal & Pengadaan");
  wsSch.addRow(["Urutan", "Tahap Pekerjaan", "Mulai Hari", "Durasi (Hari)", "Selesai Hari", "Tukang", "Order Material (Hari ke-)", "Anggaran Tahap (IDR)", "Item Belanja Utama"]);
  for (const st of schedule.stages) {
    wsSch.addRow([
      st.order,
      st.name,
      st.startDay,
      st.durationDays,
      st.endDay,
      st.baseCrew,
      Math.max(0, st.startDay - st.leadTimeDays),
      st.budgetIdr,
      st.procurementItems.join("; "),
    ]);
  }
  wsSch.addRow([]);
  wsSch.addRow(["Minggu", "Biaya Mingguan (IDR)", "Kumulatif Rencana (IDR)", "Kebutuhan Tenaga Puncak"]);
  for (const w of schedule.weeklyCashFlow) {
    wsSch.addRow([w.label, w.weeklyCostIdr, w.cumulativePlannedIdr, w.peakCrew]);
  }
  wsSch.columns = [{ width: 10 }, { width: 34 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 22 }, { width: 22 }, { width: 48 }];

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function exportExcelWorkbook(input: ExportBundleInput) {
  const blob = await buildExcelWorkbookBlob(input);
  downloadBlob(blob, "02_RAB_BOQ_Jadwal_5x17.xlsx");
}

function addDraftWatermarkIfNeeded(doc: jsPDF, isDraft: boolean) {
  if (!isDraft) return;
  doc.saveGraphicsState();
  doc.setTextColor(210, 90, 70);
  doc.setFontSize(46);
  doc.text("DRAFT — BELUM FINAL", 148, 120, { align: "center", angle: 28 });
  doc.restoreGraphicsState();
}

export function buildPdfDrawingsAndReportBlob(input: ExportBundleInput): Blob {
  const { derived, struct, rab, schedule, lighting, airflow, flood, isDraft } = input;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Page 1: Cover & Project Summary
  doc.setFillColor(24, 27, 31);
  doc.rect(0, 0, 297, 210, "F");
  doc.setTextColor(242, 236, 225);
  doc.setFontSize(22);
  doc.text("PAKET DOKUMEN ARSITEKTUR & KONSTRUKSI", 20, 32);
  doc.setFontSize(14);
  doc.setTextColor(219, 137, 74);
  doc.text(derived.project.name, 20, 44);

  doc.setTextColor(220, 220, 215);
  doc.setFontSize(10);
  const summaryLines = [
    `Ukuran Lahan: ${derived.project.site.width} x ${derived.project.site.depth} m (85,0 m2) — 2 Lantai, 3 Kamar Tidur`,
    `Batas Tetangga: Kiri ${derived.project.site.partyWallLeft ? "Menempel" : "Terbuka"} | Kanan ${derived.project.site.partyWallRight ? "Menempel" : "Terbuka"}`,
    `Peil Lantai Utama: +${Math.round(derived.project.site.peil.floor1PeilM * 100)} cm di atas muka jalan`,
    `Sistem Struktur: ${struct.systemLabel} (${struct.overallSafe ? "Memenuhi Cek Awal SNI" : "Perlu Penyesuaian"})`,
    `Bata Dinding: ${derived.project.systems.brick.name} (${derived.project.systems.brick.lengthMm}x${derived.project.systems.brick.heightMm}x${derived.project.systems.brick.depthMm} mm, nat ${derived.project.systems.brick.mortarMm} mm)`,
    `Kebutuhan Bata: ${fmtNum(derived.masonry.totalBuyBricks)} buah | Luas Bersih Lantai: ${fmtNum(derived.totalNetFloorM2, 2)} m2`,
    `Estimasi Total RAB: ${fmtRp(rab.grandTotal)} (${fmtRp(rab.perM2NetFloor)} / m2 bersih)`,
    `Durasi Proyek: ${schedule.totalDurationDays} hari kerja (${schedule.totalWeeks} minggu)`,
    `Simulasi Indikatif: Pencahayaan ${lighting.daylightScore}/100 | Udara ${airflow.airflowScore}/100 | Ketahanan Banjir ${flood.floodResilienceScore}/100`,
    `Revisi: ${derived.project.structuralParams.drawingRevision} | Reviewer: ${derived.project.structuralParams.reviewerName || "Belum diisi"}`,
  ];
  summaryLines.forEach((line, i) => doc.text(line, 20, 62 + i * 8));

  if (input.canvasSnapshotDataUrl) {
    try {
      doc.addImage(input.canvasSnapshotDataUrl, "JPEG", 178, 55, 102, 72);
    } catch {
      // skip if canvas snapshot unavailable
    }
  }

  doc.setFontSize(8.5);
  doc.setTextColor(175, 175, 170);
  doc.text(
    "Catatan: Hasil analisa struktur & simulasi merupakan alat bantu pra-desain. Wajib diverifikasi insinyur sipil & uji tanah lapangan sebelum pelaksanaan.",
    20,
    192,
  );
  addDraftWatermarkIfNeeded(doc, isDraft);

  // Page 2: Schematic Floor Plans LT1 & LT2
  doc.addPage("a4", "landscape");
  doc.setFillColor(248, 247, 242);
  doc.rect(0, 0, 297, 210, "F");
  doc.setTextColor(35, 34, 30);
  doc.setFontSize(13);
  doc.text("LEMBAR A-01: DENAH ARSITEKTUR LANTAI 1 & LANTAI 2 (5 x 17 M)", 15, 18);
  doc.setFontSize(9);
  doc.text(`Skala Proporsional | Satuan: Meter | Peil LT1: +${derived.project.site.peil.floor1PeilM.toFixed(2)} m`, 15, 24);

  const drawLevelPlan = (lvIdx: number, originX: number, originY: number, scale: number) => {
    const lv = derived.project.levels[lvIdx]!;
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(lv.name.toUpperCase(), originX, originY - 5);
    // Lot box (17m horizontal x 5m vertical for compact landscape fit)
    doc.setDrawColor(160, 155, 145);
    doc.setLineWidth(0.3);
    doc.rect(originX, originY, 17 * scale, 5 * scale);

    for (const rm of derived.floors[lvIdx]?.rooms ?? []) {
      const b = rm.bounds;
      doc.setFillColor(rm.room.program === "garden" ? 225 : rm.room.program === "void" ? 245 : 239, rm.room.program === "garden" ? 238 : 237, 232);
      doc.rect(originX + b.minZ * scale, originY + b.minX * scale, b.depth * scale, b.width * scale, "FD");
      doc.setFontSize(6.5);
      doc.setTextColor(50, 50, 48);
      doc.text(rm.room.name.slice(0, 18), originX + rm.centroid.z * scale, originY + rm.centroid.x * scale, { align: "center" });
      doc.text(`${fmtNum(rm.netAreaM2, 1)} m2`, originX + rm.centroid.z * scale, originY + rm.centroid.x * scale + 3.2, { align: "center" });
    }

    doc.setDrawColor(30, 30, 30);
    doc.setLineWidth(0.7);
    for (const w of lv.walls) {
      doc.line(originX + w.start.z * scale, originY + w.start.x * scale, originX + w.end.z * scale, originY + w.end.x * scale);
    }
  };

  drawLevelPlan(0, 18, 40, 15);
  drawLevelPlan(1, 18, 128, 15);
  addDraftWatermarkIfNeeded(doc, isDraft);

  // Page 3: Structural Summary & Bar Bending Schedule
  doc.addPage("a4", "landscape");
  doc.setFillColor(248, 247, 242);
  doc.rect(0, 0, 297, 210, "F");
  doc.setTextColor(35, 34, 30);
  doc.setFontSize(13);
  doc.text("LEMBAR S-01: RINGKASAN STRUKTUR SNI & DAFTAR POTONGAN BESI (BBS)", 15, 18);
  doc.setFontSize(9);
  doc.text(`Sistem: ${struct.systemLabel} | Berat Gempa W: ${fmtNum(struct.totalWeightKn, 0)} kN | Gaya Geser Dasar V: ${fmtNum(struct.seismicBaseShearKn, 1)} kN`, 15, 25);
  doc.text(`Total Beton: ${fmtNum(struct.concreteVolumes.totalConcreteM3, 2)} m3 | Total Besi: ${fmtNum(struct.totalRebarKg, 0)} kg | Bekisting: ${fmtNum(struct.totalFormworkM2, 1)} m2`, 15, 31);

  let yRow = 44;
  doc.setFontSize(8.5);
  doc.text("Mark   Elemen                               Dia    Bentuk                Potong(m)   Jml   Total(m)   Berat(kg)", 15, yRow);
  doc.line(15, yRow + 2, 280, yRow + 2);
  yRow += 7;
  for (const b of struct.bbs) {
    doc.text(
      `${b.barMark.padEnd(7)} ${b.element.slice(0, 36).padEnd(37)} D${String(b.diameterMm).padEnd(4)} ${b.shape.slice(0, 20).padEnd(21)} ${b.cutLengthM.toFixed(2).padStart(7)} ${String(b.count).padStart(6)} ${b.totalLengthM.toFixed(1).padStart(9)} ${b.totalWeightKg.toFixed(1).padStart(9)}`,
      15,
      yRow,
    );
    yRow += 6;
  }

  yRow += 8;
  doc.setFontSize(10);
  doc.text("RINGKASAN DIVISI RAB & TAHAP KONSTRUKSI:", 15, yRow);
  yRow += 6;
  doc.setFontSize(8.5);
  for (const d of rab.divisions) {
    doc.text(`${d.kode}. ${d.nama}`, 15, yRow);
    doc.text(fmtRp(d.subtotal), 160, yRow, { align: "right" });
    yRow += 5.5;
  }
  doc.setFontSize(9.5);
  doc.text(`GRAND TOTAL RAB: ${fmtRp(rab.grandTotal)}`, 15, yRow + 4);
  addDraftWatermarkIfNeeded(doc, isDraft);

  return doc.output("blob");
}

export function exportPdfDrawingsAndReport(input: ExportBundleInput) {
  const blob = buildPdfDrawingsAndReportBlob(input);
  downloadBlob(blob, "01_Gambar_Struktur_RAB_5x17.pdf");
}

export function exportCanvasJpg(canvas: HTMLCanvasElement | null, filename = "04_Render_Rumah_5x17.jpg") {
  if (!canvas) return;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function exportContractorZipPackage(input: ExportBundleInput) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pdfBlob = buildPdfDrawingsAndReportBlob(input);
  const xlsxBlob = await buildExcelWorkbookBlob(input);
  const csvStr = generateTakeoffCsv(input.rab, input.derived);

  zip.file("01_Drawings_Structure_Summary.pdf", pdfBlob);
  zip.file("02_RAB_BOQ_Schedule.xlsx", xlsxBlob);
  zip.file("03_Takeoff.csv", csvStr);

  if (input.canvasSnapshotDataUrl) {
    const base64 = input.canvasSnapshotDataUrl.split(",")[1];
    if (base64) zip.file("04_Renders/perspective_hero.jpg", base64, { base64: true });
  }

  const qcText = input.schedule.stages
    .map((s) => `${s.order}. ${s.name} (${s.durationDays} hr, mulai H+${s.startDay}):\n` + s.qcChecklist.map((c) => `   [ ] ${c}`).join("\n"))
    .join("\n\n");
  zip.file("05_QC_Checklist_Mandor.txt", qcText);

  const readme = [
    "PAKET DOKUMEN KONSTRUKSI — RUMAH STUDIO 5x17 M",
    `Nama Proyek: ${input.derived.project.name}`,
    `Status: ${input.isDraft ? "DRAFT (Lengkapi review sebelum pelaksanaan)" : "FINAL SIAP DELEGASI"}`,
    `Revisi: ${input.derived.project.structuralParams.drawingRevision}`,
    `Reviewer Struktur: ${input.derived.project.structuralParams.reviewerName || "-"}`,
    "",
    "ASUMSI & BATASAN:",
    ...input.struct.assumptions.map((a) => `- ${a}`),
    `- Simulasi Pencahayaan: ${input.lighting.methodologyNote}`,
    `- Simulasi Aliran Udara: ${input.airflow.methodologyNote}`,
    `- Estimasi RAB menggunakan ${input.derived.project.priceBook.region}.`,
  ].join("\n");
  zip.file("README.txt", readme);

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, `Paket_Kontraktor_Rumah_5x17_${input.isDraft ? "DRAFT" : "FINAL"}.zip`);
}
