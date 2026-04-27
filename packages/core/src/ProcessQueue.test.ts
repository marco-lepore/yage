import { describe, it, expect, vi } from "vitest";
import { Process } from "./Process.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { ProcessSystem } from "./ProcessSystem.js";
import {
  makeEntityScopedQueue,
  makeGlobalScopedQueue,
  makeSceneScopedQueue,
} from "./ProcessQueue.js";
import type { Entity } from "./Entity.js";

function fakeEntity(): Entity & {
  added: ProcessComponent[];
  hasProcessComponent: boolean;
} {
  let pc: ProcessComponent | undefined;
  const added: ProcessComponent[] = [];
  const stub = {
    added,
    get hasProcessComponent() {
      return pc !== undefined;
    },
    tryGet(cls: unknown): unknown {
      if (cls === ProcessComponent) return pc;
      return undefined;
    },
    add(comp: unknown): unknown {
      if (comp instanceof ProcessComponent) {
        pc = comp;
        added.push(comp);
      }
      return comp;
    },
  };
  return stub as unknown as Entity & {
    added: ProcessComponent[];
    hasProcessComponent: boolean;
  };
}

describe("makeEntityScopedQueue", () => {
  it("auto-adds a ProcessComponent if the entity doesn't have one", () => {
    const entity = fakeEntity();
    const queue = makeEntityScopedQueue(entity);
    queue.run(new Process({ duration: 100 }));
    expect(entity.added).toHaveLength(1);
    expect(entity.hasProcessComponent).toBe(true);
  });

  it("re-uses an existing ProcessComponent on subsequent runs", () => {
    const entity = fakeEntity();
    const queue = makeEntityScopedQueue(entity);
    queue.run(new Process({ duration: 100 }));
    queue.run(new Process({ duration: 100 }));
    expect(entity.added).toHaveLength(1);
  });

  it("cancelAll cancels only processes the queue enqueued", () => {
    const entity = fakeEntity();
    const queue = makeEntityScopedQueue(entity);
    const ours = new Process({ duration: 100 });
    const theirs = new Process({ duration: 100 });
    const ourCancel = vi.spyOn(ours, "cancel");
    const theirCancel = vi.spyOn(theirs, "cancel");

    queue.run(ours);
    // Simulate a user-owned process going through the SAME ProcessComponent
    // but NOT the queue. Queue must not touch it.
    const pc = entity.tryGet(ProcessComponent) as ProcessComponent;
    pc.run(theirs);

    queue.cancelAll();
    expect(ourCancel).toHaveBeenCalledOnce();
    expect(theirCancel).not.toHaveBeenCalled();
  });

  it("cancelAll skips already-completed processes", () => {
    const entity = fakeEntity();
    const queue = makeEntityScopedQueue(entity);
    const p = new Process({ duration: 100 });
    queue.run(p);
    p.cancel();
    const cancel = vi.spyOn(p, "cancel");
    queue.cancelAll();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("prunes completed processes lazily on each run", () => {
    const entity = fakeEntity();
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
});

describe("makeGlobalScopedQueue", () => {
  it("forwards run() to ProcessSystem.add", () => {
    const ps = new ProcessSystem();
    const add = vi.spyOn(ps, "add");
    const queue = makeGlobalScopedQueue(ps);
    const p = new Process({ duration: 100 });
    queue.run(p);
    expect(add).toHaveBeenCalledWith(p);
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
    const ps = new ProcessSystem();
    const scene = { name: "test" } as never;
    const addForScene = vi.spyOn(ps, "addForScene");
    const queue = makeSceneScopedQueue(ps, scene);
    const p = new Process({ duration: 100 });
    queue.run(p);
    expect(addForScene).toHaveBeenCalledWith(scene, p);
  });

  it("cancelAll cancels only processes this queue enqueued", () => {
    const ps = new ProcessSystem();
    const scene = { name: "test" } as never;
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
});
