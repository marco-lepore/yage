/**
 * Voice-over as a registered {@link DialogueExtraChannel}. It plays a line's
 * `voice` clip and gates auto-advance until the clip ends — so a line
 * auto-advances at `max(clipEnd, revealEnd)` with no duration plumbing, and a
 * short line never moves on while its long clip is still talking.
 *
 * The addon owns **no audio**: the host supplies `play` (wired over
 * `@yagejs/audio` in the game), which starts a clip and returns a handle. This
 * module imports neither audio nor a renderer, so it stays on the pixi-free root
 * entry alongside the rest of the headless model.
 */

import type { DialogueExtraChannel } from "./types.js";
import type { PresentedLine } from "../session.js";

/**
 * The host-owned playback handle returned by {@link VoiceChannelOptions.play}.
 * `pause` / `resume` are optional — a host that can't pause a clip degrades to a
 * no-op (the conversation still pauses; the clip just keeps playing).
 */
export interface VoiceHandle {
  /** Stop the clip immediately and release it. */
  stop(): void;
  /** Pause playback (optional). */
  pause?(): void;
  /** Resume playback (optional). */
  resume?(): void;
}

export interface VoiceChannelOptions {
  /**
   * Start the clip for `id` (the line's `voice`) and return a {@link VoiceHandle}.
   * Call `onEnded` when the clip finishes **naturally** — that releases the
   * auto-advance gate. The addon imports no audio; a YAGE host wires this over
   * `@yagejs/audio`, e.g.
   *
   *   play: (id, onEnded) => {
   *     const sound = audio.play(id, { onEnd: onEnded });
   *     return { stop: () => sound.stop(), pause: () => sound.pause(), resume: () => sound.resume() };
   *   }
   */
  play(id: string, onEnded: () => void): VoiceHandle;
  /**
   * What a skip does to a still-playing clip. `"cut"` (default) stops it and
   * releases the gate the moment the player completes the typewriter or
   * fast-forwards the section; `"ring"` lets the clip play out — auto-advance
   * keeps waiting for `onEnded`, a manual advance still works (it is never gated).
   */
  onSkip?: "cut" | "ring";
  /**
   * Pause the clip when the conversation pauses ({@link DialogueSession.setPaused}).
   * Default `true` — a paused conversation stops talking, the least-surprising
   * default now that the channel knows a clip is mid-flight. Set `false` to let a
   * clip play through a pause. `pause` / `resume` on the handle are optional, so
   * this is a no-op when the host omits them.
   */
  pauseWithConversation?: boolean;
  /**
   * Safety budget (seconds). If a clip's `onEnded` never arrives within this
   * many seconds of starting, the gate is force-released and {@link onError} is
   * called — so a wedged host (a clip that silently fails to report its end)
   * can't soft-lock auto-advance. Omit (or `0`) to disable the cap.
   */
  liveness?: number;
  /** Diagnostics sink for the liveness cap — route it to the engine logger, the
   *  same seam as the session's `onError`. */
  onError?: (message: string, error: unknown) => void;
}

/**
 * Build a voice-over {@link DialogueExtraChannel}. Register it on a controller:
 *
 *   const voice = createVoiceChannel({ play: (id, onEnded) => host.playClip(id, onEnded) });
 *   controller.addChannel(voice);
 *
 * Hardened against two real failure modes:
 *  - **generation guard** — a late `onEnded` from a clip that has since been
 *    superseded (the next line started) can't ungate the new line.
 *  - **liveness cap** — an optional budget force-releases the gate if a clip
 *    never reports its end, so the conversation can't soft-lock.
 *
 * On a mid-line save/restore the host re-presents the current line, so `present`
 * fires again here — it stops any active clip first, so a restore restarts the
 * line's clip cleanly (the restore-safety property).
 */
export function createVoiceChannel(opts: VoiceChannelOptions): DialogueExtraChannel {
  const { play, onSkip = "cut", liveness, onError } = opts;
  const pauseClip = opts.pauseWithConversation ?? true;

  let active: VoiceHandle | undefined;
  // `done` = the gate is satisfied (no clip in flight). Starts satisfied so a
  // line without `voice` never gates auto-advance.
  let done = true;
  // Bumped on every (re)present; a clip's `onEnded` captures the token at start
  // and no-ops if it no longer matches — a superseded clip can't ungate the line
  // that replaced it.
  let startToken = 0;
  // Seconds the current clip has been playing (liveness cap only). Frozen while
  // paused automatically: the session fans `update(dt)` only when not paused.
  let elapsed = 0;

  const stop = (): void => {
    active?.stop();
    active = undefined;
    done = true;
  };

  return {
    present(line: PresentedLine): void {
      active?.stop();
      active = undefined;
      startToken++;
      elapsed = 0;
      const id = line.voice;
      if (id === undefined) {
        done = true; // no clip → nothing to wait for
        return;
      }
      done = false;
      const token = startToken;
      try {
        active = play(id, () => {
          if (token !== startToken) return; // generation guard: a superseded clip
          done = true;
          active = undefined;
        });
      } catch (error) {
        // The host's play() threw before returning a handle — no clip started, so
        // release the gate (this line can't soft-lock waiting on a clip that never
        // ran) and surface the failure (the session's present fan-out routes it to
        // onError).
        done = true;
        throw error;
      }
    },
    completeReveal(): void {
      if (onSkip === "ring") return; // let the clip ring out; the gate holds
      stop();
    },
    setPaused(paused: boolean): void {
      if (!pauseClip) return;
      if (paused) active?.pause?.();
      else active?.resume?.();
    },
    update(dt: number): void {
      // `done` already covers every no-clip case (voiceless line, natural end,
      // clear, a throwing play()); only an in-flight clip (done=false) ticks the
      // budget. An `active === undefined` guard here would wrongly freeze the
      // timer if play() ever left `active` unset.
      if (done || !liveness) return;
      elapsed += dt;
      if (elapsed >= liveness) {
        // The host never reported the clip's end — release the gate so
        // auto-advance can't soft-lock. Leave the (wedged) handle in place: a
        // later present()/clear() still stops it, and its late onEnded is
        // token-guarded.
        done = true;
        onError?.(
          `voice clip exceeded the ${liveness}s liveness budget without ` +
            `reporting its end; releasing the auto-advance gate`,
          new Error("voice clip liveness cap"),
        );
      }
    },
    clear(): void {
      stop();
    },
    dispose(): void {
      stop();
    },
    isRevealComplete(): boolean {
      return done;
    },
  };
}
