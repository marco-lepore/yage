import type { Entity } from "./Entity.js";

/**
 * A reusable entity template. Blueprints define how to assemble
 * an entity from components, given optional parameters.
 */
export interface Blueprint<P = void> {
  readonly name: string;
  build(entity: Entity, params: P): void;
}

/** Create a blueprint from a name and a build function. */
export function defineBlueprint<P = void>(
  name: string,
  build: (entity: Entity, params: P) => void,
): Blueprint<P> {
  return { name, build };
}
