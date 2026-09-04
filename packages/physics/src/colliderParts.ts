import type { ColliderConfig, ColliderPartConfig } from "./types.js";

/** @internal Return the ordered geometry entries for a collider config. */
export function colliderParts(config: ColliderConfig): ColliderPartConfig[] {
  return "parts" in config ? config.parts : [config];
}

/** @internal Return one geometry entry. The caller validates the index. */
export function colliderPart(
  config: ColliderConfig,
  index: number,
): ColliderPartConfig {
  return colliderParts(config)[index] as ColliderPartConfig;
}

/** @internal Stable key for one directed Rapier collider pair. */
export function colliderPairKey(
  selfHandle: number,
  otherHandle: number,
): string {
  return `${selfHandle}:${otherHandle}`;
}
