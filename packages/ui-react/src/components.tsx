import type { PropsWithChildren } from "react";
import type {
  ColorValue,
  DisplayContainer,
  PointLike,
  TextStyle,
  TextureHandle,
} from "@yage/renderer";
import {
  PanelNode,
  UIText as UITextNode,
  UIButton as UIButtonNode,
  UIImage as UIImageNode,
  UINineSlice as UINineSliceNode,
  UIProgressBar as UIProgressBarNode,
  UICheckbox as UICheckboxNode,
  PixiFancyButton as PixiFancyButtonNode,
  PixiCheckbox as PixiCheckboxNode,
  PixiProgressBar as PixiProgressBarNode,
  PixiSlider as PixiSliderNode,
  PixiInput as PixiInputNode,
  PixiScrollBox as PixiScrollBoxNode,
  PixiSelect as PixiSelectNode,
  PixiRadioGroup as PixiRadioGroupNode,
} from "@yage/ui";
import type {
  BackgroundOptions,
  FancyButtonAnimations,
  LayoutProps,
  PixiViewType,
} from "@yage/ui";

// ---------------------------------------------------------------------------
// Prop types for JSX elements
// ---------------------------------------------------------------------------

export interface PanelProps extends LayoutProps {
  anchor?: string;
  direction?: "row" | "column";
  gap?: number;
  padding?: number;
  bg?: BackgroundOptions;
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
  visible?: boolean;
}

export interface TextProps {
  style?: Partial<TextStyle>;
  children?: string;
}

export interface ButtonProps extends LayoutProps {
  width: number;
  height: number;
  onClick?: () => void;
  bg?: BackgroundOptions;
  hoverBg?: BackgroundOptions;
  pressBg?: BackgroundOptions;
  textStyle?: Partial<TextStyle>;
  disabled?: boolean;
  children?: string;
}

export interface ImageProps extends LayoutProps {
  texture: TextureHandle;
  tint?: number;
  alpha?: number;
}

export interface NineSliceProps extends LayoutProps {
  texture: TextureHandle;
  insets:
    | { left: number; top: number; right: number; bottom: number }
    | number;
  tint?: number;
  alpha?: number;
}

export interface ProgressBarProps extends LayoutProps {
  value: number;
  trackBackground?: BackgroundOptions;
  fillBackground?: BackgroundOptions;
  direction?: "horizontal" | "vertical";
}

export interface CheckboxProps extends LayoutProps {
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
// JSX Components — thin wrappers that emit custom reconciler element types
// ---------------------------------------------------------------------------

/** A flex-layout container with optional background. */
export function Panel(props: PropsWithChildren<PanelProps>): React.JSX.Element {
  const { children, bg, ...rest } = props;
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PanelNode} {...rest} background={bg}>{children}</ui-element>;
}

/** A text label. */
export function UIText(props: TextProps): React.JSX.Element {
  const { children, ...rest } = props;
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UITextNode} _consumesText {...rest}>{children}</ui-element>;
}

/** An interactive button. */
export function Button(props: ButtonProps): React.JSX.Element {
  const { children, bg, hoverBg, pressBg, ...rest } = props;
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UIButtonNode} _consumesText {...rest} background={bg} hoverBackground={hoverBg} pressBackground={pressBg}>{children}</ui-element>;
}

/** An image element displaying a texture. */
export function Image(props: ImageProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UIImageNode} {...props} />;
}

/** A nine-slice panel with texture borders. */
export function NineSlice(props: NineSliceProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UINineSliceNode} {...props} />;
}

/** A progress bar with track and fill. */
export function ProgressBar(props: ProgressBarProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UIProgressBarNode} {...props} />;
}

/** An interactive checkbox with optional label. */
export function Checkbox(props: CheckboxProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UICheckboxNode} {...props} />;
}

// ---------------------------------------------------------------------------
// @pixi/ui wrapper components
// ---------------------------------------------------------------------------

export interface PixiFancyButtonReactProps extends LayoutProps {
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

/** @pixi/ui FancyButton with Yoga layout. */
export function PixiFancyButton(props: PixiFancyButtonReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiFancyButtonNode} {...props} />;
}

export interface PixiCheckboxReactProps extends LayoutProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  checkedView: PixiViewType;
  uncheckedView: PixiViewType;
  text?: string;
  textStyle?: Partial<TextStyle>;
  textOffset?: { x?: number; y?: number };
}

/** @pixi/ui CheckBox with Yoga layout. */
export function PixiCheckbox(props: PixiCheckboxReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiCheckboxNode} {...props} />;
}

export interface PixiProgressBarReactProps extends LayoutProps {
  value: number;
  bg: PixiViewType;
  fill: PixiViewType;
  fillPaddings?: { top?: number; right?: number; bottom?: number; left?: number };
  nineSliceSprite?: [number, number, number, number];
}

/** @pixi/ui ProgressBar with Yoga layout. */
export function PixiProgressBar(props: PixiProgressBarReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiProgressBarNode} {...props} />;
}

export interface PixiSliderReactProps extends LayoutProps {
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

/** @pixi/ui Slider with Yoga layout. */
export function PixiSlider(props: PixiSliderReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiSliderNode} {...props} />;
}

export interface PixiInputReactProps extends LayoutProps {
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

/** @pixi/ui Input with Yoga layout. */
export function PixiInput(props: PixiInputReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiInputNode} {...props} />;
}

export interface PixiScrollBoxReactProps extends LayoutProps {
  scrollWidth?: number;
  scrollHeight?: number;
  background?: ColorValue;
  radius?: number;
  type?: "vertical" | "horizontal" | "both";
  elementsMargin?: number;
  globalScroll?: boolean;
  onScroll?: (position: number | PointLike) => void;
}

/** @pixi/ui ScrollBox with Yoga layout. */
export function PixiScrollBox(props: PixiScrollBoxReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiScrollBoxNode} {...props} />;
}

export interface PixiSelectReactProps extends LayoutProps {
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

/** @pixi/ui Select dropdown with Yoga layout. */
export function PixiSelect(props: PixiSelectReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiSelectNode} {...props} />;
}

export interface PixiRadioGroupReactProps extends LayoutProps {
  items: PixiCheckboxReactProps[];
  type: "vertical" | "horizontal";
  elementsMargin: number;
  selected?: number;
  onChange?: (selectedIndex: number, selectedValue: string) => void;
}

/** @pixi/ui RadioGroup with Yoga layout. */
export function PixiRadioGroup(props: PixiRadioGroupReactProps): React.JSX.Element {
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={PixiRadioGroupNode} {...props} />;
}
