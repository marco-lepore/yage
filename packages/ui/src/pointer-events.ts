import type { Container } from "pixi.js";
import type { PointerEventProps } from "./types.js";

/**
 * Shared hover-event fan-out for the interactive UI primitives.
 *
 * The owning primitive already has an `eventMode: "static"` Pixi container
 * (the consume-input fallback marks every UI primitive that way), so this
 * just binds one `pointerover` / `pointerout` listener pair and routes them
 * to the caller's `onPointerOver` / `onPointerOut` / `onHover` callbacks.
 *
 * Callbacks live in mutable fields swapped in place by {@link set}, so a
 * single listener pair survives the React reconciler's prop churn — no
 * rebinding, no listener leak across re-renders. `inert` lets a primitive
 * suppress callbacks while it's disabled (mirrors `UIButton`'s existing
 * hover-background guard). Listener teardown is implicit: every primitive
 * destroys its container in `destroy()`, and Pixi's `EventEmitter` drops all
 * listeners then — matching how the primitives' own click/bg listeners are
 * already cleaned up.
 */
export class PointerEvents {
  private _onPointerOver: (() => void) | undefined;
  private _onPointerOut: (() => void) | undefined;
  private _onHover: ((hovering: boolean) => void) | undefined;
  private readonly inert: () => boolean;

  constructor(
    container: Container,
    props: PointerEventProps,
    inert: () => boolean = (): boolean => false,
  ) {
    this._onPointerOver = props.onPointerOver;
    this._onPointerOut = props.onPointerOut;
    this._onHover = props.onHover;
    this.inert = inert;
    container.on("pointerover", this._handleOver);
    container.on("pointerout", this._handleOut);
  }

  /**
   * Swap callbacks in place. Called from the primitive's `update()`. Follows
   * the codebase's `!== undefined` convention (matching how `UIButton`
   * re-binds `onClick`): an absent key leaves the current handler intact.
   */
  set(props: PointerEventProps): void {
    if (props.onPointerOver !== undefined) this._onPointerOver = props.onPointerOver;
    if (props.onPointerOut !== undefined) this._onPointerOut = props.onPointerOut;
    if (props.onHover !== undefined) this._onHover = props.onHover;
  }

  private readonly _handleOver = (): void => {
    if (this.inert()) return;
    this._onPointerOver?.();
    this._onHover?.(true);
  };

  private readonly _handleOut = (): void => {
    if (this.inert()) return;
    this._onPointerOut?.();
    this._onHover?.(false);
  };
}
