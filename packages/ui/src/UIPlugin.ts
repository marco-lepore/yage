import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { ErrorBoundaryKey, SceneHookRegistryKey } from "@yagejs/core";
import type { TextStyle } from "@yagejs/renderer";
import { UIFocusRelayoutSystem, UILayoutSystem } from "./UILayoutSystem.js";
import { FloatingOverlay, FloatingOverlayKey } from "./floating.js";
import { FloatingOverlaySystem } from "./FloatingOverlaySystem.js";
import { UIFocusStack, UIFocusStackKey } from "./focus/UIFocusStack.js";
import { UIFocusSystem } from "./UIFocusSystem.js";
import { setYoga } from "./yoga-helpers.js";
import {
  getUIDefaultTextStyle,
  setUIDefaultTextStyle,
} from "./text-defaults.js";
import { getUIFocusStyle, setUIFocusStyle } from "./internal/focus-outline.js";
import type { UIFocusStyle } from "./types.js";

/** Options for {@link UIPlugin}. */
export interface UIPluginOptions {
  /**
   * Default style for UI text (`UIText`, `UISplitText`, and the auto-wrapped
   * labels in `Button` / `Checkbox`). Layered over
   * `RendererConfig.defaultTextStyle` — set here to give widgets a different
   * font / fill than free-positioned `TextComponent`. Per-text `style` still
   * wins.
   */
  defaultTextStyle?: TextStyle;
  /**
   * How the outline around a focused element is drawn: colour, thickness,
   * corner radius and inset. It applies to every focusable element. A
   * per-element `focusStyle` overrides it field by field, and `null` on an
   * element drops that element's outline.
   *
   * Omitted, no element draws an outline, and a game shows focus from
   * `onFocusChange`.
   */
  focusStyle?: UIFocusStyle | null;
}

/**
 * UIPlugin loads Yoga, installs UI defaults, and registers the layout system.
 * UI entities attach to the
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
  // The focus outline's defaults are held the same way, for the same reason.
  private _prevFocusStyle: UIFocusStyle | undefined = undefined;
  private _unregisterHooks: (() => void) | null = null;

  constructor(options: UIPluginOptions = {}) {
    this._options = options;
  }

  async install(context: EngineContext): Promise<void> {
    // Load Yoga lazily — only when UIPlugin is actually used
    const { default: yoga } = await import("yoga-layout");
    setYoga(yoga);

    this._prevDefaultTextStyle = getUIDefaultTextStyle();
    setUIDefaultTextStyle(this._options.defaultTextStyle);
    this._prevFocusStyle = getUIFocusStyle();
    setUIFocusStyle(this._options.focusStyle);
    const errorBoundary = context.resolve(ErrorBoundaryKey);

    // Provision one scene-scoped FloatingOverlay per scene — the top-most
    // screen-space surface tooltips/popovers/menus portal into. Owned here
    // (not in UIReactPlugin) so floating UI exists with or without React.
    // The focus stack is per scene for the same reason: a scope belongs to
    // the scene whose tree it hangs in.
    const hooks = context.resolve(SceneHookRegistryKey);
    this._unregisterHooks = hooks.register({
      beforeEnter: (scene) => {
        scene.registerScoped(
          FloatingOverlayKey,
          new FloatingOverlay(errorBoundary),
        );
        scene.registerScoped(UIFocusStackKey, new UIFocusStack());
      },
      afterExit: (scene) => {
        scene._resolveScoped(FloatingOverlayKey)?.destroy();
        scene._resolveScoped(UIFocusStackKey)?.destroy();
      },
    });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UILayoutSystem());
    scheduler.add(new FloatingOverlaySystem());
    scheduler.add(new UIFocusSystem());
    scheduler.add(new UIFocusRelayoutSystem());
  }

  onDestroy(): void {
    setUIDefaultTextStyle(this._prevDefaultTextStyle);
    this._prevDefaultTextStyle = undefined;
    setUIFocusStyle(this._prevFocusStyle);
    this._prevFocusStyle = undefined;
    this._unregisterHooks?.();
    this._unregisterHooks = null;
  }
}
