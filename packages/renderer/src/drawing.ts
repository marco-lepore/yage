import { updateRenderGroupTransforms } from "pixi.js";
import type { DisplayContainer } from "./public-types.js";

/** Refresh the same transforms and sibling order Pixi uses for pointer events. */
export function synchronizeInteraction(stage: DisplayContainer): void {
  stage.enableRenderGroup();
  const prepare = (container: DisplayContainer): void => {
    if (container.sortableChildren) container.sortChildren();
    if (container.renderGroup) {
      // Pixi's transform pass also updates existing render batches unless the
      // group needs rebuilding. Leave that work for the next real draw, which
      // validates changed graphics, textures and text before rebuilding them.
      container.renderGroup.structureDidChange = true;
      container.renderGroup.invalidateMatrices();
    }
    for (const child of container.children) prepare(child);
  };
  prepare(stage);
  stage.updateLocalTransform();
  updateRenderGroupTransforms(stage.renderGroup!, true);
}
