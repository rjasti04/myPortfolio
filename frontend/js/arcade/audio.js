/**
 * A tiny Web Audio synth - the arcade ships no audio files.
 *
 * Everything is generated from oscillators, so the page stays inside the
 * "no third-party origin, no extra asset" rule the rest of the site follows
 * and the sound costs nothing to download.
 *
 * The AudioContext is created lazily on the first sound rather than at import
 * time. Browsers start a context in the `suspended` state unless it was
 * created inside a user gesture, and a context built during module evaluation
 * is exactly that case - it would exist, accept `start()` calls, and stay
 * silent. Deferring to the first note means the context is always born inside
 * the tap or keypress that begins a game.
 */

import { readMuted, writeMuted } from "./storage.js";

/** Semitone offsets of a major pentatonic scale, the interval set that cannot sound wrong. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export function createAudio() {
  let context = null;
  let muted = readMuted();

  function ensureContext() {
    if (muted) return null;
    if (context) {
      // Autoplay policy can suspend a context that was fine a moment ago -
      // most commonly when the tab was backgrounded mid-run.
      if (context.state === "suspended") context.resume().catch(() => {});
      return context;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
    return context;
  }

  /**
   * One enveloped tone. The gain ramp matters more than the waveform: a bare
   * oscillator switched on and off clicks audibly at both ends, and six games
   * firing blips would turn that into a rattle.
   */
  function tone(
    hz,
    { duration = 0.16, type = "square", gain = 0.06, delay = 0 } = {},
  ) {
    const ctx = ensureContext();
    if (!ctx) return;

    const startAt = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(hz, startAt);

    amp.gain.setValueAtTime(0, startAt);
    amp.gain.linearRampToValueAtTime(gain, startAt + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(amp).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  return {
    get muted() {
      return muted;
    },

    /** Flip the sound preference and persist it. Returns the new muted state. */
    toggleMuted() {
      muted = !muted;
      writeMuted(muted);
      if (muted && context) context.suspend().catch(() => {});
      return muted;
    },

    /** A short confirmation - a piece locking, a tile merging. */
    blip(semitone = 0) {
      tone(midiToHz(69 + semitone), { duration: 0.1, gain: 0.05 });
    },

    /**
     * The reward for a perfect Stack placement. `step` is the current streak,
     * so consecutive perfects walk up the pentatonic scale and the run builds
     * an audible chord progression - the behaviour the game is known for.
     */
    perfect(step = 0) {
      const root = 60 + PENTATONIC[Math.min(step, PENTATONIC.length - 1)];
      tone(midiToHz(root), { duration: 0.22, type: "triangle", gain: 0.07 });
      tone(midiToHz(root + 7), {
        duration: 0.26,
        type: "triangle",
        gain: 0.045,
        delay: 0.045,
      });
    },

    /** Cleared lines, merged milestones - anything worth a flourish. */
    fanfare() {
      [0, 4, 7, 12].forEach((offset, i) => {
        tone(midiToHz(72 + offset), {
          duration: 0.2,
          type: "triangle",
          gain: 0.05,
          delay: i * 0.06,
        });
      });
    },

    /** End of run. Descending, so it reads as a loss without a harsh buzz. */
    gameOver() {
      [12, 7, 3, 0].forEach((offset, i) => {
        tone(midiToHz(60 + offset), {
          duration: 0.28,
          type: "sawtooth",
          gain: 0.045,
          delay: i * 0.1,
        });
      });
    },
  };
}
