import type { EasingFunction } from "@yagejs/core";
import type {
  FeelEffectContext,
  FeelEffectDefinition,
  FeelEffectInstance,
  FeelNode,
  FeelRuntimeControl,
  FeelRuntimeNode,
  FeelRuntimeTiming,
  FeelStateInstance,
  FeelStateContext,
  FeelStateTiming,
  FeelTimedEffectContext,
} from "./types.js";
import { invokeFeelEasing } from "../internal/easing.js";

const TIME_EPSILON = 1e-9;
const linear: EasingFunction = (amount) => amount;

interface FeelFiniteSourceInstance {
  /** Callback attribution label used by the error boundary. */
  readonly label?: string;
  start?(): void;
  isComplete(): boolean;
  finish?(cancelled: boolean): void;
}

function validDuration(duration: number, label: string): number {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(
      `${label}: duration must be a finite number >= 0, got ${duration}.`,
    );
  }
  return duration;
}

function combinedDuration(duration: number, label: string): number {
  if (!Number.isFinite(duration)) {
    throw new Error(`${label}: combined duration must be finite.`);
  }
  return duration;
}

function invokeInstance(
  context: FeelEffectContext,
  instance: { readonly label?: string },
  hook: string,
  callback: () => void,
): void {
  context.invoke(instance.label ?? hook, callback);
}

function timedContext(
  context: FeelEffectContext,
  duration: number,
): FeelTimedEffectContext {
  return { ...context, duration };
}

function stateContext(context: FeelEffectContext): FeelStateContext {
  return { ...context, duration: null };
}

class TimedEffectRuntime implements FeelRuntimeNode {
  private instance: FeelEffectInstance | undefined;
  private started = false;
  private elapsed = 0;
  private finished = false;
  private _timelineComplete = false;
  private releaseSent = false;
  private acceptsRelease = true;

  constructor(
    private readonly definition: FeelEffectDefinition,
    private readonly context: FeelTimedEffectContext,
    private readonly timing: FeelRuntimeTiming,
    private readonly control: FeelRuntimeControl,
    private readonly duration: number,
  ) {}

  get timelineComplete(): boolean {
    return this._timelineComplete;
  }

  get complete(): boolean {
    return this.finished;
  }

  advance(dt: number): number {
    if (this.finished) return dt;
    if (!this.started) this.start();
    if (this.control.cancelled) return 0;
    if (this.control.released) this.release();
    if (this.finished) return dt;

    if (this._timelineComplete) {
      this.completeOwnedSource();
      return dt;
    }

    if (this.duration === 0) {
      this.update(1, 0);
      if (this.control.cancelled) return 0;
      this._timelineComplete = true;
      this.completeOwnedSource();
      return dt;
    }

    const activeDt = Math.min(dt, this.duration - this.elapsed);
    this.elapsed += activeDt;
    const progress =
      activeDt > 0 && this.elapsed + TIME_EPSILON >= this.duration
        ? 1
        : this.elapsed / this.duration;
    this.update(progress, this.timing.toLocalDelta(activeDt));
    if (this.control.cancelled) return 0;
    if (this.control.released) this.release();
    if (progress >= 1) {
      this._timelineComplete = true;
      this.completeOwnedSource();
    }
    return dt - activeDt;
  }

  release(): void {
    if (!this.acceptsRelease || this.releaseSent || this.finished) return;
    if (!this.started) return;
    this.releaseSent = true;
    const instance = this.instance;
    const release = instance?.release;
    if (instance && release) {
      invokeInstance(this.context, instance, "effect release", () =>
        release.call(instance),
      );
    }
    if (this._timelineComplete) this.completeOwnedSource();
  }

  cancel(): void {
    if (!this.started || this.finished) return;
    this.finish(true);
  }

  private start(): void {
    this.started = true;
    this.acceptsRelease = !this.control.released;
    let instance: FeelEffectInstance | undefined;
    this.context.invoke("effect create", () => {
      instance = this.definition.create(this.context);
    });
    if (!instance) {
      throw new Error("Feel: an effect factory did not return an instance.");
    }
    this.instance = instance;
    if (this.control.cancelled) return;
    const start = instance.start;
    if (start) {
      invokeInstance(this.context, instance, "effect start", () =>
        start.call(instance),
      );
    }
    if (this.control.cancelled) return;
    if (this.control.released) this.release();
  }

  private update(progress: number, dt: number): void {
    const instance = this.instance;
    const update = instance?.update;
    if (instance && update) {
      invokeInstance(this.context, instance, "effect update", () =>
        update.call(instance, progress, dt),
      );
    }
  }

  private completeOwnedSource(): void {
    const instance = this.instance;
    if (!instance) return;
    const isComplete = instance.isComplete;
    if (isComplete) {
      let complete = false;
      invokeInstance(this.context, instance, "effect completion", () => {
        complete = isComplete.call(instance);
      });
      if (!complete) return;
    }
    this.finish(false);
  }

  private finish(cancelled: boolean): void {
    if (this.finished) return;
    const instance = this.instance;
    const finish = instance?.finish;
    if (instance && finish) {
      invokeInstance(this.context, instance, "effect finish", () =>
        finish.call(instance, cancelled),
      );
    }
    this.finished = true;
  }
}

class FiniteSourceRuntime implements FeelRuntimeNode {
  private instance: FeelFiniteSourceInstance | undefined;
  private started = false;
  private finished = false;

  constructor(
    private readonly context: FeelTimedEffectContext,
    private readonly control: FeelRuntimeControl,
    private readonly create: (
      context: FeelTimedEffectContext,
    ) => FeelFiniteSourceInstance,
  ) {}

  get timelineComplete(): boolean {
    return this.finished;
  }

  get complete(): boolean {
    return this.finished;
  }

  advance(dt: number): number {
    if (this.finished) return dt;
    if (!this.started) this.start();
    if (this.control.cancelled) return 0;
    if (this.completeFromSource()) return dt;
    return 0;
  }

  release(): void {}

  cancel(): void {
    if (!this.started || this.finished) return;
    this.finish(true);
  }

  private start(): void {
    this.started = true;
    let instance: FeelFiniteSourceInstance | undefined;
    this.context.invoke("source effect create", () => {
      instance = this.create(this.context);
    });
    if (!instance) {
      throw new Error(
        "Feel: a source effect factory did not return an instance.",
      );
    }
    this.instance = instance;
    if (this.control.cancelled) return;
    const start = instance.start;
    if (start) {
      invokeInstance(this.context, instance, "source effect start", () =>
        start.call(instance),
      );
    }
  }

  private completeFromSource(): boolean {
    const instance = this.instance;
    if (!instance) return false;
    let complete = false;
    invokeInstance(this.context, instance, "source effect completion", () => {
      complete = instance.isComplete();
    });
    if (this.control.cancelled) return false;
    if (complete) this.finish(false);
    return complete;
  }

  private finish(cancelled: boolean): void {
    if (this.finished) return;
    const instance = this.instance;
    const finish = instance?.finish;
    if (instance && finish) {
      invokeInstance(this.context, instance, "source effect finish", () =>
        finish.call(instance, cancelled),
      );
    }
    this.finished = true;
  }
}

class StateRuntime implements FeelRuntimeNode {
  private instance: FeelStateInstance | undefined;
  private started = false;
  private finished = false;
  private phase: "attack" | "hold" | "release" = "attack";
  private elapsed = 0;
  private amount = 0;
  private releaseStartAmount = 0;
  private releaseSent = false;

  constructor(
    private readonly context: FeelStateContext,
    private readonly control: FeelRuntimeControl,
    private readonly timing: Required<
      Pick<FeelStateTiming, "attack" | "release">
    > &
      Pick<FeelStateTiming, "attackEasing" | "releaseEasing">,
    private readonly create: (context: FeelStateContext) => FeelStateInstance,
  ) {}

  get timelineComplete(): boolean {
    return this.finished;
  }

  get complete(): boolean {
    return this.finished;
  }

  advance(dt: number): number {
    if (this.finished) return dt;
    const wasStarted = this.started;
    if (!wasStarted) this.start();
    if (this.control.cancelled) return 0;
    if (this.control.released) this.release();
    if (this.finished) return dt;
    if (!wasStarted && dt === 0) return 0;
    if (this.completeFromOwnedSource()) return dt;

    if (this.phase === "attack") {
      const activeDt = Math.min(dt, this.timing.attack - this.elapsed);
      this.elapsed += activeDt;
      const progress =
        activeDt > 0 && this.elapsed + TIME_EPSILON >= this.timing.attack
          ? 1
          : this.elapsed / this.timing.attack;
      this.amount = invokeFeelEasing(
        this.context,
        this.timing.attackEasing ?? linear,
        progress,
        "state attack easing",
        "defineFeelState: attackEasing",
        (eased) => (progress >= 1 ? 1 : eased),
      );
      this.update(this.amount, activeDt);
      if (this.control.cancelled) return 0;
      if (this.control.released) this.release();
      if (this.finished) return dt - activeDt;
      if (progress >= 1 && this.phase === "attack") {
        this.phase = "hold";
        this.elapsed = 0;
      }
      const remaining = dt - activeDt;
      if (this.phase === "hold" && remaining > 0) {
        this.update(1, remaining);
        if (this.control.cancelled) return 0;
        if (this.control.released) this.release();
      }
      this.completeFromOwnedSource();
      return 0;
    }

    if (this.phase === "hold") {
      this.update(1, dt);
      if (this.control.cancelled) return 0;
      if (this.control.released) this.release();
      this.completeFromOwnedSource();
      return 0;
    }

    const activeDt = Math.min(dt, this.timing.release - this.elapsed);
    this.elapsed += activeDt;
    const progress =
      activeDt > 0 && this.elapsed + TIME_EPSILON >= this.timing.release
        ? 1
        : this.elapsed / this.timing.release;
    this.amount = invokeFeelEasing(
      this.context,
      this.timing.releaseEasing ?? linear,
      progress,
      "state release easing",
      "defineFeelState: releaseEasing",
      (eased) => (progress >= 1 ? 0 : this.releaseStartAmount * (1 - eased)),
    );
    this.update(this.amount, activeDt);
    if (this.control.cancelled) return 0;
    if (progress >= 1) this.finish(false);
    else this.completeFromOwnedSource();
    return this.finished ? dt - activeDt : 0;
  }

  release(): void {
    if (this.finished || this.releaseSent) return;
    if (this.started && this.completeFromOwnedSource()) return;
    this.releaseSent = true;
    if (!this.started) return;
    const instance = this.instance;
    const release = instance?.release;
    if (instance && release) {
      invokeInstance(this.context, instance, "state release", () =>
        release.call(instance),
      );
    }
    if (this.control.cancelled) return;
    this.releaseStartAmount = this.amount;
    this.elapsed = 0;
    this.phase = "release";
    if (this.releaseStartAmount === 0) {
      this.finish(false);
    } else if (this.timing.release === 0) {
      this.amount = 0;
      this.update(0, 0);
      if (!this.control.cancelled) this.finish(false);
    }
  }

  cancel(): void {
    if (!this.started || this.finished) return;
    this.finish(true);
  }

  private start(): void {
    this.started = true;
    let instance: FeelStateInstance | undefined;
    this.context.invoke("state create", () => {
      instance = this.create(this.context);
    });
    if (!instance) {
      throw new Error("Feel: a state factory did not return an instance.");
    }
    this.instance = instance;
    if (this.control.cancelled) return;
    const start = instance.start;
    if (start) {
      invokeInstance(this.context, instance, "state start", () =>
        start.call(instance),
      );
    }
    if (this.control.cancelled) return;
    if (this.control.released || this.releaseSent) {
      this.amount = 0;
      this.update(0, 0);
      this.releaseSent = false;
      this.release();
      return;
    }
    this.amount = this.timing.attack === 0 ? 1 : 0;
    this.phase = this.timing.attack === 0 ? "hold" : "attack";
    this.update(this.amount, 0);
    this.completeFromOwnedSource();
  }

  private update(amount: number, dt: number): void {
    const instance = this.instance;
    if (!instance) return;
    invokeInstance(this.context, instance, "state update", () =>
      instance.update(amount, dt),
    );
  }

  private completeFromOwnedSource(): boolean {
    const instance = this.instance;
    const isComplete = instance?.isComplete;
    if (!instance || !isComplete || this.finished || this.releaseSent) {
      return false;
    }
    let complete = false;
    invokeInstance(this.context, instance, "state completion", () => {
      complete = isComplete.call(instance);
    });
    if (complete) this.finish(false);
    return complete;
  }

  private finish(cancelled: boolean): void {
    if (this.finished) return;
    const instance = this.instance;
    const finish = instance?.finish;
    if (instance && finish) {
      invokeInstance(this.context, instance, "state finish", () =>
        finish.call(instance, cancelled),
      );
    }
    this.finished = true;
  }
}

class ParallelRuntime implements FeelRuntimeNode {
  constructor(
    private readonly children: readonly FeelRuntimeNode[],
    private readonly control: FeelRuntimeControl,
  ) {}

  get timelineComplete(): boolean {
    return this.children.every((child) => child.timelineComplete);
  }

  get complete(): boolean {
    return this.children.every((child) => child.complete);
  }

  advance(dt: number): number {
    let unused = dt;
    for (const child of this.children) {
      const childUnused = child.advance(dt);
      if (!child.timelineComplete) unused = 0;
      else unused = Math.min(unused, childUnused);
      if (this.control.cancelled) return 0;
      if (this.control.released) this.release();
    }
    return this.timelineComplete ? unused : 0;
  }

  release(): void {
    for (const child of this.children) child.release();
  }

  cancel(): void {
    for (const child of this.children) child.cancel();
  }
}

class SequenceRuntime implements FeelRuntimeNode {
  private index = 0;

  constructor(
    private readonly children: readonly FeelRuntimeNode[],
    private readonly control: FeelRuntimeControl,
  ) {}

  get timelineComplete(): boolean {
    return this.index >= this.children.length;
  }

  get complete(): boolean {
    return (
      this.timelineComplete && this.children.every((child) => child.complete)
    );
  }

  advance(dt: number): number {
    for (let index = 0; index < this.index; index++) {
      this.children[index]?.advance(0);
      if (this.control.cancelled) return 0;
    }

    let remaining = dt;
    while (this.index < this.children.length) {
      const child = this.children[this.index];
      if (!child) break;
      remaining = child.advance(remaining);
      if (this.control.cancelled) return 0;
      if (this.control.released) this.release();
      if (!child.timelineComplete) return 0;
      this.index++;
    }
    return remaining;
  }

  release(): void {
    for (const child of this.children) child.release();
  }

  cancel(): void {
    for (const child of this.children) child.cancel();
  }
}

class DelayRuntime implements FeelRuntimeNode {
  private elapsed = 0;

  constructor(
    private readonly duration: number,
    private readonly child: FeelRuntimeNode | undefined,
    private readonly control: FeelRuntimeControl,
  ) {}

  get timelineComplete(): boolean {
    return (
      this.elapsed >= this.duration && (this.child?.timelineComplete ?? true)
    );
  }

  get complete(): boolean {
    return this.timelineComplete && (this.child?.complete ?? true);
  }

  advance(dt: number): number {
    let remaining = dt;
    if (this.elapsed < this.duration) {
      const activeDt = Math.min(remaining, this.duration - this.elapsed);
      this.elapsed += activeDt;
      remaining -= activeDt;
      if (this.elapsed < this.duration) return 0;
    }
    if (!this.child) return remaining;
    const unused = this.child.advance(remaining);
    if (this.control.released) this.release();
    return this.child.timelineComplete ? unused : 0;
  }

  release(): void {
    this.child?.release();
  }

  cancel(): void {
    this.child?.cancel();
  }
}

class LoopRuntime implements FeelRuntimeNode {
  private readonly pendingSources: FeelRuntimeNode[] = [];
  private current: FeelRuntimeNode | undefined;
  private gapRemaining = 0;
  private stopped = false;

  constructor(
    private readonly node: FeelNode,
    private readonly gap: number,
    private readonly context: FeelEffectContext,
    private readonly timing: FeelRuntimeTiming,
    private readonly control: FeelRuntimeControl,
  ) {}

  get timelineComplete(): boolean {
    return this.stopped;
  }

  get complete(): boolean {
    return (
      this.stopped &&
      (this.current?.complete ?? true) &&
      this.pendingSources.every((child) => child.complete)
    );
  }

  advance(dt: number): number {
    this.pollPendingSources();
    if (this.stopped) return dt;
    if (this.control.released) this.release();
    if (this.stopped) return dt;

    let remaining = dt;
    while (!this.stopped) {
      if (this.gapRemaining > 0) {
        const activeDt = Math.min(remaining, this.gapRemaining);
        this.gapRemaining -= activeDt;
        remaining -= activeDt;
        if (this.control.released) {
          this.release();
          return remaining;
        }
        if (this.gapRemaining > 0) return 0;
      }

      if (!this.current) {
        this.current = this.node._createRuntime(
          this.context,
          this.timing,
          this.control,
        );
      }
      remaining = this.current.advance(remaining);
      if (this.control.cancelled) return 0;
      if (this.control.released) this.release();
      if (!this.current.timelineComplete) return 0;
      if (!this.current.complete) this.pendingSources.push(this.current);
      this.current = undefined;
      if (this.stopped) return remaining;
      this.gapRemaining = this.timing.scale(this.gap);
      if (remaining === 0 && this.gapRemaining > 0) return 0;
    }
    return remaining;
  }

  release(): void {
    if (this.stopped) return;
    for (const source of this.pendingSources) source.release();
    this.current?.release();
    if (!this.current || this.current.timelineComplete) {
      this.stopped = true;
      this.gapRemaining = 0;
    }
  }

  cancel(): void {
    this.stopped = true;
    this.current?.cancel();
    for (const source of this.pendingSources) source.cancel();
  }

  private pollPendingSources(): void {
    for (let index = this.pendingSources.length - 1; index >= 0; index--) {
      const source = this.pendingSources[index];
      source?.advance(0);
      if (source?.complete) this.pendingSources.splice(index, 1);
      if (this.control.cancelled) return;
    }
  }
}

class EffectNode implements FeelNode {
  readonly duration: number;

  constructor(private readonly definition: FeelEffectDefinition) {
    this.duration = validDuration(definition.duration, "defineFeelEffect");
  }

  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    const duration = timing.scale(this.duration);
    return new TimedEffectRuntime(
      this.definition,
      timedContext(context, duration),
      timing,
      control,
      duration,
    );
  }
}

class FiniteSourceNode implements FeelNode {
  readonly duration: number;

  constructor(
    duration: number,
    private readonly create: (
      context: FeelTimedEffectContext,
    ) => FeelFiniteSourceInstance,
  ) {
    this.duration = validDuration(duration, "defineFeelSourceEffect");
  }

  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    return new FiniteSourceRuntime(
      timedContext(context, timing.scale(this.duration)),
      control,
      this.create,
    );
  }
}

class StateNode implements FeelNode {
  readonly duration = null;

  constructor(
    private readonly timing: Required<
      Pick<FeelStateTiming, "attack" | "release">
    > &
      Pick<FeelStateTiming, "attackEasing" | "releaseEasing">,
    private readonly create: (context: FeelStateContext) => FeelStateInstance,
  ) {}

  _createRuntime(
    context: FeelEffectContext,
    _timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    return new StateRuntime(
      stateContext(context),
      control,
      this.timing,
      this.create,
    );
  }
}

class ParallelNode implements FeelNode {
  readonly duration: number | null;

  constructor(private readonly nodes: readonly FeelNode[]) {
    this.duration = nodes.some((node) => node.duration === null)
      ? null
      : combinedDuration(
          nodes.reduce((max, node) => Math.max(max, node.duration ?? 0), 0),
          "feelParallel",
        );
  }

  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    return new ParallelRuntime(
      this.nodes.map((node) => node._createRuntime(context, timing, control)),
      control,
    );
  }
}

class SequenceNode implements FeelNode {
  readonly duration: number | null;

  constructor(private readonly nodes: readonly FeelNode[]) {
    this.duration = nodes.some((node) => node.duration === null)
      ? null
      : combinedDuration(
          nodes.reduce((sum, node) => sum + (node.duration ?? 0), 0),
          "feelSequence",
        );
  }

  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    return new SequenceRuntime(
      this.nodes.map((node) => node._createRuntime(context, timing, control)),
      control,
    );
  }
}

class DelayNode implements FeelNode {
  readonly duration: number | null;

  constructor(
    private readonly seconds: number,
    private readonly node: FeelNode | undefined,
  ) {
    this.duration =
      node?.duration === null
        ? null
        : combinedDuration(seconds + (node?.duration ?? 0), "feelDelay");
  }

  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    return new DelayRuntime(
      timing.scale(this.seconds),
      this.node?._createRuntime(context, timing, control),
      control,
    );
  }
}

class RepeatNode implements FeelNode {
  readonly duration: number;

  constructor(
    private readonly node: FeelNode,
    private readonly times: number,
    private readonly gap: number,
  ) {
    const nodeDuration = node.duration;
    if (nodeDuration === null) {
      throw new Error("feelRepeat: node must have a finite duration.");
    }
    this.duration = combinedDuration(
      times === 0 ? 0 : nodeDuration * times + gap * (times - 1),
      "feelRepeat",
    );
  }

  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    const children: FeelRuntimeNode[] = [];
    for (let index = 0; index < this.times; index++) {
      if (index > 0) {
        children.push(
          new DelayRuntime(timing.scale(this.gap), undefined, control),
        );
      }
      children.push(this.node._createRuntime(context, timing, control));
    }
    return new SequenceRuntime(children, control);
  }
}

class LoopNode implements FeelNode {
  readonly duration = null;

  constructor(
    private readonly node: FeelNode,
    private readonly gap: number,
  ) {}

  _createRuntime(
    context: FeelEffectContext,
    timing: FeelRuntimeTiming,
    control: FeelRuntimeControl,
  ): FeelRuntimeNode {
    return new LoopRuntime(this.node, this.gap, context, timing, control);
  }
}

/** Define one timed effect leaf. */
export function defineFeelEffect(
  duration: number,
  create: (context: FeelTimedEffectContext) => FeelEffectInstance,
): FeelNode {
  return new EffectNode({ duration, create });
}

/** @internal Define a finite leaf whose owned source decides completion. */
export function defineFeelSourceEffect(
  duration: number,
  create: (context: FeelTimedEffectContext) => FeelFiniteSourceInstance,
): FeelNode {
  return new FiniteSourceNode(duration, create);
}

/** Define a state that holds until release or owned-source completion. */
export function defineFeelState(
  timing: FeelStateTiming,
  create: (context: FeelStateContext) => FeelStateInstance,
): FeelNode {
  const attack = validDuration(timing.attack ?? 0, "defineFeelState: attack");
  const release = validDuration(
    timing.release ?? 0,
    "defineFeelState: release",
  );
  return new StateNode(
    {
      attack,
      release,
      ...(timing.attackEasing ? { attackEasing: timing.attackEasing } : {}),
      ...(timing.releaseEasing ? { releaseEasing: timing.releaseEasing } : {}),
    },
    create,
  );
}

/** Run every child at the same time. */
export function feelParallel(...nodes: readonly FeelNode[]): FeelNode {
  return new ParallelNode(nodes);
}

/** Run each child after the previous child's timeline finishes. */
export function feelSequence(...nodes: readonly FeelNode[]): FeelNode {
  return new SequenceNode(nodes);
}

/** Delay a node, or create an empty wait when no node is supplied. */
export function feelDelay(seconds: number, node?: FeelNode): FeelNode {
  return new DelayNode(validDuration(seconds, "feelDelay"), node);
}

/** Repeat a finite node a fixed number of times with an optional gap. */
export function feelRepeat(node: FeelNode, times: number, gap = 0): FeelNode {
  if (!Number.isInteger(times) || times < 0) {
    throw new Error(`feelRepeat: times must be an integer >= 0, got ${times}.`);
  }
  return new RepeatNode(node, times, validDuration(gap, "feelRepeat"));
}

/** Repeat a finite node until its playback is released. */
export function feelLoop(node: FeelNode, gap = 0): FeelNode {
  if (node.duration === null) {
    throw new Error("feelLoop: node must have a finite duration.");
  }
  const validatedGap = validDuration(gap, "feelLoop");
  if (node.duration === 0 && validatedGap === 0) {
    throw new Error("feelLoop: a zero-duration node needs a positive gap.");
  }
  return new LoopNode(node, validatedGap);
}
