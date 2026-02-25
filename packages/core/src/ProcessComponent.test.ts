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
  it("add() enrolls a process; _tick(dt) advances it", () => {
    const pc = makeComponent();
    const spy = vi.fn();
    const process = new Process({ update: spy });
    pc.add(process);
    pc._tick(16);
    expect(spy).toHaveBeenCalledWith(16, 16);
  });

  it("add() returns the process for chaining", () => {
    const pc = makeComponent();
    const process = new Process({ update: () => {} });
    expect(pc.add(process)).toBe(process);
  });

  it("completed processes are removed from the set after tick", () => {
    const pc = makeComponent();
    const process = new Process({ update: () => true }); // completes immediately
    pc.add(process);
    expect(pc.count).toBe(1);
    pc._tick(16);
    expect(pc.count).toBe(0);
  });

  it("cancel() cancels all processes", () => {
    const pc = makeComponent();
    const p1 = new Process({ update: () => {} });
    const p2 = new Process({ update: () => {} });
    pc.add(p1);
    pc.add(p2);
    pc.cancel();
    expect(p1.completed).toBe(true);
    expect(p2.completed).toBe(true);
    expect(pc.count).toBe(0);
  });

  it("cancel(tag) only cancels matching processes", () => {
    const pc = makeComponent();
    const p1 = new Process({ update: () => {}, tags: ["vfx"] });
    const p2 = new Process({ update: () => {}, tags: ["gameplay"] });
    pc.add(p1);
    pc.add(p2);
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
    pc.add(p1);
    pc.add(p2);
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
    pc.add(process);
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
    pc.add(p1);
    expect(pc.count).toBe(1);
    pc.add(p2);
    expect(pc.count).toBe(2);
    p1.cancel();
    expect(pc.count).toBe(1);
  });
});
