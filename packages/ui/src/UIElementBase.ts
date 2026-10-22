import type { DisplayContainer } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { ElementTransform } from "./internal/element-transform.js";
import { runUICallback } from "./error-boundary.js";
import type { LayoutProps, UIElement } from "./types.js";

/**
 * The base class of every `@yagejs/ui` element. It holds the element's
 * `transformOrigin`, `scale`, `rotation` and `zIndex`, and its parent's layout
 * pass places it about its `transformOrigin`. A custom element extends it and
 * calls {@link applyTransformProps} from its constructor and its `update()`.
 */
export abstract class UIElementBase implements UIElement {
  /**
   * The Pixi container this element draws with. Game code does not write to
   * it: layout writes its position, and the `scale`, `rotation` and `zIndex`
   * props write theirs, so a direct write is replaced at the next layout pass
   * or prop change. Change the element through its props; a task that needs
   * this object is a missing API.
   */
  abstract readonly displayObject: DisplayContainer;
  abstract readonly yogaNode: YogaNode;
  abstract visible: boolean;
  abstract update(props: Record<string, unknown>): void;
  abstract destroy(): void;

  /** @internal */
  readonly _transform: ElementTransform = new ElementTransform(this);

  /**
   * Call `fn` once when this element is destroyed. A throw from `fn` is
   * recorded on the scene's `ErrorBoundary`. Returns a function that removes
   * the listener before then.
   */
  onDestroy(fn: () => void): () => void {
    const display = this.displayObject;
    // Pixi removes a container from its parent before it emits "destroyed".
    // The throw is attributed through the element's own boundary (a surface
    // root carries one), else through the parent it was last removed from,
    // whose chain still reaches the tree's error boundary.
    let formerParent: DisplayContainer | undefined;
    const removed = (parent: DisplayContainer): void => {
      formerParent = parent;
    };
    const destroyed = (): void => {
      display.off("removed", removed);
      runUICallback(display, "UI destroy listener", fn, formerParent);
    };
    display.on("removed", removed);
    display.once("destroyed", destroyed);
    return () => {
      display.off("removed", removed);
      display.off("destroyed", destroyed);
    };
  }

  /**
   * Apply the four transform props present in `props`. A present key holding
   * `undefined` resets that prop to its default. Throws before writing
   * anything if a value is not finite.
   */
  protected applyTransformProps(props: LayoutProps): void {
    this._transform.set(props);
  }

  /** See {@link LayoutProps.transformOrigin}. */
  get transformOrigin(): Readonly<{ x: number; y: number }> {
    return this._transform.transformOrigin;
  }

  set transformOrigin(value: number | { x: number; y: number }) {
    this._transform.transformOrigin = value;
  }

  /** See {@link LayoutProps.scale}. */
  get scale(): Readonly<{ x: number; y: number }> {
    return this._transform.scale;
  }

  set scale(value: number | { x: number; y: number }) {
    this._transform.scale = value;
  }

  /** See {@link LayoutProps.rotation}. */
  get rotation(): number {
    return this._transform.rotation;
  }

  set rotation(value: number) {
    this._transform.rotation = value;
  }

  /** See {@link LayoutProps.zIndex}. */
  get zIndex(): number {
    return this._transform.zIndex;
  }

  set zIndex(value: number) {
    this._transform.zIndex = value;
  }
}
