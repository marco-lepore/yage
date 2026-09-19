// Types & keys
export {
  Anchor,
  isTextureBackground,
  UI_DEFAULT_LAYER,
  UI_DEFAULT_LAYER_ORDER,
} from "./types.js";
export type {
  AlignItems,
  FlexDirection,
  JustifyContent,
  Padding,
  BackgroundOptions,
  ColorBackground,
  TextureBackground,
  UISurfaceOptions,
  UIPositioning,
  UIElement,
  UIContainerElement,
  LayoutProps,
  LayoutValue,
  PositionValue,
  ConsumeInputProps,
  PointerEventProps,
  UITextProps,
  UITextBuilderProps,
  UISplitTextProps,
  UIButtonProps,
  UIImageProps,
  UINineSliceProps,
  UIProgressBarProps,
  UICheckboxProps,
  UIPanelProps,
  UIScrollViewProps,
  ScrollbarOptions,
  PixiFancyButtonProps,
  PixiCheckboxProps,
  PixiProgressBarProps,
  PixiSliderProps,
  PixiInputProps,
  PixiSelectProps,
  PixiRadioGroupProps,
  PixiViewType,
  FancyButtonAnimations,
  FocusProps,
  FocusNeighbors,
  FocusDirection,
  PointerFocusMode,
  UIFocusStyle,
  UIFocusOutlineBox,
  UIFocusScopeOptions,
  UIFocusInputOptions,
  UIScrollIntoViewOptions,
} from "./types.js";

// Yoga helpers (for testing and custom element implementations)
export { setYoga, createYogaNode, applyLayoutProps } from "./yoga-helpers.js";

export { createNineSliceView } from "./views.js";
export type { NineSliceViewOptions } from "./views.js";

// Background renderer
export { BackgroundRenderer } from "./background-renderer.js";

// Shared pointer/hover fan-out (used by the interactive primitives;
// exported for custom element implementations and tests)
export { PointerEvents } from "./pointer-events.js";

// Keyboard / gamepad focus
export { FocusState } from "./focus/FocusState.js";
export type { FocusBehavior } from "./focus/FocusState.js";
export { UIFocusScope } from "./focus/UIFocusScope.js";
export type {
  UIFocusScopeHost,
  UIFocusInputSource,
} from "./focus/UIFocusScope.js";
export { UIFocusStack, UIFocusStackKey } from "./focus/UIFocusStack.js";
export { UIFocusSystem } from "./UIFocusSystem.js";
// An element holding a scope's input; exported for custom element
// implementations, the way `PointerEvents` and `FocusState` are.
export { captureFocusInput, isCapturingInput } from "./focus/input-capture.js";
export type { UIInputCaptureElement } from "./focus/input-capture.js";
/** @internal The downward channel a custom element's `_attachToTree` takes. */
export type { UITreeContext } from "./internal/tree-context.js";

// Plugin
export { UIPlugin } from "./UIPlugin.js";

// Components & elements
export { UISurface } from "./UISurface.js";
export { UIPanel } from "./UIPanel.js";
export { UIText } from "./UIText.js";
export { UISplitText } from "./UISplitText.js";
export type { TextSegments, SplitListener } from "./UISplitText.js";
export { UIButton } from "./UIButton.js";
export { UIImage } from "./UIImage.js";
export { UINineSlice } from "./UINineSlice.js";
export { UIProgressBar } from "./UIProgressBar.js";
export { UICheckbox } from "./UICheckbox.js";
export { UIScrollView } from "./UIScrollView.js";
export { LoadingSceneProgressBar } from "./LoadingSceneProgressBar.js";
export type { LoadingSceneProgressBarOptions } from "./LoadingSceneProgressBar.js";

// @pixi/ui wrappers
export {
  PixiUIBase,
  PixiFancyButton,
  PixiCheckbox,
  PixiProgressBar,
  PixiSlider,
  PixiInput,
  PixiSelect,
  PixiRadioGroup,
} from "./pixi-ui/index.js";

// System & utilities
export {
  UILayoutSystem,
  resolveAnchor,
  pivotOffsetFromAnchor,
} from "./UILayoutSystem.js";

// Floating UI (tooltips/popovers/menus) — framework-agnostic overlay,
// pure positioning engine, and the imperative tooltip helper.
export {
  FloatingOverlay,
  FloatingOverlayKey,
  layoutFloat,
} from "./floating.js";
export type { FloatConfig, FloatingHandle } from "./floating.js";
export { FloatingOverlaySystem } from "./FloatingOverlaySystem.js";
/** @internal Used by framework integrations to bind UI trees to an engine. */
export { bindUIErrorBoundary } from "./error-boundary.js";
export { computePosition, parsePlacement } from "./positioning.js";
export type {
  Placement,
  Side,
  Align,
  Rect,
  Dimensions,
  ComputePositionConfig,
  ComputePositionResult,
} from "./positioning.js";
export { attachTooltip } from "./attachTooltip.js";
export type { AttachTooltipOptions, TooltipHandle } from "./attachTooltip.js";
