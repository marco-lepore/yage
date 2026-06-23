import { describe, expect, it } from "vitest";

import { DialogueScriptError, loadScript } from "./canonical.js";
import { createScope, evalCondition, isExpr } from "../expr.js";
import { MemoryVariableStorage } from "../vars.js";
import type { CommandStep, Condition, DialogueScript } from "../types.js";

function script(partial: Partial<DialogueScript>): DialogueScript {
  return {
    id: "t",
    start: "a",
    nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    ...partial,
  } as DialogueScript;
}

/** Load a one-node script whose only step is a conditional command, returning
 *  the (pre-walked) condition. */
function loadCondition(condition: Condition): Condition | undefined {
  const s = loadScript(
    script({
      nodes: {
        a: { id: "a", steps: [{ kind: "command", commands: [], condition, target: "a" }] },
      },
    }),
  );
  return (s.nodes.a!.steps[0] as CommandStep).condition;
}

describe("loadScript — structural validation", () => {
  it("accepts a minimal valid script", () => {
    expect(() => loadScript(script({}))).not.toThrow();
  });

  it("rejects a goto without a target (instead of silently ending at runtime)", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "goto" } as unknown as { kind: "goto"; target: string }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(DialogueScriptError);
    expect(() => loadScript(s)).toThrow(/goto has no target/);
  });

  it("rejects a goto whose target does not exist", () => {
    const s = script({
      nodes: { a: { id: "a", steps: [{ kind: "goto", target: "missing" }] } },
    });
    expect(() => loadScript(s)).toThrow(/jump target "missing"/);
  });

  it("rejects a choice with no options", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "choice", options: [] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/choice has no options/);
  });
});

describe("loadScript — speaker validation", () => {
  it("rejects a speakers record whose key != speaker.id", () => {
    const s = script({
      speakers: { gwen: { id: "gewn", name: "Gwen" } },
    });
    expect(() => loadScript(s)).toThrow(DialogueScriptError);
    expect(() => loadScript(s)).toThrow(/speaker key "gwen" != speaker.id "gewn"/);
  });

  it("rejects a say.speaker that is not in script.speakers", () => {
    const s = script({
      speakers: { gwen: { id: "gwen", name: "Gwen" } },
      nodes: {
        a: { id: "a", steps: [{ kind: "say", speaker: "gwne", text: "typo" }] },
      },
    });
    expect(() => loadScript(s)).toThrow(/speaker "gwne" is not in script.speakers/);
  });

  it("rejects a choice.speaker that is not in script.speakers", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "choice", speaker: "ghost", options: [{ text: "x" }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/speaker "ghost"/);
  });

  it("accepts matching keys and resolvable speaker references", () => {
    const s = script({
      speakers: { gwen: { id: "gwen", name: "Gwen" } },
      nodes: {
        a: { id: "a", steps: [{ kind: "say", speaker: "gwen", text: "hi" }] },
      },
    });
    expect(() => loadScript(s)).not.toThrow();
  });

  it("speakerless lines remain valid (narrator)", () => {
    expect(() => loadScript(script({}))).not.toThrow();
  });
});

describe("loadScript — string conditions / set values unify to Expr", () => {
  it("a bare-name condition becomes a varRef and evaluates like the old truthy read", () => {
    const condition = loadCondition("gate");
    expect(condition).toEqual({ kind: "varRef", name: "gate" });
    // Back-compat: identical to today's `truthy(scope.get("gate"))`.
    const on = createScope(new MemoryVariableStorage({ gate: true }), {});
    const off = createScope(new MemoryVariableStorage({ gate: false }), {});
    expect(evalCondition(condition!, on)).toBe(true);
    expect(evalCondition(condition!, off)).toBe(false);
  });

  it("operator-bearing condition strings now parse (`not greeted`)", () => {
    const condition = loadCondition("not greeted");
    expect(condition).toEqual({ kind: "unary", op: "!", operand: { kind: "varRef", name: "greeted" } });
    const scope = createScope(new MemoryVariableStorage({ greeted: false }), {});
    expect(evalCondition(condition!, scope)).toBe(true);
  });

  it("compound condition strings now parse (`a and b`)", () => {
    const condition = loadCondition("a and b");
    expect(condition).toEqual({
      kind: "binary",
      op: "&&",
      left: { kind: "varRef", name: "a" },
      right: { kind: "varRef", name: "b" },
    });
  });

  it("leaves an atomic { var, op, value } condition untouched", () => {
    const atomic = { var: "n", op: ">", value: 1 } as const;
    expect(loadCondition(atomic)).toEqual(atomic);
  });

  it("leaves an already-built Expr condition untouched", () => {
    const tree = { kind: "varRef", name: "x" } as const;
    expect(loadCondition(tree)).toBe(tree);
  });

  it("resolves a string `set` RHS into an Expr tree (gold - 50)", () => {
    const s = loadScript(
      script({
        declare: { gold: 100 },
        nodes: {
          a: {
            id: "a",
            steps: [
              { kind: "command", commands: [{ type: "set", var: "gold", value: "gold - 50" }] },
              { kind: "end" },
            ],
          },
        },
      }),
    );
    const step = s.nodes.a!.steps[0] as CommandStep;
    const value = step.commands[0]!.value;
    expect(isExpr(value)).toBe(true);
    expect(value).toEqual({
      kind: "binary",
      op: "-",
      left: { kind: "varRef", name: "gold" },
      right: { kind: "literal", value: 50 },
    });
  });

  it("propagates a malformed condition string as a parse error", () => {
    expect(() => loadCondition("a and")).toThrow(/end of input/);
  });
});
