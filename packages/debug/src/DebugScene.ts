import { Scene } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import type { Container } from "pixi.js";

/**
 * Scene mounted by the debug plugin via `SceneManager._mountDetached`.
 * Declares two layers:
 * - `"debug-world"` — world-space, rides the camera (for collision shapes).
 * - `"debug-hud"`   — screen-space, fixed overlay (text readouts).
 *
 * `pauseBelow: false` / `transparentBelow: true` so the underlying game
 * keeps running and rendering behind the overlay.
 */
export class DebugScene extends Scene {
  readonly name = "__debug__";
  override readonly pauseBelow = false;
  override readonly transparentBelow = true;
  readonly layers: readonly LayerDef[] = [
    { name: "debug-world", order: 999999, space: "world" },
    { name: "debug-hud", order: 999999, space: "screen" },
  ];

  /** Called after `_mountDetached` has materialized the render tree. */
  onReady?: (worldContainer: Container, hudContainer: Container) => void;

  /** Called by the plugin when the scene is unmounted. */
  onTearDown?: () => void;

  onEnter(): void {
    const tree = this._resolveScoped(SceneRenderTreeKey);
    if (!tree) return;
    const worldContainer = tree.get("debug-world").container;
    const hudContainer = tree.get("debug-hud").container;
    worldContainer.eventMode = "none";
    hudContainer.eventMode = "none";
    this.onReady?.(worldContainer, hudContainer);
  }

  onExit(): void {
    this.onTearDown?.();
  }
}
