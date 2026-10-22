import {
  emptyLevelDocument,
  formatLevel,
  readLevel,
} from "@yagejs/level/document";
import type { LevelDocument, StructuralError } from "@yagejs/level/document";
import {
  parseSequence,
  SEQUENCE_WORKSPACE_FORMAT,
} from "@yagejs-addons/sequence/document";
import type {
  SequenceContract,
  SequenceDocument,
} from "@yagejs-addons/sequence/document";
import { PREVIEWED_PROPERTIES } from "../sequence/defaults.js";

/** A clip and its authored preview placements; games consume `sequence` alone. */
export interface SequenceWorkspaceDocument extends Omit<
  LevelDocument,
  "format"
> {
  readonly format: typeof SEQUENCE_WORKSPACE_FORMAT;
  readonly sequence: SequenceDocument;
  readonly bindings: Readonly<Record<string, string>>;
}
export type EditorDocument = LevelDocument | SequenceWorkspaceDocument;
export type EditorStructuralResult =
  | { readonly ok: true; readonly document: EditorDocument }
  | { readonly ok: false; readonly errors: readonly StructuralError[] };

/**
 * The workspace's placements as a level document, for previewing and
 * validating them. Saving writes the whole workspace.
 */
export function previewLevel(document: EditorDocument): LevelDocument {
  if (document.format === "yage-level") return document;
  const placements = { ...document };
  Reflect.deleteProperty(placements, "sequence");
  Reflect.deleteProperty(placements, "bindings");
  return { ...placements, format: "yage-level" };
}

export function readEditorDocument(input: unknown): EditorStructuralResult {
  let raw: unknown = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, errors: [{ path: "", message: "Invalid JSON" }] };
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return readLevel(raw);
  const record = raw as Record<string, unknown>;
  if (record.format !== SEQUENCE_WORKSPACE_FORMAT) return readLevel(raw);
  const { sequence, bindings, ...fields } = record;
  const level = readLevel({ ...fields, format: "yage-level" });
  if (!level.ok) return level;
  try {
    const clip = parseSequence(sequence);
    if (
      typeof bindings !== "object" ||
      bindings === null ||
      Array.isArray(bindings)
    )
      throw new Error("bindings must map slots to placement IDs");
    const entries = Object.entries(bindings);
    const used = new Set<string>();
    for (const [slot, id] of entries) {
      if (!Object.hasOwn(clip.targets, slot))
        throw new Error(`Unknown actor slot ${slot}`);
      if (typeof id !== "string" || !id)
        throw new Error(`Invalid preview binding ${slot}`);
      if (used.has(id))
        throw new Error(`Preview placement ${id} is bound more than once`);
      used.add(id);
      checkPreviewedKinds(slot, clip.targets[slot]!);
    }
    return {
      ok: true,
      document: {
        ...level.document,
        format: SEQUENCE_WORKSPACE_FORMAT,
        sequence: clip,
        bindings: Object.fromEntries(entries) as Readonly<
          Record<string, string>
        >,
      },
    };
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          path: "sequence",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

/**
 * The preview writes a bound actor's previewed properties as the sequence
 * addon's transform and visual targets do, and those targets refuse a property
 * declared with another kind. The workspace refuses it the same way, naming
 * the property.
 */
function checkPreviewedKinds(slot: string, contract: SequenceContract): void {
  for (const [name, definition] of Object.entries(contract.properties)) {
    const previewed = Object.hasOwn(PREVIEWED_PROPERTIES, name)
      ? PREVIEWED_PROPERTIES[name]!
      : undefined;
    if (previewed && previewed.kind !== definition.kind)
      throw new Error(
        `${slot}.${name} is declared as ${definition.kind}, but the ` +
          `transform and visual targets provide it as ${previewed.kind}`,
      );
  }
}

export function formatEditorDocument(document: EditorDocument): string {
  const checked = readEditorDocument(document);
  if (!checked.ok)
    throw new Error(
      checked.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    );
  if (document.format === "yage-level") return formatLevel(document);
  const level = JSON.parse(formatLevel(previewLevel(document))) as Record<
    string,
    unknown
  >;
  return (
    JSON.stringify(
      {
        ...level,
        format: document.format,
        sequence: canonical(document.sequence),
        bindings: canonical(document.bindings),
      },
      null,
      2,
    ) + "\n"
  );
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function emptySequenceWorkspace(id: string): SequenceWorkspaceDocument {
  return {
    ...emptyLevelDocument(id),
    format: SEQUENCE_WORKSPACE_FORMAT,
    bindings: {},
    sequence: {
      format: "yage-sequence",
      version: 1,
      name: id,
      fps: 60,
      duration: 180,
      size: { width: 960, height: 540 },
      targets: {},
      tracks: [],
      events: [],
    },
  };
}
