"use client";

import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { CONSTRUCTION_STAGES_GUIDE, DETAIL_ELEMEN_2LANTAI, STANDAR_REGULASI } from "@/lib/house/knowledge";
import { fmtNum } from "@/lib/utils/format";
import { BookOpen, CalendarClock, ClipboardCheck, ShieldCheck, Wind } from "lucide-react";

export function GuideWorkspace({ derived }: { derived: DerivedProjectModel }) {
  const ratio = derived.lightingRatioPct;
  const okSni = ratio >= 5;
  const okIdeal = ratio >= 10;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Wind className="h-4 w-4 text-primary" /> Evaluasi Bukaan Cahaya & Ventilasi Alami (SNI 03-2396 & SNI 03-6572)
          </div>
          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            <div className="rounded border border-border bg-secondary/40 p-3">
              <div className="text-xs text-muted-foreground">Luas Kaca Jendela</div>
              <div className="font-mono text-2xl font-bold">{fmtNum(derived.totalWindowAreaM2, 2)} m²</div>
              <div className="mt-1 text-xs font-semibold text-primary">{fmtNum(ratio, 1)}% luas lantai tertutup</div>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <div className="mb-1 flex justify-between">
                  <span>Syarat Minimal SNI (5%)</span>
                  <span className={okSni ? "font-bold text-emerald-400" : "font-bold text-red-400"}>{okSni ? "Memenuhi" : "Kurang"}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (ratio / 5) * 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span>Praktik Ideal Tropis (10–20%)</span>
                  <span className={okIdeal ? "font-bold text-emerald-400" : "font-bold text-amber-300"}>{okIdeal ? "Ideal" : "Perlu Optimalisasi"}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (ratio / 10) * 100)}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CalendarClock className="h-4 w-4 text-primary" /> Urutan 10 Tahap Konstruksi Rumah 2 Lantai 5×17 m
          </div>
          <div className="space-y-2.5">
            {CONSTRUCTION_STAGES_GUIDE.map((t) => (
              <div key={t.no} className="rounded border border-border bg-secondary/25 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{t.no}</span>
                  <span className="font-bold text-foreground">{t.nama}</span>
                  <span className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t.durasi}</span>
                </div>
                <p className="mt-1.5 text-muted-foreground">{t.deskripsi}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" />
                  {t.cekMutu.map((c) => (
                    <span key={c} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">{c}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <BookOpen className="h-4 w-4 text-primary" /> Kaidah Teknis Arsitektur & Struktur Indonesia
          </div>
          <div className="space-y-3">
            {DETAIL_ELEMEN_2LANTAI.map((el) => (
              <div key={el.id} className="rounded border border-border bg-secondary/20 p-3 text-xs">
                <div className="font-bold text-foreground">{el.judul}</div>
                <div className="mt-0.5 text-[11px] font-medium text-primary">{el.ringkas}</div>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
                  {el.poin.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> Standar & Regulasi Acuan
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {STANDAR_REGULASI.map((s) => (
              <div key={s.kode} className="rounded border border-border p-2.5 text-xs">
                <div className="font-bold text-primary">{s.kode} — <span className="text-foreground">{s.judul}</span></div>
                <div className="mt-1 text-[11px] text-muted-foreground">{s.ket}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
