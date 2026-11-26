"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Elevated architectural studio card container with delicate top rim highlight */
export function StudioCard({
  children,
  className,
  highlight = false,
}: {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-4 transition-colors",
        highlight
          ? "border border-primary/35 bg-primary/[0.07] shadow-[inset_0_1px_0_rgba(226,138,72,0.14),0_8px_20px_-6px_rgba(0,0,0,0.3)]"
          : "studio-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Section label with clean editorial sentence case & optional right slot */
export function SectionHeader({
  icon,
  title,
  subtitle,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-tight text-foreground">
          {icon && <span className="shrink-0 text-primary">{icon}</span>}
          <span className="truncate">{title}</span>
        </div>
        {subtitle && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** High-legibility KPI tile with tabular numerals */
export function KpiMetric({
  icon,
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "primary" | "emerald" | "amber" | "rose" | "cyan";
  className?: string;
}) {
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "emerald"
        ? "text-emerald-300"
        : tone === "amber"
          ? "text-amber-300"
          : tone === "rose"
            ? "text-rose-300"
            : tone === "cyan"
              ? "text-cyan-300"
              : "text-foreground";

  return (
    <div className={cn("studio-surface rounded-xl px-3.5 py-3", className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon && <span className="shrink-0 opacity-85">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1.5 font-mono text-lg font-bold tracking-tight tabular-nums", toneClass)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

/** Refined accessible range slider with value pill */
export function StudioRange({
  label,
  display,
  min,
  max,
  step,
  value,
  onChange,
  accentHex,
  className,
}: {
  label: string;
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
  accentHex?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground tabular-nums">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={accentHex ? ({ "--studio-accent": accentHex } as React.CSSProperties) : undefined}
        className="studio-range w-full"
      />
    </div>
  );
}

/** Tactile switch button replacing raw HTML checkboxes */
export function StudioSwitch({
  label,
  description,
  checked,
  onChange,
  className,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition active:scale-[0.99]",
        checked
          ? "border-primary/40 bg-primary/[0.08] text-foreground"
          : "border-border bg-secondary/45 text-muted-foreground hover:border-white/20 hover:text-foreground",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium leading-tight">{label}</div>
        {description && <div className="mt-0.5 text-[10.5px] text-muted-foreground">{description}</div>}
      </div>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-primary bg-primary" : "border-white/15 bg-black/40",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-[#f2efe8] shadow transition-transform duration-150",
            checked ? "translate-x-[18px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </button>
  );
}

/** Styled architectural select input */
export function StudioSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-[#13161c] px-2.5 text-xs font-medium text-foreground outline-none transition hover:border-white/25 focus:border-primary"
      >
        {options.map(([k, txt]) => (
          <option key={k} value={k} className="bg-[#181c23] text-foreground">
            {txt}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Styled numeric input with local draft editing buffer; clamps cleanly on blur/Enter. */
export function StudioNumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  className,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commitValue = (raw: string) => {
    const trimmed = raw.trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    let bounded = parsed;
    if (min !== undefined) bounded = Math.max(min, bounded);
    if (max !== undefined) bounded = Math.min(max, bounded);
    onChange(bounded);
    setDraft(String(bounded));
  };

  return (
    <label className={cn("block space-y-1", className)}>
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-[#13161c] px-2.5 focus-within:border-primary hover:border-white/25">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={focused ? draft : String(value)}
          onFocus={() => {
            setDraft(String(value));
            setFocused(true);
          }}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            const parsed = Number(next);
            if (next.trim() !== "" && Number.isFinite(parsed)) {
              const withinMin = min === undefined || parsed >= min;
              const withinMax = max === undefined || parsed <= max;
              if (withinMin && withinMax) onChange(parsed);
            }
          }}
          onBlur={(e) => {
            setFocused(false);
            commitValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(String(value));
              setFocused(false);
              e.currentTarget.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent font-mono text-xs font-semibold text-foreground tabular-nums outline-none"
        />
        {unit && <span className="ml-1.5 shrink-0 font-mono text-[10.5px] text-muted-foreground">{unit}</span>}
      </div>
    </label>
  );
}

/** Shared confirmation dialog for destructive or project-overwriting actions. */
export function StudioConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Ya, Lanjutkan",
  cancelLabel = "Batal",
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="studio-glass w-full max-w-md space-y-4 rounded-2xl border border-white/[0.12] p-5 shadow-2xl"
      >
        <div className="space-y-1.5">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-9 rounded-lg border border-border bg-secondary px-3.5 text-xs font-medium text-foreground transition hover:bg-secondary/80"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "min-h-9 rounded-lg px-4 text-xs font-semibold transition",
              danger
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-primary text-primary-foreground hover:brightness-110",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
