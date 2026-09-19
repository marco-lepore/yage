/**
 * The focused look a game opts into: one outline, drawn the same way by every
 * focusable element in the package, asked for once through the UI plugin or
 * per element. Where nothing asks for one, nothing is drawn and the game
 * shows focus its own way from `onFocusChange`. Hover and press stay fills,
 * so an element that is both hovered and focused reads as both.
 */

import { Graphics } from "pixi.js";
import type { DisplayContainer } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import type { FocusProps, UIFocusOutlineBox, UIFocusStyle } from "../types.js";
import { getUIDefaultTextStyle } from "../text-defaults.js";

/** Outline colour when the UI default text style names no colour number. */
const FALLBACK_COLOR = 0xffffff;
/** Stroke thickness, in the px an element's layout box is measured in. */
const DEFAULT_WIDTH = 2;
/** Corner radius for an element that carries no radius of its own. */
const DEFAULT_RADIUS = 4;
/** Gap between the element's box and the outline's outer edge. */
const DEFAULT_INSET = 0;

/** What a container that scales nothing reports. */
const UNSCALED = { x: 1, y: 1 };

// When two engines share a page, the most recently installed UIPlugin wins.
let uiFocusStyle: UIFocusStyle | undefined;

/**
 * Store the UI-level focus outline style, which every focusable element in
 * the package reads at paint time. Without one, an element draws an outline
 * only where its own `focusStyle` asks for it.
 */
export function setUIFocusStyle(style: UIFocusStyle | null | undefined): void {
  uiFocusStyle = style ? { ...style } : undefined;
}

/** Current UI-level focus outline style, if any. */
export function getUIFocusStyle(): UIFocusStyle | undefined {
  return uiFocusStyle;
}

/**
 * The box layout gave an element, which is what an element rings when its own
 * Pixi container is positioned by layout rather than scaled by it.
 */
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
 * default text style, so a game that themed its text has already said what
 * its foreground is and a light palette gets a readable outline. A fill that
 * is not a colour number — a CSS string, a gradient — names no colour here,
 * and the outline falls back to white.
 */
function themedColor(): number {
  const fill = getUIDefaultTextStyle()?.fill;
  return typeof fill === "number" ? fill : FALLBACK_COLOR;
}

/**
 * The outline an element carrying `override` draws, or `null` where it draws
 * none: nothing named a style, or the element itself named `null` to opt out
 * of the UI-wide one.
 *
 * A style that is named resolves field by field — the element's own value,
 * then the UI-wide one, then the built-in default. `fallbackRadius` is the
 * element's own corner radius, so a themed button and the widget beside it
 * are rounded the same while focused.
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
  /** The rectangle to outline, in `container`'s own local space. */
  box(): UIFocusOutlineBox;
  /**
   * What `container` scales its contents by. The outline is drawn in the px
   * the layout box is measured in and scaled back down, so every edge comes
   * out one thickness on a widget layout sized by scaling. Omitted means the
   * container draws at those px already.
   */
  scale?(): { readonly x: number; readonly y: number };
}

/** The geometry and colour one stroke was laid down from. */
interface DrawnOutline {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly edge: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly color: number;
  readonly strokeWidth: number;
}

/**
 * The outline one element draws while it holds focus, where a style asks for
 * one.
 *
 * The graphics is built the first time a stroke is actually laid down and
 * kept afterwards, so an element that draws no outline holds none; it is left
 * out of its container's local bounds so showing it changes no measured size,
 * and redrawn from the element's layout pass. It is drawn inside the box, so
 * it never reaches over a neighbour.
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

  /**
   * Swap the element's own `focusStyle` in place, by key presence, the way
   * the shared focus and pointer fan-outs read their props.
   */
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
    // Left out of the container's local bounds, so taking focus cannot change
    // the size a parent measured, nor the width and height a wrapper's
    // `applyLayout` writes back into its widget.
    graphics.measurable = false;
    this.host.container.addChild(graphics);
    this.graphics = graphics;
    return graphics;
  }

  /**
   * Bring the outline to what the element's focus and style come to now: a
   * stroke at its current box, or nothing at all.
   */
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
      // Nothing is measured yet. The layout pass that measures this element
      // refreshes the outline, so the stroke lands then.
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
    const readScale = this.host.scale;
    const scale = readScale ? readScale.call(this.host) : UNSCALED;
    const scaleX = scale.x || 1;
    const scaleY = scale.y || 1;

    // Half the stroke sits either side of the path, so the path runs half a
    // width inside the box and the outline's outer edge lands on the box.
    const edge = style.inset + style.width / 2;
    const width = box.width * scaleX - edge * 2;
    const height = box.height * scaleY - edge * 2;
    const radius = Math.max(0, style.radius - edge);

    // A stroke that would come out exactly as the one already laid down is
    // skipped, the way the package's backgrounds skip a resize to the size
    // they hold: re-tessellating an unchanged rounded rectangle on every
    // layout pass is this package's largest per-frame allocation, and a
    // focused element runs that pass every frame.
    const drawn = this.drawn;
    if (
      drawn !== undefined &&
      drawn.x === box.x &&
      drawn.y === box.y &&
      drawn.scaleX === scaleX &&
      drawn.scaleY === scaleY &&
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
      scaleX,
      scaleY,
      edge,
      width,
      height,
      radius,
      color: style.color,
      strokeWidth: style.width,
    };

    // The box's corner is a point in the container's space; its extent is
    // written in the px the layout box is measured in, and the graphics is
    // scaled back by the same amount. One space for both, so a widget drawn
    // around its own centre is ringed where it is drawn. A host that declares
    // no scale never scales its container, and the graphics keeps the scale
    // of 1 it was built with.
    graphics.position.set(box.x, box.y);
    if (readScale) graphics.scale.set(1 / scaleX, 1 / scaleY);
    graphics.clear();

    if (width <= 0 || height <= 0) return;
    graphics.roundRect(edge, edge, width, height, radius);
    graphics.stroke({ color: style.color, width: style.width });
  }
}
