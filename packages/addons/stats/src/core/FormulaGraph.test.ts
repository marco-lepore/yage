import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary, Logger } from "@yagejs/core";
import { FormulaGraph } from "./FormulaGraph.js";

const boundary = () => new ErrorBoundary(new Logger({ output: () => {} }));

describe("FormulaGraph", () => {
  it("evaluates shared dependencies once per read, without retaining stale context", () => {
    const attack = vi.fn((_get, context: number) => context);
    const graph = new FormulaGraph<
      "attack" | "skill" | "burst" | "total",
      number
    >({
      attack: { dependencies: [], evaluate: attack },
      skill: { dependencies: ["attack"], evaluate: (get) => get("attack") * 2 },
      burst: { dependencies: ["attack"], evaluate: (get) => get("attack") * 5 },
      total: {
        dependencies: ["skill", "burst"],
        evaluate: (get) => get("skill") + get("burst"),
      },
    });
    expect(graph.evaluate("total", 10)).toBe(70);
    expect(attack).toHaveBeenCalledTimes(1);
    expect(graph.values(20)).toEqual({
      attack: 20,
      skill: 40,
      burst: 100,
      total: 140,
    });
    expect(attack).toHaveBeenCalledTimes(2);
  });

  it("rejects cycles and missing dependencies before evaluating callbacks", () => {
    const evaluate = vi.fn(() => 1);
    expect(
      () =>
        new FormulaGraph({
          a: { dependencies: ["b"], evaluate },
          b: { dependencies: ["a"], evaluate },
        }),
    ).toThrow("a -> b -> a");
    expect(
      () =>
        new FormulaGraph<string>({
          a: { dependencies: ["missing"], evaluate },
        }),
    ).toThrow("missing");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("attributes undeclared reads and non-finite results", () => {
    const errors = boundary();
    const graph = new FormulaGraph<"a" | "b">(
      {
        a: { dependencies: [], evaluate: (get) => get("b") },
        b: { dependencies: [], evaluate: () => Infinity },
      },
      errors,
    );
    expect(() => graph.evaluate("a", undefined)).toThrow(
      "undeclared dependency b",
    );
    expect(() => graph.evaluate("b", undefined)).toThrow("finite number");
    expect(errors.getCallbackErrors().map((e) => e.event)).toEqual(["a", "b"]);
  });

  it("stops after a throwing dependency and preserves caller-owned definitions", () => {
    const fail = new Error("broken rule");
    const later = vi.fn(() => 2);
    const dependencies: ("a" | "b")[] = ["a"];
    const graph = new FormulaGraph<"a" | "b">(
      {
        a: {
          dependencies: [],
          evaluate: () => {
            throw fail;
          },
        },
        b: { dependencies, evaluate: later },
      },
      boundary(),
    );
    dependencies.length = 0;
    expect(() => graph.evaluate("b", undefined)).toThrow(fail);
    expect(later).not.toHaveBeenCalled();
  });

  it("supports prototype-named formula keys", () => {
    const graph = new FormulaGraph({
      constructor: { dependencies: [], evaluate: () => 5 },
    });
    expect(graph.evaluate("constructor", undefined)).toBe(5);
  });
});
