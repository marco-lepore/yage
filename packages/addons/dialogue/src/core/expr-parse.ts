/**
 * String → expression front-end. `parseExpr("str >= 8 and has_item('key')")`
 * produces the same {@link Expr} tree a hand-authored JSON condition / `set`
 * value would — `literal | varRef | call | unary | binary | group`, no new node
 * kinds — so the evaluator (`expr.ts`) and the load-time walk (`validate.ts`)
 * are reused unchanged. This is purely a parser: it does no type-checking and
 * no name resolution (that stays in `validate.ts`), which keeps it reusable 1:1
 * for a future Yarn front-end.
 *
 * The operator set mirrors Yarn Spinner. v1 wires what the authoring examples
 * exercise: `or`/`||`, `and`/`&&`, `not`/`!`, the comparisons (`== != > < >= <=`
 * plus the word forms `eq neq gt lt gte lte is`), unary `-`, binary `+ -`, calls
 * `f(a, b)`, and parentheses. `xor`/`^` and `* / %` are reserved but not yet
 * wired (the IR + evaluator already accept them, so adding them later is purely
 * additive). Word-form operators normalise to their symbol equivalents in the IR
 * (`and` → `&&`, `eq` → `==`, `gt` → `>`, …), so `a and b` and `a && b` parse to
 * the identical tree.
 *
 * An identifier is `[A-Za-z_$]` followed by `[A-Za-z0-9_.$]` repeats — `.` and
 * `$` are included (so `$gold` and `quest.stage` each read as ONE name,
 * Yarn-forward) but `-` is excluded, so `hp-1` is `hp` minus `1` and an item id
 * like `'rusty-key'` must live in a quoted string literal.
 */

import type { BinaryOp, Expr, VarValue } from "./types.js";

/** A string expression failed to parse. Carries the 1-based source position. */
export class DialogueExprError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col: number) {
    super(`${message} (at ${line}:${col})`);
    this.name = "DialogueExprError";
    this.line = line;
    this.col = col;
  }
}

/**
 * Parse a string into an {@link Expr} tree. Throws {@link DialogueExprError}
 * (with line/col) on an empty/blank source, a leftover trailing token, or a
 * dangling operator.
 */
export function parseExpr(src: string): Expr {
  const tokens = tokenize(src);
  return new Parser(tokens).parse();
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

type TokenKind =
  // literals + names
  | "number"
  | "string"
  | "ident"
  | "true"
  | "false"
  | "null"
  // operators (canonical symbol forms; word forms map onto these)
  | "&&"
  | "||"
  | "!"
  | "=="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "+"
  | "-"
  // reserved but unwired in v1 (kept out of the parser → using it errors)
  | "xor"
  // punctuation
  | "("
  | ")"
  | ","
  | "eof";

interface Token {
  readonly kind: TokenKind;
  /** Set for `number` (numeric value), `string`/`ident` (text). */
  readonly value?: VarValue;
  readonly line: number;
  readonly col: number;
}

/** Word-form keywords → the token kind they lex to. A variable literally named
 *  one of these can't be referenced *bare in a string* — use the `{ var, op,
 *  value }` form, `defineScript`, or rename. */
const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  and: "&&",
  or: "||",
  not: "!",
  xor: "xor",
  is: "==",
  eq: "==",
  neq: "!=",
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
  true: "true",
  false: "false",
  null: "null",
};

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_" || c === "$";
const isIdentPart = (c: string): boolean =>
  isIdentStart(c) || isDigit(c) || c === ".";

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < src.length) {
    const c = src[i]!;

    // Whitespace (including newlines, for multi-line YAML block scalars).
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      advance();
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Number: digits with an optional fractional part. A leading `-` is unary
    // minus, not part of the literal.
    if (isDigit(c)) {
      let text = "";
      while (i < src.length && isDigit(src[i]!)) {
        text += src[i];
        advance();
      }
      if (src[i] === "." && isDigit(src[i + 1] ?? "")) {
        text += ".";
        advance();
        while (i < src.length && isDigit(src[i]!)) {
          text += src[i];
          advance();
        }
      }
      tokens.push({ kind: "number", value: Number(text), line: startLine, col: startCol });
      continue;
    }

    // String: single- or double-quoted, with `\` escapes.
    if (c === "'" || c === '"') {
      const quote = c;
      advance(); // opening quote
      let text = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          advance();
          if (i >= src.length) break;
          text += unescape(src[i]!);
        } else {
          text += src[i];
        }
        advance();
      }
      if (src[i] !== quote) {
        throw new DialogueExprError("unterminated string literal", startLine, startCol);
      }
      advance(); // closing quote
      tokens.push({ kind: "string", value: text, line: startLine, col: startCol });
      continue;
    }

    // Identifier / keyword.
    if (isIdentStart(c)) {
      let text = "";
      while (i < src.length && isIdentPart(src[i]!)) {
        text += src[i];
        advance();
      }
      const keyword = KEYWORDS[text];
      if (keyword === undefined) {
        tokens.push({ kind: "ident", value: text, line: startLine, col: startCol });
      } else if (keyword === "true" || keyword === "false" || keyword === "null") {
        // Literal keywords carry a value; the operator keywords are bare.
        const value: VarValue = keyword === "true" ? true : keyword === "false" ? false : null;
        tokens.push({ kind: keyword, value, line: startLine, col: startCol });
      } else {
        tokens.push({ kind: keyword, line: startLine, col: startCol });
      }
      continue;
    }

    // Two-char operators.
    const two = src.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === "==" || two === "!=" || two === ">=" || two === "<=") {
      tokens.push({ kind: two, line: startLine, col: startCol });
      advance(2);
      continue;
    }

    // One-char operators / punctuation.
    if (c === ">" || c === "<" || c === "!" || c === "+" || c === "-" || c === "(" || c === ")" || c === ",") {
      tokens.push({ kind: c, line: startLine, col: startCol });
      advance();
      continue;
    }

    throw new DialogueExprError(`unexpected character "${c}"`, startLine, startCol);
  }

  tokens.push({ kind: "eof", line, col });
  return tokens;
}

function unescape(c: string): string {
  switch (c) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    default:
      return c; // \\ \' \" and any other escaped char → the char itself
  }
}

// ── Parser (precedence climbing) ─────────────────────────────────────────────

/** Left binding power per infix operator. Higher binds tighter. */
const INFIX_BP: Partial<Record<TokenKind, number>> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  ">": 3,
  "<": 3,
  ">=": 3,
  "<=": 3,
  "+": 4,
  "-": 4,
};

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.parseBinary(0);
    const t = this.peek();
    if (t.kind !== "eof") {
      throw new DialogueExprError(`unexpected trailing token "${describe(t)}"`, t.line, t.col);
    }
    return expr;
  }

  private parseBinary(minBp: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const bp = INFIX_BP[t.kind];
      if (bp === undefined || bp < minBp) break;
      this.next();
      const right = this.parseBinary(bp + 1); // left-associative
      // The INFIX_BP guard above admits only symbol kinds that are valid BinaryOps.
      left = { kind: "binary", op: t.kind as BinaryOp, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "!" || t.kind === "-") {
      this.next();
      const operand = this.parseUnary();
      return { kind: "unary", op: t.kind === "!" ? "!" : "-", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    switch (t.kind) {
      case "number":
      case "string":
        this.next();
        return { kind: "literal", value: t.value as VarValue };
      case "true":
      case "false":
      case "null":
        this.next();
        return { kind: "literal", value: t.value as VarValue };
      case "ident": {
        this.next();
        const name = t.value as string;
        if (this.peek().kind === "(") {
          this.next(); // consume "("
          const args = this.parseArgs();
          return { kind: "call", fn: name, args };
        }
        return { kind: "varRef", name };
      }
      case "(": {
        this.next();
        const inner = this.parseBinary(0);
        this.expect(")");
        return { kind: "group", expr: inner };
      }
      default:
        throw new DialogueExprError(`unexpected ${describe(t)}`, t.line, t.col);
    }
  }

  /** Parse a comma-separated argument list; the opening `(` is already consumed. */
  private parseArgs(): Expr[] {
    const args: Expr[] = [];
    if (this.peek().kind === ")") {
      this.next();
      return args;
    }
    for (;;) {
      args.push(this.parseBinary(0));
      const t = this.peek();
      if (t.kind === ",") {
        this.next();
        continue;
      }
      if (t.kind === ")") {
        this.next();
        return args;
      }
      throw new DialogueExprError(`expected "," or ")" in argument list, got ${describe(t)}`, t.line, t.col);
    }
  }

  private expect(kind: TokenKind): void {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new DialogueExprError(`expected "${kind}", got ${describe(t)}`, t.line, t.col);
    }
    this.next();
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    return this.tokens[this.pos++]!;
  }
}

/** A human-readable token label for error messages. */
function describe(t: Token): string {
  if (t.kind === "eof") return "end of input";
  if (t.kind === "ident") return `"${String(t.value)}"`;
  if (t.kind === "string") return `string "${String(t.value)}"`;
  if (t.kind === "number") return `number ${String(t.value)}`;
  return `"${t.kind}"`;
}
