export { WALK_CONFIG, type WalkCameraMode } from "@/features/walkMode/walkConfig";
export {
  buildWalkCollisionWorld,
  intersectRayObb3D,
  isWallOverlappingVerticalSpan,
  resolveCircleVsObb2D,
  sampleWalkSurface,
  SpatialHashGrid,
  type WalkColliderBox,
  type WalkColliderKind,
  type WalkCollisionWorld,
  type WalkDoorInteractable,
  type WalkFloorPolygon,
  type WalkStairSpan,
  type WalkSurfaceSample,
} from "@/features/walkMode/collisionBuilder";
export { WalkController, type WalkInputState, type WalkSnapshotState } from "@/features/walkMode/WalkController";
export { WalkAvatar } from "@/features/walkMode/WalkAvatar";
export { WalkDebugOverlay } from "@/features/walkMode/WalkDebugOverlay";
export { WalkScene, type WalkHudTelemetry, type WalkSceneActions } from "@/features/walkMode/WalkScene";
