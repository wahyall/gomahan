"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type BottomSheetSnap = "peek" | "half" | "full";

const SNAP_HEIGHT_VH: Record<BottomSheetSnap, number> = {
  peek: 18,
  half: 48,
  full: 88,
};

interface MobileBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  snap?: BottomSheetSnap;
  defaultSnap?: BottomSheetSnap;
  onSnapChange?: (next: BottomSheetSnap) => void;
  headerExtra?: ReactNode;
  children: ReactNode;
  /** When true, darkens & blocks taps above the sheet (e.g. Catalog modal); false keeps 3D live & orbitable. */
  modalBackdrop?: boolean;
  className?: string;
}

/**
 * Draggable 3-Snap Bottom Sheet (Peek 18% / Half 48% / Full 88%).
 * By default keeps the upper 52% of the viewport interactive so users can
 * orbit/zoom the live 3D house while adjusting simulation sliders or part info.
 */
export function MobileBottomSheet({
  open,
  onClose,
  title,
  subtitle,
  snap: controlledSnap,
  defaultSnap = "half",
  onSnapChange,
  headerExtra,
  children,
  modalBackdrop = false,
  className,
}: MobileBottomSheetProps) {
  const [uncontrolledSnap, setUncontrolledSnap] = useState<BottomSheetSnap>(defaultSnap);
  const activeSnap = controlledSnap ?? uncontrolledSnap;

  const setSnap = (next: BottomSheetSnap) => {
    if (controlledSnap === undefined) setUncontrolledSnap(next);
    onSnapChange?.(next);
  };

  const dragStartY = useRef<number | null>(null);
  const dragStartVh = useRef<number>(SNAP_HEIGHT_VH[activeSnap]);
  const [dragVh, setDragVh] = useState<number | null>(null);

  if (!open) return null;

  const currentVh = dragVh ?? SNAP_HEIGHT_VH[activeSnap];

  const cycleSnap = () => {
    const next: BottomSheetSnap = activeSnap === "peek" ? "half" : activeSnap === "half" ? "full" : "half";
    setSnap(next);
  };

  return (
    <>
      {modalBackdrop && (
        <button
          type="button"
          aria-label="Tutup panel"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[1px]"
        />
      )}

      <section
        role="dialog"
        aria-label={title}
        style={{ height: `${currentVh}dvh` }}
        className={cn(
          "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col overflow-hidden rounded-t-3xl border-t border-white/15 bg-[#12161d]/97 shadow-[0_-12px_40px_rgba(0,0,0,0.65)] backdrop-blur-xl",
          dragVh === null && "transition-[height] duration-200 ease-out",
          className,
        )}
      >
        {/* Drag Handle + Header */}
        <div className="shrink-0 border-b border-white/[0.08] bg-[#0f1318]/90 px-3 pb-2 pt-1.5">
          <div
            role="slider"
            aria-label="Geser tinggi panel"
            aria-valuemin={18}
            aria-valuemax={88}
            aria-valuenow={Math.round(currentVh)}
            tabIndex={0}
            onPointerDown={(e) => {
              dragStartY.current = e.clientY;
              dragStartVh.current = SNAP_HEIGHT_VH[activeSnap];
              setDragVh(dragStartVh.current);
              try {
                e.currentTarget.setPointerCapture?.(e.pointerId);
              } catch {
                // ignore
              }
            }}
            onPointerMove={(e) => {
              if (dragStartY.current === null) return;
              const vhDelta = ((dragStartY.current - e.clientY) / Math.max(300, window.innerHeight)) * 100;
              setDragVh(Math.max(14, Math.min(90, dragStartVh.current + vhDelta)));
            }}
            onPointerUp={(e) => {
              if (dragStartY.current === null) return;
              const finalVh = dragVh ?? SNAP_HEIGHT_VH[activeSnap];
              dragStartY.current = null;
              setDragVh(null);
              try {
                if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              } catch {
                // ignore
              }
              if (finalVh < 13) {
                onClose();
              } else if (finalVh < 33) {
                setSnap("peek");
              } else if (finalVh < 68) {
                setSnap("half");
              } else {
                setSnap("full");
              }
            }}
            onPointerCancel={() => {
              dragStartY.current = null;
              setDragVh(null);
            }}
            className="flex min-h-7 w-full touch-none items-center justify-center cursor-grab active:cursor-grabbing"
          >
            <span className="h-1.5 w-12 rounded-full bg-white/25" />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-foreground">{title}</div>
              {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={cycleSnap}
                aria-label={activeSnap === "full" ? "Kecilkan panel" : "Perbesar panel"}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-muted-foreground transition hover:text-foreground"
              >
                {activeSnap === "full" ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup panel"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {headerExtra && <div className="mt-2">{headerExtra}</div>}
        </div>

        {/* Scrollable Sheet Content */}
        {activeSnap !== "peek" && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
        )}
      </section>
    </>
  );
}
