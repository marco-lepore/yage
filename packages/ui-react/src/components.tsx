import type { PropsWithChildren, ReactNode } from "react";
import type {
  ColorValue,
  DisplayContainer,
  PointLike,
  TextStyle,
  TextureHandle,
} from "@yagejs/renderer";
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
} from "@yagejs/ui";
import type {
  BackgroundOptions,
  FancyButtonAnimations,
  LayoutProps,
  LayoutValue,
  Padding,
  PixiViewType,
} from "@yagejs/ui";

// ---------------------------------------------------------------------------
// Prop types for JSX elements
// ---------------------------------------------------------------------------

export interface PanelProps extends LayoutProps {
  anchor?: string;
  direction?: "row" | "column";
  gap?: number;
  /** Single number or per-side object — matches `@yagejs/ui` `PanelProps.padding`. */
  padding?: Padding;
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

export interface TextProps extends LayoutProps {
  style?: Partial<TextStyle>;
  /**
   * Overflow behavior when the rendered text is wider than the layout slot.
   * Omitted → wrap to the layout width.
   * `"clip"` → single line, visually clipped by the parent panel's `overflow`.
   * `"ellipsis"` → single line truncated with `…`.
   */
  truncate?: "clip" | "ellipsis";
  children?: string;
}

export interface ButtonProps extends LayoutProps {
  /**
   * Fixed width — pixels, `"<n>%"` of parent, `"<n>vw"` / `"<n>vh"`, or
   * `"auto"` to shrink-to-fit the button's content (text + any icon /
   * nested elements). Omit to let Yoga measure.
   */
  width?: LayoutValue;
  /**
   * Fixed height — pixels, `"<n>%"` of parent, `"<n>vw"` / `"<n>vh"`, or
   * `"auto"` to shrink-to-fit the button's content. Omit to let Yoga
   * measure.
   */
  height?: LayoutValue;
  onClick?: () => void;
  bg?: BackgroundOptions;
  hoverBg?: BackgroundOptions;
  pressBg?: BackgroundOptions;
  /** Style applied to the auto-wrapped text node when `children` is a string. */
  textStyle?: Partial<TextStyle>;
  /**
   * Overflow behavior for the auto-wrapped label when `children` is a
   * string / number. Forwarded straight to the inner `<Text>` so a
   * fixed-width button can ellipsize long labels instead of wrapping or
   * overflowing. No effect when `children` is a React element (compose
   * with a `<Text truncate="...">` directly).
   */
  truncate?: "clip" | "ellipsis";
  disabled?: boolean;
  /**
   * String for the common labeled-button case — auto-wrapped in a centered
   * `<Text>` with `textStyle` applied. Pass `ReactNode`s (Text + Image rows,
   * nested panels) for richer button content; those render as flex children
   * of the button.
   */
  children?: ReactNode;
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

/**
 * Z-axis stacking primitive: a `Panel` that defaults to filling its parent
 * and acts as the containing block for absolute-positioned children. Drop
 * children inside with `position="absolute"` (plus `left` / `top` / `right`
 * / `bottom`) to layer them on top of each other on the Z axis — modal
 * backdrops, HUD layers, badge markers, etc. The name mirrors SwiftUI's
 * `ZStack` (contrast with `VStack` / `HStack`, which are the flex column /
 * row directions on `<Panel>`). Defaults can be overridden via props.
 */
export function ZStack(props: PropsWithChildren<PanelProps>): React.JSX.Element {
  return (
    <Panel
      width="100%"
      height="100%"
      position="relative"
      {...props}
    />
  );
}

/** A text label. */
export function UIText(props: TextProps): React.JSX.Element {
  const { children, ...rest } = props;
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UITextNode} _consumesText {...rest}>{children}</ui-element>;
}

/**
 * An interactive button.
 *
 * Children are treated as follows:
 * - `string` / `number` — auto-wrapped in a centered `<Text>` styled with
 *   `textStyle`.
 * - React elements — render as flex children of the button container.
 * - `null` / `undefined` / `boolean` / arrays — handled by React's standard
 *   ReactNode semantics. Bare primitives other than `string`/`number` are
 *   dropped (this reconciler has no `createTextInstance`).
 */
export function Button(props: ButtonProps): React.JSX.Element {
  const { children, bg, hoverBg, pressBg, textStyle, truncate, ...rest } = props;
  const isPrimitiveLabel =
    typeof children === "string" || typeof children === "number";
  const content = isPrimitiveLabel
    ? <UIText
        {...(textStyle ? { style: textStyle } : {})}
        {...(truncate ? { truncate } : {})}
      >
        {String(children)}
      </UIText>
    : children;
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={UIButtonNode} {...rest} background={bg} hoverBackground={hoverBg} pressBackground={pressBg}>{content}</ui-element>;
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
