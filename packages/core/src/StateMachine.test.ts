import { describe, expect, it, vi } from "vitest";
import { Component } from "./Component.js";
import { defineStates, StateMachine } from "./StateMachine.js";
import {
  advanceFrames,
  createMockScene,
  createTestEngine,
} from "./test-utils.js";
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

  it("runs the initial enter once when start comes first", () => {
    const enter = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"], enter }, active: {} }),
      "idle",
    );

    machine.start();
    machine.start();

    expect(enter).toHaveBeenCalledOnce();
    expect(enter).toHaveBeenCalledWith(null);
  });

  it("runs the initial enter on the first tick when start is never called", () => {
    const enter = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"], enter }, active: {} }),
      "idle",
    );

    machine.tick(0.5);

    expect(enter).toHaveBeenCalledOnce();
    expect(machine.elapsed).toBe(0.5);

    machine.start();
    machine.tick(0.5);
    expect(enter).toHaveBeenCalledOnce();
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

  it("keeps the target state when enter throws", () => {
    const error = new Error("broken");
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["active"] },
        active: {
          to: ["idle"],
          enter: () => {
            throw error;
          },
        },
      }),
      "idle",
    );
    machine.start();

    expect(() => machine.go("active")).toThrow(error);
    expect(machine.state).toBe("active");
    expect(machine.lastTransition).toEqual({ from: "idle", to: "active" });
    machine.go("idle");
    expect(machine.state).toBe("idle");
  });

  it("rejects reentrant operations from hooks", () => {
    const states = defineStates<"idle" | "active">({
      idle: { to: ["active"] },
      active: { enter: () => machine.go("idle") },
    });
    const machine = new StateMachine(states, "idle");

    expect(() => machine.go("active")).toThrow(
      "StateMachine.go: cannot run while the machine is changing state.",
    );
    expect(machine.state).toBe("active");
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

  it("drops a pending advance when go leaves a timed state", () => {
    const machine = new StateMachine(
      defineStates({
        windup: { to: ["strike", "stunned"], for: 0.2, next: "strike" },
        strike: { to: ["windup"] },
        stunned: { to: ["windup"] },
      }),
      "windup",
    );
    machine.start();
    machine.tick(0.19);

    machine.go("stunned");
    machine.tick(1);

    expect(machine.state).toBe("stunned");
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

  it("rejects inherited state names", () => {
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
  });

  it("rejects malformed timed definitions", () => {
    const build =
      (states: Record<string, unknown>): (() => StateMachine<never>) =>
      () =>
        new StateMachine(states as never, "idle" as never);

    expect(
      build({ idle: { to: ["idle"], for: Infinity, next: "idle" } }),
    ).toThrow("duration must be a finite number > 0");
    expect(
      build({ idle: { to: ["other"], next: "other" }, other: {} }),
    ).toThrow('state "idle" has next without a duration');
    expect(build({ idle: { to: ["other"], for: 1 }, other: {} })).toThrow(
      'state "idle" has a duration without next',
    );
    expect(build({ idle: { for: 1, next: "other" }, other: {} })).toThrow(
      'state "idle" cannot advance to "other", which it cannot reach',
    );
    expect(build({ idle: { to: ["idle"], for: 1, next: "idle" } })).toThrow(
      'timed state "idle" cannot advance to itself',
    );
    expect(build({})).toThrow("must declare at least one state");
    expect(build({ other: {} })).toThrow('unknown initial state "idle"');
  });
});

describe("StateMachine restart", () => {
  const states = defineStates({
    idle: { to: ["charge"] },
    charge: { to: ["charge", "idle"], for: 1, next: "idle" },
  });

  it("re-enters a state that lists itself in to", () => {
    const calls: string[] = [];
    const machine = new StateMachine(
      defineStates({
        idle: {
          to: ["idle"],
          enter: () => calls.push("enter"),
          exit: () => calls.push("exit"),
        },
      }),
      "idle",
    );
    machine.start();
    calls.length = 0;

    machine.go("idle");

    expect(calls).toEqual(["exit", "enter"]);
    expect(machine.lastTransition).toEqual({ from: "idle", to: "idle" });
  });

  it("resets the timer of a restarted timed state", () => {
    const machine = new StateMachine(states, "charge");
    machine.start();
    machine.tick(0.9);

    machine.go("charge");

    expect(machine.elapsed).toBe(0);
    machine.tick(0.9);
    expect(machine.state).toBe("charge");
    machine.tick(0.1);
    expect(machine.state).toBe("idle");
  });

  it("ignores a move to the current state that is not declared", () => {
    const exit = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"], exit }, active: {} }),
      "idle",
    );
    machine.start();
    machine.tick(0.5);

    machine.go("idle");

    expect(exit).not.toHaveBeenCalled();
    expect(machine.elapsed).toBe(0.5);
    expect(machine.lastTransition).toBeNull();
  });
});

describe("StateMachine events", () => {
  const buildLogged = (): {
    machine: StateMachine<"idle" | "active">;
    log: string[];
  } => {
    const log: string[] = [];
    const states = defineStates<"idle" | "active">({
      idle: { to: ["active"], exit: () => log.push("hook:exit idle") },
      active: { to: ["idle"], enter: () => log.push("hook:enter active") },
    });
    const machine = new StateMachine(states, "idle");
    machine.on(machine.events.exited, ({ state, to }) =>
      log.push(`exited ${state} -> ${to}`),
    );
    machine.on(machine.events.entered, ({ state, from }) =>
      log.push(`entered ${from} -> ${state}`),
    );
    machine.on(machine.events.changed, ({ from, to }) =>
      log.push(`changed ${from} -> ${to}`),
    );
    return { machine, log };
  };

  it("interleaves hooks and events in one order", () => {
    const { machine, log } = buildLogged();
    machine.start();

    expect(log).toEqual(["entered null -> idle"]);

    log.length = 0;
    machine.go("active");

    expect(log).toEqual([
      "hook:exit idle",
      "exited idle -> active",
      "hook:enter active",
      "entered idle -> active",
      "changed idle -> active",
    ]);
  });

  it("keeps events off the entity unless it was given a name", () => {
    const seen = vi.fn();
    class Brain extends Component {
      readonly mode = this.stateMachine(
        defineStates({ idle: { to: ["active"] }, active: {} }),
        "idle",
      );
    }

    const { scene } = createMockScene();
    const entity = scene.spawn("guard");
    const brain = entity.add(new Brain());
    entity.on(brain.mode.events.changed, seen);

    brain.mode.go("active");

    expect(seen).not.toHaveBeenCalled();
  });

  it("publishes on the entity and the scene under its own name", () => {
    const onEntity: string[] = [];
    const onScene: string[] = [];
    class Brain extends Component {
      readonly mode = this.stateMachine(
        defineStates({ idle: { to: ["active"] }, active: {} }),
        "idle",
        { events: "mode" },
      );
      readonly stance = this.stateMachine(
        defineStates({ loose: { to: ["ready"] }, ready: {} }),
        "loose",
        { events: "stance" },
      );
    }

    const { scene } = createMockScene();
    const entity = scene.spawn("guard");
    const brain = entity.add(new Brain());

    expect(brain.mode.events.changed.name).toBe("mode:changed");
    entity.on(brain.mode.events.entered, ({ state }) => onEntity.push(state));
    scene.on(brain.mode.events.changed, ({ to }) => onScene.push(to));
    entity.on(brain.stance.events.entered, ({ state }) =>
      onEntity.push(`stance:${state}`),
    );

    brain.mode.go("active");
    brain.stance.go("ready");

    expect(onEntity).toEqual(["active", "stance:ready"]);
    expect(onScene).toEqual(["active"]);
  });

  it("reaches machine subscribers and the entity from one transition", () => {
    const seen: string[] = [];
    class Brain extends Component {
      readonly mode = this.stateMachine(
        defineStates({ idle: { to: ["active"] }, active: {} }),
        "idle",
        { events: "mode" },
      );
    }

    const { scene } = createMockScene();
    const entity = scene.spawn("guard");
    const brain = entity.add(new Brain());
    brain.mode.on(brain.mode.events.changed, () => seen.push("machine"));
    entity.on(brain.mode.events.changed, () => seen.push("entity"));

    brain.mode.go("active");

    expect(seen).toEqual(["machine", "entity"]);
  });

  it("rejects an empty events name", () => {
    expect(
      () =>
        new StateMachine(defineStates({ idle: {} }), "idle", { events: "" }),
    ).toThrow("events must be a non-empty name");
  });

  it("emits nothing on hydrate", () => {
    const { machine, log } = buildLogged();

    machine.hydrate({ state: "active", elapsed: 0 });

    expect(log).toEqual([]);
    expect(machine.state).toBe("active");
  });

  it("stops calling a handler after its unsubscribe", () => {
    const handler = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"] }, active: { to: ["idle"] } }),
      "idle",
    );
    const unsubscribe = machine.on(machine.events.changed, handler);
    machine.start();

    machine.go("active");
    expect(handler).toHaveBeenCalledWith({ from: "idle", to: "active" });

    unsubscribe();
    machine.go("idle");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects a transition started from a handler", () => {
    const machine = new StateMachine(
      defineStates({ idle: { to: ["active"] }, active: { to: ["idle"] } }),
      "idle",
    );
    machine.on(machine.events.changed, () => machine.go("idle"));
    machine.start();

    expect(() => machine.go("active")).toThrow(
      "StateMachine.go: cannot run while the machine is changing state.",
    );
  });
});

describe("StateMachine nesting", () => {
  const gunner = defineStates({
    idle: { to: ["shoot", "hit"] },
    shoot: {
      to: ["idle", "hit"],
      start: "aim",
      states: {
        aim: { to: ["fire"], for: 0.2, next: "fire" },
        fire: { to: ["recoil"], for: 0.1, next: "recoil" },
        recoil: { to: ["idle"], for: 0.3, next: "idle" },
      },
    },
    hit: { to: ["idle"] },
  });

  it("enters the start child with its parent", () => {
    const machine = new StateMachine(gunner, "idle");
    machine.start();

    machine.go("shoot");

    expect(machine.state).toBe("aim");
    expect(machine.is("aim")).toBe(true);
    expect(machine.is("shoot")).toBe(true);
    expect(machine.is("idle")).toBe(false);
  });

  it("runs the sequence on one clock and leaves through the last child", () => {
    const machine = new StateMachine(gunner, "idle");
    machine.start();
    machine.go("shoot");

    machine.tick(0.2);
    expect(machine.state).toBe("fire");
    machine.tick(0.1);
    expect(machine.state).toBe("recoil");
    expect(machine.is("shoot")).toBe(true);
    machine.tick(0.3);
    expect(machine.state).toBe("idle");
    expect(machine.is("shoot")).toBe(false);
  });

  it("reaches the parent's targets from any child", () => {
    const log: string[] = [];
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["shoot", "hit"] },
        shoot: {
          to: ["hit"],
          start: "aim",
          exit: () => log.push("exit shoot"),
          states: {
            aim: { to: ["fire"], exit: () => log.push("exit aim") },
            fire: { to: ["aim"] },
          },
        },
        hit: { to: ["idle"], enter: () => log.push("enter hit") },
      }),
      "idle",
    );
    machine.start();
    machine.go("shoot");

    machine.go("hit");

    expect(log).toEqual(["exit aim", "exit shoot", "enter hit"]);
    expect(machine.state).toBe("hit");
  });

  const combo = defineStates({
    idle: { to: ["combo"] },
    combo: {
      to: ["idle"],
      for: 0.5,
      next: "idle",
      start: "jab",
      states: {
        jab: { to: ["hook"], for: 0.1, next: "hook" },
        hook: { to: ["jab"], for: 0.1, next: "jab" },
      },
    },
  });

  it("enters the parent when the first move happens before start", () => {
    const log: string[] = [];
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["shoot"] },
        shoot: {
          to: ["idle"],
          start: "aim",
          enter: () => log.push("enter shoot"),
          exit: () => log.push("exit shoot"),
          states: { aim: { to: ["fire"] }, fire: { to: ["idle"] } },
        },
      }),
      "shoot",
    );

    machine.go("fire");
    machine.go("idle");

    expect(log).toEqual(["enter shoot", "exit shoot"]);
  });

  it("ends the sequence on the parent's deadline even when every tick ends a phase", () => {
    const machine = new StateMachine(combo, "idle");
    machine.start();
    machine.go("combo");

    for (let i = 0; i < 5; i++) machine.tick(0.1);
    expect(machine.state).toBe("idle");

    machine.go("combo");
    for (let i = 0; i < 4; i++) machine.tick(0.1);
    expect(machine.is("combo")).toBe(true);
    machine.tick(0.1);
    expect(machine.state).toBe("idle");
  });

  it("restarts a phase its parent declares as reachable", () => {
    const log: string[] = [];
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["shoot"] },
        shoot: {
          to: ["idle", "aim"], // any phase may drop back to aim
          start: "aim",
          states: {
            aim: { to: ["fire"], enter: () => log.push("enter aim") },
            fire: {},
          },
        },
      }),
      "idle",
    );
    machine.start();
    machine.go("shoot");
    log.length = 0;

    machine.go("aim");

    expect(log).toEqual(["enter aim"]);
    expect(machine.state).toBe("aim");
  });

  it("restores the parent's elapsed time from a snapshot", () => {
    const restored = new StateMachine(combo, "idle");
    restored.hydrate({ state: "hook", elapsed: 0, parentElapsed: 0.45 });
    restored.tick(0.05);
    expect(restored.state).toBe("idle");

    const fresh = new StateMachine(combo, "idle");
    fresh.hydrate({ state: "hook", elapsed: 0 });
    fresh.tick(0.05);
    expect(fresh.state).toBe("hook");
  });

  it("keeps the parent's elapsed time across sibling moves", () => {
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["combo"] },
        combo: {
          to: ["idle"],
          for: 1,
          next: "idle",
          start: "jab",
          states: {
            jab: { to: ["hook"], for: 0.2, next: "hook" },
            hook: { to: ["jab"] },
          },
        },
      }),
      "idle",
    );
    machine.start();
    machine.go("combo");

    machine.tick(0.2);
    expect(machine.state).toBe("hook");
    expect(machine.elapsed).toBe(0);
    expect(machine.serialize()).toEqual({
      state: "hook",
      elapsed: 0,
      parentElapsed: 0.2,
    });

    machine.tick(0.8);
    expect(machine.state).toBe("idle");
  });

  it("restarts the sequence when a child names its parent", () => {
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["shoot"] },
        shoot: {
          to: ["idle"],
          start: "aim",
          states: {
            aim: { to: ["fire"], for: 0.2, next: "fire" },
            fire: { to: ["shoot", "idle"] },
          },
        },
      }),
      "idle",
    );
    machine.start();
    machine.go("shoot");
    machine.tick(0.2);
    expect(machine.state).toBe("fire");

    machine.go("shoot");

    expect(machine.state).toBe("aim");
  });

  it("reports both levels to events and the Inspector", () => {
    const log: string[] = [];
    const machine = new StateMachine(gunner, "idle");
    machine.on(machine.events.exited, ({ state, to }) =>
      log.push(`exited ${state} -> ${to}`),
    );
    machine.on(machine.events.entered, ({ state, from }) =>
      log.push(`entered ${from} -> ${state}`),
    );
    machine.on(machine.events.changed, ({ from, to }) =>
      log.push(`changed ${from} -> ${to}`),
    );
    machine.start();
    log.length = 0;

    machine.go("shoot");

    expect(log).toEqual([
      "exited idle -> aim",
      "entered idle -> shoot",
      "entered idle -> aim",
      "changed idle -> aim",
    ]);
    expect(machine.toJSON()).toEqual({
      state: "aim",
      elapsed: 0,
      parentElapsed: 0,
      parent: "shoot",
      lastTransition: { from: "idle", to: "aim" },
    });
  });

  it("restores a child and its parent from a snapshot", () => {
    const machine = new StateMachine(gunner, "idle");

    machine.hydrate({ state: "fire", elapsed: 0.05, parentElapsed: 0.25 });

    expect(machine.is("shoot")).toBe(true);
    machine.tick(0.05);
    expect(machine.state).toBe("recoil");
  });

  it("rejects a snapshot that names a parent", () => {
    const machine = new StateMachine(gunner, "idle");

    expect(() => machine.hydrate({ state: "shoot", elapsed: 0 })).toThrow(
      '"shoot" holds child states',
    );
  });

  it("rejects a table whose names or edges cross sequences", () => {
    expect(
      () =>
        new StateMachine(
          defineStates({
            idle: { to: ["shoot"] },
            shoot: { to: ["idle"], start: "idle", states: { idle: {} } },
          }),
          "idle",
        ),
    ).toThrow('state "idle" is declared twice');

    expect(
      () =>
        new StateMachine(
          defineStates({
            left: { to: ["right"], start: "a", states: { a: { to: ["b"] } } },
            right: { to: ["left"], start: "b", states: { b: {} } },
          }),
          "left",
        ),
    ).toThrow('state "a" cannot target "b", a child of "right"');

    expect(
      () =>
        new StateMachine(
          defineStates({
            idle: { to: ["shoot"] },
            shoot: { to: ["idle"], start: "idle", states: { aim: {} } },
          }),
          "idle",
        ),
    ).toThrow('start "idle" is not one of its child states');

    expect(
      () =>
        new StateMachine(
          defineStates({
            idle: { to: ["combo"] },
            combo: {
              to: ["idle", "jab"],
              for: 1,
              next: "jab",
              start: "jab",
              states: { jab: { to: ["hook"] }, hook: { to: ["idle"] } },
            },
          }),
          "idle",
        ),
    ).toThrow(
      'timed state "combo" cannot advance to "jab", one of its own child states',
    );

    expect(
      () =>
        new StateMachine(
          defineStates({ shoot: { start: "aim" }, aim: {} }),
          "shoot",
        ),
    ).toThrow('state "shoot" declares a start without child states');

    defineStates({
      idle: { to: ["shoot"] },
      shoot: {
        to: ["idle"],
        start: "aim",
        // @ts-expect-error only a top-level state is reachable from anywhere
        states: { aim: { to: ["idle"], fromAny: true } },
      },
    });
  });
});

describe("StateMachine states reachable from anywhere", () => {
  const brawler = defineStates({
    patrol: { to: ["windup"] },
    windup: { to: ["strike"], for: 0.2, next: "strike" },
    strike: { to: ["patrol"] },
    hit: { fromAny: true, to: ["patrol"] },
    die: { fromAny: true },
  });

  it("is reachable without every state declaring it", () => {
    const machine = new StateMachine(brawler, "patrol");
    machine.start();
    machine.go("windup");

    machine.go("hit");
    expect(machine.state).toBe("hit");

    machine.go("die");
    expect(machine.state).toBe("die");
  });

  it("adds no edge from the state to itself", () => {
    const exit = vi.fn();
    const machine = new StateMachine(
      defineStates({ idle: { to: ["hit"] }, hit: { fromAny: true, exit } }),
      "idle",
    );
    machine.start();
    machine.go("hit");

    machine.go("hit");

    expect(exit).not.toHaveBeenCalled();
  });

  it("can be named by next without appearing in to", () => {
    const machine = new StateMachine(
      defineStates({
        bleeding: { for: 0.5, next: "die" },
        die: { fromAny: true },
      }),
      "bleeding",
    );
    machine.start();

    machine.tick(0.5);

    expect(machine.state).toBe("die");
  });

  it("is reachable from inside a sequence and ends it", () => {
    const log: string[] = [];
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["shoot"] },
        shoot: {
          to: ["idle"],
          start: "aim",
          exit: () => log.push("exit shoot"),
          states: {
            aim: { to: ["fire"], exit: () => log.push("exit aim") },
            fire: {},
          },
        },
        die: { fromAny: true },
      }),
      "idle",
    );
    machine.start();
    machine.go("shoot");

    machine.go("die");

    expect(log).toEqual(["exit aim", "exit shoot"]);
    expect(machine.state).toBe("die");
  });
});

describe("StateMachine.canGo", () => {
  const brawler = defineStates({
    patrol: { to: ["windup"] },
    windup: { to: ["strike"], for: 0.2, next: "strike" },
    strike: { to: ["patrol"] },
    hit: { fromAny: true, to: ["patrol"] },
    die: { fromAny: true },
  });

  it("reports what go would move to, without throwing", () => {
    const machine = new StateMachine(brawler, "patrol");
    machine.start();

    expect(machine.canGo("windup")).toBe(true);
    expect(machine.canGo("strike")).toBe(false);
    expect(machine.canGo("hit")).toBe(true);
    expect(machine.canGo("patrol")).toBe(false);

    machine.go("hit");
    expect(machine.canGo("hit")).toBe(false);
    expect(machine.canGo("die")).toBe(true);
  });

  it("follows a self-edge and a parent's edges", () => {
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["idle", "shoot"] },
        shoot: {
          to: ["idle"],
          start: "aim",
          states: { aim: { to: ["fire"] }, fire: {} },
        },
      }),
      "idle",
    );
    machine.start();
    expect(machine.canGo("idle")).toBe(true);

    machine.go("shoot");
    expect(machine.canGo("fire")).toBe(true);
    expect(machine.canGo("idle")).toBe(true);
    expect(machine.canGo("aim")).toBe(false);
  });
});

describe("StateMachine durations resolved at entry", () => {
  it("calls for() on each entry and times the state with the result", () => {
    const calls: number[] = [];
    let windup = 0.2;
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["windup"] },
        windup: {
          to: ["strike"],
          for: () => {
            calls.push(windup);
            return windup;
          },
          next: "strike",
        },
        strike: { to: ["idle"] },
      }),
      "idle",
    );
    machine.start();

    machine.go("windup");
    machine.tick(0.2);
    expect(machine.state).toBe("strike");

    windup = 0.5;
    machine.go("idle");
    machine.go("windup");
    machine.tick(0.2);
    expect(machine.state).toBe("windup");
    machine.tick(0.3);
    expect(machine.state).toBe("strike");
    expect(calls).toEqual([0.2, 0.5]);
  });

  it("keeps the source state when for() returns an unusable duration", () => {
    const exit = vi.fn();
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["windup"], exit },
        windup: { to: ["idle"], for: () => 0, next: "idle" },
      }),
      "idle",
    );
    machine.start();

    expect(() => machine.go("windup")).toThrow(
      "duration must be a finite number > 0",
    );
    expect(machine.state).toBe("idle");
    expect(exit).not.toHaveBeenCalled();
  });

  it("carries a computed duration through serialize and hydrate", () => {
    let windup = 1.9;
    const states = defineStates({
      idle: { to: ["windup"] },
      windup: { to: ["idle"], for: () => windup, next: "idle" },
    });
    const saved = new StateMachine(states, "idle");
    saved.start();
    saved.go("windup");
    saved.tick(1.8);

    const snapshot = saved.serialize();
    expect(snapshot).toEqual({ state: "windup", elapsed: 1.8, duration: 1.9 });

    windup = 1.2;
    const loaded = new StateMachine(states, "idle");
    loaded.hydrate(snapshot);
    loaded.tick(0.1);

    expect(loaded.state).toBe("idle");
  });

  it("keeps the machine un-entered when the first duration is unusable", () => {
    const enter = vi.fn();
    let windup = 0;
    const machine = new StateMachine(
      defineStates({
        windup: { to: ["idle"], for: () => windup, next: "idle", enter },
        idle: {},
      }),
      "windup",
    );

    expect(() => machine.start()).toThrow(
      "duration must be a finite number > 0",
    );
    expect(enter).not.toHaveBeenCalled();

    windup = 0.5;
    machine.start();
    expect(enter).toHaveBeenCalledOnce();
    machine.tick(0.5);
    expect(machine.state).toBe("idle");
  });

  it("resolves the duration when hydrating a snapshot without one", () => {
    let windup = 1;
    const machine = new StateMachine(
      defineStates({
        idle: { to: ["windup"] },
        windup: { to: ["idle"], for: () => windup, next: "idle" },
      }),
      "idle",
    );

    expect(() => machine.hydrate({ state: "windup", elapsed: 2 })).toThrow(
      'exceeds state "windup" duration 1',
    );

    windup = 3;
    machine.hydrate({ state: "windup", elapsed: 2 });
    machine.tick(1);

    expect(machine.state).toBe("idle");
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

  it("attributes an event handler failure to the component owning the machine", () => {
    class Brain extends Component {
      readonly mode = this.stateMachine(
        defineStates({ idle: { to: ["active"] }, active: {} }),
        "idle",
      );
    }
    class View extends Component {
      private readonly brain = this.sibling(Brain);

      onAdd(): void {
        this.listen(this.brain.mode, this.brain.mode.events.changed, () => {
          throw new Error("broken handler");
        });
      }
    }

    const { scene } = createMockScene();
    const entity = scene.spawn("guard");
    const brain = entity.add(new Brain());
    entity.add(new View());

    expect(() => brain.mode.go("active")).toThrow("broken handler");
    expect(scene.context.resolve(ErrorBoundaryKey).getCallbackErrors()).toEqual(
      [
        expect.objectContaining({
          kind: "StateMachine changed event (Brain)",
          entity: "guard",
          event: "idle -> active",
        }),
      ],
    );
  });

  it("drops a listener when the listening component is removed", () => {
    const seen: string[] = [];
    class Brain extends Component {
      readonly mode = this.stateMachine(
        defineStates({ idle: { to: ["active"] }, active: { to: ["idle"] } }),
        "idle",
      );
    }
    class View extends Component {
      private readonly brain = this.sibling(Brain);

      onAdd(): void {
        this.listen(
          this.brain.mode,
          this.brain.mode.events.entered,
          ({ state }) => seen.push(state),
        );
      }
    }

    const { scene } = createMockScene();
    const entity = scene.spawn("guard");
    const brain = entity.add(new Brain());
    entity.add(new View());

    brain.mode.go("active");
    entity.remove(View);
    brain.mode.go("idle");

    expect(seen).toEqual(["active"]);
  });

  it("resolves a duration from a field the constructor assigns later", () => {
    class Tuned extends Component {
      private readonly windup: number;

      readonly mode = this.stateMachine(
        defineStates({
          idle: { to: ["windup"] },
          windup: { to: ["strike"], for: () => this.windup, next: "strike" },
          strike: {},
        }),
        "idle",
      );

      constructor(windup: number) {
        super();
        this.windup = windup;
      }
    }

    const { scene } = createMockScene();
    const tuned = scene.spawn("guard").add(new Tuned(0.4));

    tuned.mode.go("windup");
    tuned.mode.tick(0.3);
    expect(tuned.mode.state).toBe("windup");
    tuned.mode.tick(0.1);
    expect(tuned.mode.state).toBe("strike");
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
