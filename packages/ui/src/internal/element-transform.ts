/**
 * The transform a game gives a laid-out element: the point it scales and
 * rotates about, its scale, its rotation, and its draw order among its
 * siblings. None of it changes the element's Yoga box.
 */

import type { LayoutProps, UIElement } from "../types.js";

/**
 * The zIndex of a container's own parts drawn under all of its child
 * elements (a background, a pointer catcher) and over them (a focus outline).
 * An element's zIndex is always finite, so it stays between the two. Two
 * parts on the same value compare as equal, which keeps the order they were
 * added in.
 */
export const BELOW_ELEMENTS = -Infinity;
export const ABOVE_ELEMENTS = Infinity;

/** One number for both axes, or one per axis. */
type AxisPair = number | { readonly x: number; readonly y: number };

/** The transform props, the keys {@link ElementTransform.set} reads. */
type TransformProps = Pick<
  LayoutProps,
  "transformOrigin" | "scale" | "rotation" | "zIndex"
>;

/**
 * An element's transform state. Each setter checks its input and writes the
 * display object at once, so a change reaches the screen without a layout
 * pass; the layout pass calls {@link place}, which re-applies the pivot and
 * the position, the two values that depend on the element's size.
 */
export class ElementTransform {
  private readonly _origin = { x: 0, y: 0 };
  private readonly _scale = { x: 1, y: 1 };

  /**
   * @param element The element whose `displayObject` layout places and whose
   *   computed size the origin is a fraction of. Both are read on use, so the
   *   element may build them after constructing this.
   */
  constructor(private readonly element: UIElement) {}

  get transformOrigin(): Readonly<{ x: number; y: number }> {
    return this._origin;
  }

  set transformOrigin(value: AxisPair) {
    const x = this._axis("transformOrigin", value, "x");
    const y = this._axis("transformOrigin", value, "y");
    const { displayObject: display, yogaNode } = this.element;
    const width = yogaNode.getComputedWidth();
    const height = yogaNode.getComputedHeight();
    // The corner layout put the element at, which the new pivot keeps.
    const cornerX = display.position.x - display.pivot.x;
    const cornerY = display.position.y - display.pivot.y;
    this._origin.x = x;
    this._origin.y = y;
    // Before the first layout pass there is no size to take a fraction of;
    // that pass places the element.
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    this._applyPivot(cornerX, cornerY, width, height);
  }

  get scale(): Readonly<{ x: number; y: number }> {
    return this._scale;
  }

  set scale(value: AxisPair) {
    const x = this._axis("scale", value, "x");
    const y = this._axis("scale", value, "y");
    this._scale.x = x;
    this._scale.y = y;
    this.element.displayObject.scale.set(x, y);
  }

  get rotation(): number {
    return this.element.displayObject.rotation;
  }

  set rotation(value: number) {
    this.element.displayObject.rotation = this._finite("rotation", value);
  }

  get zIndex(): number {
    return this.element.displayObject.zIndex;
  }

  set zIndex(value: number) {
    this.element.displayObject.zIndex = this._finite("zIndex", value);
  }

  /**
   * Apply the transform props by key presence. A present key holding
   * `undefined` is how the React reconciler marks a removed prop, and resets
   * that field to its default.
   */
  set(props: TransformProps): void {
    const origin = props.transformOrigin ?? 0;
    const scale = props.scale ?? 1;
    const rotation = props.rotation ?? 0;
    const zIndex = props.zIndex ?? 0;
    // Check every value before writing any, so a bad one throws with the
    // element unchanged.
    this._axis("transformOrigin", origin, "x");
    this._axis("transformOrigin", origin, "y");
    this._axis("scale", scale, "x");
    this._axis("scale", scale, "y");
    this._finite("rotation", rotation);
    this._finite("zIndex", zIndex);
    if ("transformOrigin" in props) this.transformOrigin = origin;
    if ("scale" in props) this.scale = scale;
    if ("rotation" in props) this.rotation = rotation;
    if ("zIndex" in props) this.zIndex = zIndex;
  }

  /**
   * Put the element's top-left corner at (`left`, `top`) in its parent's
   * space, with the pivot at the origin point of its computed size.
   */
  place(left: number, top: number): void {
    if (this._origin.x === 0 && this._origin.y === 0) {
      this.element.displayObject.position.set(left, top);
      return;
    }
    const { yogaNode } = this.element;
    this._applyPivot(
      left,
      top,
      yogaNode.getComputedWidth(),
      yogaNode.getComputedHeight(),
    );
  }

  private _applyPivot(
    left: number,
    top: number,
    width: number,
    height: number,
  ): void {
    const pivotX = this._origin.x * width;
    const pivotY = this._origin.y * height;
    const display = this.element.displayObject;
    display.pivot.set(pivotX, pivotY);
    display.position.set(left + pivotX, top + pivotY);
  }

  private _axis(prop: string, value: AxisPair, axis: "x" | "y"): number {
    if (typeof value === "number") return this._finite(prop, value);
    return this._finite(`${prop}.${axis}`, value[axis]);
  }

  private _finite(prop: string, value: number): number {
    if (!Number.isFinite(value)) {
      throw new Error(
        `${this.element.constructor.name}.${prop}: must be finite, got ${value}`,
      );
    }
    return value;
  }
}

/**
 * Place a child element with its top-left corner at (`left`, `top`) in its
 * parent's space. Every container calls this from its layout pass, so the
 * child's `transformOrigin` is honoured wherever it is laid out.
 */
export function placeElement(
  element: UIElement,
  left: number,
  top: number,
): void {
  const transform = element._transform;
  if (transform === undefined) {
    element.displayObject.position.set(left, top);
    return;
  }
  transform.place(left, top);
}
