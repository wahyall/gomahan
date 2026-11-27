"use client";

import { memo } from "react";
import { Compass, FileSpreadsheet, Footprints, Hammer, HardHat } from "lucide-react";
import { useStudioStore, type StudioPanelId } from "@/lib/store/useStudioStore";
import { cn } from "@/lib/utils";

export type MobilePrimaryTab = "desain" | "jelajah" | "simulasi" | "dokumen" | "lapangan";

interface MobileBottomNavProps {
  criticalCount: number;
  floodDanger: boolean;
  lastSimPanel: Exclude<StudioPanelId, "none">;
  onTabSelected?: (tab: MobilePrimaryTab) => void;
}

export const MobileBottomNav = memo(function MobileBottomNav({
  criticalCount,
  floodDanger,
  lastSimPanel,
  onTabSelected,
}: MobileBottomNavProps) {
  const workspace = useStudioStore((s) => s.workspace);
  const studioPanel = useStudioStore((s) => s.studioPanel);
  const setWorkspace = useStudioStore((s) => s.setWorkspace);
  const setStudioPanel = useStudioStore((s) => s.setStudioPanel);

  const activeTab: MobilePrimaryTab =
    workspace === "walk"
      ? "jelajah"
      : workspace === "timeline"
        ? "lapangan"
        : workspace === "rab" || workspace === "drawings" || workspace === "deliver"
          ? "dokumen"
          : studioPanel !== "none"
            ? "simulasi"
            : "desain";

  const tabs: {
    id: MobilePrimaryTab;
    label: string;
    icon: React.ElementType;
    dotClass?: string;
    onSelect: () => void;
  }[] = [
    {
      id: "desain",
      label: "Desain",
      icon: Hammer,
      onSelect: () => {
        setWorkspace("build");
        setStudioPanel("none");
      },
    },
    {
      id: "jelajah",
      label: "Jelajah",
      icon: Footprints,
      onSelect: () => {
        setStudioPanel("none");
        setWorkspace("walk");
      },
    },
    {
      id: "simulasi",
      label: "Simulasi",
      icon: Compass,
      dotClass: floodDanger ? "bg-cyan-400" : criticalCount > 0 ? "bg-rose-500" : undefined,
      onSelect: () => {
        setWorkspace("build");
        setStudioPanel(studioPanel !== "none" ? "none" : lastSimPanel);
      },
    },
    {
      id: "dokumen",
      label: "RAB",
      icon: FileSpreadsheet,
      onSelect: () => {
        setStudioPanel("none");
        if (workspace !== "rab" && workspace !== "drawings" && workspace !== "deliver") {
          setWorkspace("rab");
        }
      },
    },
    {
      id: "lapangan",
      label: "Lapangan",
      icon: HardHat,
      onSelect: () => {
        setStudioPanel("none");
        setWorkspace("timeline");
      },
    },
  ];

  return (
    <nav
      aria-label="Navigasi utama mobile"
      className="no-print z-50 shrink-0 border-t border-white/10 bg-[#0d1015]/98 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <div className="grid h-14 grid-cols-5 items-center gap-1 px-1.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                t.onSelect();
                onTabSelected?.(t.id);
              }}
              className={cn(
                "relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition active:scale-[0.96]",
                active ? "bg-primary/15 text-[#f6ba86]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <div className="relative">
                <Icon className={cn("h-[18px] w-[18px]", active && "text-primary")} aria-hidden />
                {t.dotClass && (
                  <span className={cn("absolute -right-1.5 -top-1 h-2 w-2 rounded-full ring-2 ring-[#0d1015]", t.dotClass)} />
                )}
              </div>
              <span className={cn("text-[10.5px] leading-none", active ? "font-bold" : "font-medium")}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});
