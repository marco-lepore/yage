import {
  sequenceWriteOrder,
  type OrderedSequenceProperty,
} from "./core/writeOrder.js";
import { Transform } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import type { Point } from "./core/types.js";
import { sequenceProperty } from "./core/SequencePlayer.js";
import type { SequenceTarget } from "./core/SequencePlayer.js";

/** World position and local rotation/scale. Placement offset is in world pixels. */
export function transformSequenceTarget(
  entity: Entity,
  placementOffset: Point = { x: 0, y: 0 },
): SequenceTarget {
  const handle = entity.handle();
  const transform = entity.get(Transform);
  const offset = { ...placementOffset };
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
    throw new Error("transformSequenceTarget: placement offset must be finite");
  const position: OrderedSequenceProperty = {
    ...sequenceProperty(
      { kind: "position" },
      () => ({
        x: transform.worldPosition.x + offset.x,
        y: transform.worldPosition.y + offset.y,
      }),
      (p) => transform.setWorldPosition(p.x - offset.x, p.y - offset.y),
    ),
    [sequenceWriteOrder]: () => {
      let depth = 1;
      for (let parent = entity.parent; parent; parent = parent.parent) depth++;
      return depth;
    },
  };
  return {
    isAlive: () =>
      handle.current !== undefined && entity.tryGet(Transform) === transform,
    properties: {
      position,
      rotation: sequenceProperty(
        { kind: "number" },
        () => transform.rotation,
        (value) => {
          transform.rotation = value;
        },
      ),
      scale: sequenceProperty(
        { kind: "vector" },
        () => ({ ...transform.scale }),
        (value) => transform.setScale(value.x, value.y),
      ),
    },
    events: {},
  };
}
/** Combine disjoint capabilities without silently replacing a property or event. */
export function combineSequenceTargets(
  ...targets: readonly SequenceTarget[]
): SequenceTarget {
  const properties: Record<string, SequenceTarget["properties"][string]> = {};
  const events: Record<string, SequenceTarget["events"][string]> = {};
  for (const target of targets) {
    for (const [key, value] of Object.entries(target.properties)) {
      if (Object.hasOwn(properties, key))
        throw new Error(`combineSequenceTargets: duplicate property ${key}`);
      Object.defineProperty(properties, key, { value, enumerable: true });
    }
    for (const [key, value] of Object.entries(target.events)) {
      if (Object.hasOwn(events, key))
        throw new Error(`combineSequenceTargets: duplicate event ${key}`);
      Object.defineProperty(events, key, { value, enumerable: true });
    }
  }
  return {
    properties,
    events,
    isAlive: () => targets.every((t) => t.isAlive?.() ?? true),
  };
}
