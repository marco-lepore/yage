import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { AssetManagerKey } from "@yagejs/core";
import type { TextStyle } from "@yagejs/renderer";
import { UILayoutSystem } from "./UILayoutSystem.js";
import { setYoga } from "./yoga-helpers.js";
import { setAssetManager } from "./asset-helpers.js";
import { setUIDefaultTextStyle } from "./text-defaults.js";

/** Options for {@link UIPlugin}. */
export interface UIPluginOptions {
  /**
   * Default style for UI text (`UIText`, and the auto-wrapped labels in
   * `Button` / `Checkbox`). Layered over `RendererConfig.defaultTextStyle`
   * — set here to give widgets a different font / fill than free-positioned
   * `TextComponent`. Per-text `style` still wins.
   */
  defaultTextStyle?: TextStyle;
}

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

  private readonly _options: UIPluginOptions;

  constructor(options: UIPluginOptions = {}) {
    this._options = options;
  }

  async install(context: EngineContext): Promise<void> {
    // Load Yoga lazily — only when UIPlugin is actually used
    const { default: yoga } = await import("yoga-layout");
    setYoga(yoga);

    // Wire up AssetManager for texture-based UI elements
    const am = context.tryResolve(AssetManagerKey);
    if (am) setAssetManager(am);

    setUIDefaultTextStyle(this._options.defaultTextStyle);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UILayoutSystem());
  }
}
