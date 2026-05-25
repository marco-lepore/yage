import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { AssetManagerKey } from "@yagejs/core";
import type { TextStyle } from "@yagejs/renderer";
import { UILayoutSystem } from "./UILayoutSystem.js";
import { setYoga } from "./yoga-helpers.js";
import { setAssetManager } from "./asset-helpers.js";
import { getUIDefaultTextStyle, setUIDefaultTextStyle } from "./text-defaults.js";

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
  // Capture/restore the UI default text-style singleton so the mutation stays
  // scoped to this plugin's lifetime — otherwise it leaks across engine
  // lifecycles (e.g. between tests). Mirrors RendererPlugin's defaultTextStyle.
  private _prevDefaultTextStyle: TextStyle | undefined = undefined;

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

    this._prevDefaultTextStyle = getUIDefaultTextStyle();
    setUIDefaultTextStyle(this._options.defaultTextStyle);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UILayoutSystem());
  }

  onDestroy(): void {
    setUIDefaultTextStyle(this._prevDefaultTextStyle);
    this._prevDefaultTextStyle = undefined;
  }
}
