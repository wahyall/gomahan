"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UNIFIED_BUILD_CATALOG } from "@/features/buildMode/projectCatalog";
import { useBuildModeStore } from "@/features/buildMode/store";
import { useMobileLayout } from "@/lib/hooks/useMobileLayout";
import { useStudioStore, type StudioPanelId, type WorkspaceId } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";
import { CornerDownLeft, Search, X } from "lucide-react";

interface ActionItem {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette() {
  const isMobile = useMobileLayout();
  const project = useStudioStore((s) => s.project);
  const open = useStudioStore((s) => s.commandPaletteOpen);
  const setOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const setGuideOpen = useStudioStore((s) => s.setGuideOpen);
  const openBuildPanel = useStudioStore((s) => s.openBuildPanel);
  const setBrickPreset = useStudioStore((s) => s.setBrickPreset);
  const patchView = useStudioStore((s) => s.patchView);
  const patchSimulation = useStudioStore((s) => s.patchSimulation);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      if (!previousFocusRef.current) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) {
          previousFocusRef.current = active;
        }
      }
    } else if (!open && wasOpenRef.current) {
      const toRestore = previousFocusRef.current;
      previousFocusRef.current = null;
      queueMicrotask(() => toRestore?.focus?.());
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const nextOpen = !useStudioStore.getState().commandPaletteOpen;
        if (nextOpen) {
          const active = document.activeElement;
          if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) {
            previousFocusRef.current = active;
          }
          setQuery("");
          setSelectedIndex(0);
        }
        setOpen(nextOpen);
      } else if (e.key === "Escape" && useStudioStore.getState().commandPaletteOpen) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const actions = useMemo<ActionItem[]>(() => {
    const ws: [WorkspaceId, string, string?][] = [
      ["build", "Buka Build Studio 3D", "Shift+B"],
      ["walk", "Buka Walk Mode Realistis", "Shift+V"],
      ["drawings", "Buka Gambar Kerja 2D (Denah / Potongan / MEP)"],
      ["rab", "Buka RAB & Harga Satuan Surabaya"],
      ["timeline", "Buka Jadwal Gantt, S-Curve & Mode Lapangan"],
      ["deliver", "Buka Ekspor Paket Kontraktor (PDF / Excel / ZIP)"],
    ];

    const panels: [StudioPanelId, string][] = [
      ["structure", "Buka Panel Analisis Struktur SNI & Besi BBS"],
      ["lighting", "Buka Panel Simulasi Pencahayaan & Matahari"],
      ["airflow", "Buka Panel Simulasi Sirkulasi Udara & AC"],
      ["flood", "Buka Panel Simulasi Hujan Deras & Banjir"],
      ["inspection", "Buka Panel Outliner, Validasi & Pengaturan Proyek"],
    ];

    const switchTo3dIfNeeded = () => {
      const curr = useStudioStore.getState().workspace;
      if (curr !== "build" && curr !== "walk") setWorkspace("build");
    };

    return [
      ...ws.map(([id, label, shortcut]) => ({
        id: `ws-${id}`,
        label,
        category: "Ruang Kerja",
        shortcut,
        run: () => setWorkspace(id),
      })),
      {
        id: "open-guide",
        label: "Buka Panduan Standar Arsitektur & SNI",
        category: "Ruang Kerja",
        run: () => setGuideOpen(true),
      },
      ...panels.map(([panelId, label]) => ({
        id: `panel-${panelId}`,
        label,
        category: "Panel Analisis Studio",
        run: () => openBuildPanel(panelId),
      })),
      {
        id: "brick-hebel",
        label: "Ganti Dinding ke Bata Putih / Hebel AAC",
        category: "Material",
        run: () => {
          switchTo3dIfNeeded();
          setBrickPreset("hebel");
        },
      },
      {
        id: "brick-merah",
        label: "Ganti Dinding ke Bata Merah SNI",
        category: "Material",
        run: () => {
          switchTo3dIfNeeded();
          setBrickPreset("merah");
        },
      },
      {
        id: "brick-custom",
        label: "Gunakan Ukuran Bata Custom",
        category: "Material",
        run: () => {
          switchTo3dIfNeeded();
          setBrickPreset("custom");
        },
      },
      {
        id: "toggle-terrain",
        label: "Sembunyikan / Tampilkan Tanah (Lihat Pondasi Bawah Tanah)",
        category: "Viewport",
        run: () => {
          setWorkspace("build");
          patchView({
            showTerrain: !useStudioStore.getState().view.showTerrain,
            showStructure: true,
          });
        },
      },
      {
        id: "explode",
        label: "Toggle Exploded View (Bongkar Granular)",
        category: "Viewport",
        run: () => {
          setWorkspace("build");
          patchView({ explode: useStudioStore.getState().view.explode > 0.1 ? 0 : 1 });
        },
      },
      {
        id: "xray-rebar",
        label: "Toggle X-Ray Tulangan Besi Struktur",
        category: "Viewport",
        run: () => {
          setWorkspace("build");
          patchView({ xrayRebar: !useStudioStore.getState().view.xrayRebar });
        },
      },
      {
        id: "flood-60",
        label: "Uji Simulasi Banjir 60 cm + Hujan Lebat",
        category: "Simulasi",
        run: () => {
          openBuildPanel("flood");
          patchView({ showFloodWater: true, showRain: true });
          patchSimulation({ floodDepthCm: 60, rainIntensityMmH: 85 });
        },
      },
      {
        id: "night-lights",
        label: "Pratinjau Suasana Malam Hari (19:30 WIB)",
        category: "Simulasi",
        run: () => {
          switchTo3dIfNeeded();
          patchSimulation({ hourOfDay: 19.5 });
        },
      },
      {
        id: "noon-sun",
        label: "Pratinjau Matahari Siang Hari (12:00 WIB)",
        category: "Simulasi",
        run: () => {
          switchTo3dIfNeeded();
          patchSimulation({ hourOfDay: 12 });
        },
      },
      ...project.levels.flatMap((lv) =>
        lv.rooms.map((rm) => ({
          id: `room-${rm.id}`,
          label: `Pilih Ruang LT${lv.index + 1}: ${rm.name}`,
          category: "Ruangan",
          run: () => {
            setWorkspace("build");
            useBuildModeStore.getState().setActiveLevel(lv.index as 0 | 1);
            useStudioStore.getState().setSelected({ kind: "room", id: rm.id, levelIndex: lv.index });
          },
        })),
      ),
      ...UNIFIED_BUILD_CATALOG.filter((c) => c.toolId !== "select").map((item) => ({
        id: `cat-${item.id}`,
        label: `Pasang ${item.name} (${item.specLabel})`,
        category: "Katalog 3D",
        run: () => {
          setWorkspace("build");
          useBuildModeStore.getState().selectCatalogItem(item);
        },
      })),
    ];
  }, [openBuildPanel, patchSimulation, patchView, project.levels, setBrickPreset, setGuideOpen, setWorkspace]);

  const filtered = useMemo(
    () =>
      actions.filter(
        (a) => a.label.toLowerCase().includes(query.toLowerCase()) || a.category.toLowerCase().includes(query.toLowerCase()),
      ),
    [actions, query],
  );

  if (!open) return null;

  const clampedIndex = filtered.length > 0 ? Math.min(selectedIndex, filtered.length - 1) : 0;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-black/65 px-3 backdrop-blur-sm",
        isMobile ? "pt-[max(0.75rem,env(safe-area-inset-top))]" : "px-4 pt-16 sm:pt-24",
      )}
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isMobile ? "Pencarian Cepat" : "Command Palette"}
        className="studio-glass w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-3.5 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-primary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && filtered[clampedIndex]) {
                e.preventDefault();
                filtered[clampedIndex]!.run();
                setOpen(false);
              }
            }}
            placeholder={isMobile ? "Cari katalog, ruangan, atau simulasi..." : "Cari ruang kerja, material bata, atau simulasi..."}
            className="min-h-10 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:min-h-0 md:text-sm"
          />
          <button
            type="button"
            aria-label="Tutup pencarian"
            onClick={() => setOpen(false)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.08] hover:text-foreground md:min-h-0 md:min-w-0 md:p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60dvh] overflow-y-auto p-1.5 md:max-h-80">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Tidak ditemukan perintah yang cocok dengan &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filtered.slice(0, 40).map((a, idx) => {
              const active = idx === clampedIndex;
              return (
                <button
                  key={a.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    a.run();
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition-colors md:min-h-0",
                    active ? "bg-primary/15 text-foreground" : "text-foreground/85 hover:bg-white/[0.06]",
                  )}
                >
                  <div className="min-w-0 truncate font-medium">{a.label}</div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isMobile && a.shortcut && (
                      <kbd className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{a.shortcut}</kbd>
                    )}
                    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">{a.category}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {!isMobile && (
          <div className="flex items-center justify-between border-t border-white/[0.08] bg-black/20 px-3.5 py-2 text-[10px] text-muted-foreground">
            <span>Gunakan ↑ ↓ untuk memilih</span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" /> Enter buka · Esc tutup
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
