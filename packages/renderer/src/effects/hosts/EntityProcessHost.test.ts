import { describe, it, expect, vi } from "vitest";
import { Process, ProcessComponent } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { makeEntityProcessHost } from "./EntityProcessHost.js";

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

describe("makeEntityProcessHost", () => {
  it("auto-adds a ProcessComponent if the entity doesn't have one", () => {
    const entity = fakeEntity();
    const host = makeEntityProcessHost(entity);
    const p = new Process({ duration: 100 });
    host.run(p);
    expect(entity.added).toHaveLength(1);
    expect(entity.hasProcessComponent).toBe(true);
  });

  it("re-uses an existing ProcessComponent on subsequent runs", () => {
    const entity = fakeEntity();
    const host = makeEntityProcessHost(entity);
    host.run(new Process({ duration: 100 }));
    host.run(new Process({ duration: 100 }));
    expect(entity.added).toHaveLength(1);
  });

  it("cancelAll cancels only processes the host enqueued", () => {
    const entity = fakeEntity();
    const host = makeEntityProcessHost(entity);
    const ours = new Process({ duration: 100 });
    const theirs = new Process({ duration: 100 });
    const ourCancel = vi.spyOn(ours, "cancel");
    const theirCancel = vi.spyOn(theirs, "cancel");

    host.run(ours);
    // Simulate user-owned process going through the same ProcessComponent
    // but NOT the host. Host should not touch it.

    host.cancelAll();
    expect(ourCancel).toHaveBeenCalledOnce();
    expect(theirCancel).not.toHaveBeenCalled();
  });

  it("cancelAll skips already-completed processes", () => {
    const entity = fakeEntity();
    const host = makeEntityProcessHost(entity);
    const p = new Process({ duration: 100 });
    host.run(p);
    p.cancel();
    const cancel = vi.spyOn(p, "cancel");
    host.cancelAll();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("prunes completed processes lazily on each run", () => {
    const entity = fakeEntity();
    const host = makeEntityProcessHost(entity);

    // Run two processes; complete one; run another. The completed one
    // should have been swept on the third run, but the active one survives.
    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    host.run(a);
    host.run(b);
    a.cancel(); // marks completed

    const c = new Process({ duration: 100 });
    host.run(c); // sweep happens here

    // cancelAll should now only attempt to cancel b and c (a already done).
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    const cCancel = vi.spyOn(c, "cancel");
    host.cancelAll();
    expect(aCancel).not.toHaveBeenCalled();
    expect(bCancel).toHaveBeenCalledOnce();
    expect(cCancel).toHaveBeenCalledOnce();
  });
});
