import type { Scene } from "@yagejs/core";
import { SceneRenderTreeProviderKey } from "@yagejs/renderer";
import type { ControlsPresenter } from "../view.js";
import { GraphicsButtonView } from "./GraphicsButtonView.js";
import { GraphicsStickView } from "./GraphicsStickView.js";
import { VIRTUAL_CONTROLS_LAYER } from "./layers.js";
import { defaultControlsTheme, type ControlsTheme } from "./theme.js";

/**
 * The built-in {@link ControlsPresenter}: Graphics discs + canvas labels,
 * zero assets. Pass a partial {@link ControlsTheme} to restyle; swap the
 * whole presenter for custom art.
 *
 * ```ts
 * new VirtualControls({
 *   stick: { actions: { … } },
 *   buttons: [{ id: "a", action: "jump" }],
 *   presenter: createControlsPresenter({ buttonPressedColor: 0xf472b6 }),
 * });
 * ```
 */
export function createControlsPresenter(
  theme: Partial<ControlsTheme> = {},
): ControlsPresenter {
  const resolved: ControlsTheme = { ...defaultControlsTheme(), ...theme };
  let scene: Scene | null = null;

  const mustScene = (): Scene => {
    if (!scene) {
      throw new Error(
        "createControlsPresenter: view created before mount() — the presenter must be passed to VirtualControls, not used directly.",
      );
    }
    return scene;
  };

  return {
    mount(s: Scene): void {
      scene = s;
      // Auto-provision the screen-space layer (a scene that declared the
      // same name just gets its own layer back). The provider key is the
      // public path to the per-scene render tree from non-component code.
      s.context
        .tryResolve(SceneRenderTreeProviderKey)
        ?.getTree(s)
        ?.ensureLayer(
          { name: resolved.layer, order: VIRTUAL_CONTROLS_LAYER.order },
          { space: "screen" },
        );
    },
    createStickView(stick) {
      return new GraphicsStickView(mustScene(), stick, resolved);
    },
    createButtonView(button) {
      return new GraphicsButtonView(mustScene(), button, resolved);
    },
    dispose(): void {
      scene = null;
    },
  };
}
