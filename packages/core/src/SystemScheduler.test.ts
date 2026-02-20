import { describe, it, expect, vi } from "vitest";
import { SystemScheduler } from "./SystemScheduler.js";
import { System } from "./System.js";
import { Phase } from "./types.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";

class UpdateSystemA extends System {
  readonly phase = Phase.Update;
  override readonly priority = 10;
  calls: number[] = [];
  update(dt: number): void {
    this.calls.push(dt);
  }
}

class UpdateSystemB extends System {
  readonly phase = Phase.Update;
  override readonly priority = 5;
  calls: number[] = [];
  update(dt: number): void {
    this.calls.push(dt);
  }
}

class FixedSystem extends System {
  readonly phase = Phase.FixedUpdate;
  calls: number[] = [];
  update(dt: number): void {
    this.calls.push(dt);
  }
}

describe("SystemScheduler", () => {
  it("runs systems in priority order within a phase", () => {
    const scheduler = new SystemScheduler();
    const a = new UpdateSystemA(); // priority 10
    const b = new UpdateSystemB(); // priority 5
    scheduler.add(a);
    scheduler.add(b);
    const order: string[] = [];
    vi.spyOn(b, "update").mockImplementation(() => order.push("b"));
    vi.spyOn(a, "update").mockImplementation(() => order.push("a"));
    scheduler.run(Phase.Update, 16);
    expect(order).toEqual(["b", "a"]); // b (5) before a (10)
  });

  it("only runs systems for the specified phase", () => {
    const scheduler = new SystemScheduler();
    const update = new UpdateSystemA();
    const fixed = new FixedSystem();
    scheduler.add(update);
    scheduler.add(fixed);
    scheduler.run(Phase.Update, 16);
    expect(update.calls).toEqual([16]);
    expect(fixed.calls).toEqual([]);
  });

  it("skips disabled systems", () => {
    const scheduler = new SystemScheduler();
    const sys = new UpdateSystemA();
    sys.enabled = false;
    scheduler.add(sys);
    scheduler.run(Phase.Update, 16);
    expect(sys.calls).toEqual([]);
  });

  it("removes a system", () => {
    const scheduler = new SystemScheduler();
    const sys = new UpdateSystemA();
    scheduler.add(sys);
    scheduler.remove(sys);
    scheduler.run(Phase.Update, 16);
    expect(sys.calls).toEqual([]);
  });

  it("remove is a no-op for unregistered system (no phase list)", () => {
    const scheduler = new SystemScheduler();
    const sys = new UpdateSystemA();
    expect(() => scheduler.remove(sys)).not.toThrow();
  });

  it("remove is a no-op when system not in existing phase list", () => {
    const scheduler = new SystemScheduler();
    const a = new UpdateSystemA();
    const b = new UpdateSystemB();
    scheduler.add(a);
    // b is in the same phase (Update) but was never added
    scheduler.remove(b);
    // a should still be there
    expect(scheduler.getSystems(Phase.Update)).toEqual([a]);
  });

  it("getSystems returns systems for a phase", () => {
    const scheduler = new SystemScheduler();
    const sys = new UpdateSystemA();
    scheduler.add(sys);
    expect(scheduler.getSystems(Phase.Update)).toEqual([sys]);
    expect(scheduler.getSystems(Phase.FixedUpdate)).toEqual([]);
  });

  it("getAllSystems returns all systems", () => {
    const scheduler = new SystemScheduler();
    const a = new UpdateSystemA();
    const b = new FixedSystem();
    scheduler.add(a);
    scheduler.add(b);
    const all = scheduler.getAllSystems();
    expect(all).toContain(a);
    expect(all).toContain(b);
  });

  it("uses ErrorBoundary when set", () => {
    const scheduler = new SystemScheduler();
    const wrapSystem = vi.fn(
      (_system: System, fn: () => void) => fn(),
    );
    scheduler.setErrorBoundary({ wrapSystem } as unknown as ErrorBoundary);
    const sys = new UpdateSystemA();
    scheduler.add(sys);
    scheduler.run(Phase.Update, 16);
    expect(wrapSystem).toHaveBeenCalledTimes(1);
    expect(sys.calls).toEqual([16]);
  });

  it("does nothing when running a phase with no systems", () => {
    const scheduler = new SystemScheduler();
    expect(() => scheduler.run(Phase.Update, 16)).not.toThrow();
  });
});
