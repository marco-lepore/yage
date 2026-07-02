/**
 * GridSlotsView — the default slot surface: a windowed grid of cells with
 * icons (or colored fallback tiles with the item's initial), quantity badges,
 * a selection cursor, and integer-row scrolling. All geometry comes from
 * `gridGeometry.ts`, so placement, the cursor, scrolling, and pointer
 * hit-tests can't desync.
 *
 * Each model change rebuilds the visible cell content wholesale (destroy +
 * respawn) — simple and correct for event-driven mutation at menu-sized slot
 * counts. State that ticks EVERY frame (a draining counter) would churn
 * entities; batch such writes if that ever bites.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  resolveTextureInput,
  SpriteComponent,
  TextComponent,
  type GraphicsContext,
  type TextureResource,
} from "@yagejs/renderer";
import type { SlotView } from "../core/session.js";
import type { DiagnosticSink, SlotsPresenter } from "../adapter.js";
import type { PanelLayout } from "./PanelLayout.js";
import {
  gridCellRect,
  gridNavigate,
  gridRows,
  gridScrollRow,
  gridSlotAtPoint,
  gridWindowSize,
  type GridSpec,
  type Rect,
} from "./gridGeometry.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";
import { DEFAULT_TILE_COLORS } from "../factory/theme.js";

export interface GridSlotsConfig extends FontConfig {
  readonly columns: number;
  readonly cellSize: number;
  readonly cellGap: number;
  readonly visibleRows: number;
  /** Wrap cursor navigation at grid edges. Default false (clamp). */
  readonly wrap?: boolean | undefined;
  readonly cellColor: number;
  readonly cellBorderColor: number;
  readonly highlightColor: number;
  readonly quantitySize: number;
  readonly quantityColor: number;
  /** Fallback tile letter color (dark, on the tinted tile). */
  readonly tileColors?: readonly number[] | undefined;
  /**
   * Everything the grid draws — cell backgrounds, cursor, icons, badges — on
   * ONE layer, stacked by mount/spawn order (backgrounds first, cursor, then
   * per-cell content). The chrome frame lives on the lower panel layer, so
   * the near-opaque frame can never paint over the cells.
   */
  readonly layerContent: string;
}

/** One per-slot content group (icon/letter + badge) — one ENTITY per display
 *  component (an entity holds at most one component of a class), positions
 *  driven through each entity's Transform. */
interface CellContent {
  readonly entities: Entity[];
  readonly displays: { visible: boolean }[];
}

export class GridSlotsView implements SlotsPresenter {
  private scene?: Scene | undefined;
  private warn?: DiagnosticSink | undefined;
  private slots: readonly SlotView[] = [];
  private selected = 0;
  private scrollRow = 0;
  private hidden = true;

  private bg?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private tiles?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private cursor?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private content: CellContent[] = [];
  private readonly textures = new Map<string, TextureResource | null>();
  private layoutUnsub: (() => void) | undefined;

  onSlotChosen?: (slot: number) => void;

  constructor(
    private readonly cfg: GridSlotsConfig,
    private readonly layout: PanelLayout,
  ) {}

  setDiagnostics(warn: DiagnosticSink): void {
    this.warn = warn;
  }

  mount(scene: Scene): void {
    this.scene = scene;
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer) this.layout.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
    // Spawn order = paint order within the content layer: cell backgrounds,
    // then the cursor, then (re-spawned per present) the per-cell content.
    const bg = scene.spawn("inv-grid-bg");
    bg.add(new Transform());
    this.bg = { entity: bg, gfx: bg.add(new GraphicsComponent({ layer: this.cfg.layerContent })) };
    const cursor = scene.spawn("inv-grid-cursor");
    cursor.add(new Transform());
    this.cursor = {
      entity: cursor,
      gfx: cursor.add(new GraphicsComponent({ layer: this.cfg.layerContent })),
    };
    const tiles = scene.spawn("inv-grid-tiles");
    tiles.add(new Transform());
    this.tiles = {
      entity: tiles,
      gfx: tiles.add(new GraphicsComponent({ layer: this.cfg.layerContent })),
    };
    this.layoutUnsub = this.layout.onChange(() => this.rebuild());
    this.warnIfOverflowing();
  }

  present(slots: readonly SlotView[]): void {
    this.slots = slots;
    this.scrollRow = gridScrollRow(
      this.selected,
      this.scrollRow,
      this.cfg.visibleRows,
      this.cfg.columns,
      slots.length,
    );
    this.rebuild();
  }

  setSelected(slot: number): void {
    this.selected = slot;
    const next = gridScrollRow(
      slot,
      this.scrollRow,
      this.cfg.visibleRows,
      this.cfg.columns,
      this.slots.length,
    );
    if (next !== this.scrollRow) {
      this.scrollRow = next;
      this.rebuild(); // the window moved — cells re-place
    } else {
      this.drawCursor();
    }
  }

  navigate(from: number, dir: "up" | "down" | "left" | "right"): number {
    return gridNavigate(from, dir, this.slots.length, this.cfg.columns, this.cfg.wrap ?? false);
  }

  /** {@link SlotsPresenter.slotAtPoint}: screen point → cell index. */
  slotAtPoint(x: number, y: number): number | undefined {
    return gridSlotAtPoint(x, y, this.spec(), this.origin(), this.scrollRow, this.slots.length);
  }

  /** The selected cell's screen rect (the action menu anchors to it). */
  selectionAnchor(): Rect | undefined {
    return gridCellRect(this.selected, this.spec(), this.origin(), this.scrollRow) ?? undefined;
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  clear(): void {
    this.slots = [];
    for (const c of this.content) for (const e of c.entities) e.destroy();
    this.content = [];
    this.bg?.gfx.draw((g) => g.clear());
    this.tiles?.gfx.draw((g) => g.clear());
    this.cursor?.gfx.draw((g) => g.clear());
  }

  dispose(): void {
    this.clear();
    this.bg?.entity.destroy();
    this.tiles?.entity.destroy();
    this.cursor?.entity.destroy();
    this.bg = this.tiles = this.cursor = undefined;
    this.layoutUnsub?.();
    this.layoutUnsub = undefined;
    this.scene = undefined;
  }

  // ------------------------------------------------------------- internals

  private spec(): GridSpec {
    return {
      columns: this.cfg.columns,
      cellSize: this.cfg.cellSize,
      cellGap: this.cfg.cellGap,
      visibleRows: this.cfg.visibleRows,
    };
  }

  /** Grid top-left: the content window, grid centered horizontally in it. */
  private origin(): { x: number; y: number } {
    const content = this.layout.contentRect();
    const size = gridWindowSize(this.spec());
    return {
      x: content.x + Math.max(0, Math.round((content.width - size.width) / 2)),
      y: content.y,
    };
  }

  private rebuild(): void {
    if (!this.scene) return;
    for (const c of this.content) for (const e of c.entities) e.destroy();
    this.content = [];

    const origin = this.origin();
    const spec = this.spec();
    this.bg?.gfx.draw((g) => {
      g.clear();
      for (let i = 0; i < this.slots.length; i++) {
        const r = gridCellRect(i, spec, origin, this.scrollRow);
        if (!r) continue;
        g.roundRect(r.x, r.y, r.width, r.height, 4)
          .fill({ color: this.cfg.cellColor })
          .stroke({ color: this.cfg.cellBorderColor, width: 1 });
      }
      this.drawScrollHints(g, origin);
    });

    this.tiles?.gfx.draw((g) => {
      g.clear();
      for (const view of this.slots) {
        if (!view.stack || !view.def || this.iconFor(view.def.icon)) continue;
        const r = gridCellRect(view.slot, spec, origin, this.scrollRow);
        if (!r) continue;
        const inset = 8;
        g.roundRect(r.x + inset, r.y + inset, r.width - 2 * inset, r.height - 2 * inset, 4).fill({
          color: view.def.color ?? this.tileColor(view.def.id),
          alpha: 0.9,
        });
      }
    });

    const scene = this.scene;
    for (const view of this.slots) {
      if (!view.stack || !view.def) continue;
      const r = gridCellRect(view.slot, spec, origin, this.scrollRow);
      if (!r) continue;
      this.content.push(this.spawnCellContent(scene, view.def, view.stack, r));
    }
    this.drawCursor();
    this.applyHidden();
  }

  /** Icon sprite (when the def names one that resolves) or the tile initial,
   *  plus the quantity badge. Positions (and the sprite's size) flow through
   *  each entity's Transform — the DisplaySystem re-applies it every frame. */
  private spawnCellContent(
    scene: Scene,
    def: NonNullable<SlotView["def"]>,
    stack: NonNullable<SlotView["stack"]>,
    r: Rect,
  ): CellContent {
    const entities: Entity[] = [];
    const displays: { visible: boolean }[] = [];

    const texture = this.iconFor(def.icon);
    if (texture) {
      const icon = scene.spawn("inv-grid-icon");
      const size = r.width - 14;
      const t = icon.add(new Transform());
      t.setPosition(r.x + r.width / 2, r.y + r.height / 2);
      const scale = texture.width > 0 ? size / texture.width : 1;
      t.setScale(scale, scale);
      const sprite = icon.add(
        new SpriteComponent({
          texture,
          layer: this.cfg.layerContent,
          anchor: { x: 0.5, y: 0.5 },
        }),
      );
      entities.push(icon);
      displays.push(sprite.sprite);
    } else {
      const letterEntity = scene.spawn("inv-grid-letter");
      letterEntity.add(new Transform()).setPosition(r.x + r.width / 2, r.y + r.height / 2);
      const letter = letterEntity.add(
        new TextComponent(
          makeTextOptions(
            this.cfg,
            (def.name[0] ?? "?").toUpperCase(),
            Math.round(r.width * 0.4),
            0x1a1a2e,
            this.cfg.layerContent,
            { x: 0.5, y: 0.5 },
          ),
        ),
      );
      entities.push(letterEntity);
      displays.push(letter.text);
    }

    if (stack.quantity > 1) {
      const badgeEntity = scene.spawn("inv-grid-qty");
      badgeEntity.add(new Transform()).setPosition(r.x + r.width - 3, r.y + r.height - 1);
      const badge = badgeEntity.add(
        new TextComponent(
          makeTextOptions(
            this.cfg,
            String(stack.quantity),
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
    return { entities, displays };
  }

  /** Resolve (and cache) an icon texture; a bad key warns once and falls back
   *  to the colored tile. */
  private iconFor(icon: string | undefined): TextureResource | null {
    if (!icon) return null;
    const cached = this.textures.get(icon);
    if (cached !== undefined) return cached;
    let resolved: TextureResource | null = null;
    try {
      resolved = resolveTextureInput(icon);
    } catch {
      this.warn?.(`inventory icon "${icon}" did not resolve to a texture — using the tile fallback`);
    }
    this.textures.set(icon, resolved);
    return resolved;
  }

  /** Stable palette pick per item id (icon-less items keep their color). */
  private tileColor(id: string): number {
    const palette = this.cfg.tileColors ?? DEFAULT_TILE_COLORS;
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length] ?? 0xc9c9de;
  }

  private drawCursor(): void {
    const r = gridCellRect(this.selected, this.spec(), this.origin(), this.scrollRow);
    this.cursor?.gfx.draw((g) => {
      g.clear();
      if (!r) return;
      g.roundRect(r.x - 1, r.y - 1, r.width + 2, r.height + 2, 5).stroke({
        color: this.cfg.highlightColor,
        width: 2,
      });
    });
  }

  /** Small ▲/▼ hints at the window's right edge when rows are scrolled out. */
  private drawScrollHints(g: GraphicsContext, origin: { x: number; y: number }): void {
    const size = gridWindowSize(this.spec());
    const totalRows = gridRows(this.slots.length, this.cfg.columns);
    const x = origin.x + size.width + 6;
    if (this.scrollRow > 0) {
      g.moveTo(x, origin.y + 6)
        .lineTo(x + 8, origin.y + 6)
        .lineTo(x + 4, origin.y)
        .closePath()
        .fill({ color: this.cfg.cellBorderColor });
    }
    if (this.scrollRow + this.cfg.visibleRows < totalRows) {
      const y = origin.y + size.height;
      g.moveTo(x, y - 6)
        .lineTo(x + 8, y - 6)
        .lineTo(x + 4, y)
        .closePath()
        .fill({ color: this.cfg.cellBorderColor });
    }
  }

  private applyHidden(): void {
    const visible = !this.hidden;
    if (this.bg) this.bg.gfx.graphics.visible = visible;
    if (this.tiles) this.tiles.gfx.graphics.visible = visible;
    if (this.cursor) this.cursor.gfx.graphics.visible = visible;
    for (const c of this.content) for (const d of c.displays) d.visible = visible;
  }

  /** Dev aid: a grid window larger than the content rect (an embedded
   *  `bounds` too small for `columns × visibleRows`) renders clipped — say so
   *  instead of leaving a silently overflowing panel. */
  private warnIfOverflowing(): void {
    const size = gridWindowSize(this.spec());
    const content = this.layout.contentRect();
    if (size.width > content.width + 1 || size.height > content.height + 1) {
      this.warn?.(
        `inventory grid (${size.width}×${size.height}px for ${this.cfg.columns} columns × ` +
          `${this.cfg.visibleRows} rows) overflows its panel content area ` +
          `(${Math.round(content.width)}×${Math.round(content.height)}px) — enlarge the bounds ` +
          `or reduce columns/visibleRows`,
      );
    }
  }
}
