/**
 * @yagejs-addons/virtual-controls — headless entry.
 *
 * Everything here is pixi-free: the model (sticks, buttons, routing,
 * layout), the {@link VirtualControls} component, entity events, the
 * mobile-detection default, and the presenter CONTRACTS. The built-in
 * Graphics presenter lives behind `@yagejs-addons/virtual-controls/presenters`.
 */

export * from "./core/index.js";
export { VirtualControls } from "./VirtualControls.js";
export type { VirtualControlsOptions } from "./VirtualControls.js";
export { prefersTouchControls } from "./detect.js";
export {
  VirtualButtonPressEvent,
  VirtualButtonReleaseEvent,
  VirtualStickEngageEvent,
  VirtualStickReleaseEvent,
} from "./events.js";
export type { ControlsPresenter, ControlView } from "./view.js";
