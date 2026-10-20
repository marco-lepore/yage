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
import type { PerceptionSensorOptions } from "./PerceptionSensor.js";
import {
  PerceptionSensor,
  PerceptionDetectedEvent,
  PerceptionForgottenEvent,
  PerceptionLostEvent,
} from "./PerceptionSensor.js";

function setup(options: PerceptionSensorOptions = {}) {
  const { scene, context } = createMockScene();
  const observer = scene.spawn("observer");
  observer.add(new Transform());
  const target = scene.spawn("target", { key: "target" });
  target.tags.add("perceptible");
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
  it("runs policies in order and reports their rejection reasons", () => {
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
    target.tags.delete("perceptible");
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
        this.tags.add("perceptible");
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
        if (fail) throw new Error("policy failed");
        return 1;
      },
    });
    sensor.sense();
    const before = sensor.snapshot();
    fail = true;
    expect(() => sensor.sense()).toThrow("policy failed");
    expect(sensor.snapshot()).toEqual(before);
    expect(context.resolve(ErrorBoundaryKey).getCallbackErrors()).toMatchObject(
      [{ kind: "PerceptionSensor.visibility", error: "policy failed" }],
    );
  });
  it("stops stale transition dispatch when a listener clears the sensor", () => {
    const { sensor, scene, observer } = setup();
    const extra = scene.spawn("extra");
    extra.tags.add("perceptible");
    extra.add(new Transform());
    let detections = 0;
    observer.on(PerceptionDetectedEvent, () => {
      detections++;
      sensor.clear();
    });
    sensor.sense();
    expect(detections).toBe(1);
    expect(sensor.observations).toEqual([]);
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
  });
  it("restores stable ids against explicitly resolved live entities", () => {
    const { sensor, target, time, scene } = setup({
      identify: (entity) => entity.requireKey(),
    });
    sensor.sense();
    time._tick(1);
    const saved = sensor.snapshot();
    sensor.clear();
    sensor.restore(saved, (id) => scene.findByKey(id));
    expect(sensor.detected).toEqual([]);
    expect(sensor.observations[0]?.target.current).toBe(target);
    expect(sensor.diagnostics[0]).toMatchObject({ reason: "restored", age: 1 });
    sensor.sense();
    expect(sensor.detected).toHaveLength(1);
  });
  it.each([
    { range: NaN },
    { range: -1 },
    { range: 100, loseRange: 99 },
    { fieldOfView: 7 },
    { memoryDuration: Infinity },
    { visibilityThreshold: 0 },
  ])("rejects invalid config %j", (options) => {
    expect(() => new PerceptionSensor(options)).toThrow("PerceptionSensor");
  });
  it("rejects invalid policy results and duplicate ids without changing memory", () => {
    const { sensor } = setup({ visibility: () => NaN });
    expect(() => sensor.sense()).toThrow("visibility");
    expect(sensor.observations).toEqual([]);
    const { sensor: other, scene } = setup({ identify: () => "same" });
    const duplicate = scene.spawn("duplicate");
    duplicate.tags.add("perceptible");
    duplicate.add(new Transform());
    expect(() => other.sense()).toThrow("duplicate id");
    expect(other.observations).toEqual([]);
  });
});

describe("restore lifecycle boundaries", () => {
  it("validates the required Transform when attached", () => {
    const { scene } = createMockScene();
    const observer = scene.spawn("missing-transform");
    expect(() => observer.add(new PerceptionSensor())).toThrow(
      'PerceptionSensor.onAdd: observer "missing-transform" requires Transform',
    );
  });
  it.each(["disable", "clear", "remove", "deactivate"] as const)(
    "does not overwrite %s from a resolver",
    (action) => {
      const { sensor, target, observer } = setup();
      sensor.sense();
      const saved = sensor.snapshot();
      sensor.restore(saved, () => {
        if (action === "disable") sensor.enabled = false;
        if (action === "clear") sensor.clear();
        if (action === "remove") observer.remove(PerceptionSensor);
        if (action === "deactivate") observer.setActive(false);
        return target;
      });
      expect(sensor.observations).toEqual([]);
    },
  );
  it("validates snapshot data before calling the resolver", () => {
    const { sensor } = setup();
    sensor.sense();
    const saved = sensor.snapshot();
    const resolve = vi.fn();
    expect(() =>
      sensor.restore(
        { ...saved, records: [{ ...saved.records[0]!, visibility: NaN }] },
        resolve,
      ),
    ).toThrow("visibility");
    expect(resolve).not.toHaveBeenCalled();
    expect(sensor.snapshot()).toEqual(saved);
  });
  it("rechecks earlier bindings when a later resolver destroys their target", () => {
    const { sensor, target, scene } = setup();
    const extra = scene.spawn("extra");
    extra.tags.add("perceptible");
    extra.add(new Transform());
    sensor.sense();
    const saved = sensor.snapshot();
    sensor.restore(saved, (id) => {
      if (id === `${target.id}:${target.generation}`) return target;
      target.destroy();
      return extra;
    });
    expect(sensor.observations).toHaveLength(1);
    expect(sensor.observations[0]?.target.current).toBe(extra);
  });
  it("prevents recursive restore without changing memory", () => {
    const { sensor, target } = setup();
    sensor.sense();
    const saved = sensor.snapshot();
    expect(() =>
      sensor.restore(saved, () => {
        sensor.restore(saved, () => target);
        return target;
      }),
    ).toThrow("recursive restoration");
    expect(sensor.snapshot()).toEqual(saved);
  });
});
