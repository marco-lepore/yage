/**
 * Expression evaluator (D5). `Condition`s and `set` values are expression
 * *trees* — `literal | varRef | call | unary | binary | group` — evaluated
 * against an {@link EvalScope} (variable reads + installed functions). The
 * operator set mirrors Yarn Spinner so a future Yarn parser maps onto this IR
 * 1:1; the old atomic `{ var, op, value }` comparison still works as the
 * degenerate one-level tree.
 */

import { materialize } from "./vars.js";
import type {
  CompareOp,
  Condition,
  DialogueFunction,
  Expr,
  VariableStorage,
  VarMap,
  VarValue,
} from "./types.js";

/** What an expression evaluates against: per-name reads + function calls, plus
 *  a materialized snapshot for the `(vars) => boolean` predicate escape hatch. */
export interface EvalScope {
  /** Read a variable (absent → `null`). */
  get(name: string): VarValue;
  /** Invoke an installed function with already-evaluated args. */
  call(fn: string, args: readonly VarValue[]): VarValue;
  /** Materialize the readable variables (for a predicate condition). */
  vars(): VarMap;
}

/** Build an {@link EvalScope} over a storage + the installed functions. */
export function createScope(
  storage: VariableStorage,
  functions: Readonly<Record<string, DialogueFunction>>,
): EvalScope {
  return {
    get: (name) => storage.get(name) ?? null,
    call: (fn, args) => {
      const f = functions[fn];
      // play-time validation guarantees a function exists; guard anyway so a
      // hand-built runner fails loudly instead of throwing an opaque TypeError.
      if (!f) throw new Error(`dialogue: no function "${fn}" is installed`);
      return f(...args);
    },
    vars: () => materialize(storage),
  };
}

/** A condition holds when its value is truthy. */
export function evalCondition(condition: Condition, scope: EvalScope): boolean {
  if (typeof condition === "function") return condition(scope.vars());
  if (typeof condition === "string") return truthy(scope.get(condition));
  if (isExpr(condition)) return truthy(evaluate(condition, scope));
  // Atomic { var, op, value } — the degenerate comparison tree.
  return compareAtomic(scope.get(condition.var), condition.op, condition.value);
}

/** Evaluate an expression tree to a single value. */
export function evaluate(expr: Expr, scope: EvalScope): VarValue {
  switch (expr.kind) {
    case "literal":
      return expr.value;
    case "varRef":
      return scope.get(expr.name);
    case "group":
      return evaluate(expr.expr, scope);
    case "call":
      return scope.call(
        expr.fn,
        (expr.args ?? []).map((a) => evaluate(a, scope)),
      );
    case "unary":
      return applyUnary(expr.op, evaluate(expr.operand, scope));
    case "binary": {
      // Short-circuit `and`/`or` (Yarn-faithful) via JS &&/|| so a guarded right
      // operand isn't evaluated when the left already decides — e.g.
      // `has_item("key") and count("key") > 0` won't call `count` (which may
      // throw) when the item is absent. `xor` and the rest need both operands.
      const { op } = expr;
      if (op === "and" || op === "&&") {
        return truthy(evaluate(expr.left, scope)) && truthy(evaluate(expr.right, scope));
      }
      if (op === "or" || op === "||") {
        return truthy(evaluate(expr.left, scope)) || truthy(evaluate(expr.right, scope));
      }
      return applyBinary(op, evaluate(expr.left, scope), evaluate(expr.right, scope));
    }
  }
}

/** True for an {@link Expr} node (discriminated by `kind`), so `Condition` can
 *  tell a tree apart from the atomic `{ var, op, value }` shape. */
export function isExpr(value: unknown): value is Expr {
  return typeof value === "object" && value !== null && "kind" in value;
}

/** JS truthiness: `null` / `false` / `0` / `""` are false. */
export function truthy(value: VarValue): boolean {
  return Boolean(value);
}

function applyUnary(op: "not" | "!" | "-", v: VarValue): VarValue {
  switch (op) {
    case "not":
    case "!":
      return !truthy(v);
    case "-":
      return -num(v);
  }
}

function applyBinary(op: string, l: VarValue, r: VarValue): VarValue {
  switch (op) {
    case "==":
    case "eq":
    case "is":
      return l === r;
    case "!=":
    case "neq":
      return l !== r;
    case ">":
    case "gt":
      return num(l) > num(r);
    case "<":
    case "lt":
      return num(l) < num(r);
    case ">=":
    case "gte":
      return num(l) >= num(r);
    case "<=":
    case "lte":
      return num(l) <= num(r);
    // `and`/`or` (and `&&`/`||`) are short-circuited in evaluate() and never
    // reach here; `xor` needs both operands, so it stays.
    case "xor":
    case "^":
      return truthy(l) !== truthy(r);
    case "+":
      // String concat when either side is a string; numeric otherwise.
      return typeof l === "string" || typeof r === "string"
        ? `${str(l)}${str(r)}`
        : num(l) + num(r);
    case "-":
      return num(l) - num(r);
    case "*":
      return num(l) * num(r);
    case "/":
      return num(l) / num(r);
    case "%":
      return num(l) % num(r);
    default:
      throw new Error(`dialogue: unknown binary operator "${op}"`);
  }
}

/** Evaluate the atomic `{ var, op, value }` comparison. */
function compareAtomic(left: VarValue, op: CompareOp, right: unknown): boolean {
  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return num(left) > num(right);
    case ">=":
      return num(left) >= num(right);
    case "<":
      return num(left) < num(right);
    case "<=":
      return num(left) <= num(right);
    case "truthy":
      return truthy(left);
    case "falsy":
      return !truthy(left);
  }
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function str(v: VarValue): string {
  return v === null ? "" : String(v);
}
