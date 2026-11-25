/**
 * Entry point stub for the new physics/collision-driven Walk Mode module (Phase 4).
 * Uses a single capsule config source and derives all collision from build data.
 */

export interface WalkModeModuleStub {
  status: "stub";
  readyPhase: number;
}

export function getWalkModeStubState(): WalkModeModuleStub {
  return {
    status: "stub",
    readyPhase: 0,
  };
}
