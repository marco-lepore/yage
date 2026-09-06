import { useState, forwardRef } from "react";
import type { PropsWithChildren, ReactNode } from "react";
import type { TextStyle } from "@yagejs/renderer";
import {
  UIPanel,
  UIText as UITextNode,
  UISplitText as UISplitTextNode,
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
  UIScrollView,
  PixiSelect as PixiSelectNode,
  PixiRadioGroup as PixiRadioGroupNode,
} from "@yagejs/ui";
import type {
  BackgroundOptions,
  Padding,
  Placement,
  UIElement,
  UIPanelProps as UIElementPanelProps,
  UITextProps as UIElementTextProps,
  UISplitTextProps as UIElementSplitTextProps,
  UIButtonProps as UIElementButtonProps,
  UIImageProps as UIElementImageProps,
  UINineSliceProps as UIElementNineSliceProps,
  UIProgressBarProps as UIElementProgressBarProps,
  UICheckboxProps as UIElementCheckboxProps,
  UIScrollViewProps as UIElementScrollViewProps,
  PixiFancyButtonProps as UIElementPixiFancyButtonProps,
  PixiCheckboxProps as UIElementPixiCheckboxProps,
  PixiProgressBarProps as UIElementPixiProgressBarProps,
  PixiSliderProps as UIElementPixiSliderProps,
  PixiInputProps as UIElementPixiInputProps,
  PixiSelectProps as UIElementPixiSelectProps,
  PixiRadioGroupProps as UIElementPixiRadioGroupProps,
} from "@yagejs/ui";
import { useFloating } from "./use-floating.js";

interface UIElementHostProps {
  _ctor: new (...args: never[]) => UIElement;
  children?: ReactNode;
  [prop: string]: unknown;
}

type UIElementHostComponent = (props: UIElementHostProps) => React.JSX.Element;

// React receives the string at runtime; this local component type gives the
// custom reconciler host element one checked JSX boundary without exposing it
// as a public intrinsic element.
const UIElementHost = "ui-element" as unknown as UIElementHostComponent;

// ---------------------------------------------------------------------------
// Prop types for JSX elements
//
// Each JSX prop type derives from its `@yagejs/ui` imperative counterpart
// (aliased `UIElement*Props` above). Optional React props accept explicit
// undefined to reset values between renders; imperative options stay unchanged.
// JSX-only additions layer on top:
// `children` where it's richer than the imperative type (e.g. `Button`
// accepts `ReactNode`, not just a string), and shorthand aliases (`bg` for
// `background`) expanded by the reconciler's shared alias table — see
// `reconciler.ts`'s `SHORTHAND_ALIASES` — before the element ever sees them.
// ---------------------------------------------------------------------------

// Optional React props accept explicit undefined to reset their host value.
type OptionalResetProps<T> = {
  [K in keyof T]: Record<never, never> extends Pick<T, K>
    ? T[K] | undefined
    : T[K];
};

interface PanelOptions extends UIElementPanelProps {
  /**
   * Shorthand for `background` — expanded by the reconciler's shared alias
   * table. If both `bg` and `background` are passed, `background` wins.
   */
  bg?: BackgroundOptions;
}

export type PanelProps = OptionalResetProps<PanelOptions>;

export type TextProps = OptionalResetProps<UIElementTextProps>;

interface ButtonOptions extends Omit<
  UIElementButtonProps,
  "children" | "hoverBackground" | "pressBackground"
> {
  /** Shorthand for `background` (see {@link PanelProps.bg}). */
  bg?: BackgroundOptions;
  /**
   * Hover-state background override. Button-specific alias applied inline
   * by `Button` itself (not part of the shared shorthand table — no other
   * element has a hover-state background to alias). The canonical
   * `hoverBackground`/`pressBackground` props are omitted from this
   * interface — `hoverBg`/`pressBg` are the only way to set these on
   * `<Button>`.
   */
  hoverBg?: BackgroundOptions;
  /** Press-state background override — see {@link hoverBg}. */
  pressBg?: BackgroundOptions;
  /**
   * String for the common labeled-button case — auto-wrapped in a centered
   * `<Text>` with `textStyle` applied. Pass `ReactNode`s (Text + Image rows,
   * nested panels) for richer button content; those render as flex children
   * of the button.
   */
  children?: ReactNode;
}

export type ButtonProps = OptionalResetProps<ButtonOptions>;

export type ImageProps = OptionalResetProps<UIElementImageProps>;

export type NineSliceProps = OptionalResetProps<UIElementNineSliceProps>;

export type ProgressBarProps = OptionalResetProps<UIElementProgressBarProps>;

export type CheckboxProps = OptionalResetProps<UIElementCheckboxProps>;

// ---------------------------------------------------------------------------
// JSX Components — thin wrappers that emit custom reconciler element types
// ---------------------------------------------------------------------------

/** A flex-layout container with optional background. */
export function Panel(props: PropsWithChildren<PanelProps>): React.JSX.Element {
  const { children, ...rest } = props;
  // `_bgAlias` tells the reconciler to expand a `bg` prop to `background`;
  return (
    <UIElementHost _ctor={UIPanel} _bgAlias {...rest}>
      {children}
    </UIElementHost>
  );
}

/**
 * @internal A `Panel` that forwards a ref to its underlying `UIPanel`
 * (the reconciler returns the `UIElement` instance via `getPublicInstance`).
 * Used by `Tooltip` to read the trigger's post-layout geometry and by the
 * overlay host to position each bubble.
 */
const RefPanel = forwardRef<UIElement, PropsWithChildren<PanelProps>>(
  function RefPanel(props, ref) {
    const { children, ...rest } = props;
    return (
      <UIElementHost _ctor={UIPanel} _bgAlias {...rest} ref={ref}>
        {children}
      </UIElementHost>
    );
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
export function ZStack(
  props: PropsWithChildren<PanelProps>,
): React.JSX.Element {
  return <Panel width="100%" height="100%" position="relative" {...props} />;
}

interface TooltipOptions {
  /**
   * Tooltip body. A `string` / `number` is auto-wrapped in a `<Text>`
   * styled with `textStyle`; pass `ReactNode`s for rich content (icon +
   * text rows, stat blocks, …).
   */
  content: ReactNode;
  /**
   * Preferred side, optionally aligned (`"top"`, `"bottom-start"`,
   * `"right-end"`, …). Default `"top"` (center-aligned). The bubble flips
   * to the opposite side and shifts along the cross axis to stay
   * on-screen.
   */
  placement?: Placement;
  /** Gap in px between the trigger and the bubble. Default `6`. */
  offset?: number;
  /**
   * Cap the bubble width (px). Long content wraps instead of running off
   * screen; the bubble always also clamps to the space available at the
   * resolved side.
   */
  maxWidth?: number;
  /**
   * Bubble background. Headless by default — omit and the bubble is an
   * unstyled, transparent container; pass to style it.
   */
  bg?: BackgroundOptions;
  /** Padding inside the bubble. Headless by default (none). */
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

export type TooltipProps = OptionalResetProps<TooltipOptions>;

/**
 * Hover-driven floating label, Mantine-style: one wrapper, body in a
 * `content` prop. **Headless** — no default visuals; pass `bg` / `padding`
 * / `textStyle` to style it.
 *
 * Under a `<UIRoot>` the bubble is portaled into the scene's top-most
 * screen-space overlay and anchored to the trigger by the positioning
 * engine (offset → flip → shift → size): it draws above all other UI,
 * escapes any `<ScrollView>` clip, flips/shifts to stay on-screen, and
 * caps to `maxWidth` (and to the space available at the resolved side).
 * World-space / camera-transformed triggers anchor correctly. Without a
 * `<UIRoot>` overlay (e.g. a bare reconciler tree) it falls back to an
 * in-tree absolute bubble with no collision handling.
 */
export function Tooltip(props: TooltipProps): React.JSX.Element {
  const {
    content,
    placement = "top",
    offset = 6,
    maxWidth,
    bg,
    padding,
    textStyle,
    opened,
    disabled,
    children,
  } = props;
  const [hovered, setHovered] = useState(false);
  const open = !disabled && (opened ?? hovered);
  const { setReference, renderFloating, hasOverlay } = useFloating({
    open,
    placement,
    offset,
    ...(maxWidth !== undefined ? { maxWidth } : {}),
  });

  const body =
    typeof content === "string" || typeof content === "number" ? (
      <UIText {...(textStyle ? { style: textStyle } : {})}>
        {String(content)}
      </UIText>
    ) : (
      content
    );

  // Headless: a bare layout container (single portal/fallback root). Style
  // only what the caller asked for.
  const bubble = (
    <Panel
      consumeInput={false}
      {...(padding ? { padding } : {})}
      {...(bg ? { bg } : {})}
    >
      {body}
    </Panel>
  );

  if (hasOverlay) {
    return (
      <>
        <RefPanel
          ref={(el) => setReference(el)}
          {...(disabled ? {} : { onHover: setHovered })}
        >
          {children}
        </RefPanel>
        {renderFloating(bubble)}
      </>
    );
  }

  // Inline fallback (no scene overlay): in-tree absolute bubble, no
  // collision handling. Side only (alignment is an overlay feature).
  const side = placement.split("-")[0];
  const edge: Partial<PanelProps> =
    side === "bottom"
      ? { top: "100%", margin: { top: offset } }
      : side === "left"
        ? { right: "100%", margin: { right: offset } }
        : side === "right"
          ? { left: "100%", margin: { left: offset } }
          : { bottom: "100%", margin: { bottom: offset } };

  return (
    <Panel position="relative" {...(disabled ? {} : { onHover: setHovered })}>
      {children}
      {open ? (
        <Panel position="absolute" {...edge} consumeInput={false}>
          {bubble}
        </Panel>
      ) : null}
    </Panel>
  );
}

/** A text label. */
export function UIText(props: TextProps): React.JSX.Element {
  const { children, ...rest } = props;
  return (
    <UIElementHost _ctor={UITextNode} _consumesText {...rest}>
      {children}
    </UIElementHost>
  );
}

export type SplitTextProps = OptionalResetProps<UIElementSplitTextProps>;

/**
 * Text split into per-character / per-word / per-line display objects for
 * animated text. Pair with {@link useSplitText} for a `[ref, controls]` tuple
 * to reach the live segments and `run` tweens programmatically:
 *
 * ```tsx
 * const [ref, split] = useSplitText();
 * const reveal = () =>
 *   split.run(Tween.stagger(split.chars, (c) => Tween.custom((v) => (c.alpha = v), 0, 1, 0.3), 0.05));
 * return <SplitText ref={ref} charAnchor={0.5} onPointerOver={reveal}>{label}</SplitText>;
 * ```
 *
 * No `truncate` / word-wrap (unlike `<Text>`) — pre-break with `\n`. The
 * underlying `SplitText` is experimental in Pixi.
 */
export const SplitText = forwardRef<UISplitTextNode, SplitTextProps>(
  function SplitText(props, ref) {
    const { children, ...rest } = props;
    return (
      <UIElementHost _ctor={UISplitTextNode} _consumesText {...rest} ref={ref}>
        {children}
      </UIElementHost>
    );
  },
);

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
  const { children, hoverBg, pressBg, textStyle, truncate, bitmap, ...rest } =
    props;
  const isPrimitiveLabel =
    typeof children === "string" || typeof children === "number";
  const content = isPrimitiveLabel ? (
    <UIText
      {...(textStyle ? { style: textStyle } : {})}
      {...(truncate ? { truncate } : {})}
      {...(bitmap !== undefined ? { bitmap } : {})}
    >
      {String(children)}
    </UIText>
  ) : (
    children
  );
  // `rest` still carries `bg` (see ButtonProps) — the reconciler's `_bgAlias`
  // marker expands it to `background`. `hoverBg`/`pressBg` are Button-only
  // sugar, mapped inline since no other element has those two states.
  return (
    <UIElementHost
      _ctor={UIButtonNode}
      _bgAlias
      {...rest}
      hoverBackground={hoverBg}
      pressBackground={pressBg}
    >
      {content}
    </UIElementHost>
  );
}

/** An image element displaying a texture. */
export function Image(props: ImageProps): React.JSX.Element {
  return <UIElementHost _ctor={UIImageNode} {...props} />;
}

/** A nine-slice panel with texture borders. */
export function NineSlice(props: NineSliceProps): React.JSX.Element {
  return <UIElementHost _ctor={UINineSliceNode} {...props} />;
}

/** A progress bar with track and fill. */
export function ProgressBar(props: ProgressBarProps): React.JSX.Element {
  return <UIElementHost _ctor={UIProgressBarNode} {...props} />;
}

/** An interactive checkbox with optional label. */
export function Checkbox(props: CheckboxProps): React.JSX.Element {
  return <UIElementHost _ctor={UICheckboxNode} {...props} />;
}

// ---------------------------------------------------------------------------
// @pixi/ui wrapper components
// ---------------------------------------------------------------------------

export type PixiFancyButtonReactProps =
  OptionalResetProps<UIElementPixiFancyButtonProps>;

/** @pixi/ui FancyButton with Yoga layout. */
export function PixiFancyButton(
  props: PixiFancyButtonReactProps,
): React.JSX.Element {
  return <UIElementHost _ctor={PixiFancyButtonNode} {...props} />;
}

export type PixiCheckboxReactProps =
  OptionalResetProps<UIElementPixiCheckboxProps>;

/** @pixi/ui CheckBox with Yoga layout. */
export function PixiCheckbox(props: PixiCheckboxReactProps): React.JSX.Element {
  return <UIElementHost _ctor={PixiCheckboxNode} {...props} />;
}

export type PixiProgressBarReactProps =
  OptionalResetProps<UIElementPixiProgressBarProps>;

/**
 * @pixi/ui ProgressBar with Yoga layout. `bg`/`fill` are the upstream
 * @pixi/ui view-slot props (required `PixiViewType`) — a different concept
 * from the style-config `background` on `<Panel>`/`<Button>`/`<ScrollView>`,
 * so they are NOT expanded by the shorthand alias table.
 */
export function PixiProgressBar(
  props: PixiProgressBarReactProps,
): React.JSX.Element {
  return <UIElementHost _ctor={PixiProgressBarNode} {...props} />;
}

export type PixiSliderReactProps = OptionalResetProps<UIElementPixiSliderProps>;

/** @pixi/ui Slider with Yoga layout. */
export function PixiSlider(props: PixiSliderReactProps): React.JSX.Element {
  return <UIElementHost _ctor={PixiSliderNode} {...props} />;
}

export type PixiInputReactProps = OptionalResetProps<UIElementPixiInputProps>;

/** @pixi/ui Input with Yoga layout. */
export function PixiInput(props: PixiInputReactProps): React.JSX.Element {
  return <UIElementHost _ctor={PixiInputNode} {...props} />;
}

interface ScrollViewOptions extends UIElementScrollViewProps {
  /** Shorthand for `background` (see {@link PanelProps.bg}). */
  bg?: BackgroundOptions;
}

export type ScrollViewReactProps = OptionalResetProps<ScrollViewOptions>;

/**
 * A clipped, scrollable container. Children are normal Yoga elements stacked
 * along `direction`; anything past the fixed viewport size scrolls via wheel
 * or drag, and the scroll position is preserved across re-renders. Size the
 * viewport with `height` / `flexGrow`; keep fixed siblings (e.g. a footer
 * button) outside the `<ScrollView>`.
 */
export const ScrollView = forwardRef<
  UIScrollView,
  PropsWithChildren<ScrollViewReactProps>
>(function ScrollView(props, ref) {
  const { children, ...rest } = props;
  return (
    <UIElementHost _ctor={UIScrollView} _bgAlias {...rest} ref={ref}>
      {children}
    </UIElementHost>
  );
});

export type PixiSelectReactProps = OptionalResetProps<UIElementPixiSelectProps>;

/** @pixi/ui Select dropdown with Yoga layout. */
export function PixiSelect(props: PixiSelectReactProps): React.JSX.Element {
  return <UIElementHost _ctor={PixiSelectNode} {...props} />;
}

export type PixiRadioGroupReactProps =
  OptionalResetProps<UIElementPixiRadioGroupProps>;

/** @pixi/ui RadioGroup with Yoga layout. */
export function PixiRadioGroup(
  props: PixiRadioGroupReactProps,
): React.JSX.Element {
  return <UIElementHost _ctor={PixiRadioGroupNode} {...props} />;
}
