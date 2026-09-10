import { describe, expect, it, vi } from "vitest";
import { Component } from "./Component.js";
import { defineStates, StateMachine } from "./StateMachine.js";
import { createMockScene } from "./test-utils.js";
import { advanceFrames, createTestEngine } from "./test-utils.js";
import { ErrorBoundaryKey } from "./EngineContext.js";
import { Scene } from "./Scene.js";
import { SceneTimeKey } from "./SceneTime.js";

const trafficStates = defineStates({
  green: { to: ["yellow"] },
  yellow: { to: ["red"], for: 0.1, next: "red" },
  red: { to: ["green"] },
});

describe("StateMachine", () => {
  it("checks state names at compile time", () => {
    const machine = new StateMachine(trafficStates, "green");

    expect(() => {
      // @ts-expect-error state names come from the definition keys
      machine.go("gren");
    }).toThrow('transition "green" -> "gren" is not declared');
    expect(machine.state).toBe("green");
  });

  it("infers every key from inline definitions", () => {
    const machine = new StateMachine(
      { idle: { to: ["running"] }, running: {} },
      "idle",
    );
    machine.go("running");
    expect(machine.state).toBe("running");
  });

  it("runs initial enter only when start is called", () => {
    const enter = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"], enter }, active: {} }),
      "idle",
    );

    machine.tick(1);
    expect(enter).not.toHaveBeenCalled();
    expect(machine.elapsed).toBe(0);

    machine.start();
    machine.start();
    expect(enter).toHaveBeenCalledOnce();
    expect(enter).toHaveBeenCalledWith(null);
  });

  it("enters a target without exiting an initial state that was never started", () => {
    const exit = vi.fn();
    const enter = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"], exit }, active: { enter } }),
      "idle",
    );

    machine.go("active");

    expect(exit).not.toHaveBeenCalled();
    expect(enter).toHaveBeenCalledWith({ from: "idle", to: "active" });
  });

  it("runs exit before committing the target and then runs enter", () => {
    const calls: string[] = [];
    const states = defineStates<"idle" | "active">({
      idle: {
        to: ["active"],
        exit: () => calls.push(`exit:${machine.state}`),
      },
      active: {
        enter: () => calls.push(`enter:${machine.state}`),
      },
    });
    const machine = new StateMachine(states, "idle");
    machine.start();

    machine.go("active");

    expect(calls).toEqual(["exit:idle", "enter:active"]);
    expect(machine.lastTransition).toEqual({ from: "idle", to: "active" });
  });

  it("keeps the source state when exit throws", () => {
    const error = new Error("stop");
    const machine = new StateMachine(
      defineStates({
        idle: {
          to: ["active"],
          exit: () => {
            throw error;
          },
        },
        active: { enter: vi.fn() },
      }),
      "idle",
    );
    machine.start();

    expect(() => machine.go("active")).toThrow(error);
    expect(machine.state).toBe("idle");
    expect(machine.lastTransition).toBeNull();
  });

  it("rejects reentrant operations from hooks", () => {
    const states = defineStates<"idle" | "active">({
      idle: { to: ["active"] },
      active: { enter: () => machine.go("idle") },
    });
    const machine = new StateMachine(states, "idle");

    expect(() => machine.go("active")).toThrow(
      "StateMachine.go: cannot run during a state transition hook.",
    );
    expect(machine.state).toBe("active");
  });

  it("treats a transition to the current state as a no-op", () => {
    const exit = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"], exit }, active: {} }),
      "idle",
    );
    machine.start();

    machine.go("idle");

    expect(exit).not.toHaveBeenCalled();
    expect(machine.elapsed).toBe(0);
  });

  it("throws for an undeclared transition before changing state", () => {
    const machine = new StateMachine(trafficStates, "green");
    machine.start();

    expect(() => machine.go("red")).toThrow(
      'StateMachine.go: transition "green" -> "red" is not declared.',
    );
    expect(machine.state).toBe("green");
  });

  it("advances a timed state at the shared duration tolerance", () => {
    const machine = new StateMachine(trafficStates, "yellow");
    machine.start();

    for (let i = 0; i < 6; i++) machine.tick(1 / 60);

    expect(machine.state).toBe("red");
    expect(machine.elapsed).toBe(0);
  });

  it("discards time past a timed boundary and clamps exit elapsed", () => {
    let exitElapsed = -1;
    const states = defineStates<"brief" | "done">({
      brief: {
        to: ["done"],
        for: 0.1,
        next: "done",
        exit: () => {
          exitElapsed = machine.elapsed;
        },
      },
      done: {},
    });
    const machine = new StateMachine(states, "brief");
    machine.start();

    machine.tick(1);

    expect(machine.state).toBe("done");
    expect(exitElapsed).toBe(0.1);
    expect(machine.elapsed).toBe(0);
  });

  it("caps an overflowing untimed elapsed value and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const machine = new StateMachine(trafficStates, "green");
    machine.start();
    machine.tick(Number.MAX_VALUE);

    expect(machine.elapsed).toBe(Number.MAX_VALUE);
    machine.tick(Number.MAX_VALUE);
    machine.tick(Number.MAX_VALUE);
    expect(machine.elapsed).toBe(Number.MAX_VALUE);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[yage] StateMachine.tick: elapsed time exceeded Number.MAX_VALUE and was capped.",
    );
    warn.mockRestore();
  });

  it("hydrates without hooks and resumes from the restored elapsed time", () => {
    const exit = vi.fn();
    const enter = vi.fn();
    const machine = new StateMachine(
      defineStates({
        waiting: { to: ["ready"], for: 1, next: "ready", exit },
        ready: { enter },
      }),
      "waiting",
    );

    machine.hydrate({ state: "waiting", elapsed: 0.75 });
    expect(exit).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();

    machine.tick(0.25);
    expect(machine.state).toBe("ready");
    expect(exit).toHaveBeenCalledOnce();
    expect(enter).toHaveBeenCalledOnce();
  });

  it("does not advance a restored boundary while dt is zero", () => {
    const enter = vi.fn();
    const machine = new StateMachine(
      defineStates({
        waiting: { to: ["ready"], for: 1, next: "ready" },
        ready: { enter },
      }),
      "waiting",
    );
    machine.hydrate({ state: "waiting", elapsed: 1 });

    machine.tick(0);
    expect(machine.state).toBe("waiting");
    machine.tick(Number.EPSILON);
    expect(machine.state).toBe("ready");
    expect(enter).toHaveBeenCalledOnce();
  });

  it("validates hydration atomically", () => {
    const machine = new StateMachine(trafficStates, "green");
    machine.start();
    machine.tick(0.5);

    expect(() => machine.hydrate({ state: "yellow", elapsed: 2 })).toThrow(
      'exceeds state "yellow" duration',
    );
    expect(machine.serialize()).toEqual({ state: "green", elapsed: 0.5 });
  });

  it("copies definitions so later caller mutations cannot alter the graph", () => {
    const targets: Array<"active"> = ["active"];
    const states = defineStates<"idle" | "active">({
      idle: { to: targets },
      active: {},
    });
    const machine = new StateMachine(states, "idle");
    targets.length = 0;

    machine.go("active");
    expect(machine.state).toBe("active");
  });

  it("rejects inherited state names and malformed timed definitions", () => {
    expect(
      () =>
        new StateMachine(
          defineStates({ idle: { to: ["toString"] }, toString: {} }),
          "idle",
        ),
    ).not.toThrow();

    const inherited = Object.create({ inherited: {} }) as Record<
      "idle" | "inherited",
      { to?: readonly ("idle" | "inherited")[] }
    >;
    inherited.idle = { to: ["inherited"] };
    expect(() => new StateMachine(inherited, "idle")).toThrow(
      'targets unknown state "inherited"',
    );

    expect(
      () =>
        new StateMachine(
          defineStates({ idle: { to: ["idle"], for: Infinity, next: "idle" } }),
          "idle",
        ),
    ).toThrow("duration must be a finite number > 0");
  });
});

describe("Component.stateMachine", () => {
  it("attributes hook failures to the owning component", () => {
    class Brain extends Component {
      readonly machine = this.stateMachine(
        defineStates({
          idle: { to: ["active"] },
          active: {
            enter: () => {
              throw new Error("broken hook");
            },
          },
        }),
        "idle",
      );
    }

    const { scene } = createMockScene();
    const entity = scene.spawn("guard");
    const brain = entity.add(new Brain());

    expect(() => brain.machine.go("active")).toThrow("broken hook");
    expect(scene.context.resolve(ErrorBoundaryKey).getCallbackErrors()).toEqual(
      [
        expect.objectContaining({
          kind: "StateMachine enter hook (Brain)",
          entity: "guard",
          event: "idle -> active",
          error: "broken hook",
        }),
      ],
    );
  });

  it("uses the fixed update dt after scene and entity time scaling", async () => {
    class GameScene extends Scene {
      readonly name = "game";
    }
    class TimedBrain extends Component {
      readonly machine = this.stateMachine(
        defineStates({
          waiting: { to: ["ready"], for: 0.1, next: "ready" },
          ready: {},
        }),
        "waiting",
      );

      onAdd(): void {
        this.machine.start();
      }

      fixedUpdate(dt: number): void {
        this.machine.tick(dt);
      }
    }

    const engine = await createTestEngine({ fixedTimestep: 0.1 });
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const entity = scene.spawn("guard");
    entity.timeScale = 0.5;
    const brain = entity.add(new TimedBrain());
    const time = scene.tryResolveScoped(SceneTimeKey);
    if (!time) throw new Error("SceneTime was not registered.");
    const freeze = time.freezeEntityFor(entity, 1);

    advanceFrames(engine, 1, 100);
    expect(brain.machine.serialize()).toEqual({
      state: "waiting",
      elapsed: 0,
    });

    freeze.release();
    advanceFrames(engine, 1, 100);
    expect(brain.machine.elapsed).toBeCloseTo(0.05);
    advanceFrames(engine, 1, 100);
    expect(brain.machine.state).toBe("ready");
    engine.destroy();
  });

  it("appears as plain state in the Inspector's normal field reflection", async () => {
    class GameScene extends Scene {
      readonly name = "game";
    }
    class Brain extends Component {
      readonly machine = this.stateMachine(trafficStates, "green");
    }

    const engine = await createTestEngine();
    const scene = new GameScene();
    await engine.scenes.push(scene);
    const brain = scene.spawn("guard").add(new Brain());
    brain.machine.start();
    brain.machine.tick(0.25);

    const state = engine.inspector.getComponentData("guard", "Brain") as Record<
      string,
      unknown
    >;
    expect(state["machine"]).toEqual({
      state: "green",
      elapsed: 0.25,
      lastTransition: null,
    });
    engine.destroy();
  });
});
