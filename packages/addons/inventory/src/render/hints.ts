import { ensureInventoryLayer } from "./ensureLayer.js";
/**
 * `hints` — the default scroll-hint renderer: small ▲/▼ triangles at the cell
 * window's right edge when rows are scrolled out of view. {@link SlotsView}
 * computes what is off-window and its rect; this only draws. Swap it via
 * `createInventoryPanel(theme, { hints })` for a different affordance (dots, a
 * scrollbar). One graphics object carries both triangles; the view redraws it
 * through the handle as the window scrolls.
 */

import { Transform, type Scene } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import type { HintsHandle, HintsPresenter, HintsState } from "../adapter.js";
import type { InventoryTheme } from "../factory/theme.js";

interface HintsConfig {
  readonly hintColor: number;
  readonly hintAlpha: number;
  readonly layerContent: string;
}

/** Build the default scroll-hint preset from a theme. Assign it uncalled
 *  (`{ hints }`); the factory calls it with the resolved theme. */
export function hints(theme: InventoryTheme): HintsPresenter {
  return new DefaultHints(theme);
}

class DefaultHints implements HintsPresenter {
  /** Resolved theme values, held as a plain object so the theme drift-guard
   *  sees every field reach a config leaf. */
  private readonly cfg: HintsConfig;

  constructor(theme: InventoryTheme) {
    this.cfg = {
      hintColor: theme.highlightColor,
      hintAlpha: theme.hintAlpha ?? 0.6,
      layerContent: theme.layerContent,
    };
  }

  render(scene: Scene, state: HintsState): HintsHandle {
    ensureInventoryLayer(scene, this.cfg.layerContent, 1060);
    const entity = scene.spawn("inv-slots-hints");
    entity.add(new Transform());
    const gfx = entity.add(
      new GraphicsComponent({ layer: this.cfg.layerContent }),
    );

    const draw = (s: HintsState): void => {
      const w = s.window;
      const x = w.x + w.width + 6;
      gfx.draw((g) => {
        g.clear();
        if (s.up) {
          g.moveTo(x, w.y + 6)
            .lineTo(x + 8, w.y + 6)
            .lineTo(x + 4, w.y)
            .closePath()
            .fill({ color: this.cfg.hintColor, alpha: this.cfg.hintAlpha });
        }
        if (s.down) {
          const y = w.y + w.height;
          g.moveTo(x, y - 6)
            .lineTo(x + 8, y - 6)
            .lineTo(x + 4, y)
            .closePath()
            .fill({ color: this.cfg.hintColor, alpha: this.cfg.hintAlpha });
        }
      });
    };
    draw(state);

    return {
      update: (s: HintsState): void => draw(s),
      setVisible: (visible: boolean): void => {
        gfx.graphics.visible = visible;
      },
      dispose: (): void => {
        entity.destroy();
      },
    };
  }
}
