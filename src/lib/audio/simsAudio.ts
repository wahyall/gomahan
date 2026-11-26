/**
 * Procedural Web Audio SFX helper (no external audio downloads required).
 * Follows `build-game-audio-feedback` skill: unlocks on user gesture, respects mute,
 * caps overlapping voices, and disconnects completed nodes cleanly.
 */

type SoundCue = "select" | "place" | "rotate" | "paint" | "demolish" | "quest" | "warning";
export type WalkSurfaceMaterial = "tile" | "wood" | "grass" | "stone";

const SOUND_PREF_KEY = "rumah_studio_sound_enabled";

function readInitialSoundPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

class SimsAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled = readInitialSoundPref();
  private lastPlayedAt = 0;
  private lastFootstepAt = 0;
  private noiseBuffer: AudioBuffer | null = null;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SOUND_PREF_KEY, enabled ? "true" : "false");
      } catch {
        // Ignore storage errors in private mode
      }
    }
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

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 6);
    }
    this.noiseBuffer = buf;
    return buf;
  }

  public playFootstep(surface: WalkSurfaceMaterial, sprint: boolean): void {
    const nowMs = performance.now();
    if (nowMs - this.lastFootstepAt < (sprint ? 160 : 230)) return;
    this.lastFootstepAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    const jitter = 0.94 + Math.random() * 0.12;
    let centerFreq = 950;
    let q = 1.6;
    let level = sprint ? 0.08 : 0.055;
    let bodyFreq = 120;

    if (surface === "wood") {
      centerFreq = 420 * jitter;
      q = 2.4;
      bodyFreq = 95;
      level *= 1.08;
    } else if (surface === "grass") {
      centerFreq = 1650 * jitter;
      q = 0.7;
      bodyFreq = 65;
      level *= 0.82;
    } else if (surface === "stone") {
      centerFreq = 1320 * jitter;
      q = 1.3;
      bodyFreq = 135;
    } else {
      // tile
      centerFreq = 1120 * jitter;
      q = 2.1;
      bodyFreq = 155;
    }

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(centerFreq, t);
    filter.Q.setValueAtTime(q, t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.085);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };

    // Subtle low thud on wood/tile/stone
    if (surface !== "grass") {
      const osc = ctx.createOscillator();
      const thudGain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(bodyFreq * jitter, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.05);
      thudGain.gain.setValueAtTime(0.0001, t);
      thudGain.gain.linearRampToValueAtTime(level * 0.55, t + 0.005);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      osc.connect(thudGain);
      thudGain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.065);
      osc.onended = () => {
        osc.disconnect();
        thudGain.disconnect();
      };
    }
  }

  public playDoorToggle(open: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(open ? 190 : 280, t);
    osc.frequency.exponentialRampToValueAtTime(open ? 310 : 120, t + 0.1);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.065, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}

export const simsAudio = new SimsAudioEngine();
