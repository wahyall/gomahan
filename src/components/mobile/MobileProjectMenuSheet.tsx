"use client";

import { useState } from "react";
import {
  BookOpen,
  ClipboardCheck,
  FolderOpen,
  History,
  RotateCcw,
  Save,
  Search,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { DerivedProjectModel } from "@/lib/geometry/projectModel";
import type { RabSummary } from "@/lib/quantities/rabEngine";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { fmtNum, fmtRp } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";
import { StudioConfirmDialog } from "@/components/ui/StudioPrimitives";

interface MobileProjectMenuSheetProps {
  open: boolean;
  onClose: () => void;
  derived: DerivedProjectModel;
  rab: RabSummary;
  onExportJson: () => void;
  onImportJson: () => void;
  onSaveSnapshot: () => void;
  onOpenSnapshots: () => void;
}

export function MobileProjectMenuSheet({
  open,
  onClose,
  derived,
  rab,
  onExportJson,
  onImportJson,
  onSaveSnapshot,
  onOpenSnapshots,
}: MobileProjectMenuSheetProps) {
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const setGuideOpen = useStudioStore((s) => s.setGuideOpen);
  const soundEnabled = useStudioStore((s) => s.soundEnabled);
  const setSoundEnabled = useStudioStore((s) => s.setSoundEnabled);
  const setCommandPaletteOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const resetProject = useStudioStore((s) => s.resetProject);

  return (
    <>
      <MobileBottomSheet
        open={open}
        onClose={onClose}
        title="Rumah Studio 5×17 m"
        subtitle={`${fmtNum(derived.totalNetFloorM2, 1)} m² bersih · ${fmtNum(derived.masonry.totalBuyBricks)} bata`}
        defaultSnap="full"
        modalBackdrop
      >
        <div className="space-y-3 p-4 pb-8">
          <button
            type="button"
            onClick={() => {
              onClose();
              setWorkspace("rab");
            }}
            className={cn(
              "flex min-h-14 w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99]",
              rab.overBudget ? "border-rose-500/40 bg-rose-500/10" : "border-emerald-500/35 bg-emerald-500/10",
            )}
          >
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Total Estimasi RAB ({rab.overBudget ? "Melebihi Pagu" : "Dalam Pagu"})
              </div>
              <div className={cn("mt-0.5 font-mono text-base font-bold tabular-nums", rab.overBudget ? "text-rose-200" : "text-emerald-200")}>
                {fmtRp(rab.grandTotal)}
              </div>
            </div>
            <span className="rounded-xl bg-black/30 px-3 py-1.5 text-xs font-semibold text-foreground">
              Buka RAB
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              setCommandPaletteOpen(true);
            }}
            className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm font-semibold text-foreground active:bg-white/[0.1]"
          >
            <Search className="h-4 w-4 text-primary" />
            <span>Cari Perintah, Katalog &amp; Ruangan</span>
          </button>

          <div className="grid grid-cols-1 gap-2">
            <MenuActionBtn
              icon={<Save className="h-4 w-4 text-primary" />}
              label="Simpan Snapshot Lokal"
              onClick={() => {
                onSaveSnapshot();
                onClose();
              }}
            />
            <MenuActionBtn
              icon={<History className="h-4 w-4 text-amber-300" />}
              label="Riwayat Snapshot Lokal"
              onClick={() => {
                onClose();
                onOpenSnapshots();
              }}
            />
            <MenuActionBtn
              icon={<FolderOpen className="h-4 w-4 text-sky-400" />}
              label="Buka File Proyek (.json)"
              onClick={() => {
                onClose();
                onImportJson();
              }}
            />
            <MenuActionBtn
              icon={<ClipboardCheck className="h-4 w-4 text-emerald-400" />}
              label="Unduh Backup JSON"
              onClick={() => {
                onExportJson();
                onClose();
              }}
            />
            <MenuActionBtn
              icon={<BookOpen className="h-4 w-4 text-primary" />}
              label="Panduan Teknis SNI & Konstruksi"
              onClick={() => {
                onClose();
                setGuideOpen(true);
              }}
            />
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-white/10 bg-black/25 px-4 text-sm font-medium text-foreground active:bg-white/[0.08]"
            >
              <span className="flex items-center gap-3">
                {soundEnabled ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                <span>Efek Suara Studio</span>
              </span>
              <span className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-xs font-semibold">
                {soundEnabled ? "ON" : "OFF"}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 text-sm font-semibold text-rose-300 active:bg-rose-500/20"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Reset ke Desain Awal 5×17 m</span>
          </button>
        </div>
      </MobileBottomSheet>

      <StudioConfirmDialog
        open={confirmResetOpen}
        title="Reset ke Desain Awal 5×17 m?"
        description="Seluruh perubahan dinding, furnitur, harga satuan, dan progres akan diganti dengan template awal rumah 5×17 m 2 lantai."
        confirmLabel="Ya, Reset Proyek"
        onConfirm={() => {
          resetProject();
          setConfirmResetOpen(false);
          onClose();
        }}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </>
  );
}

function MenuActionBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 text-left text-sm font-medium text-foreground transition active:bg-white/[0.08]"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
