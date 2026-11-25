"use client";

import { useState } from "react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import { CONSTRUCTION_STAGES_GUIDE, DETAIL_ELEMEN_2LANTAI, STANDAR_REGULASI } from "@/lib/house/knowledge";
import { fmtNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { SectionHeader, StudioCard } from "@/components/ui/StudioPrimitives";
import { BookOpen, CalendarClock, ClipboardCheck, Search, ShieldCheck, Wind, X } from "lucide-react";

type GuideFilter = "semua" | "tahap" | "kaidah" | "regulasi";

export function GuideWorkspace({ derived }: { derived: DerivedProjectModel }) {
  const [filter, setFilter] = useState<GuideFilter>("semua");
  const [query, setQuery] = useState("");

  const ratio = derived.lightingRatioPct;
  const okSni = ratio >= 5;
  const okIdeal = ratio >= 10;
  const q = query.trim().toLowerCase();

  const stagesFiltered = CONSTRUCTION_STAGES_GUIDE.filter(
    (t) => !q || t.nama.toLowerCase().includes(q) || t.deskripsi.toLowerCase().includes(q),
  );
  const detailsFiltered = DETAIL_ELEMEN_2LANTAI.filter(
    (el) => !q || el.judul.toLowerCase().includes(q) || el.ringkas.toLowerCase().includes(q) || el.poin.some((p) => p.toLowerCase().includes(q)),
  );
  const stdFiltered = STANDAR_REGULASI.filter(
    (s) => !q || s.kode.toLowerCase().includes(q) || s.judul.toLowerCase().includes(q) || s.ket.toLowerCase().includes(q),
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Filter & Search Bar */}
        <StudioCard className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-black/30 p-1">
            {(
              [
                ["semua", "Semua"],
                ["tahap", "10 Tahap Konstruksi"],
                ["kaidah", "Kaidah Struktur"],
                ["regulasi", "Standar SNI"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                  filter === k ? "bg-[#f2efe8] font-semibold text-[#14171c] shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari tahapan atau regulasi SNI..."
              className="h-8 w-60 rounded-lg border border-input bg-[#111418] pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Bersihkan pencarian"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </StudioCard>

        {filter === "semua" && !q && (
          <StudioCard className="space-y-3">
            <SectionHeader icon={<Wind className="h-4 w-4 text-primary" />} title="Evaluasi Bukaan Cahaya & Ventilasi Alami (SNI 03-2396 & SNI 03-6572)" />
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3.5">
                <div className="text-xs text-muted-foreground">Luas Kaca Jendela</div>
                <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{fmtNum(derived.totalWindowAreaM2, 2)} m²</div>
                <div className="mt-1 text-xs font-semibold text-primary tabular-nums">{fmtNum(ratio, 1)}% luas lantai tertutup</div>
              </div>
              <div className="flex flex-col justify-center space-y-3 text-xs">
                <div>
                  <div className="mb-1 flex justify-between">
                    <span>Syarat Minimal SNI (5%)</span>
                    <span className={okSni ? "font-bold text-emerald-300" : "font-bold text-rose-300"}>{okSni ? "Memenuhi" : "Kurang"}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/35">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, (ratio / 5) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between">
                    <span>Praktik Ideal Tropis (10–20%)</span>
                    <span className={okIdeal ? "font-bold text-emerald-300" : "font-bold text-amber-300"}>{okIdeal ? "Ideal" : "Perlu Optimalisasi"}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/35">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (ratio / 10) * 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </StudioCard>
        )}

        {(filter === "semua" || filter === "tahap") && stagesFiltered.length > 0 && (
          <StudioCard className="space-y-3">
            <SectionHeader icon={<CalendarClock className="h-4 w-4 text-primary" />} title="Urutan 10 Tahap Konstruksi Rumah 2 Lantai 5×17 m" />
            <div className="space-y-2.5">
              {stagesFiltered.map((t) => (
                <div key={t.no} className="rounded-xl border border-white/[0.08] bg-black/20 p-3.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      {t.no}
                    </span>
                    <span className="font-bold text-foreground">{t.nama}</span>
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{t.durasi}</span>
                  </div>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">{t.deskripsi}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" />
                    {t.cekMutu.map((c) => (
                      <span key={c} className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </StudioCard>
        )}

        {(filter === "semua" || filter === "kaidah") && detailsFiltered.length > 0 && (
          <StudioCard className="space-y-3">
            <SectionHeader icon={<BookOpen className="h-4 w-4 text-primary" />} title="Kaidah Teknis Arsitektur & Struktur Indonesia" />
            <div className="space-y-2.5">
              {detailsFiltered.map((el) => (
                <div key={el.id} className="rounded-xl border border-white/[0.08] bg-black/20 p-3.5 text-xs">
                  <div className="font-bold text-foreground">{el.judul}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-primary">{el.ringkas}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                    {el.poin.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </StudioCard>
        )}

        {(filter === "semua" || filter === "regulasi") && stdFiltered.length > 0 && (
          <StudioCard className="space-y-3">
            <SectionHeader icon={<ShieldCheck className="h-4 w-4 text-primary" />} title="Standar & Regulasi Acuan" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              {stdFiltered.map((s) => (
                <div key={s.kode} className="rounded-xl border border-white/[0.08] bg-black/20 p-3 text-xs">
                  <div className="font-bold text-primary">
                    {s.kode} — <span className="text-foreground">{s.judul}</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.ket}</div>
                </div>
              ))}
            </div>
          </StudioCard>
        )}
      </div>
    </div>
  );
}
