import { Process } from "./Process.js";
import type { Serializable } from "./state/index.js";
import { devWarn } from "./internal/dev.js";

/** A completed move between two named states. */
export interface StateTransition<S extends string> {
  readonly from: S;
  readonly to: S;
}

/** One state in a {@link StateMachine} transition table. */
export interface StateDefinition<S extends string> {
  /** States that {@link StateMachine.go} may enter from this state. */
  readonly to?: readonly S[];
  /** Seconds before the machine enters `next`. Must be finite and greater than 0. */
  readonly for?: number;
  /** State entered when `for` elapses. Must also appear in `to`. */
  readonly next?: S;
  /** Called after this state becomes current. */
  readonly enter?: (transition: StateTransition<S> | null) => void;
  /** Called before another state becomes current. */
  readonly exit?: (transition: StateTransition<S>) => void;
}

/** A complete transition table keyed by its state-name union. */
export type StateDefinitions<S extends string> = Readonly<
  Record<S, StateDefinition<NoInfer<S>>>
>;

/** Save data for a {@link StateMachine}. */
export interface StateMachineSnapshot<S extends string> {
  readonly state: S;
  readonly elapsed: number;
}

/** Inspector summary emitted when a machine is a component field. */
export interface StateMachineInspection<
  S extends string,
> extends StateMachineSnapshot<S> {
  readonly lastTransition: StateTransition<S> | null;
}

/**
 * Preserve exact state-name types while checking every transition target.
 *
 * ```ts
 * const guardStates = defineStates({
 *   patrol: { to: ["alert"] },
 *   alert: { to: ["patrol"], for: 1, next: "patrol" },
 * });
 * ```
 */
export function defineStates<const S extends string>(
  states: StateDefinitions<S>,
): StateDefinitions<S> {
  return states;
}

/**
 * A typed, owner-driven state machine. Call {@link tick} from the update path
 * whose clock the state should follow. A component's `dt` already includes
 * scene and entity time scaling, so pass it through unchanged.
 *
 * Construction selects the initial state without running its `enter` hook.
 * Call {@link start} after the owner is ready to run that hook and begin timing.
 */
export class StateMachine<const S extends string> implements Serializable<
  StateMachineSnapshot<S>
> {
  private readonly definitions: StateDefinitions<S>;
  private runHook: (
    kind: string,
    transition: string,
    hook: () => void,
  ) => void = (_kind, _transition, hook) => hook();
  private current: S;
  private timer: Process;
  private entered = false;
  private transitioning = false;
  private warnedElapsedSaturation = false;
  private previous: StateTransition<S> | null = null;

  constructor(states: StateDefinitions<S>, initial: NoInfer<S>) {
    this.definitions = this.copyDefinitions(states);
    this.validate(initial);
    this.current = initial;
    this.timer = this.createTimer(initial);
  }

  /** @internal Bind hook dispatch to an owning component. */
  _setHookRunner(
    runHook: (kind: string, transition: string, hook: () => void) => void,
  ): this {
    this.runHook = runHook;
    return this;
  }

  /** Current state name. */
  get state(): S {
    return this.current;
  }

  /** Seconds accumulated in the current state. */
  get elapsed(): number {
    return this.timer.elapsed;
  }

  /** Most recent completed transition, or `null` before the first one. */
  get lastTransition(): StateTransition<S> | null {
    return this.previous;
  }

  /** Whether `state` is the current state. */
  is(state: NoInfer<S>): boolean {
    return this.current === state;
  }

  /**
   * Run the initial state's `enter` hook once. Construction and hydration do
   * not run hooks, so owners can finish assigning dependencies first.
   */
  start(): void {
    this.assertIdle("start");
    if (this.entered) return;
    this.transitioning = true;
    this.entered = true;
    try {
      const hook = this.definition(this.current).enter;
      if (hook) {
        this.runHook("enter", this.current, () => hook(null));
      }
    } finally {
      this.transitioning = false;
    }
  }

  /**
   * Enter a state declared in the current state's `to` list. Illegal moves
   * throw before hooks run or state changes.
   */
  go(to: NoInfer<S>): void {
    this.assertIdle("go");
    const from = this.current;
    if (to === from) return;
    const definition = this.definition(from);
    if (!definition.to?.includes(to)) {
      throw new Error(
        `StateMachine.go: transition "${from}" -> "${to}" is not declared.`,
      );
    }

    const transition = { from, to } satisfies StateTransition<S>;
    this.transitioning = true;
    try {
      const exit = definition.exit;
      if (this.entered && exit) {
        this.runHook("exit", `${from} -> ${to}`, () => exit(transition));
      }

      this.current = to;
      this.timer = this.createTimer(to);
      this.previous = transition;
      this.entered = true;

      const enter = this.definition(to).enter;
      if (enter) {
        this.runHook("enter", `${from} -> ${to}`, () => enter(transition));
      }
    } finally {
      this.transitioning = false;
    }
  }

  /** Advance the current state's timer by a finite, non-negative `dt`. */
  tick(dt: number): void {
    this.assertIdle("tick");
    if (!Number.isFinite(dt) || dt < 0) {
      throw new Error(
        `StateMachine.tick: dt must be a finite number >= 0 in seconds, got ${dt}.`,
      );
    }
    if (!this.entered || dt === 0) return;
    const duration = this.definition(this.current).for;
    const effectiveDt =
      duration === undefined
        ? dt
        : Math.min(dt, Math.max(0, duration - this.timer.elapsed));
    if (!Number.isFinite(this.timer.elapsed + effectiveDt)) {
      this.timer._hydrateElapsed(Number.MAX_VALUE);
      if (!this.warnedElapsedSaturation) {
        this.warnedElapsedSaturation = true;
        devWarn(
          "StateMachine.tick: elapsed time exceeded Number.MAX_VALUE and was capped.",
        );
      }
      return;
    }
    this.timer._update(effectiveDt);
  }

  serialize(): StateMachineSnapshot<S> {
    return { state: this.current, elapsed: this.elapsed };
  }

  /** Restore state and elapsed time without running `exit` or `enter` hooks. */
  hydrate(raw: StateMachineSnapshot<S>): void {
    this.assertIdle("hydrate");
    if (!raw || typeof raw !== "object") {
      throw new Error("StateMachine.hydrate: snapshot must be an object.");
    }
    if (typeof raw.state !== "string" || !this.hasState(raw.state)) {
      throw new Error(
        `StateMachine.hydrate: unknown state "${String(raw.state)}".`,
      );
    }
    if (!Number.isFinite(raw.elapsed) || raw.elapsed < 0) {
      throw new Error(
        `StateMachine.hydrate: elapsed must be a finite number >= 0 in seconds, got ${raw.elapsed}.`,
      );
    }
    const duration = this.definition(raw.state).for;
    if (duration !== undefined && raw.elapsed > duration) {
      throw new Error(
        `StateMachine.hydrate: elapsed ${raw.elapsed} exceeds state "${raw.state}" duration ${duration}.`,
      );
    }

    this.current = raw.state;
    this.timer = this.createTimer(raw.state);
    this.timer._hydrateElapsed(raw.elapsed);
    this.previous = null;
    this.entered = true;
  }

  /** Plain data used by the Inspector's existing component-field reflection. */
  toJSON(): StateMachineInspection<S> {
    return {
      state: this.current,
      elapsed: this.elapsed,
      lastTransition: this.previous,
    };
  }

  private createTimer(state: S): Process {
    const definition = this.definition(state);
    if (definition.for === undefined || definition.next === undefined) {
      return new Process({});
    }
    const next = definition.next;
    return Process.delay(definition.for, () => this.go(next));
  }

  private definition(state: S): StateDefinition<S> {
    return this.definitions[state];
  }

  private hasState(state: string): state is S {
    return Object.hasOwn(this.definitions, state);
  }

  private validate(initial: S): void {
    const names = Object.keys(this.definitions);
    if (names.length === 0) {
      throw new Error("StateMachine: states must contain at least one state.");
    }
    if (!this.hasState(initial)) {
      throw new Error(`StateMachine: unknown initial state "${initial}".`);
    }
    for (const name of names) {
      const state = name as S;
      const definition = this.definition(state);
      for (const target of definition.to ?? []) {
        if (!this.hasState(target)) {
          throw new Error(
            `StateMachine: state "${state}" targets unknown state "${target}".`,
          );
        }
      }
      if (definition.for === undefined && definition.next !== undefined) {
        throw new Error(
          `StateMachine: state "${state}" has next without a duration.`,
        );
      }
      if (definition.for !== undefined && definition.next === undefined) {
        throw new Error(
          `StateMachine: state "${state}" has a duration without next.`,
        );
      }
      if (
        definition.for !== undefined &&
        (!Number.isFinite(definition.for) || definition.for <= 0)
      ) {
        throw new Error(
          `StateMachine: state "${state}" duration must be a finite number > 0 in seconds, got ${definition.for}.`,
        );
      }
      if (
        definition.next !== undefined &&
        !definition.to?.includes(definition.next)
      ) {
        throw new Error(
          `StateMachine: state "${state}" next state "${definition.next}" must appear in its to list.`,
        );
      }
      if (definition.for !== undefined && definition.next === state) {
        throw new Error(
          `StateMachine: timed state "${state}" cannot advance to itself.`,
        );
      }
    }
  }

  private copyDefinitions(states: StateDefinitions<S>): StateDefinitions<S> {
    const copy = Object.create(null) as Record<S, StateDefinition<S>>;
    for (const [name, definition] of Object.entries(states) as Array<
      [S, StateDefinition<S>]
    >) {
      copy[name] = Object.freeze({
        ...definition,
        ...(definition.to && { to: Object.freeze([...definition.to]) }),
      });
    }
    return Object.freeze(copy);
  }

  private assertIdle(method: string): void {
    if (this.transitioning) {
      throw new Error(
        `StateMachine.${method}: cannot run during a state transition hook.`,
      );
    }
  }
}
