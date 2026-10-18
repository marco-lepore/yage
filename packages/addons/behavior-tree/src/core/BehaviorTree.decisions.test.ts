import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { BehaviorTree } from "./BehaviorTree.js";
import { behaviorNodes } from "./nodes.js";
import type { BehaviorNode } from "./types.js";

const bt = behaviorNodes<{ ready: boolean }>();
const context = () => ({ ready: true });
const errors = () => new ErrorBoundary(new Logger({ level: LogLevel.None }));

describe("behavior decisions and timing", () => {
  it("samples chance once while running and again after cancellation", () => {
    const random = vi.fn().mockReturnValueOnce(0.2).mockReturnValueOnce(0.9);
    const probability = vi.fn(() => 0.5);
    const exit = vi.fn();
    const tree = new BehaviorTree(
      bt.chance(
        "maybe",
        probability,
        bt.action("work", () => ({ tick: () => "running", exit })),
      ),
      context(),
      { random },
    );
    tree.tick(0.1);
    tree.tick(0.1);
    expect(random).toHaveBeenCalledTimes(1);
    expect(probability).toHaveBeenCalledTimes(1);
    expect(tree.inspect().nodes[0]?.chancePassed).toBe(true);
    tree.cancel();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(tree.tick(0.1)).toBe("failure");
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("zero and certain chance and constant random waits need no RNG", () => {
    const create = vi.fn(() => ({ tick: () => "success" as const }));
    const child = bt.action("work", create);
    expect(
      new BehaviorTree(bt.chance("never", 0, child), context()).tick(1),
    ).toBe("failure");
    expect(create).not.toHaveBeenCalled();
    expect(
      new BehaviorTree(bt.chance("always", 1, child), context()).tick(1),
    ).toBe("success");
    expect(
      new BehaviorTree(bt.randomWait("constant", 1, 1), context()).tick(1),
    ).toBe("success");
  });

  it.each(["retry", "fail"] as const)(
    "weighted failure mode %s",
    (onFailure) => {
      const calls: string[] = [];
      const task = (id: string, status: "success" | "failure") =>
        bt.action(id, () => ({
          tick: () => {
            calls.push(id);
            return status;
          },
        }));
      const tree = new BehaviorTree(
        bt.weightedSelector(
          "choose",
          [
            { weight: 0, child: task("excluded", "success") },
            { weight: 3, child: task("first", "failure") },
            { weight: 1, child: task("second", "success") },
          ],
          { onFailure },
        ),
        context(),
        { random: () => 0 },
      );
      expect(tree.tick(0.1)).toBe(
        onFailure === "retry" ? "success" : "failure",
      );
      expect(calls).toEqual(
        onFailure === "retry" ? ["first", "second"] : ["first"],
      );
    },
  );

  it("weighted choices keep their sampled weights and running child across reactive visits", () => {
    const ctx = context();
    const weight = vi.fn((c: { ready: boolean }) => (c.ready ? 3 : 0));
    const tick = vi.fn(() => "running" as const);
    const random = vi.fn(() => 0.5);
    const tree = new BehaviorTree(
      bt.selector(
        "root",
        [
          bt.weightedSelector("choose", [
            { weight, child: bt.action("a", () => ({ tick })) },
            { weight: 1, child: bt.wait("b", 1) },
          ]),
        ],
        { reactive: true },
      ),
      ctx,
      { random },
    );
    tree.tick(0.1);
    ctx.ready = false;
    tree.tick(0.1);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(weight).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledTimes(1);
    expect(tree.inspect().nodes[1]).toMatchObject({
      selectedChild: "root/choose/a",
      remainingWeights: [3, 1],
    });
    tree.cancel();
    tree.tick(0.1);
    expect(tree.inspect().nodes[1]?.selectedChild).toBe("root/choose/b");
  });

  it("weighted selection uses proportional boundaries and handles large finite weights", () => {
    const choices = [
      { weight: 3, child: bt.wait("a", 10) },
      { weight: 1, child: bt.wait("b", 10) },
    ];
    for (const [roll, selected] of [
      [0, "a"],
      [0.749, "a"],
      [0.75, "b"],
      [0.999, "b"],
    ] as const) {
      const tree = new BehaviorTree(
        bt.weightedSelector("choose", choices),
        context(),
        { random: () => roll },
      );
      tree.tick(0.1);
      expect(tree.inspect().nodes[0]?.selectedChild).toBe(`choose/${selected}`);
    }
    const tree = new BehaviorTree(
      bt.weightedSelector(
        "huge",
        choices.map((choice) => ({
          ...choice,
          weight: Number.MAX_VALUE,
        })),
      ),
      context(),
      { random: () => 0.75 },
    );
    expect(tree.tick(0.1)).toBe("running");
    expect(tree.inspect().nodes[0]?.selectedChild).toBe("huge/b");
  });

  it("zero or exhausted weights fail without retrying the same child", () => {
    const random = vi.fn(() => 0);
    const fail = vi.fn(() => "failure" as const);
    const choices = ["a", "b"].map((id) => ({
      weight: 1,
      child: bt.action(id, () => ({ tick: fail })),
    }));
    expect(
      new BehaviorTree(bt.weightedSelector("empty", []), context(), {
        random,
      }).tick(1),
    ).toBe("failure");
    expect(
      new BehaviorTree(
        bt.weightedSelector(
          "zero",
          choices.map((c) => ({ ...c, weight: 0 })),
        ),
        context(),
        { random },
      ).tick(1),
    ).toBe("failure");
    expect(random).not.toHaveBeenCalled();
    expect(
      new BehaviorTree(bt.weightedSelector("exhaust", choices), context(), {
        random,
      }).tick(1),
    ).toBe("failure");
    expect(fail).toHaveBeenCalledTimes(2);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("copies weighted config and inspection arrays", () => {
    const choice = { weight: 2, child: bt.wait("a", 5) };
    const tree = new BehaviorTree(
      bt.weightedSelector("choose", [choice]),
      context(),
      { random: () => 0 },
    );
    choice.weight = 0;
    tree.tick(1);
    const inspection = tree.inspect();
    (inspection.nodes[0]!.remainingWeights as number[])[0] = 9;
    expect(tree.inspect().nodes[0]?.remainingWeights).toEqual([2]);
  });

  it("random waits sample once per activation and freeze at zero dt", () => {
    const random = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0);
    const tree = new BehaviorTree(bt.randomWait("wait", 1, 3), context(), {
      random,
    });
    expect(tree.tick(0)).toBe("idle");
    expect(random).not.toHaveBeenCalled();
    tree.tick(0.5);
    expect(tree.inspect().nodes[0]).toMatchObject({
      durationSeconds: 2,
      remainingSeconds: 1.5,
    });
    tree.tick(0.5);
    expect(random).toHaveBeenCalledTimes(1);
    expect(tree.tick(1)).toBe("success");
    expect(tree.tick(0.5)).toBe("running");
    expect(tree.inspect().nodes[0]?.durationSeconds).toBe(1);
  });

  it("samples callback durations once and reads fresh values on restart", () => {
    const ctx = context();
    const duration = vi.fn((c: { ready: boolean }) => (c.ready ? 1 : 2));
    const tree = new BehaviorTree(bt.wait("wait", duration), ctx);
    tree.tick(0.5);
    ctx.ready = false;
    expect(tree.tick(0.5)).toBe("success");
    tree.tick(0.5);
    expect(duration).toHaveBeenCalledTimes(2);
    expect(tree.inspect().nodes[0]?.durationSeconds).toBe(2);
  });

  it("cooldowns run while unvisited and persist across root restarts and cancel", () => {
    const ctx = context();
    const fire = vi.fn(() => "success" as const);
    const tree = new BehaviorTree(
      bt.selector(
        "root",
        [
          bt.guard("other", (c) => !c.ready, bt.wait("busy", 10)),
          bt.cooldown(
            "reload",
            1,
            bt.action("fire", () => ({ tick: fire })),
          ),
          bt.wait("idle", 10),
        ],
        { reactive: true },
      ),
      ctx,
    );
    expect(tree.tick(0.25)).toBe("success");
    tree.cancel();
    ctx.ready = false;
    tree.tick(0.5);
    expect(
      tree.inspect().nodes.find((n) => n.id === "reload")?.remainingSeconds,
    ).toBe(0.5);
    const before = tree.inspect();
    tree.tick(0);
    expect(tree.inspect()).toEqual(before);
    ctx.ready = true;
    tree.tick(0.25);
    expect(fire).toHaveBeenCalledTimes(1);
    tree.tick(0.25);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("cooldown starts after success, with independent state for each occurrence and runner", () => {
    const child = bt.cooldown("limit", 1, bt.wait("work", 0.5));
    const root = bt.sequence("root", [
      bt.subtree("a", child),
      bt.subtree("b", child),
    ]);
    const a = new BehaviorTree(root, context());
    const b = new BehaviorTree(root, context());
    a.tick(0.25);
    expect(
      a.inspect().nodes.find((n) => n.path === "root/a/limit")
        ?.remainingSeconds,
    ).toBe(0);
    a.tick(0.25);
    expect(
      a.inspect().nodes.find((n) => n.path === "root/a/limit")
        ?.remainingSeconds,
    ).toBe(1);
    expect(
      a.inspect().nodes.find((n) => n.path === "root/b/limit")
        ?.remainingSeconds,
    ).toBe(0);
    expect(
      b.inspect().nodes.find((n) => n.path === "root/a/limit")
        ?.remainingSeconds,
    ).toBe(0);
    a.cancel();
    expect(a.tick(0.25)).toBe("failure");
    expect(b.tick(0.5)).toBe("success");
  });

  it("failed and interrupted actions do not start a cooldown", () => {
    const fail = new BehaviorTree(
      bt.cooldown(
        "limit",
        10,
        bt.condition("no", () => false),
      ),
      context(),
    );
    fail.tick(1);
    expect(fail.inspect().nodes[0]?.remainingSeconds).toBe(0);
    const running = new BehaviorTree(
      bt.cooldown("limit", 10, bt.wait("work", 5)),
      context(),
    );
    running.tick(1);
    running.cancel();
    expect(running.inspect().nodes[0]?.remainingSeconds).toBe(0);
    expect(running.tick(1)).toBe("running");
  });

  it.each([NaN, Infinity, -1, 1, 2])(
    "attributes invalid RNG output %s without entering the child",
    (roll) => {
      const start = vi.fn();
      const tree = new BehaviorTree(
        bt.chance(
          "chance",
          0.5,
          bt.action("work", () => ({ enter: start, tick: () => "running" })),
        ),
        context(),
        {
          random: () => roll,
          errorBoundary: errors(),
        },
      );
      expect(() => tree.tick(1)).toThrow("[0, 1)");
      expect(start).not.toHaveBeenCalled();
      expect(tree.inspect().lastError).toMatchObject({
        path: "chance",
        phase: "random",
      });
    },
  );

  it("requires explicit randomness for a headless random decision", () => {
    const tree = new BehaviorTree(bt.randomWait("wait", 0, 1), context(), {
      errorBoundary: errors(),
    });
    expect(() => tree.tick(1)).toThrow("options.random");
  });

  it("attributes reversed dynamic wait bounds and validates dynamic durations", () => {
    const tree = new BehaviorTree(
      bt.randomWait(
        "wait",
        () => 2,
        () => 1,
      ),
      context(),
      { errorBoundary: errors() },
    );
    expect(() => tree.tick(1)).toThrow("min must be <= max");
    expect(tree.inspect().lastError?.phase).toBe("duration");
    for (const node of [
      bt.wait("wait", () => Infinity),
      bt.timeout("limit", () => -1, bt.wait("child", 0)),
    ]) {
      expect(() =>
        new BehaviorTree(node, context(), { errorBoundary: errors() }).tick(1),
      ).toThrow("finite number");
    }
  });

  it("cancels a weighted action before starting a higher priority replacement", () => {
    const ctx = context();
    const log: string[] = [];
    const tree = new BehaviorTree(
      bt.selector(
        "root",
        [
          bt.guard(
            "urgent",
            (c) => !c.ready,
            bt.action("replacement", () => ({
              enter: () => {
                log.push("replacement");
              },
              tick: () => "running",
            })),
          ),
          bt.weightedSelector("choose", [
            {
              weight: 1,
              child: bt.action("old", () => ({
                tick: () => "running",
                exit: () => {
                  log.push("old-exit");
                },
              })),
            },
          ]),
        ],
        { reactive: true },
      ),
      ctx,
      { random: () => 0 },
    );
    tree.tick(0.1);
    ctx.ready = false;
    tree.tick(0.1);
    expect(log).toEqual(["old-exit", "replacement"]);
  });

  it("running actions read replacement snapshots on subsequent ticks", () => {
    let state: Readonly<{ done: boolean }> = Object.freeze({ done: false });
    const ctx = { read: () => state };
    const nodes = behaviorNodes<typeof ctx>();
    const tree = new BehaviorTree(
      nodes.action("work", (c) => ({
        tick: () => (c.read().done ? "success" : "running"),
      })),
      ctx,
    );
    expect(tree.tick(1)).toBe("running");
    state = Object.freeze({ done: true });
    expect(tree.tick(1)).toBe("success");
  });

  it("rejects invalid static inputs at construction", () => {
    for (const node of [
      bt.chance("chance", 1.1, bt.wait("wait", 0)),
      bt.weightedSelector("weights", [
        { weight: -1, child: bt.wait("wait", 0) },
      ]),
      bt.randomWait("wait", 2, 1),
      bt.cooldown("cooldown", Infinity, bt.wait("wait", 0)),
    ])
      expect(() => new BehaviorTree(node, context())).toThrow();
  });

  it("validates all dynamic weights before entering any child", () => {
    const start = vi.fn(() => ({ tick: () => "success" as const }));
    const tree = new BehaviorTree(
      bt.weightedSelector("weights", [
        { weight: 1, child: bt.action("first", start) },
        { weight: () => NaN, child: bt.wait("bad", 0) },
      ]),
      context(),
      { random: () => 0, errorBoundary: errors() },
    );
    expect(() => tree.tick(1)).toThrow("finite number");
    expect(start).not.toHaveBeenCalled();
    expect(tree.inspect().lastError?.phase).toBe("weight");
  });

  it.each(["probability", "duration", "weight", "random"] as const)(
    "preserves errors from %s callbacks",
    (phase) => {
      const original = new Error("broken callback");
      const fail = () => {
        throw original;
      };
      const nodes: Record<typeof phase, BehaviorNode<{ ready: boolean }>> = {
        probability: bt.chance("node", fail, bt.wait("work", 0)),
        duration: bt.wait("node", fail),
        weight: bt.weightedSelector("node", [
          { weight: fail, child: bt.wait("work", 0) },
        ]),
        random: bt.randomWait("node", 0, 1),
      };
      const tree = new BehaviorTree(nodes[phase], context(), {
        random: fail,
        errorBoundary: errors(),
      });
      expect(() => tree.tick(1)).toThrow(original);
      expect(tree.inspect().lastError).toMatchObject({ phase, path: "node" });
    },
  );

  it("cancellation inside a numeric callback prevents child entry", () => {
    const start = vi.fn(() => ({ tick: () => "success" as const }));
    const tree: BehaviorTree<{ ready: boolean }> = new BehaviorTree(
      bt.chance(
        "chance",
        () => {
          tree.cancel();
          return 1;
        },
        bt.action("work", start),
      ),
      context(),
    );
    expect(tree.tick(1)).toBe("idle");
    expect(start).not.toHaveBeenCalled();
  });

  it("live readers observe replacement snapshots and writes from earlier siblings", () => {
    let state: Readonly<{ health: number }> = Object.freeze({ health: 100 });
    const ctx = {
      read: () => state,
      hurt: () => {
        state = Object.freeze({ health: 20 });
      },
    };
    const nodes = behaviorNodes<typeof ctx>();
    const tree = new BehaviorTree(
      nodes.sequence("root", [
        nodes.action("hurt", (c) => ({
          tick: () => {
            c.hurt();
            return "success";
          },
        })),
        nodes.guard(
          "hurt-now",
          (c) => c.read().health < 30,
          nodes.action("wait-for-heal", (c) => ({
            tick: () => (c.read().health >= 100 ? "success" : "running"),
          })),
        ),
      ]),
      ctx,
    );
    expect(tree.tick(1)).toBe("running");
    state = Object.freeze({ health: 100 });
    expect(tree.tick(1)).toBe("failure");
    expect(state.health).toBe(100);
  });
});
