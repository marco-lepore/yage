/**
 * Canonical loader: validates + normalises a hand-authored / JSON
 * {@link DialogueScript} into a frozen, structurally-checked script the runner
 * can trust. Other "common formats" (a Yarn/ink-style screenplay parser) are
 * additional modules in this folder that emit the same canonical shape — the
 * runner only ever sees the canonical model.
 */

import { analyzeScript, DialogueScriptError } from "../validate.js";
import { parseExpr } from "../expr-parse.js";
import type {
  ChoiceOption,
  ChoiceStep,
  Command,
  CommandStep,
  Condition,
  DialogueScript,
  DialogueNode,
  Expr,
  NodeId,
  SayStep,
  Step,
} from "../types.js";

export { DialogueScriptError };

export function loadScript(raw: DialogueScript): DialogueScript {
  if (!raw || typeof raw !== "object") {
    throw new DialogueScriptError("script must be an object");
  }
  if (!raw.id) throw new DialogueScriptError("script.id is required");
  if (!raw.nodes || typeof raw.nodes !== "object") {
    throw new DialogueScriptError(`script "${raw.id}" has no nodes`);
  }

  const nodeIds = Object.keys(raw.nodes);
  if (nodeIds.length === 0) {
    throw new DialogueScriptError(`script "${raw.id}" has no nodes`);
  }
  const start = raw.start ?? nodeIds[0]!;
  if (!raw.nodes[start]) {
    throw new DialogueScriptError(`start node "${start}" not found in "${raw.id}"`);
  }

  // Speakers are resolved by record KEY at runtime but presenters look actors
  // up by `SpeakerDef.id` — a mismatch silently splits nameplate vs actor
  // anchoring, so the two must agree (same rule as node key ↔ node.id).
  for (const [key, speaker] of Object.entries(raw.speakers ?? {})) {
    if (speaker.id !== key) {
      throw new DialogueScriptError(
        `speaker key "${key}" != speaker.id "${speaker.id}"`,
      );
    }
  }

  // Each node's id must match its key; every jump target must resolve.
  for (const [id, node] of Object.entries(raw.nodes)) {
    validateNode(raw, id, node);
  }

  // One pre-walk resolving every string condition and string `set` value to an
  // expression tree, so the frozen IR carries only `Expr`s and the runtime never
  // re-parses. A bare name (`"gate"`) becomes a `varRef` — evaluating identically
  // to the old truthy read — while operator strings (`"hp > 0 and not rude"`)
  // that the old runtime couldn't read now work. Runs on every loader (JSON
  // included). A malformed string throws `DialogueExprError` with its position.
  const resolved = resolveExpressions(raw);

  const script = Object.freeze({ ...resolved, start });
  // Binding-free load-time walk: condition vars, set targets, and {token}s must
  // resolve to declared vars/externals; type-incompatible ops error. Memoized on
  // the frozen script, so the session's play-time re-check is free.
  analyzeScript(script);
  return script;
}

function validateNode(script: DialogueScript, id: string, node: DialogueNode): void {
  if (node.id !== id) {
    throw new DialogueScriptError(`node key "${id}" != node.id "${node.id}"`);
  }
  if (!Array.isArray(node.steps) || node.steps.length === 0) {
    throw new DialogueScriptError(`node "${id}" has no steps`);
  }
  for (const step of node.steps) validateStep(script, id, step);
}

function validateStep(script: DialogueScript, nodeId: string, step: Step): void {
  const targetExists = (t: string | undefined): void => {
    if (t !== undefined && !script.nodes[t]) {
      throw new DialogueScriptError(
        `node "${nodeId}": jump target "${t}" does not exist`,
      );
    }
  };
  // Node typos throw, so speaker typos must too — an unknown speaker would
  // otherwise silently render as a narrator line (and never find its actor).
  const speakerExists = (s: string | undefined): void => {
    if (s !== undefined && !script.speakers?.[s]) {
      throw new DialogueScriptError(
        `node "${nodeId}": speaker "${s}" is not in script.speakers`,
      );
    }
  };
  switch (step.kind) {
    case "say":
      if (typeof step.text !== "string") {
        throw new DialogueScriptError(`node "${nodeId}": say.text must be a string`);
      }
      speakerExists(step.speaker);
      break;
    case "choice":
      if (!Array.isArray(step.options) || step.options.length === 0) {
        throw new DialogueScriptError(`node "${nodeId}": choice has no options`);
      }
      speakerExists(step.speaker);
      for (const opt of step.options) targetExists(opt.target);
      break;
    case "command":
      targetExists(step.target);
      break;
    case "goto":
      // GotoStep types `target` as required, but hand-authored JSON can omit it
      // — and an undefined target silently ends the conversation at jump time.
      if (step.target === undefined) {
        throw new DialogueScriptError(`node "${nodeId}": goto has no target`);
      }
      targetExists(step.target);
      break;
    case "end":
      break;
    default:
      throw new DialogueScriptError(
        `node "${nodeId}": unknown step kind "${(step as { kind: string }).kind}"`,
      );
  }
}

// ── String → Expr pre-walk (unify) ──────────────────────────────────────────
// Each rewrite helper returns a *new* value only when a string was parsed, else
// `undefined` (so the caller keeps the original reference and skips cloning the
// branch). String conditions/`set`-values are the only nodes rewritten; atomic
// `{ var, op, value }`, predicate functions, and already-built `Expr`s pass
// through untouched.

function resolveExpressions(script: DialogueScript): DialogueScript {
  let nodesChanged = false;
  const nodes: Record<NodeId, DialogueNode> = {};
  for (const [id, node] of Object.entries(script.nodes)) {
    let stepsChanged = false;
    const steps = node.steps.map((step) => {
      const next = resolveStep(step);
      if (next !== step) stepsChanged = true;
      return next;
    });
    if (stepsChanged) {
      nodes[id] = { ...node, steps };
      nodesChanged = true;
    } else {
      nodes[id] = node;
    }
  }
  return nodesChanged ? { ...script, nodes } : script;
}

function resolveStep(step: Step): Step {
  switch (step.kind) {
    case "say":
      return resolveSay(step);
    case "choice":
      return resolveChoice(step);
    case "command":
      return resolveCommandStep(step);
    case "goto":
    case "end":
      return step;
  }
}

function resolveSay(step: SayStep): SayStep {
  const commands = rewriteCommands(step.commands);
  return commands ? { ...step, commands } : step;
}

function resolveCommandStep(step: CommandStep): CommandStep {
  const condition = rewriteCondition(step.condition);
  const commands = rewriteCommands(step.commands);
  if (!condition && !commands) return step;
  return {
    ...step,
    ...(condition ? { condition } : {}),
    ...(commands ? { commands } : {}),
  };
}

function resolveChoice(step: ChoiceStep): ChoiceStep {
  let changed = false;
  const options = step.options.map((opt) => {
    const next = rewriteOption(opt);
    if (next) {
      changed = true;
      return next;
    }
    return opt;
  });
  return changed ? { ...step, options } : step;
}

function rewriteOption(opt: ChoiceOption): ChoiceOption | undefined {
  const condition = rewriteCondition(opt.condition);
  const commands = rewriteCommands(opt.commands);
  if (!condition && !commands) return undefined;
  return {
    ...opt,
    ...(condition ? { condition } : {}),
    ...(commands ? { commands } : {}),
  };
}

/** A string condition → its `Expr` tree; anything else → `undefined` (no rewrite). */
function rewriteCondition(condition: Condition | undefined): Expr | undefined {
  return typeof condition === "string" ? parseExpr(condition) : undefined;
}

/** Rewrite each `set` command whose value is a string into its `Expr` tree.
 *  Returns a new array only when at least one command changed. */
function rewriteCommands(
  commands: readonly Command[] | undefined,
): readonly Command[] | undefined {
  if (!commands) return undefined;
  let changed = false;
  const out = commands.map((cmd) => {
    if (cmd.type === "set" && typeof cmd.value === "string") {
      changed = true;
      return { ...cmd, value: parseExpr(cmd.value) };
    }
    return cmd;
  });
  return changed ? out : undefined;
}
