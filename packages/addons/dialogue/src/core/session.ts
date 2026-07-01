/**
 * DialogueSession — the headless orchestrator. It binds a {@link DialogueRunner}
 * to a set of presentation *channels* (text / choices / avatar / chrome) and
 * sequences a conversation: resolve i18n + markup, drive the typewriter, gate on
 * reveal-completion, run the auto-advance clock, and book-keep choice selection.
 *
 * It is engine-agnostic (zero `@yagejs` imports): the channels are semantic
 * interfaces — `present(line)`, `highlight(i)`, `setSpeaking(bool)` — with no
 * pixels, no input, and no world entities. A YAGE host (`DialogueController`)
 * supplies concrete channels, an `InputBinding`, and pumps `update(dt)`; a
 * headless test can supply stubs. The public API is input-agnostic
 * (`advance / moveSelection / confirm / choose / setFastForward`) so any device
 * binding maps onto it.
 *
 * Observation is via callbacks (`onLine`, `onChoiceMade`, `onCommand`, …) so a
 * host can forward to engine events or a history recorder without the Session
 * knowing about either.
 */

import { loadScript } from "./formats/canonical.js";
import type { DialogueExtraChannel } from "./channels/types.js";
import { createScope, holds } from "./expr.js";
import { IdentityI18n, type I18nAdapter } from "./i18n.js";
import { EMPTY_PARSED, parseMarkup, stripMarkup } from "./markup.js";
import type { RevealBeat } from "./LineReveal.js";
import { DialogueRunner, type ResolvedChoice } from "./runner.js";
import { MemoryVariableStorage, materialize } from "./vars.js";
import { analyzeScript, validatePlay, DialoguePlayError } from "./validate.js";
import type { VarsOf } from "./defineScript.js";
import type {
  ChoiceStep,
  Command,
  CommandContext,
  CommandHandler,
  CommandTiming,
  DialogueFunction,
  DialogueHandle,
  DialoguePlayOptions,
  DialogueScript,
  LoadedScript,
  LoadedSpeaker,
  MarkerToken,
  ParsedText,
  RunMode,
  SayStep,
  VariableStorage,
  VarMap,
} from "./types.js";

/** Stale-handle snapshot — frozen so a no-op `getVars()` can't be mutated. */
const EMPTY_VARS: Readonly<VarMap> = Object.freeze({});

// The addon's own output types declare optional fields as `T | undefined`
// (not bare `?: T`): producers can then assign possibly-undefined inputs
// directly under `exactOptionalPropertyTypes`, and consumers test values, not
// key presence — so the shapes stay spread-free to construct.

/** One previewed line: speaker name + plain (markup-stripped) text. */
export interface PreviewedLine {
  readonly speaker?: string | undefined;
  readonly text: string;
}

/** Resolved speaker descriptor on a presented line (for nameplates / anchoring). */
export interface SpeakerView {
  readonly id: string;
  readonly name?: string | undefined;
  readonly color?: number | undefined;
}

/** A fully-resolved line (i18n + markup already applied) handed to presenters. */
export interface PresentedLine {
  /** Who's speaking (if anyone) — lets world presenters anchor to their actor. */
  readonly speaker?: SpeakerView | undefined;
  readonly text: ParsedText;
  /** Per-line reveal-speed multiplier (`say.speed`, default 1). */
  readonly speed: number;
  /** Opaque preset name for per-line layout/variant (presenter interprets). */
  readonly view?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /** Voice-clip id (audio handler interprets; reveal may sync to it). */
  readonly voice?: string | undefined;
}

/** One choice row, resolved to a display label. Position = array index. */
export interface PresentedChoice {
  readonly label: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /** True for a visible-but-disabled row (its condition failed and its
   *  `presentation` is `"disabled"`). Presenters render it greyed and
   *  non-selectable; the Session's nav/confirm skip it. */
  readonly disabled?: boolean | undefined;
  /** i18n-resolved reason for a {@link disabled} row, shown beside it where the
   *  layout allows (e.g. "Requires the rusty key"). */
  readonly disabledReason?: string | undefined;
}

/**
 * Body-text channel. Owns reveal timing (the Session only learns *that* a line
 * finished, via the reveal listener, never *when* a glyph appears). An
 * accessibility / no-typewriter presenter is
 * `present(){ draw(); this.revealListener?.() }`.
 */
export interface TextChannel {
  present(line: PresentedLine): void;
  /** Reveal everything immediately (skip-to-end). */
  completeReveal(): void;
  isRevealComplete(): boolean;
  isRevealing(): boolean;
  /** Hold-to-fast-forward rate flag (1 = normal). */
  setSpeedMultiplier(multiplier: number): void;
  /**
   * Show or hide the body text **without** disturbing reveal progress — a
   * cutscene can hide mid-typewriter and show again to resume mid-line. Purely
   * visual: the reveal cursor, timers, and the laid-out line are untouched.
   */
  setVisible(visible: boolean): void;
  update(dt: number): void;
  clear(): void;
  /**
   * Register the reveal-completed listener. The Session owns this seam — it
   * registers its handler once in the ctor — so a game can't clobber the wiring
   * by assigning a public field. Pass `undefined` to clear.
   */
  setRevealListener(listener: (() => void) | undefined): void;
  /**
   * Register the reveal-beat listener — per-grapheme typewriter ticks and inline
   * `[name k=v/]` markers, in char order, as the reveal cursor reaches each.
   * Session-owned like {@link setRevealListener} (registered once in the ctor);
   * pass `undefined` to clear. A no-typewriter presenter that reveals instantly
   * may omit beats; the bundled view forwards the headless {@link LineReveal}
   * clock's beats.
   */
  setBeatListener(listener: ((beat: RevealBeat) => void) | undefined): void;
}

/** Per-choice presentation context, so a choice list can route/anchor the same
 *  way lines do (box list vs a bubble over `speaker`'s actor) and optionally
 *  render the prompt itself. */
export interface ChoiceContext {
  readonly view?: string | undefined;
  readonly speaker?: SpeakerView | undefined;
  /** The (resolved + parsed) prompt, made available so a presenter can render
   *  it itself (see {@link ChoiceChannel.ownsPrompt}). Empty when no prompt. */
  readonly prompt?: ParsedText | undefined;
  /** The choice step's opaque `meta` bag, passed straight through. A custom
   *  presenter reads it to render extras the model doesn't own — e.g. the
   *  timed-choice recipe's `{ timeoutMs }` for a countdown. */
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/** Choice channel. Selection nav lives in the Session; pointer/touch commits
 *  come back through `onChoiceChosen(position)`. `context` carries the choice's
 *  view/speaker/prompt so a composite presenter can route (box vs bubble). */
export interface ChoiceChannel {
  present(choices: readonly PresentedChoice[], context?: ChoiceContext): void;
  highlight(position: number): void;
  /** Show or hide the choice list without clearing it — state-preserving,
   *  so the selection and laid-out rows survive a hide/show round-trip. */
  setVisible(visible: boolean): void;
  clear(): void;
  onChoiceChosen?: (position: number) => void;
  /**
   * If true for this `context`, the presenter draws the prompt itself (e.g. a
   * self-contained bubble panel), so the Session suppresses the chrome + body-
   * text prompt. Default false → the chrome/text show the prompt (box body).
   */
  ownsPrompt?(context?: ChoiceContext): boolean;
}

/** Avatar channel — who's talking + their expression + talk state. */
export interface AvatarChannel {
  setSpeaker(speaker: LoadedSpeaker | undefined): void;
  setExpression(expression: string | undefined): void;
  setSpeaking(speaking: boolean): void;
  /**
   * Optional per-line hook (mirrors {@link ChromeChannel.present}) so an avatar
   * can be **line-driven**: read the line's `meta` (e.g. `portrait` / `side` /
   * `presence`) to pick an image/side/presence, beyond what `setSpeaker` carries.
   * The Session calls it on each say/choice line alongside `setSpeaker`, and
   * with `undefined` when the conversation clears (stop/end). A reflowing in-box
   * avatar registers a text inset here so the body text reflows around it. Most
   * avatars (portrait, scene-figure) omit it.
   */
  present?(line: PresentedLine | undefined): void;
  /**
   * Optional inline-marker hook (sibling to {@link present} / {@link setVisible}).
   * The Session fans every `[name k=v/]` reveal marker here so an avatar can
   * interpret the ones it owns — the bundled portrait/scene presenters read
   * `[expression=…/]` and call their own `setExpression`. The Session name-matches
   * NOTHING; an avatar ignores markers it doesn't recognize. `viaSkip` markers
   * (drained by a skip) arrive here too — the avatar collapses to the last one.
   */
  marker?(marker: MarkerToken): void;
  /** Optional visibility gate — a portrait hides during a cutscene; a
   *  scene-figure avatar (a world NPC the game owns) omits it and stays put. */
  setVisible?(visible: boolean): void;
  update(dt: number): void;
}

/** Chrome channel — frame / nameplate / continue caret (everything but body
 *  text and choices). `present?` lets a chrome react to per-line variants;
 *  `present(undefined)` means "no line — clear the chrome's content". */
export interface ChromeChannel {
  /** Set the speaker name, or `undefined` for **no name** — NOT a covert
   *  hide-all; visibility is governed solely by {@link setVisible}. */
  setNameplate(name: string | undefined, color?: number): void;
  setContinueVisible(visible: boolean): void;
  /**
   * Show or hide the whole chrome — the honest visibility verb the Session
   * drives (a composite restores its active variant on show). State-preserving.
   */
  setVisible(visible: boolean): void;
  /**
   * React to a per-line variant (`meta.chrome`, `meta.position`). Called
   * **before** {@link TextChannel.present} for the same line, so a composite
   * selects its active variant and a layout owner commits the frame the text
   * then reads. `present(undefined)` means "no line — clear the chrome's content".
   */
  present?(line: PresentedLine | undefined): void;
  update(dt: number): void;
}

/**
 * The presentation channels a {@link DialogueSession} drives. Writing a custom
 * presenter (a DOM overlay, a ui-react chrome) means implementing these — so the
 * **call-order contract** the Session guarantees is documented here, on the
 * interfaces themselves:
 *
 * Per say line, the Session calls (in this order):
 *  1. `chrome.setNameplate(name)` / `chrome.setContinueVisible(false)`
 *  2. `avatar.setSpeaker` / `setExpression` / `setSpeaking`, then `avatar.present?(line)`
 *  3. `chrome.present?(line)` — **before** the text, so a composite picks the
 *     active variant first and a layout owner commits the frame the text reads
 *  4. `text.present(line)` — render + start revealing
 *  5. (each channel's `setVisible(shown)` reflects the host-hidden lever)
 *
 * Then, exactly once, when the line finishes revealing, the text channel fires
 * the listener registered via {@link TextChannel.setRevealListener} (the
 * Session owns that seam — never a public field). For an **empty** line the
 * completion fires synchronously inside `text.present`.
 *
 * Per choice the order mirrors a line (chrome/avatar/text for the optional
 * prompt) and then `choices.present(options, context)`. If a presenter
 * {@link ChoiceChannel.ownsPrompt | owns the prompt}, the Session clears the
 * chrome + body instead of step 3/4.
 *
 * `setBox`/geometry is always applied **before** `present` for that line (a
 * presenter that lays out off a region reads the committed region in `present`).
 */
export interface DialogueChannels {
  readonly text: TextChannel;
  readonly choices: ChoiceChannel;
  readonly avatar?: AvatarChannel | undefined;
  readonly chrome?: ChromeChannel | undefined;
}

export interface DialogueSessionOptions {
  readonly i18n?: I18nAdapter | undefined;
  /** Hold-to-fast-forward multiplier. Default 4. */
  readonly skipMultiplier?: number | undefined;
  /**
   * The variable storage installed for every `play()`. Persists across
   * plays. Omit for a zero-config {@link MemoryVariableStorage}; supply your own
   * or {@link compose} several to bridge game state. A per-`play()`
   * `overrides.storage` replaces it for that conversation.
   */
  readonly storage?: VariableStorage | undefined;
  /** Argument-capable read functions (`has_item("key")`) for conditions/`set`
   *  expressions. Per-`play()` `overrides.functions` merge on top. */
  readonly functions?: Readonly<Record<string, DialogueFunction>> | undefined;
  /** Command handlers (`type` → handler). Per-`play()` `overrides.commands`
   *  merge on top (call site wins). */
  readonly commands?: Readonly<Record<string, CommandHandler>> | undefined;
  /** Catch-all for command types with no explicit handler. */
  readonly fallbackCommand?: CommandHandler | undefined;
  /** Non-fatal runtime diagnostics (e.g. a `set` to a read-only `cells`
   *  accessor that was ignored). The controller routes these to the engine
   *  logger; a bare session may handle or drop them. */
  readonly onError?: ((message: string, error: unknown) => void) | undefined;
  readonly onStarted?: (e: { scriptId: string }) => void;
  /** Plain (markup-stripped) line text — for logs / a11y / history. */
  readonly onLine?: (e: { speaker?: string | undefined; text: string }) => void;
  readonly onChoiceShown?: (e: { options: readonly string[] }) => void;
  readonly onChoiceMade?: (e: { index: number; text: string }) => void;
  /**
   * Observation hook fired for every non-built-in command (`set` is runner-owned
   * and never reaches it) — the host forwards it to {@link DialogueCommandEvent}.
   * The actual *handling* (and any `blocking` await) is the binding's `commands`
   * map / `fallbackCommand`, not this; this returns nothing.
   */
  readonly onCommand?: (command: Command, ctx: CommandContext) => void;
  readonly onEnded?: (e: { scriptId: string }) => void;
  /** A line finished its typewriter reveal — the "typing finished" hook
   *  (audio blip, etc.). Plain (markup-stripped) text, like {@link onLine}. */
  readonly onRevealCompleted?: (e: { speaker?: string | undefined; text: string }) => void;
  /**
   * Per-grapheme typewriter tick — a direct CALLBACK only (NOT forwarded to an
   * entity event; it fires hundreds of times per line). `index` is the 0-based
   * grapheme index just revealed, raw (whitespace included — the host filters if
   * it only wants a blip on visible glyphs). Wire a typewriter SFX here. Not
   * fired on a skip / fast-forward (pending ticks are discarded).
   */
  readonly onRevealTick?: ((index: number) => void) | undefined;
  /**
   * An inline `[name k=v/]` marker reached its char offset during reveal — the
   * host forwards it to {@link DialogueRevealMarkerEvent}. `viaSkip` is true when
   * a skip/complete drained it (a host can suppress a loud one-shot that only
   * fired because the player skipped). The Session name-matches NO marker: the
   * avatar channel interprets `[expression=…/]` itself; every other name flows
   * opaquely to the host / registered channels.
   */
  readonly onRevealMarker?: (marker: MarkerToken, viaSkip: boolean) => void;
  /** The choice cursor moved — keyboard nav AND pointer hover both funnel here
   *  `index` is the resolved option index, `text` its plain label. */
  readonly onSelectionChanged?: (e: { index: number; text: string }) => void;
  /** The player skipped the current section — for skip-used analytics. */
  readonly onSkipUsed?: (e: { scriptId: string }) => void;
  /** A line auto-advanced via the auto-advance clock — distinct from a
   *  manual advance so a game can tell them apart. */
  readonly onAutoAdvance?: (e: { scriptId: string }) => void;
}

type Mode = "idle" | "saying" | "choosing" | "ended";

export class DialogueSession {
  private readonly i18n: I18nAdapter;
  private readonly skipMul: number;
  /** Controller-installed environment (persists across plays); per-`play()`
   *  overrides are layered on top into the resolved fields below. */
  private readonly defaultStorage: VariableStorage;
  private readonly defaultFunctions: Readonly<Record<string, DialogueFunction>>;
  private readonly defaultCommands: Readonly<Record<string, CommandHandler>>;
  private readonly defaultFallback: CommandHandler | undefined;

  // Resolved per play() (controller install + call-site overrides).
  private storage: VariableStorage | undefined;
  private functions: Readonly<Record<string, DialogueFunction>> = {};
  private commands: Readonly<Record<string, CommandHandler>> = {};
  private fallbackCommand: CommandHandler | undefined;

  // Fields use explicit `| undefined` (not `?`) so reassigning `undefined`
  // (e.g. `stop()` nulling the cursor) is legal under the repo's
  // `exactOptionalPropertyTypes`.
  private runner: DialogueRunner | undefined;
  private script: LoadedScript | undefined;
  private mode: Mode = "idle";
  private scriptId = "";

  private saying: SayStep | undefined;
  /** Countdown to the next auto-advance, in seconds (it counts down against the
   *  seconds-based `dt`). Armed from the millisecond `autoAdvanceMs` /
   *  `autoAdvanceDefault`, converted at arming. `undefined` = disarmed. */
  private autoTimer: number | undefined;
  /** Default auto-advance delay (ms) applied to lines without their own
   *  `autoAdvanceMs`. `null` = off (manual advance). Set via {@link setAutoAdvance}. */
  private autoAdvanceDefault: number | null = null;
  private resolved: readonly ResolvedChoice[] = [];
  private selected = 0;
  /** Count of in-flight blocking line-command batches (show/afterReveal/advance).
   *  Input is gated while > 0. An ownership counter (not a shared boolean) so an
   *  overlapping batch resolving — e.g. the afterReveal batch finishing while a
   *  long blocking `show` command is still awaited — can't drop a gate it
   *  doesn't own. */
  private blockedCount = 0;
  /** True between an advance request and the runner stepping off the line —
   *  guards against a second advance double-firing `advance`-timed commands. */
  private advancing = false;
  /** True once the current line's `advance`-timed commands have fired, so a
   *  second advance() while the runner is still stepping (e.g. awaiting a
   *  blocking command step) can't re-fire them against the stale line. */
  private advanceFired = false;
  /** True once the current line's `afterReveal`-timed commands have fired
   *  (normally via handleRevealComplete; skip() fires them early when the line
   *  hasn't finished revealing). */
  private afterRevealFired = false;
  /** Latched by the first confirm() until the runner produces its next state
   *  (handleSay/handleChoice/handleEnd), so mashing confirm while the runner
   *  awaits the option's blocking commands can't emit duplicate onChoiceMade
   *  events (`mode` stays "choosing" for that whole window). */
  private confirming = false;
  /** Bumped by every stop()/play(). A suspended async continuation from a prior
   *  conversation captures this and bails on resume if it changed, so it can't
   *  drive (advance / show the caret on) the runner of a *new* conversation. */
  private generation = 0;

  // ── lifecycle levers — host-level, NOT conversation state ──────────────
  /** `setHidden` — visual only; gates every channel's `setVisible`. Survives
   *  `stop()`/`play()` (a host that hides for a cutscene and forgets to unhide
   *  gets what it asked for) — so it is deliberately NOT reset by `stop()`. */
  private hidden = false;
  /** `setPaused` — freezes the update loop AND the input-agnostic API. State is
   *  left fully intact (no generation bump); also host-level, survives replays. */
  private paused = false;
  /** Whether the chrome / body text are part of the CURRENT choice's layout
   *  (false when a self-contained bubble panel owns the prompt) — remembered so
   *  {@link applyVisibility} can recompute after a hide toggle mid-choice. */
  private choiceShowsChrome = false;
  private choiceShowsBody = false;
  /** Plain (speaker, text) of the line on screen — for the reveal-completed
   *  event, which fires after `present` has discarded the resolved string. */
  private currentLine: { speaker?: string | undefined; text: string } | undefined;
  /** The full {@link PresentedLine} on screen — handed to an extra channel's
   *  `revealComplete` (the session discards the local `line` after present). */
  private currentPresented: PresentedLine | undefined;

  /** Host-registered extra channels (Voice / Shop / CameraEffects / History).
   *  The session fans its cross-cutting stream to these alongside the typed trio
   *  and folds their `isRevealComplete()` into the auto-advance gate. */
  private readonly extras: DialogueExtraChannel[] = [];

  constructor(
    private readonly channels: DialogueChannels,
    private readonly opts: DialogueSessionOptions = {},
  ) {
    this.i18n = opts.i18n ?? new IdentityI18n();
    this.skipMul = opts.skipMultiplier ?? 4;
    this.defaultStorage = opts.storage ?? new MemoryVariableStorage();
    this.defaultFunctions = opts.functions ?? {};
    this.defaultCommands = opts.commands ?? {};
    this.defaultFallback = opts.fallbackCommand;
    // register the reveal seam through a method the Session owns, so a game
    // can't silently clobber it by reassigning a public field.
    this.channels.text.setRevealListener(() => this.handleRevealComplete());
    // Same ownership for the per-line beat stream (ticks + inline markers).
    this.channels.text.setBeatListener((beat) => this.handleRevealBeat(beat));
    // Pointer/touch commit from a presenter that owns its own hit-testing.
    // Routes through confirmAt so a tap on a disabled row is refused (it would
    // otherwise commit the previously-highlighted enabled row).
    this.channels.choices.onChoiceChosen = (position) => this.confirmAt(position);
  }

  /**
   * Begin a conversation. `play(script)` is **content-only** — the storage,
   * functions, and commands are installed on the session; `overrides` layers
   * per-conversation specifics on top (a scoped `storage`, extra `functions` /
   * `commands`). Declared defaults seed into the storage **only if absent**
   * (game-linked values win); variables persist across plays. Returns a
   * generation-stamped {@link DialogueHandle} for live `setVar` / `getVars`.
   */
  play<S extends DialogueScript>(
    rawScript: S,
    overrides?: DialoguePlayOptions,
  ): DialogueHandle<VarsOf<S>> {
    // Validate up front — load + analyze + resolve env + validatePlay are all
    // synchronous and read-only w.r.t. session state. Doing them BEFORE stop()
    // makes play() atomic: an invalid script / environment throws and leaves any
    // running conversation untouched, instead of abandoning it on a play() that
    // never starts.
    const script = loadScript(rawScript);
    const analysis = analyzeScript(script);

    // Resolve the environment: controller install + call-site overrides
    // (storage replaces; functions/commands merge, call site winning).
    const storage = overrides?.storage ?? this.defaultStorage;
    const functions = { ...this.defaultFunctions, ...overrides?.functions };
    const commands = { ...this.defaultCommands, ...overrides?.commands };
    const fallbackCommand = overrides?.fallbackCommand ?? this.defaultFallback;

    // Hard error on an environment that can't satisfy the script — runs before
    // seeding so the declared-default/storage conflict check sees the host value.
    validatePlay(analysis, { storage, functions, commands, fallbackCommand });

    // Seed-if-absent: a declared default applies only when the storage
    // doesn't already hold the name — never clobber a game-linked value. Done
    // BEFORE stop() and wrapped, so a storage that can't accept the write (a pure
    // read-only `cells()` with no writable slot for the name) fails as a clean
    // `DialoguePlayError` while any running conversation is left untouched —
    // play() stays atomic. Seeds are idempotent, so a partial seed before the
    // throw is harmless on retry.
    for (const [name, value] of Object.entries(script.declare ?? {})) {
      if (storage.has(name)) continue;
      try {
        storage.set(name, value);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new DialoguePlayError(
          `cannot seed declared default "${name}": ${detail} ` +
            `(a read-only / pure cells() storage has no writable slot — ` +
            `compose it with a MemoryVariableStorage)`,
        );
      }
    }

    // Past the point of failure — commit. Abandon any in-flight conversation:
    // `stop()` bumps the generation, so a still-pending async continuation from
    // the previous line (e.g. an awaited `afterReveal`/`advance` command) bails on
    // resume instead of stepping this new runner — important when `play()` restarts
    // an ambient/eavesdrop loop while a line is mid-flight.
    this.stop();

    this.script = script;
    this.scriptId = script.id;
    this.storage = storage;
    this.functions = functions;
    this.commands = commands;
    this.fallbackCommand = fallbackCommand;

    // Stamp this runner's callbacks with the current generation. A later
    // stop()/play() bumps it, so a *prior* runner resuming an async step (e.g.
    // a blocking command awaited inside skip() or a command step) finds itself
    // stale and no-ops instead of driving handleSay/handleChoice on — and so
    // corrupting — the new conversation's session state.
    const gen = this.generation;
    const live = () => gen === this.generation;

    // The runner writes through a generation-guarded view of the storage: a
    // stale `set` / `ctx.setVar` (from an abandoned conversation's awaited
    // blocking command) no-ops instead of mutating the now-shared persistent
    // store. Reads pass straight through.
    const guarded: VariableStorage = {
      get: (name) => storage.get(name),
      set: (name, value) => {
        if (live()) storage.set(name, value);
      },
      has: (name) => storage.has(name),
      entries: () => storage.entries(),
    };

    const runner = new DialogueRunner(
      script,
      { storage: guarded, functions, onError: this.opts.onError },
      {
        onSay: (step, speaker) => {
          if (live()) this.handleSay(step, speaker);
        },
        onChoice: (step, choices, speaker) => {
          if (live()) this.handleChoice(step, choices, speaker);
        },
        onCommand: (command, ctx) =>
          live() ? this.handleCommand(command, ctx) : undefined,
        onEnd: () => {
          if (live()) this.handleEnd();
        },
      },
    );
    this.runner = runner;
    this.opts.onStarted?.({ scriptId: this.scriptId });
    runner.start();

    // Typed, generation-stamped handle: after stop()/replay it no-ops
    // (setVar via the guarded view) / returns an empty snapshot (getVars).
    return {
      setVar: (name, value) => guarded.set(name, value),
      getVars: () =>
        (gen === this.generation ? materialize(storage) : EMPTY_VARS) as Readonly<
          VarsOf<S>
        >,
    };
  }

  isActive(): boolean {
    return this.mode === "saying" || this.mode === "choosing";
  }

  isChoosing(): boolean {
    return this.mode === "choosing";
  }

  /**
   * Register an extra channel (Voice / Shop / CameraEffects / History) — the
   * open-ended companion to the built-in trio. It receives the cross-cutting
   * stream (`present` / `command` / `clear` / `setVisible` / `setPaused` /
   * `completeReveal` / `update`) and can gate auto-advance via
   * `isRevealComplete()`. Returns a disposer that unregisters **and** disposes
   * it. On register the channel catches up the current `setVisible` / `setPaused`
   * lever state ONLY — no content replay (replaying `present` would re-trigger a
   * voice clip). Safe to call mid-conversation.
   */
  addChannel(ch: DialogueExtraChannel): () => void {
    this.extras.push(ch);
    // Catch up the host-level levers so a mid-line registration matches state.
    try {
      ch.setVisible?.(!this.hidden);
    } catch (error) {
      this.opts.onError?.("dialogue: channel setVisible() failed", error);
    }
    try {
      ch.setPaused?.(this.paused);
    } catch (error) {
      this.opts.onError?.("dialogue: channel setPaused() failed", error);
    }
    // Idempotent: a second call no-ops (so a host that disposes twice can't
    // double-`dispose()` the channel — the splice already no-ops on re-call).
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const i = this.extras.indexOf(ch);
      if (i >= 0) this.extras.splice(i, 1);
      try {
        ch.dispose?.();
      } catch (error) {
        this.opts.onError?.("dialogue: channel dispose() failed", error);
      }
    };
  }

  // ── lifecycle levers ──────────────────────────────────────────────────

  /**
   * Hide or show the whole dialogue UI — purely visual, state-preserving.
   * Drives every channel's `setVisible`; the conversation keeps running
   * underneath (reveal, timers, cursor intact). Host-level and **persistent**:
   * it survives `stop()` and the next `play()`, so a cutscene that hides and
   * forgets to unhide stays hidden — call `setHidden(false)` to restore.
   */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyVisibility();
  }

  /** True while the UI is hidden via {@link setHidden}. */
  isHidden(): boolean {
    return this.hidden;
  }

  /**
   * Freeze or resume the conversation — `update()` no-ops (reveal,
   * auto-advance clock, caret blink, avatar anim all freeze since they are
   * dt-driven) and the input-agnostic API (`advance`/`confirm`/`choose`/
   * `moveSelection`/`selectAt`/`skip`) no-ops. State is left fully intact: no
   * generation bump, and `lineBlocked`/`advancing`/`autoTimer` survive. It does
   * NOT block host-driven writes (`handle.setVar` / `ctx.setVar` / storage) —
   * only player-facing time + input freeze. Host-level and persistent like hide.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    // A voice channel pauses its clip here; a CameraEffects channel freezes.
    for (const ch of this.extras) {
      try {
        ch.setPaused?.(paused);
      } catch (error) {
        this.opts.onError?.("dialogue: channel setPaused() failed", error);
      }
    }
  }

  /** True while the conversation is frozen via {@link setPaused}. */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Push the current desired visibility to every channel: a channel shows when
   * it has content for the current mode AND the host hasn't hidden the UI. The
   * single visibility authority — `setHidden` and every line/choice transition
   * route through here, so the host-hidden lever composes cleanly with per-line
   * content and a custom chrome (which may not implement the optional `present`)
   * is still reliably hidden by the explicit `setVisible(false)`.
   */
  private applyVisibility(): void {
    const shown = !this.hidden;
    const saying = this.mode === "saying";
    const choosing = this.mode === "choosing";
    this.channels.text.setVisible(shown && (saying || (choosing && this.choiceShowsBody)));
    this.channels.choices.setVisible(shown && choosing);
    this.channels.chrome?.setVisible(shown && (saying || (choosing && this.choiceShowsChrome)));
    this.channels.avatar?.setVisible?.(shown && (saying || choosing));
    // Extras track the host-hidden lever directly (they aren't mode-bound
    // content): the whole UI shown/hidden, not per-line visibility.
    for (const ch of this.extras) {
      try {
        ch.setVisible?.(shown);
      } catch (error) {
        this.opts.onError?.("dialogue: channel setVisible() failed", error);
      }
    }
  }

  /** Clear every presentation channel's content — text, choices, chrome
   *  (nameplate + caret + line), the avatar, and the registered extras. The
   *  shared teardown for {@link stop} and the ended state; it touches no session
   *  bookkeeping or visibility (the caller resets its own state, then
   *  {@link goIdle} reasserts visibility). */
  private clearAllChannels(): void {
    this.channels.text.clear();
    this.channels.choices.clear();
    this.channels.chrome?.setContinueVisible(false);
    this.channels.chrome?.setNameplate(undefined); // clear the name (content), not a hide
    this.channels.chrome?.present?.(undefined); // clear the chrome's line content
    this.channels.avatar?.setSpeaker(undefined);
    this.channels.avatar?.setSpeaking(false);
    this.channels.avatar?.present?.(undefined); // clear any line-driven avatar + its inset
    // Per-conversation reset for the extras (a voice channel stops its clip).
    // clear(), NOT dispose() — extras survive across plays; they're disposed only
    // by the addChannel disposer / controller onDestroy.
    for (const ch of this.extras) {
      try {
        ch.clear?.();
      } catch (error) {
        this.opts.onError?.("dialogue: channel clear() failed", error);
      }
    }
  }

  /** Drop to a quiescent presentation state (`mode` "idle" or "ended"): reset the
   *  per-line/choice bookkeeping, clear every channel, and reassert visibility
   *  (idle/ended → nothing shown, honestly via each channel's `setVisible`,
   *  preserving the host-hidden lever). The caller owns any further reset —
   *  {@link stop} also abandons the runner + timing latches. */
  private goIdle(mode: "idle" | "ended"): void {
    this.mode = mode;
    this.saying = undefined;
    this.resolved = [];
    this.confirming = false;
    this.currentLine = undefined;
    this.currentPresented = undefined;
    this.choiceShowsChrome = false;
    this.choiceShowsBody = false;
    this.clearAllChannels();
    this.applyVisibility();
  }

  /** Abandon the current conversation and reset to idle (clears all visuals).
   *  Useful for ambient/eavesdrop dialogue that should stop when out of range. */
  stop(): void {
    // Abandon the in-flight runner and timing latches; bumping the generation
    // makes any still-pending async continuation bail on resume.
    this.generation++;
    this.runner = undefined;
    this.autoTimer = undefined;
    this.blockedCount = 0;
    this.advancing = false;
    this.advanceFired = false;
    this.afterRevealFired = false;
    this.goIdle("idle");
  }

  update(dt: number): void {
    // Pause freezes everything dt-driven for free: bail before any channel
    // update so the typewriter, caret blink, avatar anim, and the auto-advance
    // clock all halt — and crucially WITHOUT touching lineBlocked/advancing/
    // autoTimer, so state resumes intact.
    if (this.paused) return;
    this.channels.text.update(dt);
    this.channels.chrome?.update(dt);
    this.channels.avatar?.update(dt);
    for (const ch of this.extras) {
      try {
        ch.update?.(dt);
      } catch (error) {
        this.opts.onError?.("dialogue: channel update() failed", error);
      }
    }
    if (!this.runner || this.mode !== "saying") return;
    if (this.autoTimer !== undefined && this.allRevealsComplete()) {
      this.autoTimer -= dt;
      // Consume the timer only when advance() can actually act — a blocking
      // line-command (or an in-flight advance) would silently refuse it, and
      // nothing re-arms the timer afterwards (ambient soft-lock). Leave it
      // expired (≤ 0) and retry next frame; it still fires exactly once.
      if (this.autoTimer <= 0 && !this.lineBlocked && !this.advancing) {
        this.autoTimer = undefined;
        this.opts.onAutoAdvance?.({ scriptId: this.scriptId });
        // Route through advance() (not runner.advance() directly) so auto-advance
        // fires the line's `advance`-timed commands and honours the in-flight
        // guards — exactly like a manual advance.
        this.advance();
      }
    }
  }

  /** True while any blocking line-command batch is awaited (input is gated). */
  private get lineBlocked(): boolean {
    return this.blockedCount > 0;
  }

  /**
   * The auto-advance gate: the text reveal AND every registered extra channel
   * that *gates* (implements `isRevealComplete`) report complete. The clock is
   * armed on the text reveal alone (see `handleRevealComplete`/`setAutoAdvance`)
   * but only counts down once this is true — so a voice clip outlasting the
   * typewriter holds the line for `max(clipEnd, revealEnd)` with no duration
   * plumbing. A channel without the method never gates (a pure observer).
   */
  private allRevealsComplete(): boolean {
    if (!this.channels.text.isRevealComplete()) return false;
    for (const ch of this.extras) {
      if (ch.isRevealComplete && !ch.isRevealComplete()) return false;
    }
    return true;
  }

  /**
   * The storage read view for `{token}` interpolation at *this* present-time.
   * Materialized per evaluation so an earlier command's `set` shows up on a
   * later line; already-shown lines never re-render.
   */
  private readView(): VarMap {
    return this.storage ? materialize(this.storage) : {};
  }

  // ── input-agnostic API ────────────────────────────────────────────────────

  /** Primary action. Saying → reveal-all if typing, else next line. Choosing → confirm. */
  advance(): void {
    if (this.paused) return; // frozen: input is inert
    if (this.lineBlocked || this.advancing) return; // a line-command is in flight
    if (this.mode === "saying") {
      if (this.channels.text.isRevealing()) {
        this.channels.text.completeReveal();
        // The player skipped the typewriter — let extras cut in step (a voice
        // channel stops/rings its clip per its onSkip policy).
        for (const ch of this.extras) {
          try {
            ch.completeReveal?.();
          } catch (error) {
            this.opts.onError?.("dialogue: channel completeReveal() failed", error);
          }
        }
      } else void this.advanceLine();
    } else if (this.mode === "choosing") {
      this.confirm();
    }
  }

  /** Fire any `advance`-timed line commands, then step the runner off the line.
   *  `advancing` is held for the whole turn so a second advance can't re-fire
   *  the (possibly non-blocking) `advance` commands before the runner steps. */
  private async advanceLine(): Promise<void> {
    const gen = this.generation;
    this.advancing = true;
    try {
      // Fire the line's `advance` batch at most once: the runner can still be
      // mid-step (awaiting a blocking command step) after this advance resolves,
      // with `saying` still holding the old line — a second advance() must not
      // re-fire that stale line's commands.
      if (!this.advanceFired) {
        this.advanceFired = true;
        await this.fireLineCommands("advance");
      }
      // Bail if stop()/play() swapped the conversation while we awaited — `mode`
      // can be "saying" again for a *different* runner (e.g. an ambient loop
      // restarting mid blocking-command), which would skip its first line.
      if (gen !== this.generation || this.mode !== "saying") return;
      this.runner?.advance();
    } finally {
      if (gen === this.generation) this.advancing = false;
    }
  }

  /**
   * Fast-forward the current section: run intervening commands (in skip mode)
   * without presenting, stopping at the next choice or the end. No-op unless a
   * line is showing.
   */
  skip(): void {
    if (this.paused) return; // frozen: input is inert
    if (this.mode !== "saying" || this.lineBlocked || this.advancing) return;
    this.opts.onSkipUsed?.({ scriptId: this.scriptId });
    // The player fast-forwarded the section — cut extras in step. Done here (not
    // only at the next present) so a skip landing on a choice / the end, where no
    // present supersedes the clip, still cuts a voice channel immediately.
    for (const ch of this.extras) {
      try {
        ch.completeReveal?.();
      } catch (error) {
        this.opts.onError?.("dialogue: channel completeReveal() failed", error);
      }
    }
    void this.skipLine();
  }

  /**
   * Fire the *displayed* line's not-yet-fired batches in skip mode — the runner
   * fires every skipped line's commands for world reconstruction, so dropping
   * the current line's `afterReveal`/`advance` batches would diverge from
   * normal play — then fast-forward the runner.
   */
  private async skipLine(): Promise<void> {
    const gen = this.generation;
    this.advancing = true; // gate input for the whole skip turn
    try {
      if (!this.afterRevealFired) {
        this.afterRevealFired = true;
        await this.fireLineCommands("afterReveal", "skip");
        if (gen !== this.generation || this.mode !== "saying") return;
      }
      if (!this.advanceFired) {
        this.advanceFired = true;
        await this.fireLineCommands("advance", "skip");
        if (gen !== this.generation || this.mode !== "saying") return;
      }
      await this.runner?.skip();
    } finally {
      if (gen === this.generation) this.advancing = false;
    }
  }

  /**
   * Side-effect-free lookahead: the lines a node would show along its linear
   * path — following `goto` and conditional `command` jumps using the *current*
   * variable snapshot — stopping at the first choice or the end. Runs no
   * commands and mutates nothing. For a "skip with a summary" affordance.
   */
  preview(nodeId: string, limit = 64): PreviewedLine[] {
    const script = this.script;
    const storage = this.storage;
    if (!script || !storage) return [];
    // Interpolation reads a materialized snapshot; conditions evaluate through a
    // scope (per-name reads + functions). Both off the current storage, for this
    // side-effect-free lookahead.
    const view = materialize(storage);
    const scope = createScope(storage, this.functions);
    const out: PreviewedLine[] = [];
    let node = nodeId;
    let i = 0;
    for (let guard = 0; guard < limit; guard++) {
      const step = script.nodes[node]?.steps[i];
      if (!step) break;
      if (step.kind === "say") {
        const speaker = step.speaker
          ? script.speakers?.[step.speaker]
          : undefined;
        const name = speaker
          ? this.i18n.t(speaker.nameKey, speaker.name, view)
          : undefined;
        out.push({
          speaker: name,
          text: stripMarkup(this.i18n.t(step.key, step.text, view)),
        });
        i++;
      } else if (step.kind === "command") {
        if (step.target !== undefined && holds(step.condition, scope)) {
          node = step.target;
          i = 0;
        } else {
          i++;
        }
      } else if (step.kind === "goto") {
        node = step.target;
        i = 0;
      } else {
        break; // choice or end — stop the linear preview
      }
    }
    return out;
  }

  /** Move the choice cursor by `delta`, skipping disabled rows and wrapping.
   *  No-op outside a choice, and a zero `delta` is a no-op (no cursor move, no
   *  event). A move that steps over disabled rows fires exactly one
   *  selection-changed event, for the row it lands on. */
  moveSelection(delta: number): void {
    if (this.paused) return; // frozen: input is inert
    if (this.mode !== "choosing" || this.confirming) return;
    if (this.resolved.length === 0 || delta === 0) return;
    const dir: 1 | -1 = delta < 0 ? -1 : 1;
    let pos = this.selected;
    for (let i = 0; i < Math.abs(delta); i++) {
      pos = this.nextEnabled(pos, dir);
    }
    if (pos === this.selected) return; // no enabled row to move to — no event
    this.selected = pos;
    this.channels.choices.highlight(this.selected);
    this.emitSelectionChanged();
  }

  /** Highlight a choice by absolute position (e.g. pointer hover). No wrap;
   *  a disabled row is skipped (the cursor stays put). */
  selectAt(position: number): void {
    if (this.paused) return; // frozen: input is inert
    if (this.mode !== "choosing" || this.confirming) return;
    const n = this.resolved.length;
    if (n === 0 || position < 0 || position >= n || position === this.selected)
      return;
    if (this.resolved[position]?.disabled) return; // can't highlight a disabled row
    this.selected = position;
    this.channels.choices.highlight(this.selected);
    this.emitSelectionChanged();
  }

  /** The next enabled choice position from `from` in direction `dir` (±1),
   *  wrapping. Returns `from` when no other enabled row exists (so a single
   *  enabled option among disabled ones never moves). */
  private nextEnabled(from: number, dir: 1 | -1): number {
    const n = this.resolved.length;
    let pos = from;
    for (let i = 0; i < n; i++) {
      pos = (pos + dir + n) % n;
      if (pos === from) break; // wrapped all the way around
      if (!this.resolved[pos]?.disabled) return pos;
    }
    return from;
  }

  /** Fire onSelectionChanged for the currently-highlighted choice (keyboard nav
   *  and pointer hover both land here — one canonical selection event). */
  private emitSelectionChanged(): void {
    const chosen = this.resolved[this.selected];
    if (!chosen) return;
    this.opts.onSelectionChanged?.({
      index: chosen.index,
      text: stripMarkup(
        this.i18n.t(chosen.option.key, chosen.option.text, this.readView()),
      ),
    });
  }

  /** Commit the highlighted choice. */
  confirm(): void {
    this.commit(this.selected);
  }

  /** Commit by original option index (e.g. a direct pointer hit, or the
   *  timed-choice recipe firing its default). Refuses an unknown or disabled
   *  option. */
  choose(optionIndex: number): void {
    this.commit(this.resolved.findIndex((c) => c.index === optionIndex));
  }

  /** Commit by display position (a pointer hit on a row). The position-keyed
   *  counterpart to {@link choose}; refuses an out-of-range or disabled row.
   *  Used by the pointer binding and the presenter pointer-commit seam. */
  confirmAt(position: number): void {
    this.commit(position);
  }

  /**
   * The single choice-commit authority: every commit path routes here after
   * translating its argument to a display position. It guards (paused / not
   * choosing / already confirming / a missing or disabled row), latches against a
   * double-commit, fires `onChoiceMade`, and steps the runner. The latch (not the
   * runner) is what guarantees a single commit: `mode` stays "choosing" while the
   * runner awaits the option's blocking commands, so without it a second confirm
   * would emit a duplicate `onChoiceMade`.
   */
  private commit(position: number): void {
    if (this.paused) return; // frozen: input is inert
    if (this.mode !== "choosing" || this.confirming) return;
    const chosen = this.resolved[position];
    if (!chosen || chosen.disabled) return; // never commit a missing or disabled row
    this.selected = position;
    this.confirming = true;
    const text = this.i18n.t(chosen.option.key, chosen.option.text, this.readView());
    this.opts.onChoiceMade?.({ index: chosen.index, text });
    this.runner?.choose(chosen.index);
  }

  /** Toggle hold-to-fast-forward; the text channel scales its reveal rate. */
  setFastForward(on: boolean): void {
    this.channels.text.setSpeedMultiplier(on ? this.skipMul : 1);
  }

  /**
   * Default auto-advance: lines without their own `autoAdvanceMs` advance `ms`
   * after they finish revealing; `null` turns it off (manual advance). A
   * per-line `autoAdvanceMs` always overrides this. Toggling it while a line is
   * already sitting revealed arms/clears its timer immediately.
   */
  setAutoAdvance(ms: number | null): void {
    this.autoAdvanceDefault = ms;
    if (
      this.mode === "saying" &&
      this.saying?.autoAdvanceMs === undefined &&
      this.channels.text.isRevealComplete()
    ) {
      // `autoTimer` counts down against the seconds-based dt; the public
      // auto-advance API is in milliseconds, so convert at arming.
      this.autoTimer = ms !== null ? ms / 1000 : undefined;
    }
  }

  // ── runner handlers ─────────────────────────────────────────────────────

  private handleSay(step: SayStep, speaker: LoadedSpeaker | undefined): void {
    this.mode = "saying";
    this.saying = step;
    this.autoTimer = undefined;
    this.advanceFired = false;
    this.afterRevealFired = false;
    this.confirming = false;
    // Materialize the read view once for this line (an external getter fires
    // exactly once per present, shared by text + nameplate).
    const view = this.readView();
    const resolved = this.i18n.t(step.key, step.text, view);
    const line: PresentedLine = {
      speaker: this.speakerView(speaker, view),
      text: parseMarkup(resolved),
      speed: step.speed ?? 1,
      view: step.view,
      meta: step.meta,
      voice: step.voice,
    };

    this.channels.choices.clear();
    this.channels.chrome?.setContinueVisible(false);
    this.channels.chrome?.setNameplate(
      this.speakerName(speaker, view),
      speaker?.color,
    );

    this.channels.avatar?.setSpeaker(speaker);
    this.channels.avatar?.setExpression(step.expression);
    this.channels.avatar?.setSpeaking(true);
    // Line-driven avatars read meta here. Before chrome/text present so a
    // reflowing in-box avatar can register its text inset first (the text view
    // then wraps to the narrowed region).
    this.channels.avatar?.present?.(line);

    this.channels.chrome?.present?.(line);
    this.channels.text.present(line);

    // Fan the say line out to the extras — a voice channel reads `line.voice`
    // and starts its clip here; a history channel buffers it. After the text
    // channel, before the line's `show` commands. NOT done for choice prompts
    // (only say lines carry a voice / a reveal to gate on).
    this.currentPresented = line;
    for (const ch of this.extras) {
      try {
        ch.present?.(line);
      } catch (error) {
        this.opts.onError?.("dialogue: channel present() failed", error);
      }
    }

    const plain = stripMarkup(resolved);
    this.currentLine = { speaker: this.speakerName(speaker, view), text: plain };
    this.opts.onLine?.({ speaker: this.currentLine.speaker, text: plain });

    // A saying line shows the chrome + body text (gated by the host-hidden lever).
    this.applyVisibility();

    // Line commands fire by timing (the runner leaves them to us in play mode).
    void this.fireLineCommands("show");
  }

  private handleChoice(
    step: ChoiceStep,
    choices: readonly ResolvedChoice[],
    speaker: LoadedSpeaker | undefined,
  ): void {
    this.mode = "choosing";
    this.resolved = choices;
    // Start on the first ENABLED row. The runner skips a step with zero
    // selectable rows, so one always exists — assert it rather than silently
    // masking a regression (a -1 would seed the highlight on a disabled row).
    const firstEnabled = choices.findIndex((c) => !c.disabled);
    if (firstEnabled < 0) {
      throw new Error("dialogue: choice step presented with no enabled option");
    }
    this.selected = firstEnabled;
    this.confirming = false;
    const view = this.readView();

    // Treat the choice like a line so the chrome switches to the right variant
    // (a composite box/bubble chrome otherwise leaves the previous speaker's
    // bubble up behind a frameless choice list).
    const line: PresentedLine = {
      speaker: this.speakerView(speaker, view),
      text: step.text
        ? parseMarkup(this.i18n.t(step.key, step.text, view))
        : EMPTY_PARSED,
      speed: 1,
      view: step.view,
      meta: step.meta,
    };

    // Drive the avatar like a say-line would: the choice's speaker owns the
    // portrait (a stale say-speaker must not linger through the choice). No
    // expression of its own and no talk-state — choices don't reveal.
    this.channels.avatar?.setSpeaker(speaker);
    this.channels.avatar?.setExpression(undefined);
    this.channels.avatar?.setSpeaking(false);
    // Line-driven avatars read the choice line's meta too (before the body
    // prompt presents, so an in-box avatar's inset reflows the prompt).
    this.channels.avatar?.present?.(line);

    const ctx: ChoiceContext = {
      view: step.view,
      speaker: line.speaker,
      prompt: line.text,
      meta: step.meta,
    };
    // A self-contained presenter (e.g. a bubble panel) draws its own frame +
    // prompt; then we hide the chrome and don't type the prompt into the body.
    const presenterOwnsPrompt =
      this.channels.choices.ownsPrompt?.(ctx) ?? false;
    // Remembered so a hide toggle mid-choice recomputes the right visibility.
    // The body shows only when the prompt actually types into it — matching the
    // `if (step.text)` present/clear branch below (an empty prompt clears it).
    this.choiceShowsChrome = !presenterOwnsPrompt;
    this.choiceShowsBody = !presenterOwnsPrompt && Boolean(step.text);

    this.channels.chrome?.setContinueVisible(false);
    if (presenterOwnsPrompt) {
      // Clear the chrome's content honestly (no covert nameplate overload); the
      // explicit setVisible(false) from applyVisibility does the actual hide.
      this.channels.chrome?.present?.(undefined);
      this.channels.text.clear();
    } else {
      // Always set (undefined when no speaker) so a stale nameplate doesn't linger.
      this.channels.chrome?.setNameplate(
        this.speakerName(speaker, view),
        speaker?.color,
      );
      this.channels.chrome?.present?.(line);
      // Prompt (optional) types into the body region above the options.
      if (step.text) this.channels.text.present(line);
      else this.channels.text.clear();
    }

    const labels = choices.map((c) =>
      stripMarkup(this.i18n.t(c.option.key, c.option.text, view)),
    );
    const presented: PresentedChoice[] = choices.map((c, i) => ({
      label: labels[i]!,
      meta: c.option.meta,
      disabled: c.disabled,
      // i18n-resolve the reason (interpolating {tokens}) only for disabled rows
      // that carry one; there's no separate i18n key for it.
      disabledReason:
        c.disabled && c.option.disabledReason !== undefined
          ? stripMarkup(this.i18n.t(undefined, c.option.disabledReason, view))
          : undefined,
    }));
    this.channels.choices.present(presented, ctx);
    this.channels.choices.highlight(this.selected);
    this.applyVisibility();
    this.opts.onChoiceShown?.({ options: labels });
  }

  private handleCommand(
    command: Command,
    ctx: CommandContext,
  ): void | Promise<void> {
    // Observation first (the host emits DialogueCommandEvent); then the binding's
    // handler does the actual work. Returning its (possibly async) result lets a
    // blocking command pause the runner until the game finishes handling it.
    // validateBinding guarantees a handler/fallback exists for every command type.
    // The Session does NO channel-specific name-matching: a mid-line face change
    // is the `[expression=…/]` reveal marker (read by the avatar channel), not a
    // command.
    this.opts.onCommand?.(command, ctx);
    // Fan the command out to extras (a shop channel reacts to `buy` here). `set`
    // is runner-owned and never reaches this handler.
    for (const ch of this.extras) {
      try {
        ch.command?.(command, ctx);
      } catch (error) {
        this.opts.onError?.("dialogue: channel command() failed", error);
      }
    }
    const handler = this.commands[command.type] ?? this.fallbackCommand;
    return handler?.(command, ctx);
  }

  private handleEnd(): void {
    this.goIdle("ended");
    this.opts.onEnded?.({ scriptId: this.scriptId });
  }

  private async handleRevealComplete(): Promise<void> {
    if (this.mode !== "saying") return;
    const gen = this.generation;
    this.channels.avatar?.setSpeaking(false);
    // `afterReveal` commands run before the continue caret invites advancing.
    // At most once per line — skip() may have fired them early (while a
    // blocking one was awaited, the typewriter can have finished underneath).
    if (!this.afterRevealFired) {
      this.afterRevealFired = true;
      await this.fireLineCommands("afterReveal");
    }
    // Bail if stop()/play() swapped the conversation while we awaited, else we'd
    // show the continue caret on the new conversation's still-revealing line.
    if (gen !== this.generation || this.mode !== "saying") return;
    this.channels.chrome?.setContinueVisible(true);
    // The "typing finished" hook — after afterReveal commands settle, as the
    // continue caret appears. Carries the line so a game needn't track it.
    if (this.currentLine) this.opts.onRevealCompleted?.(this.currentLine);
    // Fan reveal-completion out to extras (a history channel commits the line
    // once it's fully shown). The PresentedLine, since the plain currentLine
    // dropped the markup/meta.
    const presented = this.currentPresented;
    if (presented) {
      for (const ch of this.extras) {
        try {
          ch.revealComplete?.(presented);
        } catch (error) {
          this.opts.onError?.("dialogue: channel revealComplete() failed", error);
        }
      }
    }
    // Per-line `autoAdvanceMs` wins; otherwise fall back to the session default.
    // Both are milliseconds; `autoTimer` counts down in seconds.
    const auto = this.saying?.autoAdvanceMs ?? this.autoAdvanceDefault;
    if (auto !== null) this.autoTimer = auto / 1000;
  }

  /**
   * Fan one reveal beat out — the per-line typewriter stream. Extras (Voice /
   * CameraEffects / a typewriter-SFX channel) see the WHOLE stream via
   * `revealBeat?`. A `tick` then reaches the host's `onRevealTick` callback; a
   * `marker` reaches the avatar channel (which interprets `[expression=…/]`
   * itself — the Session name-matches nothing) and the host's `onRevealMarker`.
   */
  private handleRevealBeat(beat: RevealBeat): void {
    for (const ch of this.extras) {
      try {
        ch.revealBeat?.(beat);
      } catch (error) {
        this.opts.onError?.("dialogue: channel revealBeat() failed", error);
      }
    }
    if (beat.kind === "tick") {
      this.opts.onRevealTick?.(beat.index);
      return;
    }
    // marker: the avatar reads the names it owns; the host gets every one.
    this.channels.avatar?.marker?.(beat.marker);
    this.opts.onRevealMarker?.(beat.marker, beat.viaSkip);
  }

  /**
   * Fire the current line's commands matching `at`, via the runner's command
   * pipeline (so `set`/blocking behave identically). While a blocking one is
   * awaited, `lineBlocked` gates input so the player can't advance through it.
   * `mode` overrides the runner's run mode (skip() fires the displayed line's
   * batches in skip mode).
   */
  private async fireLineCommands(at: CommandTiming, mode?: RunMode): Promise<void> {
    const all = this.saying?.commands;
    if (!all || !this.runner) return;
    const batch = all.filter((c) => (c.at ?? "show") === at);
    if (batch.length === 0) return;
    const gen = this.generation;
    const blocking = batch.some((c) => c.blocking);
    if (blocking) this.blockedCount++;
    try {
      await this.runner.runCommands(batch, mode);
    } finally {
      // Release only the gate this batch took, and only if still the same
      // conversation — stop()/play() mid-await already reset the counter for
      // the new conversation.
      if (blocking && gen === this.generation) this.blockedCount--;
    }
  }

  private speakerName(
    speaker: LoadedSpeaker | undefined,
    view: VarMap,
  ): string | undefined {
    if (!speaker) return undefined;
    return this.i18n.t(speaker.nameKey, speaker.name, view);
  }

  private speakerView(
    speaker: LoadedSpeaker | undefined,
    view: VarMap,
  ): SpeakerView | undefined {
    if (!speaker) return undefined;
    return {
      id: speaker.id,
      name: this.speakerName(speaker, view),
      color: speaker.color,
    };
  }
}
