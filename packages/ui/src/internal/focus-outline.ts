/**
 * The focused look a game opts into: one outline, drawn the same way by every
 * focusable element, asked for through the UI plugin or per element. Where
 * nothing asks for one, nothing is drawn. Hover and press stay fills, so an
 * element that is both hovered and focused shows both.
 */

import { Graphics } from "pixi.js";
import type { DisplayContainer } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import type { FocusProps, UIFocusOutlineBox, UIFocusStyle } from "../types.js";
import { getUIDefaultTextStyle } from "../text-defaults.js";
import { ABOVE_ELEMENTS } from "./element-transform.js";

/** Outline colour when the UI default text style names no colour number. */
const FALLBACK_COLOR = 0xffffff;
/** Stroke thickness, in the px an element's layout box is measured in. */
const DEFAULT_WIDTH = 2;
/** Corner radius for an element that carries no radius of its own. */
const DEFAULT_RADIUS = 4;
/** Gap between the element's box and the outline's outer edge. */
const DEFAULT_INSET = 0;

// When two engines share a page, the most recently installed UIPlugin wins.
let uiFocusStyle: UIFocusStyle | undefined;

/**
 * Store the UI-level focus outline style, read by every focusable element at
 * paint time.
 */
export function setUIFocusStyle(style: UIFocusStyle | null | undefined): void {
  uiFocusStyle = style ? { ...style } : undefined;
}

/** Current UI-level focus outline style, if any. */
export function getUIFocusStyle(): UIFocusStyle | undefined {
  return uiFocusStyle;
}

/** The box layout gave an element, in its container's local space. */
export function layoutBox(node: YogaNode, radius?: number): UIFocusOutlineBox {
  const box = {
    x: 0,
    y: 0,
    width: node.getComputedWidth(),
    height: node.getComputedHeight(),
  };
  return radius === undefined ? box : { ...box, radius };
}

/** Every field of the outline style, with the fallbacks filled in. */
export interface ResolvedFocusStyle {
  readonly color: number;
  readonly width: number;
  readonly radius: number;
  readonly inset: number;
}

/**
 * The colour an outline takes when nothing names one: the fill of the UI
 * default text style, or white when that fill is not a colour number.
 */
function themedColor(): number {
  const fill = getUIDefaultTextStyle()?.fill;
  return typeof fill === "number" ? fill : FALLBACK_COLOR;
}

/**
 * The outline an element carrying `override` draws, or `null` where it draws
 * none: nothing named a style, or the element named `null` to opt out of the
 * UI-wide one. Each field resolves from the element's own value, then the
 * UI-wide one, then the default. `fallbackRadius` is the element's own corner
 * radius.
 * @internal
 */
export function resolveFocusStyle(
  override: UIFocusStyle | null | undefined,
  fallbackRadius?: number,
): ResolvedFocusStyle | null {
  const themed = uiFocusStyle;
  if (override === null || (override === undefined && themed === undefined)) {
    return null;
  }
  return {
    color: override?.color ?? themed?.color ?? themedColor(),
    width: override?.width ?? themed?.width ?? DEFAULT_WIDTH,
    radius:
      override?.radius ?? themed?.radius ?? fallbackRadius ?? DEFAULT_RADIUS,
    inset: override?.inset ?? themed?.inset ?? DEFAULT_INSET,
  };
}

/** What one element tells its outline about where to draw. */
export interface FocusOutlineHost {
  /** Container the outline is drawn into, as a non-measurable child. */
  readonly container: DisplayContainer;
  /**
   * The rectangle to outline, in `container`'s own local space, which is
   * measured in layout pixels.
   */
  box(): UIFocusOutlineBox;
}

/** The geometry and colour one stroke was laid down from. */
interface DrawnOutline {
  readonly x: number;
  readonly y: number;
  readonly edge: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly color: number;
  readonly strokeWidth: number;
}

/**
 * The outline one element draws while it holds focus, where a style asks for
 * one. The graphics is built on the first stroke, redrawn from the element's
 * layout pass, and drawn inside the box so it never covers a neighbour.
 */
export class FocusOutline {
  private readonly host: FocusOutlineHost;
  private graphics: Graphics | undefined;
  private style: UIFocusStyle | null | undefined;
  private _focused = false;
  private drawn: DrawnOutline | undefined;

  constructor(host: FocusOutlineHost) {
    this.host = host;
  }

  /** Swap the element's own `focusStyle` in place, by key presence. */
  set(props: FocusProps): void {
    if (!("focusStyle" in props)) return;
    this.style = props.focusStyle;
    this.refresh();
  }

  /** Show the outline, or hide it and leave the element's fills alone. */
  setFocused(focused: boolean): void {
    this._focused = focused;
    this._paint();
  }

  /** Redraw at the box the element occupies now. Call it from `applyLayout`. */
  refresh(): void {
    if (!this._focused) return;
    this._paint();
  }

  destroy(): void {
    this.graphics?.destroy();
    this.graphics = undefined;
    this.drawn = undefined;
    this._focused = false;
  }

  private _build(): Graphics {
    const graphics = new Graphics();
    this.drawn = undefined;
    // Left out of local bounds, so taking focus changes no measured size, nor
    // the width and height a wrapper's `applyLayout` writes into its widget.
    graphics.measurable = false;
    graphics.zIndex = ABOVE_ELEMENTS;
    this.host.container.addChild(graphics);
    this.graphics = graphics;
    return graphics;
  }

  private _paint(): void {
    if (!this._focused) {
      this._hide();
      return;
    }
    const box = this.host.box();
    if (
      !Number.isFinite(box.x) ||
      !Number.isFinite(box.y) ||
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height)
    ) {
      // Not measured yet. The layout pass that measures it calls `refresh`.
      return;
    }
    const style = resolveFocusStyle(this.style, box.radius);
    if (style === null) {
      this._hide();
      return;
    }
    const graphics = this.graphics ?? this._build();
    graphics.visible = true;
    this._draw(graphics, box, style);
  }

  private _hide(): void {
    if (this.graphics) this.graphics.visible = false;
  }

  private _draw(
    graphics: Graphics,
    box: UIFocusOutlineBox,
    style: ResolvedFocusStyle,
  ): void {
    // Half the stroke sits either side of the path, so the path runs half a
    // width inside the box and the outline's outer edge lands on the box.
    const edge = style.inset + style.width / 2;
    const width = box.width - edge * 2;
    const height = box.height - edge * 2;
    const radius = Math.max(0, style.radius - edge);

    // Skip a stroke identical to the one already drawn: a focused element
    // runs the layout pass every frame, and re-tessellating a rounded
    // rectangle allocates.
    const drawn = this.drawn;
    if (
      drawn !== undefined &&
      drawn.x === box.x &&
      drawn.y === box.y &&
      drawn.edge === edge &&
      drawn.width === width &&
      drawn.height === height &&
      drawn.radius === radius &&
      drawn.color === style.color &&
      drawn.strokeWidth === style.width
    ) {
      return;
    }
    this.drawn = {
      x: box.x,
      y: box.y,
      edge,
      width,
      height,
      radius,
      color: style.color,
      strokeWidth: style.width,
    };

    graphics.position.set(box.x, box.y);
    graphics.clear();

    if (width <= 0 || height <= 0) return;
    graphics.roundRect(edge, edge, width, height, radius);
    graphics.stroke({ color: style.color, width: style.width });
  }
}
