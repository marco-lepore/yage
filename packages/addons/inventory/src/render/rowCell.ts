/**
 * `rowCell` — a text-row cell preset: the item name left-aligned, a
 * right-aligned `×qty`, and a filled highlight bar on the selected row. This
 * is the classic JRPG name-list look; a single-column panel of these is a
 * "list", a two-column panel is a text menu.
 *
 * Its default extents are wide and short (a full panel-width row), so
 * `createInventoryPanel(theme, { cell: rowCell })` with no other geometry
 * options reproduces the old list panel. The bar graphics is spawned before
 * the text so it paints underneath.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import type { CellDefaults, CellHandle, CellPresenter, Rect } from "../adapter.js";
import type { SlotView } from "../core/session.js";
import type { InventoryTheme } from "../factory/theme.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

/** Intrinsic width of a default row (the old list panel width). Cell width is
 *  this minus the panel padding on both sides. */
const LIST_PANEL_WIDTH = 420;
/** Left indent of a row's text inside its rect (room for the bar's edge). */
const ROW_TEXT_INDENT = 8;

interface RowCellConfig extends FontConfig {
  readonly textSize: number;
  readonly textColor: number;
  readonly quantitySize: number;
  readonly quantityColor: number;
  readonly highlightColor: number;
  readonly highlightRadius: number;
  readonly rowHighlightAlpha: number;
  readonly layerContent: string;
}

/** Build a text-row preset from a theme. Assigned as `{ cell: rowCell }`
 *  (uncalled) on the factory options — the factory calls it with the theme. */
export function rowCell(theme: InventoryTheme): CellPresenter {
  return new RowCellPresenter(theme);
}

class RowCellPresenter implements CellPresenter {
  readonly defaults: CellDefaults;
  private readonly cfg: RowCellConfig;

  constructor(theme: InventoryTheme) {
    this.defaults = {
      columns: 1,
      visibleRows: 8,
      cellWidth: LIST_PANEL_WIDTH - 2 * theme.padding,
      cellHeight: theme.textSize + 12,
      gapX: 0,
      gapY: 0,
    };
    this.cfg = {
      textSize: theme.textSize,
      textColor: theme.textColor,
      quantitySize: theme.quantitySize,
      quantityColor: theme.quantityColor,
      highlightColor: theme.highlightColor,
      highlightRadius: theme.highlightRadius ?? Math.max((theme.cellRadius ?? theme.cornerRadius / 2) - 1, 0),
      rowHighlightAlpha: theme.rowHighlightAlpha ?? 0.22,
      layerContent: theme.layerContent,
      bitmapFont: theme.bitmapFont,
      fontFamily: theme.fontFamily,
      resolution: theme.resolution,
    };
  }

  renderCell(scene: Scene, view: SlotView, r: Rect, selected: boolean): CellHandle {
    // Highlight bar first (paints under the text). Empty rows still get it, so
    // an empty slot is a blank, selectable row.
    const barEntity = scene.spawn("inv-row-bar");
    barEntity.add(new Transform());
    const bar = barEntity.add(new GraphicsComponent({ layer: this.cfg.layerContent }));
    const draw = (sel: boolean): void => {
      bar.draw((g) => {
        g.clear();
        if (sel) {
          g.roundRect(r.x, r.y, r.width, r.height - 1, this.cfg.highlightRadius).fill({
            color: this.cfg.highlightColor,
            alpha: this.cfg.rowHighlightAlpha,
          });
        }
      });
    };
    draw(selected);

    const entities: Entity[] = [];
    const displays: { visible: boolean }[] = [];
    if (view.stack && view.def) {
      const nameEntity = scene.spawn("inv-row-name");
      nameEntity
        .add(new Transform())
        .setPosition(r.x + ROW_TEXT_INDENT, r.y + (r.height - this.cfg.textSize) / 2 - 1);
      const name = nameEntity.add(
        new TextComponent(
          makeTextOptions(this.cfg, view.def.name, this.cfg.textSize, this.cfg.textColor, this.cfg.layerContent),
        ),
      );
      entities.push(nameEntity);
      displays.push(name.text);

      if (view.stack.quantity > 1) {
        const qtyEntity = scene.spawn("inv-row-qty");
        qtyEntity
          .add(new Transform())
          .setPosition(r.x + r.width - ROW_TEXT_INDENT, r.y + (r.height - this.cfg.quantitySize) / 2);
        const qty = qtyEntity.add(
          new TextComponent(
            makeTextOptions(
              this.cfg,
              `×${view.stack.quantity}`,
              this.cfg.quantitySize,
              this.cfg.quantityColor,
              this.cfg.layerContent,
              { x: 1, y: 0 },
            ),
          ),
        );
        entities.push(qtyEntity);
        displays.push(qty.text);
      }
    }

    return {
      setSelected: draw,
      setVisible: (visible: boolean): void => {
        bar.graphics.visible = visible;
        for (const d of displays) d.visible = visible;
      },
      dispose: (): void => {
        for (const e of entities) e.destroy();
        barEntity.destroy();
      },
    };
  }
}
