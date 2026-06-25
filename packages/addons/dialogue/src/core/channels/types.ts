/**
 * Extensible presentation channels — the open-ended companion to the built-in
 * typed trio (text / choices / avatar / chrome). A host *registers* one of these
 * on a running conversation to add behaviour the addon doesn't own (voice-over,
 * a shop reacting to a `buy` command, a camera shake, a history recorder).
 *
 * Pixi-free, like the rest of `core/`: a channel that needs the scene also
 * implements {@link Mountable} (re-exported from the root barrel), but this
 * interface itself imposes no engine dependency.
 */

import type { Command, CommandContext } from "../types.js";
import type { PresentedLine } from "../session.js";

/**
 * An optional-hook channel the host registers via
 * {@link DialogueController.addChannel} / {@link DialogueSession.addChannel} (or
 * the controller's `channels` ctor array). **Every method is optional** — a
 * one-method observer (a shop reacting to `command`, a history recorder reacting
 * to `revealComplete`) implements just what it needs and ignores the rest.
 *
 * The {@link DialogueSession} fans its cross-cutting stream out to every
 * registered channel at the same sites it drives the trio — `present`,
 * `command`, `clear`, `setVisible`, `setPaused`, `completeReveal`, `update` —
 * each call wrapped so a throwing channel is routed to the session's `onError`
 * and never breaks the conversation. The trio stays trusted/unwrapped.
 *
 * Coupling is deliberately one-directional: the ONLY value a channel hands back
 * is {@link isRevealComplete}, a boolean the session folds into the auto-advance
 * gate. Everything else is **consequences-out** — a channel changes game state
 * through {@link CommandContext.setVar} (write-only) and reads it back through
 * the host-held `DialogueHandle.getVars()`, never through the session.
 */
export interface DialogueExtraChannel {
  /**
   * A say line was presented — called right after the text channel's `present`
   * and before the line's `show` commands. Read `line.voice` / `line.meta`
   * here. NOT called for choice prompts (only say lines carry a voice/reveal).
   */
  present?(line: PresentedLine): void;
  /**
   * The current say line finished its typewriter reveal (right after the host's
   * `onRevealCompleted`). For a history / analytics recorder that commits a line
   * once it's fully shown. Carries the same {@link PresentedLine} as `present`.
   */
  revealComplete?(line: PresentedLine): void;
  /**
   * A non-built-in command fired — mirrors the host `onCommand`, with the same
   * exclusions (never `set`, which the runner owns; never `expression`, which
   * the avatar handles). A shop channel reacts to a `buy` command here.
   */
  command?(command: Command, ctx: CommandContext): void;
  /** The conversation cleared (a `stop()` or its natural end) — reset any
   *  per-conversation state. Distinct from {@link dispose} (final teardown). */
  clear?(): void;
  /** The whole dialogue UI was shown / hidden (the host `setHidden` lever). */
  setVisible?(visible: boolean): void;
  /** The conversation was paused / resumed — freezes player-facing time. A voice
   *  channel pauses its clip here. */
  setPaused?(paused: boolean): void;
  /** The player skipped the typewriter (advance-while-revealing) or fast-forwarded
   *  the section (skip) — cut a clip, drain a queued effect. */
  completeReveal?(): void;
  /** Per-frame tick. Already gated by the session pause (not called while
   *  paused), so a dt-driven timer freezes for free. */
  update?(dt: number): void;
  /** Final teardown — called by the {@link DialogueSession.addChannel} disposer
   *  and the controller's `onDestroy`. Release anything {@link clear} doesn't. */
  dispose?(): void;
  /**
   * Auto-advance gate. While this returns `false` the session's auto-advance
   * clock is frozen (a manual advance is **always** allowed). Omit it to never
   * gate — a pure observer. The session **arms** its clock on the TEXT reveal
   * but **counts down** only once text AND every registered gater report
   * complete, so a line auto-advances at `max(clipEnd, revealEnd)` with no
   * duration plumbing. Must be a cheap, total boolean read (never throws — it is
   * polled every frame and, unlike the fanned-out hooks, is not wrapped).
   */
  isRevealComplete?(): boolean;
}
