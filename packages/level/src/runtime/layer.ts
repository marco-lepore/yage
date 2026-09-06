import type { Component, Entity } from "@yagejs/core";

/**
 * What a renderer visual exposes so a level can move it onto the layer a
 * placement named.
 *
 * It is duck-typed rather than imported: `@yagejs/level` depends on
 * `@yagejs/core` alone, and a render layer is the renderer's concept. A game
 * with no renderer installed has no component that answers this shape, so an
 * authored layer is silently nothing there — the same outcome as a document
 * that never named one. `RenderFacetContributor` reads `inspectRender()` off a
 * component the same way, for the same reason.
 */
interface LayeredComponent {
  readonly layerName: string;
  setLayer(name: string): void;
}

/** The layer a visual sits on when its own type did not choose one. */
const DEFAULT_LAYER = "default";

/**
 * Put the entity's visuals on the layer the placement named.
 *
 * Only the visuals still on the default layer move. A type that put a health
 * bar on `"ui"` in its own `setup()` made a decision about that visual, and a
 * level saying where the character draws is not an instruction to move the
 * bar with it.
 */
export function applyPlacementLayer(entity: Entity, layer: string): void {
  for (const component of entity.getAll()) {
    const layered = asLayered(component);
    if (layered?.layerName === DEFAULT_LAYER) layered.setLayer(layer);
  }
}

function asLayered(component: Component): LayeredComponent | undefined {
  const candidate = component as Partial<LayeredComponent>;
  return typeof candidate.layerName === "string" &&
    typeof candidate.setLayer === "function"
    ? (candidate as LayeredComponent)
    : undefined;
}
