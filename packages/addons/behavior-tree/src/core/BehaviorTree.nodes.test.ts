import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { BehaviorTree } from "./BehaviorTree.js";
import { behaviorNodes } from "./nodes.js";
import type { BehaviorStatus } from "./types.js";

interface Context {
  calls: string[];
}
const bt = behaviorNodes<Context>();
const context = (): Context => ({ calls: [] });
const boundary = () => new ErrorBoundary(new Logger({ level: LogLevel.None }));

/** Runs for `ticks` ticks, then finishes with `result`. Logs entry and exit. */
function task(
  id: string,
  ticks: number,
  result: "success" | "failure" = "success",
) {
  return bt.action(id, (ctx) => {
    let count = 0;
    return {
      enter: () => {
        ctx.calls.push(`${id}:enter`);
      },
      tick: (): BehaviorStatus => (++count >= ticks ? result : "running"),
      exit: (exit) => {
        ctx.calls.push(
          `${id}:${exit.status === "cancelled" ? exit.reason : exit.status}`,
        );
      },
    };
  });
}

describe("parallel", () => {
  it("keeps every child's action running and succeeds when all succeed", () => {
    const ctx = context();
    const tree = new BehaviorTree(
      bt.parallel("both", [task("move", 3), task("aim", 2)]),
      ctx,
    );
    expect(tree.tick(1)).toBe("running");
    expect(tree.inspect().activePaths).toEqual([
      "both",
      "both/move",
      "both/aim",
    ]);
    expect(tree.tick(1)).toBe("running");
    expect(tree.tick(1)).toBe("success");
    expect(ctx.calls).toEqual([
      "move:enter",
      "aim:enter",
      "aim:success",
      "move:success",
    ]);
  });

  it("fails on the first failure by default and cancels the other children", () => {
    const ctx = context();
    const tree = new BehaviorTree(
      bt.parallel("both", [task("move", 5), task("aim", 2, "failure")]),
      ctx,
    );
    tree.tick(1);
    expect(tree.tick(1)).toBe("failure");
    expect(ctx.calls).toEqual([
      "move:enter",
      "aim:enter",
      "aim:failure",
      "move:branch-changed",
    ]);
    expect(tree.inspect().transitions).toContainEqual(
      expect.objectContaining({
        path: "both/move",
        reason: "branch-changed",
        by: "both/aim",
      }),
    );
  });

  it('success: "any" finishes with the first success and fails only when all fail', () => {
    const ctx = context();
    const race = new BehaviorTree(
      bt.parallel("race", [task("chase", 5), task("timer", 2)], {
        success: "any",
      }),
      ctx,
    );
    race.tick(1);
    expect(race.tick(1)).toBe("success");
    expect(ctx.calls).toContain("chase:branch-changed");
    const allFail = new BehaviorTree(
      bt.parallel("race", [task("a", 1, "failure"), task("b", 2, "failure")], {
        success: "any",
      }),
      context(),
    );
    expect(allFail.tick(1)).toBe("running");
    expect(allFail.tick(1)).toBe("failure");
  });

  it("empty parallels follow their policy", () => {
    expect(new BehaviorTree(bt.parallel("p", []), context()).tick(1)).toBe(
      "success",
    );
    expect(
      new BehaviorTree(
        bt.parallel("p", [], { success: "any" }),
        context(),
      ).tick(1),
    ).toBe("failure");
  });

  it("a branch change inside one child leaves the sibling child running", () => {
    const ctx = context();
    let spotted = false;
    const tree = new BehaviorTree(
      bt.parallel("root", [
        bt.selector(
          "mind",
          [
            bt.guard("spotted", () => spotted, task("chase", 10)),
            task("patrol", 10),
          ],
          { reactive: true },
        ),
        task("bark", 10),
      ]),
      ctx,
    );
    tree.tick(1);
    spotted = true;
    tree.tick(1);
    expect(ctx.calls).toEqual([
      "patrol:enter",
      "bark:enter",
      "patrol:branch-changed",
      "chase:enter",
    ]);
    expect(tree.inspect().activePaths).toContain("root/bark");
  });

  it("a higher priority branch outside the parallel releases every child before it starts", () => {
    const ctx = context();
    let hurt = false;
    const tree = new BehaviorTree(
      bt.selector(
        "root",
        [
          bt.guard("hurt", () => hurt, task("flee", 10)),
          bt.parallel("fight", [task("strafe", 10), task("shoot", 10)]),
        ],
        { reactive: true },
      ),
      ctx,
    );
    tree.tick(1);
    hurt = true;
    tree.tick(1);
    expect(ctx.calls).toEqual([
      "strafe:enter",
      "shoot:enter",
      "strafe:branch-changed",
      "shoot:branch-changed",
      "flee:enter",
    ]);
  });
});

describe("repeat and retry", () => {
  it("repeat runs the child again on the next tick until it has succeeded `times` times", () => {
    const ctx = context();
    const tree = new BehaviorTree(
      bt.repeat("thrice", 3, task("swing", 1)),
      ctx,
    );
    expect(tree.tick(1)).toBe("running");
    expect(tree.inspect().nodes[0]).toMatchObject({ count: 1, limit: 3 });
    expect(tree.tick(1)).toBe("running");
    expect(tree.tick(1)).toBe("success");
    expect(ctx.calls.filter((call) => call === "swing:enter")).toHaveLength(3);
  });

  it("repeat fails with its child; retry succeeds with its child", () => {
    expect(
      new BehaviorTree(
        bt.repeat("loop", 5, task("swing", 1, "failure")),
        context(),
      ).tick(1),
    ).toBe("failure");
    expect(
      new BehaviorTree(bt.retry("try", 5, task("pick", 1)), context()).tick(1),
    ).toBe("success");
  });

  it("retry runs the child again after each failure until attempts are used up", () => {
    const ctx = context();
    const tree = new BehaviorTree(
      bt.retry("pick", 2, task("lock", 1, "failure")),
      ctx,
    );
    expect(tree.tick(1)).toBe("running");
    expect(tree.inspect().nodes[0]).toMatchObject({ count: 1, limit: 2 });
    expect(tree.tick(1)).toBe("failure");
    expect(ctx.calls).toEqual([
      "lock:enter",
      "lock:failure",
      "lock:enter",
      "lock:failure",
    ]);
  });

  it("zero runs finish without visiting the child; Infinity never finishes by count", () => {
    const ctx = context();
    expect(
      new BehaviorTree(bt.repeat("none", 0, task("swing", 1)), ctx).tick(1),
    ).toBe("success");
    expect(
      new BehaviorTree(bt.retry("none", 0, task("swing", 1)), ctx).tick(1),
    ).toBe("failure");
    expect(ctx.calls).toEqual([]);
    const forever = new BehaviorTree(
      bt.repeat("forever", Infinity, task("swing", 1)),
      ctx,
    );
    for (let i = 0; i < 50; i++) expect(forever.tick(1)).toBe("running");
    expect(ctx.calls.filter((call) => call === "swing:enter")).toHaveLength(50);
  });

  it("validates times and attempts", () => {
    for (const value of [-1, 1.5, NaN])
      expect(
        () => new BehaviorTree(bt.repeat("r", value, task("t", 1)), context()),
      ).toThrow("integer >= 0 or Infinity");
    const tree = new BehaviorTree(
      bt.retry("r", () => 0.5, task("t", 1)),
      context(),
      { errorBoundary: boundary() },
    );
    expect(() => tree.tick(1)).toThrow("integer >= 0 or Infinity");
    expect(tree.inspect().lastError?.phase).toBe("attempts");
  });
});

describe("result decorators and call", () => {
  it("forceSuccess and forceFailure replace finished results and keep running", () => {
    for (const [force, expected] of [
      ["forceSuccess", "success"],
      ["forceFailure", "failure"],
    ] as const) {
      for (const result of ["success", "failure"] as const) {
        const tree = new BehaviorTree(
          bt[force]("force", task("work", 2, result)),
          context(),
        );
        expect(tree.tick(1)).toBe("running");
        expect(tree.tick(1)).toBe(expected);
      }
    }
  });

  it("call runs once per activation and succeeds in the same tick", () => {
    const ctx = context();
    const run = vi.fn();
    const tree = new BehaviorTree(
      bt.sequence("root", [bt.call("bark", run), bt.wait("pause", 1)]),
      ctx,
    );
    expect(tree.tick(0.5)).toBe("running");
    expect(tree.tick(0.5)).toBe("success");
    expect(run).toHaveBeenCalledExactlyOnceWith(ctx);
    tree.tick(0.5);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("call rejects an async callback with its node attribution", () => {
    const tree = new BehaviorTree(
      bt.call("bark", () => Promise.resolve()),
      context(),
      { errorBoundary: boundary() },
    );
    expect(() => tree.tick(1)).toThrow("callbacks must be synchronous");
    expect(tree.inspect().lastError).toMatchObject({
      path: "bark",
      phase: "tick",
    });
  });
});
