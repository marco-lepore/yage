import type { Bounds } from "pixi.js";
import type { DisplayContainer, Filter } from "../public-types.js";

interface FilterBoundsEffect {
  filters: readonly Filter[] | null;
  addBounds?: (bounds: Bounds, skipUpdate?: boolean) => void;
}

/**
 * Pixi's filter effect does not contribute its output extent to ancestor
 * bounds. Extend that existing effect rather than tracking a second tree.
 * Only fast filter-input bounds expand; ordinary and local bounds stay unchanged.
 * @internal
 */
export function attachFilterBounds(container: DisplayContainer): () => void {
  // Pixi v8 stores the filter effect here; filters= retains this instance.
  const effect = (container as unknown as { _filterEffect: FilterBoundsEffect })
    ._filterEffect;
  const boundsDescriptor = Object.getOwnPropertyDescriptor(effect, "addBounds");
  const fastDescriptor = Object.getOwnPropertyDescriptor(
    container,
    "getFastGlobalBounds",
  );
  const previousBounds = effect.addBounds;
  const previousFast = container.getFastGlobalBounds;
  let readingOwnInput = false;
  const padding = (): number => {
    let value = 0;
    for (const filter of effect.filters ?? []) {
      if (filter.enabled) value += filter.padding;
    }
    return Math.ceil(value);
  };
  const addBounds = (bounds: Bounds, skipUpdate?: boolean): void => {
    previousBounds?.call(effect, bounds, skipUpdate);
    if (skipUpdate !== true) return;
    const value = padding();
    if (value > 0) bounds.pad(value);
  };
  Object.defineProperty(effect, "addBounds", {
    configurable: true,
    get: () => {
      // Pixi transforms bounds to world space and back whenever a hook exists.
      // An absent hook avoids that expansion when there is no contribution.
      if (readingOwnInput || padding() <= 0) return previousBounds;
      return addBounds;
    },
  });
  container.getFastGlobalBounds = function (factorRenderLayers, bounds) {
    // FilterSystem asks this method for the host's INPUT, then adds its own
    // filter padding. Descendants are visited by Pixi's recursive traversal,
    // so their output extents still contribute through addBounds above.
    const previous = readingOwnInput;
    readingOwnInput = true;
    try {
      return previousFast.call(this, factorRenderLayers, bounds);
    } finally {
      // Restore query state, including when a bounds query throws.
      readingOwnInput = previous;
    }
  };
  return () => {
    if (boundsDescriptor)
      Object.defineProperty(effect, "addBounds", boundsDescriptor);
    else delete effect.addBounds;
    if (fastDescriptor)
      Object.defineProperty(container, "getFastGlobalBounds", fastDescriptor);
    else Reflect.deleteProperty(container, "getFastGlobalBounds");
  };
}
