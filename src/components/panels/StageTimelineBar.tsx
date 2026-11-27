"use client";

import { useEffect, useState } from "react";
import { CONSTRUCTION_STAGES } from "@/lib/house/knowledge";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { ClipboardCheck, ListOrdered, Pause, Play, SkipBack, SkipForward } from "lucide-react";

export function StageTimelineBar() {
  const [playing, setPlaying] = useState(false);
  const stage = useStudioStore((s) => s.view.stage);
  const patchView = useStudioStore((s) => s.patchView);
  const totalStages = CONSTRUCTION_STAGES.length;
  const stageInfo = stage > 0 ? CONSTRUCTION_STAGES.find((s) => s.no === stage) ?? null : null;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      const next = stage < totalStages ? stage + 1 : 0;
      patchView({ stage: next });
      if (next === 0) setPlaying(false);
    }, 2400);
    return () => clearTimeout(t);
  }, [playing, stage, totalStages, patchView]);

  return (
    <div className="no-print safe-pb shrink-0 border-t border-border bg-[#13171d] px-3 py-2 [@media(max-height:480px)]:hidden">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 rounded-lg bg-black/25 p-1">
          <button
            type="button"
            onClick={() => {
              if (!playing && stage === 0) patchView({ stage: 1 });
              setPlaying(!playing);
            }}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:brightness-110 sm:min-h-7 sm:min-w-7 sm:h-7 sm:w-7"
            title={playing ? "Jeda Simulasi Tahapan" : `Putar Urutan Pembangunan ${totalStages} Tahap`}
          >
            {playing ? <Pause className="h-4 w-4 sm:h-3 sm:w-3" /> : <Play className="h-4 w-4 sm:h-3 sm:w-3" />}
          </button>
          <button
            type="button"
            onClick={() => patchView({ stage: Math.max(0, stage - 1) })}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.08] hover:text-foreground sm:min-h-7 sm:min-w-7 sm:h-7 sm:w-7"
            title="Tahap Sebelumnya"
          >
            <SkipBack className="h-4 w-4 sm:h-3 sm:w-3" />
          </button>
          <button
            type="button"
            onClick={() => patchView({ stage: stage >= totalStages ? 0 : stage + 1 })}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.08] hover:text-foreground sm:min-h-7 sm:min-w-7 sm:h-7 sm:w-7"
            title="Tahap Berikutnya"
          >
            <SkipForward className="h-4 w-4 sm:h-3 sm:w-3" />
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <ListOrdered className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-semibold text-foreground">Urutan Konstruksi</span>
          <span className="truncate text-muted-foreground">
            {stageInfo ? `Tahap ${stageInfo.no}/${totalStages} — ${stageInfo.nama} (${stageInfo.durasi})` : "Model Lengkap Selesai"}
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
            "flex min-h-11 shrink-0 flex-col justify-center rounded-lg border px-3 text-left leading-none transition sm:min-h-8 sm:h-8 sm:px-2.5",
            stage === 0
              ? "border-[#f2efe8] bg-[#f2efe8] text-[#14171c]"
              : "border-white/[0.08] bg-black/25 text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="text-[10.5px] font-bold">Selesai</span>
          <span className="mt-0.5 text-[9px] opacity-75">Semua</span>
        </button>
        {CONSTRUCTION_STAGES.map((st) => (
          <button
            key={st.no}
            type="button"
            onClick={() => patchView({ stage: st.no })}
            className={cn(
              "flex min-h-11 shrink-0 flex-col justify-center rounded-lg border px-3 text-left leading-none transition sm:min-h-8 sm:h-8 sm:px-2.5",
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
