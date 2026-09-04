import { describe, expect, it, vi } from "vitest";
import {
  ErrorBoundaryKey,
  Scene,
  SceneTimeKey,
  advanceFrames,
  createMockEntity,
  createTestEngine,
} from "@yagejs/core";
import { Feel } from "./Feel.js";
import {
  FeelCompletedEvent,
  FeelStartedEvent,
  FeelStoppedEvent,
} from "./core/events.js";
import {
  defineFeelEffect,
  defineFeelSourceEffect,
  defineFeelState,
  feelDelay,
  feelLoop,
  feelParallel,
  feelRepeat,
  feelSequence,
} from "./core/node.js";
import {
  feelHitStop,
  feelKeyframeAnimation,
  feelSlowMotion,
  feelTargetFreeze,
} from "./effects/core.js";

class FeelTestScene extends Scene {
  readonly name = "feel-test";
}

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
    expect(time?.effectiveScaleForUpdates(entity)).toBe(0);
    time?._tick(0.05);
    expect(time?.isFrozen).toBe(false);

    feel.play("slow");
    expect(time?.effectiveScale).toBe(0.25);
    expect(time?.effectiveScaleForUpdates(entity)).toBe(1);
    time?._tick(0.2);
    expect(time?.effectiveScale).toBe(1);
  });

  it("retimes a SceneTime request with the containing cue", () => {
    const { entity, scene } = createMockEntity();
    const time = scene.tryResolveScoped(SceneTimeKey);
    const feel = entity.add(
      new Feel({ freeze: feelHitStop({ duration: 0.05 }) }),
    );

    feel.play("freeze", { duration: 0.1 });
    time?._tick(0.05);
    expect(time?.isFrozen).toBe(true);
    time?._tick(0.05);
    expect(time?.isFrozen).toBe(false);
  });

  it("does not release an issued SceneTime request on immediate cancellation", () => {
    const { entity, scene } = createMockEntity();
    const time = scene.tryResolveScoped(SceneTimeKey);
    const feel = entity.add(
      new Feel({ freeze: feelHitStop({ duration: 0.05 }) }),
    );

    feel.play("freeze")?.stop();
    expect(time?.isFrozen).toBe(true);
    time?._tick(0.05);
    expect(time?.isFrozen).toBe(false);
  });

  it("advances a frozen SceneTime sequence on the frame its request expires", async () => {
    const engine = await createTestEngine();
    const scene = new FeelTestScene();
    await engine.scenes.push(scene);
    const after = vi.fn();
    const feel = scene.spawn("owner").add(
      new Feel({
        freeze: feelSequence(
          feelHitStop({ duration: 0.1 }),
          defineFeelEffect(0, () => ({ start: after })),
        ),
      }),
    );

    const playback = feel.play("freeze");
    advanceFrames(engine, 1, 50);
    expect(after).not.toHaveBeenCalled();
    expect(playback?.active).toBe(true);

    advanceFrames(engine, 1, 50);
    expect(after).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(false);
    engine.destroy();
  });

  it("does not advance an accelerated SceneTime sequence before raw time expires", async () => {
    const engine = await createTestEngine();
    const scene = new FeelTestScene();
    await engine.scenes.push(scene);
    const after = vi.fn();
    const feel = scene.spawn("owner").add(
      new Feel({
        haste: feelSequence(
          feelSlowMotion({ scale: 2, duration: 0.1, includeOwner: true }),
          defineFeelEffect(0, () => ({ start: after })),
        ),
      }),
    );

    feel.play("haste");
    advanceFrames(engine, 1, 50);
    expect(after).not.toHaveBeenCalled();

    advanceFrames(engine, 1, 50);
    expect(after).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it("uses a retimed target request as the sequence boundary", async () => {
    const engine = await createTestEngine();
    const scene = new FeelTestScene();
    await engine.scenes.push(scene);
    const target = scene.spawn("target");
    const after = vi.fn();
    const feel = scene.spawn("owner").add(
      new Feel({
        slow: feelSequence(
          feelSlowMotion({ target, scale: 0.5, duration: 0.05 }),
          defineFeelEffect(0, () => ({ start: after })),
        ),
      }),
    );

    feel.play("slow", { duration: 0.1 });
    advanceFrames(engine, 1, 50);
    expect(after).not.toHaveBeenCalled();
    expect(
      scene.tryResolveScoped(SceneTimeKey)?.effectiveScaleForUpdates(target),
    ).toBe(0.5);

    advanceFrames(engine, 1, 50);
    expect(after).toHaveBeenCalledOnce();
    expect(
      scene.tryResolveScoped(SceneTimeKey)?.effectiveScaleForUpdates(target),
    ).toBe(1);
    engine.destroy();
  });

  it("waits for a target freeze request before advancing its sequence", async () => {
    const engine = await createTestEngine();
    const scene = new FeelTestScene();
    await engine.scenes.push(scene);
    const target = scene.spawn("target");
    const after = vi.fn();
    const feel = scene.spawn("owner").add(
      new Feel({
        freeze: feelSequence(
          feelTargetFreeze({ target, duration: 0.1 }),
          defineFeelEffect(0, () => ({ start: after })),
        ),
      }),
    );

    feel.play("freeze");
    advanceFrames(engine, 1, 50);
    expect(after).not.toHaveBeenCalled();
    advanceFrames(engine, 1, 50);
    expect(after).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it("can keep its owner updating during scene hit stop", () => {
    const { entity, scene } = createMockEntity();
    const time = scene.tryResolveScoped(SceneTimeKey);
    if (!time) throw new Error("SceneTime is unavailable");
    const feel = entity.add(
      new Feel({ freeze: feelHitStop({ includeOwner: false }) }),
    );

    feel.play("freeze");

    expect(time.effectiveScale).toBe(0);
    expect(time.effectiveScaleForUpdates(entity)).toBe(1);
  });

  it("scales or freezes only an explicit target", () => {
    const { entity, scene } = createMockEntity();
    const target = scene.spawn("target");
    const other = scene.spawn("other");
    const time = scene.tryResolveScoped(SceneTimeKey);
    if (!time) throw new Error("SceneTime is unavailable");
    const feel = entity.add(
      new Feel({
        slowTarget: feelSlowMotion({
          target,
          scale: 0.25,
          duration: 0.2,
        }),
        freezeTarget: feelTargetFreeze({ target, duration: 0.05 }),
      }),
    );

    feel.play("slowTarget");
    expect(time.effectiveScale).toBe(1);
    expect(time.effectiveScaleForUpdates(target)).toBe(0.25);
    expect(time.effectiveScaleForUpdates(other)).toBe(1);
    time._tick(0.2);

    feel.play("freezeTarget");
    expect(time.effectiveScaleForUpdates(target)).toBe(0);
    expect(time.effectiveScaleForUpdates(other)).toBe(1);
    time._tick(0.05);
    expect(time.effectiveScaleForUpdates(target)).toBe(1);
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

  it("attributes keyframe animation targets to the callback error boundary", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const feel = entity.add(
      new Feel({
        broken: feelKeyframeAnimation("pose", () => {
          throw new Error("missing animator");
        }),
      }),
    );

    expect(() => feel.play("broken")).toThrow("missing animator");
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (keyframe animation target)",
    );
  });

  it("retimes a finite cue's local schedule and effect clock", () => {
    const { entity } = createMockEntity();
    const calls: Array<string | number> = [];
    const effect = (name: string) =>
      defineFeelEffect(1, (context) => ({
        start: () => calls.push(`${name}:start:${context.duration}`),
        update: (_progress, dt) => calls.push(dt),
      }));
    const feel = entity.add(
      new Feel({ stretched: feelSequence(effect("a"), effect("b")) }),
    );

    const playback = feel.play("stretched", { duration: 4 });
    feel.update(1);
    expect(calls).toContain("a:start:2");
    expect(calls).toContain(0.5);
    expect(playback?.active).toBe(true);

    feel.update(1);
    expect(calls).toContain("b:start:2");
    feel.update(2);
    expect(playback?.active).toBe(false);
  });

  it("validates play options before restart overlap cancels a live cue", () => {
    const { entity } = createMockEntity();
    const finish = vi.fn();
    const feel = entity.add(
      new Feel({ held: defineFeelEffect(1, () => ({ finish })) }),
    );
    const first = feel.play("held");

    expect(() => feel.play("held", { duration: Number.NaN })).toThrow(
      /duration/,
    );
    expect(first?.active).toBe(true);
    expect(finish).not.toHaveBeenCalled();

    expect(() => feel.play("held", { intensity: Number.NaN })).toThrow(
      /intensity/,
    );
    expect(first?.active).toBe(true);
    expect(finish).not.toHaveBeenCalled();
  });

  it("rejects a duration override for dynamic and zero-duration cues", () => {
    const { entity } = createMockEntity();
    const feel = entity.add(
      new Feel({
        state: defineFeelState({}, () => ({ update: () => {} })),
        moment: defineFeelEffect(0, () => ({})),
      }),
    );

    expect(() => feel.play("state", { duration: 1 })).toThrow(/needs release/);
    expect(() => feel.play("moment", { duration: 1 })).toThrow(/zero-duration/);
  });

  it("releases a state from its current attack amount", () => {
    const { entity } = createMockEntity();
    const amounts: number[] = [];
    const finish = vi.fn();
    const completed = vi.fn();
    entity.on(FeelCompletedEvent, completed);
    const feel = entity.add(
      new Feel({
        charge: defineFeelState({ attack: 1, release: 1 }, () => ({
          update: (amount) => amounts.push(amount),
          finish,
        })),
      }),
    );

    const playback = feel.play("charge");
    feel.update(0.5);
    playback?.release();
    playback?.release();
    feel.update(0.5);
    expect(amounts.at(-1)).toBeCloseTo(0.25);
    expect(playback?.active).toBe(true);
    feel.update(0.5);

    expect(amounts.at(-1)).toBe(0);
    expect(finish).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(false);
    expect(completed).toHaveBeenCalledOnce();
  });

  it("does not complete a sub-epsilon state attack without elapsed time", () => {
    const { entity } = createMockEntity();
    const next = vi.fn();
    let sourceComplete = false;
    const feel = entity.add(
      new Feel({
        staged: feelSequence(
          defineFeelState({ attack: Number.EPSILON }, () => ({
            update: (amount) => {
              if (amount === 1) sourceComplete = true;
            },
            isComplete: () => sourceComplete,
          })),
          defineFeelEffect(0, () => ({ start: next })),
        ),
      }),
    );

    const playback = feel.play("staged");
    feel.update(0);
    expect(next).not.toHaveBeenCalled();
    expect(playback?.active).toBe(true);

    feel.update(Number.EPSILON);
    expect(next).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(false);
  });

  it("does not complete a sub-epsilon state release without elapsed time", () => {
    const { entity } = createMockEntity();
    const next = vi.fn();
    const feel = entity.add(
      new Feel({
        staged: feelSequence(
          defineFeelState({ release: Number.EPSILON }, () => ({
            update: () => {},
          })),
          defineFeelEffect(0, () => ({ start: next })),
        ),
      }),
    );

    const playback = feel.play("staged");
    playback?.release();
    feel.update(0);
    expect(next).not.toHaveBeenCalled();
    expect(playback?.active).toBe(true);

    feel.update(Number.EPSILON);
    expect(next).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(false);
  });

  it("releases one named cue or every active cue through the component", () => {
    const { entity } = createMockEntity();
    const state = () =>
      defineFeelState({ release: 0.1 }, () => ({
        update: () => {},
      }));
    const feel = entity.add(new Feel({ first: state(), second: state() }));

    const first = feel.play("first");
    const second = feel.play("second");
    feel.release("first");
    feel.update(0.1);

    expect(first?.active).toBe(false);
    expect(second?.active).toBe(true);

    feel.release();
    feel.update(0.1);
    expect(second?.active).toBe(false);
  });

  it("continues a sequence after a held child releases", () => {
    const { entity } = createMockEntity();
    const calls: string[] = [];
    const feel = entity.add(
      new Feel({
        staged: feelSequence(
          defineFeelState({ release: 0.1 }, () => ({
            update: () => {},
            finish: () => calls.push("state:finish"),
          })),
          defineFeelEffect(0, () => ({
            start: () => calls.push("next:start"),
          })),
        ),
      }),
    );

    const playback = feel.play("staged");
    playback?.release();
    feel.update(0.1);

    expect(calls).toEqual(["state:finish", "next:start"]);
    expect(playback?.active).toBe(false);
  });

  it("waits for every parallel child after release", () => {
    const { entity } = createMockEntity();
    const finiteFinish = vi.fn();
    const stateFinish = vi.fn();
    const feel = entity.add(
      new Feel({
        mixed: feelParallel(
          defineFeelEffect(0.2, () => ({ finish: finiteFinish })),
          defineFeelState({}, () => ({
            update: () => {},
            finish: stateFinish,
          })),
        ),
      }),
    );

    const playback = feel.play("mixed");
    playback?.release();
    expect(stateFinish).toHaveBeenCalledWith(false);
    expect(playback?.active).toBe(true);

    feel.update(0.2);
    expect(finiteFinish).toHaveBeenCalledWith(false);
    expect(playback?.active).toBe(false);
  });

  it("starts a dynamic child after its delay", () => {
    const { entity } = createMockEntity();
    const updates = vi.fn();
    const feel = entity.add(
      new Feel({
        delayed: feelDelay(
          0.1,
          defineFeelState({}, () => ({ update: updates })),
        ),
      }),
    );

    const playback = feel.play("delayed");
    expect(updates).not.toHaveBeenCalled();
    feel.update(0.1);
    expect(updates).toHaveBeenCalledWith(1, 0);
    expect(playback?.active).toBe(true);

    playback?.release();
    expect(playback?.active).toBe(false);
  });

  it("runs every fixed repeat with its gaps", () => {
    const { entity } = createMockEntity();
    const starts = vi.fn();
    const feel = entity.add(
      new Feel({
        repeated: feelRepeat(
          defineFeelEffect(0.1, () => ({ start: starts })),
          3,
          0.05,
        ),
      }),
    );

    const playback = feel.play("repeated");
    feel.update(0.4);

    expect(starts).toHaveBeenCalledTimes(3);
    expect(playback?.active).toBe(false);
  });

  it("completes nested dynamic composition after its release tail", () => {
    const { entity } = createMockEntity();
    const after = vi.fn();
    const feel = entity.add(
      new Feel({
        nested: feelParallel(
          feelSequence(
            feelDelay(
              0.1,
              defineFeelState({ release: 0.1 }, () => ({ update: () => {} })),
            ),
            defineFeelEffect(0, () => ({ start: after })),
          ),
          defineFeelEffect(0.2, () => ({})),
        ),
      }),
    );

    const playback = feel.play("nested");
    feel.update(0.1);
    playback?.release();
    feel.update(0.1);

    expect(after).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(false);
  });

  it("cancels without starting a pending sequence child", () => {
    const { entity } = createMockEntity();
    const pending = vi.fn();
    const feel = entity.add(
      new Feel({
        staged: feelSequence(
          defineFeelEffect(1, () => ({})),
          defineFeelEffect(0, () => ({ start: pending })),
        ),
      }),
    );

    const playback = feel.play("staged");
    playback?.stop();
    feel.update(2);

    expect(pending).not.toHaveBeenCalled();
    expect(playback?.active).toBe(false);
  });

  it("keeps a state release tail when its release hook ends an owned source", () => {
    const { entity } = createMockEntity();
    const amounts: number[] = [];
    let sourceComplete = false;
    const feel = entity.add(
      new Feel({
        held: defineFeelState({ release: 1 }, () => ({
          update: (amount) => amounts.push(amount),
          release: () => {
            sourceComplete = true;
          },
          isComplete: () => sourceComplete,
        })),
      }),
    );

    const playback = feel.play("held");
    playback?.release();
    feel.update(0.5);

    expect(playback?.active).toBe(true);
    expect(amounts.at(-1)).toBeCloseTo(0.5);
    feel.update(0.5);
    expect(playback?.active).toBe(false);
    expect(amounts.at(-1)).toBe(0);
  });

  it("lets an owned state source complete without a release request", () => {
    const { entity } = createMockEntity();
    const finish = vi.fn();
    let sourceComplete = false;
    const feel = entity.add(
      new Feel({
        held: defineFeelState({}, () => ({
          update: () => {},
          isComplete: () => sourceComplete,
          finish,
        })),
      }),
    );

    const playback = feel.play("held");
    sourceComplete = true;
    feel.update(0);

    expect(playback?.active).toBe(false);
    expect(finish).toHaveBeenCalledWith(false);
  });

  it("skips the held phase of a state reached after release", () => {
    const { entity } = createMockEntity();
    const amounts: number[] = [];
    const after = vi.fn();
    const feel = entity.add(
      new Feel({
        delayed: feelSequence(
          feelDelay(0.1),
          defineFeelState({ attack: 1, release: 1 }, () => ({
            update: (amount) => amounts.push(amount),
          })),
          defineFeelEffect(0, () => ({ start: after })),
        ),
      }),
    );

    const playback = feel.play("delayed");
    playback?.release();
    feel.update(0.1);

    expect(amounts).toEqual([0]);
    expect(after).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(false);
  });

  it("runs an owned source reached after a held state releases", () => {
    const { entity } = createMockEntity();
    let sourceComplete = false;
    const sourceStarted = vi.fn();
    const sourceReleased = vi.fn();
    const feel = entity.add(
      new Feel({
        staged: feelSequence(
          defineFeelState({}, () => ({ update: () => {} })),
          defineFeelEffect(0, () => ({
            start: sourceStarted,
            release: sourceReleased,
            isComplete: () => sourceComplete,
          })),
        ),
      }),
    );

    const playback = feel.play("staged");
    playback?.release();
    feel.update(0);

    expect(sourceStarted).toHaveBeenCalledOnce();
    expect(sourceReleased).not.toHaveBeenCalled();
    expect(playback?.active).toBe(true);

    sourceComplete = true;
    feel.update(0);

    expect(sourceReleased).not.toHaveBeenCalled();
    expect(playback?.active).toBe(false);
  });

  it("loops until release and lets the current iteration finish", () => {
    const { entity } = createMockEntity();
    const starts = vi.fn();
    const feel = entity.add(
      new Feel({
        loop: feelLoop(defineFeelEffect(0.1, () => ({ start: starts }))),
      }),
    );

    const playback = feel.play("loop");
    feel.update(0.1);
    expect(starts).toHaveBeenCalledTimes(2);
    playback?.release();
    feel.update(0.1);

    expect(starts).toHaveBeenCalledTimes(2);
    expect(playback?.active).toBe(false);
  });

  it("does not complete a sub-epsilon loop iteration without elapsed time", () => {
    const { entity } = createMockEntity();
    const starts = vi.fn();
    const feel = entity.add(
      new Feel({
        loop: feelLoop(
          defineFeelEffect(Number.EPSILON, () => ({ start: starts })),
        ),
      }),
    );

    const playback = feel.play("loop");
    expect(starts).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(true);
    expect(() => feel.update(0)).not.toThrow();
    expect(starts).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(true);

    playback?.release();
    expect(playback?.active).toBe(true);
    feel.update(Number.EPSILON);
    expect(playback?.active).toBe(false);
  });

  it("completes a released loop immediately while it is in a gap", () => {
    const { entity } = createMockEntity();
    const feel = entity.add(
      new Feel({
        loop: feelLoop(
          defineFeelEffect(0, () => ({})),
          0.1,
        ),
      }),
    );

    const playback = feel.play("loop");
    playback?.release();

    expect(playback?.active).toBe(false);
  });

  it("lets a zero-time owned source keep the playback active", () => {
    const { entity } = createMockEntity();
    let sourceComplete = false;
    const next = vi.fn();
    const finish = vi.fn();
    const feel = entity.add(
      new Feel({
        source: feelSequence(
          defineFeelEffect(0, () => ({
            isComplete: () => sourceComplete,
            finish,
          })),
          defineFeelEffect(0, () => ({ start: next })),
        ),
      }),
    );

    const playback = feel.play("source");
    expect(next).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(true);

    sourceComplete = true;
    feel.update(0);
    expect(finish).toHaveBeenCalledWith(false);
    expect(playback?.active).toBe(false);
  });

  it("waits for a positive source-owned step without using elapsed dt", () => {
    const { entity } = createMockEntity();
    let sourceComplete = false;
    const next = vi.fn();
    const feel = entity.add(
      new Feel({
        source: feelSequence(
          defineFeelSourceEffect(0.1, () => ({
            isComplete: () => sourceComplete,
          })),
          defineFeelEffect(0, () => ({ start: next })),
        ),
      }),
    );

    const playback = feel.play("source");
    feel.update(1);
    expect(next).not.toHaveBeenCalled();
    expect(playback?.active).toBe(true);

    sourceComplete = true;
    feel.update(0);
    expect(next).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(false);
  });

  it("attributes invalid state easing results to the callback boundary", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const feel = entity.add(
      new Feel({
        broken: defineFeelState(
          { attack: 1, attackEasing: () => Number.NaN },
          () => ({ update: () => {} }),
        ),
      }),
    );

    feel.play("broken");
    expect(() => feel.update(0.1)).toThrow(/finite number/);
    expect(boundary.getCallbackErrors().at(-1)?.kind).toBe(
      "Feel callback (state attack easing)",
    );
  });

  it("rejects an overflowing derived state amount before update", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const updates = vi.fn();
    const feel = entity.add(
      new Feel({
        broken: defineFeelState(
          {
            attack: 1,
            release: 1,
            attackEasing: () => Number.MAX_VALUE,
            releaseEasing: () => -Number.MAX_VALUE,
          },
          () => ({ update: updates }),
        ),
      }),
    );

    const playback = feel.play("broken");
    feel.update(0.5);
    playback?.release();
    const callsBeforeOverflow = updates.mock.calls.length;

    expect(() => feel.update(0.5)).toThrow(
      "defineFeelState: releaseEasing must produce a finite amount, got Infinity.",
    );
    expect(boundary.getCallbackErrors().at(-1)?.kind).toBe(
      "Feel callback (state release easing)",
    );
    expect(updates).toHaveBeenCalledTimes(callsBeforeOverflow);
    expect(
      updates.mock.calls.every(([amount]) => Number.isFinite(amount)),
    ).toBe(true);
  });
});
