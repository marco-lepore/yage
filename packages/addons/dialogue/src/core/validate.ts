/**
 * Two-stage validation for the binding model.
 *
 *   • **Load-time** ({@link analyzeScript}, binding-free): walk every condition
 *     `var`, `set` target, and default-locale `{token}` — each must resolve to
 *     a declared `vars` ∪ `external` name; `set` targets must be ∈ `vars`;
 *     type-incompatible ops error (`>` on a boolean, etc.). Typos die before the
 *     first `play()`. Also collects the non-built-in command `type`s the script
 *     uses, for the play-time handler check.
 *   • **Play-time** ({@link validateBinding}): the host's binding must cover
 *     every declared external, with `typeof`-correct values/getter results, and
 *     resolve every command `type` to a handler (or the fallback).
 *
 * Both throw hard — a script with a dangling reference or a binding that doesn't
 * match it is a programming error, not a recoverable runtime condition.
 */

import { tokensIn } from "./i18n.js";
import type {
  ChoiceStep,
  Command,
  CommandStep,
  Condition,
  DialogueScript,
  ExternalTypeName,
  SayStep,
  VarValue,
} from "./types.js";

/** A script reference is broken (load-time). */
export class DialogueScriptError extends Error {}
/** A host binding doesn't match the script it's played against (play-time). */
export class DialogueBindingError extends Error {}

/** Inferred value type; `"null"` marks a var whose default is `null` (untyped —
 *  type checks are skipped for it). */
type ValueType = ExternalTypeName | "null";

const NUMERIC_OPS: ReadonlySet<string> = new Set([">", ">=", "<", "<="]);
/** Built-in command types the runner/session handle — exempt from the
 *  "must have a handler" binding check. */
const BUILTIN_COMMANDS: ReadonlySet<string> = new Set(["set", "expression"]);

export interface ScriptAnalysis {
  readonly varNames: ReadonlySet<string>;
  readonly externalNames: ReadonlySet<string>;
  readonly varTypes: ReadonlyMap<string, ValueType>;
  readonly externalTypes: ReadonlyMap<string, ExternalTypeName>;
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
  const varTypes = new Map<string, ValueType>();
  for (const [name, value] of Object.entries(script.vars ?? {})) {
    varTypes.set(name, valueType(value));
  }
  const externalTypes = new Map<string, ExternalTypeName>();
  for (const [name, type] of Object.entries(script.external ?? {})) {
    if (type !== "string" && type !== "number" && type !== "boolean") {
      throw new DialogueScriptError(
        `script "${script.id}": external "${name}" has invalid type "${String(type)}" ` +
          `(expected "string" | "number" | "boolean")`,
      );
    }
    if (varTypes.has(name)) {
      throw new DialogueScriptError(
        `script "${script.id}": "${name}" is declared as both a var and an external`,
      );
    }
    externalTypes.set(name, type);
  }

  const varNames = new Set(varTypes.keys());
  const externalNames = new Set(externalTypes.keys());
  const commandTypes = new Set<string>();

  const typeOf = (name: string): ValueType | undefined =>
    varTypes.get(name) ?? externalTypes.get(name);

  const requireName = (name: string, where: string): void => {
    if (!varNames.has(name) && !externalNames.has(name)) {
      throw new DialogueScriptError(
        `${where}: "${name}" is not a declared var or external`,
      );
    }
  };

  const checkTokens = (text: string | undefined, where: string): void => {
    if (!text) return;
    for (const token of tokensIn(text)) requireName(token, `${where} {${token}}`);
  };

  const checkCondition = (condition: Condition | undefined, where: string): void => {
    if (condition === undefined || typeof condition === "function") return;
    if (typeof condition === "string") {
      requireName(condition, where);
      return;
    }
    requireName(condition.var, where);
    if (NUMERIC_OPS.has(condition.op)) {
      const t = typeOf(condition.var);
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

  const checkCommands = (
    commands: readonly Command[] | undefined,
    where: string,
  ): void => {
    for (const cmd of commands ?? []) {
      if (cmd.type === "set") {
        const target = cmd["var"];
        if (typeof target !== "string") {
          throw new DialogueScriptError(`${where}: set command has no string "var"`);
        }
        if (externalNames.has(target)) {
          throw new DialogueScriptError(
            `${where}: set target "${target}" is an external (read-only); ` +
              `mutate game state via a command`,
          );
        }
        if (!varNames.has(target)) {
          throw new DialogueScriptError(
            `${where}: set target "${target}" is not a declared var`,
          );
        }
        const declared = varTypes.get(target);
        const value = cmd["value"];
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
        continue;
      }
      if (!BUILTIN_COMMANDS.has(cmd.type)) commandTypes.add(cmd.type);
    }
  };

  for (const speaker of Object.values(script.speakers ?? {})) {
    checkTokens(speaker.name, `script "${script.id}" speaker "${speaker.id}" name`);
  }

  for (const node of Object.values(script.nodes)) {
    const where = `node "${node.id}"`;
    for (const step of node.steps) {
      switch (step.kind) {
        case "say": {
          const s = step as SayStep;
          checkTokens(s.text, `${where} say`);
          checkCommands(s.commands, `${where} say`);
          break;
        }
        case "choice": {
          const c = step as ChoiceStep;
          checkTokens(c.text, `${where} choice prompt`);
          for (const opt of c.options) {
            checkTokens(opt.text, `${where} choice option`);
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

  return { varNames, externalNames, varTypes, externalTypes, commandTypes };
}

/** Play-time: the merged binding must satisfy the analyzed script. */
export function validateBinding(
  analysis: ScriptAnalysis,
  binding: { readonly state?: Readonly<Record<string, unknown>> | undefined } & {
    readonly commands?: Readonly<Record<string, unknown>> | undefined;
    readonly fallbackCommand?: unknown;
  },
): void {
  const state = binding.state ?? {};

  for (const [name, entry] of Object.entries(state)) {
    const isExternal = analysis.externalNames.has(name);
    const isVar = analysis.varNames.has(name);
    if (!isExternal && !isVar) {
      throw new DialogueBindingError(
        `binding provides unknown name "${name}" (not in script.vars or script.external)`,
      );
    }
    if (isVar) {
      if (typeof entry === "function") {
        throw new DialogueBindingError(
          `binding for dialogue var "${name}" must be a constant, not a getter ` +
            `(getters are for externals)`,
        );
      }
      checkBoundType(name, entry as VarValue, analysis.varTypes.get(name), "var");
    } else {
      const value = typeof entry === "function" ? (entry as () => VarValue)() : entry;
      checkBoundType(name, value as VarValue, analysis.externalTypes.get(name), "external");
    }
  }

  const missing = [...analysis.externalNames].filter((n) => !Object.hasOwn(state, n));
  if (missing.length > 0) {
    throw new DialogueBindingError(
      `binding is missing required external(s): ${missing.join(", ")}`,
    );
  }

  if (binding.fallbackCommand === undefined) {
    const commands = binding.commands ?? {};
    const unhandled = [...analysis.commandTypes].filter(
      (t) => !Object.hasOwn(commands, t),
    );
    if (unhandled.length > 0) {
      throw new DialogueBindingError(
        `binding has no handler for command type(s): ${unhandled.join(", ")} ` +
          `(add to commands, or set fallbackCommand)`,
      );
    }
  }
}

function checkBoundType(
  name: string,
  value: VarValue,
  declared: ValueType | undefined,
  kind: "var" | "external",
): void {
  // Unknown var type (default null) accepts anything; `null` clears/absents.
  if (declared === undefined || declared === "null" || value === null) return;
  if (typeof value !== declared) {
    throw new DialogueBindingError(
      `${kind} "${name}" must be ${declared}, got ${typeof value}`,
    );
  }
}

function valueType(value: VarValue): ValueType {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}
