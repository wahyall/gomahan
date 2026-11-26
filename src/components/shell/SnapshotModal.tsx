"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteProjectSnapshot, listProjectSnapshots, type ProjectSnapshotRecord } from "@/lib/store/db";
import { parseVersionedProjectSave } from "@/lib/model/schema";
import { useStudioStore } from "@/lib/store/useStudioStore";
import { toast } from "sonner";
import { History, RotateCcw, Trash2, X } from "lucide-react";

export function SnapshotModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectId = useStudioStore((s) => s.project.id);
  const loadProject = useStudioStore((s) => s.loadProject);
  const [items, setItems] = useState<ProjectSnapshotRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const reloadSnapshots = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listProjectSnapshots(projectId);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    listProjectSnapshots(projectId)
      .then((list) => {
        if (active) setItems(list);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 px-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Riwayat Snapshot Lokal"
        onClick={(e) => e.stopPropagation()}
        className="studio-glass flex max-h-[75vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.12] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground">
            <History className="h-4 w-4 text-primary" />
            <span>Riwayat Snapshot Lokal (IndexedDB)</span>
          </div>
          <button
            type="button"
            aria-label="Tutup riwayat snapshot"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Memuat daftar snapshot...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Belum ada snapshot tersimpan. Gunakan menu Proyek → &ldquo;Simpan Snapshot Lokal&rdquo; untuk menyimpan versi kerja.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((snap) => (
                <div
                  key={snap.id ?? snap.createdAt}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-black/25 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{snap.label}</div>
                    <div className="font-mono text-[10.5px] text-muted-foreground">
                      {new Date(snap.createdAt).toLocaleString("id-ID")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const res = parseVersionedProjectSave(snap.data);
                        if (res.status !== "ok") {
                          toast.error(res.message);
                          return;
                        }
                        loadProject(res.data);
                        toast.success(`Snapshot "${snap.label}" dipulihkan.`);
                        onClose();
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:brightness-110"
                    >
                      <RotateCcw className="h-3 w-3" /> Muat
                    </button>
                    {snap.id !== undefined && (
                      <button
                        type="button"
                        aria-label={`Hapus snapshot ${snap.label}`}
                        onClick={async () => {
                          await deleteProjectSnapshot(snap.id!);
                          await reloadSnapshots();
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
