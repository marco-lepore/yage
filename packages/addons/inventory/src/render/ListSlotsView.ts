/**
 * ListSlotsView — the name-list slot surface (classic JRPG item menus): one
 * row per slot with the item name and a right-aligned quantity, a highlight
 * bar on the cursor row, and integer-row scrolling. Pairs naturally with an
 * `autoCompact` inventory (no holes); an empty slot renders as a blank,
 * still-selectable row. All geometry comes from `listGeometry.ts`.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent, RendererKey, TextComponent } from "@yagejs/renderer";
import type { SlotView } from "../core/session.js";
import type { SlotsPresenter } from "../adapter.js";
import type { PanelLayout } from "./PanelLayout.js";
import type { Rect } from "./gridGeometry.js";
import { listNavigate, listRowAtPoint, listRowRect, listScrollOffset, type ListSpec } from "./listGeometry.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

export interface ListSlotsConfig extends FontConfig {
  readonly rowHeight: number;
  readonly visibleRows: number;
  /** Wrap cursor navigation at the ends. Default false (clamp). */
  readonly wrap?: boolean | undefined;
  readonly textSize: number;
  readonly textColor: number;
  readonly quantitySize: number;
  readonly quantityColor: number;
  readonly highlightColor: number;
  /** Everything the list draws — highlight bar, scroll hints, row text — on
   *  ONE layer, stacked by mount/spawn order (bar first, text re-spawned per
   *  present above it). The chrome frame lives on the lower panel layer. */
  readonly layerContent: string;
}

/** One entity per text node (an entity holds at most one component of a
 *  class), positions driven through each entity's Transform. */
interface ListRow {
  readonly entities: Entity[];
  readonly displays: { visible: boolean }[];
}

/** Left indent of a row's text inside its rect (room for the bar's edge). */
const ROW_TEXT_INDENT = 8;

export class ListSlotsView implements SlotsPresenter {
  private scene?: Scene | undefined;
  private slots: readonly SlotView[] = [];
  private selected = 0;
  private offset = 0;
  private hidden = true;

  private bar?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private hints?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private rows: ListRow[] = [];
  private layoutUnsub: (() => void) | undefined;

  onSlotChosen?: (slot: number) => void;

  constructor(
    private readonly cfg: ListSlotsConfig,
    private readonly layout: PanelLayout,
  ) {}

  mount(scene: Scene): void {
    this.scene = scene;
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer) this.layout.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
    // Spawn order = paint order within the content layer: bar under the
    // (re-spawned per present) row text.
    const bar = scene.spawn("inv-list-bar");
    bar.add(new Transform());
    this.bar = { entity: bar, gfx: bar.add(new GraphicsComponent({ layer: this.cfg.layerContent })) };
    const hints = scene.spawn("inv-list-hints");
    hints.add(new Transform());
    this.hints = {
      entity: hints,
      gfx: hints.add(new GraphicsComponent({ layer: this.cfg.layerContent })),
    };
    this.layoutUnsub = this.layout.onChange(() => this.rebuild());
  }

  present(slots: readonly SlotView[]): void {
    this.slots = slots;
    this.offset = listScrollOffset(this.selected, this.offset, this.cfg.visibleRows, slots.length);
    this.rebuild();
  }

  setSelected(slot: number): void {
    this.selected = slot;
    const next = listScrollOffset(slot, this.offset, this.cfg.visibleRows, this.slots.length);
    if (next !== this.offset) {
      this.offset = next;
      this.rebuild();
    } else {
      this.drawBar();
    }
  }

  navigate(from: number, dir: "up" | "down" | "left" | "right"): number {
    return listNavigate(from, dir, this.slots.length, this.cfg.wrap ?? false);
  }

  slotAtPoint(x: number, y: number): number | undefined {
    const content = this.layout.contentRect();
    return listRowAtPoint(x, y, this.spec(), content, this.offset, this.slots.length, content.width);
  }

  /** The selected row's screen rect (the action menu anchors to it). */
  selectionAnchor(): Rect | undefined {
    const content = this.layout.contentRect();
    return listRowRect(this.selected, this.spec(), content, this.offset, content.width) ?? undefined;
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  clear(): void {
    this.slots = [];
    for (const row of this.rows) for (const e of row.entities) e.destroy();
    this.rows = [];
    this.bar?.gfx.draw((g) => g.clear());
    this.hints?.gfx.draw((g) => g.clear());
  }

  dispose(): void {
    this.clear();
    this.bar?.entity.destroy();
    this.hints?.entity.destroy();
    this.bar = this.hints = undefined;
    this.layoutUnsub?.();
    this.layoutUnsub = undefined;
    this.scene = undefined;
  }

  // ------------------------------------------------------------- internals

  private spec(): ListSpec {
    return { rowHeight: this.cfg.rowHeight, visibleRows: this.cfg.visibleRows };
  }

  private rebuild(): void {
    if (!this.scene) return;
    for (const row of this.rows) for (const e of row.entities) e.destroy();
    this.rows = [];
    const content = this.layout.contentRect();

    for (const view of this.slots) {
      const r = listRowRect(view.slot, this.spec(), content, this.offset, content.width);
      if (!r || !view.stack || !view.def) continue;
      const entities: Entity[] = [];
      const displays: { visible: boolean }[] = [];

      const nameEntity = this.scene.spawn("inv-list-name");
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
        const qtyEntity = this.scene.spawn("inv-list-qty");
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
      this.rows.push({ entities, displays });
    }

    this.hints?.gfx.draw((g) => {
      g.clear();
      const x = content.x + content.width - 10;
      if (this.offset > 0) {
        g.moveTo(x, content.y - 2).lineTo(x + 8, content.y - 2).lineTo(x + 4, content.y - 8).closePath().fill({
          color: this.cfg.highlightColor,
          alpha: 0.6,
        });
      }
      if (this.offset + this.cfg.visibleRows < this.slots.length) {
        const y = content.y + this.cfg.visibleRows * this.cfg.rowHeight + 2;
        g.moveTo(x, y).lineTo(x + 8, y).lineTo(x + 4, y + 6).closePath().fill({
          color: this.cfg.highlightColor,
          alpha: 0.6,
        });
      }
    });

    this.drawBar();
    this.applyHidden();
  }

  private drawBar(): void {
    const content = this.layout.contentRect();
    const r = listRowRect(this.selected, this.spec(), content, this.offset, content.width);
    this.bar?.gfx.draw((g) => {
      g.clear();
      if (!r) return;
      g.roundRect(r.x, r.y, r.width, r.height - 1, 3).fill({
        color: this.cfg.highlightColor,
        alpha: 0.22,
      });
    });
  }

  private applyHidden(): void {
    const visible = !this.hidden;
    if (this.bar) this.bar.gfx.graphics.visible = visible;
    if (this.hints) this.hints.gfx.graphics.visible = visible;
    for (const row of this.rows) for (const d of row.displays) d.visible = visible;
  }
}
