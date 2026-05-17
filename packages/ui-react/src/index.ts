// Plugin (required — registers UIRootLayoutSystem alongside UIPlugin)
export { UIReactPlugin, UIReactPluginKey } from "./UIReactPlugin.js";

// Component
export { UIRoot } from "./UIRoot.js";
export type { UIRootOptions } from "./UIRoot.js";

// System (registered by UIReactPlugin; exported for tests/advanced uses)
export { UIRootLayoutSystem } from "./UIRootLayoutSystem.js";

// JSX components
export {
  Panel, ZStack, Tooltip, UIText as Text, Button, Image, NineSlice, ProgressBar, Checkbox,
  PixiFancyButton, PixiCheckbox, PixiProgressBar, PixiSlider,
  PixiInput, ScrollView, PixiSelect, PixiRadioGroup,
} from "./components.js";
export type {
  PanelProps, TooltipProps, TextProps, ButtonProps, ImageProps, NineSliceProps, ProgressBarProps, CheckboxProps,
  PixiFancyButtonReactProps, PixiCheckboxReactProps, PixiProgressBarReactProps, PixiSliderReactProps,
  PixiInputReactProps, ScrollViewReactProps, PixiSelectReactProps, PixiRadioGroupReactProps,
} from "./components.js";

// Hooks
export { useEngine, useScene, useStore, useQuery, useSceneSelector } from "./hooks.js";

// Headless floating primitive (tooltips/popovers/menus build on this)
export { useFloating } from "./use-floating.js";
export type { UseFloatingOptions, UseFloatingResult } from "./use-floating.js";
export { computePosition } from "./positioning.js";
export type {
  Placement,
  Side,
  Align,
  Rect,
  Dimensions,
  ComputePositionConfig,
  ComputePositionResult,
} from "./positioning.js";
export type { FloatConfig, FloatingHandle } from "./floating.js";

// Re-export useful types from @yagejs/ui for convenience
export { Anchor } from "@yagejs/ui";
export type {
  PixiViewType,
  FancyButtonAnimations,
  ScrollbarOptions,
  PointerEventProps,
  PositionValue,
} from "@yagejs/ui";

