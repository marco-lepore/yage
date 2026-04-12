import type { EngineContext, Plugin, SystemScheduler } from "@yage/core";
import { AssetManagerKey } from "@yage/core";
import { RendererKey } from "@yage/renderer";
import type { RendererPlugin } from "@yage/renderer";
import { UIContainerKey, UILayerManagerKey } from "./types.js";
import { UILayoutSystem } from "./UILayoutSystem.js";
import { setYoga } from "./yoga-helpers.js";
import { setAssetManager } from "./asset-helpers.js";

/** UIPlugin creates a screen-space UI container and registers the layout system. */
export class UIPlugin implements Plugin {
  readonly name = "ui";
  readonly version = "2.0.0";
  readonly dependencies = ["renderer"];

  private renderer: RendererPlugin | null = null;

  async install(context: EngineContext): Promise<void> {
    // Load Yoga lazily — only when UIPlugin is actually used
    const { default: yoga } = await import("yoga-layout");
    setYoga(yoga);

    // Wire up AssetManager for texture-based UI elements
    const am = context.tryResolve(AssetManagerKey);
    if (am) setAssetManager(am);

    this.renderer = context.resolve(RendererKey);
    const uiLayers = this.renderer.createScreenContainer("ui", {
      eventMode: "static",
    });

    context.register(UILayerManagerKey, uiLayers);
    context.register(UIContainerKey, uiLayers.defaultLayer.container);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UILayoutSystem());
  }

  onDestroy(): void {
    this.renderer?.destroyScreenContainer("ui");
    this.renderer = null;
  }
}
