"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface VirtualJoystickProps {
  sprintLocked: boolean;
  onMove: (forward: number, strafe: number, sprint: boolean) => void;
  className?: string;
}

const MAX_RADIUS_PX = 46;
const DEADZONE = 0.12;

/**
 * Floating Analog Virtual Joystick for Walk Mode.
 * Appears at the thumb touch point in the left half of the viewport,
 * isolates its pointerId via setPointerCapture + stopPropagation,
 * and auto-sprints when pushed past 85% of outer radius.
 */
export function VirtualJoystick({ sprintLocked, onMove, className }: VirtualJoystickProps) {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [autoSprint, setAutoSprint] = useState(false);

  const releaseStick = () => {
    pointerIdRef.current = null;
    originRef.current = null;
    setOrigin(null);
    setKnobOffset({ x: 0, y: 0 });
    setAutoSprint(false);
    onMove(0, 0, sprintLocked);
  };

  const updateStick = (clientX: number, clientY: number) => {
    const o = originRef.current;
    if (!o) return;
    const dx = clientX - o.x;
    const dy = clientY - o.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(MAX_RADIUS_PX, dist);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;
    setKnobOffset({ x: kx, y: ky });

    const norm = clampedDist / MAX_RADIUS_PX;
    if (norm < DEADZONE) {
      setAutoSprint(false);
      onMove(0, 0, sprintLocked);
      return;
    }

    const scaled = (norm - DEADZONE) / (1 - DEADZONE);
    const strafe = Math.cos(angle) * scaled;
    const forward = -Math.sin(angle) * scaled;
    const sprinting = sprintLocked || norm >= 0.85;
    setAutoSprint(norm >= 0.85);
    onMove(forward, strafe, sprinting);
  };

  return (
    <div
      ref={zoneRef}
      aria-label="Analog Joystick Jalan"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (pointerIdRef.current !== null) return;
        const rect = zoneRef.current?.getBoundingClientRect();
        if (!rect) return;
        pointerIdRef.current = e.pointerId;
        const ox = e.clientX;
        const oy = e.clientY;
        originRef.current = { x: ox, y: oy };
        setOrigin({ x: ox - rect.left, y: oy - rect.top });
        setKnobOffset({ x: 0, y: 0 });
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // ignore synthetic pointer events
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointerIdRef.current) return;
        e.stopPropagation();
        updateStick(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== pointerIdRef.current) return;
        e.stopPropagation();
        try {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
        releaseStick();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId !== pointerIdRef.current) return;
        e.stopPropagation();
        releaseStick();
      }}
      className={cn("touch-none select-none", className)}
    >
      {/* Subtle resting thumb indicator when idle */}
      {!origin && (
        <div className="pointer-events-none absolute bottom-7 left-6 flex h-24 w-24 items-center justify-center rounded-full border border-white/15 bg-black/25 backdrop-blur-sm [@media(max-height:460px)]:bottom-4 [@media(max-height:460px)]:left-4 [@media(max-height:460px)]:h-20 [@media(max-height:460px)]:w-20">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 text-[10px] font-semibold text-white/75">
            Jalan
          </div>
        </div>
      )}

      {/* Active floating joystick ring & thumbstick */}
      {origin && (
        <div
          className={cn(
            "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-colors",
            autoSprint || sprintLocked
              ? "border-primary/70 bg-primary/15"
              : "border-white/30 bg-black/35",
          )}
          style={{
            left: origin.x,
            top: origin.y,
            width: MAX_RADIUS_PX * 2 + 24,
            height: MAX_RADIUS_PX * 2 + 24,
          }}
        >
          <div
            className={cn(
              "absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg",
              autoSprint || sprintLocked
                ? "border-[#f6ba86] bg-primary/80"
                : "border-white/60 bg-white/30",
            )}
            style={{
              transform: `translate(calc(-50% + ${knobOffset.x}px), calc(-50% + ${knobOffset.y}px))`,
            }}
          />
        </div>
      )}
    </div>
  );
}
