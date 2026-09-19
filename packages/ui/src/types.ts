import type {
  ColorValue,
  DisplayContainer,
  DisplaySprite,
  GraphicsContext,
  PointLike,
  SegmentAnchor,
  TextStyle,
  TextureHandle,
  TextureInput,
  TextureResource,
} from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import type { UITreeContext } from "./internal/tree-context.js";

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
 * when a UISurface is added without a layer of its own.
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

/** Cross-axis alignment of a flex container's children. */
export type AlignItems =
  | "flex-start"
  | "center"
  | "flex-end"
  | "stretch"
  | "baseline";

/** Main-axis distribution of a flex container's children. */
export type JustifyContent =
  | "flex-start"
  | "center"
  | "flex-end"
  | "space-between"
  | "space-around"
  | "space-evenly";

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
  texture: TextureInput;
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

/**
 * Offset for a `position: "absolute"` edge. A raw number is pixels; a
 * `"<n>%"` string resolves against the containing block (the nearest
 * `position: "relative"` ancestor's content box) — the same reference box
 * CSS uses. So `top: "100%"` means "the containing block's full height down
 * from its top edge", i.e. flush against its bottom. This is what lets
 * edge-relative overlays (tooltips, dropdowns) anchor to a shrink-wrapped
 * trigger without measuring it.
 */
export type PositionValue = number | `${number}%`;

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
  /**
   * Shorthand for the common CSS `flex: <number>` case — expands to
   * `flexGrow: <number>`, `flexShrink: 1`, `flexBasis: 0`. Use it for a child
   * that should fill the remaining main-axis space (e.g. the text column
   * between a fixed icon and a fixed button): sizing from a `0` basis means it
   * won't claim its content width and push its siblings, and its text wraps
   * cleanly. Prefer this over `flexGrow: 1` alone, which keeps `flexBasis: auto`
   * (content width) and overflows. Explicit `flexGrow`/`flexShrink`/`flexBasis`
   * override the parts this expands to.
   */
  flex?: number;
  alignSelf?:
    | "auto"
    | "flex-start"
    | "center"
    | "flex-end"
    | "stretch"
    | "baseline";
  /**
   * Positioning mode for this element relative to its parent. Defaults to
   * `"relative"` — the element flows in the parent's flex layout. Set to
   * `"absolute"` to lift the element out of the flow and pin it via
   * `left` / `top` / `right` / `bottom` against the parent's content box.
   *
   * A `position: "relative"` ancestor acts as the containing block for any
   * absolute-positioned descendants — useful for HUD overlays, modal
   * backdrops, and badge markers. See `<ZStack>` in `@yagejs/ui-react` for
   * an opinionated overlay primitive.
   */
  position?: "relative" | "absolute";
  /** Offset from the containing block's left edge — px or `"<n>%"` (only applies to `position: "absolute"`). */
  left?: PositionValue;
  /** Offset from the containing block's top edge — px or `"<n>%"` (only applies to `position: "absolute"`). */
  top?: PositionValue;
  /** Offset from the containing block's right edge — px or `"<n>%"` (only applies to `position: "absolute"`). */
  right?: PositionValue;
  /** Offset from the containing block's bottom edge — px or `"<n>%"` (only applies to `position: "absolute"`). */
  bottom?: PositionValue;
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
  /**
   * Take the context of the UI tree this element belongs to: the name a
   * development warning prints, and the scene's focus stack. Containers
   * implement it and pass it on to their children; a leaf that neither warns
   * nor hosts a scope leaves it out. An element written outside this package
   * that implements neither hook gets no warning label and never hosts a focus
   * scope, and nothing reports that.
   * @internal
   */
  _attachToTree?(context: UITreeContext): void;
  /**
   * Drop the tree context, unregistering any focus scope this element hosts.
   * Called from a container's `removeElement` and from `destroy()`.
   * @internal
   */
  _detachFromTree?(): void;
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

/**
 * Per-component opt-out for the UI auto-consume pointer fallback.
 *
 * Every UI primitive (UIButton, UICheckbox, UIPanel, UIImage, UINineSlice,
 * UIProgressBar, UIText) marks its underlying Pixi container so that
 * `pointerdown` events landing on it (or any descendant) are auto-claimed by
 * `@yagejs/input` via the renderer's hit-test fallback — preventing taps on
 * UI from also firing gameplay actions like `MouseLeft`.
 *
 * Set `consumeInput: false` on a specific element to make it transparent to
 * the action map: pointer events still fire its own handlers (e.g. an
 * `onClick` callback) but also propagate to gameplay actions. Useful for
 * cosmetic overlays (decorative HUD borders, full-screen filters) that should
 * not block clicks on the world behind them.
 */
export interface ConsumeInputProps {
  consumeInput?: boolean;
}

/**
 * Hover/pointer callbacks shared by the interactive UI primitives. Every UI
 * primitive's Pixi container is already `eventMode: "static"` (the
 * consume-input fallback), so wiring these is a small fan-out, not new infra.
 *
 * - `onPointerOver` / `onPointerOut` mirror the underlying Pixi events and
 *   the existing `onClick` naming — reach for these when enter and leave
 *   need independent handlers.
 * - `onHover(hovering)` is the convenience form: called with `true` on
 *   enter and `false` on leave. Ideal for "show while hovered" toggles
 *   (tooltips, detail popovers) where one setter handles both edges.
 *
 * All three are independent and may be combined. `UIButton`, `UICheckbox` and
 * the interactive `@pixi/ui` wrappers suppress all three while they are
 * disabled.
 */
export interface PointerEventProps {
  onPointerOver?: () => void;
  onPointerOut?: () => void;
  onHover?: (hovering: boolean) => void;
}

// ---------------------------------------------------------------------------
// Keyboard / gamepad focus
// ---------------------------------------------------------------------------

/** The four directions a focus scope moves in. */
export type FocusDirection = "up" | "down" | "left" | "right";

/**
 * What pointer input does to focus inside a scope, set through
 * {@link UIFocusScopeOptions.pointerFocus}.
 *
 * - `"press"` — pressing a control focuses it, the way clicking a control on
 *   a web page focuses it. Moving the pointer across the menu changes which
 *   control looks hovered and nothing else.
 * - `"hover"` — moving the pointer over a control focuses it as well, which
 *   is what a console-style menu with one lit row wants.
 * - `"none"` — the pointer never moves focus, so the keyboard keeps its row
 *   whatever the mouse does.
 *
 * Hovered and pressed are the element's own looks and are painted under every
 * setting, as is the action a click runs.
 */
export type PointerFocusMode = "none" | "press" | "hover";

/**
 * Per-direction override of the position rule, addressed by
 * {@link FocusProps.focusId}.
 *
 * A string matching a current candidate wins outright. `null` stops movement
 * in that direction: no position fallback, no wrap, and `move` returns
 * `false`. An absent key, or a string matching nothing at the moment, falls
 * through to the position rule, so a row hidden by a filter does not strand
 * its neighbour.
 *
 * Ids rather than element references, because a sibling's props holding an
 * element would keep a removed element alive.
 */
export interface FocusNeighbors {
  up?: string | null;
  down?: string | null;
  left?: string | null;
  right?: string | null;
}

/**
 * How the outline around a focused element is drawn.
 *
 * An outline is drawn only where one is asked for: set this once for the
 * whole UI through `UIPluginOptions.focusStyle`, or for one element through
 * {@link FocusProps.focusStyle}. Where neither names a style the element
 * draws no outline, and a game shows focus its own way — a marker beside the
 * row, a swapped sprite, a sound — from {@link FocusProps.onFocusChange}.
 *
 * Each field resolves on its own: the element's value, then the UI-wide one,
 * then the default below.
 */
export interface UIFocusStyle {
  /**
   * Stroke colour. Defaults to the fill of the UI default text style when
   * that names a colour number, so a game that themed its text already said
   * what its foreground is; white otherwise.
   */
  color?: number;
  /** Stroke thickness in px. Default `2`. */
  width?: number;
  /**
   * Corner radius. Defaults to the element's own background radius where it
   * has one, so a themed button and the widget beside it are rounded the
   * same while focused, and to `4` otherwise.
   */
  radius?: number;
  /**
   * Gap in px between the element's box and the outline's outer edge.
   * Default `0`. The outline is drawn inside the box whatever this is, so it
   * never changes a measured size or reaches over a neighbour.
   */
  inset?: number;
}

/**
 * The rectangle a focus outline is drawn around, in the local space of the
 * Pixi container that holds it.
 *
 * A `@pixi/ui` wrapper states its own through `PixiUIBase.focusOutlineBox`
 * when the parts it draws do not match the box layout gave it.
 */
export interface UIFocusOutlineBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The element's own corner radius, followed when no style names one. */
  readonly radius?: number;
}

/**
 * Focus participation for one element, mixed into every element props
 * interface beside {@link PointerEventProps}.
 *
 * Every callback here runs through the UI error boundary, so a throw is
 * attributed to the element and rethrown.
 */
export interface FocusProps {
  /**
   * Take part in focus navigation. Omitted, the element's own default
   * applies: `true` for `UIButton`, `UICheckbox` and the six interactive
   * `@pixi/ui` wrappers, `false` for everything else. `focusable: false`
   * takes an element out of navigation without disabling it, so the pointer
   * still reaches it.
   */
  focusable?: boolean;
  /**
   * Name this element so a sibling's {@link FocusProps.focusNeighbors} can
   * point at it. Unique inside one scope: two elements claiming one id draw a
   * development warning, and the first in tree order answers to it.
   */
  focusId?: string;
  /** Per-direction overrides of the position rule. */
  focusNeighbors?: FocusNeighbors;
  /**
   * Called with `true` when focus arrives and `false` when it leaves,
   * including when the scope stops taking input. This is how most games show
   * focus — a marker beside the row, a swapped sprite, a sound — since an
   * element draws an outline only where a {@link FocusProps.focusStyle} asks
   * for one.
   */
  onFocusChange?: (focused: boolean) => void;
  /**
   * Called with `-1` for left and `1` for right while this element is
   * focused, consuming that press — what a volume or difficulty row needs.
   * Up and down always move focus, so a column of stepper rows stays
   * traversable.
   */
  onAdjust?: (direction: -1 | 1) => void;
  /**
   * The focus outline for this element alone. Each field falls back to the
   * plugin-level `focusStyle`, then to the built-in default; `null` draws no
   * outline here, which is how one element opts out of a UI-wide one.
   *
   * Omitted, the element draws the UI-wide outline, or none at all when the
   * plugin names no style either.
   */
  focusStyle?: UIFocusStyle | null;
}

/**
 * Action names a focus scope polls, one role per key, merged over the
 * defaults `move-up`, `move-down`, `move-left`, `move-right`, `interact` and
 * `cancel`. A role takes one name or a list, so a game whose map carries both
 * `interact` and `attack` can bind both to confirm.
 *
 * A scope consumes nothing it polls: a confirm press that activates a menu
 * row is still visible to gameplay code reading the same action in that same
 * frame. Keeping menu input out of gameplay is what input groups
 * (`InputManager.setActiveGroups`) are for.
 */
export interface UIFocusInputOptions {
  up?: string | readonly string[];
  down?: string | readonly string[];
  left?: string | readonly string[];
  right?: string | readonly string[];
  confirm?: string | readonly string[];
  cancel?: string | readonly string[];
  /**
   * Hold-to-repeat, applied to the four directions only — confirm and cancel
   * never repeat. Defaults to `true`, taking the input package's own delay
   * and interval. Repeats count on the raw input clock, so a pause menu keeps
   * repeating while its scene is paused.
   */
  repeat?: boolean | { delay?: number; interval?: number };
}

/**
 * How one focus scope behaves, passed as {@link UIPanelProps.focus}.
 *
 * `onFocusMove`, `onActivate` and `onMoveBlocked` are the scope-wide cue
 * hooks: one handler for a whole menu rather than one closure per row. All
 * four callbacks run through the UI error boundary against the host
 * container.
 */
export interface UIFocusScopeOptions {
  /**
   * Return to the first element against the direction when a move runs past
   * the last one. Defaults to `true`; `false` refuses the move instead.
   */
  wrap?: boolean;
  /**
   * Focus the first candidate in tree order the first time the scope takes
   * input with nothing remembered. Defaults to `true`.
   */
  autoFocus?: boolean;
  /**
   * Rename the polled actions per role. `null` reads no device at all: the
   * game drives the scope through `move()`, `activate()` and `cancel()`,
   * while pointer focus and the scroll follow keep working.
   */
  input?: UIFocusInputOptions | null;
  /**
   * What pointer input does to focus. Defaults to `"press"`: pressing a
   * control focuses it, and passing the pointer over one leaves focus where
   * the keyboard put it.
   */
  pointerFocus?: PointerFocusMode;
  /**
   * Own the pointer as well as the keys while this scope reads input.
   * Defaults to `true`: everything drawn under the scope stops answering the
   * pointer, so a confirm dialog cannot be clicked through — no hover look,
   * no press, no click on the menu behind it — and a press on the blocked
   * area is claimed for the UI rather than reaching the game's action map.
   * The scope's own subtree keeps every pointer behaviour it has, and a scope
   * nested inside another blocks only what is outside itself.
   *
   * `false` leaves the pointer alone, for a panel that wants the keys while
   * the world behind it stays clickable.
   */
  modal?: boolean;
  /**
   * Px kept between a focused element and the edge of an enclosing
   * `UIScrollView`. Defaults to `8`; must be finite and at or above zero.
   */
  scrollPadding?: number;
  /** Called after focus lands somewhere else, with both elements. */
  onFocusMove?: (element: UIElement | null, previous: UIElement | null) => void;
  /** Called after the focused element's own action has run. */
  onActivate?: (element: UIElement) => void;
  /**
   * Called when a move finds nothing in that direction. This is the only way
   * to hear a refused move, since the scope drives itself.
   */
  onMoveBlocked?: (direction: FocusDirection) => void;
  /** Called on the cancel action and on `cancel()`. */
  onCancel?: () => void;
}

/**
 * Options for `UIScrollView.scrollIntoView`. The `UI` prefix keeps the name
 * clear of the DOM lib's global `ScrollIntoViewOptions`.
 */
export interface UIScrollIntoViewOptions {
  /**
   * Where the element lands in the viewport. `"nearest"`, the default,
   * scrolls the least distance that brings it inside and leaves an element
   * already fully visible where it is.
   */
  align?: "nearest" | "start" | "center" | "end";
  /**
   * Px kept between the element and the viewport edge. Defaults to `0`; must
   * be finite and at or above zero.
   */
  padding?: number;
}

/** Props for UIText (used by reconciler and props-driven constructor). */
export interface UITextProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  children?: string;
  style?: Partial<TextStyle>;
  /**
   * Overflow behavior when the rendered text is wider than the layout slot:
   *   - omitted: wrap to the layout width (default)
   *   - `"clip"`: render a single line; visible overflow is cut by the
   *     parent panel's `overflow` setting.
   *   - `"ellipsis"`: render a single line truncated with {@link
   *     UITextProps.truncateWith} so the text fits within the layout width.
   */
  truncate?: "clip" | "ellipsis";
  /**
   * String the `"ellipsis"` truncate mode appends. Defaults to `"…"`
   * (U+2026), which several pixel fonts lack — pass `"..."` for one of those.
   */
  truncateWith?: string;
  /**
   * Render with a bitmap font instead of canvas-rasterised `Text`. Pixel-art
   * escape hatch — canvas text blurs at non-integer scale on non-Retina
   * displays. Pixi bakes or looks up the glyph atlas from `style.fontFamily`
   * (the name an `installBitmapFont` call registered, or any font for a
   * dynamic bake) at `style.fontSize`. Yoga measurement (wrap / truncate) is
   * unchanged.
   */
  bitmap?: boolean;
  /**
   * Per-text render resolution. Mirrors the Pixi v8 `Text` constructor
   * option — `resolution` is NOT a `TextStyle` property in v8, so this is
   * the only way to get crisp canvas text without a prototype patch.
   * Ignored when `bitmap` is set.
   */
  resolution?: number;
}

/** Props for UISplitText (used by reconciler and props-driven constructor). */
export interface UISplitTextProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  children?: string;
  style?: Partial<TextStyle>;
  /**
   * Render the segments with a bitmap font (`SplitBitmapText`) instead of
   * canvas `Text` (`SplitText`). Pass the installed/baked font name as
   * `style.fontFamily` (and glyph size as `style.fontSize`).
   */
  bitmap?: boolean;
  /** Transform origin (0–1) each character rotates / scales about. Default `0`. */
  charAnchor?: SegmentAnchor;
  /** Transform origin (0–1) each word rotates / scales about. Default `0`. */
  wordAnchor?: SegmentAnchor;
  /** Transform origin (0–1) each line rotates / scales about. Default `0`. */
  lineAnchor?: SegmentAnchor;
  /**
   * Re-split automatically on `text` / `style` change. Default `true`. Set
   * `false` and call `resplit()` to batch edits into one layout pass.
   */
  autoSplit?: boolean;
}

/** Props for UIButton (used by reconciler and props-driven constructor). */
export interface UIButtonProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  children?: string;
  onClick?: () => void;
  background?: BackgroundOptions;
  hoverBackground?: BackgroundOptions;
  pressBackground?: BackgroundOptions;
  /**
   * Background painted while the button holds focus and the pointer is not
   * on it — the filled selected row some menus want, under any focus outline
   * a `focusStyle` asks for. Omitted, a focused button keeps its resting
   * background. An override supplying only a colour keeps the resting corner
   * radius.
   */
  focusBackground?: BackgroundOptions;
  textStyle?: Partial<TextStyle>;
  /**
   * Bitmap font for the auto-wrapped string label (forwarded to the inner
   * `UIText`). No effect when `children` is a composed element — set `bitmap`
   * on the `UIText` directly in that case.
   */
  bitmap?: boolean;
  /**
   * Overflow behavior for the auto-wrapped string label, forwarded to the
   * internal {@link UITextProps.truncate}. Omitted, the label wraps to the
   * button's content width (and an auto-height button grows to fit). Set
   * `"clip"` / `"ellipsis"` to keep the label on a single line so it can't
   * spill out of a fixed-size button — the safe choice for variable-length
   * (i18n) labels.
   */
  truncate?: "clip" | "ellipsis";
  /**
   * String the `"ellipsis"` truncate mode appends, forwarded to the internal
   * label. Defaults to `"…"` (U+2026), which several pixel fonts lack — pass
   * `"..."` for one of those.
   */
  truncateWith?: string;
  disabled?: boolean;
  /**
   * Direction of the button's own children, for icon-plus-label content added
   * with `addElement`. Defaults to `"column"`, so set `"row"` for a row.
   */
  direction?: FlexDirection;
  /** Space between the button's children. */
  gap?: number;
  /**
   * Padding inside the button. Replaces the default 12 px horizontal and 6 px
   * vertical padding; drop the prop to get that default back.
   */
  padding?: Padding;
  /** Cross-axis alignment of the button's children. Defaults to `"center"`. */
  alignItems?: AlignItems;
  /** Main-axis distribution of the button's children. Defaults to `"center"`. */
  justifyContent?: JustifyContent;
}

/**
 * Everything a `UIText` accepts except the two the `panel.text(...)` /
 * `surface.text(...)` / `scrollView.text(...)` builders already take as
 * positional arguments.
 */
export type UITextBuilderProps = Omit<UITextProps, "children" | "style">;

/** Props for UIPanel (used by reconciler and props-driven constructor). */
export interface UIPanelProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  direction?: FlexDirection;
  gap?: number;
  padding?: Padding;
  alignItems?: AlignItems;
  justifyContent?: JustifyContent;
  overflow?: "visible" | "hidden";
  background?: BackgroundOptions;
  /**
   * Background painted while a `focusable` panel holds focus — the filled
   * selected row some menus want, under any focus outline a `focusStyle`
   * asks for. Omitted, a focused panel keeps its resting background. An
   * override supplying only a colour keeps the resting corner radius. A panel
   * with no `background` of its own paints this fill while focused and nothing
   * at rest, which is the menu row that is transparent until it is selected.
   */
  focusBackground?: BackgroundOptions;
  /**
   * Make this panel a focus scope over its descendants, so keyboard and
   * gamepad input walks them. `true` takes every default; an object sets
   * them. Reached afterwards through `panel.focusScope`.
   *
   * Among those defaults, the scope reading input also owns the pointer:
   * everything drawn under it stops answering the mouse until it hands the
   * keys back. {@link UIFocusScopeOptions.modal} turns that off.
   *
   * Passing `focus` again through `update()` refreshes the existing scope's
   * options in place, so re-rendering with a fresh object literal keeps
   * focus where it is; passing `false` or an explicit `undefined` disposes
   * the scope.
   */
  focus?: boolean | UIFocusScopeOptions;
}

/**
 * Props for UIImage.
 *
 * Size one of `width` / `height` and the other follows the texture's aspect
 * ratio, even where a flex parent would stretch it. Size both and the texture
 * stretches to that box. Size neither and the element takes the texture's own
 * pixel size. `flexGrow`, `flex` and `flexBasis` size the main axis too, so
 * with one of those set the texture stretches as if both axes were sized.
 */
export interface UIImageProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  texture: TextureInput;
  tint?: number;
  alpha?: number;
}

/** Props for UINineSlice. */
export interface UINineSliceProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  texture: TextureInput;
  insets: { left: number; top: number; right: number; bottom: number } | number;
  tint?: number;
  alpha?: number;
}

/** Props for UIProgressBar. */
export interface UIProgressBarProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  value: number;
  trackBackground?: BackgroundOptions;
  fillBackground?: BackgroundOptions;
  direction?: "horizontal" | "vertical";
}

/** Props for UICheckbox. */
export interface UICheckboxProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
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
export interface PixiFancyButtonProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
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
  textOffset?: { x?: number; y?: number } & {
    [K in "default" | "hover" | "pressed" | "disabled"]?: {
      x?: number;
      y?: number;
    };
  };
}

/** Props for PixiCheckbox. */
export interface PixiCheckboxProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  checkedView: PixiViewType;
  uncheckedView: PixiViewType;
  text?: string;
  textStyle?: Partial<TextStyle>;
  textOffset?: { x?: number; y?: number };
}

/** Props for PixiProgressBar. */
export interface PixiProgressBarProps
  extends LayoutProps, ConsumeInputProps, FocusProps {
  value: number;
  bg: PixiViewType;
  fill: PixiViewType;
  fillPaddings?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  nineSliceSprite?: [number, number, number, number];
}

/** Props for PixiSlider. */
export interface PixiSliderProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
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
  fillPaddings?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  nineSliceSprite?: [number, number, number, number];
}

/** Props for PixiInput. */
export interface PixiInputProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
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

/** Size / style of the `ScrollView` scrollbar thumb. */
export interface ScrollbarOptions {
  /** Thumb thickness (cross-axis) in px. Default `4`. */
  thickness?: number;
  /** Thumb color. Default `0xffffff`. */
  color?: number;
  /** Thumb alpha. Default `0.4`. */
  alpha?: number;
  /** Thumb corner radius. Default `thickness / 2`. */
  radius?: number;
  /** Minimum thumb length along the scroll axis in px. Default `20`. */
  minThumbLength?: number;
  /** Gap between the thumb and the viewport edge in px. Default `2`. */
  margin?: number;
}

/**
 * Props for `UIScrollView` / `<ScrollView>`.
 *
 * The viewport box is sized via the inherited `LayoutProps` (`width` /
 * `height` / `flexGrow` …). Content overflowing the scroll axis is clipped
 * and pannable. `gap` / `padding` apply to the inner content stack.
 */
export interface UIScrollViewProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  /** Scroll/stack axis. Default `"vertical"`. */
  direction?: "vertical" | "horizontal";
  /** Gap between child cards (forwarded to the content stack). */
  gap?: number;
  /** Padding inside the content stack. */
  padding?: Padding;
  /**
   * Scrollbar thumb. `true` (default) / omitted → default style; `false` →
   * hidden (and no gutter reserved); an object → custom size / style. When
   * shown, a gutter equal to the thumb's footprint is reserved on the
   * scroll-cross edge so content never renders under the thumb.
   */
  scrollbar?: boolean | ScrollbarOptions;
  /** Background drawn behind the clipped content. */
  background?: BackgroundOptions;
  /** Called when the scroll offset changes. */
  onScroll?: (offset: number) => void;
}

/** Props for PixiSelect. */
export interface PixiSelectProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
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
export interface PixiRadioGroupProps
  extends LayoutProps, ConsumeInputProps, PointerEventProps, FocusProps {
  items: PixiCheckboxProps[];
  type: "vertical" | "horizontal";
  elementsMargin: number;
  selected?: number;
  onChange?: (selectedIndex: number, selectedValue: string) => void;
}

// ---------------------------------------------------------------------------
// Component options
// ---------------------------------------------------------------------------

/** Positioning mode for a surface's root panel. */
export type UIPositioning = "anchor" | "transform";

/**
 * Options for creating a UISurface (the Component that mounts a UI tree on an
 * entity).
 *
 * Extending `UIPanelProps` means the surface takes the root panel's props
 * directly, {@link UIPanelProps.focus} among them: `new UISurface({ focus:
 * true })` turns the whole surface into one keyboard- and gamepad-driven
 * focus scope, reached afterwards through `surface.focusScope`.
 */
export interface UISurfaceOptions extends UIPanelProps {
  anchor?: Anchor;
  offset?: { x: number; y: number };
  /**
   * Target UI layer name on the scene's render tree. Defaults to
   * `UI_DEFAULT_LAYER` (`"ui"`), which is auto-provisioned as a
   * screen-space layer via `SceneRenderTreeKey.ensureLayer(...)` on first
   * use. Any other explicit name must be declared on the scene's
   * `readonly layers` or the component throws on add.
   */
  layer?: string;
  /**
   * How the surface's root container is positioned each frame.
   *
   * - `"anchor"` (default) — resolve `anchor` against the viewport
   *   (`virtualSize`). Classic HUD/menu behavior.
   * - `"transform"` — read `entity.get(Transform).worldPosition` and
   *   reinterpret `anchor` as the pivot on the panel itself
   *   (e.g. `BottomCenter` → panel's bottom-center sits at the
   *   Transform). Requires a `Transform` on the entity. The panel is
   *   positioned in the layer's local coords, so this plays with any
   *   layer type: screen-space layers (paired with a `ScreenFollow`
   *   component that writes projected screen coords) for constant-size
   *   billboards, or world-space layers for genuinely diegetic UI that
   *   scales with the camera.
   */
  positioning?: UIPositioning;
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
