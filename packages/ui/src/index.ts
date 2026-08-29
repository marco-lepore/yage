// Types & keys
export {
  Anchor,
  isTextureBackground,
  UI_DEFAULT_LAYER,
  UI_DEFAULT_LAYER_ORDER,
} from "./types.js";
export type {
  FlexDirection,
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
} from "./types.js";

// Yoga helpers (for testing and custom element implementations)
export { setYoga, createYogaNode, applyLayoutProps } from "./yoga-helpers.js";

// Asset helpers
export { setAssetManager, resolveTexture } from "./asset-helpers.js";
export { createNineSliceView } from "./views.js";
export type { NineSliceViewOptions } from "./views.js";

// Background renderer
export { BackgroundRenderer } from "./background-renderer.js";

// Shared pointer/hover fan-out (used by the interactive primitives;
// exported for custom element implementations and tests)
export { PointerEvents } from "./pointer-events.js";

// Localization propagation helper (for custom container elements)
export { ContainerLocalization } from "./localization-lifecycle.js";

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
export { FloatingOverlay, FloatingOverlayKey, layoutFloat } from "./floating.js";
export type { FloatConfig, FloatingHandle } from "./floating.js";
export { FloatingOverlaySystem } from "./FloatingOverlaySystem.js";
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
