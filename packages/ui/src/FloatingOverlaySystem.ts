import { System, Phase, SceneManagerKey } from "@yagejs/core";
import type { EngineContext, SceneManager } from "@yagejs/core";
import { RendererKey, SceneRenderTreeKey } from "@yagejs/renderer";
import { FloatingOverlayKey } from "./floating.js";

/**
 * Re-anchors every scene's floating overlay (tooltips/popovers/menus) once
 * per frame. Runs in `LateUpdate` at priority `201` — *after*
 * `UILayoutSystem` (priority `200`) so floats read up-to-date trigger
 * geometry, and after any React `UIRootLayoutSystem`.
 *
 * Crucially this drives the overlay with **no `UIRoot` required**: it walks
 * `SceneManager.activeScenes`, resolves each scene's `FloatingOverlay` +
 * render tree, attaches the overlay layer idempotently, then ticks it
 * against the renderer viewport. So `attachTooltip` works in a pure
 * imperative scene that never mounts a React tree.
 */
export class FloatingOverlaySystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 201;

  private sceneManager!: SceneManager;

  onRegister(context: EngineContext): void {
    this.sceneManager = context.resolve(SceneManagerKey);
  }

  update(): void {
    const viewport = this.context.resolve(RendererKey).virtualSize;
    for (const scene of this.sceneManager.activeScenes) {
      const overlay = scene._resolveScoped(FloatingOverlayKey);
      if (!overlay) continue;
      const tree = scene._resolveScoped(SceneRenderTreeKey);
      if (tree) overlay.attach(tree);
      overlay.update(viewport);
    }
  }
}
