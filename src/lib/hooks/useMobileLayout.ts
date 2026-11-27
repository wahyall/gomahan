"use client";

import { useSyncExternalStore } from "react";

const MOBILE_LAYOUT_QUERY = "(max-width: 767px), ((pointer: coarse) and (max-width: 1024px))";
const COARSE_POINTER_QUERY = "(pointer: coarse), (max-width: 767px)";

function subscribeMedia(query: string, callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(query);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getMediaMatch(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

/**
 * Returns true on mobile phones (portrait & landscape) and narrow touch devices
 * so MobileStudioShell can replace desktop chrome cleanly without shrinking it.
 */
export function useMobileLayout(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(MOBILE_LAYOUT_QUERY, cb),
    () => getMediaMatch(MOBILE_LAYOUT_QUERY),
    () => false,
  );
}

/**
 * Returns true whenever touch controls should be shown (any coarse pointer
 * regardless of orientation/width, or narrow viewport).
 */
export function useTouchControls(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(COARSE_POINTER_QUERY, cb),
    () => getMediaMatch(COARSE_POINTER_QUERY),
    () => false,
  );
}
