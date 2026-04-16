import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { AssetManagerKey } from "@yagejs/core";
import { UILayoutSystem } from "./UILayoutSystem.js";
import { setYoga } from "./yoga-helpers.js";
import { setAssetManager } from "./asset-helpers.js";

/**
 * UIPlugin loads Yoga, wires the AssetManager for UI-specific texture
 * assets, and registers the layout system. UI entities attach to the
 * active scene's render tree via `this.use(SceneRenderTreeKey)` — no
 * dedicated global screen container is created.
 */
export class UIPlugin implements Plugin {
  readonly name = "ui";
  readonly version = "3.0.0";
  readonly dependencies = ["renderer"];

  async install(context: EngineContext): Promise<void> {
    // Load Yoga lazily — only when UIPlugin is actually used
    const { default: yoga } = await import("yoga-layout");
    setYoga(yoga);

    // Wire up AssetManager for texture-based UI elements
    const am = context.tryResolve(AssetManagerKey);
    if (am) setAssetManager(am);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UILayoutSystem());
  }
}
