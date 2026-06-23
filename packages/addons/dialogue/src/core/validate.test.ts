import { describe, expect, it } from "vitest";

import { loadScript } from "./formats/canonical.js";
import {
  analyzeScript,
  validatePlay,
  DialoguePlayError,
  DialogueScriptError,
  type PlayEnv,
} from "./validate.js";
import { MemoryVariableStorage, cells, compose } from "./vars.js";
import type { DialogueScript } from "./types.js";

function script(partial: Partial<DialogueScript>): DialogueScript {
  return {
    id: "t",
    start: "a",
    nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    ...partial,
  } as DialogueScript;
}

/** A play-time env, defaulting every field so a test names only what it sets. */
function env(over: Partial<PlayEnv> = {}): PlayEnv {
  return {
    storage: over.storage ?? new MemoryVariableStorage(),
    functions: over.functions ?? {},
    commands: over.commands ?? {},
    fallbackCommand: over.fallbackCommand,
  };
}

describe("analyzeScript — load-time walk + internal type checks", () => {
  it("collects read vars, set targets, called functions, and command types", () => {
    const s = loadScript(
      script({
        declare: { greeted: false, gold: 0 },
        nodes: {
          a: {
            id: "a",
            steps: [
              { kind: "say", text: "You have {gold} gold." },
              { kind: "command", commands: [{ type: "set", var: "greeted", value: true }] },
              {
                kind: "command",
                commands: [],
                condition: { kind: "call", fn: "has_item", args: [{ kind: "literal", value: "key" }] },
                target: "b",
              },
              { kind: "command", commands: [{ type: "give-item", id: "key" }] },
              { kind: "say", text: "ok" },
            ],
          },
          b: { id: "b", steps: [{ kind: "end" }] },
        },
      }),
    );
    const a = analyzeScript(s);
    expect([...a.readVars].sort()).toEqual(["gold"]);
    expect([...a.setTargets]).toEqual(["greeted"]);
    expect([...a.calledFunctions]).toEqual(["has_item"]);
    expect([...a.commandTypes]).toEqual(["give-item"]);
  });

  it("does NOT reject an undeclared reference (storage may provide it at play)", () => {
    const s = script({
      nodes: {
        a: { id: "a", steps: [{ kind: "command", commands: [], condition: "ghost", target: "a" }] },
      },
    });
    // Load-time is environment-free — the typo surfaces at play, not here.
    expect(() => loadScript(s)).not.toThrow();
  });

  it("rejects a numeric operator against a declared boolean operand", () => {
    const s = script({
      declare: { flag: false },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [], condition: { var: "flag", op: ">", value: 1 }, target: "a" },
          ],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/needs a number; "flag" is boolean/);
  });

  it("rejects a numeric operator compared against a non-number value", () => {
    const s = script({
      declare: { n: 0 },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [], condition: { var: "n", op: ">", value: "x" }, target: "a" },
          ],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/compares against a number, got string/);
  });

  it("rejects a set whose literal value type mismatches the declared default", () => {
    // A bare string `set` value now reads as a varRef (the unify pre-walk); a
    // *quoted* string is the string literal — and it still type-checks against
    // the target's declared type.
    const s = script({
      declare: { gold: 0 },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "gold", value: "'lots'" }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/set "gold" expects number, got string/);
  });

  it("type-checks a string comparison's literal operand (Expr-path parity)", () => {
    // "gold >= 'foo'" pre-walks to a `>=` tree; the quoted string is a wrong-type
    // operand, mirroring the atomic `{ var, op, value }` value check.
    const s = script({
      declare: { gold: 0 },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [], condition: "gold >= 'foo'", target: "a" }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/operator ">=" expects a number, got string/);
  });

  it("type-checks an arithmetic op's literal operand (gold + true)", () => {
    const s = script({
      declare: { gold: 0 },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "gold", value: "gold + true" }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/operator "\+" expects a number or string, got boolean/);
  });

  it("rejects a numeric op against a declared non-number var (Expr path)", () => {
    const s = script({
      declare: { flag: false },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [], condition: "flag > 1", target: "a" }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/needs a number; "flag" is boolean/);
  });

  it("allows `+` against a string var (concatenation is valid)", () => {
    const s = script({
      declare: { name: "x", note: "" },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "note", value: "name + '!'" }] }],
        },
      },
    });
    expect(() => loadScript(s)).not.toThrow();
  });

  it("rejects a set command with no value (would write undefined)", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "gold" }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/set "gold" has no value/);
  });

  it("allows a set to null (an intentional clear)", () => {
    const s = script({
      declare: { note: "hi" },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "note", value: null }] }],
        },
      },
    });
    expect(() => loadScript(s)).not.toThrow();
  });

  it("allows a set to an undeclared name (a dialogue-local created on write)", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "local", value: true }] }],
        },
      },
    });
    expect(() => loadScript(s)).not.toThrow();
  });
});

describe("validatePlay — play-time environment check", () => {
  const reads = (): DialogueScript =>
    loadScript(
      script({
        nodes: { a: { id: "a", steps: [{ kind: "say", text: "{gold} {name}" }] } },
      }),
    );

  it("accepts an environment that provides every read name", () => {
    const a = analyzeScript(reads());
    const storage = new MemoryVariableStorage({ gold: 5, name: "Mara" });
    expect(() => validatePlay(a, env({ storage }))).not.toThrow();
  });

  it("rejects a read name that nothing provides", () => {
    const a = analyzeScript(reads());
    const storage = new MemoryVariableStorage({ gold: 5 });
    expect(() => validatePlay(a, env({ storage }))).toThrow(DialoguePlayError);
    expect(() => validatePlay(a, env({ storage }))).toThrow(/reads "name"/);
  });

  it("accepts an undeclared local that is written by `set` then read", () => {
    // A flow-insensitive walk can't order read vs write; a name the script writes
    // is provided by the script itself (D3 — locals are just names in the store).
    const s = loadScript(
      script({
        nodes: {
          a: {
            id: "a",
            steps: [
              { kind: "command", commands: [{ type: "set", var: "quest_stage", value: 1 }] },
              {
                kind: "command",
                commands: [],
                condition: { var: "quest_stage", op: ">=", value: 1 },
                target: "b",
              },
              { kind: "say", text: "Stage {quest_stage}." },
            ],
          },
          b: { id: "b", steps: [{ kind: "end" }] },
        },
      }),
    );
    expect(() => validatePlay(analyzeScript(s), env())).not.toThrow();
  });

  it("counts a declared default as provided (it will be seeded)", () => {
    const s = loadScript(
      script({
        declare: { gold: 0, name: "stranger" },
        nodes: { a: { id: "a", steps: [{ kind: "say", text: "{gold} {name}" }] } },
      }),
    );
    expect(() => validatePlay(analyzeScript(s), env())).not.toThrow();
  });

  it("rejects a called function that is not installed", () => {
    const s = loadScript(
      script({
        nodes: {
          a: {
            id: "a",
            steps: [
              {
                kind: "command",
                commands: [],
                condition: { kind: "call", fn: "has_item", args: [{ kind: "literal", value: "key" }] },
                target: "a",
              },
            ],
          },
        },
      }),
    );
    expect(() => validatePlay(analyzeScript(s), env())).toThrow(
      /calls function "has_item"/,
    );
    expect(() =>
      validatePlay(analyzeScript(s), env({ functions: { has_item: () => true } })),
    ).not.toThrow();
  });

  it("rejects a set target that is a function (read-only)", () => {
    const s = loadScript(
      script({
        nodes: {
          a: {
            id: "a",
            steps: [{ kind: "command", commands: [{ type: "set", var: "score", value: 1 }] }],
          },
        },
      }),
    );
    expect(() =>
      validatePlay(analyzeScript(s), env({ functions: { score: () => 0 } })),
    ).toThrow(/set target "score" is a function/);
  });

  it("rejects a declared default whose type conflicts with the stored value", () => {
    const s = loadScript(
      script({
        declare: { gold: 0 },
        nodes: { a: { id: "a", steps: [{ kind: "say", text: "{gold}" }] } },
      }),
    );
    // The host already holds `gold` as a string via a cell — a type clash.
    const storage = compose(cells({ gold: () => "lots" }), new MemoryVariableStorage());
    expect(() => validatePlay(analyzeScript(s), env({ storage }))).toThrow(
      /declared default for "gold" is number but storage already holds string/,
    );
  });

  it("accepts a fallbackCommand in place of per-type handlers", () => {
    const s = loadScript(
      script({
        nodes: {
          a: {
            id: "a",
            steps: [
              { kind: "command", commands: [{ type: "give-item" }] },
              { kind: "say", text: "x" },
            ],
          },
        },
      }),
    );
    const a = analyzeScript(s);
    expect(() => validatePlay(a, env({ fallbackCommand: () => {} }))).not.toThrow();
    expect(() => validatePlay(a, env())).toThrow(/no handler for command type/);
  });
});

describe("error classes", () => {
  it("are distinct subclasses of Error", () => {
    expect(new DialogueScriptError("x")).toBeInstanceOf(Error);
    expect(new DialoguePlayError("x")).toBeInstanceOf(Error);
    expect(new DialoguePlayError("x")).not.toBeInstanceOf(DialogueScriptError);
  });
});
