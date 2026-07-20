import type { InputManager } from "@yagejs/input";
import type { Abilities } from "../core/Abilities.js";
import type { AbilityActivation } from "../core/types.js";

/** Input interactions recognized by {@link AbilityDriver}. */
export type AbilityGesture = "press" | "tap" | "hold" | "release";

/** A value captured when an input interaction triggers. */
export type AbilityData =
  | null
  | string
  | number
  | boolean
  | bigint
  | symbol
  | object;

/** Stable information about the input interaction that triggered a send. */
export interface AbilityGestureContext<
  TAction extends string = string,
  TIntent extends string = string,
> {
  readonly action: TAction;
  readonly gesture: AbilityGesture;
  readonly intent: TIntent;
  readonly lane: string;
  /** Raw input seconds held when this interaction triggered. */
  readonly heldFor: number;
  /** The activation owned by this press, when one exists. */
  readonly activation: AbilityActivation | null;
}

/** Information passed to admission and pre-send hooks. */
export interface AbilityFireContext<
  TAction extends string = string,
  TIntent extends string = string,
> extends AbilityGestureContext<TAction, TIntent> {
  /** Data captured at the interaction edge. */
  readonly data: unknown;
}

export type AbilityDataResolver<
  TAction extends string = string,
  TIntent extends string = string,
> = (context: AbilityGestureContext<TAction, TIntent>) => unknown;

/** One intent sent by an input interaction. */
export interface AbilitySend<
  TAction extends string = string,
  TIntent extends string = string,
> {
  readonly send: TIntent;
  /** Raw seconds after the interaction edge during which polite retries may fire. */
  readonly buffer?: number;
  /** A fixed value or a resolver evaluated at the interaction edge. */
  readonly data?: AbilityData | AbilityDataResolver<TAction, TIntent>;
}

/** A tap interaction. */
export interface AbilityTap<
  TAction extends string = string,
  TIntent extends string = string,
> extends AbilitySend<TAction, TIntent> {
  /** Maximum raw hold time in seconds. */
  readonly within?: number;
}

/** A hold interaction. */
export interface AbilityHold<
  TAction extends string = string,
  TIntent extends string = string,
> extends AbilitySend<TAction, TIntent> {
  /** Raw hold time in seconds before the interaction triggers. */
  readonly at?: number;
  /** Only trigger when the lane was idle on press and remains idle at the threshold. */
  readonly fromNeutral?: boolean;
  /** Politely re-enter a cancelled hold while the action remains pressed. */
  readonly resume?: boolean;
  /** Intent sent on release. Omit to complete the active hold automatically. */
  readonly release?: AbilitySend<TAction, TIntent>;
}

/** Interactions attached to one input action. */
export interface AbilityBinding<
  TAction extends string = string,
  TIntent extends string = string,
> {
  /** Ability lane used for admission checks. Default `"main"`. */
  readonly lane?: string;
  readonly press?: AbilitySend<TAction, TIntent>;
  readonly tap?: AbilityTap<TAction, TIntent>;
  readonly hold?: AbilityHold<TAction, TIntent>;
  /** Re-evaluated before each send attempt. */
  readonly gate?: (context: AbilityFireContext<TAction, TIntent>) => boolean;
}

export interface AbilityDriverDefaults {
  readonly tapWithin?: number;
  readonly holdAt?: number;
}

export interface AbilityDriverOptions<
  TAction extends string = string,
  TIntent extends string = string,
> {
  readonly defaults?: AbilityDriverDefaults;
  readonly bindings: Readonly<
    Partial<Record<TAction, AbilityBinding<TAction, TIntent>>>
  >;
  /** Runs after admission and immediately before each driver-issued send. */
  readonly beforeFire?: (context: AbilityFireContext<TAction, TIntent>) => void;
}

interface ResolvedSend<TAction extends string, TIntent extends string> {
  readonly send: TIntent;
  readonly buffer: number | undefined;
  readonly data:
    | AbilityData
    | AbilityDataResolver<TAction, TIntent>
    | undefined;
}

interface ResolvedTap<
  TAction extends string,
  TIntent extends string,
> extends ResolvedSend<TAction, TIntent> {
  readonly within: number;
}

interface ResolvedHold<
  TAction extends string,
  TIntent extends string,
> extends ResolvedSend<TAction, TIntent> {
  readonly at: number;
  readonly fromNeutral: boolean;
  readonly resume: boolean;
  readonly release: ResolvedSend<TAction, TIntent> | undefined;
}

interface ResolvedBinding<TAction extends string, TIntent extends string> {
  readonly action: TAction;
  readonly lane: string;
  readonly press: ResolvedSend<TAction, TIntent> | undefined;
  readonly tap: ResolvedTap<TAction, TIntent> | undefined;
  readonly hold: ResolvedHold<TAction, TIntent> | undefined;
  readonly gate:
    | ((context: AbilityFireContext<TAction, TIntent>) => boolean)
    | undefined;
}

interface PressState<TAction extends string, TIntent extends string> {
  readonly action: TAction;
  readonly binding: ResolvedBinding<TAction, TIntent>;
  readonly pressedAt: number;
  readonly neutral: boolean;
  released: boolean;
  holdTriggered: boolean;
  pressActivation: AbilityActivation | null;
  holdActivation: AbilityActivation | null;
  lastActivation: AbilityActivation | null;
  holdContext: AbilityFireContext<TAction, TIntent> | null;
}

type EdgeRecord<TAction extends string> =
  | {
      readonly action: TAction;
      readonly kind: "press";
      readonly time: number;
      readonly neutral: boolean;
    }
  | {
      readonly action: TAction;
      readonly kind: "release";
      readonly time: number;
    };

interface PendingSend<TAction extends string, TIntent extends string> {
  readonly binding: ResolvedBinding<TAction, TIntent>;
  readonly owner: PressState<TAction, TIntent>;
  readonly slot: ResolvedSend<TAction, TIntent>;
  readonly context: AbilityFireContext<TAction, TIntent>;
  readonly deadline: number;
  readonly requireNeutral: boolean;
  readonly onSuccess: ((activation: AbilityActivation) => void) | undefined;
  cancelled: boolean;
}

function assertDuration(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`AbilityDriver: ${name} must be a finite number >= 0.`);
  }
}

function phaseIsHeld(activation: AbilityActivation): boolean {
  const def = activation.def;
  if (def.phases === undefined) return false;
  return Boolean(def.phases[activation.phase]?.hold);
}

/**
 * Maps input actions to ability intents and owns gesture timing, buffering,
 * hold release, and interrupted-hold recovery.
 */
export class AbilityDriver<
  TAction extends string = string,
  TIntent extends string = string,
> {
  private readonly bindings = new Map<
    TAction,
    ResolvedBinding<TAction, TIntent>
  >();
  private readonly records: Array<EdgeRecord<TAction>> = [];
  private readonly presses = new Map<TAction, PressState<TAction, TIntent>>();
  private readonly pending: Array<PendingSend<TAction, TIntent>> = [];
  private readonly disposers: Array<() => void> = [];
  private readonly beforeFire:
    | ((context: AbilityFireContext<TAction, TIntent>) => void)
    | undefined;
  private disposed = false;

  constructor(
    private readonly input: InputManager,
    private readonly abilities: Abilities,
    options: AbilityDriverOptions<TAction, TIntent>,
  ) {
    this.beforeFire = options.beforeFire;
    const defaults = options.defaults ?? {};
    if (defaults.tapWithin !== undefined) {
      assertDuration("defaults.tapWithin", defaults.tapWithin);
    }
    if (defaults.holdAt !== undefined) {
      assertDuration("defaults.holdAt", defaults.holdAt);
    }

    for (const action of Object.keys(options.bindings) as TAction[]) {
      const binding = options.bindings[action];
      if (!binding) continue;
      if (!this.input.hasAction(action)) {
        throw new Error(`AbilityDriver: unknown input action "${action}".`);
      }
      const resolved = this.resolveBinding(action, binding, defaults);
      this.bindings.set(action, resolved);
    }

    for (const action of this.bindings.keys()) {
      this.disposers.push(
        this.input.onAction(action, () => this.recordPress(action)),
        this.input.onActionReleased(action, () => {
          if (!this.input.isPressed(action)) this.recordRelease(action);
        }),
      );
    }
  }

  /** Process recorded edges and retry pending intents. Call once per update. */
  update(): void {
    if (this.disposed) return;
    const now = this.input.getClockTime();

    this.retryPending(now);

    const records = this.records.splice(0);
    for (const record of records) {
      if (record.kind === "press") this.handlePress(record);
      else this.handleRelease(record);
    }

    for (const state of [...this.presses.values()]) {
      if (!this.input.isPressed(state.action)) {
        this.handleRelease({
          action: state.action,
          kind: "release",
          time: now,
        });
        continue;
      }
      this.triggerCrossedHold(state, now);
      this.resumeCancelledHold(state);
    }

    this.compactPending();
  }

  /** Remove input listeners and discard recorded or pending interactions. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.records.length = 0;
    this.pending.length = 0;
    this.presses.clear();
  }

  private resolveBinding(
    action: TAction,
    binding: AbilityBinding<TAction, TIntent>,
    defaults: AbilityDriverDefaults,
  ): ResolvedBinding<TAction, TIntent> {
    if (!binding.press && !binding.tap && !binding.hold) {
      throw new Error(
        `AbilityDriver: binding "${action}" must declare press, tap, or hold.`,
      );
    }
    const lane = binding.lane ?? "main";
    if (lane.length === 0) {
      throw new Error(`AbilityDriver: binding "${action}" has an empty lane.`);
    }
    const press = binding.press
      ? this.resolveSend(`${action}.press`, binding.press)
      : undefined;
    const holdAt = binding.hold?.at ?? defaults.holdAt;
    let hold: ResolvedHold<TAction, TIntent> | undefined;
    if (binding.hold) {
      if (holdAt === undefined) {
        throw new Error(
          `AbilityDriver: binding "${action}" needs hold.at or defaults.holdAt.`,
        );
      }
      assertDuration(`${action}.hold.at`, holdAt);
      hold = {
        ...this.resolveSend(`${action}.hold`, binding.hold),
        at: holdAt,
        fromNeutral: binding.hold.fromNeutral ?? false,
        resume: binding.hold.resume ?? false,
        release: binding.hold.release
          ? this.resolveSend(`${action}.hold.release`, binding.hold.release)
          : undefined,
      };
    }
    let tap: ResolvedTap<TAction, TIntent> | undefined;
    if (binding.tap) {
      const within = binding.tap.within ?? defaults.tapWithin ?? holdAt;
      if (within === undefined) {
        throw new Error(
          `AbilityDriver: binding "${action}" needs tap.within, defaults.tapWithin, or a paired hold threshold.`,
        );
      }
      assertDuration(`${action}.tap.within`, within);
      tap = {
        ...this.resolveSend(`${action}.tap`, binding.tap),
        within,
      };
    }
    return {
      action,
      lane,
      press,
      tap,
      hold,
      gate: binding.gate,
    };
  }

  private resolveSend(
    name: string,
    slot: AbilitySend<TAction, TIntent>,
  ): ResolvedSend<TAction, TIntent> {
    if (slot.send.length === 0) {
      throw new Error(`AbilityDriver: ${name}.send cannot be empty.`);
    }
    if (slot.buffer !== undefined) {
      assertDuration(`${name}.buffer`, slot.buffer);
    }
    return {
      send: slot.send,
      buffer: slot.buffer,
      data: slot.data,
    };
  }

  private recordPress(action: TAction): void {
    if (this.disposed) return;
    const binding = this.bindings.get(action);
    if (!binding) return;
    this.records.push({
      action,
      kind: "press",
      time: this.input.getClockTime(),
      neutral: !this.abilities.isActive(binding.lane),
    });
  }

  private recordRelease(action: TAction): void {
    if (this.disposed) return;
    this.records.push({
      action,
      kind: "release",
      time: this.input.getClockTime(),
    });
  }

  private handlePress(
    record: Extract<EdgeRecord<TAction>, { kind: "press" }>,
  ): void {
    if (this.presses.has(record.action)) return;
    const binding = this.bindings.get(record.action);
    if (!binding) return;
    const state: PressState<TAction, TIntent> = {
      action: record.action,
      binding,
      pressedAt: record.time,
      neutral: record.neutral,
      released: false,
      holdTriggered: false,
      pressActivation: null,
      holdActivation: null,
      lastActivation: null,
      holdContext: null,
    };
    this.presses.set(record.action, state);
    const press = binding.press;
    if (press) {
      this.triggerSend(state, press, "press", record.time, 0, (activation) => {
        state.pressActivation = activation;
        state.lastActivation = activation;
        if (state.released && this.ownsActiveHold(activation)) {
          this.abilities.release(press.send);
        }
      });
    }
  }

  private handleRelease(
    record: Extract<EdgeRecord<TAction>, { kind: "release" }>,
  ): void {
    const state = this.presses.get(record.action);
    if (!state || state.released) return;
    state.released = true;
    this.presses.delete(record.action);
    const heldFor = Math.max(0, record.time - state.pressedAt);
    const hold = state.binding.hold;

    if (hold && !state.holdTriggered && heldFor > hold.at) {
      this.triggerHold(state, state.pressedAt + hold.at);
    }

    this.cancelPendingHold(state);

    if (
      state.pressActivation &&
      state.binding.press &&
      this.ownsActiveHold(state.pressActivation)
    ) {
      this.abilities.release(state.binding.press.send);
    }

    if (hold && state.holdActivation) {
      if (hold.release) {
        const activation = state.holdActivation;
        if (
          (activation.state === "cancelled" && phaseIsHeld(activation)) ||
          this.ownsActiveHold(activation)
        ) {
          this.triggerSend(
            state,
            hold.release,
            "release",
            record.time,
            heldFor,
          );
        }
      } else if (this.ownsActiveHold(state.holdActivation)) {
        this.abilities.release(hold.send);
      }
    }

    if (!state.holdTriggered && state.binding.tap) {
      if (heldFor <= state.binding.tap.within) {
        this.triggerSend(state, state.binding.tap, "tap", record.time, heldFor);
      }
    }
  }

  private triggerCrossedHold(
    state: PressState<TAction, TIntent>,
    now: number,
  ): void {
    const hold = state.binding.hold;
    if (!hold || state.holdTriggered) return;
    if (now < state.pressedAt + hold.at) return;
    this.triggerHold(state, state.pressedAt + hold.at);
  }

  private triggerHold(
    state: PressState<TAction, TIntent>,
    triggerTime: number,
  ): void {
    const hold = state.binding.hold;
    if (!hold || state.holdTriggered) return;
    state.holdTriggered = true;
    if (hold.fromNeutral) {
      if (!state.neutral || this.abilities.isActive(state.binding.lane)) return;
    }
    const context = this.captureContext(state, hold, "hold", hold.at);
    state.holdContext = context;
    this.triggerCapturedSend(
      state,
      hold,
      context,
      triggerTime,
      (activation) => {
        state.holdActivation = activation;
        state.lastActivation = activation;
      },
      hold.fromNeutral,
    );
  }

  private resumeCancelledHold(state: PressState<TAction, TIntent>): void {
    const hold = state.binding.hold;
    const activation = state.holdActivation;
    if (!hold?.resume || !activation) return;
    if (activation.state !== "cancelled") return;
    if (!phaseIsHeld(activation)) return;
    if (!this.input.isPressed(state.action)) return;

    const context = state.holdContext;
    if (!context) return;
    const result = this.trySend(state.binding, hold, context, true, false);
    if (result) {
      state.holdActivation = result;
      state.lastActivation = result;
    }
  }

  private triggerSend(
    state: PressState<TAction, TIntent>,
    slot: ResolvedSend<TAction, TIntent>,
    gesture: AbilityGesture,
    triggerTime: number,
    heldFor: number,
    onSuccess?: (activation: AbilityActivation) => void,
  ): void {
    const context = this.captureContext(state, slot, gesture, heldFor);
    this.triggerCapturedSend(state, slot, context, triggerTime, onSuccess);
  }

  private triggerCapturedSend(
    state: PressState<TAction, TIntent>,
    slot: ResolvedSend<TAction, TIntent>,
    context: AbilityFireContext<TAction, TIntent>,
    triggerTime: number,
    onSuccess?: (activation: AbilityActivation) => void,
    requireNeutral = false,
  ): void {
    const polite = slot.buffer !== undefined;
    const deadline =
      slot.buffer !== undefined ? triggerTime + slot.buffer : undefined;
    if (deadline !== undefined && this.input.getClockTime() > deadline) return;
    const result = this.trySend(
      state.binding,
      slot,
      context,
      polite,
      requireNeutral,
    );
    if (result) {
      onSuccess?.(result);
      return;
    }
    if (slot.buffer === undefined) return;
    const pending: PendingSend<TAction, TIntent> = {
      binding: state.binding,
      owner: state,
      slot,
      context,
      deadline: triggerTime + slot.buffer,
      requireNeutral,
      onSuccess,
      cancelled: false,
    };
    this.pending.push(pending);
  }

  private captureContext(
    state: PressState<TAction, TIntent>,
    slot: ResolvedSend<TAction, TIntent>,
    gesture: AbilityGesture,
    heldFor: number,
  ): AbilityFireContext<TAction, TIntent> {
    const base: AbilityGestureContext<TAction, TIntent> = {
      action: state.action,
      gesture,
      intent: slot.send,
      lane: state.binding.lane,
      heldFor,
      activation: state.holdActivation ?? state.lastActivation,
    };
    const data = typeof slot.data === "function" ? slot.data(base) : slot.data;
    return { ...base, data };
  }

  private trySend(
    binding: ResolvedBinding<TAction, TIntent>,
    slot: ResolvedSend<TAction, TIntent>,
    context: AbilityFireContext<TAction, TIntent>,
    polite: boolean,
    requireNeutral: boolean,
  ): AbilityActivation | null {
    if (binding.gate && !binding.gate(context)) return null;
    if (requireNeutral && this.abilities.isActive(binding.lane)) return null;
    if (
      !this.abilities.canSend(
        slot.send,
        binding.lane,
        polite ? undefined : { interrupts: true },
      )
    ) {
      return null;
    }
    this.beforeFire?.(context);
    const result = this.abilities.send(slot.send, context.data, binding.lane);
    return result.ok ? result.activation : null;
  }

  private retryPending(now: number): void {
    for (const pending of this.pending) {
      if (pending.cancelled) continue;
      if (
        pending.context.gesture === "hold" &&
        !this.input.isPressed(pending.owner.action)
      ) {
        pending.cancelled = true;
        continue;
      }
      if (now > pending.deadline) {
        pending.cancelled = true;
        continue;
      }
      const result = this.trySend(
        pending.binding,
        pending.slot,
        pending.context,
        true,
        pending.requireNeutral,
      );
      if (!result) continue;
      pending.cancelled = true;
      pending.onSuccess?.(result);
    }
  }

  private cancelPendingHold(state: PressState<TAction, TIntent>): void {
    for (const pending of this.pending) {
      if (pending.owner === state && pending.context.gesture === "hold") {
        pending.cancelled = true;
      }
    }
  }

  private compactPending(): void {
    let write = 0;
    for (const pending of this.pending) {
      if (pending.cancelled) continue;
      this.pending[write++] = pending;
    }
    this.pending.length = write;
  }

  private ownsActiveHold(activation: AbilityActivation): boolean {
    return (
      activation.state === "active" &&
      this.abilities.active(activation.lane) === activation &&
      phaseIsHeld(activation)
    );
  }
}
