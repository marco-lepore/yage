import type {
  LocalizableText,
  Localization,
  LocalizedBinding,
} from "@yagejs/core";
import type {
  ColorValue,
  DisplayContainer,
  DisplaySprite,
  GraphicsContext,
  PointLike,
  SegmentAnchor,
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
   * Bind this element (and any children) to the scene's localization service so
   * any {@link LocalizedBinding} text re-resolves on locale change. Propagated
   * by the owning {@link UIPanel} on add; `undefined` when no plugin is
   * registered (bindings render their default). Implemented by text-bearing
   * elements and containers.
   */
  attachLocalization?(localization: Localization | undefined): void;
  /** Release localization subscriptions. Propagated on remove / move. */
  detachLocalization?(): void;
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
 * All three are independent and may be combined. Callbacks are suppressed
 * while the element is disabled (currently only `UIButton` has a disabled
 * state).
 */
export interface PointerEventProps {
  onPointerOver?: () => void;
  onPointerOut?: () => void;
  onHover?: (hovering: boolean) => void;
}

/** Props for UIText (used by reconciler and props-driven constructor). */
export interface UITextProps
  extends LayoutProps,
    ConsumeInputProps,
    PointerEventProps {
  /** The label text — a literal, or a {@link LocalizedBinding} (via `msg`)
   *  that re-resolves when the locale changes. */
  children?: string | LocalizedBinding;
  style?: Partial<TextStyle>;
  /**
   * Overflow behavior when the rendered text is wider than the layout slot:
   *   - omitted: wrap to the layout width (default)
   *   - `"clip"`: render a single line; visible overflow is cut by the
   *     parent panel's `overflow` setting.
   *   - `"ellipsis"`: render a single line truncated with `…` so the text
   *     fits within the layout width.
   */
  truncate?: "clip" | "ellipsis";
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
  extends LayoutProps,
    ConsumeInputProps,
    PointerEventProps {
  /** The text to render and segment — a literal, or a {@link LocalizedBinding}
   *  (via `msg`) that re-resolves on locale change (forcing a resplit). */
  children?: string | LocalizedBinding;
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
  extends LayoutProps,
    ConsumeInputProps,
    PointerEventProps {
  /** The button label — a literal, or a {@link LocalizedBinding} (via `msg`)
   *  that re-resolves on locale change. */
  children?: string | LocalizedBinding;
  onClick?: () => void;
  background?: BackgroundOptions;
  hoverBackground?: BackgroundOptions;
  pressBackground?: BackgroundOptions;
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
  disabled?: boolean;
}

/** Props for UIPanel (used by reconciler and props-driven constructor). */
export interface UIPanelProps
  extends LayoutProps,
    ConsumeInputProps,
    PointerEventProps {
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
export interface UIImageProps
  extends LayoutProps,
    ConsumeInputProps,
    PointerEventProps {
  texture: TextureHandle;
  tint?: number;
  alpha?: number;
}

/** Props for UINineSlice. */
export interface UINineSliceProps
  extends LayoutProps,
    ConsumeInputProps,
    PointerEventProps {
  texture: TextureHandle;
  insets:
    | { left: number; top: number; right: number; bottom: number }
    | number;
  tint?: number;
  alpha?: number;
}

/** Props for UIProgressBar. */
export interface UIProgressBarProps
  extends LayoutProps,
    ConsumeInputProps,
    PointerEventProps {
  value: number;
  trackBackground?: BackgroundOptions;
  fillBackground?: BackgroundOptions;
  direction?: "horizontal" | "vertical";
}

/** Props for UICheckbox. */
export interface UICheckboxProps extends LayoutProps, ConsumeInputProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  size?: number;
  boxColor?: number;
  checkColor?: number;
  /** The label text — a literal, or a {@link LocalizedBinding} (via `msg`)
   *  that re-resolves on locale change. */
  label?: string | LocalizedBinding;
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
export interface PixiFancyButtonProps extends LayoutProps, ConsumeInputProps {
  defaultView?: PixiViewType;
  hoverView?: PixiViewType;
  pressedView?: PixiViewType;
  disabledView?: PixiViewType;
  /** Button label — a literal, or a {@link LocalizedBinding} (via `msg`) that
   *  re-resolves on locale change. */
  text?: LocalizableText;
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
export interface PixiCheckboxProps extends LayoutProps, ConsumeInputProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  checkedView: PixiViewType;
  uncheckedView: PixiViewType;
  /** Label text — a literal, or a {@link LocalizedBinding} (via `msg`) that
   *  re-resolves on locale change. */
  text?: LocalizableText;
  textStyle?: Partial<TextStyle>;
  textOffset?: { x?: number; y?: number };
}

/** Props for PixiProgressBar. */
export interface PixiProgressBarProps extends LayoutProps, ConsumeInputProps {
  value: number;
  bg: PixiViewType;
  fill: PixiViewType;
  fillPaddings?: { top?: number; right?: number; bottom?: number; left?: number };
  nineSliceSprite?: [number, number, number, number];
}

/** Props for PixiSlider. */
export interface PixiSliderProps extends LayoutProps, ConsumeInputProps {
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
export interface PixiInputProps extends LayoutProps, ConsumeInputProps {
  bg: PixiViewType;
  textStyle?: Partial<TextStyle>;
  /** Placeholder shown while empty — a literal, or a {@link LocalizedBinding}
   *  (via `msg`) that re-resolves on locale change. The typed `value` stays a
   *  plain string: it is user input, never localized. */
  placeholder?: LocalizableText;
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
export interface UIScrollViewProps extends LayoutProps, ConsumeInputProps {
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
export interface PixiSelectProps extends LayoutProps, ConsumeInputProps {
  closedBG: PixiViewType;
  openBG: PixiViewType;
  /** Dropdown options — literals, or {@link LocalizedBinding}s (via `msg`) that
   *  re-resolve on locale change (item text, the selected label, and each
   *  item's emitted `onSelect` text all update; open/selected/scroll state is
   *  preserved). */
  items: LocalizableText[];
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
export interface PixiRadioGroupProps extends LayoutProps, ConsumeInputProps {
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

/** Options for creating a UISurface (the Component that mounts a UI tree on an entity). */
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
