import { propertyWriteOrder } from "./writeOrder.js";
import { durationReached } from "@yagejs/core";
import type { ErrorBoundary } from "@yagejs/core";
import type { SequenceClip } from "./evaluate.js";
import type {
  Point,
  SequenceContract,
  SequenceMarker,
  SequenceProperty,
  SequenceSampleOptions,
  SequenceValue,
} from "./types.js";
import { finite, validateSequenceValue } from "./validate.js";

export interface SequencePropertyBinding {
  readonly definition: SequenceProperty;
  get(): SequenceValue;
  set(value: SequenceValue): void;
}
export interface SequenceEventBinding {
  readonly payload: Readonly<Record<string, SequenceProperty>>;
  dispatch(
    payload: Readonly<Record<string, SequenceValue>>,
    marker: SequenceMarker,
  ): void;
}
export interface SequenceTarget {
  readonly properties: Readonly<Record<string, SequencePropertyBinding>>;
  readonly events: Readonly<Record<string, SequenceEventBinding>>;
  isAlive?(): boolean;
}
export type SequenceTargets = Readonly<Record<string, SequenceTarget>>;
export interface SequencePlayOptions extends SequenceSampleOptions {
  readonly targets: SequenceTargets;
  readonly speed?: number;
  readonly loop?: boolean;
  readonly finish?: "retain" | "restore";
  readonly cancel?: "retain" | "restore";
}
export type SequencePlaybackState =
  | "idle"
  | "playing"
  | "paused"
  | "completed"
  | "cancelled";
type Captured = {
  binding: SequencePropertyBinding;
  value: SequenceValue;
  label: string;
};
const cloneValue = (v: SequenceValue): SequenceValue =>
  typeof v === "object" ? { ...v } : v;
function same(a: SequenceProperty, b: SequenceProperty): boolean {
  return (
    a.kind === b.kind &&
    (a.kind !== "enum" ||
      (b.kind === "enum" &&
        a.values.length === b.values.length &&
        a.values.every((v) => b.values.includes(v))))
  );
}
function validateBinding(
  id: string,
  c: SequenceContract,
  target: SequenceTarget,
): void {
  for (const [name, def] of Object.entries(c.properties)) {
    const binding = Object.hasOwn(target.properties, name)
      ? target.properties[name]
      : undefined;
    if (!binding || !same(def, binding.definition))
      throw new Error(
        `SequencePlayer.play: incompatible property ${id}.${name}`,
      );
  }
  for (const [name, def] of Object.entries(c.events)) {
    const binding = Object.hasOwn(target.events, name)
      ? target.events[name]
      : undefined;
    if (
      !binding ||
      Object.keys(def).length !== Object.keys(binding.payload).length ||
      Object.entries(def).some(
        ([key, value]) =>
          !Object.hasOwn(binding.payload, key) ||
          !same(value, binding.payload[key]!),
      )
    )
      throw new Error(`SequencePlayer.play: incompatible event ${id}.${name}`);
  }
}

/** Check an asset contract against a binding set without reading or writing targets. */
export function validateSequenceTargets(
  clip: SequenceClip,
  targets: SequenceTargets,
): void {
  for (const [id, contract] of Object.entries(clip.document.targets)) {
    const target = Object.hasOwn(targets, id) ? targets[id] : undefined;
    if (!target) throw new Error(`SequencePlayer.play: missing target ${id}`);
    validateBinding(id, contract, target);
  }
}
/** Playback state for one asset instance. The host supplies its clock and targets. */
export class SequencePlayer {
  private clip: SequenceClip | undefined;
  private options: SequencePlayOptions | undefined;
  private captured: Captured[] = [];
  private restoring: readonly Captured[] | undefined;
  private markers: readonly SequenceMarker[] = [];
  private cursor = 0;
  private revision = 0;
  private advancing = false;
  private bindingDepth = 0;
  private position = 0;
  private playbackState: SequencePlaybackState = "idle";
  get frame(): number {
    return this.position;
  }
  get state(): SequencePlaybackState {
    return this.playbackState;
  }
  constructor(private readonly boundary: ErrorBoundary) {}
  private call<T>(label: string, fn: () => T): T {
    let result: T | undefined;
    this.boundary.wrapCallback(
      () => {
        this.bindingDepth++;
        try {
          result = fn();
          return result;
        } finally {
          this.bindingDepth--;
        }
      },
      { kind: "Sequence binding", event: label },
    );
    return result as T;
  }
  private checkTargets(targets: SequenceTargets, revision: number): boolean {
    for (const [id, target] of Object.entries(targets)) {
      if (!target.isAlive) continue;
      const alive = this.call(`${id}.isAlive`, () => target.isAlive!());
      if (this.revision !== revision) return false;
      if (!alive)
        throw new Error(`SequencePlayer: required target ${id} has expired`);
    }
    return true;
  }
  play(clip: SequenceClip, options: SequencePlayOptions): void {
    if (this.state === "playing" || this.state === "paused")
      throw new Error("SequencePlayer.play: cancel the active playback first");
    const speed = options.speed ?? 1;
    finite(speed, "speed");
    if (speed <= 0) throw new Error("SequencePlayer.play: speed must be > 0");
    for (const [name, policy] of [
      ["finish", options.finish],
      ["cancel", options.cancel],
    ])
      if (policy !== undefined && policy !== "retain" && policy !== "restore")
        throw new Error(`SequencePlayer.play: unknown ${String(name)} policy`);
    const targets: Record<string, SequenceTarget> = {};
    for (const [id, contract] of Object.entries(clip.document.targets)) {
      const target = Object.hasOwn(options.targets, id)
        ? options.targets[id]
        : undefined;
      if (!target) throw new Error(`SequencePlayer.play: missing target ${id}`);
      validateBinding(id, contract, target);
      Object.defineProperty(targets, id, {
        value: {
          ...(target.isAlive ? { isAlive: target.isAlive.bind(target) } : {}),
          properties: { ...target.properties },
          events: { ...target.events },
        },
        enumerable: true,
      });
    }
    const preparationRevision = this.revision;
    if (!this.checkTargets(targets, preparationRevision)) return;
    // Validate mapping and every captured value before the first property write.
    clip.sample(0, options);
    const captured: Captured[] = [];
    for (const track of clip.document.tracks) {
      const binding = targets[track.target]!.properties[track.property]!;
      const label = `${track.target}.${track.property}`;
      const value = this.call(`${label}.get`, () => binding.get());
      if (this.revision !== preparationRevision) return;
      validateSequenceValue(
        value,
        binding.definition,
        `${label} initial value`,
      );
      captured.push({ binding, value: cloneValue(value), label });
    }
    this.clip = clip;
    this.options = {
      ...options,
      targets,
      ...(options.frame ? { frame: { ...options.frame } } : {}),
    };
    this.captured = captured;
    this.markers = [...clip.document.events].sort((a, b) => a.frame - b.frame);
    this.cursor = 0;
    this.position = 0;
    this.playbackState = "playing";
    const revision = ++this.revision;
    if (!this.apply(0, revision)) return;
    this.eventsUntil(0, revision);
  }
  private apply(frame: number, revision: number): boolean {
    const clip = this.clip!;
    const options = this.options!;
    if (!this.checkTargets(options.targets, revision)) return false;
    const samples = clip.sample(frame, options);
    this.position = frame;
    const writes = samples.map((sample) => ({
      binding: options.targets[sample.target]!.properties[sample.property]!,
      value: sample.value,
      label: `${sample.target}.${sample.property}`,
    }));
    return this.writeValues(writes, "set", revision);
  }
  private writeValues(
    writes: readonly Captured[],
    operation: "set" | "restore",
    revision: number,
  ): boolean {
    // Local rotation and scale settle before world positions. Entity helpers
    // derive depth from the current hierarchy so child positions are last.
    const ordered: { item: Captured; order: number }[] = [];
    for (const item of writes) {
      const order = this.call(`${item.label}.writeOrder`, () =>
        propertyWriteOrder(item.binding),
      );
      if (this.revision !== revision) return false;
      ordered.push({ item, order });
    }
    ordered.sort((a, b) => a.order - b.order);
    for (const { item } of ordered) {
      this.call(`${item.label}.${operation}`, () =>
        item.binding.set(cloneValue(item.value)),
      );
      if (this.revision !== revision) return false;
    }
    return true;
  }

  private eventsUntil(end: number, revision: number): boolean {
    while (
      this.cursor < this.markers.length &&
      (this.markers[this.cursor]!.frame === 0 ||
        durationReached(end, this.markers[this.cursor]!.frame))
    ) {
      const event = this.markers[this.cursor]!;
      if (!this.apply(event.frame, revision)) return false;
      this.cursor++;
      const binding = this.options!.targets[event.target]!.events[event.event]!;
      this.call(`${event.target}.${event.event}`, () =>
        binding.dispatch(event.payload, event),
      );
      if (this.revision !== revision || this.state !== "playing") return false;
    }
    return true;
  }
  /** Advance scene time in seconds. Every crossed event observes its authored pose. */
  advance(dt: number): void {
    finite(dt, "advance.dt");
    if (dt < 0) throw new Error("SequencePlayer.advance: dt must be >= 0");
    if (this.state !== "playing") return;
    if (this.advancing)
      throw new Error(
        "SequencePlayer.advance: recursive advancement is not supported",
      );
    const clip = this.clip!;
    const options = this.options!;
    let remaining = dt * clip.document.fps * (options.speed ?? 1);
    finite(remaining, "advance frames");
    const revision = this.revision;
    this.advancing = true;
    try {
      do {
        const step = Math.min(
          remaining,
          clip.document.duration - this.position,
        );
        const candidate = this.position + step;
        const end = durationReached(candidate, clip.document.duration)
          ? clip.document.duration
          : candidate;
        if (!this.eventsUntil(end, revision)) return;
        if (!this.apply(Math.max(this.position, end), revision)) return;
        remaining -= step;
        if (end < clip.document.duration) return;
        if (!options.loop) {
          this.playbackState = "completed";
          if (options.finish === "restore") this.restore();
          return;
        }
        this.cursor = 0;
        if (!this.apply(0, revision)) return;
        if (!this.eventsUntil(0, revision)) return;
      } while (remaining > 0);
    } finally {
      // Only release the recursion guard. No target callbacks run during unwind.
      this.advancing = false;
    }
  }
  pause(): void {
    if (this.state === "playing" || this.bindingDepth > 0) {
      if (this.clip) this.playbackState = "paused";
      this.revision++;
    }
  }
  resume(): void {
    if (this.state === "paused") {
      this.playbackState = "playing";
      this.revision++;
    }
  }
  /** Apply a pose silently. Seeking a completed/cancelled instance leaves it paused. */
  seek(frame: number): void {
    finite(frame, "seek.frame");
    if (!this.clip)
      throw new Error("SequencePlayer.seek: no sequence has been played");
    const value = Math.max(0, Math.min(frame, this.clip.document.duration));
    const revision = ++this.revision;
    if (!this.apply(value, revision)) return;
    this.cursor = this.markers.findIndex((e) => e.frame > value);
    if (this.cursor === -1) this.cursor = this.markers.length;
    if (this.state !== "playing") this.playbackState = "paused";
  }
  cancel(
    policy: "retain" | "restore" = this.options?.cancel ?? "retain",
  ): void {
    if (policy !== "retain" && policy !== "restore")
      throw new Error("SequencePlayer.cancel: unknown policy");
    if (this.state === "idle" || this.state === "cancelled") {
      // Terminal playback can still be dispatching restoration callbacks.
      if (this.bindingDepth > 0) this.revision++;
      return;
    }
    this.playbackState = "cancelled";
    this.revision++;
    if (policy === "restore" && this.restoring !== this.captured)
      this.restore();
  }
  private restore(): void {
    const revision = this.revision;
    const previous = this.restoring;
    // Captured values identify the playback, including across nested callbacks.
    this.restoring = this.captured;
    try {
      if (!this.checkTargets(this.options!.targets, revision)) return;
      this.writeValues(this.captured, "restore", revision);
    } finally {
      this.restoring = previous;
    }
  }
}
export type SequencePropertyValue<D extends SequenceProperty> =
  D["kind"] extends "position" | "vector"
    ? Point
    : D["kind"] extends "boolean"
      ? boolean
      : D["kind"] extends "enum"
        ? string
        : number;
/** Typed accessor helper. Runtime values are validated against the asset contract. */
export function sequenceProperty<D extends SequenceProperty>(
  definition: D,
  get: () => SequencePropertyValue<D>,
  set: (value: SequencePropertyValue<D>) => void,
): SequencePropertyBinding {
  return {
    definition,
    get,
    set: (value) => set(value as SequencePropertyValue<D>),
  };
}
