import { describe, expect, it, vi } from "vitest";

import { createScope, evalCondition, evaluate, isExpr, truthy } from "./expr.js";
import { MemoryVariableStorage } from "./vars.js";
import type { BinaryOp, Expr, UnaryOp, VarMap, VarValue } from "./types.js";

const scope = createScope(
  new MemoryVariableStorage({ n: 5, s: "hi", t: true, f: false, zero: 0, empty: "" }),
  {
    double: (v) => Number(v) * 2,
    always: () => true,
  },
);

// Terse Expr builders.
const lit = (value: VarValue): Expr => ({ kind: "literal", value });
const v = (name: string): Expr => ({ kind: "varRef", name });
const bin = (op: BinaryOp, left: Expr, right: Expr): Expr => ({ kind: "binary", op, left, right });
const un = (op: UnaryOp, operand: Expr): Expr => ({ kind: "unary", op, operand });
const grp = (expr: Expr): Expr => ({ kind: "group", expr });
const call = (fn: string, ...args: Expr[]): Expr => ({ kind: "call", fn, args });
const ev = (e: Expr): VarValue => evaluate(e, scope);

describe("evaluate — leaf nodes", () => {
  it("literal returns its value", () => {
    expect(ev(lit(42))).toBe(42);
    expect(ev(lit("x"))).toBe("x");
    expect(ev(lit(null))).toBe(null);
  });

  it("varRef reads storage; an absent name is null", () => {
    expect(ev(v("n"))).toBe(5);
    expect(ev(v("absent"))).toBe(null);
  });

  it("group unwraps to its inner expression", () => {
    expect(ev(grp(bin("+", lit(1), lit(2))))).toBe(3);
  });

  it("call invokes an installed function with evaluated args", () => {
    expect(ev(call("double", lit(4)))).toBe(8);
    expect(ev(call("double", v("n")))).toBe(10);
    expect(ev(call("always"))).toBe(true);
  });

  it("a call to a missing function throws", () => {
    expect(() => ev(call("nope", lit(1)))).toThrow(/no function "nope"/);
  });
});

describe("evaluate — comparison operators (symbol + Yarn word form)", () => {
  // [symbol, word, left, right, expected]
  const cases: [BinaryOp, BinaryOp, number, number, boolean][] = [
    ["==", "eq", 5, 5, true],
    ["==", "eq", 5, 4, false],
    ["!=", "neq", 5, 4, true],
    [">", "gt", 5, 4, true],
    [">", "gt", 5, 5, false],
    ["<", "lt", 4, 5, true],
    [">=", "gte", 5, 5, true],
    ["<=", "lte", 5, 6, true],
  ];
  for (const [sym, word, l, r, expected] of cases) {
    it(`${sym} / ${word} (${l}, ${r}) → ${expected}`, () => {
      expect(ev(bin(sym, lit(l), lit(r)))).toBe(expected);
      expect(ev(bin(word, lit(l), lit(r)))).toBe(expected);
    });
  }

  it("`is` is equality", () => {
    expect(ev(bin("is", v("t"), lit(true)))).toBe(true);
    expect(ev(bin("is", lit("a"), lit("b")))).toBe(false);
  });
});

describe("evaluate — logical operators (symbol + word form)", () => {
  const T = lit(true);
  const F = lit(false);
  it("and / &&", () => {
    expect(ev(bin("and", T, T))).toBe(true);
    expect(ev(bin("&&", T, F))).toBe(false);
    expect(ev(bin("and", lit(1), lit("x")))).toBe(true); // truthy operands
  });
  it("or / ||", () => {
    expect(ev(bin("or", F, T))).toBe(true);
    expect(ev(bin("||", F, F))).toBe(false);
  });
  it("xor / ^", () => {
    expect(ev(bin("xor", T, F))).toBe(true);
    expect(ev(bin("^", T, T))).toBe(false);
    expect(ev(bin("xor", F, F))).toBe(false);
  });
});

describe("evaluate — arithmetic", () => {
  it("numeric + - * / %", () => {
    expect(ev(bin("+", lit(2), lit(3)))).toBe(5);
    expect(ev(bin("-", lit(5), lit(2)))).toBe(3);
    expect(ev(bin("*", lit(4), lit(3)))).toBe(12);
    expect(ev(bin("/", lit(10), lit(4)))).toBe(2.5);
    expect(ev(bin("%", lit(10), lit(3)))).toBe(1);
  });

  it("+ concatenates when either side is a string", () => {
    expect(ev(bin("+", lit("count: "), lit(5)))).toBe("count: 5");
    expect(ev(bin("+", lit(5), lit("!")))).toBe("5!");
    expect(ev(bin("+", lit("a"), lit("b")))).toBe("ab");
    expect(ev(bin("+", lit(null), lit("x")))).toBe("x"); // null stringifies to ""
  });
});

describe("evaluate — unary", () => {
  it("not / ! negates truthiness", () => {
    expect(ev(un("not", lit(false)))).toBe(true);
    expect(ev(un("!", lit(true)))).toBe(false);
    expect(ev(un("not", v("zero")))).toBe(true); // 0 is falsy
    expect(ev(un("not", v("s")))).toBe(false); // "hi" is truthy
  });

  it("- negates a number", () => {
    expect(ev(un("-", lit(5)))).toBe(-5);
    expect(ev(un("-", v("n")))).toBe(-5);
  });
});

describe("evaluate — errors", () => {
  it("throws on an unknown binary operator", () => {
    expect(() => ev(bin("??" as BinaryOp, lit(1), lit(2)))).toThrow(
      /unknown binary operator/,
    );
  });
});

describe("evalCondition", () => {
  it("string key → truthy check", () => {
    expect(evalCondition("n", scope)).toBe(true);
    expect(evalCondition("zero", scope)).toBe(false);
    expect(evalCondition("missing", scope)).toBe(false);
  });

  it("atomic { var, op, value } including truthy / falsy", () => {
    expect(evalCondition({ var: "n", op: ">", value: 4 }, scope)).toBe(true);
    expect(evalCondition({ var: "f", op: "truthy", value: null }, scope)).toBe(false);
    expect(evalCondition({ var: "zero", op: "falsy", value: null }, scope)).toBe(true);
  });

  it("expression tree → truthiness of the evaluated value", () => {
    expect(evalCondition(bin(">=", v("n"), lit(5)), scope)).toBe(true);
    expect(
      evalCondition(bin("and", call("always"), un("not", v("f"))), scope),
    ).toBe(true);
  });

  it("predicate function receives a materialized snapshot", () => {
    const fn = vi.fn((vars: VarMap) => vars.n === 5);
    expect(evalCondition(fn, scope)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("isExpr / truthy", () => {
  it("isExpr discriminates a tree node from an atomic / scalar", () => {
    expect(isExpr(lit(1))).toBe(true);
    expect(isExpr({ var: "n", op: "==", value: 5 })).toBe(false); // atomic has no `kind`
    expect(isExpr("n")).toBe(false);
    expect(isExpr(null)).toBe(false);
  });

  it("truthy follows JS falsiness", () => {
    for (const falsy of [null, false, 0, ""] as VarValue[]) expect(truthy(falsy)).toBe(false);
    for (const t of [true, 1, "x"] as VarValue[]) expect(truthy(t)).toBe(true);
  });
});
