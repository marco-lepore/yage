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

import { createScope, evalCondition, evaluate, isExpr, type EvalScope } from "./expr.js";
import { materialize } from "./vars.js";
import type {
  ChoiceOption,
  ChoiceStep,
  Command,
  CommandContext,
  Condition,
  DialogueFunction,
  DialogueScript,
  RunMode,
  SayStep,
  SpeakerDef,
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
}

export interface ResolvedChoice {
  readonly index: number; // index into the original options array
  readonly option: ChoiceOption;
}

export interface RunnerHandlers {
  /** A line is ready to display. Runner waits for `advance()`. */
  onSay(step: SayStep, speaker: SpeakerDef | undefined): void;
  /** Choices are ready. Runner waits for `choose(index)`. `prompt` pre-resolved by host. */
  onChoice(
    step: ChoiceStep,
    choices: readonly ResolvedChoice[],
    speaker: SpeakerDef | undefined,
  ): void;
  /**
   * A non-built-in command fired (give-item, play-sfx, expression, …). May
   * return a promise; if the command is `blocking`, the runner waits for it.
   */
  onCommand(command: Command, ctx: CommandContext): void | Promise<void>;
  /** Conversation finished (ran off the end or hit an `end` step). */
  onEnd(): void;
}

type RunnerState = "idle" | "saying" | "choosing" | "awaiting-command" | "ended";

export class DialogueRunner {
  private readonly chosenOnce = new Set<string>();
  private nodeId: string;
  private stepIndex = 0;
  private state: RunnerState = "idle";
  /** "play" normally; flipped to "skip" by a future fast-forward (see C2). */
  private runMode: RunMode = "play";

  /** Storage (write through this so a read-only `cells` accessor throws) +
   *  functions, wrapped once as the condition/`set`-value eval scope. */
  private readonly storage: VariableStorage;
  private readonly scope: EvalScope;

  constructor(
    private readonly script: DialogueScript,
    /** The variable storage + functions (built by the session per play()). */
    env: RunnerEnv,
    private readonly handlers: RunnerHandlers,
  ) {
    this.nodeId = script.start;
    this.storage = env.storage;
    this.scope = createScope(env.storage, env.functions);
  }

  /** Snapshot of the storage's variables — the `handle.getVars()` /
   *  future save-cursor view. */
  getVars(): Readonly<VarMap> {
    return materialize(this.storage);
  }

  // ── v1.1 save seam (read-only cursor getters) ─────────────────────────────
  // The runner's durable cursor is (nodeId, stepIndex, chosenOnce) + getVars().
  // These getters exist so a future `SnapshotContributor` can capture/restore a
  // conversation WITHOUT a breaking API change. Snapshot/restore itself is
  // deliberately NOT built yet (deferred to v1.1) — keep these read-only.

  /** Current node id (durable cursor; v1.1 save seam). */
  getNodeId(): string {
    return this.nodeId;
  }

  /** Current step index within the node (durable cursor; v1.1 save seam). */
  getStepIndex(): number {
    return this.stepIndex;
  }

  /** One-shot choice keys already picked (`option.once`); v1.1 save seam. */
  getChosenOnce(): ReadonlySet<string> {
    return this.chosenOnce;
  }

  isEnded(): boolean {
    return this.state === "ended";
  }

  /** Begin at the start node. Idempotent guard against double-start. */
  start(): void {
    if (this.state !== "idle") return;
    this.nodeId = this.script.start;
    this.stepIndex = 0;
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
   * Run a command list now — the seam the host's Session uses to fire a `say`
   * line's commands at show / after-reveal / advance time. Handles built-in
   * `set`, surfaces the rest with the current mode (or `mode`, when the Session
   * fires the displayed line's batches as part of its own skip), and awaits
   * `blocking` ones. Does not touch the runner's wait-state (the Session gates
   * its own input).
   */
  runCommands(commands: readonly Command[] | undefined, mode?: RunMode): Promise<void> {
    return this.execCommands(commands, mode);
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
    await this.fireCommands(option.commands);
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
          await this.fireCommands(step.commands);
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
        if (choices.length === 0) {
          // No reachable options — skip rather than dead-end.
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
        await this.fireCommands(step.commands);
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

  private speaker(id: string | undefined): SpeakerDef | undefined {
    return id ? this.script.speakers?.[id] : undefined;
  }

  private resolveChoices(step: ChoiceStep): ResolvedChoice[] {
    const out: ResolvedChoice[] = [];
    step.options.forEach((option, index) => {
      if (this.choiceEnabled(step, index, option)) out.push({ index, option });
    });
    return out;
  }

  private choiceEnabled(step: ChoiceStep, index: number, option: ChoiceOption): boolean {
    if (option.once && this.chosenOnce.has(this.onceKey(step, index))) return false;
    return this.test(option.condition);
  }

  private onceKey(step: ChoiceStep, index: number): string {
    // Stable across re-entry: node + step position + option index.
    return `${this.nodeId}#${this.stepIndex}#${index}#${step.options[index]?.text ?? ""}`;
  }

  /**
   * Inline command firing (a `command` step or a chosen option). Enters the
   * `awaiting-command` wait-state up front when the batch contains a blocking
   * command, so a stray advance/confirm during the await is ignored; the caller
   * transitions out of the state afterwards.
   */
  private async fireCommands(commands: readonly Command[] | undefined): Promise<void> {
    if (!commands || commands.length === 0) return;
    if (commands.some((c) => c.blocking)) this.state = "awaiting-command";
    await this.execCommands(commands);
  }

  /**
   * The command executor, shared by inline firing and the Session's line-timed
   * firing. Applies built-in `set`; surfaces the rest to the host with the
   * current mode; awaits `blocking` handlers and fire-and-forgets the others.
   * Touches no wait-state of its own.
   */
  private async execCommands(
    commands: readonly Command[] | undefined,
    mode: RunMode = this.runMode,
  ): Promise<void> {
    if (!commands) return;
    for (const cmd of commands) {
      if (cmd.type === "set" && typeof cmd.var === "string") {
        // Built-in write: the value is a literal or an expression tree
        // (`gold - 50`). Guarded by the storage — a read-only `cells` accessor
        // throws here, matching the load-time set-target rules.
        const value = cmd.value;
        this.storage.set(
          cmd.var,
          isExpr(value) ? evaluate(value, this.scope) : (value as VarValue),
        );
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
    return condition === undefined ? true : evalCondition(condition, this.scope);
  }
}

function isPromise(v: unknown): v is Promise<unknown> {
  return (
    typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function"
  );
}
