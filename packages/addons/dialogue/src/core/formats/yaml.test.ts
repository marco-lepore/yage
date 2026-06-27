import { describe, expect, it } from "vitest";

import { loadYaml } from "./yaml.js";
import { DialogueScriptError } from "./canonical.js";
import { isExpr } from "../expr.js";

const SCRIPT = `
id: shop
start: n1
declare:
  gold: 0
nodes:
  n1:
    id: n1
    steps:
      - kind: say
        text: "Welcome, traveler."
      - kind: command
        commands: []
        condition: "gold > 0"
        target: rich
      - kind: end
  rich:
    id: rich
    steps:
      - kind: say
        text: "You're loaded."
      - kind: end
`;

describe("loadYaml — YAML-literal front-end", () => {
  it("loads a 1:1 mapping into the same frozen IR as JSON", () => {
    const script = loadYaml(SCRIPT);
    expect(script.id).toBe("shop");
    expect(script.start).toBe("n1");
    expect(Object.keys(script.nodes).sort()).toEqual(["n1", "rich"]);
    expect(Object.isFrozen(script)).toBe(true);
  });

  it("resolves a string condition into an Expr tree (the shared pre-walk)", () => {
    const script = loadYaml(SCRIPT);
    const step = script.nodes.n1!.steps[1];
    if (step?.kind !== "command") throw new Error("expected a command step");
    expect(isExpr(step.condition)).toBe(true);
    expect(step.condition).toEqual({
      kind: "binary",
      op: ">",
      left: { kind: "varRef", name: "gold" },
      right: { kind: "literal", value: 0 },
    });
  });

  it("rejects an array root with a clear, YAML-specific error", () => {
    expect(() => loadYaml("- a\n- b")).toThrow(DialogueScriptError);
    expect(() => loadYaml("- a\n- b")).toThrow(/root must be a mapping.*an array/s);
  });

  it("rejects a scalar root", () => {
    expect(() => loadYaml("42")).toThrow(/root must be a mapping.*a number/s);
    expect(() => loadYaml("just a string")).toThrow(/root must be a mapping.*a string/s);
  });

  it("rejects an empty / blank document with a dedicated message", () => {
    // `yaml.parse` collapses both to null; the loader still tells them apart.
    expect(() => loadYaml("")).toThrow(/root must be a mapping.*an empty document/s);
    expect(() => loadYaml("   \n  ")).toThrow(/root must be a mapping.*an empty document/s);
  });

  it("rejects an explicit null root", () => {
    expect(() => loadYaml("null")).toThrow(/root must be a mapping.*got null/s);
  });

  it("wraps a YAML syntax error as DialogueScriptError", () => {
    expect(() => loadYaml("foo: [unclosed")).toThrow(DialogueScriptError);
    expect(() => loadYaml("foo: [unclosed")).toThrow(/YAML parse error/);
  });

  it("still applies structural validation downstream of the parse", () => {
    // A mapping that parses fine but is an invalid script dies in loadScript.
    expect(() => loadYaml("id: x\nnodes: {}")).toThrow(DialogueScriptError);
  });
});
