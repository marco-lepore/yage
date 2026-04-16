import type {
  ColorValue,
  DisplayContainer,
  DisplaySprite,
  GraphicsContext,
  PointLike,
  TextStyle,
  TextureHandle,
  TextureResource,
} from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";

/** View type accepted by @pixi/ui components (texture path, Texture, Container, Sprite, or Graphics). */
export type PixiViewType =
  | string
  | TextureHandle
  | TextureResource
  | DisplayContainer
  | DisplaySprite
  | GraphicsContext;

/**
 * Default UI layer name, auto-provisioned on the active scene's render tree
 * when a UIPanel is added without a layer of its own.
 */
export const UI_DEFAULT_LAYER = "ui";
/** Default draw order for the auto-provisioned UI layer. */
export const UI_DEFAULT_LAYER_ORDER = 1000;

/** Anchor position for root UI panels relative to virtual resolution. */
export enum Anchor {
  TopLeft,
  TopCenter,
  TopRight,
  CenterLeft,
  Center,
  CenterRight,
  BottomLeft,
  BottomCenter,
  BottomRight,
}

/** Layout direction for child elements. */
export type FlexDirection = "row" | "column";

/** Padding specification — a single number or per-side object. */
export type Padding =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

/** Resolved padding with all four sides. */
export interface ResolvedPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Solid-color background. Same shape as the original BackgroundOptions for backward compat. */
export interface ColorBackground {
  color?: number;
  alpha?: number;
  radius?: number;
}

/** Texture-based background with stretch, nine-slice, or tile modes. */
export interface TextureBackground {
  texture: TextureHandle;
  mode?: "stretch" | "nine-slice" | "tile";
  nineSlice?:
    | { left: number; top: number; right: number; bottom: number }
    | number;
  tileScale?: { x: number; y: number } | number;
  tint?: number;
  alpha?: number;
}

/** Background options — either a solid color or a texture. */
export type BackgroundOptions = ColorBackground | TextureBackground;

/** Type guard to distinguish texture backgrounds from color backgrounds. */
export function isTextureBackground(
  bg: BackgroundOptions,
): bg is TextureBackground {
  return "texture" in bg;
}

// ---------------------------------------------------------------------------
// Layout value types (Yoga-powered)
// ---------------------------------------------------------------------------

/** A dimension value: pixels, percentage, viewport-relative, or auto. */
export type LayoutValue =
  | number
  | `${number}%`
  | `${number}vh`
  | `${number}vw`
  | "auto";

/** Common layout props every element can accept (applied to its Yoga node). */
export interface LayoutProps {
  width?: LayoutValue;
  height?: LayoutValue;
  minWidth?: LayoutValue;
  maxWidth?: LayoutValue;
  minHeight?: LayoutValue;
  maxHeight?: LayoutValue;
  margin?:
    | number
    | { top?: number; right?: number; bottom?: number; left?: number };
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: LayoutValue;
  alignSelf?:
    | "auto"
    | "flex-start"
    | "center"
    | "flex-end"
    | "stretch"
    | "baseline";
  visible?: boolean;
}

// ---------------------------------------------------------------------------
// Element interfaces (Yoga-aware)
// ---------------------------------------------------------------------------

/** Common interface for elements that participate in Yoga layout. */
export interface UIElement {
  readonly displayObject: DisplayContainer;
  readonly yogaNode: YogaNode;
  visible: boolean;
  applyLayout?(): void;
  update(props: Record<string, unknown>): void;
  destroy(): void;
}

/** A container element that can hold child UIElements. */
export interface UIContainerElement extends UIElement {
  readonly children: readonly UIElement[];
  addElement(child: UIElement): void;
  removeElement(child: UIElement): void;
  insertElementBefore(child: UIElement, before: UIElement): void;
}

// ---------------------------------------------------------------------------
// Props interfaces for element constructors
// ---------------------------------------------------------------------------

/** Props for UIText (used by reconciler and props-driven constructor). */
export interface UITextProps extends LayoutProps {
  children?: string;
  style?: Partial<TextStyle>;
}

/** Props for UIButton (used by reconciler and props-driven constructor). */
export interface UIButtonProps extends LayoutProps {
  children?: string;
  onClick?: () => void;
  background?: BackgroundOptions;
  hoverBackground?: BackgroundOptions;
  pressBackground?: BackgroundOptions;
  textStyle?: Partial<TextStyle>;
  disabled?: boolean;
}

/** Props for PanelNode (used by reconciler and props-driven constructor). */
export interface PanelProps extends LayoutProps {
  direction?: FlexDirection;
  gap?: number;
  padding?: Padding;
  alignItems?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "stretch"
    | "baseline";
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around"
    | "space-evenly";
  overflow?: "visible" | "hidden";
  background?: BackgroundOptions;
}

/** Props for UIImage. */
export interface UIImageProps extends LayoutProps {
  texture: TextureHandle;
  tint?: number;
  alpha?: number;
}

/** Props for UINineSlice. */
export interface UINineSliceProps extends LayoutProps {
  texture: TextureHandle;
  insets:
    | { left: number; top: number; right: number; bottom: number }
    | number;
  tint?: number;
  alpha?: number;
}

/** Props for UIProgressBar. */
export interface UIProgressBarProps extends LayoutProps {
  value: number;
  trackBackground?: BackgroundOptions;
  fillBackground?: BackgroundOptions;
  direction?: "horizontal" | "vertical";
}

/** Props for UICheckbox. */
export interface UICheckboxProps extends LayoutProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  size?: number;
  boxColor?: number;
  checkColor?: number;
  label?: string;
  labelStyle?: Partial<TextStyle>;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// @pixi/ui wrapper props (Pixi* components)
// ---------------------------------------------------------------------------

/** State transition animations config for FancyButton. */
export interface FancyButtonAnimations {
  default?: Record<string, unknown>;
  hover?: Record<string, unknown>;
  pressed?: Record<string, unknown>;
  disabled?: Record<string, unknown>;
}

/** Props for PixiFancyButton. */
export interface PixiFancyButtonProps extends LayoutProps {
  defaultView?: PixiViewType;
  hoverView?: PixiViewType;
  pressedView?: PixiViewType;
  disabledView?: PixiViewType;
  text?: string;
  icon?: DisplayContainer;
  textStyle?: Partial<TextStyle>;
  padding?: number;
  nineSliceSprite?: [number, number, number, number];
  onClick?: () => void;
  disabled?: boolean;
  anchor?: number;
  scale?: number;
  animations?: FancyButtonAnimations;
  textOffset?: { x?: number; y?: number } & { [K in "default" | "hover" | "pressed" | "disabled"]?: { x?: number; y?: number } };
}

/** Props for PixiCheckbox. */
export interface PixiCheckboxProps extends LayoutProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  checkedView: PixiViewType;
  uncheckedView: PixiViewType;
  text?: string;
  textStyle?: Partial<TextStyle>;
  textOffset?: { x?: number; y?: number };
}

/** Props for PixiProgressBar. */
export interface PixiProgressBarProps extends LayoutProps {
  value: number;
  bg: PixiViewType;
  fill: PixiViewType;
  fillPaddings?: { top?: number; right?: number; bottom?: number; left?: number };
  nineSliceSprite?: [number, number, number, number];
}

/** Props for PixiSlider. */
export interface PixiSliderProps extends LayoutProps {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  bg: PixiViewType;
  fill: PixiViewType;
  slider: PixiViewType;
  onChange?: (value: number) => void;
  onUpdate?: (value: number) => void;
  showValue?: boolean;
  valueTextStyle?: Partial<TextStyle>;
  fillPaddings?: { top?: number; right?: number; bottom?: number; left?: number };
  nineSliceSprite?: [number, number, number, number];
}

/** Props for PixiInput. */
export interface PixiInputProps extends LayoutProps {
  bg: PixiViewType;
  textStyle?: Partial<TextStyle>;
  placeholder?: string;
  value?: string;
  maxLength?: number;
  secure?: boolean;
  align?: "left" | "center" | "right";
  padding?: number | number[];
  nineSliceSprite?: [number, number, number, number];
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
}

/** Props for PixiScrollBox. */
export interface PixiScrollBoxProps extends LayoutProps {
  scrollWidth?: number;
  scrollHeight?: number;
  background?: ColorValue;
  radius?: number;
  type?: "vertical" | "horizontal" | "both";
  elementsMargin?: number;
  globalScroll?: boolean;
  onScroll?: (position: number | PointLike) => void;
}

/** Props for PixiSelect. */
export interface PixiSelectProps extends LayoutProps {
  closedBG: PixiViewType;
  openBG: PixiViewType;
  items: string[];
  selected?: number;
  textStyle?: Partial<TextStyle>;
  itemTextStyle?: Partial<TextStyle>;
  itemWidth?: number;
  itemHeight?: number;
  itemBG?: ColorValue;
  itemHoverBG?: ColorValue;
  visibleItems?: number;
  onSelect?: (index: number, text: string) => void;
  scrollBoxOffset?: PointLike;
}

/** Props for PixiRadioGroup. */
export interface PixiRadioGroupProps extends LayoutProps {
  items: PixiCheckboxProps[];
  type: "vertical" | "horizontal";
  elementsMargin: number;
  selected?: number;
  onChange?: (selectedIndex: number, selectedValue: string) => void;
}

// ---------------------------------------------------------------------------
// Component options
// ---------------------------------------------------------------------------

/** Options for creating a root UIPanel (attached to an entity as a Component). */
export interface UIPanelOptions extends PanelProps {
  anchor?: Anchor;
  offset?: { x: number; y: number };
  /** Target UI layer name. Defaults to "default". Layer must be pre-created via UILayerManager. */
  layer?: string;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Helper to resolve a Padding value into per-side values. */
export function resolvePadding(p: Padding | undefined): ResolvedPadding {
  if (p === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
  return {
    top: p.top ?? 0,
    right: p.right ?? 0,
    bottom: p.bottom ?? 0,
    left: p.left ?? 0,
  };
}
