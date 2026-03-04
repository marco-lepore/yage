// Component
export { UIRoot } from "./UIRoot.js";
export type { UIRootOptions } from "./UIRoot.js";

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

// Re-export useful types from @yage/ui for convenience
export { Anchor } from "@yage/ui";
export type { PixiViewType, FancyButtonAnimations } from "@yage/ui";

// Element registry for extensibility
export { registerElement } from "./reconciler.js";
export type { ElementDef } from "./reconciler.js";
