import { ServiceKey, SceneHookRegistryKey } from "@yagejs/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { UIRootLayoutSystem } from "./UIRootLayoutSystem.js";
import { FloatingOverlay, FloatingOverlayKey } from "./floating.js";

/**
 * Marker service key used by `UIRoot` to fail fast when `UIReactPlugin`
 * hasn't been registered — without it, `UIRoot` mounts but its per-frame
 * layout never runs, leaving a stationary UI with no error.
 */
export const UIReactPluginKey = new ServiceKey<UIReactPlugin>("ui-react");

/**
 * Registers `UIRootLayoutSystem` so `UIRoot` layouts run in `LateUpdate`,
 * after Update-phase Transform writers like `ScreenFollow`, and provisions
 * one scene-scoped `FloatingOverlay` per scene (the top-most screen-space
 * surface tooltips/popovers portal into). Required alongside `UIPlugin`
 * for `@yagejs/ui-react`.
 */
export class UIReactPlugin implements Plugin {
  readonly name = "ui-react";
  readonly version = "0.1.0";
  readonly dependencies = ["ui"];

  private unregisterHooks: (() => void) | null = null;

  install(context: EngineContext): void {
    context.register(UIReactPluginKey, this);

    const hooks = context.resolve(SceneHookRegistryKey);
    this.unregisterHooks = hooks.register({
      beforeEnter: (scene) => {
        scene.registerScoped(FloatingOverlayKey, new FloatingOverlay());
      },
      afterExit: (scene) => {
        scene._resolveScoped(FloatingOverlayKey)?.destroy();
      },
    });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UIRootLayoutSystem());
  }

  onDestroy(): void {
    this.unregisterHooks?.();
    this.unregisterHooks = null;
  }
}
