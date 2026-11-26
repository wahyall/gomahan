import type { Opening, Wall } from "@/lib/model/types";

export function wallLength(w: Wall): number {
  return Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
}

export function openingBoundsAlongWall(w: Wall, o: Opening): { lo: number; hi: number; sill: number; top: number } {
  const len = wallLength(w);
  const lo = Math.max(0, o.offset - o.width / 2);
  const hi = Math.min(len, o.offset + o.width / 2);
  return {
    lo,
    hi,
    sill: Math.max(0, o.sill),
    top: Math.min(w.height, o.sill + o.height),
  };
}
