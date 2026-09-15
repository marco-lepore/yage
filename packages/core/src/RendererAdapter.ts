import { ServiceKey } from "./EngineContext.js";

/**
 * What a hit test found under a point: the topmost interactive container and
 * its ancestors, innermost first, plus whether the chain crosses a surface
 * marked via `markPointerConsumeContainer`.
 *
 * The containers are renderer-owned objects, opaque to the consumer. Compare
 * them by identity against display objects read elsewhere — an Inspector
 * user-interface snapshot, for one — rather than reading fields off them.
 */
export interface RendererUIHit {
  readonly path: readonly object[];
  readonly consumed: boolean;
}

/**
 * One synthetic pointer event: a press, a release, or a move between the two.
 * Named in pointer terms rather than in any one platform's event names, which
 * the renderer maps to.
 */
export type RendererPointerEventType = "down" | "up" | "move";

/**
 * Cross-package contract for "something that owns a canvas and can map
 * canvas-relative CSS pixels into virtual-space pixels".
 *
 * Implemented by `@yagejs/renderer`'s `RendererPlugin` and consumed by
 * `@yagejs/input` for pointer-event targeting and coordinate mapping under
 * responsive fit. Foreign renderers can implement this interface and register
 * under `RendererAdapterKey` to integrate with the input plugin without
 * importing `@yagejs/renderer`.
 */
export interface RendererAdapter {
  readonly canvas: HTMLCanvasElement;
  /**
   * Convert CSS pixels relative to the canvas into virtual-space pixels.
   * Optional — when absent, consumers fall back to raw CSS pixels (correct
   * only when canvas CSS size equals virtual size).
   */
  canvasToVirtual?(x: number, y: number): { x: number; y: number };
  /**
   * Hit-test at virtual-space coordinates and return `true` when the topmost
   * interactive container under `(x, y)` is parented (directly or through any
   * ancestor) to a container marked via {@link markPointerConsumeContainer}.
   * Optional — when absent, the input plugin's UI auto-consume fallback is a
   * no-op.
   *
   * Implemented by `@yagejs/renderer` over Pixi's `EventBoundary`. The input
   * plugin calls this on `pointerdown` drains to auto-claim presses that land
   * on UI surfaces (UIPanel backgrounds, decorative UIText, etc.) without
   * requiring per-component handler boilerplate.
   */
  hitTestUI?(x: number, y: number): boolean;
  /**
   * The same hit test as {@link RendererAdapter.hitTestUI}, reporting what was
   * hit rather than only whether the pointer is claimed. `null` when nothing
   * interactive sits under `(x, y)`.
   */
  hitTestUIPath?(x: number, y: number): RendererUIHit | null;
  /**
   * Deliver a pointer event at `point`, in virtual-space pixels, through the
   * renderer's own event system, so hit testing, stacking order and clipping
   * apply as they do for a person clicking. `button` says which mouse button
   * a press or a release carries; a move carries no button change and omits
   * it, and the renderer reports whatever buttons its synthetic pointer still
   * holds.
   *
   * Optional. A renderer that cannot deliver yet — before it has drawn a
   * frame, for one — throws with a message naming what to do.
   */
  dispatchPointerEvent?(
    type: RendererPointerEventType,
    point: { x: number; y: number },
    button?: 0 | 1 | 2,
  ): void;
  /**
   * The on-screen region of virtual space, CLAMPED to the declared virtual
   * rect — the area a screen-space overlay may lay out in and expect to be
   * both visible and reachable. Distinct from mapping the canvas corners
   * through {@link canvasToVirtual}: under letterbox fit the corners map
   * into the masked bars, where drawn content is clipped but pointer input
   * still lands. Must return a fresh object per access (consumers diff and
   * store it). Optional — when absent, consumers fall back to corner
   * mapping, which is correct only for fit modes without masked bars.
   */
  readonly visibleVirtualRect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Well-known service key for the current renderer's pointer-input adapter.
 * The canonical `@yagejs/renderer` plugin registers itself here; consumers
 * (notably `@yagejs/input`) resolve this key to auto-wire canvas targeting
 * and coordinate mapping.
 */
export const RendererAdapterKey = new ServiceKey<RendererAdapter>(
  "rendererAdapter",
);
