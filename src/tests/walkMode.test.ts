import { describe, expect, it } from "vitest";
import { createDefaultProject } from "@/lib/model/defaultProject";
import { buildWalkCollisionWorld, WalkController, WALK_CONFIG } from "@/features/walkMode";

function cloneDefault() {
  return structuredClone(createDefaultProject());
}

describe("Realistic Walk Mode — Data-Derived Collision & Physics", () => {
  it("passes cleanly through open doorways while blocking closed doors & windows", () => {
    const project = cloneDefault();
    const ctrl = new WalkController(project);

    // Position on Teras directly facing open Pintu Utama (x=1.58, z=4.0, width=0.95, openPct=45)
    ctrl.setPositionDirect(1.58, ctrl.world.terasY, 3.45, 0);
    for (let i = 0; i < 65; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: 0 });
    }
    expect(ctrl.z).toBeGreaterThan(4.4);
    expect(ctrl.y).toBeCloseTo(ctrl.world.lt1Y, 1);

    // Close Pintu Utama completely and rebuild collision world -> blocks entry!
    const frontWall = project.levels[0]!.walls.find((w) => w.id === "w1-depan-tamu")!;
    const mainDoor = frontWall.openings.find((o) => o.id === "op1-p-utama")!;
    mainDoor.openPct = 0;
    ctrl.rebuildColliders(project);
    ctrl.setPositionDirect(1.58, ctrl.world.terasY, 3.45, 0);
    for (let i = 0; i < 65; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: 0 });
    }
    expect(ctrl.z).toBeLessThan(3.95);
    expect(ctrl.collidedLastTick).toBe(true);

    // Walk directly at Ruang Tamu Window (x=0.62, z=4.0) -> strictly blocked!
    ctrl.setPositionDirect(0.62, ctrl.world.terasY, 3.45, 0);
    for (let i = 0; i < 60; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: 0 });
    }
    expect(ctrl.z).toBeLessThan(3.92);
  });

  it("blocks sofa furniture & slides smoothly along diagonal/oblique walls without corner snagging", () => {
    const project = cloneDefault();
    const ctrl = new WalkController(project);

    // Try walking straight into Sofa Ruang Tamu (x=0.72, z=5.85) from South
    ctrl.setPositionDirect(0.72, ctrl.world.lt1Y, 4.75, 0);
    for (let i = 0; i < 55; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: 0 });
    }
    expect(ctrl.z).toBeLessThan(5.35);

    // Slide obliquely (+X/+Z) against partition w1-sekat-tamu (x=2.25) starting near sofa/table edge -> glides smoothly past table & wall
    ctrl.setPositionDirect(1.9, ctrl.world.lt1Y, 4.7, Math.PI / 4);
    for (let i = 0; i < 65; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: Math.PI / 4 });
    }
    expect(ctrl.x).toBeLessThan(2.25);
    expect(ctrl.z).toBeGreaterThan(5.65); // slid cleanly forward along partition past table gap

    // Add a custom 45-degree diagonal wall and confirm sliding along diagonal normal
    project.levels[0]!.walls.push({
      id: "w-diag-test",
      name: "Dinding Diagonal Uji",
      start: { x: 1.5, z: 9.8 },
      end: { x: 3.5, z: 11.8 },
      thickness: 0.1,
      height: 3.0,
      materialId: "wall_int_ivory",
      exterior: false,
      openings: [],
    });
    ctrl.rebuildColliders(project);
    ctrl.setPositionDirect(2.9, ctrl.world.lt1Y, 10.2, Math.PI * 1.15);
    const zStart = ctrl.z;
    for (let i = 0; i < 45; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: Math.PI * 1.15 });
    }
    expect(ctrl.z).not.toBeCloseTo(zStart, 2);
  });

  it("prevents tunneling through thin walls even at max sprint speed with coarse frame deltas", () => {
    const project = cloneDefault();
    const ctrl = new WalkController(project);

    // Sprint straight East into 7.5 cm interior wall w1-sekat-tamu (x=2.25) with 95ms frame dt spikes
    ctrl.setPositionDirect(1.45, ctrl.world.lt1Y, 6.2, Math.PI / 2);
    for (let i = 0; i < 60; i++) {
      ctrl.step(0.095, { forward: 1, strafe: 0, sprint: true, yaw: Math.PI / 2 });
    }
    expect(ctrl.x).toBeLessThan(2.2);
  });

  it("climbs stair LT1 -> LT2 cleanly, respects balcony/void anti-fall rails, and ignores stair above Powder Room", () => {
    const project = cloneDefault();
    const ctrl = new WalkController(project);

    // Standing inside LT1 under stairs near x=0.72, z=8.8 -> stays on LT1 ground (0.50m)
    ctrl.setPositionDirect(0.72, ctrl.world.lt1Y, 8.8, 0);
    ctrl.step(WALK_CONFIG.fixedDt, { forward: 0, strafe: 0, sprint: false, yaw: 0 });
    expect(ctrl.y).toBeCloseTo(ctrl.world.lt1Y, 2);
    expect(ctrl.currentLevel).toBe(0);

    // Approach stair bottom at (0.72, 12.6) walking North (yaw = Math.PI -> -Z)
    ctrl.setPositionDirect(0.72, ctrl.world.lt1Y, 12.6, Math.PI);
    let sawMidStair = false;
    for (let i = 0; i < 160; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: Math.PI });
      if (ctrl.onStairId === "st-1" && ctrl.y > ctrl.world.lt1Y + 0.8 && ctrl.y < ctrl.world.lt2Y - 0.8) {
        sawMidStair = true;
      }
    }
    expect(sawMidStair).toBe(true);
    expect(ctrl.z).toBeLessThan(7.4);
    expect(ctrl.y).toBeCloseTo(ctrl.world.lt2Y, 1);
    expect(ctrl.currentLevel).toBe(1);

    // Walk onto LT2 Ruang Santai -> Balkon Depan (through op2-p-balkon x=0.90, z=4.0), stopped at balcony rail z~3.04
    ctrl.setPositionDirect(0.9, ctrl.world.lt2Y, 4.6, Math.PI);
    for (let i = 0; i < 80; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: Math.PI });
    }
    expect(ctrl.z).toBeGreaterThan(3.08);
    expect(ctrl.z).toBeLessThan(3.85);
    expect(ctrl.y).toBeCloseTo(ctrl.world.lt2Y, 1);

    // On LT2 East of stairwell void (x=1.8, z=10.0), trying to walk West into open stair hole is blocked by railing/void!
    ctrl.setPositionDirect(1.85, ctrl.world.lt2Y, 10.0, -Math.PI / 2);
    for (let i = 0; i < 50; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: -Math.PI / 2 });
    }
    expect(ctrl.x).toBeGreaterThan(1.42);
    expect(ctrl.y).toBeCloseTo(ctrl.world.lt2Y, 1);
  });

  it("raycasts 3rd-person spring-arm against walls and dynamically updates colliders after Build edits", () => {
    const project = cloneDefault();
    const world = buildWalkCollisionWorld(project);
    expect(world.colliders.length).toBeGreaterThan(20);
    expect(world.doors.length).toBeGreaterThanOrEqual(8);

    const ctrl = new WalkController(project);
    ctrl.setPositionDirect(1.5, ctrl.world.lt1Y, 4.5, 0);

    // Camera arm aiming through open doorway stays unclipped, while shooting through solid front wall clamps cleanly
    const doorRay = ctrl.raycastCameraSpringArm(1.58, ctrl.world.lt1Y + 1.44, 4.5, 1.58, ctrl.world.lt1Y + 1.5, 2.5);
    expect(doorRay.clipped).toBe(false);

    const wallRay = ctrl.raycastCameraSpringArm(0.55, ctrl.world.lt1Y + 1.44, 4.6, 0.55, ctrl.world.lt1Y + 1.5, 2.0);
    expect(wallRay.clipped).toBe(true);
    expect(wallRay.z).toBeGreaterThan(3.9);

    // Dynamic edit: add blocking partition inside Ruang Keluarga at z = 10.5 -> blocks; remove -> passes
    project.levels[0]!.walls.push({
      id: "w-live-test",
      name: "Sekat Baru Live",
      start: { x: 1.5, z: 10.5 },
      end: { x: 4.9, z: 10.5 },
      thickness: 0.1,
      height: 3.0,
      materialId: "wall_int_ivory",
      exterior: false,
      openings: [],
    });
    ctrl.rebuildColliders(project);
    ctrl.setPositionDirect(2.8, ctrl.world.lt1Y, 9.8, 0);
    for (let i = 0; i < 45; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: 0 });
    }
    expect(ctrl.z).toBeLessThan(10.35);

    // Remove the live wall & verify passage opens cleanly
    project.levels[0]!.walls = project.levels[0]!.walls.filter((w) => w.id !== "w-live-test");
    ctrl.rebuildColliders(project);
    for (let i = 0; i < 45; i++) {
      ctrl.step(WALK_CONFIG.fixedDt, { forward: 1, strafe: 0, sprint: false, yaw: 0 });
    }
    expect(ctrl.z).toBeGreaterThan(10.8);
  });

  it("pushes capsule cleanly out of obstacle on rebuild or spawn overlap", () => {
    const project = cloneDefault();
    const ctrl = new WalkController(project);
    // Force inside sofa core at (0.72, 5.85) -> push-out validates cleanly
    ctrl.setPositionDirect(0.72, ctrl.world.lt1Y, 5.85, 0);
    expect(ctrl.wouldCollideAt(ctrl.x, ctrl.y, ctrl.z)).toBe(false);
  });
});
