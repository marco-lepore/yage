import { describe, it, expect, vi } from "vitest";
import { ProcessComponent } from "./ProcessComponent.js";
import { Process } from "./Process.js";
import { Entity } from "./Entity.js";
import { createMockEntity, createMockScene } from "./test-utils.js";
import { ErrorBoundaryKey } from "./EngineContext.js";

function makeComponent(): ProcessComponent {
  const pc = new ProcessComponent();
  const entity = new Entity("test");
  pc.entity = entity;
  return pc;
}

describe("ProcessComponent", () => {
  it("run() enrolls a process; _tick(dt) advances it", () => {
    const pc = makeComponent();
    const spy = vi.fn();
    const process = new Process({ update: spy });
    pc.run(process);
    pc._tick(16);
    expect(spy).toHaveBeenCalledWith(16, 16);
  });

  it("run() returns the process for chaining", () => {
    const pc = makeComponent();
    const process = new Process({ update: () => {} });
    expect(pc.run(process)).toBe(process);
  });

  it("completed processes are removed from the set after tick", () => {
    const pc = makeComponent();
    const process = new Process({ update: () => true }); // completes immediately
    pc.run(process);
    expect(pc.count).toBe(1);
    pc._tick(16);
    expect(pc.count).toBe(0);
  });

  it("cancel() cancels all processes", () => {
    const pc = makeComponent();
    const p1 = new Process({ update: () => {} });
    const p2 = new Process({ update: () => {} });
    pc.run(p1);
    pc.run(p2);
    pc.cancel();
    expect(p1.completed).toBe(true);
    expect(p2.completed).toBe(true);
    expect(pc.count).toBe(0);
  });

  it("cancel(tag) only cancels matching processes", () => {
    const pc = makeComponent();
    const p1 = new Process({ update: () => {}, tags: ["vfx"] });
    const p2 = new Process({ update: () => {}, tags: ["gameplay"] });
    pc.run(p1);
    pc.run(p2);
    pc.cancel("vfx");
    expect(p1.completed).toBe(true);
    expect(p2.completed).toBe(false);
    // p2 is still active
    expect(pc.count).toBe(1);
  });

  it("onDestroy() cancels all processes", () => {
    const pc = makeComponent();
    const p1 = new Process({ update: () => {} });
    const p2 = new Process({ update: () => {} });
    pc.run(p1);
    pc.run(p2);
    pc.onDestroy();
    expect(p1.completed).toBe(true);
    expect(p2.completed).toBe(true);
  });

  it("adding an already-completed process is a no-op (removed on next tick)", () => {
    const pc = makeComponent();
    const process = new Process({ update: () => true });
    // Manually complete it
    process._update(1);
    expect(process.completed).toBe(true);
    pc.run(process);
    // The process is in the set but completed
    pc._tick(16);
    // After tick it should be cleaned up
    expect(pc.count).toBe(0);
  });

  it("count reflects active processes", () => {
    const pc = makeComponent();
    expect(pc.count).toBe(0);
    const p1 = new Process({ update: () => {} });
    const p2 = new Process({ update: () => {} });
    pc.run(p1);
    expect(pc.count).toBe(1);
    pc.run(p2);
    expect(pc.count).toBe(2);
    p1.cancel();
    expect(pc.count).toBe(1);
  });

  // --- slot() tests ---

  it("slot() creates a slot that is ticked automatically", () => {
    const pc = makeComponent();
    const update = vi.fn();
    const slot = pc.slot({ duration: 100, update });
    slot.start();
    pc._tick(16);
    expect(update).toHaveBeenCalledWith(16, 16);
  });

  it("cancel() catches work a slot cleanup schedules", () => {
    const pc = makeComponent();
    const onComplete = vi.fn();
    // A slot cleanup runs during cancel() and can schedule again. If the
    // one-off sets were drained before slots were cancelled, this would
    // survive the cancel and fire on the next tick.
    const slot = pc.slot({
      duration: 100,
      cleanup: () => {
        pc.run(Process.delay(1, onComplete));
      },
    });
    slot.start();

    pc.cancel();
    pc._tick(2);

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("slot() count includes active slots", () => {
    const pc = makeComponent();
    const slot = pc.slot({ duration: 100 });
    expect(pc.count).toBe(0);
    slot.start();
    expect(pc.count).toBe(1);
    pc._tick(100);
    expect(pc.count).toBe(0);
  });

  it("removeSlot() unregisters and cancels an owned slot", () => {
    const pc = makeComponent();
    const cleanup = vi.fn();
    const update = vi.fn();
    const slot = pc.slot({ duration: 100, cleanup, update });
    slot.start();

    expect(pc.removeSlot(slot)).toBe(true);
    expect(slot.completed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();

    pc._tick(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("removeSlot() removes a completed slot without running cleanup again", () => {
    const pc = makeComponent();
    const cleanup = vi.fn();
    const slot = pc.slot({ duration: 1, cleanup });
    slot.start();
    pc._tick(1);
    expect(cleanup).toHaveBeenCalledOnce();

    expect(pc.removeSlot(slot)).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(pc.removeSlot(slot)).toBe(false);
  });

  it("removeSlot() leaves a foreign slot untouched", () => {
    const owner = makeComponent();
    const other = makeComponent();
    const slot = other.slot({ duration: 100 });
    slot.start();

    expect(owner.removeSlot(slot)).toBe(false);
    expect(slot.completed).toBe(false);
  });

  it("removeSlot() during update prevents completion and a second cleanup", () => {
    const pc = makeComponent();
    const onComplete = vi.fn();
    const cleanup = vi.fn();
    const slot = pc.slot({
      duration: 1,
      update: () => {
        pc.removeSlot(slot);
        return true;
      },
      onComplete,
      cleanup,
    });
    slot.start();

    pc._tick(1);

    expect(slot.completed).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cancel() cancels all slots", () => {
    const pc = makeComponent();
    const cleanup = vi.fn();
    const slot = pc.slot({ duration: 100, cleanup });
    slot.start();
    pc.cancel();
    expect(slot.completed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cancel(tag) cancels matching slots", () => {
    const pc = makeComponent();
    const s1 = pc.slot({ duration: 100, tags: ["vfx"] });
    const s2 = pc.slot({ duration: 100, tags: ["gameplay"] });
    s1.start();
    s2.start();
    pc.cancel("vfx");
    expect(s1.completed).toBe(true);
    expect(s2.completed).toBe(false);
  });

  it("onDestroy() cancels all slots and calls cleanup", () => {
    const pc = makeComponent();
    const cleanup = vi.fn();
    const slot = pc.slot({ duration: 100, cleanup });
    slot.start();
    pc.onDestroy();
    expect(slot.completed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  // --- run() tests ---

  it("run() adds and returns a process", () => {
    const pc = makeComponent();
    const process = new Process({ update: () => {} });
    const result = pc.run(process);
    expect(result).toBe(process);
    expect(pc.count).toBe(1);
  });

  it("run() applies tags to the process", () => {
    const pc = makeComponent();
    const process = new Process({ update: () => {} });
    pc.run(process, { tags: ["vfx"] });
    pc.cancel("vfx");
    expect(process.completed).toBe(true);
  });

  it("cancel(tag) cancels both slots and one-off processes with that tag", () => {
    const pc = makeComponent();
    const slot = pc.slot({ duration: 100, tags: ["vfx"] });
    const process = new Process({ update: () => {}, tags: ["vfx"] });
    slot.start();
    pc.run(process);
    pc.cancel("vfx");
    expect(slot.completed).toBe(true);
    expect(process.completed).toBe(true);
  });

  it("timeScale=0 (via 0 dt) freezes all slots", () => {
    const pc = makeComponent();
    const slot = pc.slot({ duration: 100 });
    slot.start();
    pc._tick(0);
    expect(slot.elapsed).toBe(0);
    expect(slot.completed).toBe(false);
  });

  describe("fixed clock", () => {
    it("a fixed-clock process only advances on fixed ticks", () => {
      const pc = makeComponent();
      const spy = vi.fn();
      pc.run(new Process({ update: spy }), { clock: "fixed" });

      pc._tick(0.1); // frame tick
      expect(spy).not.toHaveBeenCalled();

      pc._tick(0.02, undefined, "fixed");
      expect(spy).toHaveBeenCalledWith(0.02, 0.02);
    });

    it("a frame-clock process is untouched by fixed ticks", () => {
      const pc = makeComponent();
      const spy = vi.fn();
      pc.run(new Process({ update: spy }));

      pc._tick(0.02, undefined, "fixed");
      expect(spy).not.toHaveBeenCalled();

      pc._tick(0.1);
      expect(spy).toHaveBeenCalledWith(0.1, 0.1);
    });

    it("a completed fixed-clock process is removed on its own tick", () => {
      const pc = makeComponent();
      pc.run(new Process({ update: () => true }), { clock: "fixed" });
      expect(pc.count).toBe(1);
      pc._tick(0.1); // frame tick doesn't touch it
      expect(pc.count).toBe(1);
      pc._tick(0.02, undefined, "fixed");
      expect(pc.count).toBe(0);
    });

    it("a fixed-clock slot only advances on fixed ticks", () => {
      const pc = makeComponent();
      const slot = pc.slot({ duration: 0.04, clock: "fixed" });
      slot.start();

      pc._tick(0.1);
      expect(slot.elapsed).toBe(0);

      pc._tick(0.02, undefined, "fixed");
      expect(slot.elapsed).toBe(0.02);
      pc._tick(0.02, undefined, "fixed");
      expect(slot.completed).toBe(true);
    });

    it("removeSlot() unregisters a fixed-clock slot", () => {
      const pc = makeComponent();
      const slot = pc.slot({ duration: 1, clock: "fixed" });
      slot.start();
      expect(pc.removeSlot(slot)).toBe(true);
      expect(slot.completed).toBe(true);
      pc._tick(0.02, undefined, "fixed");
      expect(slot.elapsed).toBe(0);
    });

    it("cancel() covers both clocks", () => {
      const pc = makeComponent();
      const frame = new Process({ update: () => {} });
      const fixed = new Process({ update: () => {} });
      pc.run(frame);
      pc.run(fixed, { clock: "fixed" });
      const slot = pc.slot({ duration: 1, clock: "fixed" });
      slot.start();

      pc.cancel();
      expect(frame.completed).toBe(true);
      expect(fixed.completed).toBe(true);
      expect(slot.completed).toBe(true);
      expect(pc.count).toBe(0);
    });

    it("cancel(tag) reaches fixed-clock processes", () => {
      const pc = makeComponent();
      const tagged = new Process({ update: () => {} });
      const other = new Process({ update: () => {} });
      pc.run(tagged, { clock: "fixed", tags: ["gameplay"] });
      pc.run(other, { clock: "fixed" });

      pc.cancel("gameplay");
      expect(tagged.completed).toBe(true);
      expect(other.completed).toBe(false);
    });

    it("count sums both clocks", () => {
      const pc = makeComponent();
      pc.run(new Process({ update: () => {} }));
      pc.run(new Process({ update: () => {} }), { clock: "fixed" });
      pc.slot({ duration: 1, clock: "fixed" }).start();
      expect(pc.count).toBe(3);
    });

    it("re-running a live process with a different clock keeps its original clock", () => {
      const pc = makeComponent();
      const spy = vi.fn();
      const p = new Process({ update: spy });
      pc.run(p);
      pc.run(p, { clock: "fixed" });
      expect(pc.count).toBe(1);
      pc._tick(0.02, undefined, "fixed");
      expect(spy).not.toHaveBeenCalled();
      pc._tick(0.1);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("error boundary", () => {
    function makeWiredComponent() {
      const { entity, context } = createMockEntity("player");
      const pc = new ProcessComponent();
      entity.add(pc);
      const boundary = context.tryResolve(ErrorBoundaryKey)!;
      return { pc, entity, boundary };
    }

    it("a throwing process rethrows, leaving it uncompleted and later processes untouched", () => {
      const { pc, boundary } = makeWiredComponent();
      const throwing = new Process({
        update: () => {
          throw new Error("boom");
        },
      });
      const okSpy = vi.fn();
      const ok = new Process({ update: okSpy });
      pc.run(throwing);
      pc.run(ok);

      expect(() => pc._tick(16)).toThrow("boom");

      expect(throwing.completed).toBe(false);
      expect(okSpy).not.toHaveBeenCalled();
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Process callback",
      });
    });

    it("a throwing slot rethrows, leaving it uncompleted and later slots untouched", () => {
      const { pc, boundary } = makeWiredComponent();
      const throwingSlot = pc.slot({
        duration: 100,
        update: () => {
          throw new Error("boom");
        },
      });
      const okSpy = vi.fn();
      const okSlot = pc.slot({ duration: 100, update: okSpy });
      throwingSlot.start();
      okSlot.start();

      expect(() => pc._tick(16)).toThrow("boom");

      expect(throwingSlot.completed).toBe(false);
      expect(okSpy).not.toHaveBeenCalled();
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Process slot callback",
      });
    });

    it("an async process's rejection is reported without completing it", async () => {
      const { pc, boundary } = makeWiredComponent();
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      const proc = new Process({
        update: (() => Promise.reject(new Error("async boom"))) as unknown as
          // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
          (dt: number, elapsed: number) => boolean | void,
      });
      pc.run(proc);

      pc._tick(16);
      expect(proc.completed).toBe(false); // the rejection hasn't settled yet

      const reason = await rejection;
      expect((reason as Error).message).toBe("async boom");
      expect(proc.completed).toBe(false); // never cancelled — resilience is deferred
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        error: "async boom",
      });
    });

    it("records the owning entity and scene name", () => {
      const { pc, entity, boundary } = makeWiredComponent();
      pc.run(
        new Process({
          update: () => {
            throw new Error("boom");
          },
        }),
      );

      expect(() => pc._tick(16, "TestScene")).toThrow("boom");

      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Process callback",
        entity: entity.name,
        scene: "TestScene",
      });
    });

    it("falls back to an unguarded tick when no boundary is registered", () => {
      const pc = makeComponent(); // detached entity, never added to a scene
      const process = new Process({
        update: () => {
          throw new Error("boom");
        },
      });
      pc.run(process);
      expect(() => pc._tick(16)).toThrow("boom");
    });

    it("picks up the boundary when the entity gains a scene after onAdd, via addChild", () => {
      const { scene, context } = createMockScene();
      const boundary = context.tryResolve(ErrorBoundaryKey)!;
      const parent = scene.spawn("parent");

      const bullet = new Entity("bullet");
      const pc = new ProcessComponent();
      bullet.add(pc); // onAdd runs while bullet is still detached — no scene yet
      parent.addChild("bullet", bullet); // bullet now has a scene

      pc.run(
        new Process({
          update: () => {
            throw new Error("boom");
          },
        }),
      );

      expect(() => pc._tick(16)).toThrow("boom");
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Process callback",
      });
    });
  });
});
