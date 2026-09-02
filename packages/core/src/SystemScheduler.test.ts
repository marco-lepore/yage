import { describe, it, expect, vi } from "vitest";
import { SystemScheduler } from "./SystemScheduler.js";
import { System } from "./System.js";
import { Phase } from "./types.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { EngineContext } from "./EngineContext.js";

class LifecycleSystem extends System {
  readonly phase = Phase.Update;
  received: EngineContext | null = null;

  constructor(
    private readonly log: string[],
    private readonly name: string,
  ) {
    super();
  }

  override onRegister(context: EngineContext): void {
    this.received = context;
    this.log.push(`+${this.name}`);
  }

  override onUnregister(): void {
    this.log.push(`-${this.name}`);
  }

  update(): void {}
}

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

  describe("execution context", () => {
    class PhaseProbe extends System {
      readonly phase: Phase;
      seenPhases: Array<Phase | null> = [];
      seenSteps: number[] = [];
      constructor(
        phase: Phase,
        private readonly scheduler: SystemScheduler,
      ) {
        super();
        this.phase = phase;
      }
      update(): void {
        this.seenPhases.push(this.scheduler.currentPhase);
        this.seenSteps.push(this.scheduler.fixedStepIndex);
      }
    }

    it("currentPhase reports the running phase inside a system and null outside", () => {
      const scheduler = new SystemScheduler();
      const probe = new PhaseProbe(Phase.Update, scheduler);
      scheduler.add(probe);
      expect(scheduler.currentPhase).toBeNull();
      scheduler.run(Phase.Update, 16);
      expect(probe.seenPhases).toEqual([Phase.Update]);
      expect(scheduler.currentPhase).toBeNull();
    });

    it("currentPhase is restored when a system throws", () => {
      const scheduler = new SystemScheduler();
      class ThrowingSystem extends System {
        readonly phase = Phase.Update;
        update(): void {
          throw new Error("boom");
        }
      }
      scheduler.add(new ThrowingSystem());
      expect(() => scheduler.run(Phase.Update, 16)).toThrow("boom");
      expect(scheduler.currentPhase).toBeNull();
    });

    it("fixedStepIndex counts every fixed-phase run, even with no fixed systems", () => {
      const scheduler = new SystemScheduler();
      expect(scheduler.fixedStepIndex).toBe(0);
      scheduler.run(Phase.FixedUpdate, 16);
      expect(scheduler.fixedStepIndex).toBe(1);
      scheduler.run(Phase.Update, 16);
      scheduler.run(Phase.EndOfFrame, 16);
      expect(scheduler.fixedStepIndex).toBe(1);
      scheduler.run(Phase.FixedUpdate, 16);
      scheduler.run(Phase.FixedUpdate, 16);
      expect(scheduler.fixedStepIndex).toBe(3);
    });

    it("a fixed system sees the index of the step it runs in", () => {
      const scheduler = new SystemScheduler();
      const probe = new PhaseProbe(Phase.FixedUpdate, scheduler);
      scheduler.add(probe);
      scheduler.run(Phase.FixedUpdate, 16);
      scheduler.run(Phase.FixedUpdate, 16);
      expect(probe.seenPhases).toEqual([Phase.FixedUpdate, Phase.FixedUpdate]);
      expect(probe.seenSteps).toEqual([1, 2]);
    });
  });

  describe("registration lifecycle", () => {
    const ctx = {} as EngineContext;

    it("_start registers every system added before it", () => {
      const scheduler = new SystemScheduler();
      const log: string[] = [];
      const a = new LifecycleSystem(log, "a");
      const b = new LifecycleSystem(log, "b");
      scheduler.add(a);
      scheduler.add(b);
      expect(log).toEqual([]);
      scheduler._start(ctx);
      expect(log).toEqual(["+a", "+b"]);
      expect(a.received).toBe(ctx);
    });

    it("add after _start registers the system immediately", () => {
      const scheduler = new SystemScheduler();
      scheduler._start(ctx);
      const log: string[] = [];
      const sys = new LifecycleSystem(log, "late");
      scheduler.add(sys);
      expect(log).toEqual(["+late"]);
      expect(sys.received).toBe(ctx);
    });

    it("registration hooks go through the error boundary when set", () => {
      const scheduler = new SystemScheduler();
      const wrapSystem = vi.fn((_system: System, fn: () => void) => fn());
      scheduler.setErrorBoundary({ wrapSystem } as unknown as ErrorBoundary);
      scheduler._start(ctx);
      const log: string[] = [];
      const sys = new LifecycleSystem(log, "a");
      scheduler.add(sys);
      scheduler.remove(sys);
      expect(log).toEqual(["+a", "-a"]);
      expect(wrapSystem).toHaveBeenCalledTimes(2);
    });

    it("remove calls onUnregister only for a registered system", () => {
      const scheduler = new SystemScheduler();
      const log: string[] = [];
      const sys = new LifecycleSystem(log, "a");
      scheduler.add(sys);
      scheduler.remove(sys);
      expect(log).toEqual([]);

      scheduler.add(sys);
      scheduler._start(ctx);
      scheduler.remove(sys);
      expect(log).toEqual(["+a", "-a"]);
    });

    it("_destroy unregisters in reverse; a later remove does not repeat it", () => {
      const scheduler = new SystemScheduler();
      const log: string[] = [];
      const a = new LifecycleSystem(log, "a");
      const b = new LifecycleSystem(log, "b");
      scheduler.add(a);
      scheduler.add(b);
      scheduler._start(ctx);
      scheduler._destroy();
      expect(log).toEqual(["+a", "+b", "-b", "-a"]);
      // Plugin teardown may still remove its own systems after the engine
      // unregistered everything (e.g. DebugPlugin.tearDownDebugInfra).
      scheduler.remove(a);
      expect(log).toEqual(["+a", "+b", "-b", "-a"]);
      expect(scheduler.getSystems(Phase.Update)).toEqual([b]);
    });

    it("_start after _destroy registers the remaining systems again", () => {
      const scheduler = new SystemScheduler();
      const log: string[] = [];
      const sys = new LifecycleSystem(log, "a");
      scheduler.add(sys);
      scheduler._start(ctx);
      scheduler._destroy();
      scheduler._start(ctx);
      expect(log).toEqual(["+a", "-a", "+a"]);
    });

    class ThrowingRegister extends LifecycleSystem {
      override onRegister(): void {
        throw new Error("register boom");
      }
    }

    it("a runtime add whose onRegister throws leaves the system unscheduled", () => {
      const scheduler = new SystemScheduler();
      scheduler._start(ctx);
      const log: string[] = [];
      const sys = new ThrowingRegister(log, "bad");
      const update = vi.spyOn(sys, "update");

      expect(() => scheduler.add(sys)).toThrow("register boom");
      expect(scheduler.getSystems(Phase.Update)).not.toContain(sys);
      scheduler.run(Phase.Update, 16);
      expect(update).not.toHaveBeenCalled();
      scheduler._destroy();
      expect(log).toEqual([]);
    });

    it("_start stops at a throwing onRegister; _destroy unregisters only what registered", () => {
      const scheduler = new SystemScheduler();
      const log: string[] = [];
      const a = new LifecycleSystem(log, "a");
      const b = new ThrowingRegister(log, "b");
      const c = new LifecycleSystem(log, "c");
      scheduler.add(a);
      scheduler.add(b);
      scheduler.add(c);

      expect(() => scheduler._start(ctx)).toThrow("register boom");
      expect(log).toEqual(["+a"]);
      scheduler._destroy();
      expect(log).toEqual(["+a", "-a"]);
    });
  });

  describe("changes during a run", () => {
    class OrderProbe extends System {
      readonly phase: Phase;
      override readonly priority: number;
      constructor(
        private readonly order: string[],
        private readonly name: string,
        phase: Phase,
        priority: number,
        private readonly onUpdate?: () => void,
      ) {
        super();
        this.phase = phase;
        this.priority = priority;
      }
      update(): void {
        this.order.push(this.name);
        this.onUpdate?.();
      }
    }

    function runFrame(scheduler: SystemScheduler): void {
      scheduler.run(Phase.Update, 16);
      scheduler.run(Phase.LateUpdate, 16);
    }

    it("a system added during its own phase first runs at that phase's next run", () => {
      const scheduler = new SystemScheduler();
      const order: string[] = [];
      const adder = new OrderProbe(order, "adder", Phase.Update, 0, () => {
        scheduler.add(
          new OrderProbe(order, "added-before", Phase.Update, -100),
        );
        scheduler.add(new OrderProbe(order, "added-tie", Phase.Update, 0));
        scheduler.add(new OrderProbe(order, "added-after", Phase.Update, 100));
        scheduler.add(new OrderProbe(order, "added-late", Phase.LateUpdate, 0));
      });
      scheduler.add(adder);
      scheduler.add(new OrderProbe(order, "later-phase", Phase.LateUpdate, 0));

      runFrame(scheduler);
      expect(order).toEqual(["adder", "later-phase", "added-late"]);

      order.length = 0;
      adder.enabled = false; // stop re-adding
      runFrame(scheduler);
      expect(order).toEqual([
        "added-before",
        "added-tie",
        "added-after",
        "later-phase",
        "added-late",
      ]);
    });

    it("a system removed during its phase by an earlier system does not run that frame", () => {
      const scheduler = new SystemScheduler();
      const order: string[] = [];
      const victim = new OrderProbe(order, "victim", Phase.Update, 10);
      const remover = new OrderProbe(order, "remover", Phase.Update, 0, () => {
        scheduler.remove(victim);
      });
      scheduler.add(remover);
      scheduler.add(victim);
      scheduler.add(new OrderProbe(order, "after", Phase.Update, 20));

      scheduler.run(Phase.Update, 16);
      expect(order).toEqual(["remover", "after"]);
    });

    it("a system removed during its phase after it already ran does not shift the rest of the run", () => {
      const scheduler = new SystemScheduler();
      const order: string[] = [];
      const early = new OrderProbe(order, "early", Phase.Update, 0);
      const remover = new OrderProbe(order, "remover", Phase.Update, 10, () => {
        scheduler.remove(early);
      });
      scheduler.add(early);
      scheduler.add(remover);
      scheduler.add(new OrderProbe(order, "after", Phase.Update, 20));

      scheduler.run(Phase.Update, 16);
      expect(order).toEqual(["early", "remover", "after"]);
    });

    it("ties keep add order", () => {
      const scheduler = new SystemScheduler();
      const order: string[] = [];
      scheduler.add(new OrderProbe(order, "first-200", Phase.LateUpdate, 200));
      scheduler.add(new OrderProbe(order, "the-201", Phase.LateUpdate, 201));
      scheduler.add(new OrderProbe(order, "second-200", Phase.LateUpdate, 200));

      scheduler.run(Phase.LateUpdate, 16);
      expect(order).toEqual(["first-200", "second-200", "the-201"]);
    });
  });
});
