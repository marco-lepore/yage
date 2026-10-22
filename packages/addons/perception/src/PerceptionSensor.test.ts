import { describe, expect, it, vi } from "vitest";
import {
  createMockScene,
  Entity,
  EntityPool,
  ErrorBoundaryKey,
  SceneTimeKey,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { EntityHandle } from "@yagejs/core";
import type { PerceptionSensorOptions } from "./PerceptionSensor.js";
import { PERCEPTIBLE_TAG, PerceptionSensor } from "./PerceptionSensor.js";
import { PerceptionMemory } from "./core/PerceptionMemory.js";
import {
  PerceptionDetectedEvent,
  PerceptionForgottenEvent,
  PerceptionLostEvent,
} from "./events.js";

function setup(options: PerceptionSensorOptions = {}) {
  const { scene, context } = createMockScene();
  const observer = scene.spawn("observer");
  observer.add(new Transform());
  const target = scene.spawn("target", { key: "target" });
  target.tags.add(PERCEPTIBLE_TAG);
  target.add(new Transform({ position: new Vec2(50, 0) }));
  const sensor = observer.add(new PerceptionSensor(options));
  const time = scene.tryResolveScoped(SceneTimeKey)!;
  return { observer, target, sensor, scene, context, time };
}

describe("PerceptionSensor", () => {
  it("works with default tag discovery and reports serializable facts", () => {
    const { sensor, target } = setup();
    sensor.sense();
    expect(sensor.detected[0]?.target.current).toBe(target);
    expect(sensor.evaluations[0]).toMatchObject({
      reason: null,
      distance: 50,
      visibility: 1,
    });
    expect(JSON.parse(JSON.stringify(sensor.diagnostics))).toMatchObject([
      { visible: true, lastPosition: { x: 50, y: 0 }, age: 0 },
    ]);
  });
  it("uses acquisition/retention range and inclusive FOV boundaries", () => {
    const { sensor, target } = setup({
      range: 50,
      loseRange: 70,
      fieldOfView: Math.PI / 2,
    });
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
    target.get(Transform).setPosition(65, 0);
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
    target.get(Transform).setPosition(71, 0);
    sensor.sense();
    expect(sensor.evaluations[0]?.reason).toBe("out-of-range");
    target.get(Transform).setPosition(60, 0);
    sensor.sense();
    expect(sensor.detected).toHaveLength(0);
    target.get(Transform).setPosition(30, 30);
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
    target.get(Transform).setPosition(29, 30);
    sensor.sense();
    expect(sensor.evaluations[0]?.reason).toBe("outside-field-of-view");
  });
  it("uses parent world transforms and treats coincident points as inside even with FOV zero", () => {
    const { sensor, target, observer, scene } = setup({
      range: 30,
      fieldOfView: 0,
    });
    const parent = scene.spawn("parent");
    parent.add(
      new Transform({ position: new Vec2(100, 0), rotation: Math.PI / 2 }),
    );
    parent.addChild("observer", observer);
    target.get(Transform).setPosition(100, 0);
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
    target.get(Transform).setPosition(100, 20);
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
  });
  it("faces the world angle from the facing option over the Transform rotation", () => {
    let facing = Math.PI;
    const { sensor, target } = setup({
      fieldOfView: Math.PI / 2,
      facing: () => facing,
    });
    sensor.sense();
    expect(sensor.evaluations[0]?.reason).toBe("outside-field-of-view");
    target.get(Transform).setPosition(-50, 0);
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
    facing = NaN;
    expect(() => sensor.sense()).toThrow("PerceptionSensor.facing");
  });
  it("finds the observation of an entity's current life", () => {
    const { sensor, target, scene } = setup();
    const other = scene.spawn("other");
    other.add(new Transform({ position: new Vec2(10, 0) }));
    sensor.sense();
    expect(sensor.observationOf(target)).toMatchObject({ visible: true });
    expect(sensor.observationOf(other)).toBeUndefined();
    target.get(Transform).setPosition(500, 0);
    sensor.sense();
    expect(sensor.observationOf(target)).toMatchObject({
      visible: false,
      reason: "out-of-range",
      lastPosition: { x: 50, y: 0 },
    });
  });
  it("runs the checks in order and reports their rejection reasons", () => {
    const los = vi.fn(() => false);
    const visibility = vi.fn(() => 0.5);
    const { sensor } = setup({
      eligible: () => "friendly",
      lineOfSight: los,
      visibility,
    });
    sensor.sense();
    expect(sensor.evaluations[0]?.reason).toBe("friendly");
    expect(los).not.toHaveBeenCalled();
    expect(visibility).not.toHaveBeenCalled();
    const second = setup({ lineOfSight: los, visibility });
    second.sensor.sense();
    expect(second.sensor.evaluations[0]?.reason).toBe("occluded");
    expect(visibility).not.toHaveBeenCalled();
    const third = setup({ visibility: () => 0.25, visibilityThreshold: 0.5 });
    third.sensor.sense();
    expect(third.sensor.evaluations[0]?.reason).toBe(
      "below-visibility-threshold",
    );
  });
  it("uses scene simulation time for loss and expiry; zero dt does not sample", () => {
    const { sensor, target, time } = setup({ memoryDuration: 2 });
    sensor.update(0);
    expect(sensor.evaluations).toEqual([]);
    sensor.update(1 / 60);
    time._tick(1);
    target.tags.delete(PERCEPTIBLE_TAG);
    sensor.update(1 / 60);
    expect(sensor.diagnostics[0]).toMatchObject({
      age: 1,
      reason: "unavailable",
      visible: false,
    });
    time._tick(1);
    sensor.sense();
    expect(sensor.observations).toEqual([]);
  });
  it("clears on disable and on host deactivation and can resume", () => {
    const { observer, sensor } = setup();
    const events: string[] = [];
    observer.on(PerceptionLostEvent, () => events.push("lost"));
    observer.on(PerceptionForgottenEvent, () => events.push("forgotten"));
    sensor.sense();
    sensor.enabled = false;
    sensor.sense();
    expect(sensor.observations).toEqual([]);
    expect(events).toEqual(["lost", "forgotten"]);
    sensor.enabled = true;
    sensor.sense();
    observer.setActive(false);
    expect(sensor.observations).toEqual([]);
    observer.setActive(true);
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
    observer.remove(PerceptionSensor);
    expect(sensor.observations).toEqual([]);
  });
  it("drops destroyed and dormant targets without transferring old positions", () => {
    const { sensor, target } = setup();
    sensor.sense();
    target.setActive(false);
    expect(sensor.detected).toEqual([]);
    sensor.sense();
    expect(sensor.diagnostics[0]?.reason).toBe("unavailable");
    target.setActive(true);
    sensor.sense();
    target.destroy();
    expect(sensor.detected).toEqual([]);
    sensor.sense();
    expect(sensor.diagnostics[0]?.alive).toBe(false);
  });
  it("handles pooled life generations using engine handles", () => {
    const { scene, sensor } = setup();
    class PooledTarget extends Entity {
      onAcquire(): void {}
      setup() {
        this.tags.add(PERCEPTIBLE_TAG);
        this.add(new Transform());
      }
    }
    const pool = new EntityPool(scene, PooledTarget, { prewarm: 1 });
    const target = pool.acquire();
    sensor.sense();
    const old = sensor.detected.find(
      (entry) => entry.target.current === target,
    )!;
    pool.release(target);
    const next = pool.acquire();
    expect(next).toBe(target);
    sensor.sense();
    expect(old.target.current).toBeUndefined();
    expect(
      sensor.detected.find((entry) => entry.target.current === next)?.id,
    ).not.toBe(old.id);
  });
  it("attributes callback failure and keeps the prior sample", () => {
    let fail = false;
    const { sensor, context } = setup({
      visibility: () => {
        if (fail) throw new Error("check failed");
        return 1;
      },
    });
    sensor.sense();
    const before = sensor.snapshot();
    fail = true;
    expect(() => sensor.sense()).toThrow("check failed");
    expect(sensor.snapshot()).toEqual(before);
    expect(context.resolve(ErrorBoundaryKey).getCallbackErrors()).toMatchObject(
      [{ kind: "PerceptionSensor.visibility", error: "check failed" }],
    );
  });
  it("delivers the events of a listener's clear after the current batch", () => {
    const { sensor, scene, observer } = setup();
    const extra = scene.spawn("extra");
    extra.tags.add(PERCEPTIBLE_TAG);
    extra.add(new Transform());
    const events: string[] = [];
    let visible = 0;
    let extraDuringDelivery: unknown = "not read";
    observer.on(PerceptionDetectedEvent, ({ observation }) => {
      visible++;
      events.push(`detected ${observation.target.current?.name}`);
      if (visible === 1) sensor.clear();
      else extraDuringDelivery = sensor.observationOf(extra);
    });
    observer.on(PerceptionLostEvent, ({ observation }) => {
      visible--;
      events.push(`lost ${observation.target.current?.name}`);
    });
    observer.on(PerceptionForgottenEvent, ({ observation }) => {
      events.push(`forgotten ${observation.target.current?.name}`);
    });
    sensor.sense();
    expect(events).toEqual([
      "detected target",
      "detected extra",
      "lost target",
      "forgotten target",
      "lost extra",
      "forgotten extra",
    ]);
    expect(visible).toBe(0);
    // Listeners read current memory, which the clear already emptied.
    expect(extraDuringDelivery).toBeUndefined();
    expect(sensor.observations).toEqual([]);
  });
  it("queues the events of a listener's sample and of a disable", () => {
    const { sensor, observer, target } = setup();
    const events: string[] = [];
    observer.on(PerceptionDetectedEvent, () => {
      events.push("detected");
      target.get(Transform).setPosition(500, 0);
      sensor.sense();
      events.push("listener done");
    });
    observer.on(PerceptionLostEvent, ({ observation }) => {
      events.push(`lost ${observation.reason}`);
    });
    sensor.sense();
    expect(events).toEqual(["detected", "listener done", "lost out-of-range"]);
    const second = setup();
    const disabled: string[] = [];
    second.observer.on(PerceptionDetectedEvent, () => {
      disabled.push("detected");
      second.sensor.enabled = false;
      disabled.push("listener done");
    });
    second.observer.on(PerceptionLostEvent, ({ observation }) => {
      disabled.push(`lost ${observation.reason}`);
    });
    second.observer.on(PerceptionForgottenEvent, ({ observation }) => {
      disabled.push(`forgotten ${observation.reason}`);
    });
    second.sensor.sense();
    expect(disabled).toEqual([
      "detected",
      "listener done",
      "lost disabled",
      "forgotten disabled",
    ]);
  });
  it("drops the rest of the batch and the queue when a listener throws", () => {
    const { sensor, scene, observer } = setup();
    const extra = scene.spawn("extra");
    extra.tags.add(PERCEPTIBLE_TAG);
    extra.add(new Transform());
    const delivered: string[] = [];
    let fail = true;
    observer.on(PerceptionDetectedEvent, ({ observation }) => {
      delivered.push(`detected ${observation.target.current?.name}`);
      if (!fail) return;
      fail = false;
      sensor.clear();
      throw new Error("reaction failed");
    });
    observer.on(PerceptionLostEvent, ({ observation }) => {
      delivered.push(`lost ${observation.target.current?.name}`);
    });
    expect(() => sensor.sense()).toThrow("reaction failed");
    expect(delivered).toEqual(["detected target"]);
    // The queue is released, so the next sample delivers normally.
    sensor.sense();
    expect(delivered).toEqual([
      "detected target",
      "detected target",
      "detected extra",
    ]);
  });
  it("stops the sequence when an event listener throws", () => {
    const { sensor, observer } = setup();
    const later = vi.fn();
    observer.on(PerceptionDetectedEvent, () => {
      throw new Error("reaction failed");
    });
    observer.on(PerceptionDetectedEvent, later);
    expect(() => sensor.sense()).toThrow("reaction failed");
    expect(later).not.toHaveBeenCalled();
    expect(sensor.detected).toHaveLength(1);
    const lost = vi.fn();
    observer.on(PerceptionLostEvent, lost);
    sensor.clear();
    expect(lost).toHaveBeenCalledTimes(1);
  });
  it("saves keyed targets under their key and restores them by key", () => {
    const { sensor, target, time, scene } = setup();
    const unkeyed = scene.spawn("unkeyed");
    unkeyed.tags.add(PERCEPTIBLE_TAG);
    unkeyed.add(new Transform({ position: new Vec2(20, 0) }));
    sensor.sense();
    time._tick(1);
    const saved = JSON.parse(JSON.stringify(sensor.snapshot())) as ReturnType<
      typeof sensor.snapshot
    >;
    expect(saved.records.map((record) => record.id)).toEqual(["target"]);
    sensor.clear();
    sensor.restore(saved);
    expect(sensor.detected).toEqual([]);
    expect(sensor.observationOf(target)?.target.current).toBe(target);
    expect(sensor.diagnostics[0]).toMatchObject({ reason: "restored", age: 1 });
    sensor.sense();
    expect(sensor.detected).toHaveLength(2);
  });
  it.each([
    { range: NaN },
    { range: -1 },
    { range: 100, loseRange: 99 },
    { fieldOfView: 7 },
    { memoryDuration: Infinity },
    { visibilityThreshold: 0 },
    { memory: new PerceptionMemory<EntityHandle>(1), memoryDuration: 2 },
  ])("rejects invalid config %j", (options) => {
    expect(() => new PerceptionSensor(options)).toThrow("PerceptionSensor");
  });
  it("takes its duration from a supplied memory model", () => {
    const memory = new PerceptionMemory<EntityHandle>(5);
    const { sensor } = setup({ memory });
    expect(sensor.memory).toBe(memory);
    expect(sensor.config.memoryDuration).toBe(5);
  });
  it("rejects invalid callback results and targets without a sample point", () => {
    const { sensor } = setup({ visibility: () => NaN });
    expect(() => sensor.sense()).toThrow("visibility");
    expect(sensor.observations).toEqual([]);
    const { sensor: other, scene } = setup();
    scene.spawn("no-transform").tags.add(PERCEPTIBLE_TAG);
    expect(() => other.sense()).toThrow(
      'target "no-transform" has no Transform',
    );
    expect(other.observations).toEqual([]);
  });
  it("evaluates supplied candidates once each, skipping the observer, inactive entities, and other scenes", () => {
    // Each mock scene restarts entity ids, so the other scene comes first.
    const elsewhere = createMockScene("other").scene.spawn("elsewhere");
    elsewhere.add(new Transform({ position: new Vec2(10, 0) }));
    const listed: Entity[] = [];
    const { sensor, target, observer, scene } = setup({
      candidates: () => listed,
    });
    const inactive = scene.spawn("inactive");
    inactive.add(new Transform({ position: new Vec2(10, 0) }));
    inactive.setActive(false);
    const untagged = scene.spawn("untagged");
    untagged.add(new Transform({ position: new Vec2(20, 0) }));
    listed.push(observer, target, target, inactive, elsewhere, untagged);
    sensor.sense();
    expect(sensor.evaluations.map((entry) => entry.entityName)).toEqual([
      "target",
      "untagged",
    ]);
  });
  it("samples the point returned by the position option", () => {
    let point = { x: 0, y: 40 };
    const { sensor } = setup({ position: () => point });
    sensor.sense();
    expect(sensor.evaluations[0]).toMatchObject({ distance: 40 });
    expect(sensor.observations[0]?.lastPosition).toEqual({ x: 0, y: 40 });
    point = { x: Infinity, y: 0 };
    expect(() => sensor.sense()).toThrow("PerceptionSensor.position.x");
  });
  it("samples on updates with a positive delta unless autoUpdate is false", () => {
    const { sensor } = setup();
    sensor.update(0);
    expect(sensor.observations).toEqual([]);
    sensor.update(1 / 60);
    expect(sensor.detected).toHaveLength(1);
    const { sensor: manual } = setup({ autoUpdate: false });
    manual.update(1 / 60);
    expect(manual.observations).toEqual([]);
    manual.sense();
    expect(manual.detected).toHaveLength(1);
  });
  it("throws when a callback samples again or changes memory", () => {
    const { sensor } = setup({ eligible: () => (sensor.sense(), null) });
    expect(() => sensor.sense()).toThrow("called from a sensor callback");
    const { sensor: clearing } = setup({
      eligible: () => (clearing.clear(), null),
    });
    expect(() => clearing.sense()).toThrow("memory changed");
    expect(clearing.observations).toEqual([]);
  });
});

describe("restore and lifecycle boundaries", () => {
  it("validates the required Transform when attached", () => {
    const { scene } = createMockScene();
    const observer = scene.spawn("missing-transform");
    expect(() => observer.add(new PerceptionSensor())).toThrow(
      'PerceptionSensor.onAdd: observer "missing-transform" requires Transform',
    );
  });
  it("skips a saved key that resolves to the observer itself", () => {
    const { sensor, scene } = setup();
    sensor.sense();
    const saved = sensor.snapshot();
    const guard = scene.spawn("guard", { key: "guard" });
    guard.add(new Transform());
    const guardSensor = guard.add(new PerceptionSensor());
    guardSensor.restore({
      ...saved,
      records: [
        ...saved.records,
        ...saved.records.map((record) => ({ ...record, id: "guard" })),
      ],
    });
    expect(guardSensor.diagnostics.map((entry) => entry.reason)).toEqual([
      "restored",
    ]);
    expect(guardSensor.observationOf(guard)).toBeUndefined();
  });
  it("omits missing and inactive keyed targets on restore", () => {
    const { sensor, target, scene } = setup();
    const extra = scene.spawn("extra", { key: "extra" });
    extra.tags.add(PERCEPTIBLE_TAG);
    extra.add(new Transform());
    sensor.sense();
    const saved = sensor.snapshot();
    target.destroy();
    extra.setActive(false);
    sensor.restore(saved);
    expect(sensor.observations).toEqual([]);
  });
  it("validates snapshot data before replacing memory", () => {
    const { sensor } = setup();
    sensor.sense();
    const saved = sensor.snapshot();
    expect(() =>
      sensor.restore({
        ...saved,
        records: [{ ...saved.records[0]!, visibility: NaN }],
      }),
    ).toThrow("visibility");
    expect(sensor.snapshot()).toEqual(saved);
  });
  it("refuses to restore into a disabled sensor", () => {
    const { sensor } = setup();
    sensor.sense();
    const saved = sensor.snapshot();
    sensor.enabled = false;
    expect(() => sensor.restore(saved)).toThrow("must be enabled");
  });
});
