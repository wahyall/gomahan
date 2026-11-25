"use client";

import { useEffect, useState } from "react";
import { CONSTRUCTION_STAGES_GUIDE } from "@/lib/house/knowledge";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { ClipboardCheck, ListOrdered, Pause, Play, SkipBack, SkipForward } from "lucide-react";

export function StageTimelineBar() {
  const [playing, setPlaying] = useState(false);
  const stage = useStudioStore((s) => s.view.stage);
  const patchView = useStudioStore((s) => s.patchView);
  const stageInfo = stage > 0 ? CONSTRUCTION_STAGES_GUIDE.find((s) => s.no === stage) ?? null : null;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      const next = stage < 10 ? stage + 1 : 0;
      patchView({ stage: next });
      if (next === 0) setPlaying(false);
    }, 2400);
    return () => clearTimeout(t);
  }, [playing, stage, patchView]);

  return (
    <div className="no-print safe-pb shrink-0 border-t border-border bg-[#13171d] px-3 py-2 [@media(max-height:480px)]:hidden">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-black/25 p-0.5">
          <button
            type="button"
            onClick={() => {
              if (!playing && stage === 0) patchView({ stage: 1 });
              setPlaying(!playing);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:brightness-110"
            title={playing ? "Jeda Simulasi Tahapan" : "Putar Urutan Pembangunan 10 Tahap"}
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => patchView({ stage: Math.max(0, stage - 1) })}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
            title="Tahap Sebelumnya"
          >
            <SkipBack className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => patchView({ stage: stage >= 10 ? 0 : stage + 1 })}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
            title="Tahap Berikutnya"
          >
            <SkipForward className="h-3 w-3" />
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <ListOrdered className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-semibold text-foreground">Urutan Konstruksi</span>
          <span className="truncate text-muted-foreground">
            {stageInfo ? `Tahap ${stageInfo.no}/10 — ${stageInfo.nama} (${stageInfo.durasi})` : "Model Lengkap Selesai"}
          </span>
        </div>

        {stageInfo && (
          <div className="ml-auto hidden items-center gap-1.5 xl:flex">
            <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" />
            {stageInfo.cekMutu.slice(0, 2).map((c) => (
              <span key={c} className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
        <button
          type="button"
          onClick={() => patchView({ stage: 0 })}
          className={cn(
            "flex h-8 shrink-0 flex-col justify-center rounded-lg border px-2.5 text-left leading-none transition",
            stage === 0
              ? "border-[#f2efe8] bg-[#f2efe8] text-[#14171c]"
              : "border-white/[0.08] bg-black/25 text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="text-[10.5px] font-bold">Selesai</span>
          <span className="mt-0.5 text-[9px] opacity-75">Semua</span>
        </button>
        {CONSTRUCTION_STAGES_GUIDE.map((st) => (
          <button
            key={st.no}
            type="button"
            onClick={() => patchView({ stage: st.no })}
            className={cn(
              "flex h-8 shrink-0 flex-col justify-center rounded-lg border px-2.5 text-left leading-none transition",
              stage === st.no
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/[0.08] bg-black/25 text-muted-foreground hover:border-white/20 hover:text-foreground",
            )}
          >
            <span className="text-[10.5px] font-semibold">
              {st.no}. {st.nama}
            </span>
            <span className="mt-0.5 text-[9px] opacity-75">{st.durasi}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
