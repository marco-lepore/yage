import { describe, expect, it, vi } from "vitest";
import {
  ErrorBoundaryKey,
  SceneTimeKey,
  Transform,
  Vec2,
  createMockEntity,
} from "@yagejs/core";
import { Feel } from "./Feel.js";
import {
  FeelCompletedEvent,
  FeelStartedEvent,
  FeelStoppedEvent,
} from "./core/events.js";
import {
  defineFeelEffect,
  feelDelay,
  feelParallel,
  feelSequence,
} from "./core/node.js";
import { feelHitStop, feelSlowMotion } from "./effects/core.js";
import { feelPositionPunch, feelScalePunch } from "./effects/transform.js";

describe("Feel", () => {
  it("runs parallel and sequential effects on their scheduled times", () => {
    const { entity } = createMockEntity();
    const calls: string[] = [];
    const effect = (name: string, duration: number) =>
      defineFeelEffect(duration, () => ({
        start: () => calls.push(`${name}:start`),
        finish: () => calls.push(`${name}:finish`),
      }));
    const feel = entity.add(
      new Feel({
        hit: feelSequence(
          feelParallel(effect("a", 0.1), effect("b", 0.2)),
          effect("c", 0),
        ),
      }),
    );

    const playback = feel.play("hit");
    expect(calls).toEqual(["a:start", "b:start"]);
    feel.update(0.1);
    expect(calls).toContain("a:finish");
    expect(playback?.active).toBe(true);
    feel.update(0.1);
    expect(calls).toEqual([
      "a:start",
      "b:start",
      "a:finish",
      "b:finish",
      "c:start",
      "c:finish",
    ]);
    expect(playback?.active).toBe(false);
  });

  it("keeps an empty delay alive for its duration", () => {
    const { entity } = createMockEntity();
    const feel = entity.add(new Feel({ pause: feelDelay(0.2) }));
    const playback = feel.play("pause");
    expect(playback?.active).toBe(true);
    feel.update(0.19);
    expect(playback?.active).toBe(true);
    feel.update(0.01);
    expect(playback?.active).toBe(false);
  });

  it("restarts the same cue by default and restores the cancelled effect", () => {
    const { entity } = createMockEntity();
    const cleanups: boolean[] = [];
    const node = defineFeelEffect(1, () => ({
      finish: (cancelled) => cleanups.push(cancelled),
    }));
    const feel = entity.add(new Feel({ hit: node }));
    const first = feel.play("hit");
    const second = feel.play("hit");

    expect(first?.active).toBe(false);
    expect(second?.active).toBe(true);
    expect(cleanups).toEqual([true]);
  });

  it("supports ignore and allow overlap policies", () => {
    const { entity } = createMockEntity();
    const node = defineFeelEffect(1, () => ({}));
    const feel = entity.add(
      new Feel({
        guarded: { effect: node, overlap: "ignore" },
        stacked: { effect: node, overlap: "allow" },
      }),
    );

    expect(feel.play("guarded")).not.toBeNull();
    expect(feel.play("guarded")).toBeNull();
    expect(feel.play("stacked")).not.toBeNull();
    expect(feel.play("stacked")).not.toBeNull();
  });

  it("enforces chance and cooldown with the scene random clock", () => {
    const { entity } = createMockEntity();
    const node = defineFeelEffect(0, () => ({}));
    const feel = entity.add(
      new Feel({
        never: { effect: node, chance: 0 },
        gated: { effect: node, cooldown: 0.5 },
      }),
    );

    expect(feel.play("never")).toBeNull();
    expect(feel.play("gated")).not.toBeNull();
    expect(feel.play("gated")).toBeNull();
    feel.update(0.5);
    expect(feel.play("gated")).not.toBeNull();
  });

  it("emits started, completed, and stopped events", () => {
    const { entity } = createMockEntity();
    const started = vi.fn();
    const completed = vi.fn();
    const stopped = vi.fn();
    entity.on(FeelStartedEvent, started);
    entity.on(FeelCompletedEvent, completed);
    entity.on(FeelStoppedEvent, stopped);
    const feel = entity.add(
      new Feel({ done: feelDelay(0.1), stopped: feelDelay(1) }),
    );

    feel.play("done");
    feel.update(0.1);
    const active = feel.play("stopped");
    active?.stop();

    expect(started).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it("mixes overlapping transform effects and keeps live movement", () => {
    const { entity } = createMockEntity();
    const transform = entity.add(new Transform());
    const feel = entity.add(
      new Feel({
        move: {
          effect: feelPositionPunch({
            target: transform,
            offset: new Vec2(10, 0),
            duration: 1,
            peakAt: 1,
          }),
          overlap: "allow",
        },
        scale: feelScalePunch({
          target: transform,
          scale: 2,
          duration: 1,
          peakAt: 1,
        }),
      }),
    );

    feel.play("move");
    feel.play("move");
    feel.play("scale");
    feel.update(0.5);
    expect(transform.position.x).toBe(15);
    expect(transform.scale.x).toBe(1.75);

    transform.translate(5, 0);
    feel.update(0.49);
    expect(transform.position.x).toBeCloseTo(25, 2);
    expect(transform.scale.x).toBeCloseTo(2, 2);

    feel.update(0.01);
    expect(transform.position.x).toBe(5);
    expect(transform.scale.x).toBe(1);
  });

  it("uses SceneTime for hit stop and slow motion", () => {
    const { entity, scene } = createMockEntity();
    const time = scene.tryResolveScoped(SceneTimeKey);
    const feel = entity.add(
      new Feel({
        freeze: feelHitStop({ duration: 0.05 }),
        slow: feelSlowMotion({ scale: 0.25, duration: 0.2 }),
      }),
    );

    feel.play("freeze");
    expect(time?.isFrozen).toBe(true);
    time?._tick(0.05);
    expect(time?.isFrozen).toBe(false);

    feel.play("slow");
    expect(time?.effectiveScale).toBe(0.25);
    expect(time?.effectiveScaleForUpdates(entity)).toBe(1);
    time?._tick(0.2);
    expect(time?.effectiveScale).toBe(1);
  });

  it("stops all effects when disabled", () => {
    const { entity } = createMockEntity();
    const cleanup = vi.fn();
    const feel = entity.add(
      new Feel({
        held: defineFeelEffect(1, () => ({ finish: cleanup })),
      }),
    );
    feel.play("held");
    feel.enabled = false;
    expect(cleanup).toHaveBeenCalledWith(true);
    expect(feel.isPlaying()).toBe(false);
  });

  it("rejects playback while disabled", () => {
    const { entity } = createMockEntity();
    const start = vi.fn();
    const feel = entity.add(
      new Feel({ held: defineFeelEffect(1, () => ({ start })) }),
    );

    feel.enabled = false;

    expect(feel.play("held")).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects playback through a stale reference after removal", () => {
    const { entity } = createMockEntity();
    const start = vi.fn();
    const feel = entity.add(
      new Feel({ held: defineFeelEffect(1, () => ({ start })) }),
    );

    entity.remove(Feel);
    feel.enabled = false;
    feel.enabled = true;

    expect(feel.play("held")).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("calls effect hooks with their instance as the receiver", () => {
    const { entity } = createMockEntity();
    const instance = {
      calls: [] as string[],
      start() {
        this.calls.push("start");
      },
      update() {
        this.calls.push("update");
      },
      finish() {
        this.calls.push("finish");
      },
    };
    const feel = entity.add(
      new Feel({ pulse: defineFeelEffect(0.1, () => instance) }),
    );

    feel.play("pulse");
    feel.update(0.1);

    expect(instance.calls).toEqual(["start", "update", "update", "finish"]);
  });

  it("emits only stopped when an effect stops its own playback", () => {
    const { entity } = createMockEntity();
    const completed = vi.fn();
    const stopped = vi.fn();
    const finish = vi.fn();
    entity.on(FeelCompletedEvent, completed);
    entity.on(FeelStoppedEvent, stopped);
    const feel = entity.add(
      new Feel({
        pulse: defineFeelEffect(0.1, () => ({
          update: (progress) => {
            if (progress === 1) entity.get(Feel).stop("pulse");
          },
          finish,
        })),
      }),
    );

    feel.play("pulse");
    feel.update(0.1);

    expect(finish).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(true);
    expect(stopped).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
  });

  it("cleans up an instance whose factory stops the playback", () => {
    const { entity } = createMockEntity();
    const calls: string[] = [];
    entity.on(FeelStoppedEvent, () => calls.push("stopped"));
    const feel = entity.add(
      new Feel({
        pulse: defineFeelEffect(1, () => {
          entity.get(Feel).stop("pulse");
          return { finish: () => calls.push("finish") };
        }),
      }),
    );

    const playback = feel.play("pulse");

    expect(playback?.active).toBe(false);
    expect(calls).toEqual(["finish", "stopped"]);
  });

  it("attributes custom effect callbacks to the callback error boundary", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const feel = entity.add(
      new Feel({
        broken: defineFeelEffect(1, () => ({
          label: "custom pulse",
          start: () => {
            throw new Error("broken pulse");
          },
        })),
      }),
    );

    expect(() => feel.play("broken")).toThrow("broken pulse");
    expect(boundary.getCallbackErrors()).toHaveLength(1);
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (custom pulse)",
    );
  });
});
