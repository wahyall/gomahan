/**
 * Entry point stub for the new data-driven Build Mode engine (Phase 1 -> Phase 3).
 * Separated cleanly from Three.js rendering and from Walk Mode.
 */

export const BUILD_MODE_FORMAT_VERSION = 2 as const;

export interface BuildModeModuleStub {
  status: "stub";
  readyPhase: number;
  version: typeof BUILD_MODE_FORMAT_VERSION;
}

export function getBuildModeStubState(): BuildModeModuleStub {
  return {
    status: "stub",
    readyPhase: 0,
    version: BUILD_MODE_FORMAT_VERSION,
  };
}
