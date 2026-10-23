import type {
  LevelPlacement,
  LevelPoint,
  LevelTransform,
} from "@yagejs/level/document";
import type { EditorDocument } from "./index.js";
/** The composed world rotation and scale of a placement's parent chain. */
export interface ParentFrame {
  readonly rotation: number;
  readonly scale: LevelPoint;
}

const IDENTITY: ParentFrame = { rotation: 0, scale: { x: 1, y: 1 } };

/** The transform a placement with no parent is relative to. */
export const WORLD_ORIGIN: LevelTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
};

/**
 * What the engine's `Transform` composes onto a child, derived from the
 * document instead of from live entities: rotations add and scales multiply
 * up the parent chain (`packages/core/src/Transform.ts:167`). The editor has
 * to compute it the same way, or a dragged child lands somewhere other than
 * where the pointer left it.
 */
export function parentFrame(
  document: EditorDocument,
  placementId: string,
): ParentFrame {
  const parentId = new Map(document.entities.map((p) => [p.id, p])).get(
    placementId,
  )?.parent;
  const world = parentWorld(document, parentId);
  return world.rotation === 0 && world.scale.x === 1 && world.scale.y === 1
    ? IDENTITY
    : { rotation: world.rotation, scale: world.scale };
}

/**
 * The world transform of the placement a child would be relative to: the
 * composed chain above `parentId`, or the origin when there is no parent.
 *
 * A parent the document does not hold, or a chain that loops, is treated as
 * the point the walk stopped at; the document layer refuses both, so neither
 * reaches a document the store holds.
 */
export function parentWorld(
  document: EditorDocument,
  parentId: string | undefined,
): LevelTransform {
  const byId = new Map(document.entities.map((p) => [p.id, p]));
  // Root first, so each level composes onto the world above it.
  const chain: LevelTransform[] = [];
  const seen = new Set<string>();
  let current = parentId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    chain.unshift(parent.transform);
    current = parent.parent;
  }
  let world = WORLD_ORIGIN;
  for (const local of chain) world = toWorld(local, world);
  return world;
}

/**
 * A local transform expressed in world space, given the world transform of
 * what it is relative to. Mirrors `Transform._recompute`: scale the local
 * position by the parent's world scale, rotate it by the parent's world
 * rotation, add the parent's world position; rotations add; scales multiply.
 */
export function toWorld(
  local: LevelTransform,
  parent: LevelTransform,
): LevelTransform {
  const scaled = {
    x: local.position.x * parent.scale.x,
    y: local.position.y * parent.scale.y,
  };
  const rotated = rotate(scaled, parent.rotation);
  return {
    position: {
      x: parent.position.x + rotated.x,
      y: parent.position.y + rotated.y,
    },
    rotation: parent.rotation + local.rotation,
    scale: {
      x: parent.scale.x * local.scale.x,
      y: parent.scale.y * local.scale.y,
    },
  };
}

/**
 * A world transform expressed relative to a parent's world transform — the
 * inverse of {@link toWorld}, and what `Transform`'s world setters do.
 *
 * A parent scaled to zero on an axis flattens everything under it onto its own
 * origin, so no world position or scale on that axis names one local value:
 * every local value produces the same world one. `keep` is the transform whose
 * components the answer takes there — the pose the caller already had, so a
 * placement under a flattened parent keeps the numbers it was authored with
 * instead of gaining an infinity the file cannot hold.
 */
export function toLocal(
  world: LevelTransform,
  parent: LevelTransform,
  keep: LevelTransform,
): LevelTransform {
  const offset = {
    x: world.position.x - parent.position.x,
    y: world.position.y - parent.position.y,
  };
  const rotated = rotate(offset, -parent.rotation);
  return {
    position: {
      x: parent.scale.x === 0 ? keep.position.x : rotated.x / parent.scale.x,
      y: parent.scale.y === 0 ? keep.position.y : rotated.y / parent.scale.y,
    },
    rotation: world.rotation - parent.rotation,
    scale: {
      x: parent.scale.x === 0 ? keep.scale.x : world.scale.x / parent.scale.x,
      y: parent.scale.y === 0 ? keep.scale.y : world.scale.y / parent.scale.y,
    },
  };
}

/** A placement's own world transform, composed from the document. */
export function placementWorld(
  document: EditorDocument,
  placement: LevelPlacement,
): LevelTransform {
  return toWorld(placement.transform, parentWorld(document, placement.parent));
}

/**
 * A point in a frame's own space, expressed in world space — {@link toWorld}
 * for a bare point, which has no rotation or scale of its own to compose.
 */
export function pointToWorld(
  local: LevelPoint,
  frame: LevelTransform,
): LevelPoint {
  const rotated = rotate(
    { x: local.x * frame.scale.x, y: local.y * frame.scale.y },
    frame.rotation,
  );
  return {
    x: frame.position.x + rotated.x,
    y: frame.position.y + rotated.y,
  };
}

export function rotate(point: LevelPoint, radians: number): LevelPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}
