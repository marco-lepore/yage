/**
 * Canonical loader: validates + normalises a hand-authored / JSON
 * {@link DialogueScript} into a frozen, structurally-checked script the runner
 * can trust. Other "common formats" (a Yarn/ink-style screenplay parser) are
 * additional modules in this folder that emit the same canonical shape — the
 * runner only ever sees the canonical model.
 */

import type { DialogueScript, DialogueNode, Step } from "../types.js";

export class DialogueScriptError extends Error {}

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

  return Object.freeze({ ...raw, start });
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
