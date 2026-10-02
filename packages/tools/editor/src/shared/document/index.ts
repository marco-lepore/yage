import {
  emptyLevelDocument,
  formatLevel,
  readLevel,
} from "@yagejs/level/document";
import type { LevelDocument, StructuralError } from "@yagejs/level/document";
import { parseSequence } from "@yagejs-addons/sequence/document";
import type { SequenceDocument } from "@yagejs-addons/sequence/document";

/** A clip and its authored preview placements; games consume `sequence` alone. */
export interface SequenceWorkspaceDocument extends Omit<
  LevelDocument,
  "format"
> {
  readonly format: "yage-sequence-workspace";
  readonly sequence: SequenceDocument;
  readonly bindings: Readonly<Record<string, string>>;
}
export type EditorDocument = LevelDocument | SequenceWorkspaceDocument;
export type EditorStructuralResult =
  | { readonly ok: true; readonly document: EditorDocument }
  | { readonly ok: false; readonly errors: readonly StructuralError[] };

/** Only preview preparation receives this projection; saves retain the workspace. */
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
  if (record.format !== "yage-sequence-workspace") return readLevel(raw);
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
    }
    return {
      ok: true,
      document: {
        ...level.document,
        format: "yage-sequence-workspace",
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
    format: "yage-sequence-workspace",
    bindings: {},
    sequence: {
      format: "yage-sequence",
      version: 1,
      name: id,
      fps: 60,
      duration: 180,
      frame: { width: 960, height: 540 },
      targets: {},
      tracks: [],
      events: [],
    },
  };
}
