/**
 * Two-stage validation for the storage model.
 *
 *   • **Load-time** ({@link analyzeScript}, environment-free): walk the script
 *     once, collecting the names it **reads** (conditions, `{token}`s, `set`
 *     values), the names it **writes** (`set` targets), the **functions** it
 *     calls, and the **command types** it fires. Type-check what's statically
 *     knowable — an atomic numeric comparison against a declared non-number, a
 *     literal `set` value whose type conflicts with the target's declared
 *     default. Undeclared *references* are NOT rejected here: the installed
 *     storage / functions may provide them, which is only known at play-time.
 *   • **Play-time** ({@link validatePlay}): given the installed storage,
 *     functions, and commands, throw on a *significant* mismatch — a read name
 *     nothing provides, a called function with no implementation, a `set` target
 *     that's a function (read-only), a command type with no handler/fallback, a
 *     declared default whose type conflicts with the value the storage already
 *     holds.
 *
 * Both throw hard — a dangling reference or an environment that can't satisfy the
 * script is a programming error, not a recoverable runtime condition.
 */

import { isExpr } from "./expr.js";
import { tokensIn } from "./i18n.js";
import type {
  BinaryOp,
  ChoiceStep,
  Command,
  CommandStep,
  Condition,
  DialogueFunction,
  DialogueScript,
  Expr,
  SayStep,
  VariableStorage,
  VarValue,
} from "./types.js";

/** A script reference is broken (load-time). */
export class DialogueScriptError extends Error {}
/** The installed storage/functions/commands don't satisfy the script (play-time). */
export class DialoguePlayError extends Error {}

/** Inferred type of a declared default; `"null"` (a `null` default) is untyped —
 *  type checks are skipped for it. */
type ValueType = "string" | "number" | "boolean" | "null";

const NUMERIC_OPS: ReadonlySet<string> = new Set([">", ">=", "<", "<="]);
/** Binary ops (symbol + word forms) whose operands must be numbers. `+` is
 *  handled separately — it also accepts strings (concatenation). */
const NUMERIC_EXPR_OPS: ReadonlySet<string> = new Set([
  ">", "<", ">=", "<=", "gt", "lt", "gte", "lte", "-", "*", "/", "%",
]);
/** Built-in command types the runner handles — exempt from the "must have a
 *  handler" check. Only `set` (runner-owned flow op); every other command type,
 *  including a face change, needs a handler. (A mid-line face change is the
 *  `[expression=…/]` reveal marker, not a command.) */
const BUILTIN_COMMANDS: ReadonlySet<string> = new Set(["set"]);

/** What a binary operator requires of a literal operand, for the load-time type
 *  walk. `null` = no constraint (equality / logical ops accept any type). */
function operandRequirement(op: BinaryOp): "number" | "numberOrString" | null {
  if (op === "+") return "numberOrString"; // string concat OR numeric add
  return NUMERIC_EXPR_OPS.has(op) ? "number" : null;
}

export interface ScriptAnalysis {
  /** Declared default types, keyed by name (drives seed-if-absent + typing). */
  readonly declaredTypes: ReadonlyMap<string, ValueType>;
  /** Names the script reads (conditions, tokens, `set` values, call args). */
  readonly readVars: ReadonlySet<string>;
  /** Names the script writes via `set` (need not be pre-provided — locals). */
  readonly setTargets: ReadonlySet<string>;
  /** Functions the script calls (`{ kind: "call" }`). */
  readonly calledFunctions: ReadonlySet<string>;
  /** Non-built-in command `type`s the script fires (for handler coverage). */
  readonly commandTypes: ReadonlySet<string>;
}

const analysisCache = new WeakMap<DialogueScript, ScriptAnalysis>();

/** Walk + type-check a script once (memoized on the frozen script object). */
export function analyzeScript(script: DialogueScript): ScriptAnalysis {
  const cached = analysisCache.get(script);
  if (cached) return cached;
  const analysis = computeAnalysis(script);
  analysisCache.set(script, analysis);
  return analysis;
}

function computeAnalysis(script: DialogueScript): ScriptAnalysis {
  const declaredTypes = new Map<string, ValueType>();
  for (const [name, value] of Object.entries(script.declare ?? {})) {
    declaredTypes.set(name, valueType(value));
  }

  const readVars = new Set<string>();
  const setTargets = new Set<string>();
  const calledFunctions = new Set<string>();
  const commandTypes = new Set<string>();

  // `where` is threaded so a wrong-type operand reports the same context the
  // atomic `{ var, op, value }` check uses.
  const collectExpr = (expr: Expr, where: string): void => {
    switch (expr.kind) {
      case "literal":
        return;
      case "varRef":
        readVars.add(expr.name);
        return;
      case "call":
        calledFunctions.add(expr.fn);
        for (const arg of expr.args ?? []) collectExpr(arg, where);
        return;
      case "group":
        collectExpr(expr.expr, where);
        return;
      case "unary":
        collectExpr(expr.operand, where);
        return;
      case "binary":
        collectExpr(expr.left, where);
        collectExpr(expr.right, where);
        checkBinaryOperands(expr, where);
        return;
    }
  };

  // Minimal parity with the atomic `{ var, op, value }` check, but on the tree:
  // a numeric/arithmetic operator with a literal operand of the wrong type, or
  // against a declared non-number var, is a script bug. Nothing deeper — no
  // single-type inference; the parser stays purely syntactic.
  const checkBinaryOperands = (
    expr: Extract<Expr, { kind: "binary" }>,
    where: string,
  ): void => {
    const req = operandRequirement(expr.op);
    if (!req) return;
    const expected = req === "numberOrString" ? "a number or string" : "a number";
    for (const operand of [expr.left, expr.right]) {
      if (operand.kind === "literal") {
        const t = valueType(operand.value);
        if (t === "number" || (req === "numberOrString" && t === "string")) continue;
        throw new DialogueScriptError(
          `${where}: operator "${expr.op}" expects ${expected}, got ${t}`,
        );
      }
      if (operand.kind === "varRef" && req === "number") {
        const t = declaredTypes.get(operand.name);
        if (t !== undefined && t !== "number" && t !== "null") {
          throw new DialogueScriptError(
            `${where}: operator "${expr.op}" needs a number; "${operand.name}" is ${t}`,
          );
        }
      }
    }
  };

  const checkTokens = (text: string | undefined): void => {
    if (!text) return;
    for (const token of tokensIn(text)) readVars.add(token);
  };

  const checkCondition = (condition: Condition | undefined, where: string): void => {
    if (condition === undefined || typeof condition === "function") return;
    if (typeof condition === "string") {
      readVars.add(condition);
      return;
    }
    if (isExpr(condition)) {
      collectExpr(condition, where);
      return;
    }
    // Atomic { var, op, value } — collect the operand and type-check numeric ops.
    readVars.add(condition.var);
    if (NUMERIC_OPS.has(condition.op)) {
      const t = declaredTypes.get(condition.var);
      if (t !== undefined && t !== "number" && t !== "null") {
        throw new DialogueScriptError(
          `${where}: operator "${condition.op}" needs a number; "${condition.var}" is ${t}`,
        );
      }
      if (typeof condition.value !== "number") {
        throw new DialogueScriptError(
          `${where}: operator "${condition.op}" compares against a number, ` +
            `got ${typeof condition.value}`,
        );
      }
    }
  };

  // A literal `set` value must match its target's declared default type (e.g.
  // `set gold = "lots"` against a numeric `gold`). `null` clears; an undeclared
  // target is a local with no type to clash against.
  const checkSetLiteralType = (target: string, value: unknown, where: string): void => {
    const declared = declaredTypes.get(target);
    if (
      declared !== undefined &&
      declared !== "null" &&
      value !== null &&
      typeof value !== declared
    ) {
      throw new DialogueScriptError(
        `${where}: set "${target}" expects ${declared}, got ${typeof value}`,
      );
    }
  };

  const checkCommands = (commands: readonly Command[] | undefined, where: string): void => {
    for (const cmd of commands ?? []) {
      if (cmd.type === "set") {
        const target = cmd["var"];
        if (typeof target !== "string") {
          throw new DialogueScriptError(`${where}: set command has no string "var"`);
        }
        setTargets.add(target);
        const value = cmd["value"];
        // A `set` with no `value` is malformed — it would write `undefined`,
        // poisoning the name (`has` true, `get` undefined) and defeating
        // seed-if-absent on the next play. Die here. (`value: null` is allowed —
        // an intentional clear.)
        if (value === undefined) {
          throw new DialogueScriptError(`${where}: set "${target}" has no value`);
        }
        if (isExpr(value)) {
          collectExpr(value, where);
          // A bare literal RHS (incl. a quoted-string literal from the pre-walk,
          // e.g. `set gold = "'lots'"`) is type-checked against the target like a
          // raw literal would be.
          if (value.kind === "literal") checkSetLiteralType(target, value.value, where);
        } else {
          // Raw literal value (number/boolean/null — strings were pre-walked to
          // an Expr): type-check against the target's declared default.
          checkSetLiteralType(target, value, where);
        }
        continue;
      }
      if (!BUILTIN_COMMANDS.has(cmd.type)) commandTypes.add(cmd.type);
    }
  };

  for (const speaker of Object.values(script.speakers ?? {})) {
    checkTokens(speaker.name);
  }

  for (const node of Object.values(script.nodes)) {
    const where = `node "${node.id}"`;
    for (const step of node.steps) {
      switch (step.kind) {
        case "say": {
          const s = step as SayStep;
          checkTokens(s.text);
          checkCommands(s.commands, `${where} say`);
          break;
        }
        case "choice": {
          const c = step as ChoiceStep;
          checkTokens(c.text);
          for (const opt of c.options) {
            checkTokens(opt.text);
            checkTokens(opt.disabledReason);
            checkCondition(opt.condition, `${where} choice option "${opt.text}"`);
            checkCommands(opt.commands, `${where} choice option "${opt.text}"`);
          }
          break;
        }
        case "command": {
          const cs = step as CommandStep;
          checkCommands(cs.commands, `${where} command`);
          checkCondition(cs.condition, `${where} command`);
          break;
        }
        default:
          break; // goto / end carry no references
      }
    }
  }

  return { declaredTypes, readVars, setTargets, calledFunctions, commandTypes };
}

/** The environment a `play()` installs, as far as validation cares. */
export interface PlayEnv {
  readonly storage: VariableStorage;
  readonly functions: Readonly<Record<string, DialogueFunction>>;
  readonly commands: Readonly<Record<string, unknown>>;
  readonly fallbackCommand: unknown;
}

/**
 * Play-time: the installed environment must satisfy the analyzed script. Runs
 * **before** seed-if-absent, so the declared-default/storage conflict check sees
 * the host-provided value (not the seed we're about to write).
 */
export function validatePlay(analysis: ScriptAnalysis, env: PlayEnv): void {
  // 1. A declared default must not conflict with a value the storage already
  //    holds (the game-linked value wins, but a type clash is a script bug).
  for (const [name, type] of analysis.declaredTypes) {
    if (type === "null" || !env.storage.has(name)) continue;
    const current = env.storage.get(name);
    if (current !== undefined && current !== null && typeof current !== type) {
      throw new DialoguePlayError(
        `declared default for "${name}" is ${type} but storage already holds ${typeof current}`,
      );
    }
  }

  // 2. Every name the script reads must be provided — declared (it'll be seeded),
  //    already in storage, OR written by a `set` somewhere in the script (a local
  //    the script manages itself). The walk is flow-insensitive, so it can't (and
  //    needn't) reason about read-before-write order: a read of an as-yet-
  //    unset local is a script logic bug, not a missing binding — at runtime it
  //    reads null. A typo (a name that is read but never declared/stored/written)
  //    still dies here.
  for (const name of analysis.readVars) {
    if (
      !analysis.declaredTypes.has(name) &&
      !env.storage.has(name) &&
      !analysis.setTargets.has(name)
    ) {
      throw new DialoguePlayError(
        `script reads "${name}" but nothing provides it ` +
          `(no declared default, no storage value, no \`set\`; for an argument read use a function call)`,
      );
    }
  }

  // 3. Every function the script calls must be installed.
  for (const fn of analysis.calledFunctions) {
    if (!Object.hasOwn(env.functions, fn)) {
      throw new DialoguePlayError(
        `script calls function "${fn}" but no such function is installed`,
      );
    }
  }

  // 4. A `set` target must not be a function name (functions are read-only).
  for (const target of analysis.setTargets) {
    if (Object.hasOwn(env.functions, target)) {
      throw new DialoguePlayError(
        `set target "${target}" is a function (read-only); functions cannot be assigned`,
      );
    }
  }

  // 5. Every non-built-in command type must resolve to a handler or the fallback.
  if (env.fallbackCommand === undefined) {
    const unhandled = [...analysis.commandTypes].filter((t) => !Object.hasOwn(env.commands, t));
    if (unhandled.length > 0) {
      throw new DialoguePlayError(
        `no handler for command type(s): ${unhandled.join(", ")} ` +
          `(add to commands, or set fallbackCommand)`,
      );
    }
  }
}

function valueType(value: VarValue): ValueType {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}
