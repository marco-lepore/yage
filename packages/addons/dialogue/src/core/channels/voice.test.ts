import { describe, expect, it } from "vitest";

import { createVoiceChannel, type VoiceHandle } from "./voice.js";
import type { PresentedLine } from "../session.js";

/** A minimal presented line carrying an optional voice id. */
function line(voice?: string): PresentedLine {
  return { text: { runs: [], pauses: [], length: 0 }, speed: 1, voice };
}

/** A scriptable host clip: the test captures `onEnded` to end it on demand and
 *  counts stop/pause/resume calls. */
function scriptedPlay() {
  const ends: (() => void)[] = [];
  const calls = { stop: 0, pause: 0, resume: 0, started: [] as string[] };
  const play = (id: string, onEnded: () => void): VoiceHandle => {
    calls.started.push(id);
    ends.push(onEnded);
    return {
      stop: () => {
        calls.stop++;
      },
      pause: () => {
        calls.pause++;
      },
      resume: () => {
        calls.resume++;
      },
    };
  };
  return { play, ends, calls };
}

describe("createVoiceChannel", () => {
  it("a line without a voice id never gates", () => {
    const { play } = scriptedPlay();
    const voice = createVoiceChannel({ play });
    voice.present?.(line()); // no voice
    expect(voice.isRevealComplete?.()).toBe(true);
  });

  it("gates auto-advance until the clip reports its end", () => {
    const { play, ends, calls } = scriptedPlay();
    const voice = createVoiceChannel({ play });

    voice.present?.(line("vo1"));
    expect(calls.started).toEqual(["vo1"]);
    expect(voice.isRevealComplete?.()).toBe(false); // clip in flight → gating

    ends[0]?.(); // the clip ends naturally
    expect(voice.isRevealComplete?.()).toBe(true);
  });

  it("generation guard: a late onEnded from a superseded clip can't ungate the next", () => {
    const { play, ends } = scriptedPlay();
    const voice = createVoiceChannel({ play });

    voice.present?.(line("a")); // clip A (token 1)
    voice.present?.(line("b")); // clip B supersedes A (token 2)
    expect(voice.isRevealComplete?.()).toBe(false);

    ends[0]?.(); // A's late onEnded — stale token
    expect(voice.isRevealComplete?.()).toBe(false); // B's gate still holds

    ends[1]?.(); // B ends
    expect(voice.isRevealComplete?.()).toBe(true);
  });

  it("liveness cap: a wedged clip force-releases the gate and reports once", () => {
    const errors: string[] = [];
    const voice = createVoiceChannel({
      play: () => ({ stop: () => {} }), // never calls onEnded → wedged host
      livenessMs: 500,
      onError: (message) => errors.push(message),
    });

    voice.present?.(line("a"));
    voice.update?.(400);
    expect(voice.isRevealComplete?.()).toBe(false); // under budget
    expect(errors).toHaveLength(0);

    voice.update?.(200); // 600 > 500
    expect(voice.isRevealComplete?.()).toBe(true); // gate force-released
    expect(errors).toHaveLength(1);

    voice.update?.(1000); // no re-fire once tripped
    expect(errors).toHaveLength(1);
  });

  it("a throwing play() releases the gate immediately (no soft-lock) and surfaces the error", () => {
    const voice = createVoiceChannel({
      play: () => {
        throw new Error("decode failed");
      },
    });
    // The host error surfaces (the session's present fan-out routes it to onError)…
    expect(() => voice.present?.(line("a"))).toThrow("decode failed");
    // …but the gate is released at once, not stuck waiting on a clip that never
    // started (no livenessMs needed — the throw is handled at the boundary).
    expect(voice.isRevealComplete?.()).toBe(true);
  });

  it("no liveness cap by default — a slow clip keeps gating", () => {
    const { play } = scriptedPlay();
    const voice = createVoiceChannel({ play }); // no livenessMs
    voice.present?.(line("a"));
    voice.update?.(100_000);
    expect(voice.isRevealComplete?.()).toBe(false); // still waiting on onEnded
  });

  it("completeReveal cuts the clip and releases the gate by default ('cut')", () => {
    const { play, calls } = scriptedPlay();
    const voice = createVoiceChannel({ play });
    voice.present?.(line("a"));
    voice.completeReveal?.();
    expect(calls.stop).toBe(1);
    expect(voice.isRevealComplete?.()).toBe(true);
  });

  it("onSkip:'ring' lets the clip play on after a skip; the gate holds until onEnded", () => {
    const { play, ends, calls } = scriptedPlay();
    const voice = createVoiceChannel({ play, onSkip: "ring" });
    voice.present?.(line("a"));
    voice.completeReveal?.();
    expect(calls.stop).toBe(0); // not cut
    expect(voice.isRevealComplete?.()).toBe(false); // still gating
    ends[0]?.();
    expect(voice.isRevealComplete?.()).toBe(true);
  });

  it("setPaused proxies pause/resume to the live clip by default", () => {
    const { play, calls } = scriptedPlay();
    const voice = createVoiceChannel({ play });
    voice.present?.(line("a"));
    voice.setPaused?.(true);
    voice.setPaused?.(false);
    expect(calls.pause).toBe(1);
    expect(calls.resume).toBe(1);
  });

  it("pauseWithConversation:false leaves the clip playing through a pause", () => {
    const { play, calls } = scriptedPlay();
    const voice = createVoiceChannel({ play, pauseWithConversation: false });
    voice.present?.(line("a"));
    voice.setPaused?.(true);
    expect(calls.pause).toBe(0);
  });

  it("a host without pause/resume degrades to a no-op (no throw)", () => {
    const voice = createVoiceChannel({ play: () => ({ stop: () => {} }) });
    voice.present?.(line("a"));
    expect(() => {
      voice.setPaused?.(true);
      voice.setPaused?.(false);
    }).not.toThrow();
  });

  it("clear() and dispose() stop the clip and release the gate", () => {
    const { play, calls } = scriptedPlay();
    const clearVoice = createVoiceChannel({ play });
    clearVoice.present?.(line("a"));
    clearVoice.clear?.();
    expect(calls.stop).toBe(1);
    expect(clearVoice.isRevealComplete?.()).toBe(true);

    const disposeVoice = createVoiceChannel({ play });
    disposeVoice.present?.(line("b"));
    disposeVoice.dispose?.();
    expect(calls.stop).toBe(2);
    expect(disposeVoice.isRevealComplete?.()).toBe(true);
  });

  it("present() restarts cleanly: it stops the prior clip first (restore-safety)", () => {
    const { play, calls } = scriptedPlay();
    const voice = createVoiceChannel({ play });
    voice.present?.(line("a"));
    voice.present?.(line("a")); // e.g. a mid-line restore re-presents the line
    expect(calls.stop).toBe(1); // the first clip was stopped before the restart
    expect(calls.started).toEqual(["a", "a"]);
  });
});
