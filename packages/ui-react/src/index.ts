// Plugin (required — registers UIRootLayoutSystem alongside UIPlugin)
export { UIReactPlugin } from "./UIReactPlugin.js";

// Component
export { UIRoot } from "./UIRoot.js";
export type { UIRootOptions } from "./UIRoot.js";

// System (registered by UIReactPlugin; exported for tests/advanced uses)
export { UIRootLayoutSystem } from "./UIRootLayoutSystem.js";

// JSX components
export {
  Panel, UIText as Text, Button, Image, NineSlice, ProgressBar, Checkbox,
  PixiFancyButton, PixiCheckbox, PixiProgressBar, PixiSlider,
  PixiInput, PixiScrollBox, PixiSelect, PixiRadioGroup,
} from "./components.js";
export type {
  PanelProps, TextProps, ButtonProps, ImageProps, NineSliceProps, ProgressBarProps, CheckboxProps,
  PixiFancyButtonReactProps, PixiCheckboxReactProps, PixiProgressBarReactProps, PixiSliderReactProps,
  PixiInputReactProps, PixiScrollBoxReactProps, PixiSelectReactProps, PixiRadioGroupReactProps,
} from "./components.js";

// Store
export { createStore } from "./store.js";
export type { Store } from "./store.js";

// Hooks
export { useEngine, useScene, useStore, useQuery, useSceneSelector } from "./hooks.js";

// Re-export useful types from @yagejs/ui for convenience
export { Anchor } from "@yagejs/ui";
export type { PixiViewType, FancyButtonAnimations } from "@yagejs/ui";

