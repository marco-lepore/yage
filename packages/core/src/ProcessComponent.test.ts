import { describe, it, expect, vi } from "vitest";
import { ProcessComponent } from "./ProcessComponent.js";
import { Process } from "./Process.js";
import { Entity } from "./Entity.js";

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

  it("slot() count includes active slots", () => {
    const pc = makeComponent();
    const slot = pc.slot({ duration: 100 });
    expect(pc.count).toBe(0);
    slot.start();
    expect(pc.count).toBe(1);
    pc._tick(100);
    expect(pc.count).toBe(0);
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
});
