import { EventToken } from "./EventToken.js";
import { devWarn } from "./internal/dev.js";
import { assertDuration, durationReached } from "./internal/duration.js";
import type { Serializable } from "./state/index.js";

/** A completed move between two states. */
export interface StateTransition<S extends string> {
  readonly from: S;
  readonly to: S;
}

/** Payload of {@link StateMachineEvents.entered}. */
export interface StateEntered<S extends string> {
  readonly state: S;
  /** Where the machine came from, or `null` on its first entry. */
  readonly from: S | null;
}

/** Payload of {@link StateMachineEvents.exited}. */
export interface StateExited<S extends string> {
  readonly state: S;
  readonly to: S;
}

/**
 * What a machine reports, typed with its own state names. Subscribe with
 * {@link StateMachine.on}, or from a component with
 * `this.listen(machine, machine.events.entered, ...)`.
 *
 * The payload carries the move and nothing else. Game data travels on game
 * events emitted next to the `go()` call.
 */
export interface StateMachineEvents<S extends string> {
  /** Once per completed transition, after every `enter` hook has run. */
  readonly changed: EventToken<StateTransition<S>>;
  /** Once per state becoming current, parent before child. */
  readonly entered: EventToken<StateEntered<S>>;
  /** Once per state ceasing to be current, child before parent. */
  readonly exited: EventToken<StateExited<S>>;
}

/**
 * Tokens for a machine that keeps its events to itself. Dispatch is per
 * machine, so one set serves every such instance. The payload types are erased
 * here and restored by {@link StateMachine.events}.
 */
const PRIVATE_EVENT_TOKENS = {
  changed: new EventToken<StateTransition<never>>("stateMachine:changed"),
  entered: new EventToken<StateEntered<never>>("stateMachine:entered"),
  exited: new EventToken<StateExited<never>>("stateMachine:exited"),
} as const;

/** How a machine is set up beyond its states. */
export interface StateMachineOptions {
  /**
   * Publish this machine's events on its entity under `<events>:changed`,
   * `<events>:entered` and `<events>:exited`, so other components and the
   * scene can listen for them like any entity event. Pick a name for what the
   * machine tracks, such as `"mode"` or `"stance"`. Entity events dispatch by
   * name, so two machines on one entity need different names.
   *
   * Left out, the events stay on the machine and reach only
   * {@link StateMachine.on}.
   */
  readonly events?: string;
}

/** What an owning component gives a machine: attribution and entity reach. */
interface StateMachineOwner {
  run(kind: string, event: string, call: () => void): void;
  emit<T>(token: EventToken<T>, payload: T): void;
}

/** One state in a {@link StateMachine} transition table. */
export interface StateDefinition<S extends string> {
  /** States reachable from this one with {@link StateMachine.go}. */
  readonly to?: readonly NoInfer<S>[];
  /**
   * Seconds before the machine enters `next`. A function is called each time
   * the state is entered, and must return a finite number above 0.
   */
  readonly for?: number | (() => number);
  /** State entered when `for` elapses. Must be one this state can reach. */
  readonly next?: NoInfer<S>;
  /** Called after this state becomes current. */
  readonly enter?: (transition: StateTransition<NoInfer<S>> | null) => void;
  /** Called before this state stops being current. */
  readonly exit?: (transition: StateTransition<NoInfer<S>>) => void;
  /**
   * Phases of this state, named in the same union as every other state. The
   * machine is in exactly one of them while this state is current. Nesting is
   * one level deep.
   */
  readonly states?: Readonly<{ [K in S]?: ChildStateDefinition<S> }>;
  /** Child entered with this state. Required when `states` is declared. */
  readonly start?: NoInfer<S>;
  /**
   * Whether every other state may enter this one without declaring it in `to`.
   * For the handful of states a whole machine falls into, such as `hit` or
   * `die`. It adds no edge from this state to itself.
   */
  readonly fromAny?: boolean;
}

/** A state declared inside another state's `states` block. */
export type ChildStateDefinition<S extends string> = Omit<
  StateDefinition<S>,
  "states" | "start" | "fromAny"
>;

/**
 * A transition table. Every name appears once, at the top level or inside one
 * parent's `states` block.
 */
export type StateDefinitions<S extends string> = Readonly<{
  [K in S]?: StateDefinition<S>;
}>;

/** Save data for a {@link StateMachine}. */
export interface StateMachineSaveData<S extends string> {
  readonly state: S;
  readonly elapsed: number;
  /**
   * The duration this entry is running to, when `state` computes its `for`.
   * Saved because a computed duration belongs to the entry, not to the table.
   */
  readonly duration?: number;
  /** Seconds in the parent of `state`. Absent when `state` has no parent. */
  readonly parentElapsed?: number;
  /** The parent's duration, on the same terms as `duration`. */
  readonly parentDuration?: number;
}

/** Inspector summary emitted when a machine is a component field. */
export interface StateMachineInspection<
  S extends string,
> extends StateMachineSaveData<S> {
  readonly lastTransition: StateTransition<S> | null;
  /** Absent when the current state has no parent. */
  readonly parent?: S;
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

/** A state's timed advance, present only when `for` and `next` are declared. */
interface StateTimer<S extends string> {
  readonly duration: number | (() => number);
  readonly next: S;
}

/** A {@link StateTimer} with its duration resolved for one entry. */
interface EntryTimer<S extends string> {
  readonly duration: number;
  readonly next: S;
}

/** One state resolved against the whole table. */
interface CompiledState<S extends string> {
  readonly name: S;
  readonly definition: ChildStateDefinition<S>;
  readonly timer: StateTimer<S> | null;
  /** Declared targets, by name. Linked once every state exists. */
  readonly to: Map<S, CompiledState<S>>;
  /** Parent whose `states` block declares this one. Linked, null at the top. */
  parent: CompiledState<S> | null;
  /** Child entered with this state. Linked, non-null exactly for parents. */
  start: CompiledState<S> | null;
}

/** How the machine runs game callbacks. An owner replaces it to attribute throws. */
/**
 * A typed state machine driven by its owner's clock.
 *
 * States are named, edges are declared, and illegal moves throw. Call
 * {@link tick} from the update path whose clock the machine should follow; a
 * component's `dt` already includes scene and entity time scaling, so pass it
 * through unchanged.
 *
 * ```ts
 * class Guard extends Component {
 *   readonly mode = this.stateMachine(
 *     defineStates({
 *       patrol: { to: ["alert"] },
 *       alert: { to: ["patrol"], for: 1, next: "patrol" },
 *     }),
 *     "patrol",
 *   );
 *
 *   update(dt: number): void {
 *     if (this.mode.is("patrol") && this.seesPlayer()) this.mode.go("alert");
 *     this.mode.tick(dt);
 *   }
 * }
 * ```
 *
 * The machine owns when the state changes. The owner owns what each state
 * does, in its own update.
 */
export class StateMachine<const S extends string> implements Serializable<
  StateMachineSaveData<S>
> {
  /**
   * Tokens for {@link on}, and for `entity.on` when the machine was given an
   * `events` name.
   */
  readonly events: StateMachineEvents<S>;

  private readonly states: ReadonlyMap<S, CompiledState<S>>;
  private readonly fromAny: ReadonlyMap<S, CompiledState<S>>;
  private current: CompiledState<S>;
  private elapsedInState = 0;
  private elapsedInParent = 0;
  private timerInState: EntryTimer<S> | null = null;
  private timerInParent: EntryTimer<S> | null = null;
  private entered = false;
  private changing = false;
  private warnedSaturation = false;
  private previous: StateTransition<S> | null = null;
  private listeners:
    | Map<EventToken<unknown>, Set<(payload: never) => void>>
    | undefined;
  /** Whether {@link events} also belongs on the owning entity. */
  private readonly published: boolean;
  private owner: StateMachineOwner | undefined;

  constructor(
    states: StateDefinitions<S>,
    initial: NoInfer<S>,
    options?: StateMachineOptions,
  ) {
    const published = options?.events;
    if (published !== undefined && published.length === 0) {
      throw new Error("StateMachine: events must be a non-empty name.");
    }
    this.published = published !== undefined;
    this.events = published
      ? {
          changed: new EventToken(`${published}:changed`),
          entered: new EventToken(`${published}:entered`),
          exited: new EventToken(`${published}:exited`),
        }
      : PRIVATE_EVENT_TOKENS;
    const { compiled, fromAny } = compile(states);
    this.states = compiled;
    this.fromAny = fromAny;
    const start = this.states.get(initial);
    if (!start) {
      throw new Error(`StateMachine: unknown initial state "${initial}".`);
    }
    this.current = start.start ?? start;
  }

  /** @internal Attribute game callbacks, and reach the entity, through an owner. */
  _setOwner(owner: StateMachineOwner): this {
    this.owner = owner;
    return this;
  }

  /** Current state. A parent is never current; its child is. */
  get state(): S {
    return this.current.name;
  }

  /** Seconds accumulated in the current state. */
  get elapsed(): number {
    return this.elapsedInState;
  }

  /** Most recent completed transition, or `null` before the first one. */
  get lastTransition(): StateTransition<S> | null {
    return this.previous;
  }

  /** Whether `state` is the current state or its parent. */
  is(state: NoInfer<S>): boolean {
    return this.current.name === state || this.current.parent?.name === state;
  }

  /**
   * Run the initial state's `enter` hook. Optional: the first {@link tick}
   * does the same. Call it from `onAdd` to run the hook before the first
   * frame. Construction and {@link hydrate} run no hooks, so an owner can
   * finish assigning dependencies first.
   */
  start(): void {
    this.assertSettled("start");
    if (this.entered) return;
    this.enterInitial();
  }

  /**
   * Enter a state the current one declares in `to`. A child also reaches
   * everything its parent declares. Naming a parent enters that parent's
   * `start` child.
   *
   * Illegal moves throw before any hook runs. Naming the current state
   * restarts it when it lists itself in `to`, and does nothing otherwise.
   */
  go(to: NoInfer<S>): void {
    this.assertSettled("go");
    const from = this.current;
    const target = this.target(from, to);
    if (!target) {
      if (to === from.name) return;
      throw new Error(
        `StateMachine.go: transition "${from.name}" -> "${to}" is not declared.`,
      );
    }
    this.change(from, target);
  }

  /**
   * Whether the current state can reach `to`, so a {@link go} would move the
   * machine rather than throw or do nothing. Use it where a callback can
   * arrive after the state moved on, such as an animation finishing after the
   * entity already died.
   */
  canGo(to: NoInfer<S>): boolean {
    return this.target(this.current, to) !== undefined;
  }

  /**
   * Advance the current state's timer by a finite, non-negative `dt`, entering
   * `next` when the duration is reached. Time past a boundary is discarded, so
   * one call advances the current state once. Inside a sequence the parent's
   * own deadline is checked after that, and can end the sequence in the same
   * call. The first call also runs the initial `enter` hook if {@link start}
   * has not.
   */
  tick(dt: number): void {
    this.assertSettled("tick");
    if (!Number.isFinite(dt) || dt < 0) {
      throw new Error(
        `StateMachine.tick: dt must be a finite number >= 0 in seconds, got ${dt}.`,
      );
    }
    if (!this.entered) this.enterInitial();
    if (dt === 0) return;

    const parent = this.current.parent;
    const timer = this.timerInState;
    const parentTimer = this.timerInParent;
    this.elapsedInState = this.advance(this.elapsedInState, dt, timer);
    if (parent) {
      this.elapsedInParent = this.advance(
        this.elapsedInParent,
        dt,
        parentTimer,
      );
    }

    if (timer && durationReached(this.elapsedInState, timer.duration)) {
      this.go(timer.next);
    }
    // Moving between phases keeps the parent's clock running, so its deadline
    // is still due on this tick.
    if (
      parentTimer &&
      this.current.parent === parent &&
      durationReached(this.elapsedInParent, parentTimer.duration)
    ) {
      this.go(parentTimer.next);
    }
  }

  /**
   * Subscribe to one of this machine's {@link events}. Returns an unsubscribe
   * function. Handlers run inside the transition, so they may not call
   * {@link go}, {@link tick}, {@link start} or {@link hydrate} on this
   * machine; they may on another.
   */
  on<T>(token: EventToken<T>, handler: (payload: T) => void): () => void {
    const listeners = (this.listeners ??= new Map());
    let handlers = listeners.get(token as EventToken<unknown>);
    if (!handlers) {
      handlers = new Set();
      listeners.set(token as EventToken<unknown>, handlers);
    }
    const entry = handler as (payload: never) => void;
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  }

  serialize(): StateMachineSaveData<S> {
    const state = this.current;
    const parent = state.parent;
    return {
      state: state.name,
      elapsed: this.elapsedInState,
      ...(computesDuration(state) &&
        this.timerInState && { duration: this.timerInState.duration }),
      ...(parent && { parentElapsed: this.elapsedInParent }),
      ...(parent &&
        computesDuration(parent) &&
        this.timerInParent && { parentDuration: this.timerInParent.duration }),
    };
  }

  /**
   * Restore state and elapsed time without running `exit` or `enter` hooks. A
   * snapshot that carries a computed duration resumes on that duration; one
   * that does not asks the state's `for` callback for a fresh value.
   */
  hydrate(raw: StateMachineSaveData<S>): void {
    this.assertSettled("hydrate");
    if (!raw || typeof raw !== "object") {
      throw new Error("StateMachine.hydrate: snapshot must be an object.");
    }
    const state =
      typeof raw.state === "string" ? this.states.get(raw.state) : undefined;
    if (!state) {
      throw new Error(
        `StateMachine.hydrate: unknown state "${String(raw.state)}".`,
      );
    }
    if (state.start) {
      throw new Error(
        `StateMachine.hydrate: "${state.name}" holds child states; a snapshot names the child that was current.`,
      );
    }
    this.changing = true;
    let timer: EntryTimer<S> | null;
    let parentTimer: EntryTimer<S> | null;
    try {
      timer = this.restoreTimer(state, raw.duration);
      parentTimer = state.parent
        ? this.restoreTimer(state.parent, raw.parentDuration)
        : null;
    } finally {
      this.changing = false;
    }
    const elapsed = checkElapsed("elapsed", raw.elapsed, state.name, timer);
    const parentElapsed = state.parent
      ? checkElapsed(
          "parentElapsed",
          raw.parentElapsed ?? 0,
          state.parent.name,
          parentTimer,
        )
      : 0;

    this.current = state;
    this.timerInState = timer;
    this.timerInParent = parentTimer;
    this.elapsedInState = elapsed;
    this.elapsedInParent = parentElapsed;
    this.previous = null;
    this.entered = true;
  }

  /** Plain data used by the Inspector's component-field reflection. */
  toJSON(): StateMachineInspection<S> {
    return {
      ...this.serialize(),
      lastTransition: this.previous,
      ...(this.current.parent && { parent: this.current.parent.name }),
    };
  }

  private change(from: CompiledState<S>, target: CompiledState<S>): void {
    const leaf = target.start ?? target;
    const transition: StateTransition<S> = { from: from.name, to: leaf.name };
    // Naming a parent re-enters it, even the one already current. Before the
    // first entry there is no parent to keep, so the target's is entered.
    const crossesParent =
      !this.entered || target.start !== null || leaf.parent !== from.parent;

    this.changing = true;
    try {
      // Resolved first: a `for` callback that throws leaves the machine where
      // it was, like an exit hook that throws.
      const timer = this.resolveTimer(leaf);
      let parentTimer = this.timerInParent;
      if (leaf.parent) {
        if (crossesParent) parentTimer = this.resolveTimer(leaf.parent);
      } else {
        parentTimer = null;
      }

      if (this.entered) {
        this.exitState(from, transition);
        if (crossesParent && from.parent) {
          this.exitState(from.parent, transition);
        }
      }

      this.current = leaf;
      this.timerInState = timer;
      this.timerInParent = parentTimer;
      this.elapsedInState = 0;
      if (crossesParent) this.elapsedInParent = 0;
      this.previous = transition;
      this.entered = true;

      if (crossesParent && leaf.parent) {
        this.enterState(leaf.parent, transition);
      }
      this.enterState(leaf, transition);
      this.emit(
        this.events.changed,
        "changed event",
        `${transition.from} -> ${transition.to}`,
        transition,
      );
    } finally {
      this.changing = false;
    }
  }

  private enterInitial(): void {
    this.changing = true;
    try {
      const leaf = this.current;
      // Resolved before anything commits, so a `for` callback that throws
      // leaves the machine un-entered and the next start() or tick() retries.
      const timer = this.resolveTimer(leaf);
      const parentTimer = leaf.parent ? this.resolveTimer(leaf.parent) : null;

      this.timerInState = timer;
      this.timerInParent = parentTimer;
      this.entered = true;

      if (leaf.parent) this.enterState(leaf.parent, null);
      this.enterState(leaf, null);
    } finally {
      this.changing = false;
    }
  }

  /**
   * Take a state's duration back from a snapshot, falling back to the table
   * for a fixed `for` and to the callback for a snapshot that carries none.
   */
  private restoreTimer(
    state: CompiledState<S>,
    saved: number | undefined,
  ): EntryTimer<S> | null {
    const timer = state.timer;
    if (!timer) return null;
    if (saved === undefined || !computesDuration(state)) {
      return this.resolveTimer(state);
    }
    assertDuration(`StateMachine.hydrate: state "${state.name}"`, saved);
    return { duration: saved, next: timer.next };
  }

  /** Read a state's duration for one entry, calling a `for` callback once. */
  private resolveTimer(state: CompiledState<S>): EntryTimer<S> | null {
    const timer = state.timer;
    if (!timer) return null;
    const declared = timer.duration;
    if (typeof declared === "number") {
      return { duration: declared, next: timer.next };
    }
    let duration = Number.NaN;
    this.runCallback("duration callback", state.name, () => {
      duration = declared();
    });
    assertDuration(`StateMachine state "${state.name}"`, duration);
    return { duration, next: timer.next };
  }

  /** The state `go(to)` would enter, or undefined when no edge declares it. */
  private target(from: CompiledState<S>, to: S): CompiledState<S> | undefined {
    const declared = from.to.get(to) ?? from.parent?.to.get(to);
    if (declared) return declared;
    const anywhere = this.fromAny.get(to);
    return anywhere && anywhere !== from ? anywhere : undefined;
  }

  private enterState(
    state: CompiledState<S>,
    transition: StateTransition<S> | null,
  ): void {
    const event = transition
      ? `${transition.from} -> ${state.name}`
      : state.name;
    const enter = state.definition.enter;
    if (enter) this.runCallback("enter hook", event, () => enter(transition));
    this.emit(this.events.entered, "entered event", event, {
      state: state.name,
      from: transition?.from ?? null,
    });
  }

  private exitState(
    state: CompiledState<S>,
    transition: StateTransition<S>,
  ): void {
    const event = `${state.name} -> ${transition.to}`;
    const exit = state.definition.exit;
    if (exit) this.runCallback("exit hook", event, () => exit(transition));
    this.emit(this.events.exited, "exited event", event, {
      state: state.name,
      to: transition.to,
    });
  }

  private emit<T>(
    token: EventToken<T>,
    kind: string,
    event: string,
    payload: T,
  ): void {
    const handlers = this.listeners?.get(token as EventToken<unknown>);
    if (handlers?.size) {
      for (const handler of [...handlers] as Array<(payload: T) => void>) {
        this.runCallback(kind, event, () => handler(payload));
      }
    }
    if (this.published) this.owner?.emit(token, payload);
  }

  /** Run a game callback, attributed to the owner when there is one. */
  private runCallback(kind: string, event: string, call: () => void): void {
    if (this.owner) this.owner.run(kind, event, call);
    else call();
  }

  private advance(
    elapsed: number,
    dt: number,
    timer: EntryTimer<S> | null,
  ): number {
    const step = timer
      ? Math.min(dt, Math.max(0, timer.duration - elapsed))
      : dt;
    const next = elapsed + step;
    if (Number.isFinite(next)) return next;
    if (!this.warnedSaturation) {
      this.warnedSaturation = true;
      devWarn(
        "StateMachine.tick: elapsed time exceeded Number.MAX_VALUE and was capped.",
      );
    }
    return Number.MAX_VALUE;
  }

  private assertSettled(method: string): void {
    if (this.changing) {
      throw new Error(
        `StateMachine.${method}: cannot run while the machine is changing state.`,
      );
    }
  }
}

/** Whether a state computes its duration on entry rather than declaring one. */
function computesDuration<S extends string>(state: CompiledState<S>): boolean {
  return typeof state.timer?.duration === "function";
}

function checkElapsed<S extends string>(
  field: string,
  value: number,
  state: S,
  timer: EntryTimer<S> | null,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `StateMachine.hydrate: ${field} must be a finite number >= 0 in seconds, got ${value}.`,
    );
  }
  if (timer && value > timer.duration) {
    throw new Error(
      `StateMachine.hydrate: ${field} ${value} exceeds state "${state}" duration ${timer.duration}.`,
    );
  }
  return value;
}

/** Resolve a transition table into linked states, rejecting a malformed one. */
function compile<S extends string>(
  states: StateDefinitions<S>,
): {
  compiled: ReadonlyMap<S, CompiledState<S>>;
  fromAny: ReadonlyMap<S, CompiledState<S>>;
} {
  const compiled = new Map<S, CompiledState<S>>();
  const fromAny = new Map<S, CompiledState<S>>();
  const edges: Array<[CompiledState<S>, readonly S[]]> = [];
  const starts: Array<[CompiledState<S>, S]> = [];

  const declare = (
    name: S,
    definition: ChildStateDefinition<S>,
    parent: CompiledState<S> | null,
  ): CompiledState<S> => {
    if (compiled.has(name)) {
      throw new Error(`StateMachine: state "${name}" is declared twice.`);
    }
    const duration = definition.for;
    const next = definition.next;
    if (duration === undefined && next !== undefined) {
      throw new Error(
        `StateMachine: state "${name}" has next without a duration.`,
      );
    }
    if (duration !== undefined && next === undefined) {
      throw new Error(
        `StateMachine: state "${name}" has a duration without next.`,
      );
    }
    if (typeof duration === "number") {
      assertDuration(`StateMachine state "${name}"`, duration);
    }
    const state: CompiledState<S> = {
      name,
      definition,
      timer:
        duration !== undefined && next !== undefined
          ? { duration, next }
          : null,
      to: new Map(),
      parent,
      start: null,
    };
    compiled.set(name, state);
    edges.push([state, definition.to ?? []]);
    return state;
  };

  for (const [name, definition] of Object.entries(states) as Array<
    [S, StateDefinition<S>]
  >) {
    const parent = declare(name, definition, null);
    if (definition.fromAny) fromAny.set(name, parent);
    if (definition.states) {
      if (definition.start === undefined) {
        throw new Error(
          `StateMachine: state "${name}" holds child states and needs a start.`,
        );
      }
      starts.push([parent, definition.start]);
      for (const [child, childDefinition] of Object.entries(
        definition.states,
      ) as Array<[S, ChildStateDefinition<S>]>) {
        declare(child, childDefinition, parent);
      }
    } else if (definition.start !== undefined) {
      throw new Error(
        `StateMachine: state "${name}" declares a start without child states.`,
      );
    }
  }

  if (compiled.size === 0) {
    throw new Error("StateMachine: states must declare at least one state.");
  }

  for (const [parent, startName] of starts) {
    const child = compiled.get(startName);
    if (!child || child.parent !== parent) {
      throw new Error(
        `StateMachine: state "${parent.name}" start "${startName}" is not one of its child states.`,
      );
    }
    parent.start = child;
  }

  for (const [state, targets] of edges) {
    for (const name of targets) {
      const target = compiled.get(name);
      if (!target) {
        throw new Error(
          `StateMachine: state "${state.name}" targets unknown state "${name}".`,
        );
      }
      const holder = target.parent;
      if (holder !== null && holder !== state && holder !== state.parent) {
        throw new Error(
          `StateMachine: state "${state.name}" cannot target "${name}", a child of "${holder.name}". Target "${holder.name}" to enter its child states.`,
        );
      }
      state.to.set(name, target);
    }
    if (state.timer) {
      const anywhere = fromAny.get(state.timer.next);
      const next =
        state.to.get(state.timer.next) ??
        state.parent?.to.get(state.timer.next) ??
        (anywhere === state ? undefined : anywhere);
      if (!next) {
        throw new Error(
          `StateMachine: state "${state.name}" cannot advance to "${state.timer.next}", which it cannot reach.`,
        );
      }
      if (next === state) {
        throw new Error(
          `StateMachine: timed state "${state.name}" cannot advance to itself.`,
        );
      }
      // Moving between children keeps the parent's clock, so a parent that
      // advanced into one of them would sit on its boundary and fire forever.
      if (next.parent === state) {
        throw new Error(
          `StateMachine: timed state "${state.name}" cannot advance to "${next.name}", one of its own child states.`,
        );
      }
    }
  }

  return { compiled, fromAny };
}
