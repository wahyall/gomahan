"use client";

import { useEffect, useMemo, useState } from "react";
import { useStudioStore, type WorkspaceId } from "@/lib/store/useStudioStore";
import { Search, X } from "lucide-react";

interface ActionItem {
  id: string;
  label: string;
  category: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useStudioStore((s) => s.commandPaletteOpen);
  const setOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const setBrickPreset = useStudioStore((s) => s.setBrickPreset);
  const patchView = useStudioStore((s) => s.patchView);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useStudioStore.getState().commandPaletteOpen);
      } else if (e.key === "Escape" && useStudioStore.getState().commandPaletteOpen) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const actions = useMemo<ActionItem[]>(() => {
    const ws: [WorkspaceId, string][] = [
      ["build", "Buka Build Mode Baru (Stub Fase 0)"],
      ["walk", "Buka Walk Mode Realistis (Stub Fase 0)"],
      ["structure", "Buka Analisis Struktur SNI & Besi BBS"],
      ["lighting", "Buka Simulasi Pencahayaan & Matahari"],
      ["airflow", "Buka Simulasi Sirkulasi Udara & AC"],
      ["flood", "Buka Simulasi Hujan Deras & Banjir"],
      ["drawings", "Buka Gambar Kerja 2D (Denah/Potongan/MEP)"],
      ["rab", "Buka RAB & Harga Satuan Surabaya"],
      ["timeline", "Buka Jadwal Gantt & S-Curve Cash Flow"],
      ["deliver", "Buka Export Paket Kontraktor (PDF/Excel/ZIP)"],
      ["site", "Buka Mode Lapangan Mandor (Site Mode)"],
      ["guide", "Buka Panduan Standar Arsitektur Indonesia"],
    ];

    return [
      ...ws.map(([id, label]) => ({
        id: `ws-${id}`,
        label,
        category: "Navigasi",
        run: () => setWorkspace(id),
      })),
      { id: "brick-hebel", label: "Ganti Dinding ke Bata Putih / Hebel AAC", category: "Material", run: () => setBrickPreset("hebel") },
      { id: "brick-merah", label: "Ganti Dinding ke Bata Merah SNI", category: "Material", run: () => setBrickPreset("merah") },
      { id: "brick-custom", label: "Gunakan Ukuran Bata Custom", category: "Material", run: () => setBrickPreset("custom") },
      { id: "explode", label: "Toggle Exploded View (Bongkar Granular)", category: "Viewport", run: () => patchView({ explode: useStudioStore.getState().view.explode > 0.1 ? 0 : 1 }) },
      { id: "xray-rebar", label: "Toggle X-Ray Tulangan Besi Struktur", category: "Viewport", run: () => patchView({ xrayRebar: !useStudioStore.getState().view.xrayRebar }) },
      { id: "flood-60", label: "Uji Simulasi Banjir 60 cm + Hujan Lebat", category: "Simulasi", run: () => { setWorkspace("flood"); patchSimulation({ floodDepthCm: 60, rainIntensityMmH: 85 }); } },
      { id: "night-lights", label: "Pratinjau Suasana Malam Hari (19:30)", category: "Simulasi", run: () => patchSimulation({ hourOfDay: 19.5 }) },
      { id: "noon-sun", label: "Pratinjau Matahari Siang Hari (12:00)", category: "Simulasi", run: () => patchSimulation({ hourOfDay: 12 }) },
    ];
  }, [patchSimulation, patchView, setBrickPreset, setWorkspace]);

  if (!open) return null;

  const filtered = actions.filter(
    (a) => a.label.toLowerCase().includes(query.toLowerCase()) || a.category.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 pt-20 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-primary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ketik perintah, material, simulasi, atau ruang kerja..."
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                a.run();
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs hover:bg-accent"
            >
              <span className="font-medium text-foreground">{a.label}</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{a.category}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
