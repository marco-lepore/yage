import { System } from "./System.js";
import { Phase } from "./types.js";
import type { EngineContext } from "./EngineContext.js";
import { QueryCacheKey } from "./EngineContext.js";
import type { QueryResult } from "./QueryCache.js";
import { Transform } from "./Transform.js";
import type { Entity } from "./Entity.js";

/**
 * Propagates parent transforms to children.
 * For root entities, world = local. For children, world is composed from parent's world + child's local.
 * Runs in Render phase at priority -1 (before DisplaySystem at priority 0).
 */
export class TransformPropagationSystem extends System {
  readonly phase = Phase.Render;
  readonly priority = -10;

  private transformQuery!: QueryResult;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.transformQuery = queryCache.register([Transform]);
  }

  update(): void {
    // First pass: set world = local for all root entities
    // Second pass: propagate to children recursively
    for (const entity of this.transformQuery) {
      if (entity.parent) continue; // skip children, handled by recursion
      const transform = entity.get(Transform);
      transform.worldPosition = transform.position;
      transform.worldRotation = transform.rotation;
      transform.worldScale = transform.scale;
      this.propagateToChildren(entity);
    }
  }

  private propagateToChildren(parent: Entity): void {
    const children = parent.children;
    if (children.size === 0) return;

    const parentTransform = parent.get(Transform);

    for (const child of children.values()) {
      const childTransform = child.tryGet(Transform);
      if (!childTransform) continue;

      // World = parent world composed with child local
      const rotatedLocal = childTransform.position
        .multiply(parentTransform.worldScale)
        .rotate(parentTransform.worldRotation);
      childTransform.worldPosition =
        parentTransform.worldPosition.add(rotatedLocal);
      childTransform.worldRotation =
        parentTransform.worldRotation + childTransform.rotation;
      childTransform.worldScale = parentTransform.worldScale.multiply(
        childTransform.scale,
      );

      this.propagateToChildren(child);
    }
  }
}
