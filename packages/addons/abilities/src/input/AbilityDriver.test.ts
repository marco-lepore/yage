import { describe, expect, it, vi } from "vitest";
import { ProcessComponent, createMockEntity } from "@yagejs/core";
import { InputManager } from "@yagejs/input";
import { Abilities } from "../core/Abilities.js";
import type { AbilityDef } from "../core/types.js";
import { AbilityDriver } from "./AbilityDriver.js";
import type {
  AbilityDriverOptions,
  AbilityFireContext,
  AbilityGestureContext,
} from "./AbilityDriver.js";
import { setTestActionHeld } from "./test-action-source.js";

function timeline(id: string, duration = 0.2): AbilityDef {
  return { id, duration, timeline: [] };
}

function held(id: string): AbilityDef {
  return {
    id,
    phases: {
      hold: { hold: true, timeline: [] },
    },
  };
}

function setup<TAction extends string, TIntent extends string>(
  defs: readonly AbilityDef[],
  options: AbilityDriverOptions<TAction, TIntent>,
) {
  const input = new InputManager();
  const actions = Object.fromEntries(
    Object.keys(options.bindings).map((action) => [action, []]),
  );
  input.setActionMap(actions);
  const { entity } = createMockEntity("ability-driver-host");
  const processes = entity.add(new ProcessComponent());
  const abilities = entity.add(new Abilities(defs));
  const driver = new AbilityDriver(input, abilities, options);

  return {
    input,
    abilities,
    processes,
    driver,
    advanceInput(seconds: number): void {
      input._advanceTime(seconds * 1000);
    },
  };
}

describe("AbilityDriver", () => {
  it.each(["press", "hold"] as const)(
    "releases a %s-owned hold in its own lane",
    (gesture) => {
      const defs: AbilityDef[] = ["left", "right"].map((lane) => ({
        id: lane,
        lane,
        start: "ready",
        phases: {
          ready: { duration: 10, timeline: [], on: { channel: "held" } },
          held: { hold: true, timeline: [] },
        },
      }));
      const binding =
        gesture === "press"
          ? { press: { send: "channel" } }
          : { hold: { send: "channel", at: 0.1 } };
      const { input, abilities, driver, advanceInput } = setup(defs, {
        bindings: { right: { lane: "right", ...binding } },
      });
      abilities.send("left");
      abilities.send("channel", { lane: "left" });
      abilities.send("right");
      setTestActionHeld(input, "right", true);
      driver.update();
      advanceInput(0.2);
      driver.update();
      expect(abilities.active("right")?.phase).toBe("held");
      setTestActionHeld(input, "right", false);
      driver.update();
      expect(abilities.active("right")).toBeNull();
      expect(abilities.active("left")?.phase).toBe("held");
    },
  );

  it("passes the activation lane when releasing a press delivered after key-up", () => {
    const def: AbilityDef = {
      id: "right",
      lane: "right",
      start: "ready",
      phases: {
        ready: {
          duration: 10,
          timeline: [],
          on: { channel: { to: "held", from: 0.2 } },
        },
        held: { hold: true, timeline: [] },
      },
    };
    const { input, abilities, driver, processes } = setup([def], {
      bindings: {
        right: { lane: "right", press: { send: "channel", buffer: 1 } },
      },
    });
    abilities.send("right");
    const release = vi.spyOn(abilities, "release");
    setTestActionHeld(input, "right", true);
    driver.update();
    setTestActionHeld(input, "right", false);
    driver.update();
    processes._tick(0.3, undefined, "fixed");
    driver.update();
    expect(release).toHaveBeenCalledWith("channel", { lane: "right" });
    expect(abilities.active("right")).toBeNull();
  });
  it("fires press interactions on the press edge", () => {
    const { input, abilities, driver } = setup([timeline("dash")], {
      bindings: { dash: { press: { send: "dash" } } },
    });

    setTestActionHeld(input, "dash", true);
    driver.update();

    expect(abilities.activeId()).toBe("dash");
  });

  it("classifies a release at the hold threshold as a tap", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("tap"), held("charge")],
      {
        defaults: { holdAt: 0.5 },
        bindings: {
          attack: {
            tap: { send: "tap" },
            hold: { send: "charge" },
          },
        },
      },
    );

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.5);
    setTestActionHeld(input, "attack", false);
    driver.update();

    expect(abilities.activeId()).toBe("tap");
  });

  it("fires a hold at its threshold, suppresses tap, and releases it", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("tap"), held("charge")],
      {
        defaults: { holdAt: 0.5 },
        bindings: {
          attack: {
            tap: { send: "tap" },
            hold: { send: "charge" },
          },
        },
      },
    );
    const send = vi.spyOn(abilities, "send");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.5);
    driver.update();
    expect(abilities.activeId()).toBe("charge");

    setTestActionHeld(input, "attack", false);
    driver.update();

    expect(abilities.isActive()).toBe(false);
    expect(send.mock.calls.map(([intent]) => intent)).toEqual(["charge"]);
  });

  it("uses driver defaults and lets a tap override its threshold", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("quick"), timeline("slow", 0.5)],
      {
        defaults: { tapWithin: 0.4 },
        bindings: {
          quick: { tap: { send: "quick", within: 0.1 } },
          slow: { tap: { send: "slow" } },
        },
      },
    );

    setTestActionHeld(input, "quick", true);
    driver.update();
    advanceInput(0.2);
    setTestActionHeld(input, "quick", false);
    driver.update();
    expect(abilities.activeId()).toBe(null);

    setTestActionHeld(input, "slow", true);
    driver.update();
    advanceInput(0.2);
    setTestActionHeld(input, "slow", false);
    driver.update();
    expect(abilities.activeId()).toBe("slow");
  });

  it("lets a hold override the driver threshold", () => {
    const { input, abilities, driver, advanceInput } = setup([held("charge")], {
      defaults: { holdAt: 0.5 },
      bindings: {
        attack: { hold: { send: "charge", at: 0.1 } },
      },
    });

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();

    expect(abilities.activeId()).toBe("charge");
  });

  it("pairs a press-started hold with release before firing its tap", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [held("guard"), timeline("parry")],
      {
        defaults: { tapWithin: 0.3 },
        bindings: {
          guard: {
            press: { send: "guard" },
            tap: { send: "parry" },
          },
        },
      },
    );

    setTestActionHeld(input, "guard", true);
    driver.update();
    expect(abilities.activeId()).toBe("guard");

    advanceInput(0.1);
    setTestActionHeld(input, "guard", false);
    driver.update();

    expect(abilities.activeId()).toBe("parry");
  });

  it("retries buffered sends through polite admission", () => {
    const blocker: AbilityDef = {
      id: "blocker",
      duration: 1,
      cancels: [{ from: 0.2, into: ["dash"] }],
      timeline: [],
    };
    const { input, abilities, processes, driver, advanceInput } = setup(
      [blocker, timeline("dash")],
      { bindings: { dash: { press: { send: "dash", buffer: 0.5 } } } },
    );
    abilities.send("blocker");

    setTestActionHeld(input, "dash", true);
    driver.update();
    expect(abilities.activeId()).toBe("blocker");

    processes._tick(0.2, undefined, "fixed");
    advanceInput(0.2);
    driver.update();
    expect(abilities.activeId()).toBe("dash");
  });

  it("does not let a buffered send win through priority alone", () => {
    const blocker = timeline("blocker", 1);
    const dash = { ...timeline("dash"), priority: 10 };
    const { input, abilities, driver } = setup([blocker, dash], {
      bindings: { dash: { press: { send: "dash", buffer: 0.5 } } },
    });
    abilities.send("blocker");

    setTestActionHeld(input, "dash", true);
    driver.update();

    expect(abilities.activeId()).toBe("blocker");
    abilities.cancel();
    driver.update();
    expect(abilities.activeId()).toBe("dash");
  });

  it("uses direct-send admission for an unbuffered interaction", () => {
    const blocker = timeline("blocker", 1);
    const dash = { ...timeline("dash"), priority: 10 };
    const { input, abilities, driver } = setup([blocker, dash], {
      bindings: { dash: { press: { send: "dash" } } },
    });
    abilities.send("blocker");

    setTestActionHeld(input, "dash", true);
    driver.update();

    expect(abilities.activeId()).toBe("dash");
  });

  it("expires buffers on raw input time", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("blocker", 1), timeline("dash")],
      { bindings: { dash: { press: { send: "dash", buffer: 0.2 } } } },
    );
    abilities.send("blocker");
    setTestActionHeld(input, "dash", true);
    driver.update();

    advanceInput(0.21);
    driver.update();
    abilities.cancel();
    driver.update();

    expect(abilities.activeId()).toBe(null);
  });

  it("starts a tap buffer at the release edge", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("blocker", 1), timeline("tap")],
      {
        defaults: { tapWithin: 0.5 },
        bindings: {
          attack: { tap: { send: "tap", buffer: 0.2 } },
        },
      },
    );
    abilities.send("blocker");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.4);
    setTestActionHeld(input, "attack", false);
    driver.update();

    advanceInput(0.19);
    abilities.cancel();
    driver.update();

    expect(abilities.activeId()).toBe("tap");
  });

  it("starts a hold buffer at the hold threshold", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("blocker", 1), held("charge")],
      {
        defaults: { holdAt: 0.2 },
        bindings: {
          attack: { hold: { send: "charge", buffer: 0.3 } },
        },
      },
    );
    abilities.send("blocker");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.2);
    driver.update();

    advanceInput(0.29);
    abilities.cancel();
    driver.update();

    expect(abilities.activeId()).toBe("charge");
  });

  it("expires a tap buffer from its release edge", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("blocker", 1), timeline("tap")],
      {
        defaults: { tapWithin: 0.5 },
        bindings: {
          attack: { tap: { send: "tap", buffer: 0.2 } },
        },
      },
    );
    abilities.send("blocker");

    setTestActionHeld(input, "attack", true);
    driver.update();
    setTestActionHeld(input, "attack", false);
    driver.update();
    advanceInput(0.21);
    driver.update();
    abilities.cancel();
    driver.update();

    expect(abilities.activeId()).toBe(null);
  });

  it("expires a hold buffer from its threshold edge", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("blocker", 1), held("charge")],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: { hold: { send: "charge", buffer: 0.2 } },
        },
      },
    );
    abilities.send("blocker");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    advanceInput(0.21);
    driver.update();
    abilities.cancel();
    driver.update();

    expect(abilities.activeId()).toBe(null);
  });

  it("cancels a buffered hold before retrying on key-up", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("blocker", 1), held("charge")],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: { hold: { send: "charge", buffer: 1 } },
        },
      },
    );
    abilities.send("blocker");
    const send = vi.spyOn(abilities, "send");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();

    abilities.cancel();
    setTestActionHeld(input, "attack", false);
    driver.update();

    expect(send.mock.calls.map(([intent]) => intent)).not.toContain("charge");
  });

  it("keeps a buffered intent after a re-entrant send refusal", () => {
    const { input, abilities, driver } = setup([timeline("dash")], {
      bindings: { dash: { press: { send: "dash", buffer: 0.2 } } },
    });
    const realSend = abilities.send.bind(abilities);
    vi.spyOn(abilities, "send")
      .mockReturnValueOnce({ ok: false, reason: "busy" })
      .mockImplementation(realSend);

    setTestActionHeld(input, "dash", true);
    driver.update();
    expect(abilities.activeId()).toBe(null);

    driver.update();
    expect(abilities.activeId()).toBe("dash");
  });

  it("captures data at the gesture edge before a buffered send fires", () => {
    let value = 1;
    const { input, abilities, driver } = setup(
      [timeline("blocker", 1), timeline("dash")],
      {
        bindings: {
          dash: {
            press: {
              send: "dash",
              buffer: 0.5,
              data: () => ({ value }),
            },
          },
        },
      },
    );
    abilities.send("blocker");
    setTestActionHeld(input, "dash", true);
    driver.update();

    value = 2;
    abilities.cancel();
    driver.update();

    expect(abilities.active()?.payload).toEqual({ value: 1 });
  });

  it("passes raw and scaled hold time to an explicit release payload", () => {
    const charge: AbilityDef = {
      id: "charge",
      entry: { "charge-release": "kick" },
      phases: {
        hold: {
          hold: true,
          on: { "charge-release": "kick" },
          timeline: [],
        },
        kick: { duration: 0.2, timeline: [] },
      },
    };
    const { input, abilities, processes, driver, advanceInput } = setup(
      [charge],
      {
        defaults: { holdAt: 0.5 },
        bindings: {
          attack: {
            hold: {
              send: "charge",
              resume: true,
              release: {
                send: "charge-release",
                data: ({ activation, heldFor }: AbilityGestureContext) => ({
                  heldFor,
                  scaled: activation?.elapsedIn("hold"),
                }),
              },
            },
          },
        },
      },
    );
    const send = vi.spyOn(abilities, "send");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.5);
    driver.update();
    processes._tick(0.2, undefined, "fixed");
    advanceInput(0.3);
    setTestActionHeld(input, "attack", false);
    driver.update();

    expect(abilities.active()?.phase).toBe("kick");
    expect(abilities.active()?.payload).toEqual({
      heldFor: 0.8,
      scaled: 0.2,
    });
    abilities.cancel();
    driver.update();
    expect(send.mock.calls.map(([intent]) => intent)).toEqual([
      "charge",
      "charge-release",
    ]);
  });

  it("delivers an explicit release after an interrupted hold", () => {
    const charge: AbilityDef = {
      id: "charge",
      entry: { "charge-release": "kick" },
      phases: {
        hold: {
          hold: true,
          on: { "charge-release": "kick" },
          timeline: [],
        },
        kick: { duration: 0.2, timeline: [] },
      },
    };
    const blocker = { ...timeline("blocker", 1), priority: 10 };
    const { input, abilities, driver, advanceInput } = setup(
      [charge, blocker],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: {
            hold: {
              send: "charge",
              release: { send: "charge-release", buffer: 1 },
            },
          },
        },
      },
    );

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    const chargeActivation = abilities.active();
    abilities.send("blocker");
    expect(chargeActivation?.state).toBe("cancelled");

    advanceInput(0.8);
    setTestActionHeld(input, "attack", false);
    driver.update();
    expect(abilities.activeId()).toBe("blocker");

    advanceInput(0.9);
    abilities.cancel();
    driver.update();
    expect(abilities.active()?.def.id).toBe("charge");
    expect(abilities.active()?.phase).toBe("kick");
  });

  it("expires an explicit release buffer from key-up", () => {
    const charge: AbilityDef = {
      id: "charge",
      entry: { "charge-release": "kick" },
      phases: {
        hold: {
          hold: true,
          on: { "charge-release": "kick" },
          timeline: [],
        },
        kick: { duration: 0.2, timeline: [] },
      },
    };
    const blocker = { ...timeline("blocker", 1), priority: 10 };
    const { input, abilities, driver, advanceInput } = setup(
      [charge, blocker],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: {
            hold: {
              send: "charge",
              release: { send: "charge-release", buffer: 0.2 },
            },
          },
        },
      },
    );

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    abilities.send("blocker");
    setTestActionHeld(input, "attack", false);
    driver.update();

    advanceInput(0.21);
    driver.update();
    abilities.cancel();
    driver.update();

    expect(abilities.activeId()).toBe(null);
  });

  it("does not resume or release a hold cancelled after automatic advance", () => {
    const charge: AbilityDef = {
      id: "charge",
      entry: { "charge-release": "kick" },
      phases: {
        hold: {
          hold: { max: 0.1 },
          next: "kick",
          on: { "charge-release": "kick" },
          timeline: [],
        },
        kick: { duration: 1, timeline: [] },
      },
    };
    const { input, abilities, processes, driver, advanceInput } = setup(
      [charge],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: {
            hold: {
              send: "charge",
              resume: true,
              release: { send: "charge-release" },
            },
          },
        },
      },
    );
    const send = vi.spyOn(abilities, "send");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    processes._tick(0.1, undefined, "fixed");
    expect(abilities.active()?.phase).toBe("kick");

    abilities.cancel();
    driver.update();
    setTestActionHeld(input, "attack", false);
    driver.update();

    expect(abilities.activeId()).toBe(null);
    expect(send.mock.calls.map(([intent]) => intent)).toEqual(["charge"]);
  });

  it("does not resurrect an explicit release after natural completion", () => {
    const charge: AbilityDef = {
      id: "charge",
      entry: { "charge-release": "kick" },
      phases: {
        hold: {
          hold: { max: 0.1 },
          next: "kick",
          on: { "charge-release": "kick" },
          timeline: [],
        },
        kick: { duration: 0.1, timeline: [] },
      },
    };
    const { input, abilities, processes, driver, advanceInput } = setup(
      [charge],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: {
            hold: {
              send: "charge",
              release: { send: "charge-release" },
            },
          },
        },
      },
    );
    const send = vi.spyOn(abilities, "send");

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    processes._tick(0.2, undefined, "fixed");
    expect(abilities.activeId()).toBe(null);

    setTestActionHeld(input, "attack", false);
    driver.update();
    expect(send.mock.calls.map(([intent]) => intent)).toEqual(["charge"]);
  });

  it("resumes a cancelled hold politely while the action stays pressed", () => {
    const blocker = { ...timeline("blocker", 1), priority: 10 };
    const { input, abilities, driver, advanceInput } = setup(
      [held("charge"), blocker],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: { hold: { send: "charge", resume: true } },
        },
      },
    );

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    const first = abilities.active();
    abilities.send("blocker");
    driver.update();
    expect(abilities.activeId()).toBe("blocker");

    abilities.cancel();
    driver.update();
    expect(first?.state).toBe("cancelled");
    expect(abilities.activeId()).toBe("charge");
    expect(abilities.active()).not.toBe(first);
  });

  it("does not resume a naturally completed hold", () => {
    const charge: AbilityDef = {
      id: "charge",
      phases: {
        hold: { hold: { max: 0.1 }, timeline: [] },
      },
    };
    const { input, abilities, processes, driver, advanceInput } = setup(
      [charge],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: { hold: { send: "charge", resume: true } },
        },
      },
    );

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    processes._tick(0.1, undefined, "fixed");
    driver.update();

    expect(abilities.activeId()).toBe(null);
  });

  it("captures press-time neutrality before a deferred update", () => {
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("blocker", 1), held("charge")],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: { hold: { send: "charge", fromNeutral: true } },
        },
      },
    );
    abilities.send("blocker");
    setTestActionHeld(input, "attack", true);
    abilities.cancel();
    driver.update();
    advanceInput(0.1);
    driver.update();

    expect(abilities.activeId()).toBe(null);
  });

  it("requires the lane to remain neutral at the hold threshold", () => {
    const blocker = { ...timeline("blocker", 1), priority: 10 };
    const { input, abilities, driver, advanceInput } = setup(
      [blocker, held("charge")],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: { hold: { send: "charge", fromNeutral: true } },
        },
      },
    );

    setTestActionHeld(input, "attack", true);
    driver.update();
    abilities.send("blocker");
    advanceInput(0.1);
    driver.update();

    expect(abilities.activeId()).toBe("blocker");
  });

  it("does not release a newer hold that this press does not own", () => {
    const { input, abilities, driver } = setup([held("guard")], {
      bindings: { guard: { press: { send: "guard" } } },
    });

    setTestActionHeld(input, "guard", true);
    driver.update();
    const first = abilities.active();
    abilities.cancel();
    const second = abilities.send("guard");
    expect(second.ok).toBe(true);

    setTestActionHeld(input, "guard", false);
    driver.update();

    expect(first?.state).toBe("cancelled");
    expect(abilities.active()).toBe(second.ok ? second.activation : null);
  });

  it("keeps a buffered fromNeutral hold waiting for an idle lane", () => {
    const blocker: AbilityDef = {
      id: "blocker",
      duration: 1,
      cancels: [{ from: 0, into: ["charge"] }],
      timeline: [],
    };
    const { input, abilities, driver, advanceInput } = setup(
      [blocker, held("charge")],
      {
        defaults: { holdAt: 0.1 },
        bindings: {
          attack: {
            hold: {
              send: "charge",
              fromNeutral: true,
              buffer: 0.5,
            },
          },
        },
      },
    );
    const realCanSend = abilities.canSend.bind(abilities);
    vi.spyOn(abilities, "canSend")
      .mockReturnValueOnce(false)
      .mockImplementation(realCanSend);

    setTestActionHeld(input, "attack", true);
    driver.update();
    advanceInput(0.1);
    driver.update();
    abilities.send("blocker");

    driver.update();
    expect(abilities.activeId()).toBe("blocker");

    abilities.cancel();
    driver.update();
    expect(abilities.activeId()).toBe("charge");
  });

  it("re-evaluates gate and runs beforeFire only after admission", () => {
    let admitted = false;
    const calls: string[] = [];
    let fireContext: AbilityFireContext | null = null;
    const { input, abilities, driver } = setup([timeline("dash")], {
      beforeFire: (context) => {
        calls.push("before");
        fireContext = context;
      },
      bindings: {
        dash: {
          press: { send: "dash", buffer: 0.2, data: { speed: 4 } },
          gate: () => {
            calls.push("gate");
            return admitted;
          },
        },
      },
    });

    setTestActionHeld(input, "dash", true);
    driver.update();
    expect(calls).toEqual(["gate"]);

    admitted = true;
    driver.update();
    expect(calls).toEqual(["gate", "gate", "before"]);
    expect(fireContext).toMatchObject({
      action: "dash",
      gesture: "press",
      intent: "dash",
      lane: "main",
      heldFor: 0,
      data: { speed: 4 },
    });
    expect(abilities.activeId()).toBe("dash");
  });

  it("records press and release edges until update resumes", () => {
    let heldFor = -1;
    const { input, abilities, driver, advanceInput } = setup(
      [timeline("tap")],
      {
        defaults: { tapWithin: 0.3 },
        bindings: {
          attack: {
            tap: {
              send: "tap",
              data: (context: AbilityGestureContext) => {
                heldFor = context.heldFor;
                return context.heldFor;
              },
            },
          },
        },
      },
    );

    advanceInput(0.1);
    setTestActionHeld(input, "attack", true);
    advanceInput(0.2);
    setTestActionHeld(input, "attack", false);
    driver.update();

    expect(heldFor).toBeCloseTo(0.2);
    expect(abilities.active()?.payload).toBeCloseTo(0.2);
  });

  it("throws for unknown actions and missing thresholds", () => {
    const input = new InputManager();
    input.setActionMap({ known: [] });
    const { entity } = createMockEntity("invalid-driver-host");
    entity.add(new ProcessComponent());
    const abilities = entity.add(
      new Abilities([timeline("tap"), held("hold")]),
    );

    expect(
      () =>
        new AbilityDriver(input, abilities, {
          bindings: { unknown: { press: { send: "tap" } } },
        }),
    ).toThrow('unknown input action "unknown"');
    expect(
      () =>
        new AbilityDriver(input, abilities, {
          bindings: { known: { tap: { send: "tap" } } },
        }),
    ).toThrow("needs tap.within");
    expect(
      () =>
        new AbilityDriver(input, abilities, {
          bindings: { known: { hold: { send: "hold" } } },
        }),
    ).toThrow("needs hold.at");
  });

  it("disposes listeners and ignores later updates", () => {
    const { input, abilities, driver } = setup([timeline("dash")], {
      bindings: { dash: { press: { send: "dash" } } },
    });
    driver.dispose();

    setTestActionHeld(input, "dash", true);
    driver.update();

    expect(abilities.activeId()).toBe(null);
  });

  it("cancels an active hold it owns when disposed", () => {
    const { input, abilities, driver } = setup([held("charge")], {
      bindings: { attack: { hold: { send: "charge", at: 0 } } },
    });

    setTestActionHeld(input, "attack", true);
    driver.update();
    const activation = abilities.active();
    expect(activation?.isHolding).toBe(true);

    driver.dispose();

    expect(activation?.state).toBe("cancelled");
    expect(abilities.active()).toBeNull();
  });

  it("narrows action and intent strings through AbilityDriverOptions", () => {
    const valid: AbilityDriverOptions<"attack", "jab"> = {
      bindings: { attack: { press: { send: "jab" } } },
    };
    expect(valid.bindings.attack?.press?.send).toBe("jab");

    const invalid: AbilityDriverOptions<"attack", "jab"> = {
      bindings: {
        attack: {
          // @ts-expect-error — the factory-facing generic rejects unknown intents.
          press: { send: "kick" },
        },
      },
    };
    expect(invalid).toBeDefined();
  });
});
