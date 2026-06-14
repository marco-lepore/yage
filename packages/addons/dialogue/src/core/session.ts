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
import { createScope, evalCondition, type EvalScope } from "./expr.js";
import { IdentityI18n, type I18nAdapter } from "./i18n.js";
import { parseMarkup, stripMarkup } from "./markup.js";
import { DialogueRunner, type ResolvedChoice } from "./runner.js";
import { MemoryVariableStorage, materialize } from "./vars.js";
import { analyzeScript, validatePlay } from "./validate.js";
import type { VarsOf } from "./defineScript.js";
import type {
  ChoiceStep,
  Command,
  CommandContext,
  CommandHandler,
  CommandTiming,
  Condition,
  DialogueFunction,
  DialogueHandle,
  DialoguePlayOptions,
  DialogueScript,
  ParsedText,
  RunMode,
  SayStep,
  SpeakerDef,
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

/** One selectable choice, resolved to a display label. Position = array index. */
export interface PresentedChoice {
  readonly label: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Body-text channel. Owns reveal timing (the Session only learns *that* a line
 * finished, via `onRevealComplete`, never *when* a glyph appears). An
 * accessibility / no-typewriter presenter is `present(){ draw(); onRevealComplete?.() }`.
 */
export interface TextChannel {
  present(line: PresentedLine): void;
  /** Reveal everything immediately (skip-to-end). */
  completeReveal(): void;
  isRevealComplete(): boolean;
  isRevealing(): boolean;
  /** Hold-to-fast-forward rate flag (1 = normal). */
  setSpeedMultiplier(multiplier: number): void;
  update(dt: number): void;
  clear(): void;
  onRevealComplete?: () => void;
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
}

/** Choice channel. Selection nav lives in the Session; pointer/touch commits
 *  come back through `onChoiceChosen(position)`. `context` carries the choice's
 *  view/speaker/prompt so a composite presenter can route (box vs bubble). */
export interface ChoiceChannel {
  present(choices: readonly PresentedChoice[], context?: ChoiceContext): void;
  highlight(position: number): void;
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
  setSpeaker(speaker: SpeakerDef | undefined): void;
  setExpression(expression: string | undefined): void;
  setSpeaking(speaking: boolean): void;
  update(dt: number): void;
}

/** Chrome channel — frame / nameplate / continue caret (everything but body
 *  text and choices). `present?` lets a chrome react to per-line variants. */
export interface ChromeChannel {
  setNameplate(name: string | undefined, color?: number): void;
  setContinueVisible(visible: boolean): void;
  present?(line: PresentedLine | undefined): void;
  update(dt: number): void;
}

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
   * The variable storage installed for every `play()` (D1). Persists across
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
  readonly onStarted?: (e: { scriptId: string }) => void;
  /** Plain (markup-stripped) line text — for logs / a11y / history. */
  readonly onLine?: (e: { speaker?: string | undefined; text: string }) => void;
  readonly onChoiceShown?: (e: { options: readonly string[] }) => void;
  readonly onChoiceMade?: (e: { index: number; text: string }) => void;
  /**
   * Observation hook fired for every non-built-in command (after `expression`,
   * never for `set`) — the host forwards it to {@link DialogueCommandEvent}. The
   * actual *handling* (and any `blocking` await) is the binding's `commands`
   * map / `fallbackCommand`, not this; this returns nothing.
   */
  readonly onCommand?: (command: Command, ctx: CommandContext) => void;
  readonly onEnded?: (e: { scriptId: string }) => void;
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
  private script: DialogueScript | undefined;
  private mode: Mode = "idle";
  private scriptId = "";

  private saying: SayStep | undefined;
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
    this.channels.text.onRevealComplete = () => this.handleRevealComplete();
    this.channels.choices.onChoiceChosen = (position) => {
      this.selected = position;
      this.confirm();
    };
  }

  /**
   * Begin a conversation. `play(script)` is **content-only** — the storage,
   * functions, and commands are installed on the session (D1); `overrides` layers
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

    // Past the point of failure — commit. Abandon any in-flight conversation:
    // `stop()` bumps the generation, so a still-pending async continuation from
    // the previous line (e.g. an awaited `afterReveal`/`advance` command) bails on
    // resume instead of stepping this new runner — important when `play()` restarts
    // an ambient/eavesdrop loop while a line is mid-flight.
    this.stop();

    // Seed-if-absent (D3): a declared default applies only when the storage
    // doesn't already hold the name — never clobber a game-linked value.
    for (const [name, value] of Object.entries(script.declare ?? {})) {
      if (!storage.has(name)) storage.set(name, value);
    }

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
      { storage: guarded, functions },
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

    // Typed, generation-stamped handle (D4): after stop()/replay it no-ops
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

  /** Abandon the current conversation and reset to idle (clears all visuals).
   *  Useful for ambient/eavesdrop dialogue that should stop when out of range. */
  stop(): void {
    this.generation++;
    this.runner = undefined;
    this.mode = "idle";
    this.saying = undefined;
    this.resolved = [];
    this.autoTimer = undefined;
    this.blockedCount = 0;
    this.advancing = false;
    this.advanceFired = false;
    this.afterRevealFired = false;
    this.confirming = false;
    this.channels.text.clear();
    this.channels.choices.clear();
    this.channels.chrome?.setContinueVisible(false);
    this.channels.chrome?.setNameplate(undefined);
    this.channels.avatar?.setSpeaker(undefined);
    this.channels.avatar?.setSpeaking(false);
  }

  update(dt: number): void {
    this.channels.text.update(dt);
    this.channels.chrome?.update(dt);
    this.channels.avatar?.update(dt);
    if (!this.runner || this.mode !== "saying") return;
    if (this.autoTimer !== undefined && this.channels.text.isRevealComplete()) {
      this.autoTimer -= dt;
      // Consume the timer only when advance() can actually act — a blocking
      // line-command (or an in-flight advance) would silently refuse it, and
      // nothing re-arms the timer afterwards (ambient soft-lock). Leave it
      // expired (≤ 0) and retry next frame; it still fires exactly once.
      if (this.autoTimer <= 0 && !this.lineBlocked && !this.advancing) {
        this.autoTimer = undefined;
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
   * The storage read view for `{token}` interpolation at *this* present-time.
   * Materialized per evaluation so an earlier command's `set` shows up on a
   * later line (scenario 3); already-shown lines never re-render.
   */
  private readView(): VarMap {
    return this.storage ? materialize(this.storage) : {};
  }

  // ── input-agnostic API ────────────────────────────────────────────────────

  /** Primary action. Saying → reveal-all if typing, else next line. Choosing → confirm. */
  advance(): void {
    if (this.lineBlocked || this.advancing) return; // a line-command is in flight
    if (this.mode === "saying") {
      if (this.channels.text.isRevealing()) this.channels.text.completeReveal();
      else void this.advanceLine();
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
    if (this.mode !== "saying" || this.lineBlocked || this.advancing) return;
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
        if (step.target !== undefined && testCondition(step.condition, scope)) {
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

  /** Move the choice cursor by `delta` (wraps). No-op outside a choice. */
  moveSelection(delta: number): void {
    if (this.mode !== "choosing" || this.confirming) return;
    const n = this.resolved.length;
    if (n === 0) return;
    this.selected = (this.selected + delta + n) % n;
    this.channels.choices.highlight(this.selected);
  }

  /** Highlight a choice by absolute position (e.g. pointer hover). No wrap. */
  selectAt(position: number): void {
    if (this.mode !== "choosing" || this.confirming) return;
    const n = this.resolved.length;
    if (n === 0 || position < 0 || position >= n || position === this.selected)
      return;
    this.selected = position;
    this.channels.choices.highlight(this.selected);
  }

  /** Commit the highlighted choice. */
  confirm(): void {
    // The latch (not the runner) is what guarantees a single commit: `mode`
    // stays "choosing" while the runner awaits the option's blocking commands,
    // so without it a second confirm would emit a duplicate onChoiceMade.
    if (this.mode !== "choosing" || this.confirming) return;
    const chosen = this.resolved[this.selected];
    if (!chosen) return;
    this.confirming = true;
    const text = this.i18n.t(
      chosen.option.key,
      chosen.option.text,
      this.readView(),
    );
    this.opts.onChoiceMade?.({ index: chosen.index, text });
    this.runner?.choose(chosen.index);
  }

  /** Commit by original option index (e.g. a direct pointer hit). */
  choose(optionIndex: number): void {
    if (this.mode !== "choosing" || this.confirming) return;
    const pos = this.resolved.findIndex((c) => c.index === optionIndex);
    if (pos < 0) return;
    this.selected = pos;
    this.confirm();
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
      this.autoTimer = ms ?? undefined;
    }
  }

  // ── runner handlers ─────────────────────────────────────────────────────

  private handleSay(step: SayStep, speaker: SpeakerDef | undefined): void {
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

    this.channels.chrome?.present?.(line);
    this.channels.text.present(line);

    this.opts.onLine?.({
      speaker: this.speakerName(speaker, view),
      text: stripMarkup(resolved),
    });

    // Line commands fire by timing (the runner leaves them to us in play mode).
    void this.fireLineCommands("show");
  }

  private handleChoice(
    step: ChoiceStep,
    choices: readonly ResolvedChoice[],
    speaker: SpeakerDef | undefined,
  ): void {
    this.mode = "choosing";
    this.resolved = choices;
    this.selected = 0;
    this.confirming = false;
    const view = this.readView();

    // Treat the choice like a line so the chrome switches to the right variant
    // (a composite box/bubble chrome otherwise leaves the previous speaker's
    // bubble up behind a frameless choice list).
    const line: PresentedLine = {
      speaker: this.speakerView(speaker, view),
      text: step.text
        ? parseMarkup(this.i18n.t(step.key, step.text, view))
        : { runs: [], pauses: [], length: 0 },
      speed: 1,
      view: step.view,
      meta: step.meta,
    };

    // Drive the avatar like a say-line would: the choice's speaker owns the
    // portrait (a stale say-speaker must not linger through the choice, and an
    // `expression` command on an option should route to the right face). No
    // expression of its own and no talk-state — choices don't reveal.
    this.channels.avatar?.setSpeaker(speaker);
    this.channels.avatar?.setExpression(undefined);
    this.channels.avatar?.setSpeaking(false);

    const ctx: ChoiceContext = {
      view: step.view,
      speaker: line.speaker,
      prompt: line.text,
    };
    // A self-contained presenter (e.g. a bubble panel) draws its own frame +
    // prompt; then we hide the chrome and don't type the prompt into the body.
    const presenterOwnsPrompt =
      this.channels.choices.ownsPrompt?.(ctx) ?? false;

    this.channels.chrome?.setContinueVisible(false);
    if (presenterOwnsPrompt) {
      this.channels.chrome?.setNameplate(undefined); // composite → hide all chrome
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
    }));
    this.channels.choices.present(presented, ctx);
    this.channels.choices.highlight(0);
    this.opts.onChoiceShown?.({ options: labels });
  }

  private handleCommand(
    command: Command,
    ctx: CommandContext,
  ): void | Promise<void> {
    // `expression` is a built-in convenience: route it straight to the avatar
    // so scripts can change a face mid-line without the host wiring anything.
    if (command.type === "expression" && typeof command.value === "string") {
      this.channels.avatar?.setExpression(command.value);
      return;
    }
    // Observation first (the host emits DialogueCommandEvent); then the binding's
    // handler does the actual work. Returning its (possibly async) result lets a
    // blocking command pause the runner until the game finishes handling it.
    // validateBinding guarantees a handler/fallback exists for every command type.
    this.opts.onCommand?.(command, ctx);
    const handler = this.commands[command.type] ?? this.fallbackCommand;
    return handler?.(command, ctx);
  }

  private handleEnd(): void {
    this.mode = "ended";
    this.saying = undefined;
    this.resolved = [];
    this.confirming = false;
    this.channels.text.clear();
    this.channels.choices.clear();
    this.channels.chrome?.setContinueVisible(false);
    this.channels.chrome?.setNameplate(undefined);
    this.channels.avatar?.setSpeaker(undefined);
    this.channels.avatar?.setSpeaking(false);
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
    // Per-line `autoAdvanceMs` wins; otherwise fall back to the session default.
    const auto = this.saying?.autoAdvanceMs ?? this.autoAdvanceDefault;
    if (auto !== null) this.autoTimer = auto;
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
    speaker: SpeakerDef | undefined,
    view: VarMap,
  ): string | undefined {
    if (!speaker) return undefined;
    return this.i18n.t(speaker.nameKey, speaker.name, view);
  }

  private speakerView(
    speaker: SpeakerDef | undefined,
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

/** True when no condition, else the condition holds against `scope`. */
function testCondition(condition: Condition | undefined, scope: EvalScope): boolean {
  return condition === undefined ? true : evalCondition(condition, scope);
}
