import { updateRenderGroupTransforms } from "pixi.js";
import type { DisplayContainer } from "./public-types.js";

/** Refresh the same transforms and sibling order Pixi uses for pointer events. */
export function synchronizeInteraction(stage: DisplayContainer): void {
  stage.enableRenderGroup();
  const prepare = (container: DisplayContainer): void => {
    if (container.sortableChildren) container.sortChildren();
    if (container.renderGroup) {
      // Pending view changes need validation before Pixi updates render batches.
      // Defer those groups to the next draw; transform-only changes can update
      // existing batches without rebuilding them.
      if (container.renderGroup.childrenRenderablesToUpdate.index > 0) {
        container.renderGroup.structureDidChange = true;
      }
      container.renderGroup.invalidateMatrices();
    }
    for (const child of container.children) prepare(child);
  };
  prepare(stage);
  stage.updateLocalTransform();
  updateRenderGroupTransforms(stage.renderGroup!, true);
}
