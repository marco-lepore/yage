/**
 * Two-stage validation for the storage model (D4).
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
/** Built-in command types the runner/session handle — exempt from the
 *  "must have a handler" check. */
const BUILTIN_COMMANDS: ReadonlySet<string> = new Set(["set", "expression"]);

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

  const collectExpr = (expr: Expr): void => {
    switch (expr.kind) {
      case "literal":
        return;
      case "varRef":
        readVars.add(expr.name);
        return;
      case "call":
        calledFunctions.add(expr.fn);
        for (const arg of expr.args ?? []) collectExpr(arg);
        return;
      case "group":
        collectExpr(expr.expr);
        return;
      case "unary":
        collectExpr(expr.operand);
        return;
      case "binary":
        collectExpr(expr.left);
        collectExpr(expr.right);
        return;
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
      collectExpr(condition);
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

  const checkCommands = (commands: readonly Command[] | undefined, where: string): void => {
    for (const cmd of commands ?? []) {
      if (cmd.type === "set") {
        const target = cmd["var"];
        if (typeof target !== "string") {
          throw new DialogueScriptError(`${where}: set command has no string "var"`);
        }
        setTargets.add(target);
        const value = cmd["value"];
        if (isExpr(value)) {
          collectExpr(value);
        } else {
          // Literal value: type-check against the target's declared default.
          const declared = declaredTypes.get(target);
          if (
            declared !== undefined &&
            declared !== "null" &&
            value !== null &&
            value !== undefined &&
            typeof value !== declared
          ) {
            throw new DialogueScriptError(
              `${where}: set "${target}" expects ${declared}, got ${typeof value}`,
            );
          }
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

  // 2. Every name the script reads must be provided — declared (it'll be seeded)
  //    or already in storage. A typo dies here.
  for (const name of analysis.readVars) {
    if (!analysis.declaredTypes.has(name) && !env.storage.has(name)) {
      throw new DialoguePlayError(
        `script reads "${name}" but nothing provides it ` +
          `(no declared default, no storage value; for an argument read use a function call)`,
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
