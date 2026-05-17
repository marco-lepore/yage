import {
  useState,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  forwardRef,
} from "react";
import type { PropsWithChildren, ReactNode } from "react";
import type {
  BitmapTextOption,
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
  ScrollViewNode,
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
  PointerEventProps,
  ScrollbarOptions,
  UIElement,
} from "@yagejs/ui";
import { TooltipOverlayCtx } from "./tooltip-overlay.js";
import type { TooltipController } from "./tooltip-overlay.js";

// ---------------------------------------------------------------------------
// Prop types for JSX elements
// ---------------------------------------------------------------------------

export interface PanelProps extends LayoutProps, PointerEventProps {
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
  /**
   * Opt the panel out of the UI auto-consume pointer fallback (default
   * `true`). Pass `false` for a decorative / pass-through container that
   * shouldn't swallow clicks meant for the world or elements beneath it.
   */
  consumeInput?: boolean;
  visible?: boolean;
}

export interface TextProps extends LayoutProps, PointerEventProps {
  style?: Partial<TextStyle>;
  /**
   * Overflow behavior when the rendered text is wider than the layout slot.
   * Omitted → wrap to the layout width.
   * `"clip"` → single line, visually clipped by the parent panel's `overflow`.
   * `"ellipsis"` → single line truncated with `…`.
   */
  truncate?: "clip" | "ellipsis";
  /**
   * Render with a bitmap font instead of canvas-rasterised `Text` — the
   * pixel-art escape hatch (canvas text blurs at non-integer scale on
   * non-Retina displays). `true` bakes a dynamic font from `style`;
   * `{ font }` uses an installed/loaded font by name.
   */
  bitmap?: BitmapTextOption;
  /**
   * Per-text render resolution. Pixi v8 `resolution` is a `Text`
   * constructor option, not a `TextStyle` property — set it here for crisp
   * canvas text. Ignored when `bitmap` is set.
   */
  resolution?: number;
  children?: string;
}

export interface ButtonProps extends LayoutProps, PointerEventProps {
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

export interface ImageProps extends LayoutProps, PointerEventProps {
  texture: TextureHandle;
  tint?: number;
  alpha?: number;
}

export interface NineSliceProps extends LayoutProps, PointerEventProps {
  texture: TextureHandle;
  insets:
    | { left: number; top: number; right: number; bottom: number }
    | number;
  tint?: number;
  alpha?: number;
}

export interface ProgressBarProps extends LayoutProps, PointerEventProps {
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
 * @internal A `Panel` that forwards a ref to its underlying `PanelNode`
 * (the reconciler returns the `UIElement` instance via `getPublicInstance`).
 * Used by `Tooltip` to read the trigger's post-layout geometry and by the
 * overlay host to position each bubble.
 */
const RefPanel = forwardRef<UIElement, PropsWithChildren<PanelProps>>(
  function RefPanel(props, ref) {
    const { children, bg, ...rest } = props;
    // @ts-expect-error — custom reconciler element type
    return <ui-element _ctor={PanelNode} {...rest} background={bg} ref={ref}>{children}</ui-element>;
  },
);

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

export interface TooltipProps {
  /**
   * Tooltip body. A `string` / `number` is auto-wrapped in a `<Text>`
   * styled with `textStyle`; pass `ReactNode`s for rich content (icon +
   * text rows, stat blocks, …).
   */
  content: ReactNode;
  /** Which side of the wrapped child the bubble appears on. Default `"top"`. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Gap in px between the trigger and the bubble. Default `6`. */
  offset?: number;
  /** Bubble background. Default a dark, slightly translucent rounded panel. */
  bg?: BackgroundOptions;
  /** Padding inside the bubble. Default `{ left: 8, right: 8, top: 4, bottom: 4 }`. */
  padding?: Padding;
  /** Text style applied when `content` is a string / number. */
  textStyle?: Partial<TextStyle>;
  /**
   * Force the bubble's visibility, bypassing hover. Omit for the default
   * hover-driven behavior; pass a boolean to control it yourself (a pinned
   * onboarding callout, a debug toggle, …).
   */
  opened?: boolean;
  /** Render the children only — never show the bubble. */
  disabled?: boolean;
  /** The trigger element(s) the tooltip describes. */
  children: ReactNode;
}

/** Neutral dark default bubble look (readable on light or dark game UIs). */
const TOOLTIP_BG: BackgroundOptions = { color: 0x1f2430, alpha: 0.96, radius: 6 };
const TOOLTIP_PAD: Padding = { left: 10, right: 10, top: 6, bottom: 6 };
const TOOLTIP_TEXT = { fill: 0xe5e7eb, fontSize: 13 } as const;

/**
 * Hover-driven floating label, Mantine-style: one wrapper, content in a
 * prop. Wraps `children` in a layout-transparent `<Panel>` (no forced
 * alignment — the trigger keeps its natural sizing) that listens for hover
 * (the `onHover` prop).
 *
 * Under a `<UIRoot>` the bubble is hoisted into the root's top overlay (a
 * viewport-sized, top-most, unclipped container) and re-anchored to the
 * trigger every frame from its post-layout geometry. That keeps it above all
 * other UI, lets it escape a `<ScrollView>` clip, and sizes it to its own
 * content instead of the trigger's width. Rendered without a `<UIRoot>`
 * (e.g. a bare reconciler tree) it falls back to an in-tree absolute bubble.
 *
 * The bubble is start-aligned on the cross axis (not centered) — centering
 * would need a second measured pass; compose a `<ZStack>` for precise
 * placement.
 */
export function Tooltip(props: TooltipProps): React.JSX.Element {
  const {
    content,
    placement = "top",
    offset = 6,
    bg,
    padding,
    textStyle,
    opened,
    disabled,
    children,
  } = props;
  const controller = useContext(TooltipOverlayCtx);
  const [hovered, setHovered] = useState(false);
  const show = !disabled && (opened ?? hovered);

  const body =
    typeof content === "string" || typeof content === "number" ? (
      <UIText style={{ ...TOOLTIP_TEXT, ...textStyle }}>
        {String(content)}
      </UIText>
    ) : (
      content
    );

  // The visual bubble. In the overlay path the host wraps this in the
  // absolutely-positioned, frame-anchored container; inline it carries the
  // edge offset itself.
  const bubble = (
    <Panel
      consumeInput={false}
      padding={padding ?? TOOLTIP_PAD}
      bg={bg ?? TOOLTIP_BG}
    >
      {body}
    </Panel>
  );

  const triggerRef = useRef<UIElement | null>(null);
  const idRef = useRef<number | null>(null);

  // Register / unregister with the overlay while shown. Re-runs only on
  // show / placement / offset changes (content is refreshed below).
  useEffect(() => {
    if (!controller || !show) return;
    const id = controller.register({
      node: bubble,
      placement,
      offset,
      getTrigger: () => triggerRef.current,
    });
    idRef.current = id;
    return () => {
      controller.unregister(id);
      idRef.current = null;
    };
    // `bubble` identity changes every render by design — refreshed by the
    // effect below rather than re-registering here.
  }, [controller, show, placement, offset]);

  // Keep the live entry's content current (cheap: Tooltip re-renders are
  // event-driven — hover / prop changes, not per-frame).
  useEffect(() => {
    if (!controller || idRef.current === null) return;
    controller.update(idRef.current, {
      node: bubble,
      placement,
      offset,
      getTrigger: () => triggerRef.current,
    });
  });

  if (controller) {
    return (
      <RefPanel
        ref={(el) => {
          triggerRef.current = el;
        }}
        {...(disabled ? {} : { onHover: setHovered })}
      >
        {children}
      </RefPanel>
    );
  }

  // Inline fallback (no UIRoot overlay): in-tree absolute bubble.
  const edge: Partial<PanelProps> =
    placement === "bottom"
      ? { top: "100%", margin: { top: offset } }
      : placement === "left"
        ? { right: "100%", margin: { right: offset } }
        : placement === "right"
          ? { left: "100%", margin: { left: offset } }
          : { bottom: "100%", margin: { bottom: offset } };

  return (
    <Panel
      position="relative"
      {...(disabled ? {} : { onHover: setHovered })}
    >
      {children}
      {show ? (
        <Panel position="absolute" {...edge}>
          {bubble}
        </Panel>
      ) : null}
    </Panel>
  );
}

/**
 * @internal Renders the live tooltip bubbles for a `UIRoot`'s overlay. Each
 * is an absolutely-positioned element the controller re-anchors imperatively
 * every frame (no per-frame React work). The host fills the viewport so a
 * bubble's text is measured against the screen, not its trigger — long
 * labels stay on one line instead of wrapping into the trigger's width.
 */
export function TooltipOverlayHost({
  controller,
}: {
  controller: TooltipController;
}): React.JSX.Element {
  const entries = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return (
    <Panel
      position="relative"
      width="100%"
      height="100%"
      consumeInput={false}
    >
      {entries.map((e) => (
        <RefPanel
          key={e.id}
          position="absolute"
          left={0}
          top={0}
          consumeInput={false}
          ref={(el) => controller.attachBubble(e.id, el)}
        >
          {e.node}
        </RefPanel>
      ))}
    </Panel>
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

export interface ScrollViewReactProps extends LayoutProps {
  /** Scroll/stack axis. Default `"vertical"`. */
  direction?: "vertical" | "horizontal";
  /** Gap between child cards. */
  gap?: number;
  /** Padding inside the scrollable content. */
  padding?: Padding;
  /**
   * Scrollbar thumb: `true` (default) / omitted → default style; `false` →
   * hidden (no gutter); an object → custom size / style. A gutter equal to
   * the thumb footprint is reserved so content never sits under the thumb.
   */
  scrollbar?: boolean | ScrollbarOptions;
  /** Background drawn behind the clipped content. */
  bg?: BackgroundOptions;
  /** Called when the scroll offset changes. */
  onScroll?: (offset: number) => void;
}

/**
 * A clipped, scrollable container. Children are normal Yoga elements stacked
 * along `direction`; anything past the fixed viewport size scrolls via wheel
 * or drag, and the scroll position is preserved across re-renders. Size the
 * viewport with `height` / `flexGrow`; keep fixed siblings (e.g. a footer
 * button) outside the `<ScrollView>`.
 */
export function ScrollView(
  props: PropsWithChildren<ScrollViewReactProps>,
): React.JSX.Element {
  const { children, bg, ...rest } = props;
  // @ts-expect-error — custom reconciler element type
  return <ui-element _ctor={ScrollViewNode} {...rest} background={bg}>{children}</ui-element>;
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
