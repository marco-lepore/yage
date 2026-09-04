import type { DisplayContainer } from "@yagejs/renderer";
import type { PointerEventProps } from "./types.js";
import { runUICallback } from "./error-boundary.js";

/**
 * Shared hover-event fan-out for the interactive UI primitives.
 *
 * Binds one `pointerover` / `pointerout` listener pair and routes them to
 * the caller's `onPointerOver` / `onPointerOut` / `onHover` callbacks. A
 * pointer listener implies the element must be hit-testable, so a `passive`
 * container (Pixi's default — not a hit-test target itself) is upgraded to
 * `static`; without this a `consumeInput: false` primitive with no
 * interactive children would silently never fire. Explicit modes are left
 * alone (`UIButton` toggles `"none"` when disabled).
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
  private readonly container: DisplayContainer;

  constructor(
    container: DisplayContainer,
    props: PointerEventProps,
    inert: () => boolean = (): boolean => false,
  ) {
    this.container = container;
    this._onPointerOver = props.onPointerOver;
    this._onPointerOut = props.onPointerOut;
    this._onHover = props.onHover;
    this.inert = inert;
    if (
      container.eventMode === "passive" ||
      container.eventMode === undefined
    ) {
      container.eventMode = "static";
    }
    container.on("pointerover", this._handleOver);
    container.on("pointerout", this._handleOut);
  }

  /**
   * Swap callbacks in place. Called from the primitive's `update()`. Uses a
   * key-presence check (mirroring `UIText`'s `"truncate" in p` convention):
   * a present key — including an explicit `undefined`, the shape the React
   * reconciler emits when a JSX prop is removed — reassigns (and so can
   * clear) the handler, while an absent key leaves it intact so partial
   * imperative `update({ ... })` calls don't drop hover handlers.
   */
  set(props: PointerEventProps): void {
    if ("onPointerOver" in props) this._onPointerOver = props.onPointerOver;
    if ("onPointerOut" in props) this._onPointerOut = props.onPointerOut;
    if ("onHover" in props) this._onHover = props.onHover;
  }

  private readonly _handleOver = (): void => {
    if (this.inert()) return;
    if (this._onPointerOver) {
      runUICallback(this.container, "UI pointer handler", this._onPointerOver);
    }
    if (this._onHover) {
      runUICallback(this.container, "UI pointer handler", () =>
        this._onHover?.(true),
      );
    }
  };

  private readonly _handleOut = (): void => {
    if (this.inert()) return;
    if (this._onPointerOut) {
      runUICallback(this.container, "UI pointer handler", this._onPointerOut);
    }
    if (this._onHover) {
      runUICallback(this.container, "UI pointer handler", () =>
        this._onHover?.(false),
      );
    }
  };
}
