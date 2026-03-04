import type { EngineContext, Plugin, SystemScheduler } from "@yage/core";
import { AssetManagerKey } from "@yage/core";
import { RendererKey } from "@yage/renderer";
import { Container } from "pixi.js";
import { UIContainerKey } from "./types.js";
import { UILayoutSystem } from "./UILayoutSystem.js";
import { setYoga } from "./yoga-helpers.js";
import { setAssetManager } from "./asset-helpers.js";

/** UIPlugin creates a screen-space UI container and registers the layout system. */
export class UIPlugin implements Plugin {
  readonly name = "ui";
  readonly version = "2.0.0";
  readonly dependencies = ["renderer"];

  private uiContainer: Container | null = null;

  async install(context: EngineContext): Promise<void> {
    // Load Yoga lazily — only when UIPlugin is actually used
    const { default: yoga } = await import("yoga-layout");
    setYoga(yoga);

    // Wire up AssetManager for texture-based UI elements
    const am = context.tryResolve(AssetManagerKey);
    if (am) setAssetManager(am);

    const renderer = context.resolve(RendererKey);
    this.uiContainer = new Container();
    this.uiContainer.label = "ui";
    // Make the UI container interactive so events propagate to buttons
    this.uiContainer.eventMode = "static";
    renderer.application.stage.addChild(this.uiContainer);
    context.register(UIContainerKey, this.uiContainer);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UILayoutSystem());
  }

  onDestroy(): void {
    if (this.uiContainer) {
      this.uiContainer.removeFromParent();
      this.uiContainer.destroy();
      this.uiContainer = null;
    }
  }
}
