import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "./Engine.js";
import { Scene } from "./Scene.js";
import { Entity } from "./Entity.js";
import { EntityPool } from "./EntityPool.js";
import { SceneTimeKey } from "./SceneTime.js";

const engines: Engine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
});

async function setup() {
  const engine = new Engine();
  engines.push(engine);
  await engine.start();
  const controller = {
    isFrozen: false,
    freeze() {
      this.isFrozen = true;
    },
    thaw() {
      this.isFrozen = false;
    },
    setDelta: vi.fn(),
    stepFrames(count: number, dtMs = 1000 / 60) {
      for (let i = 0; i < count; i++) engine.loop.tick(dtMs);
    },
  };
  engine.inspector.attachTimeController(controller);
  engine.inspector.events.setEnabled(true);
  return { engine, inspector: engine.inspector, controller };
}

class TestScene extends Scene {
  readonly name = "test";
}
class Pooled extends Entity {
  onAcquire() {}
}

describe("Inspector clock and event completion", () => {
  it("uses one frame identity for automatic and manual ticks", async () => {
    const { engine, inspector } = await setup();
    engine.loop.tick(16);
    engine.events.emit("engine:started", undefined);
    expect(inspector.time.getFrame()).toBe(engine.loop.frameCount);
    expect(inspector.events.getLog().at(-1)?.frame).toBe(1);
    inspector.time.freeze();
    inspector.time.step();
    expect(inspector.snapshot().frame).toBe(2);
  });

  it("expires at a freely-running frame deadline", async () => {
    const { engine, inspector } = await setup();
    const rejected = expect(
      inspector.events.waitFor("absent", { withinFrames: 2 }),
    ).rejects.toThrow("2 frames");
    engine.loop.tick(16);
    engine.loop.tick(16);
    await rejected;
  });

  it("accepts events during the deadline frame before expiry", async () => {
    const { engine, inspector } = await setup();
    const scene = new TestScene();
    await engine.scenes.push(scene);
    const entity = scene.spawn("gone");
    const wait = inspector.events.waitFor("entity:destroyed", {
      withinFrames: 1,
    });
    entity.destroy();
    engine.loop.tick(16);
    await expect(wait).resolves.toMatchObject({
      frame: 1,
      type: "entity:destroyed",
    });
  });

  it("validates before history lookup and uses zero only for retained matches", async () => {
    const { engine, inspector } = await setup();
    engine.events.emit("engine:started", undefined);
    expect(() =>
      inspector.events.waitFor("engine:started", { withinFrames: -1 }),
    ).toThrow("non-negative");
    await expect(
      inspector.events.waitFor("engine:started", { withinFrames: 0 }),
    ).resolves.toMatchObject({ frame: 0 });
    await expect(
      inspector.events.waitFor("absent", { withinFrames: 0 }),
    ).rejects.toThrow("0 frames");
  });

  it.each([/engine:started/g, /engine:started/y])(
    "matches retained history repeatedly without changing %s",
    async (pattern) => {
      const { engine, inspector } = await setup();
      engine.events.emit("engine:started", undefined);
      engine.loop.tick(16);
      engine.events.emit("engine:started", undefined);
      pattern.lastIndex = 4;
      for (let i = 0; i < 2; i++)
        await expect(inspector.events.waitFor(pattern)).resolves.toMatchObject({
          frame: 0,
        });
      expect(pattern.lastIndex).toBe(4);
    },
  );

  it.each(["dispose", "disable"])(
    "rejects and removes pending waits on %s",
    async (action) => {
      const { engine, inspector } = await setup();
      const rejected = expect(
        inspector.events.waitFor("engine:started"),
      ).rejects.toThrow(action === "dispose" ? "disposed" : "disabled");
      if (action === "dispose") inspector.dispose();
      else inspector.events.setEnabled(false);
      await rejected;
      expect(
        (inspector as unknown as { eventWaiters: Set<unknown> }).eventWaiters
          .size,
      ).toBe(0);
      if (action === "disable") {
        inspector.events.setEnabled(true);
        const next = inspector.events.waitFor("engine:started");
        engine.events.emit("engine:started", undefined);
        await expect(next).resolves.toMatchObject({ type: "engine:started" });
      }
    },
  );

  it("leases control exclusively without changing clock state", async () => {
    const { inspector, controller } = await setup();
    const lease = inspector.time.acquire();
    expect(controller.isFrozen).toBe(false);
    expect(controller.setDelta).not.toHaveBeenCalled();
    expect(inspector.time.isOwned()).toBe(true);
    for (const mutate of [
      () => inspector.time.freeze(),
      () => inspector.time.thaw(),
      () => inspector.time.step(0),
      () => inspector.time.setDelta(10),
      () => inspector.time.acquire(),
    ])
      expect(mutate).toThrow("owned");
    lease.freeze();
    await lease.stepAsync(2);
    expect(inspector.time.getFrame()).toBe(2);
    lease.release();
    lease.release();
    expect(lease.getFrame()).toBe(2);
    expect(() => lease.step()).toThrow("released");
    await expect(lease.stepAsync()).rejects.toThrow("released");
    expect(inspector.time.isFrozen()).toBe(true);
    inspector.time.thaw();
  });

  it("holds raw asynchronous ownership across each yield and releases on failure", async () => {
    const { inspector } = await setup();
    inspector.time.freeze();
    const first = inspector.time.stepAsync(2);
    await expect(inspector.time.stepAsync()).rejects.toThrow("owned");
    expect(() => inspector.time.step()).toThrow("owned");
    await first;
    await expect(
      inspector.time.stepUntil(() => false, { maxFrames: 1 }),
    ).rejects.toThrow("predicate");
    expect(inspector.time.isOwned()).toBe(false);
    await inspector.time.stepAsync();
    expect(inspector.time.getFrame()).toBe(4);
  });

  it("prevents raw steps during a drive and releases after rejection", async () => {
    const { inspector } = await setup();
    const run = inspector.drive(async ({ step }) => {
      await step();
      throw new Error("drive failed");
    });
    expect(() => inspector.time.step()).toThrow("owned");
    await expect(run).resolves.toMatchObject({
      ok: false,
      error: "drive failed",
      framesUsed: 1,
    });
    expect(inspector.time.isOwned()).toBe(false);
    expect(inspector.time.isFrozen()).toBe(false);
    await expect(
      inspector.drive(async ({ step }) => {
        await step();
      }),
    ).resolves.toMatchObject({ ok: true, framesUsed: 1 });
  });

  it("reports dormant identities, consistent destroy-pending counts and owned clocks", async () => {
    const { engine, inspector } = await setup();
    const scene = new TestScene();
    await engine.scenes.push(scene);
    const pool = new EntityPool(scene, Pooled);
    const pooled = pool.acquire();
    pool.release(pooled);
    const destroyed = scene.spawn("destroyed");
    engine.loop.tick(25);
    destroyed.destroy();
    const snapshot = inspector.snapshot();
    const world = snapshot.scenes[0]!;
    expect(snapshot.entityCount).toBe(1);
    expect(snapshot.sceneStack[0]?.entityCount).toBe(1);
    expect(world.entities).toHaveLength(1);
    expect(world.entities[0]).toMatchObject({
      name: pooled.name,
      generation: pooled.generation,
      pooled: true,
      active: false,
    });
    const time = scene.tryResolveScoped(SceneTimeKey)!;
    expect(world.elapsed).toBe(time.elapsed);
    expect(world.fixedElapsed).toBe(time.fixedElapsed);
    expect(snapshot.fixedStepIndex).toBe(1);
    expect(snapshot.interpolationAlpha).toBeCloseTo(0.5);
    expect(world.physics.elapsed).toBe(0);
  });

  it.each(["flush", "pop", "replace"])(
    "retains the destroyed entity's scene identity on %s",
    async (action) => {
      const { engine, inspector } = await setup();
      const scene = new TestScene();
      await engine.scenes.push(scene);
      const entity = scene.spawn("gone");
      const id = inspector.snapshotScene("test").id;
      if (action === "flush") {
        entity.destroy();
        engine.loop.tick(16);
      } else if (action === "pop") await engine.scenes.pop();
      else await engine.scenes.replace(new TestScene());
      const log = (
        inspector as unknown as {
          eventLog: { entry: { type: string }; sceneId?: string }[];
        }
      ).eventLog;
      expect(
        log.find(({ entry }) => entry.type === "entity:destroyed")?.sceneId,
      ).toBe(id);
      if (action === "flush")
        expect(
          inspector
            .snapshotScene("test")
            .events.some((entry) => entry.type === "entity:destroyed"),
        ).toBe(true);
      if (action === "replace")
        expect(inspector.snapshotScene("test").id).not.toBe(id);
    },
  );
});
