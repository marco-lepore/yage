/**
 * `menuSkin` — the default action-menu renderer: a rounded frame, one text row
 * per action, and a filled highlight bar on the selected row. {@link
 * ActionMenuView} measures labels, places the menu, and hit-tests; this only
 * draws. Swap it via `createInventoryPanel(theme, { menuSkin })` to restyle the
 * popup without reimplementing placement. The frame + bar spawn before the row
 * labels so they paint underneath.
 */

import { Transform, type Scene } from "@yagejs/core";
import { createNineSlice, GraphicsComponent, TextComponent } from "@yagejs/renderer";
import type { MenuSkinHandle, MenuSkinPresenter, MenuSkinRow, Rect } from "../adapter.js";
import type { InventoryTheme, NineSliceFrame } from "../factory/theme.js";
import { resolveHighlightRadius } from "../factory/theme.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

interface MenuSkinConfig extends FontConfig {
  readonly textSize: number;
  readonly actionColor: number;
  readonly actionSelectedColor: number;
  readonly actionHighlightColor: number;
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly highlightRadius: number;
  readonly highlightAlpha: number;
  /** Opt-in nine-slice menu frame; replaces the drawn fill+stroke when set. */
  readonly textured?: NineSliceFrame | undefined;
  readonly layerOverlay: string;
}

/** Build the default menu skin from a theme. Assign it uncalled
 *  (`{ menuSkin }`); the factory calls it with the resolved theme. */
export function menuSkin(theme: InventoryTheme): MenuSkinPresenter {
  return new DefaultMenuSkin(theme);
}

class DefaultMenuSkin implements MenuSkinPresenter {
  /** Resolved theme values, held as a plain object so the theme drift-guard
   *  sees every field reach a config leaf. */
  private readonly cfg: MenuSkinConfig;

  constructor(theme: InventoryTheme) {
    this.cfg = {
      textSize: theme.textSize,
      actionColor: theme.actionColor,
      actionSelectedColor: theme.actionSelectedColor,
      actionHighlightColor: theme.actionHighlightColor,
      frameColor: theme.frameColor,
      frameAlpha: theme.frameAlpha,
      borderColor: theme.borderColor,
      cornerRadius: theme.cornerRadius,
      highlightRadius: resolveHighlightRadius(theme),
      highlightAlpha: theme.menu?.highlightAlpha ?? 0.45,
      textured: theme.textured?.menu,
      layerOverlay: theme.layerOverlay,
      bitmapFont: theme.bitmapFont,
      fontFamily: theme.fontFamily,
      resolution: theme.resolution,
    };
  }

  renderMenu(scene: Scene, menu: Rect, rows: readonly MenuSkinRow[]): MenuSkinHandle {
    // The frame draws one of two ways: a stretched nine-slice (opt-in) or the
    // Graphics rounded rect (default). Spawned first either way, so the bar +
    // labels paint on top.
    const frameEntity = scene.spawn("inv-menu-frame");
    frameEntity.add(new Transform());
    const frame = frameEntity.add(new GraphicsComponent({ layer: this.cfg.layerOverlay }));
    if (this.cfg.textured) {
      const sprite = createNineSlice({
        texture: this.cfg.textured.texture,
        leftWidth: this.cfg.textured.insets.left,
        topHeight: this.cfg.textured.insets.top,
        rightWidth: this.cfg.textured.insets.right,
        bottomHeight: this.cfg.textured.insets.bottom,
        width: menu.width,
        height: menu.height,
      });
      sprite.x = menu.x;
      sprite.y = menu.y;
      frame.graphics.addChild(sprite);
    } else {
      frame.draw((g) => {
        g.clear();
        g.roundRect(menu.x, menu.y, menu.width, menu.height, this.cfg.cornerRadius).fill({
          color: this.cfg.frameColor,
          alpha: this.cfg.frameAlpha,
        });
        g.roundRect(menu.x, menu.y, menu.width, menu.height, this.cfg.cornerRadius).stroke({
          color: this.cfg.borderColor,
          width: 1,
        });
      });
    }

    const barEntity = scene.spawn("inv-menu-bar");
    barEntity.add(new Transform());
    const bar = barEntity.add(new GraphicsComponent({ layer: this.cfg.layerOverlay }));

    const labels = rows.map((row) => {
      const entity = scene.spawn("inv-menu-row");
      entity.add(new Transform()).setPosition(row.rect.x + 4, row.rect.y + 1);
      const comp = entity.add(
        new TextComponent(
          makeTextOptions(this.cfg, row.label, this.cfg.textSize, this.cfg.actionColor, this.cfg.layerOverlay),
        ),
      );
      return { entity, comp, rect: row.rect };
    });

    let selected = 0;
    const drawBar = (): void => {
      const r = labels[selected]?.rect;
      bar.draw((g) => {
        g.clear();
        if (!r) return;
        g.roundRect(r.x, r.y, r.width, r.height - 2, this.cfg.highlightRadius).fill({
          color: this.cfg.actionHighlightColor,
          alpha: this.cfg.highlightAlpha,
        });
      });
    };

    return {
      highlight: (position: number): void => {
        if (labels.length === 0) return;
        selected = Math.max(0, Math.min(position, labels.length - 1));
        labels.forEach((row, i) => {
          row.comp.text.tint = i === selected ? this.cfg.actionSelectedColor : this.cfg.actionColor;
        });
        drawBar();
      },
      setVisible: (visible: boolean): void => {
        frame.graphics.visible = visible;
        bar.graphics.visible = visible;
        for (const row of labels) row.comp.text.visible = visible;
      },
      dispose: (): void => {
        for (const row of labels) row.entity.destroy();
        frameEntity.destroy();
        barEntity.destroy();
      },
    };
  }
}
