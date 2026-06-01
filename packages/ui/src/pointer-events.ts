import type { Container } from "pixi.js";
import type { PointerEventProps } from "./types.js";

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
 *
 * Hover has two tiers. The `onHover` prop is a single slot, swapped in place
 * by {@link set} — the declarative channel the element's *owner* drives
 * (props / the reconciler). {@link watchHover} is the *additive* channel:
 * each subscriber stacks and owns its own teardown, so an imperative add-on
 * (e.g. `attachTooltip`) reacts to hover without clobbering — or being
 * clobbered by — the owner's `onHover`. Both fan out together.
 */
export class PointerEvents {
  private _onPointerOver: (() => void) | undefined;
  private _onPointerOut: (() => void) | undefined;
  private _onHover: ((hovering: boolean) => void) | undefined;
  private readonly _hoverWatchers = new Set<(hovering: boolean) => void>();
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
    if (container.eventMode === "passive" || container.eventMode === undefined) {
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

  /**
   * Subscribe to hover *additively*, returning an unsubscribe. Distinct from
   * the `onHover` prop slot (swapped in place by {@link set}): watchers stack
   * and each owns its own teardown, so imperative add-ons can react to hover
   * alongside the owner's `onHover` instead of overwriting it. Fires
   * `true` on enter / `false` on leave, suppressed while `inert`. The
   * primitives surface this as their own `watchHover()`; `attachTooltip`
   * builds on it.
   */
  watchHover(fn: (hovering: boolean) => void): () => void {
    this._hoverWatchers.add(fn);
    return () => this._hoverWatchers.delete(fn);
  }

  private readonly _handleOver = (): void => {
    if (this.inert()) return;
    this._onPointerOver?.();
    this._onHover?.(true);
    this._emitWatchers(true);
  };

  private readonly _handleOut = (): void => {
    if (this.inert()) return;
    this._onPointerOut?.();
    this._onHover?.(false);
    this._emitWatchers(false);
  };

  private _emitWatchers(hovering: boolean): void {
    if (this._hoverWatchers.size === 0) return;
    // Snapshot: a watcher may unsubscribe (or subscribe) itself while running.
    for (const fn of [...this._hoverWatchers]) fn(hovering);
  }
}
