export { PlacementLayout } from "./core/PlacementLayout.js";
export { PlacementSession } from "./core/PlacementSession.js";
export type {
  PlacementAimOptions,
  PlacementInspection,
} from "./core/PlacementSession.js";
export type * from "./core/types.js";
export {
  PlacementController,
  PlacementCommittedEvent,
  PlacementRejectedEvent,
} from "./PlacementController.js";
export type {
  PlacementControllerOptions,
  PlacementPreviewChannel,
  PlacementCatalogChannel,
  PlacementInputBinding,
} from "./PlacementController.js";

export { PlacementPointerInput, placementControls } from "./input.js";

export type {
  PlacementPointerInputOptions,
  PlacementPointerProjection,
} from "./input.js";
