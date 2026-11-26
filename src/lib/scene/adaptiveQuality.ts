/**
 * Adaptive render quality governor with hysteresis.
 *
 * The naive "fps < 34 → downgrade, fps > 54 → upgrade" governor oscillates:
 * a GPU that sits between the two thresholds (e.g. 28fps on the Tinggi tier and
 * 60fps on Sedang) ping-pongs tiers every window. Every tier switch reallocates
 * render targets and reassigns `canvas.width`, which resets the drawing buffer
 * to black (HTML spec) — the user sees the viewport flicker black whenever the
 * cinematic stack is on.
 *
 * This governor requires consecutive agreeing windows plus a cooldown before
 * switching, and resets its streaks whenever fps lands in the middle band, so a
 * machine hovering between tiers settles instead of thrashing:
 *
 * - downgrade: `downWindows` consecutive windows below `lowFps` and at least
 *   `downCooldownMs` since the last switch
 * - upgrade: `upWindows` consecutive windows above `highFps` and at least
 *   `upCooldownMs` since the last switch
 */

export type GovernorDecision = "downgrade" | "upgrade" | null;

export interface GovernorOptions {
  /** Average fps at or below which a window counts as "slow". */
  readonly lowFps: number;
  /** Average fps above which a window counts as "fast". */
  readonly highFps: number;
  /** Consecutive slow windows required before a downgrade is emitted. */
  readonly downWindows: number;
  /** Consecutive fast windows required before an upgrade is emitted. */
  readonly upWindows: number;
  /** Minimum time after any switch before another downgrade may fire. */
  readonly downCooldownMs: number;
  /** Minimum time after any switch before an upgrade may fire. */
  readonly upCooldownMs: number;
}

export class AdaptiveRenderGovernor {
  private lowStreak = 0;
  private highStreak = 0;
  private lastSwitchMs = Number.NEGATIVE_INFINITY;

  private readonly opts: GovernorOptions;

  constructor(opts: GovernorOptions) {
    if (opts.lowFps >= opts.highFps) {
      throw new Error(`AdaptiveRenderGovernor: lowFps (${opts.lowFps}) must be below highFps (${opts.highFps})`);
    }
    this.opts = opts;
  }

  /**
   * Feed one averaged fps window. Returns the action to apply, or null to keep
   * the current quality. Streaks only survive while windows keep agreeing; a
   * single middle-band window resets both.
   */
  public sample(avgFps: number, nowMs: number): GovernorDecision {
    if (avgFps < this.opts.lowFps) {
      this.lowStreak += 1;
      this.highStreak = 0;
      if (this.lowStreak >= this.opts.downWindows && nowMs - this.lastSwitchMs >= this.opts.downCooldownMs) {
        this.lastSwitchMs = nowMs;
        this.lowStreak = 0;
        return "downgrade";
      }
      return null;
    }
    if (avgFps > this.opts.highFps) {
      this.highStreak += 1;
      this.lowStreak = 0;
      if (this.highStreak >= this.opts.upWindows && nowMs - this.lastSwitchMs >= this.opts.upCooldownMs) {
        this.lastSwitchMs = nowMs;
        this.highStreak = 0;
        return "upgrade";
      }
      return null;
    }
    // Middle band: neither fast nor slow — forget the streaks so a later
    // decision has to re-accumulate evidence from scratch.
    this.lowStreak = 0;
    this.highStreak = 0;
    return null;
  }

  /**
   * Forget history after an explicit user-driven quality change so the adaptive
   * logic does not immediately fight the user's choice.
   */
  public reset(nowMs: number = typeof performance !== "undefined" ? performance.now() : 0): void {
    this.lowStreak = 0;
    this.highStreak = 0;
    this.lastSwitchMs = nowMs;
  }
}
