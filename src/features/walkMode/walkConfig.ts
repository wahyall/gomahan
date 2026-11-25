/**
 * Single Source of Truth for ALL Realistic Walk Mode parameters (physics, collision, camera, animation, SFX).
 * Adjust values here to tune capsule clearance, speed, step-up height, slope limits, or 1st/3rd person cameras.
 */
export const WALK_CONFIG = {
  // Kinematic Capsule Dimensions (meters)
  capsuleRadius: 0.22, // diameter 0.44 m — clears 0.72 m+ interior doors & narrow furniture walkways; blocks walls & < 0.45 m slits
  capsuleHeight: 1.72,
  eyeHeight: 1.56,

  // Horizontal Locomotion & Fixed-Timestep Simulation
  walkSpeed: 2.35, // m/s
  runSpeed: 4.5, // m/s when Shift held
  accel: 18.0, // m/s^2 ground acceleration
  decel: 16.5, // m/s^2 friction deceleration
  gravity: 22.0, // m/s^2 downward snap/fall gravity
  fixedDt: 1 / 60, // deterministic 60 Hz solver tick
  maxFrameDt: 0.1, // cap delta spikes on tab refocus
  maxSubstepMoveRatio: 0.65, // max distance per substep <= capsuleRadius * ratio (prevents tunneling)
  collisionSolverPasses: 4, // multi-contact relaxation passes per substep

  // Vertical Step-Up, Stair Slope & Anti-Fall Protection
  stepHeight: 0.38, // clears front curb/carport (0.20 m), teras (0.40 m from 0.20 m), & LT1 entry threshold
  maxSlopeDeg: 48, // stair slope ~36.9° passes cleanly; steeper cliffs/ramps rejected
  stairSnapMarginM: 0.32, // vertical envelope to catch stair entry cleanly at bottom/top
  stairLateralMarginM: 0.08, // gentle lateral funnel at stair mouths
  minDoorClearanceM: 0.5, // openings smaller than capsule diameter block passage
  doorOpenPassPct: 5, // openPct > threshold lets capsule pass freely; <= threshold acts as closed barrier
  doorInteractDistanceM: 1.55, // prompt distance for [E] open/close door

  // Spatial Hash Grid
  spatialCellSize: 0.5,

  // Overhead / Floor Prop Filtering
  tabletopSkipElevationM: 1.25, // ignore small lamps/bookshelves higher than waist
  flatRugMaxHeightM: 0.12, // rugs stay walkable underfoot

  // First-Person Camera
  firstPerson: {
    fov: 70,
    pitchMinDeg: -74,
    pitchMaxDeg: 74,
    lookSensitivityRadPerPx: 0.0024,
    headBobAmpY: 0.026,
    headBobAmpX: 0.014,
    headBobFreqHz: 2.2,
  },

  // Third-Person Spring-Arm Camera
  thirdPerson: {
    fov: 56,
    defaultDist: 2.65,
    minDist: 0.48,
    maxDist: 4.6,
    targetHeight: 1.44,
    pitchDefaultDeg: 14,
    pitchMinDeg: -38,
    pitchMaxDeg: 68,
    armWallPadding: 0.14,
    armSmoothSpeed: 16,
    lookSensitivityRadPerPx: 0.0028,
  },

  cameraNear: 0.08,
  cameraFar: 220,

  // Footstep Audio & Gait Cadence
  footstepIntervalWalkM: 0.76,
  footstepIntervalRunM: 0.92,
  avatarTurnSpeedRad: 12.5,

  // Outer Walkable Envelope (covers 5x17 m house lot + front road curb)
  lotWalkBounds: {
    minX: -2.4,
    maxX: 7.4,
    minZ: -4.8,
    maxZ: 17.2,
  },

  // Default Safe Spawn (just inside open Pintu Utama facing down Ruang Tamu interior vista)
  defaultSpawn: {
    x: 1.63,
    z: 4.35,
    yaw: 0, // facing +Z through Ruang Tamu
  },
} as const;

export type WalkCameraMode = "first_person" | "third_person";
