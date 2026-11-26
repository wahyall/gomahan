import { describe, expect, it } from "vitest";
import { AdaptiveRenderGovernor } from "@/lib/scene/adaptiveQuality";

/**
 * The governor exists to kill the tier ping-pong that black-flickered the
 * viewport: a GPU running ~28fps on Tinggi and ~60fps on Sedang used to bounce
 * between tiers every ~2s, and each switch reset canvas.width (drawing-buffer
 * wipe). These tests pin the hysteresis contract.
 */
describe("AdaptiveRenderGovernor hysteresis", () => {
  const opts = {
    lowFps: 34,
    highFps: 54,
    downWindows: 2,
    upWindows: 3,
    downCooldownMs: 8_000,
    upCooldownMs: 30_000,
  };

  it("reproduces the old oscillation pattern without ever switching tiers", () => {
    const g = new AdaptiveRenderGovernor(opts);
    // Simulate the reported machine: 24-frame windows alternating 28fps (high tier)
    // and 60fps (medium tier) every ~2s for two minutes.
    let switches = 0;
    let now = 0;
    for (let i = 0; i < 60; i++) {
      now += 2_000;
      const avg = i % 2 === 0 ? 28 : 60;
      if (g.sample(avg, now) !== null) switches += 1;
    }
    // Old code switched ~60 times; the governor must settle to (almost) none:
    // first low windows are before any cooldown baseline, so at most a single
    // early downgrade can ever fire — never an oscillation.
    expect(switches).toBeLessThanOrEqual(1);
  });

  it("requires downWindows consecutive slow windows before downgrading", () => {
    const g = new AdaptiveRenderGovernor(opts);
    expect(g.sample(28, 1_000)).toBeNull(); // window 1 of 2
    expect(g.sample(28, 3_000)).toBe("downgrade"); // window 2 of 2
  });

  it("resets the slow streak when a window lands in the middle band", () => {
    const g = new AdaptiveRenderGovernor(opts);
    expect(g.sample(28, 1_000)).toBeNull();
    expect(g.sample(45, 3_000)).toBeNull(); // middle band clears the streak
    expect(g.sample(28, 5_000)).toBeNull(); // streak restarts from 1
    expect(g.sample(28, 7_000)).toBe("downgrade");
  });

  it("requires upWindows consecutive fast windows before upgrading", () => {
    const g = new AdaptiveRenderGovernor(opts);
    expect(g.sample(60, 1_000)).toBeNull();
    expect(g.sample(60, 3_000)).toBeNull();
    expect(g.sample(60, 5_000)).toBe("upgrade");
  });

  it("holds the upgrade behind its longer cooldown", () => {
    const g = new AdaptiveRenderGovernor(opts);
    expect(g.sample(28, 1_000)).toBeNull();
    expect(g.sample(28, 3_000)).toBe("downgrade"); // lastSwitch = 3000
    // Three fast windows arrive but only 8s after the switch — under the 30s bar.
    expect(g.sample(60, 11_000)).toBeNull();
    expect(g.sample(60, 13_000)).toBeNull();
    expect(g.sample(60, 15_000)).toBeNull();
    // Streak still accumulating: the next fast window after the cooldown passes.
    expect(g.sample(60, 33_500)).toBe("upgrade");
  });

  it("keeps a downgrade behind its cooldown too", () => {
    const g = new AdaptiveRenderGovernor(opts);
    expect(g.sample(60, 1_000)).toBeNull();
    expect(g.sample(60, 3_000)).toBeNull();
    expect(g.sample(60, 5_000)).toBe("upgrade"); // lastSwitch = 5000
    expect(g.sample(28, 6_000)).toBeNull(); // streak 1
    expect(g.sample(28, 8_000)).toBeNull(); // streak 2 but only 3s since switch (< 8s)
    expect(g.sample(28, 14_000)).toBe("downgrade");
  });

  it("reset() treats the explicit user change as a fresh switch", () => {
    const g = new AdaptiveRenderGovernor(opts);
    g.reset(1_000);
    expect(g.sample(28, 2_000)).toBeNull(); // cooldown 8s from reset(1000)
    expect(g.sample(28, 9_500)).toBe("downgrade");
  });

  it("rejects inverted thresholds at construction", () => {
    expect(() => new AdaptiveRenderGovernor({ ...opts, lowFps: 60, highFps: 40 })).toThrow();
  });
});
