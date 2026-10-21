import type { AudioAutomationOptions } from "../types.js";
import { assertTime, assertPositive } from "./validation.js";

export type AudioAutomationPoint = {
  at: number;
  value: number;
  curve: "step" | "linear" | "exponential";
};

/** Shared value history for live automation, replacement and source-position integration. */
export class AudioTimeline {
  private points: AudioAutomationPoint[];
  constructor(value: number) {
    if (!Number.isFinite(value))
      throw new Error(`AudioTimeline: value must be finite, got ${value}.`);
    this.points = [{ at: 0, value, curve: "step" }];
  }

  valueAt(time: number): number {
    let previous = this.points[0]!;
    for (const point of this.points.slice(1)) {
      if (point.at > time) {
        if (point.curve === "step" || point.at === previous.at)
          return previous.value;
        const u = Math.max(0, (time - previous.at) / (point.at - previous.at));
        return point.curve === "linear"
          ? previous.value + (point.value - previous.value) * u
          : previous.value * (point.value / previous.value) ** u;
      }
      previous = point;
    }
    return previous.value;
  }

  set(
    value: number,
    at: number,
    duration = 0,
    curve: "linear" | "exponential" = "linear",
  ): void {
    if (!Number.isFinite(value))
      throw new Error(`AudioTimeline.set: value must be finite, got ${value}.`);
    assertTime("AudioTimeline.set.at", at);
    assertTime("AudioTimeline.set.duration", duration);
    assertTime("AudioTimeline.set.end", at + duration);
    const from = this.valueAt(at);
    if (curve === "exponential") {
      assertPositive("Audio automation exponential start", from);
      assertPositive("Audio automation exponential target", value);
    }
    const endpoint = this.points.find((point) => point.at === at);
    const next = this.points.find((point) => point.at > at);
    this.points = this.points.filter((point) => point.at < at);
    this.points.push(
      endpoint ?? { at, value: from, curve: next?.curve ?? "step" },
    );
    this.points.push({ at, value: from, curve: "step" });
    this.points.push({
      at: at + duration,
      value,
      curve: duration === 0 ? "step" : curve,
    });
  }

  /** Current value plus future automation points, as a detached snapshot. */
  events(from: number): readonly AudioAutomationPoint[] {
    return [
      { at: from, value: this.valueAt(from), curve: "step" },
      ...this.points.filter((p) => p.at > from).map((p) => ({ ...p })),
    ];
  }

  /** Discard elapsed history after the owner has consumed any needed integral. */
  prune(time: number): void {
    assertTime("AudioTimeline.prune", time);
    const value = this.valueAt(time);
    this.points = [
      { at: time, value, curve: "step" },
      ...this.points.filter((p) => p.at > time),
    ];
  }

  apply(param: AudioParam, now: number): void {
    param.cancelScheduledValues(now);
    param.setValueAtTime(this.valueAt(now), now);
    for (const point of this.points) {
      if (point.at <= now) continue;
      if (point.curve === "linear")
        param.linearRampToValueAtTime(point.value, point.at);
      else if (point.curve === "exponential")
        param.exponentialRampToValueAtTime(point.value, point.at);
      else param.setValueAtTime(point.value, point.at);
    }
  }

  integral(from: number, to: number): number {
    const cuts = [
      from,
      ...this.points.filter((p) => p.at > from && p.at < to).map((p) => p.at),
      to,
    ];
    let sum = 0;
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1]!;
      const b = cuts[i]!;
      const next = this.points.find((p) => p.at >= b);
      const start = this.valueAt(a);
      const end = next?.at === b ? next.value : this.valueAt(b);
      if (next?.curve === "linear") sum += ((start + end) * (b - a)) / 2;
      else if (next?.curve === "exponential" && start !== end)
        sum += ((end - start) * (b - a)) / Math.log(end / start);
      else sum += start * (b - a);
    }
    return sum;
  }

  shift(from: number, delta: number): void {
    assertTime("AudioTimeline.shift.from", from);
    assertTime("AudioTimeline.shift.delta", delta);
    for (const point of this.points)
      assertTime("AudioTimeline.shift.result", point.at + delta);
    const value = this.valueAt(from);
    const later = this.points
      .filter((p) => p.at > from)
      .map((p) => ({ ...p, at: p.at + delta }));
    this.points = [
      { at: 0, value, curve: "step" },
      { at: from + delta, value, curve: "step" },
      ...later,
    ];
  }
}

export function automationTiming(
  context: string,
  now: number,
  options: AudioAutomationOptions = {},
): { at: number; duration: number; curve: "linear" | "exponential" } {
  const at = options.at ?? now;
  const duration = options.duration ?? 0;
  assertTime(`${context}.at`, at);
  assertTime(`${context}.duration`, duration);
  assertTime(`${context}.end`, at + duration);
  return { at: Math.max(at, now), duration, curve: options.curve ?? "linear" };
}
