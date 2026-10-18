import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { BehaviorTree } from "./BehaviorTree.js";
import { behaviorNodes } from "./nodes.js";
import type { BehaviorExit, BehaviorNode } from "./types.js";

interface Context {
  healthy: boolean;
  calls: string[];
}
const bt = behaviorNodes<Context>();
const context = (): Context => ({ healthy: true, calls: [] });
const boundary = () => new ErrorBoundary(new Logger({ level: LogLevel.None }));

function work(id: string) {
  return bt.action(id, (ctx) => ({
    enter: () => {
      ctx.calls.push(`${id}:enter`);
    },
    tick: () => {
      ctx.calls.push(`${id}:tick`);
      return "running";
    },
    exit: (exit) => {
      ctx.calls.push(
        `${id}:${exit.status === "cancelled" ? exit.reason : exit.status}`,
      );
    },
  }));
}

describe("BehaviorTree", () => {
  it("enters once, continues, exits once and recreates local state next activation", () => {
    const exits: BehaviorExit[] = [];
    const enter = vi.fn();
    const create = vi.fn(() => {
      let count = 0;
      return {
        enter,
        tick: () =>
          ++count === 2 ? ("success" as const) : ("running" as const),
        exit: (reason: BehaviorExit) => {
          exits.push(reason);
        },
      };
    });
    const tree = new BehaviorTree(bt.action("work", create), context());
    expect(tree.tick(0.1)).toBe("running");
    expect(tree.tick(0.1)).toBe("success");
    expect(exits).toEqual([{ status: "success" }]);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(tree.tick(0.1)).toBe("running");
    expect(create).toHaveBeenCalledTimes(2);
    tree.cancel();
    tree.cancel();
    expect(exits).toHaveLength(2);
  });

  it.each([false, true])(
    "sequence reactive=%s defines whether an earlier condition is reevaluated",
    (reactive) => {
      const ctx = context();
      const tree = new BehaviorTree(
        bt.sequence(
          "root",
          [bt.condition("healthy", (c) => c.healthy), work("attack")],
          { reactive },
        ),
        ctx,
      );
      tree.tick(0.1);
      ctx.healthy = false;
      expect(tree.tick(0.1)).toBe(reactive ? "failure" : "running");
      expect(ctx.calls.includes("attack:branch-changed")).toBe(reactive);
    },
  );

  it.each([false, true])(
    "selector reactive=%s defines whether higher priority is reconsidered",
    (reactive) => {
      const ctx = context();
      const tree = new BehaviorTree(
        bt.selector(
          "root",
          [
            bt.guard("hurt", (c) => !c.healthy, work("retreat")),
            work("attack"),
          ],
          { reactive },
        ),
        ctx,
      );
      tree.tick(0.1);
      ctx.healthy = false;
      tree.tick(0.1);
      expect(ctx.calls).toEqual(
        reactive
          ? [
              "attack:enter",
              "attack:tick",
              "attack:branch-changed",
              "retreat:enter",
              "retreat:tick",
            ]
          : ["attack:enter", "attack:tick", "attack:tick"],
      );
      if (reactive)
        expect(tree.inspect().transitions).toContainEqual(
          expect.objectContaining({
            path: "root/attack",
            reason: "branch-changed",
            by: "root/hurt/retreat",
          }),
        );
    },
  );

  it("guards cancel their running child before a fallback starts", () => {
    const ctx = context();
    const tree = new BehaviorTree(
      bt.selector("root", [
        bt.guard("healthy", (c) => c.healthy, work("attack")),
        work("rest"),
      ]),
      ctx,
    );
    tree.tick(0.1);
    ctx.healthy = false;
    tree.tick(0.1);
    expect(ctx.calls.slice(2)).toEqual([
      "attack:guard-failed",
      "rest:enter",
      "rest:tick",
    ]);
  });

  it("a reactive action probe cancels the previous branch even when the probe fails", () => {
    const ctx = context();
    let eligible = false;
    const tree = new BehaviorTree(
      bt.selector(
        "root",
        [
          bt.guard(
            "probe",
            () => eligible,
            bt.action("try", (c) => ({
              tick: () => {
                c.calls.push("try:tick");
                return "failure";
              },
            })),
          ),
          work("work"),
        ],
        { reactive: true },
      ),
      ctx,
    );
    tree.tick(1);
    eligible = true;
    tree.tick(1);
    expect(ctx.calls).toEqual([
      "work:enter",
      "work:tick",
      "work:branch-changed",
      "try:tick",
      "work:enter",
      "work:tick",
    ]);
  });

  it("reuses a subtree in two positions and two runners without sharing local state", () => {
    const child = bt.action("count", () => {
      let ticks = 0;
      return { tick: () => (++ticks === 2 ? "success" : "running") };
    });
    const definition = bt.sequence("root", [
      bt.subtree("first", child),
      bt.subtree("second", child),
    ]);
    const a = new BehaviorTree(definition, context());
    const b = new BehaviorTree(definition, context());
    a.tick(1);
    a.tick(1);
    expect(a.inspect().activePaths).toContain("root/second/count");
    expect(b.tick(1)).toBe("running");
    expect(b.inspect().activePaths).toContain("root/first/count");
    expect(a.tick(1)).toBe("success");
  });

  it("wait uses supplied seconds and dt=0 freezes even instant actions", () => {
    const tree = new BehaviorTree(bt.wait("wait", 0.5), context());
    expect(tree.tick(0)).toBe("idle");
    expect(tree.tick(0.25)).toBe("running");
    const before = tree.inspect();
    tree.tick(0);
    expect(tree.inspect()).toEqual(before);
    expect(tree.tick(0.25)).toBe("success");
  });

  it("timeout cancels before giving the child another tick at its deadline", () => {
    const ctx = context();
    const tree = new BehaviorTree(
      bt.timeout("deadline", 0.5, work("work")),
      ctx,
    );
    tree.tick(0.25);
    expect(tree.tick(0.25)).toBe("failure");
    expect(ctx.calls).toEqual(["work:enter", "work:tick", "work:timeout"]);
    const immediate = new BehaviorTree(
      bt.timeout("deadline", 0, work("never")),
      ctx,
    );
    expect(immediate.tick(1)).toBe("failure");
    expect(ctx.calls).not.toContain("never:enter");
  });

  it("empty composites and inversion have defined outcomes", () => {
    expect(new BehaviorTree(bt.sequence("root", []), context()).tick(1)).toBe(
      "success",
    );
    expect(new BehaviorTree(bt.selector("root", []), context()).tick(1)).toBe(
      "failure",
    );
    expect(
      new BehaviorTree(
        bt.invert(
          "root",
          bt.condition("yes", () => true),
        ),
        context(),
      ).tick(1),
    ).toBe("failure");
    expect(
      new BehaviorTree(bt.invert("root", work("busy")), context()).tick(1),
    ).toBe("running");
  });

  it.each([NaN, Infinity, -1])(
    "rejects invalid dt %s before changing state",
    (dt) => {
      const tree = new BehaviorTree(work("work"), context());
      const before = tree.inspect();
      expect(() => tree.tick(dt)).toThrow("finite seconds");
      expect(tree.inspect()).toEqual(before);
      expect(() => new BehaviorTree(bt.wait("wait", dt), context())).toThrow(
        "finite number",
      );
    },
  );

  it("validates cycles, sibling ids and history bounds before running callbacks", () => {
    const cycle: BehaviorNode<Context> = {
      kind: "sequence",
      id: "cycle",
      children: [],
    };
    (cycle.children as BehaviorNode<Context>[]).push(cycle);
    expect(() => new BehaviorTree(cycle, context())).toThrow("cyclic");
    expect(
      () =>
        new BehaviorTree(
          bt.sequence("root", [work("same"), work("same")]),
          context(),
        ),
    ).toThrow("duplicate sibling");
    expect(() => new BehaviorTree(work("bad/id"), context())).toThrow(
      "node id",
    );
    expect(
      () => new BehaviorTree(work("ok"), context(), { historyLimit: Infinity }),
    ).toThrow("historyLimit");
  });

  it("captures definition topology at construction and returns independent bounded diagnostics", () => {
    const children = [work("work")];
    const tree = new BehaviorTree(bt.sequence("root", children), context(), {
      historyLimit: 3,
    });
    children.length = 0;
    tree.tick(1);
    tree.cancel();
    tree.tick(1);
    const info = tree.inspect();
    expect(info.transitions).toHaveLength(3);
    expect(info.activePaths).toContain("root/work");
    (info.nodes as unknown[]).length = 0;
    expect(tree.inspect().nodes).toHaveLength(2);
    expect(
      new BehaviorTree(work("work"), context(), { historyLimit: 0 }).inspect()
        .transitions,
    ).toEqual([]);
  });

  it.each(["create", "enter", "tick", "exit", "condition"] as const)(
    "attributes %s errors and rethrows the same Error without cleanup",
    (phase) => {
      const original = new Error("broken");
      const exit = vi.fn();
      const errors = boundary();
      const fail = () => {
        throw original;
      };
      const node =
        phase === "condition"
          ? bt.condition("node", fail)
          : bt.action(
              "node",
              phase === "create"
                ? fail
                : () => ({
                    ...(phase === "enter" ? { enter: fail } : {}),
                    tick: phase === "tick" ? fail : () => "success",
                    exit: phase === "exit" ? fail : exit,
                  }),
            );
      const tree = new BehaviorTree(node, context(), { errorBoundary: errors });
      expect(() => tree.tick(1)).toThrow(original);
      expect(errors.getCallbackErrors()).toEqual([
        expect.objectContaining({
          kind: `Behavior tree ${phase}`,
          event: "node",
          error: "broken",
        }),
      ]);
      expect(tree.inspect().lastError).toMatchObject({
        phase,
        path: "node",
        message: "broken",
      });
      expect(exit).not.toHaveBeenCalled();
    },
  );

  it("a throwing exit prevents replacement entry", () => {
    const ctx = context();
    const start = vi.fn();
    const errors = boundary();
    const root = bt.selector(
      "root",
      [
        bt.guard(
          "hurt",
          (c) => !c.healthy,
          bt.action("new", () => ({ enter: start, tick: () => "running" })),
        ),
        bt.action("old", () => ({
          tick: () => "running",
          exit: () => {
            throw new Error("cannot exit");
          },
        })),
      ],
      { reactive: true },
    );
    const tree = new BehaviorTree(root, ctx, { errorBoundary: errors });
    tree.tick(1);
    ctx.healthy = false;
    expect(() => tree.tick(1)).toThrow("cannot exit");
    expect(start).not.toHaveBeenCalled();
  });

  it("cancellation requested in a callback stops traversal and exits once", () => {
    const exit = vi.fn();
    const next = vi.fn();
    const tree: BehaviorTree<Context> = new BehaviorTree(
      bt.sequence("root", [
        bt.action("stop", () => ({
          tick: () => {
            tree.cancel();
            return "success";
          },
          exit,
        })),
        bt.action("next", () => ({ tick: next })),
      ]),
      context(),
    );
    expect(tree.tick(1)).toBe("idle");
    expect(next).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith({
      status: "cancelled",
      reason: "cancelled",
      by: null,
    });
  });

  it("cancellation from a preempted exit prevents the replacement factory", () => {
    const ctx = context();
    const create = vi.fn(() => ({ tick: () => "running" as const }));
    const tree: BehaviorTree<Context> = new BehaviorTree(
      bt.selector(
        "root",
        [
          bt.guard("hurt", (c) => !c.healthy, bt.action("replacement", create)),
          bt.action("old", () => ({
            tick: () => "running",
            exit: () => {
              tree.cancel();
            },
          })),
        ],
        { reactive: true },
      ),
      ctx,
    );
    tree.tick(1);
    ctx.healthy = false;
    expect(tree.tick(1)).toBe("idle");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects recursive ticks with callback attribution", () => {
    const tree: BehaviorTree<Context> = new BehaviorTree(
      bt.action("bad", () => ({
        tick: () => {
          tree.tick(1);
          return "success";
        },
      })),
      context(),
      { errorBoundary: boundary() },
    );
    expect(() => tree.tick(1)).toThrow("cannot tick during a callback");
  });
});
