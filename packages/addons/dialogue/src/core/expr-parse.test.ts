import { describe, expect, it } from "vitest";

import { DialogueExprError, parseExpr } from "./expr-parse.js";
import { createScope, evaluate } from "./expr.js";
import { MemoryVariableStorage } from "./vars.js";
import type { BinaryOp, Expr, UnaryOp, VarValue } from "./types.js";

// Terse Expr builders (mirroring expr.test.ts).
const lit = (value: VarValue): Expr => ({ kind: "literal", value });
const v = (name: string): Expr => ({ kind: "varRef", name });
const bin = (op: BinaryOp, left: Expr, right: Expr): Expr => ({ kind: "binary", op, left, right });
const un = (op: UnaryOp, operand: Expr): Expr => ({ kind: "unary", op, operand });
const grp = (expr: Expr): Expr => ({ kind: "group", expr });
const call = (fn: string, ...args: Expr[]): Expr => ({ kind: "call", fn, args });

/** Capture the thrown error so its line/col can be asserted. */
function caught(src: string): DialogueExprError {
  try {
    parseExpr(src);
  } catch (e) {
    return e as DialogueExprError;
  }
  throw new Error(`expected parseExpr(${JSON.stringify(src)}) to throw`);
}

describe("parseExpr — leaves", () => {
  it("numbers (int + float)", () => {
    expect(parseExpr("8")).toEqual(lit(8));
    expect(parseExpr("1.5")).toEqual(lit(1.5));
  });

  it("string literals (single + double quoted)", () => {
    expect(parseExpr("'key'")).toEqual(lit("key"));
    expect(parseExpr('"hi there"')).toEqual(lit("hi there"));
  });

  it("true / false / null keywords are literals", () => {
    expect(parseExpr("true")).toEqual(lit(true));
    expect(parseExpr("false")).toEqual(lit(false));
    expect(parseExpr("null")).toEqual(lit(null));
  });

  it("a bare identifier is a varRef", () => {
    expect(parseExpr("greeted")).toEqual(v("greeted"));
  });

  it("`.` and `$` are identifier characters → ONE varRef each", () => {
    expect(parseExpr("$gold")).toEqual(v("$gold"));
    expect(parseExpr("a.b")).toEqual(v("a.b"));
    expect(parseExpr("quest.stage")).toEqual(v("quest.stage"));
  });
});

describe("parseExpr — calls", () => {
  it("IDENT'('args')' → a call", () => {
    expect(parseExpr("has_item('rusty-key')")).toEqual(call("has_item", lit("rusty-key")));
  });

  it("zero-arg and multi-arg calls", () => {
    expect(parseExpr("always()")).toEqual(call("always"));
    expect(parseExpr("max(a, 2)")).toEqual(call("max", v("a"), lit(2)));
  });

  it("nested calls and expression args", () => {
    expect(parseExpr("outer(inner(x), y + 1)")).toEqual(
      call("outer", call("inner", v("x")), bin("+", v("y"), lit(1))),
    );
  });
});

describe("parseExpr — operators", () => {
  it("the worked example: str >= 8 and has_item('key')", () => {
    expect(parseExpr("str >= 8 and has_item('key')")).toEqual(
      bin("&&", bin(">=", v("str"), lit(8)), call("has_item", lit("key"))),
    );
  });

  it("`-` is binary minus (hp-1), NOT part of the identifier", () => {
    expect(parseExpr("hp-1")).toEqual(bin("-", v("hp"), lit(1)));
    expect(parseExpr("hp - 1")).toEqual(bin("-", v("hp"), lit(1)));
  });

  it("word forms normalise to symbols", () => {
    expect(parseExpr("a eq b")).toEqual(bin("==", v("a"), v("b")));
    expect(parseExpr("a neq b")).toEqual(bin("!=", v("a"), v("b")));
    expect(parseExpr("a gt b")).toEqual(bin(">", v("a"), v("b")));
    expect(parseExpr("a lt b")).toEqual(bin("<", v("a"), v("b")));
    expect(parseExpr("a gte b")).toEqual(bin(">=", v("a"), v("b")));
    expect(parseExpr("a lte b")).toEqual(bin("<=", v("a"), v("b")));
    expect(parseExpr("a is b")).toEqual(bin("==", v("a"), v("b")));
    expect(parseExpr("a and b")).toEqual(bin("&&", v("a"), v("b")));
    expect(parseExpr("a or b")).toEqual(bin("||", v("a"), v("b")));
    expect(parseExpr("a && b")).toEqual(bin("&&", v("a"), v("b")));
    expect(parseExpr("a || b")).toEqual(bin("||", v("a"), v("b")));
  });

  it("not / ! is prefix negation", () => {
    expect(parseExpr("not greeted")).toEqual(un("!", v("greeted")));
    expect(parseExpr("!greeted")).toEqual(un("!", v("greeted")));
  });

  it("unary minus", () => {
    expect(parseExpr("-x")).toEqual(un("-", v("x")));
    expect(parseExpr("-5")).toEqual(un("-", lit(5)));
  });

  it("precedence: or < and < comparison < additive", () => {
    // a or b and c  →  a or (b and c)
    expect(parseExpr("a or b and c")).toEqual(bin("||", v("a"), bin("&&", v("b"), v("c"))));
    // 1 + 2 == 3  →  (1 + 2) == 3
    expect(parseExpr("1 + 2 == 3")).toEqual(bin("==", bin("+", lit(1), lit(2)), lit(3)));
  });

  it("additive is left-associative", () => {
    expect(parseExpr("a - b - c")).toEqual(bin("-", bin("-", v("a"), v("b")), v("c")));
  });

  it("parentheses group and override precedence", () => {
    expect(parseExpr("(a or b) and c")).toEqual(bin("&&", grp(bin("||", v("a"), v("b"))), v("c")));
  });
});

describe("parseExpr — round-trips through the evaluator", () => {
  const scope = createScope(
    new MemoryVariableStorage({ str: 8, rude: false, gold: 100 }),
    { has_item: (id) => id === "key" },
  );
  const ev = (src: string): VarValue => evaluate(parseExpr(src), scope);

  it("evaluates the worked example", () => {
    expect(ev("str >= 8 and has_item('key')")).toBe(true);
    expect(ev("str >= 9 and has_item('key')")).toBe(false);
    expect(ev("has_item('missing')")).toBe(false);
  });

  it("evaluates arithmetic and negation", () => {
    expect(ev("gold - 50")).toBe(50);
    expect(ev("not rude")).toBe(true);
    expect(ev("gold > 50 or rude")).toBe(true);
  });
});

describe("parseExpr — errors carry line/col", () => {
  it("empty / whitespace-only source", () => {
    expect(() => parseExpr("")).toThrow(DialogueExprError);
    expect(() => parseExpr("   ")).toThrow(DialogueExprError);
    expect(caught("").line).toBe(1);
  });

  it("a trailing token after a complete expression", () => {
    const e = caught("5 6");
    expect(e).toBeInstanceOf(DialogueExprError);
    expect(e.message).toMatch(/trailing/);
    expect(e.col).toBe(3); // the stray "6"
  });

  it("a dangling / leftover operator", () => {
    const e = caught("5 +");
    expect(e.message).toMatch(/end of input/);
    expect(e.col).toBe(4); // past the "+"
  });

  it("an unbalanced parenthesis", () => {
    expect(() => parseExpr("(a or b")).toThrow(/expected "\)"/);
  });

  it("an unterminated string literal", () => {
    expect(() => parseExpr("'oops")).toThrow(/unterminated string/);
  });

  it("a deferred operator is unsupported in v1", () => {
    // `*` / `/` / `%` / `^` are reserved but unwired — they don't tokenize.
    expect(() => parseExpr("a * b")).toThrow(/unexpected character/);
  });
});
