/**
 * DialogueRunner — the engine-agnostic state machine. It walks a normalised
 * {@link DialogueScript}, pausing on `say`/`choice` steps (which need player
 * input) and running `command`/`goto`/`end` steps straight through. All
 * presentation is delegated via callbacks, so the same runner drives a
 * renderer-based box, a ui-react box, or a headless test.
 *
 * Branching uses a small `vars` map: `set` commands write it, conditions read
 * it. The runner resolves built-in commands (`set`) itself and surfaces every
 * other command to the host through `onCommand` — that's the seam where the
 * game turns `{ type: "give-item", id: "key" }` into an actual effect.
 */

import type {
  ChoiceOption,
  ChoiceStep,
  Command,
  CommandContext,
  Condition,
  DialogueScript,
  RunMode,
  SayStep,
  SpeakerDef,
  Step,
  VarMap,
  VarValue,
} from "./types.js";

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
  private readonly vars: VarMap;
  private readonly chosenOnce = new Set<string>();
  private nodeId: string;
  private stepIndex = 0;
  private state: RunnerState = "idle";
  /** "play" normally; flipped to "skip" by a future fast-forward (see C2). */
  private runMode: RunMode = "play";

  constructor(
    private readonly script: DialogueScript,
    private readonly handlers: RunnerHandlers,
  ) {
    this.vars = { ...(script.vars ?? {}) };
    this.nodeId = script.start;
  }

  /** Snapshot of branching vars (for save/restore or debugging). */
  getVars(): Readonly<VarMap> {
    return this.vars;
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
   * `set`, surfaces the rest with the current mode, and awaits `blocking` ones.
   * Does not touch the runner's wait-state (the Session gates its own input).
   */
  runCommands(commands: readonly Command[] | undefined): Promise<void> {
    return this.execCommands(commands);
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
  private async execCommands(commands: readonly Command[] | undefined): Promise<void> {
    if (!commands) return;
    for (const cmd of commands) {
      if (cmd.type === "set" && typeof cmd.var === "string") {
        this.vars[cmd.var] = cmd.value as VarValue;
        continue;
      }
      const result = this.handlers.onCommand(cmd, { mode: this.runMode });
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

  private test(condition: Condition | undefined): boolean {
    if (condition === undefined) return true;
    return evalCondition(condition, this.vars);
  }
}

export function evalCondition(condition: Condition, vars: Readonly<VarMap>): boolean {
  if (typeof condition === "function") return condition(vars as VarMap);
  if (typeof condition === "string") return Boolean(vars[condition]);

  const left = vars[condition.var];
  const right = condition.value;
  switch (condition.op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return num(left) > num(right);
    case ">=":
      return num(left) >= num(right);
    case "<":
      return num(left) < num(right);
    case "<=":
      return num(left) <= num(right);
    case "truthy":
      return Boolean(left);
    case "falsy":
      return !left;
  }
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function isPromise(v: unknown): v is Promise<unknown> {
  return (
    typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function"
  );
}
