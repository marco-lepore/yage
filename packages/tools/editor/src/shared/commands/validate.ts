import type { LevelPoint, LevelTransform } from "@yagejs/level/document";
import type {
  DocumentCommand,
  MovePlacementState,
  PlacementInsert,
  PlacementMove,
  PoseEdit,
  ValueEdit,
} from "./types.js";
import { isValueEditPath } from "./valuePath.js";

/**
 * Whether a value parsed from JSON is a command this package understands.
 *
 * Two callers need it: the HTTP middleware, before a request enters a level's
 * queue, and — once drafts survive a restart — the recovery loader, before it
 * replays a command log written by an older build. Both read data they did not
 * construct, so neither may take the type on trust.
 *
 * It checks shape, not document validity: a pose whose scale is zero is a
 * well-formed command, and the draft service rejects it after applying, where
 * the document layer owns that rule. An added placement is checked the same
 * way — the two fields the reducer itself reads, `id` and `parent`, are checked
 * here so a malformed one is reported as a bad command; everything else about a
 * placement is the level format's rule, and the queue applies it to the
 * document the command produces.
 */
export function isDocumentCommand(value: unknown): value is DocumentCommand {
  if (!isObject(value)) return false;
  if (!isNonEmptyString(value["commandId"])) return false;
  switch (value["kind"]) {
    case "set-poses": {
      if (!hasOnlyKeys(value, ["kind", "commandId", "poses"])) return false;
      const poses: unknown = value["poses"];
      return Array.isArray(poses) && poses.every(isPoseEdit);
    }
    case "add-placements": {
      if (!hasOnlyKeys(value, ["kind", "commandId", "inserts"])) return false;
      const inserts: unknown = value["inserts"];
      return Array.isArray(inserts) && inserts.every(isPlacementInsert);
    }
    case "remove-placements": {
      if (!hasOnlyKeys(value, ["kind", "commandId", "ids"])) return false;
      const ids: unknown = value["ids"];
      return Array.isArray(ids) && ids.every(isNonEmptyString);
    }
    case "set-values": {
      if (!hasOnlyKeys(value, ["kind", "commandId", "edits"])) return false;
      const edits: unknown = value["edits"];
      return Array.isArray(edits) && edits.every(isValueEdit);
    }
    case "move-placements": {
      if (!hasOnlyKeys(value, ["kind", "commandId", "moves"])) return false;
      const moves: unknown = value["moves"];
      return Array.isArray(moves) && moves.every(isPlacementMove);
    }
    default:
      return false;
  }
}

function isPoseEdit(value: unknown): value is PoseEdit {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["id", "transform"]) &&
    isNonEmptyString(value["id"]) &&
    isTransform(value["transform"])
  );
}

function isPlacementMove(value: unknown): value is PlacementMove {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["id", "from", "to"]) &&
    isNonEmptyString(value["id"]) &&
    isMovePlacementState(value["from"]) &&
    isMovePlacementState(value["to"])
  );
}

function isPlacementInsert(value: unknown): value is PlacementInsert {
  if (!isObject(value)) return false;
  if (!hasOnlyKeys(value, ["placement", "index"])) return false;
  const index: unknown = value["index"];
  if (!Number.isSafeInteger(index) || (index as number) < 0) return false;
  const placement: unknown = value["placement"];
  if (!isObject(placement)) return false;
  if (!isNonEmptyString(placement["id"])) return false;
  const parent: unknown = placement["parent"];
  return parent === undefined || isNonEmptyString(parent);
}

function isValueEdit(value: unknown): value is ValueEdit {
  if (!isObject(value)) return false;
  if (!hasOnlyKeys(value, ["placementId", "path", "expected", "value"])) {
    return false;
  }
  const path: unknown = value["path"];
  return (
    isNonEmptyString(value["placementId"]) &&
    Array.isArray(path) &&
    path.every((segment) => typeof segment === "string") &&
    isValueEditPath(path) &&
    isJsonValue(value["expected"]) &&
    isJsonValue(value["value"])
  );
}

function isMovePlacementState(value: unknown): value is MovePlacementState {
  if (!isObject(value)) return false;
  if (!hasOnlyKeys(value, ["parent", "transform", "index"])) return false;
  const parent: unknown = value["parent"];
  const index: unknown = value["index"];
  return (
    (parent === undefined || isNonEmptyString(parent)) &&
    isTransform(value["transform"]) &&
    Number.isSafeInteger(index) &&
    (index as number) >= 0
  );
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function isTransform(value: unknown): value is LevelTransform {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["position", "rotation", "scale"]) &&
    isPoint(value["position"]) &&
    isFiniteNumber(value["rotation"]) &&
    isPoint(value["scale"])
  );
}

function isPoint(value: unknown): value is LevelPoint {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["x", "y"]) &&
    isFiniteNumber(value["x"]) &&
    isFiniteNumber(value["y"])
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Own enumerable keys only, and no key the shape does not name. An extra field
 * means the two sides disagree about what a command is, which is worth a
 * rejection rather than a silent partial read.
 */
function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
