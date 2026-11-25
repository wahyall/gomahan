/**
 * Procedural Web Audio SFX helper (no external audio downloads required).
 * Follows `build-game-audio-feedback` skill: unlocks on user gesture, respects mute,
 * caps overlapping voices, and disconnects completed nodes cleanly.
 */

type SoundCue = "select" | "place" | "rotate" | "paint" | "demolish" | "quest" | "warning";

class SimsAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private lastPlayedAt = 0;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  play(cue: SoundCue) {
    const nowMs = performance.now();
    if (nowMs - this.lastPlayedAt < 45) return; // cap rapid voices
    this.lastPlayedAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const playTone = (freqStart: number, freqEnd: number, dur: number, type: OscillatorType, gainVal: number, delay = 0) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t + delay);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + delay + dur);
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.linearRampToValueAtTime(gainVal, t + delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + dur + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    };

    switch (cue) {
      case "select":
        playTone(540, 720, 0.06, "sine", 0.045);
        break;
      case "place":
        playTone(260, 480, 0.08, "triangle", 0.075);
        playTone(620, 780, 0.07, "sine", 0.04, 0.045);
        break;
      case "rotate":
        playTone(420, 520, 0.045, "sine", 0.04);
        break;
      case "paint":
        playTone(460, 680, 0.09, "sine", 0.05);
        break;
      case "demolish":
        playTone(170, 65, 0.15, "sawtooth", 0.07);
        break;
      case "warning":
        playTone(320, 220, 0.14, "triangle", 0.07);
        break;
      case "quest":
        playTone(523.25, 523.25, 0.11, "sine", 0.055, 0);
        playTone(659.25, 659.25, 0.11, "sine", 0.055, 0.08);
        playTone(783.99, 783.99, 0.18, "sine", 0.06, 0.16);
        break;
    }
  }
}

export const simsAudio = new SimsAudioEngine();
