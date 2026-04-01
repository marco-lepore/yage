// Types & keys
export { UIContainerKey, Anchor, isTextureBackground } from "./types.js";
export type {
  FlexDirection,
  Padding,
  BackgroundOptions,
  ColorBackground,
  TextureBackground,
  UIPanelOptions,
  UIElement,
  UIContainerElement,
  LayoutProps,
  LayoutValue,
  UITextProps,
  UIButtonProps,
  UIImageProps,
  UINineSliceProps,
  UIProgressBarProps,
  UICheckboxProps,
  PanelProps,
  PixiFancyButtonProps,
  PixiCheckboxProps,
  PixiProgressBarProps,
  PixiSliderProps,
  PixiInputProps,
  PixiScrollBoxProps,
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

// Plugin
export { UIPlugin } from "./UIPlugin.js";

// Components & elements
export { UIPanel, PanelNode } from "./UIPanel.js";
export { UIText } from "./UIText.js";
export { UIButton } from "./UIButton.js";
export { UIImage } from "./UIImage.js";
export { UINineSlice } from "./UINineSlice.js";
export { UIProgressBar } from "./UIProgressBar.js";
export { UICheckbox } from "./UICheckbox.js";

// @pixi/ui wrappers
export {
  PixiUIBase,
  PixiFancyButton,
  PixiCheckbox,
  PixiProgressBar,
  PixiSlider,
  PixiInput,
  PixiScrollBox,
  PixiSelect,
  PixiRadioGroup,
} from "./pixi-ui/index.js";

// System & utilities
export { UILayoutSystem, resolveAnchor } from "./UILayoutSystem.js";
