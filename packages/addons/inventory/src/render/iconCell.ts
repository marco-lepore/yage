/**
 * `iconCell` — the default cell preset: an icon sprite (or a colored fallback
 * tile with the item's initial) plus a quantity badge, on a rounded cell
 * background with a stroked selection outline. This is the classic grid look;
 * pair it with square-ish `cellWidth`/`cellHeight`.
 *
 * The preset owns everything a cell draws — background, tile, outline, icon,
 * badge — into a rect the view hands it; the view owns placement and scrolling.
 * A single graphics object carries the background + tile + selection outline so
 * a selection change is one redraw with no entity churn.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  resolveTextureInput,
  SpriteComponent,
  TextComponent,
  type TextureResource,
} from "@yagejs/renderer";
import type { CellDefaults, CellHandle, CellPresenter, DiagnosticSink, Rect } from "../adapter.js";
import type { SlotView } from "../core/session.js";
import type { InventoryTheme } from "../factory/theme.js";
import { DEFAULT_TILE_COLORS, resolveCellRadius } from "../factory/theme.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

/** Default cell letter color when the theme omits `tileLetterColor`. */
const DEFAULT_TILE_LETTER_COLOR = 0x1a1a2e;

interface IconCellConfig extends FontConfig {
  readonly cellColor: number;
  readonly cellBorderColor: number;
  readonly cellRadius: number;
  readonly highlightColor: number;
  readonly quantitySize: number;
  readonly quantityColor: number;
  readonly tileLetterColor: number;
  readonly tileColors?: readonly number[] | undefined;
  readonly layerContent: string;
}

/** Build an icon-cell preset from a theme. Assigned as `{ cell: iconCell }`
 *  (uncalled) on the factory options — the factory calls it with the theme. */
export function iconCell(theme: InventoryTheme): CellPresenter {
  return new IconCellPresenter(theme);
}

class IconCellPresenter implements CellPresenter {
  readonly defaults: CellDefaults = {
    columns: 5,
    visibleRows: 4,
    cellWidth: 56,
    cellHeight: 56,
    gapX: 6,
    gapY: 6,
  };

  /** Resolved theme values, held as a plain object so a theme drift-guard can
   *  see every field reached a config leaf. */
  private readonly cfg: IconCellConfig;
  /** Icon keys that failed to resolve — warned once, then tile-fallback. */
  private readonly missingIcons = new Set<string>();
  private warn: DiagnosticSink | undefined;

  constructor(theme: InventoryTheme) {
    this.cfg = {
      cellColor: theme.cellColor,
      cellBorderColor: theme.cellBorderColor,
      cellRadius: resolveCellRadius(theme),
      highlightColor: theme.highlightColor,
      quantitySize: theme.quantitySize,
      quantityColor: theme.quantityColor,
      tileLetterColor: theme.tileLetterColor ?? DEFAULT_TILE_LETTER_COLOR,
      tileColors: theme.tileColors,
      layerContent: theme.layerContent,
      bitmapFont: theme.bitmapFont,
      fontFamily: theme.fontFamily,
      resolution: theme.resolution,
    };
  }

  setDiagnostics(warn: DiagnosticSink): void {
    this.warn = warn;
  }

  renderCell(scene: Scene, view: SlotView, r: Rect, selected: boolean): CellHandle {
    // The fallback tile fill (icon-less occupied slots only).
    const tile =
      view.stack && view.def && !this.iconFor(view.def.icon)
        ? (view.def.color ?? this.tileColor(view.def.id))
        : undefined;

    // One graphics carries background + tile + selection outline. Spawned
    // first so the content below paints over it.
    const bgEntity = scene.spawn("inv-cell-bg");
    bgEntity.add(new Transform());
    const bg = bgEntity.add(new GraphicsComponent({ layer: this.cfg.layerContent }));
    const draw = (sel: boolean): void => {
      bg.draw((g) => {
        g.clear();
        g.roundRect(r.x, r.y, r.width, r.height, this.cfg.cellRadius)
          .fill({ color: this.cfg.cellColor })
          .stroke({ color: this.cfg.cellBorderColor, width: 1 });
        if (tile !== undefined) {
          const inset = 8;
          g.roundRect(r.x + inset, r.y + inset, r.width - 2 * inset, r.height - 2 * inset, this.cfg.cellRadius).fill({
            color: tile,
            alpha: 0.9,
          });
        }
        if (sel) {
          g.roundRect(r.x - 1, r.y - 1, r.width + 2, r.height + 2, this.cfg.cellRadius + 1).stroke({
            color: this.cfg.highlightColor,
            width: 2,
          });
        }
      });
    };
    draw(selected);

    // Content: icon sprite (or the tile initial) + quantity badge. Positions
    // and the sprite's size flow through each entity's Transform.
    const entities: Entity[] = [];
    const displays: { visible: boolean }[] = [];
    if (view.stack && view.def) {
      const iconKey = view.def.icon;
      const texture = this.iconFor(iconKey);
      if (texture && iconKey !== undefined) {
        const icon = scene.spawn("inv-cell-icon");
        const size = r.width - 14;
        const t = icon.add(new Transform());
        t.setPosition(r.x + r.width / 2, r.y + r.height / 2);
        const scale = texture.width > 0 ? size / texture.width : 1;
        t.setScale(scale, scale);
        const sprite = icon.add(
          // The key (resolved above) keeps the sprite serializable; the
          // component re-resolves the same cached texture from it.
          new SpriteComponent({ texture: iconKey, layer: this.cfg.layerContent, anchor: { x: 0.5, y: 0.5 } }),
        );
        entities.push(icon);
        displays.push(sprite.sprite);
      } else {
        const letterEntity = scene.spawn("inv-cell-letter");
        letterEntity.add(new Transform()).setPosition(r.x + r.width / 2, r.y + r.height / 2);
        const letter = letterEntity.add(
          new TextComponent(
            makeTextOptions(
              this.cfg,
              (view.name[0] ?? "?").toUpperCase(),
              Math.round(r.width * 0.4),
              this.cfg.tileLetterColor,
              this.cfg.layerContent,
              { x: 0.5, y: 0.5 },
            ),
          ),
        );
        entities.push(letterEntity);
        displays.push(letter.text);
      }

      if (view.stack.quantity > 1) {
        const badgeEntity = scene.spawn("inv-cell-qty");
        badgeEntity.add(new Transform()).setPosition(r.x + r.width - 3, r.y + r.height - 1);
        const badge = badgeEntity.add(
          new TextComponent(
            makeTextOptions(
              this.cfg,
              String(view.stack.quantity),
              this.cfg.quantitySize,
              this.cfg.quantityColor,
              this.cfg.layerContent,
              { x: 1, y: 1 },
            ),
          ),
        );
        entities.push(badgeEntity);
        displays.push(badge.text);
      }
    }

    return {
      setSelected: draw,
      setVisible: (visible: boolean): void => {
        bg.graphics.visible = visible;
        for (const d of displays) d.visible = visible;
      },
      dispose: (): void => {
        for (const e of entities) e.destroy();
        bgEntity.destroy();
      },
    };
  }

  /** Resolve an icon texture, fresh per call, so the scale math reads the
   *  same cache entry the sprite resolves at construction (a re-registered
   *  key is never scaled by a stale instance). A bad key warns once and
   *  permanently falls back to the colored tile. */
  private iconFor(icon: string | undefined): TextureResource | null {
    if (!icon || this.missingIcons.has(icon)) return null;
    try {
      return resolveTextureInput(icon);
    } catch {
      this.warn?.(`inventory icon "${icon}" did not resolve to a texture — using the tile fallback`);
      this.missingIcons.add(icon);
      return null;
    }
  }

  /** Stable palette pick per item id (icon-less items keep their color). */
  private tileColor(id: string): number {
    const palette = this.cfg.tileColors ?? DEFAULT_TILE_COLORS;
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length] ?? 0xc9c9de;
  }
}
