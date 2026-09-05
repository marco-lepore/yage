import { isDocumentCommand } from "../commands/index.js";
import type {
  DraftCommandRequest,
  DraftSaveRequest,
  LevelCreateRequest,
  LevelDeleteRequest,
  LevelDuplicateRequest,
  RevisionedRequest,
} from "./types.js";

/**
 * Request bodies are parsed here, before an operation reaches a level's queue.
 *
 * The queue compares revisions and applies commands; it never asks whether the
 * value it was handed is the shape its type claims. Everything that crosses the
 * wire is checked in full — not only the fields the server state happens to
 * read — so a field added on one side and missing on the other fails at the
 * boundary instead of halfway through a transition.
 */
export function parseCommandRequest(
  body: unknown,
): DraftCommandRequest | undefined {
  if (!isObject(body)) return undefined;
  if (!hasOnlyKeys(body, ["epoch", "expectedDraftRevision", "command"])) {
    return undefined;
  }
  const epoch: unknown = body["epoch"];
  const expectedDraftRevision: unknown = body["expectedDraftRevision"];
  const command: unknown = body["command"];
  if (!isText(epoch)) return undefined;
  if (!isRevision(expectedDraftRevision)) return undefined;
  if (!isDocumentCommand(command)) return undefined;
  return { epoch, expectedDraftRevision, command };
}

/** The body undo and redo share: which boot, and which revision to apply to. */
export function parseRevisionedRequest(
  body: unknown,
): RevisionedRequest | undefined {
  if (!isObject(body)) return undefined;
  if (!hasOnlyKeys(body, ["epoch", "expectedDraftRevision"])) return undefined;
  const epoch: unknown = body["epoch"];
  const expectedDraftRevision: unknown = body["expectedDraftRevision"];
  if (!isText(epoch)) return undefined;
  if (!isRevision(expectedDraftRevision)) return undefined;
  return { epoch, expectedDraftRevision };
}

export function parseSaveRequest(body: unknown): DraftSaveRequest | undefined {
  if (!isObject(body)) return undefined;
  const keys = ["epoch", "expectedDraftRevision", "expectedDiskRevision"];
  if (!hasOnlyKeys(body, keys)) return undefined;
  const epoch: unknown = body["epoch"];
  const expectedDraftRevision: unknown = body["expectedDraftRevision"];
  const expectedDiskRevision: unknown = body["expectedDiskRevision"];
  if (!isText(epoch)) return undefined;
  if (!isRevision(expectedDraftRevision)) return undefined;
  if (typeof expectedDiskRevision !== "string") return undefined;
  return { epoch, expectedDraftRevision, expectedDiskRevision };
}

export function parseLevelCreateRequest(
  body: unknown,
): LevelCreateRequest | undefined {
  if (!isObject(body)) return undefined;
  if (!hasOnlyKeys(body, ["epoch", "levelId"])) return undefined;
  const epoch: unknown = body["epoch"];
  const levelId: unknown = body["levelId"];
  if (!isText(epoch) || !isText(levelId)) return undefined;
  return { epoch, levelId };
}

export function parseLevelDuplicateRequest(
  body: unknown,
): LevelDuplicateRequest | undefined {
  if (!isObject(body)) return undefined;
  if (!hasOnlyKeys(body, ["epoch", "levelId", "sourcePath"])) return undefined;
  const epoch: unknown = body["epoch"];
  const levelId: unknown = body["levelId"];
  const sourcePath: unknown = body["sourcePath"];
  if (!isText(epoch) || !isText(levelId) || !isText(sourcePath)) {
    return undefined;
  }
  return { epoch, levelId, sourcePath };
}

export function parseLevelDeleteRequest(
  body: unknown,
): LevelDeleteRequest | undefined {
  if (!isObject(body)) return undefined;
  if (!hasOnlyKeys(body, ["epoch"])) return undefined;
  const epoch: unknown = body["epoch"];
  if (!isText(epoch)) return undefined;
  return { epoch };
}

/** A string the wire carries as an identity: present, and not empty. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * A draft revision from the wire. Non-integers and negatives are refused
 * rather than compared: `1.5` and `-1` never equal a real revision, but they
 * would travel into a snapshot response and out to another tab.
 */
export function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
