import { ServiceKey } from "./EngineContext.js";

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
