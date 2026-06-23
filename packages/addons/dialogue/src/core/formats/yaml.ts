/**
 * YAML-literal front-end. A YAML document whose shape mirrors the JSON
 * {@link DialogueScript} is the cheapest authoring tier — `loadYaml(text)`
 * parses it and hands the plain object straight to {@link loadScript}, so the
 * string-condition pre-walk, validation, and the frozen IR are all identical to
 * the JSON path. (A more RPG-friendly compact DSL is a separate front-end.)
 *
 * `yaml` is the addon's only runtime dependency and is imported *here only*, so
 * a consumer who reaches for the JSON / expression path never pulls it in.
 */

import { parse } from "yaml";

import { loadScript, DialogueScriptError } from "./canonical.js";
import type { DialogueScript } from "../types.js";

/**
 * Parse a YAML document into a validated, frozen {@link DialogueScript}.
 * The root must be a mapping (the script object); a null / scalar / array /
 * empty document is rejected with a YAML-specific {@link DialogueScriptError}
 * (an array would otherwise slip past `loadScript`'s `typeof === "object"`
 * guard and fail more confusingly downstream).
 */
export function loadYaml(text: string): DialogueScript {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new DialogueScriptError(
      `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DialogueScriptError(
      `YAML root must be a mapping (the script object), got ${describeRoot(raw, text)}`,
    );
  }
  return loadScript(raw as DialogueScript);
}

function describeRoot(v: unknown, text: string): string {
  // `yaml.parse` collapses an empty / blank document to `null`; distinguish that
  // from an explicit `null` / `~` so the author of an empty file gets a useful
  // message rather than a puzzling "got null".
  if (v === null) return text.trim() === "" ? "an empty document" : "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}
