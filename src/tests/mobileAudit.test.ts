import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildCameraController } from "@/features/buildMode/BuildCameraController";
import { useBuildModeStore } from "@/features/buildMode/store";
import { shareOrDownloadBlob } from "@/lib/export/exporters";

function makeMockCanvas(): HTMLElement {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(evt: Event) {
      for (const fn of listeners.get(evt.type) ?? []) fn(evt);
      return true;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844, x: 0, y: 0, toJSON: () => ({}) };
    },
  } as unknown as HTMLElement;
}

function makePointerEvent(
  type: string,
  opts: { pointerId: number; clientX: number; clientY: number; pointerType?: string; button?: number },
): PointerEvent {
  const evt = new Event(type) as unknown as Record<string, unknown>;
  evt.pointerId = opts.pointerId;
  evt.clientX = opts.clientX;
  evt.clientY = opts.clientY;
  evt.pointerType = opts.pointerType ?? "touch";
  evt.button = opts.button ?? 0;
  return evt as unknown as PointerEvent;
}

describe("Mobile Audit Fixes (MOB-01..MOB-15)", () => {
  beforeEach(() => {
    useBuildModeStore.getState().selectCatalogById("tool_select");
    useBuildModeStore.getState().setFreePlacementEnabled(false);
    useBuildModeStore.getState().setMultiPlaceEnabled(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("MOB-01: 1-finger touch orbits 360°, cameraLocked prevents orbit during drag, and pointercancel clears activeTouches", () => {
    const dom = makeMockCanvas();
    const ctrl = new BuildCameraController(dom, 390 / 844);
    const startSnap = ctrl.getSnapshot();

    // 1-finger touch drag -> orbits yaw & pitch without moving target
    dom.dispatchEvent(makePointerEvent("pointerdown", { pointerId: 1, clientX: 180, clientY: 400 }));
    window.dispatchEvent(makePointerEvent("pointermove", { pointerId: 1, clientX: 260, clientY: 440 }));

    const orbited = ctrl.getSnapshot();
    expect(orbited.yaw).not.toBeCloseTo(startSnap.yaw, 3);
    expect(orbited.pitch).not.toBeCloseTo(startSnap.pitch, 3);
    expect(orbited.target[0]).toBeCloseTo(startSnap.target[0], 5);
    expect(orbited.target[2]).toBeCloseTo(startSnap.target[2], 5);

    // Locked camera ignores 1-finger orbit while dragging an object/gizmo
    ctrl.setCameraLocked(true);
    window.dispatchEvent(makePointerEvent("pointermove", { pointerId: 1, clientX: 320, clientY: 480 }));
    expect(ctrl.getSnapshot().yaw).toBeCloseTo(orbited.yaw, 5);

    // System pointercancel clears activeTouches and unlocks camera
    window.dispatchEvent(makePointerEvent("pointercancel", { pointerId: 1, clientX: 320, clientY: 480 }));
    expect(ctrl.activeTouchCount).toBe(0);

    ctrl.dispose();
  });

  it("MOB-01: 2-finger pinch zooms distance without twisting yaw or tilting pitch", () => {
    const dom = makeMockCanvas();
    const ctrl = new BuildCameraController(dom, 390 / 844);
    const start = ctrl.getSnapshot();

    dom.dispatchEvent(makePointerEvent("pointerdown", { pointerId: 1, clientX: 140, clientY: 400 }));
    dom.dispatchEvent(makePointerEvent("pointerdown", { pointerId: 2, clientX: 240, clientY: 400 }));

    // Pinch outwards with slight vertical angle jitter
    window.dispatchEvent(makePointerEvent("pointermove", { pointerId: 1, clientX: 90, clientY: 390 }));
    window.dispatchEvent(makePointerEvent("pointermove", { pointerId: 2, clientX: 290, clientY: 420 }));

    const afterPinch = ctrl.getSnapshot();
    expect(afterPinch.distance).toBeLessThan(start.distance);
    expect(afterPinch.yaw).toBeCloseTo(start.yaw, 5);
    expect(afterPinch.pitch).toBeCloseTo(start.pitch, 5);

    window.dispatchEvent(makePointerEvent("pointerup", { pointerId: 1, clientX: 90, clientY: 390 }));
    window.dispatchEvent(makePointerEvent("pointerup", { pointerId: 2, clientX: 290, clientY: 420 }));
    ctrl.dispose();
  });

  it("MOB-03 & MOB-04: activates 2-step placement stage for point items and exposes Shift/Alt store toggles", () => {
    const bm = useBuildModeStore.getState();
    bm.selectCatalogById("furn_sofa_l");
    expect(useBuildModeStore.getState().mobilePlacementActive).toBe(true);

    bm.toggleFreePlacement();
    bm.toggleMultiPlace();
    expect(useBuildModeStore.getState().freePlacementEnabled).toBe(true);
    expect(useBuildModeStore.getState().multiPlaceEnabled).toBe(true);

    bm.selectCatalogById("tool_wall_straight");
    expect(useBuildModeStore.getState().mobilePlacementActive).toBe(false);
    expect(useBuildModeStore.getState().mobileDrawMode).toBe("draw");

    bm.selectCatalogById("tool_select");
    expect(useBuildModeStore.getState().mobilePlacementActive).toBe(false);
  });

  it("MOB-15: shareOrDownloadBlob uses Web Share API when supported and handles AbortError", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: canShareMock, configurable: true });

    const blob = new Blob(["pdf-content"], { type: "application/pdf" });
    const resShared = await shareOrDownloadBlob(blob, "test.pdf", "Test PDF");
    expect(resShared).toBe("shared");
    expect(shareMock).toHaveBeenCalledTimes(1);

    shareMock.mockRejectedValueOnce(new DOMException("User cancelled", "AbortError"));
    const resCancelled = await shareOrDownloadBlob(blob, "test.pdf", "Test PDF");
    expect(resCancelled).toBe("cancelled");
  });
});
