import { describe, expect, it } from "vitest";

import { loadScript } from "./formats/canonical.js";
import {
  analyzeScript,
  validateBinding,
  DialogueBindingError,
  DialogueScriptError,
} from "./validate.js";
import type { DialogueScript } from "./types.js";

function script(partial: Partial<DialogueScript>): DialogueScript {
  return {
    id: "t",
    start: "a",
    nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
    ...partial,
  } as DialogueScript;
}

describe("analyzeScript — load-time reference + type walk", () => {
  it("accepts conditions/tokens that resolve to declared vars or externals", () => {
    const s = script({
      vars: { greeted: false, gold: 0 },
      external: { hp: "number" },
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "say", text: "You have {gold} gold and {hp} hp." },
            { kind: "command", commands: [{ type: "set", var: "greeted", value: true }] },
            { kind: "command", commands: [], condition: { var: "hp", op: ">", value: 5 }, target: "b" },
            { kind: "say", text: "ok" },
          ],
        },
        b: { id: "b", steps: [{ kind: "end" }] },
      },
    });
    expect(() => loadScript(s)).not.toThrow();
  });

  it("rejects a condition var that is not declared", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [
            { kind: "command", commands: [], condition: "ghost", target: "a" },
          ],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(DialogueScriptError);
    expect(() => loadScript(s)).toThrow(/"ghost" is not a declared var or external/);
  });

  it("rejects an interpolation token that is not declared", () => {
    const s = script({
      nodes: { a: { id: "a", steps: [{ kind: "say", text: "Hi {name}." }] } },
    });
    expect(() => loadScript(s)).toThrow(/\{name\}.*not a declared/s);
  });

  it("rejects a set targeting an external (read-only game state)", () => {
    const s = script({
      external: { gold: "number" },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "gold", value: 1 }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/set target "gold" is an external/);
  });

  it("rejects a set targeting an undeclared var", () => {
    const s = script({
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "flag", value: true }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/set target "flag" is not a declared var/);
  });

  it("rejects a numeric operator against a boolean operand", () => {
    const s = script({
      vars: { flag: false },
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
      vars: { n: 0 },
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

  it("rejects a name declared as both a var and an external", () => {
    const s = script({
      vars: { gold: 0 },
      external: { gold: "number" },
    });
    expect(() => loadScript(s)).toThrow(/declared as both a var and an external/);
  });

  it("rejects an invalid external type name", () => {
    const s = script({
      external: { gold: "int" as unknown as "number" },
    });
    expect(() => loadScript(s)).toThrow(/invalid type "int"/);
  });

  it("rejects a set whose value type mismatches the var's declared type", () => {
    const s = script({
      vars: { gold: 0 },
      nodes: {
        a: {
          id: "a",
          steps: [{ kind: "command", commands: [{ type: "set", var: "gold", value: "lots" }] }],
        },
      },
    });
    expect(() => loadScript(s)).toThrow(/set "gold" expects number, got string/);
  });
});

describe("validateBinding — play-time binding check", () => {
  const ext = (): DialogueScript =>
    loadScript(
      script({
        external: { gold: "number", name: "string" },
        nodes: { a: { id: "a", steps: [{ kind: "say", text: "{gold} {name}" }] } },
      }),
    );

  it("accepts a binding that provides every external with the right types", () => {
    const a = analyzeScript(ext());
    expect(() =>
      validateBinding(a, { state: { gold: () => 5, name: "Mara" } }),
    ).not.toThrow();
  });

  it("rejects a missing external", () => {
    const a = analyzeScript(ext());
    expect(() => validateBinding(a, { state: { gold: 5 } })).toThrow(
      DialogueBindingError,
    );
    expect(() => validateBinding(a, { state: { gold: 5 } })).toThrow(/name/);
  });

  it("rejects a wrong-typed external value", () => {
    const a = analyzeScript(ext());
    expect(() =>
      validateBinding(a, { state: { gold: "lots", name: "Mara" } }),
    ).toThrow(/external "gold" must be number, got string/);
  });

  it("rejects a getter bound to a dialogue var (vars are by-value)", () => {
    const s = loadScript(
      script({ vars: { greeted: false }, nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } } }),
    );
    const a = analyzeScript(s);
    expect(() => validateBinding(a, { state: { greeted: () => true } })).toThrow(
      /must be a constant, not a getter/,
    );
  });

  it("rejects a binding for an unknown name", () => {
    const a = analyzeScript(ext());
    expect(() =>
      validateBinding(a, { state: { gold: 1, name: "x", bogus: 2 } }),
    ).toThrow(/unknown name "bogus"/);
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
    expect(() => validateBinding(a, { fallbackCommand: () => {} })).not.toThrow();
    expect(() => validateBinding(a, {})).toThrow(/no handler for command type/);
  });
});
