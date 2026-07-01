/**
 * DialogueRunner — the engine-agnostic state machine. It walks a normalised
 * {@link DialogueScript}, pausing on `say`/`choice` steps (which need player
 * input) and running `command`/`goto`/`end` steps straight through. All
 * presentation is delegated via callbacks, so the same runner drives a
 * renderer-based box, a ui-react box, or a headless test.
 *
 * Branching reads one {@link VariableStorage} namespace through an
 * {@link EvalScope} (per-name reads + installed functions): `set` / `ctx.setVar`
 * write storage, conditions and `set` values are evaluated as expression trees.
 * The runner resolves built-in commands (`set`) itself and surfaces every other
 * command to the host through `onCommand` — that's the seam where the game turns
 * `{ type: "give-item", id: "key" }` into an actual effect.
 */

import { createScope, evaluate, holds, isExpr, type EvalScope } from "./expr.js";
import { materialize } from "./vars.js";
import type {
  ChoiceOption,
  ChoiceStep,
  Command,
  CommandContext,
  Condition,
  DialogueFunction,
  LoadedScript,
  LoadedSpeaker,
  RunMode,
  SayStep,
  Step,
  VariableStorage,
  VarMap,
  VarValue,
} from "./types.js";

/** The runtime environment the session installs behind a running conversation:
 *  the variable storage (read + guarded write) + the callable functions. */
export interface RunnerEnv {
  readonly storage: VariableStorage;
  readonly functions: Readonly<Record<string, DialogueFunction>>;
  /**
   * Surfaces a non-fatal runtime diagnostic — currently a `set` whose write the
   * storage rejected (a getter-only `cells` accessor). The runner ignores the
   * write and keeps the conversation running; the host (via the session →
   * controller) routes the message to the engine logger. Engine-agnostic: the
   * core never reaches for `console`/a logger directly.
   */
  readonly onError?: ((message: string, error: unknown) => void) | undefined;
}

export interface ResolvedChoice {
  readonly index: number; // index into the original options array
  readonly option: ChoiceOption;
  /**
   * A visible-but-disabled row: the option's condition currently fails AND its
   * `presentation` is `"disabled"`, so it's shown greyed-out and non-selectable
   * instead of filtered. Omitted (falsy) for a normal, selectable option.
   * Default-`"hidden"` condition failures and spent `once` options aren't
   * returned at all.
   */
  readonly disabled?: boolean;
}

export interface RunnerHandlers {
  /** A line is ready to display. Runner waits for `advance()`. */
  onSay(step: SayStep, speaker: LoadedSpeaker | undefined): void;
  /** Choices are ready. Runner waits for `choose(index)`. `prompt` pre-resolved by host. */
  onChoice(
    step: ChoiceStep,
    choices: readonly ResolvedChoice[],
    speaker: LoadedSpeaker | undefined,
  ): void;
  /**
   * A non-built-in command fired (give-item, play-sfx, …). May return a promise;
   * if the command is `blocking`, the runner waits for it.
   */
  onCommand(command: Command, ctx: CommandContext): void | Promise<void>;
  /** Conversation finished (ran off the end or hit an `end` step). */
  onEnd(): void;
}

type RunnerState = "idle" | "saying" | "choosing" | "awaiting-command" | "ended";

export class DialogueRunner {
  /** `option.once` keys already picked — per-conversation **cursor** state, NOT
   *  the variable storage. Fresh per runner, so a new `play()` starts it empty
   *  (a re-played conversation re-shows its `once` options; {@link getChosenOnce}
   *  exposes the set so a save cursor could capture/restore it). */
  private readonly chosenOnce = new Set<string>();
  private nodeId: string;
  private stepIndex = 0;
  private state: RunnerState = "idle";
  /** "play" normally; `skip()` flips it to "skip" to fast-forward the section. */
  private runMode: RunMode = "play";

  /** Storage (write through this so a read-only `cells` accessor throws) +
   *  functions, wrapped once as the condition/`set`-value eval scope. */
  private readonly storage: VariableStorage;
  private readonly scope: EvalScope;
  private readonly onError: ((message: string, error: unknown) => void) | undefined;

  constructor(
    private readonly script: LoadedScript,
    /** The variable storage + functions (built by the session per play()). */
    env: RunnerEnv,
    private readonly handlers: RunnerHandlers,
  ) {
    this.nodeId = script.start;
    this.storage = env.storage;
    this.scope = createScope(env.storage, env.functions);
    this.onError = env.onError;
  }

  /** Snapshot of the storage's variables — the `handle.getVars()` /
   *  future save-cursor view. */
  getVars(): Readonly<VarMap> {
    return materialize(this.storage);
  }

  // ── save seam (read-only cursor getters) ──────────────────────────────────
  // The runner's durable cursor is (nodeId, stepIndex, chosenOnce) + getVars().
  // These getters exist so a future `SnapshotContributor` can capture/restore a
  // conversation WITHOUT a breaking API change. Snapshot/restore itself is
  // deliberately NOT built yet — keep these read-only.

  /** Current node id (durable cursor; save seam). */
  getNodeId(): string {
    return this.nodeId;
  }

  /** Current step index within the node (durable cursor; save seam). */
  getStepIndex(): number {
    return this.stepIndex;
  }

  /** One-shot choice keys already picked (`option.once`); save seam. */
  getChosenOnce(): ReadonlySet<string> {
    return this.chosenOnce;
  }

  isEnded(): boolean {
    return this.state === "ended";
  }

  /** Begin at the start node. Idempotent guard against double-start. The cursor
   *  (`nodeId`/`stepIndex`) is already at the start from the ctor + field init. */
  start(): void {
    if (this.state !== "idle") return;
    void this.run();
  }

  /** Advance past the current `say` line. No-op unless we're awaiting it. */
  advance(): void {
    if (this.state !== "saying") return;
    this.stepIndex++;
    void this.run();
  }

  /**
   * Fast-forward from the current line: run intervening commands in `skip` mode
   * (so the game can reconstruct world state idempotently) without presenting
   * any lines, stopping at the next choice or the end. No-op unless on a line.
   */
  async skip(): Promise<void> {
    if (this.state !== "saying") return;
    this.runMode = "skip";
    this.stepIndex++;
    await this.run();
  }

  /**
   * Public, **wait-state-free** entry the Session uses to fire a `say` line's
   * commands at show / after-reveal / advance time. Handles built-in `set`,
   * surfaces the rest with the current mode (or `mode`, when the Session fires the
   * displayed line's batches as part of its own skip), and awaits `blocking` ones.
   * Delegates to {@link executeBatch}; the runner's wait-state is untouched (the
   * Session gates its own input).
   */
  runCommands(commands: readonly Command[] | undefined, mode?: RunMode): Promise<void> {
    return this.executeBatch(commands, mode);
  }

  /** Pick choice `index` (the original option index). */
  async choose(index: number): Promise<void> {
    if (this.state !== "choosing") return;
    const step = this.currentStep();
    if (!step || step.kind !== "choice") return;
    const option = step.options[index];
    if (!option || !this.choiceEnabled(step, index, option)) return;

    if (option.once) this.chosenOnce.add(this.onceKey(step, index));
    // Hold a transient state so a second confirm during an awaited blocking
    // command is ignored, then run the option's commands before branching.
    this.state = "awaiting-command";
    await this.fireBatch(option.commands);
    if (this.isEnded()) return;

    if (option.target !== undefined) this.jump(option.target);
    else this.stepIndex++;
    void this.run();
  }

  // ── internal ────────────────────────────────────────────────────────────

  /** Run non-blocking steps until we hit one that needs input, or the end. */
  private async run(): Promise<void> {
    for (;;) {
      if (this.isEnded()) return;
      const step = this.currentStep();
      if (!step) {
        this.end();
        return;
      }
      if (await this.handleStep(step)) return; // returned true → blocking, wait
    }
  }

  /** @returns true if the step blocks (waiting for advance/choose/command/end). */
  private async handleStep(step: Step): Promise<boolean> {
    switch (step.kind) {
      case "say": {
        if (this.runMode === "skip") {
          // Fast-forward: run the line's commands (world reconstruction) but
          // present nothing, then move on. In `play` the Session fires these.
          await this.fireBatch(step.commands);
          if (this.isEnded()) return true;
          this.stepIndex++;
          return false;
        }
        this.state = "saying";
        this.handlers.onSay(step, this.speaker(step.speaker));
        return true;
      }
      case "choice": {
        const choices = this.resolveChoices(step);
        // Skip the step when nothing is *selectable* — a list of only-disabled
        // rows (or no rows at all) would soft-lock, so it falls through like the
        // all-hidden / all-condition-fail path. Visible-but-disabled requires at
        // least one enabled option.
        if (!choices.some((c) => !c.disabled)) {
          this.stepIndex++;
          return false;
        }
        // A choice needs the player, so any in-progress skip ends here.
        this.runMode = "play";
        this.state = "choosing";
        this.handlers.onChoice(step, choices, this.speaker(step.speaker));
        return true;
      }
      case "command": {
        await this.fireBatch(step.commands);
        if (this.state === "ended") return true;
        if (step.target !== undefined && this.test(step.condition)) {
          this.jump(step.target);
          return false;
        }
        this.stepIndex++;
        return false;
      }
      case "goto":
        this.jump(step.target);
        return false;
      case "end":
        this.end();
        return true;
    }
  }

  private jump(target: string): void {
    this.nodeId = target;
    this.stepIndex = 0;
  }

  private end(): void {
    if (this.state === "ended") return;
    this.state = "ended";
    this.handlers.onEnd();
  }

  private currentStep(): Step | undefined {
    return this.script.nodes[this.nodeId]?.steps[this.stepIndex];
  }

  private speaker(id: string | undefined): LoadedSpeaker | undefined {
    return id ? this.script.speakers?.[id] : undefined;
  }

  /**
   * Resolve a choice step to its visible rows. A spent `once` option is always
   * dropped (presentation governs condition failures only). A passing option is
   * enabled; a failing one is returned as a `disabled` row when its
   * `presentation` is `"disabled"`, else dropped (the default `"hidden"`).
   */
  private resolveChoices(step: ChoiceStep): ResolvedChoice[] {
    const out: ResolvedChoice[] = [];
    step.options.forEach((option, index) => {
      if (this.isSpent(step, index)) return;
      // The enabled test here is the visible-row companion to `choiceEnabled`
      // (the commit gate): both gate on `isSpent` + `test(condition)`. A new
      // "disabled" reason must be added to both, or a row could show as enabled
      // yet refuse to commit.
      if (this.test(option.condition)) out.push({ index, option });
      else if (option.presentation === "disabled") out.push({ index, option, disabled: true });
    });
    return out;
  }

  /** Whether option `index` can actually be picked — the gate `choose()` uses.
   *  A spent `once` option or a failing condition refuses (a `"disabled"` row is
   *  shown but still unpickable, so this stays the single selection authority). */
  private choiceEnabled(step: ChoiceStep, index: number, option: ChoiceOption): boolean {
    return !this.isSpent(step, index) && this.test(option.condition);
  }

  /** A `once` option already chosen this run — always dropped from the menu
   *  regardless of `presentation`. Single source of truth for the once-gate,
   *  shared by `resolveChoices` and `choiceEnabled`. Reads the option from
   *  `step.options[index]`, so `(step, index)` is the only input. */
  private isSpent(step: ChoiceStep, index: number): boolean {
    const option = step.options[index];
    return option?.once === true && this.chosenOnce.has(this.onceKey(step, index));
  }

  private onceKey(step: ChoiceStep, index: number): string {
    // Stable across re-entry: node + step position + option index.
    return `${this.nodeId}#${this.stepIndex}#${index}#${step.options[index]?.text ?? ""}`;
  }

  /**
   * Fire an inline command batch (a `command` step or a chosen option). Manages
   * wait-state: enters `awaiting-command` up front when the batch contains a
   * blocking command, so a stray advance/confirm during the await is ignored; the
   * caller transitions out of the state afterwards. The work itself goes through
   * the wait-state-free {@link executeBatch}.
   */
  private async fireBatch(commands: readonly Command[] | undefined): Promise<void> {
    if (!commands || commands.length === 0) return;
    if (commands.some((c) => c.blocking)) this.state = "awaiting-command";
    await this.executeBatch(commands);
  }

  /**
   * The wait-state-free command executor, shared by {@link fireBatch} (inline
   * firing) and {@link runCommands} (the Session's line-timed firing). Applies
   * built-in `set`; surfaces the rest to the host with the current mode; awaits
   * `blocking` handlers and fire-and-forgets the others. Touches no wait-state.
   */
  private async executeBatch(
    commands: readonly Command[] | undefined,
    mode: RunMode = this.runMode,
  ): Promise<void> {
    if (!commands) return;
    for (const cmd of commands) {
      if (cmd.type === "set" && typeof cmd.var === "string") {
        // Built-in write: the value is a literal or an expression tree
        // (`gold - 50`). The storage rejects a write to a read-only `cells`
        // accessor — report it and keep going rather than let the throw escape
        // the async run()/choose() chain and wedge the conversation (same
        // contract as a throwing command handler below).
        const value = cmd.value;
        const next = isExpr(value) ? evaluate(value, this.scope) : (value as VarValue);
        try {
          this.storage.set(cmd.var, next);
        } catch (e) {
          this.onError?.(
            `ignored "set ${cmd.var}": ${e instanceof Error ? e.message : String(e)}`,
            e,
          );
        }
        continue;
      }
      let result: void | Promise<void>;
      try {
        result = this.handlers.onCommand(cmd, this.commandContext(mode));
      } catch {
        // A handler that throws *synchronously* must not wedge the conversation
        // either (same contract as the blocking-await catch below): swallow and
        // keep executing, so the caller's state transition still runs.
        continue;
      }
      if (!isPromise(result)) continue;
      if (cmd.blocking) {
        try {
          await result;
        } catch {
          // A blocking handler that throws must not wedge the conversation.
        }
        if (this.isEnded()) return;
      } else {
        // Swallow rejection so a fire-and-forget handler isn't an unhandled one.
        void Promise.resolve(result).catch(() => {});
      }
    }
  }

  /** The context handed to a command handler. `setVar` writes through the
   *  conversation's storage (guarded by the session for staleness), the same
   *  path as the `set` built-in — so the skill-check seam and `set` share one
   *  guarded write. */
  private commandContext(mode: RunMode): CommandContext {
    return { mode, setVar: (name, value) => this.storage.set(name, value) };
  }

  private test(condition: Condition | undefined): boolean {
    return holds(condition, this.scope);
  }
}

function isPromise(v: unknown): v is Promise<unknown> {
  return (
    typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function"
  );
}
