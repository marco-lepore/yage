import type {
  JsonValue,
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { CommandPreconditionError } from "./types.js";
import type {
  DocumentCommand,
  MovePlacementState,
  PlacementInsert,
  PlacementMove,
  PoseEdit,
  PreviewImpact,
  ReduceResult,
  ValueEdit,
} from "./types.js";
import { derivedSceneKey } from "./sceneKey.js";
import { isOptionalFieldPath, isValueEditPath } from "./valuePath.js";

/**
 * Apply one command to a level document.
 *
 * Pure: no clock, no randomness, no I/O, and the same input always produces the
 * same output on both sides of the wire. The result shares every placement the
 * command did not touch with the input, which is safe because a level document
 * is an immutable value — nothing in the editor writes through one.
 *
 * Preconditions are structural only. Whether `type` names an entity that exists
 * is a catalog question, and the server has no catalog.
 */
export function reduceCommand(
  document: LevelDocument,
  command: DocumentCommand,
): ReduceResult {
  switch (command.kind) {
    case "set-poses":
      return setPoses(document, command);
    case "add-placements":
      return addPlacements(document, command);
    case "remove-placements":
      return removePlacements(document, command);
    case "set-values":
      return setValues(document, command);
    case "move-placements":
      return movePlacements(document, command);
  }
}

function setPoses(
  document: LevelDocument,
  command: Extract<DocumentCommand, { kind: "set-poses" }>,
): ReduceResult {
  const poses = new Map<string, PoseEdit>();
  for (const pose of command.poses) {
    if (poses.has(pose.id)) {
      reject(
        command,
        `Placement "${pose.id}" appears twice in one set-poses command.`,
      );
    }
    poses.set(pose.id, pose);
  }

  const before = byId(document.entities);
  const restored: PoseEdit[] = [];
  for (const id of poses.keys()) {
    const placement = before.get(id);
    if (!placement) {
      reject(command, `No placement "${id}" in level "${document.id}".`);
    }
    restored.push({ id, transform: placement.transform });
  }

  const entities = document.entities.map((placement) => {
    const pose = poses.get(placement.id);
    return pose ? { ...placement, transform: pose.transform } : placement;
  });

  return {
    document: { ...document, entities },
    inverse: {
      kind: "set-poses",
      commandId: command.commandId,
      poses: restored,
    },
    affected: [...poses.keys()],
    impact: "pose",
  };
}

function addPlacements(
  document: LevelDocument,
  command: Extract<DocumentCommand, { kind: "add-placements" }>,
): ReduceResult {
  const existing = byId(document.entities);
  const adding = new Set<string>();
  for (const insert of command.inserts) {
    const id = insert.placement.id;
    if (adding.has(id)) {
      reject(command, `Placement "${id}" is added twice by one command.`);
    }
    if (existing.has(id)) {
      reject(
        command,
        `Placement "${id}" is already in level "${document.id}".`,
      );
    }
    adding.add(id);
  }

  // Ascending, so each index names a position in the document this command
  // produces. Sorting here rather than requiring it of the caller keeps the
  // result the same whatever order the inserts arrive in.
  const inserts = [...command.inserts].sort((a, b) => a.index - b.index);
  const entities = [...document.entities];
  let previous: number | undefined;
  for (const insert of inserts) {
    const { index } = insert;
    if (index === previous) {
      reject(command, `Two placements are added at index ${index}.`);
    }
    if (!Number.isInteger(index) || index < 0 || index > entities.length) {
      reject(
        command,
        `Index ${index} is outside 0 to ${entities.length} for placement ` +
          `"${insert.placement.id}".`,
      );
    }
    entities.splice(index, 0, insert.placement);
    previous = index;
  }

  const result = byId(entities);
  for (const insert of inserts) {
    checkAncestry(command, insert.placement, result, entities.length);
  }
  checkSceneKeys(command, entities);

  const ids = inserts.map((insert) => insert.placement.id);
  return {
    document: { ...document, entities },
    inverse: {
      kind: "remove-placements",
      commandId: command.commandId,
      ids,
    },
    affected: ids,
    impact: "rebuild",
  };
}

function removePlacements(
  document: LevelDocument,
  command: Extract<DocumentCommand, { kind: "remove-placements" }>,
): ReduceResult {
  const removed = new Set<string>();
  for (const id of command.ids) {
    if (removed.has(id)) {
      reject(command, `Placement "${id}" is removed twice by one command.`);
    }
    removed.add(id);
  }

  const restored: PlacementInsert[] = [];
  const entities: LevelPlacement[] = [];
  for (const [index, placement] of document.entities.entries()) {
    if (removed.has(placement.id)) restored.push({ placement, index });
    else entities.push(placement);
  }

  if (restored.length !== removed.size) {
    const present = new Set(restored.map((entry) => entry.placement.id));
    const missing = [...removed].find((id) => !present.has(id));
    reject(command, `No placement "${missing}" in level "${document.id}".`);
  }

  // A removal names its whole authored subtree. Without this check the result
  // holds a placement whose parent is gone, which the level format rejects —
  // so the developer would be told the document is broken rather than which
  // placement the delete left behind.
  for (const placement of entities) {
    if (placement.parent !== undefined && removed.has(placement.parent)) {
      reject(
        command,
        `Removing "${placement.parent}" would leave "${placement.id}" ` +
          `without its parent.`,
      );
    }
  }

  return {
    document: { ...document, entities },
    inverse: {
      kind: "add-placements",
      commandId: command.commandId,
      inserts: restored,
    },
    affected: [...removed],
    impact: "rebuild",
  };
}

function setValues(
  document: LevelDocument,
  command: Extract<DocumentCommand, { kind: "set-values" }>,
): ReduceResult {
  checkValuePaths(command);

  const placements = byId(document.entities);
  const inverseEdits: ValueEdit[] = [];
  for (const edit of command.edits) {
    const placement = placements.get(edit.placementId);
    if (!placement) {
      reject(
        command,
        `No placement "${edit.placementId}" in level "${document.id}".`,
      );
    }

    const own = readOwnPath(placement, edit.path);
    if (own === missingPath && !isOptionalFieldPath(edit.path)) {
      reject(
        command,
        `Placement "${edit.placementId}" has a missing path ${formatPath(edit.path)}.`,
      );
    }
    // A field the format lets a document leave out reads as `null` when it is
    // not there, so the precondition and the inverse below both work over one
    // value whether the placement carries the field or not.
    const prior: JsonValue = own === missingPath ? null : own;
    if (!equalJson(prior, edit.expected)) {
      reject(
        command,
        `Placement "${edit.placementId}" does not have the expected value at ` +
          `${formatPath(edit.path)}.`,
      );
    }
    inverseEdits.push({
      placementId: edit.placementId,
      path: edit.path,
      expected: edit.value,
      value: prior,
    });
  }

  const updated = new Map<string, LevelPlacement>();
  for (const edit of command.edits) {
    const placement =
      updated.get(edit.placementId) ?? placements.get(edit.placementId);
    if (!placement) {
      // The first pass proves this branch unreachable while keeping the type
      // local to the immutable update below.
      reject(
        command,
        `No placement "${edit.placementId}" in level "${document.id}".`,
      );
    }
    updated.set(
      edit.placementId,
      isOptionalFieldPath(edit.path) && edit.value === null
        ? withoutOwnField(placement, edit.path[0] as string)
        : writeOwnPath(placement, edit.path, edit.value),
    );
  }

  const entities = document.entities.map(
    (placement) => updated.get(placement.id) ?? placement,
  );
  checkSceneKeys(command, entities);

  const affected = distinct(command.edits.map((edit) => edit.placementId));
  return {
    document: { ...document, entities },
    inverse: {
      kind: "set-values",
      commandId: command.commandId,
      edits: inverseEdits,
    },
    affected,
    // `name` is the one placement field nothing below the document reads, so
    // labelling a placement leaves the preview's scene as it is. Everything
    // else a value edit writes — a parameter, the type version, the key a
    // runtime entity is created under — changes what the scene is made of.
    impact: command.edits.every(isNameEdit)
      ? ("document-only" satisfies PreviewImpact)
      : "rebuild",
  };
}

function isNameEdit(edit: ValueEdit): boolean {
  return edit.path.length === 1 && edit.path[0] === "name";
}

/**
 * Refuse a command whose result would make two placements derive one scene
 * key. `readLevel` refuses such a document, so without this the browser
 * applies the edit, the queue's structural check throws it out, and the
 * developer sees "your document is broken" for an edit the editor offered.
 *
 * It scans the whole result rather than only what the command touched: a
 * document reaching either side came through `readLevel`, so a collision in it
 * can only be one this command introduced.
 */
function checkSceneKeys(
  command: DocumentCommand,
  entities: readonly LevelPlacement[],
): void {
  const seen = new Map<string, string>();
  for (const placement of entities) {
    const derived = derivedSceneKey(placement);
    const first = seen.get(derived);
    if (first !== undefined) {
      reject(
        command,
        `Placement "${placement.id}" would derive the same scene key ` +
          `"${derived}" as placement "${first}".`,
      );
    }
    seen.set(derived, placement.id);
  }
}

function movePlacements(
  document: LevelDocument,
  command: Extract<DocumentCommand, { kind: "move-placements" }>,
): ReduceResult {
  const placements = byId(document.entities);
  const moving = new Set<string>();
  const landing = new Set<number>();
  for (const move of command.moves) {
    if (moving.has(move.id)) {
      reject(command, `Placement "${move.id}" is moved twice by one command.`);
    }
    moving.add(move.id);
    // Two placements declaring one destination index would leave the second
    // pushing the first along, so neither would end up where the command says
    // and the inverse would address the wrong rows.
    if (landing.has(move.to.index)) {
      reject(
        command,
        `Two placements are moved to index ${String(move.to.index)}.`,
      );
    }
    landing.add(move.to.index);
    checkMoveSource(document, command, move);
    checkMoveDestination(command, move, document.entities.length);
    checkMoveParent(command, move, placements, document.entities.length);
  }

  // Every move comes out before any goes back in, so a destination index means
  // a position in the document this produces rather than one in a list that is
  // still being taken apart.
  const moved = new Map(
    command.moves.map((move) => {
      const placement = placements.get(move.id);
      if (!placement) {
        reject(command, `No placement "${move.id}" in level "${document.id}".`);
      }
      return [move.id, withMoveState(placement, move.to)];
    }),
  );
  const entities = document.entities.filter(
    (placement) => !moving.has(placement.id),
  );
  for (const move of [...command.moves].sort(
    (left, right) => left.to.index - right.to.index,
  )) {
    const placement = moved.get(move.id);
    if (placement) entities.splice(move.to.index, 0, placement);
  }

  checkNoCycle(command, entities);

  return {
    document: { ...document, entities },
    inverse: {
      kind: "move-placements",
      commandId: command.commandId,
      moves: command.moves.map((move) => ({
        id: move.id,
        from: move.to,
        to: move.from,
      })),
    },
    affected: command.moves.map((move) => move.id),
    impact: "rebuild",
  };
}

/** The placement is where the command says it is, as it says it is. */
function checkMoveSource(
  document: LevelDocument,
  command: Extract<DocumentCommand, { kind: "move-placements" }>,
  move: PlacementMove,
): void {
  const index = document.entities.findIndex(
    (placement) => placement.id === move.id,
  );
  if (index < 0) {
    reject(command, `No placement "${move.id}" in level "${document.id}".`);
  }
  const placement = document.entities[index] as LevelPlacement;
  if (index !== move.from.index) {
    reject(
      command,
      `Placement "${move.id}" is not at source index ${String(move.from.index)}.`,
    );
  }
  if (placement.parent !== move.from.parent) {
    reject(command, `Placement "${move.id}" has a different source parent.`);
  }
  if (!equalTransform(placement.transform, move.from.transform)) {
    reject(command, `Placement "${move.id}" has a different source transform.`);
  }
}

function checkMoveDestination(
  command: Extract<DocumentCommand, { kind: "move-placements" }>,
  move: PlacementMove,
  length: number,
): void {
  const lastIndex = length - 1;
  if (
    !Number.isInteger(move.to.index) ||
    move.to.index < 0 ||
    move.to.index > lastIndex
  ) {
    reject(
      command,
      `Destination index ${String(move.to.index)} is outside 0 to ` +
        `${String(lastIndex)} for placement "${move.id}".`,
    );
  }
}

/**
 * No placement ends up inside itself.
 *
 * The per-move check reads the document as it was, which is enough for one
 * move and not for several: two placements each moved under the other pass it
 * separately and produce a ring that no walk of the result can leave. This
 * reads the result, so it catches that and anything like it.
 */
function checkNoCycle(
  command: Extract<DocumentCommand, { kind: "move-placements" }>,
  entities: readonly LevelPlacement[],
): void {
  const parents = new Map(
    entities.map((placement) => [placement.id, placement.parent]),
  );
  for (const placement of entities) {
    const seen = new Set<string>([placement.id]);
    let current = placement.parent;
    while (current !== undefined) {
      if (seen.has(current)) {
        reject(command, `Placement "${placement.id}" would be inside itself.`);
      }
      seen.add(current);
      current = parents.get(current);
    }
  }
}

function checkValuePaths(
  command: Extract<DocumentCommand, { kind: "set-values" }>,
): void {
  for (const [index, edit] of command.edits.entries()) {
    if (!isValueEditPath(edit.path)) {
      reject(
        command,
        `Placement "${edit.placementId}" has an unsupported value path ` +
          `${formatPath(edit.path)}.`,
      );
    }
    for (let earlier = 0; earlier < index; earlier += 1) {
      const prior = command.edits[earlier] as ValueEdit;
      if (prior.placementId !== edit.placementId) continue;
      if (!pathsOverlap(prior.path, edit.path)) continue;
      const relation =
        prior.path.length === edit.path.length ? "duplicate" : "overlapping";
      reject(
        command,
        `Placement "${edit.placementId}" has ${relation} value paths ` +
          `${formatPath(prior.path)} and ${formatPath(edit.path)}.`,
      );
    }
  }
}

function pathsOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const missingPath = Symbol("missing path");

function readOwnPath(
  placement: LevelPlacement,
  path: readonly string[],
): JsonValue | typeof missingPath {
  let current: unknown = placement;
  for (const segment of path) {
    if (!isContainer(current) || !Object.hasOwn(current, segment)) {
      return missingPath;
    }
    current = current[segment];
  }
  return current as JsonValue;
}

function writeOwnPath(
  placement: LevelPlacement,
  path: readonly string[],
  value: JsonValue,
): LevelPlacement {
  return writeOwn(placement, path, 0, value) as LevelPlacement;
}

/** The placement without one own top-level field. */
function withoutOwnField(
  placement: LevelPlacement,
  field: string,
): LevelPlacement {
  const copy = cloneContainer(placement);
  Reflect.deleteProperty(copy, field);
  return copy as unknown as LevelPlacement;
}

function writeOwn(
  current: object,
  path: readonly string[],
  index: number,
  value: JsonValue,
): object {
  const copy = cloneContainer(current);
  const segment = path[index] as string;
  if (index === path.length - 1) {
    defineOwn(copy, segment, value);
    return copy;
  }

  const child = current[segment as keyof typeof current] as unknown;
  defineOwn(copy, segment, writeOwn(child as object, path, index + 1, value));
  return copy;
}

function cloneContainer(value: object): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return [...value];
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    defineOwn(copy, key, value[key as keyof typeof value]);
  }
  return copy;
}

function defineOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * Whether two authored values are the same value: key by key and item by
 * item, so an object edit whose value equals what is held is recognised as
 * writing nothing.
 */
export function equalJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index] as JsonValue))
    );
  }
  if (!isContainer(left) || !isContainer(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        equalJson(left[key] as JsonValue, right[key] as JsonValue),
    )
  );
}

function checkMoveParent(
  command: Extract<DocumentCommand, { kind: "move-placements" }>,
  move: PlacementMove,
  placements: ReadonlyMap<string, LevelPlacement>,
  bound: number,
): void {
  const parentId = move.to.parent;
  if (parentId === undefined) return;
  if (parentId === move.id) {
    reject(command, `Placement "${move.id}" cannot be its own parent.`);
  }

  let current = placements.get(parentId);
  if (!current) {
    reject(command, `Destination parent "${parentId}" is not in the level.`);
  }
  for (let step = 0; step <= bound; step += 1) {
    if (current.id === move.id) {
      reject(
        command,
        `Placement "${parentId}" is a descendant of "${move.id}".`,
      );
    }
    if (current.parent === undefined) return;
    const next = placements.get(current.parent);
    if (!next) {
      reject(
        command,
        `Destination parent ancestry names unknown placement "${current.parent}".`,
      );
    }
    current = next;
  }
  reject(command, `Destination parent "${parentId}" has cyclic ancestry.`);
}

function withMoveState(
  placement: LevelPlacement,
  state: MovePlacementState,
): LevelPlacement {
  const copy = cloneContainer(placement);
  defineOwn(copy, "transform", state.transform);
  if (state.parent === undefined) Reflect.deleteProperty(copy, "parent");
  else defineOwn(copy, "parent", state.parent);
  return copy as unknown as LevelPlacement;
}

function equalTransform(left: LevelTransform, right: LevelTransform): boolean {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.rotation === right.rotation &&
    left.scale.x === right.scale.x &&
    left.scale.y === right.scale.y
  );
}

function isContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function formatPath(path: readonly string[]): string {
  return JSON.stringify(path);
}

/**
 * Walk a new placement's parents to the root.
 *
 * Only added placements need it: an existing one already reached a root in the
 * document this command applied to, and nothing already in that document can
 * name a new id. A missing parent or a cycle is therefore always something
 * this command created.
 */
function checkAncestry(
  command: DocumentCommand,
  placement: LevelPlacement,
  result: ReadonlyMap<string, LevelPlacement>,
  bound: number,
): void {
  let current = placement;
  for (let step = 0; step <= bound; step += 1) {
    const parent = current.parent;
    if (parent === undefined) return;
    const next = result.get(parent);
    if (!next) {
      reject(
        command,
        `Placement "${current.id}" names a parent "${parent}" that is not there.`,
      );
    }
    current = next;
  }
  reject(command, `Placement "${placement.id}" is its own ancestor.`);
}

function reject(command: DocumentCommand, message: string): never {
  throw new CommandPreconditionError(command.commandId, message);
}

function byId(
  placements: readonly LevelPlacement[],
): ReadonlyMap<string, LevelPlacement> {
  return new Map(placements.map((placement) => [placement.id, placement]));
}
