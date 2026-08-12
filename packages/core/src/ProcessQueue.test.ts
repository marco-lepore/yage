import { describe, it, expect, vi } from "vitest";
import { Process } from "./Process.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { ProcessSystem } from "./ProcessSystem.js";
import {
  makeEntityScopedQueue,
  makeGlobalScopedQueue,
  makeSceneScopedQueue,
} from "./ProcessQueue.js";
import { createMockEntity, createMockScene } from "./test-utils.js";

describe("makeEntityScopedQueue", () => {
  it("auto-adds a ProcessComponent if the entity doesn't have one", () => {
    const { entity } = createMockEntity();
    const queue = makeEntityScopedQueue(entity);
    queue.run(new Process({ duration: 100 }));
    expect(entity.tryGet(ProcessComponent)).toBeDefined();
  });

  it("re-uses an existing ProcessComponent on subsequent runs", () => {
    const { entity } = createMockEntity();
    const queue = makeEntityScopedQueue(entity);
    queue.run(new Process({ duration: 100 }));
    const pc = entity.tryGet(ProcessComponent);
    queue.run(new Process({ duration: 100 }));
    expect(entity.tryGet(ProcessComponent)).toBe(pc);
  });

  it("cancelAll cancels only processes the queue enqueued", () => {
    const { entity } = createMockEntity();
    const queue = makeEntityScopedQueue(entity);
    const ours = new Process({ duration: 100 });
    const theirs = new Process({ duration: 100 });
    const ourCancel = vi.spyOn(ours, "cancel");
    const theirCancel = vi.spyOn(theirs, "cancel");

    queue.run(ours);
    // Simulate a user-owned process going through the SAME ProcessComponent
    // but NOT the queue. Queue must not touch it.
    const pc = entity.tryGet(ProcessComponent)!;
    pc.run(theirs);

    queue.cancelAll();
    expect(ourCancel).toHaveBeenCalledOnce();
    expect(theirCancel).not.toHaveBeenCalled();
  });

  it("cancelAll skips already-completed processes", () => {
    const { entity } = createMockEntity();
    const queue = makeEntityScopedQueue(entity);
    const p = new Process({ duration: 100 });
    queue.run(p);
    p.cancel();
    const cancel = vi.spyOn(p, "cancel");
    queue.cancelAll();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("prunes completed processes lazily on each run", () => {
    const { entity } = createMockEntity();
    const queue = makeEntityScopedQueue(entity);

    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    queue.run(a);
    queue.run(b);
    a.cancel(); // marks completed

    const c = new Process({ duration: 100 });
    queue.run(c); // sweep happens here

    // cancelAll should now only attempt to cancel b and c (a already done).
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    const cCancel = vi.spyOn(c, "cancel");
    queue.cancelAll();
    expect(aCancel).not.toHaveBeenCalled();
    expect(bCancel).toHaveBeenCalledOnce();
    expect(cCancel).toHaveBeenCalledOnce();
  });

  describe("clock", () => {
    it("defaults to the frame clock", () => {
      const { entity } = createMockEntity();
      const queue = makeEntityScopedQueue(entity);
      const spy = vi.fn();
      queue.run(new Process({ update: spy }));
      const pc = entity.get(ProcessComponent);

      pc._tick(0.02, undefined, "fixed");
      expect(spy).not.toHaveBeenCalled();

      pc._tick(0.1);
      expect(spy).toHaveBeenCalledWith(0.1, 0.1);
    });

    it("a fixed queue advances its processes on fixed steps only", () => {
      const { entity } = createMockEntity();
      const queue = makeEntityScopedQueue(entity, { clock: "fixed" });
      const spy = vi.fn();
      queue.run(new Process({ update: spy }));
      const pc = entity.get(ProcessComponent);

      pc._tick(0.1);
      expect(spy).not.toHaveBeenCalled();

      pc._tick(0.02, undefined, "fixed");
      expect(spy).toHaveBeenCalledWith(0.02, 0.02);
    });

    it("cancelAll on a fixed queue leaves unrelated processes on both clocks", () => {
      const { entity } = createMockEntity();
      const queue = makeEntityScopedQueue(entity, { clock: "fixed" });
      const ours = new Process({ duration: 100 });
      queue.run(ours);

      // Processes going through the SAME ProcessComponent but not the queue.
      const pc = entity.get(ProcessComponent);
      const frameSpy = vi.fn();
      const fixedSpy = vi.fn();
      const theirFrame = new Process({ update: frameSpy });
      const theirFixed = new Process({ update: fixedSpy });
      pc.run(theirFrame);
      pc.run(theirFixed, { clock: "fixed" });

      const ourCancel = vi.spyOn(ours, "cancel");
      const frameCancel = vi.spyOn(theirFrame, "cancel");
      const fixedCancel = vi.spyOn(theirFixed, "cancel");

      queue.cancelAll();
      expect(ourCancel).toHaveBeenCalledOnce();
      expect(frameCancel).not.toHaveBeenCalled();
      expect(fixedCancel).not.toHaveBeenCalled();

      // Both unrelated processes still advance on their own clock.
      pc._tick(0.1);
      pc._tick(0.02, undefined, "fixed");
      expect(frameSpy).toHaveBeenCalledWith(0.1, 0.1);
      expect(fixedSpy).toHaveBeenCalledWith(0.02, 0.02);
    });

    it("two queues on one entity hold separate clocks and cancel separately", () => {
      const { entity } = createMockEntity();
      const frameQueue = makeEntityScopedQueue(entity);
      const fixedQueue = makeEntityScopedQueue(entity, { clock: "fixed" });
      const frameSpy = vi.fn();
      const fixedSpy = vi.fn();
      const frameProcess = frameQueue.run(new Process({ update: frameSpy }));
      const fixedProcess = fixedQueue.run(new Process({ update: fixedSpy }));
      const pc = entity.get(ProcessComponent);

      frameQueue.cancelAll();
      expect(frameProcess.completed).toBe(true);
      expect(fixedProcess.completed).toBe(false);

      pc._tick(0.1);
      pc._tick(0.02, undefined, "fixed");
      expect(fixedSpy).toHaveBeenCalledWith(0.02, 0.02);
      expect(frameSpy).not.toHaveBeenCalled();
    });

    it("leaves the tags of the processes it enqueues alone", () => {
      const { entity } = createMockEntity();
      const queue = makeEntityScopedQueue(entity, { clock: "fixed" });
      const p = queue.run(new Process({ duration: 100, tags: ["mine"] }));
      expect(p.tags).toEqual(["mine"]);
    });
  });
});

describe("makeGlobalScopedQueue", () => {
  it("forwards run() to ProcessSystem.add", () => {
    const ps = new ProcessSystem();
    const add = vi.spyOn(ps, "add");
    const queue = makeGlobalScopedQueue(ps);
    const p = new Process({ duration: 100 });
    queue.run(p);
    expect(add).toHaveBeenCalledWith(p, { clock: "frame" });
  });

  it("forwards the fixed clock to ProcessSystem.add", () => {
    const ps = new ProcessSystem();
    const add = vi.spyOn(ps, "add");
    const queue = makeGlobalScopedQueue(ps, { clock: "fixed" });
    const p = new Process({ duration: 100 });
    queue.run(p);
    expect(add).toHaveBeenCalledWith(p, { clock: "fixed" });
  });

  it("resolves the clock once at factory time", () => {
    const ps = new ProcessSystem();
    const add = vi.spyOn(ps, "add");
    // An options object with no `clock` key must still forward a complete
    // one, not the caller's object with an absent property.
    const queue = makeGlobalScopedQueue(ps, {});
    queue.run(new Process({ duration: 100 }));
    expect(add.mock.calls[0]?.[1]).toStrictEqual({ clock: "frame" });
  });

  it("cancelAll cancels only processes this queue enqueued", () => {
    const ps = new ProcessSystem();
    const queueA = makeGlobalScopedQueue(ps);
    const queueB = makeGlobalScopedQueue(ps);
    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    queueA.run(a);
    queueB.run(b);
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    queueA.cancelAll();
    expect(aCancel).toHaveBeenCalledOnce();
    expect(bCancel).not.toHaveBeenCalled();
  });

  it("cancelAll skips already-completed processes", () => {
    const ps = new ProcessSystem();
    const queue = makeGlobalScopedQueue(ps);
    const p = new Process({ duration: 100 });
    queue.run(p);
    p.cancel();
    const cancel = vi.spyOn(p, "cancel");
    queue.cancelAll();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("prunes completed processes lazily on run()", () => {
    const ps = new ProcessSystem();
    const queue = makeGlobalScopedQueue(ps);
    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    queue.run(a);
    a.cancel();
    queue.run(b); // sweep
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    queue.cancelAll();
    expect(aCancel).not.toHaveBeenCalled();
    expect(bCancel).toHaveBeenCalledOnce();
  });
});

describe("makeSceneScopedQueue", () => {
  it("forwards run() to ProcessSystem.addForScene with the bound scene", () => {
    const { scene } = createMockScene();
    const ps = new ProcessSystem();
    const addForScene = vi.spyOn(ps, "addForScene");
    const queue = makeSceneScopedQueue(ps, scene);
    const p = new Process({ duration: 100 });
    queue.run(p);
    expect(addForScene).toHaveBeenCalledWith(scene, p, { clock: "frame" });
  });

  it("forwards the fixed clock to ProcessSystem.addForScene", () => {
    const { scene } = createMockScene();
    const ps = new ProcessSystem();
    const addForScene = vi.spyOn(ps, "addForScene");
    const queue = makeSceneScopedQueue(ps, scene, { clock: "fixed" });
    const p = new Process({ duration: 100 });
    queue.run(p);
    expect(addForScene).toHaveBeenCalledWith(scene, p, { clock: "fixed" });
  });

  it("cancelAll cancels only processes this queue enqueued", () => {
    const { scene } = createMockScene();
    const ps = new ProcessSystem();
    const queueA = makeSceneScopedQueue(ps, scene);
    const queueB = makeSceneScopedQueue(ps, scene);
    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    queueA.run(a);
    queueB.run(b);
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    queueA.cancelAll();
    expect(aCancel).toHaveBeenCalledOnce();
    expect(bCancel).not.toHaveBeenCalled();
  });

  it("cancelAll on a fixed-clock queue cancels only its own processes", () => {
    const { scene } = createMockScene();
    const ps = new ProcessSystem();
    const queueA = makeSceneScopedQueue(ps, scene, { clock: "fixed" });
    const queueB = makeSceneScopedQueue(ps, scene, { clock: "fixed" });
    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    queueA.run(a);
    queueB.run(b);
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    queueA.cancelAll();
    expect(aCancel).toHaveBeenCalledOnce();
    expect(bCancel).not.toHaveBeenCalled();
  });
});
