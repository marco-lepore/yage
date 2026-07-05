/**
 * ActionMenuView — the per-item context popup ("Use / Drop / Examine"): a
 * small framed list anchored beside the selected cell/row (via the anchor
 * provider the factory wires), clamped into the panel. Row placement, the
 * highlight bar, and pointer hit-tests all derive from the ONE set of row
 * rects computed at present.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent, measureWrappedText, RendererKey, TextComponent } from "@yagejs/renderer";
import type { PresentedAction } from "../core/session.js";
import type { ActionMenuPresenter } from "../adapter.js";
import type { PanelLayout } from "./PanelLayout.js";
import type { Rect } from "./gridGeometry.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

export interface ActionMenuConfig extends FontConfig {
  readonly textSize: number;
  readonly actionColor: number;
  readonly actionSelectedColor: number;
  readonly actionHighlightColor: number;
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  /** Inner margin between the menu frame and its rows. */
  readonly padding: number;
  /** Vertical gap between menu rows. */
  readonly rowGap: number;
  /** Everything menu (frame, bar, labels) — one overlay layer above the panel. */
  readonly layerOverlay: string;
}

export interface ActionMenuViewOptions {
  /** Where to anchor the popup — the factory wires the slots view's
   *  `selectionAnchor`. Undefined (or no provider) centers it in the panel. */
  readonly anchor?: (() => Rect | undefined) | undefined;
}

/** One entity per row label (an entity holds at most one component of a
 *  class), placed through its Transform. */
interface MenuRow {
  readonly entity: Entity;
  readonly comp: TextComponent;
  readonly rect: Rect;
}

export class ActionMenuView implements ActionMenuPresenter {
  private scene?: Scene | undefined;
  private frame?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private bar?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private rows: MenuRow[] = [];
  private selected = 0;
  private hidden = true;
  private readonly anchor: (() => Rect | undefined) | undefined;

  onActionChosen?: (position: number) => void;

  constructor(
    private readonly cfg: ActionMenuConfig,
    private readonly layout: PanelLayout,
    opts: ActionMenuViewOptions = {},
  ) {
    this.anchor = opts.anchor;
  }

  mount(scene: Scene): void {
    this.scene = scene;
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer) this.layout.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
    const frame = scene.spawn("inv-menu-frame");
    frame.add(new Transform());
    this.frame = {
      entity: frame,
      gfx: frame.add(new GraphicsComponent({ layer: this.cfg.layerOverlay })),
    };
    const bar = scene.spawn("inv-menu-bar");
    bar.add(new Transform());
    this.bar = { entity: bar, gfx: bar.add(new GraphicsComponent({ layer: this.cfg.layerOverlay })) };
  }

  // Implements (actions, slot) — the slot isn't needed: the anchor provider
  // already points at the selected cell's geometry.
  present(actions: readonly PresentedAction[]): void {
    this.clear();
    const scene = this.scene;
    if (!scene || actions.length === 0) return;

    const PAD = this.cfg.padding;
    const ROW_GAP = this.cfg.rowGap;
    const rowHeight = this.cfg.textSize + ROW_GAP;
    const font = this.cfg.bitmapFont ?? this.cfg.fontFamily;
    const widths = actions.map(
      (a) =>
        measureWrappedText(a.label, {
          fontSize: this.cfg.textSize,
          ...(font !== undefined ? { fontFamily: font } : {}),
          ...(this.cfg.bitmapFont !== undefined ? { bitmap: true } : {}),
        }).width,
    );
    const menuW = Math.ceil(Math.max(...widths)) + 2 * PAD + 8;
    const menuH = actions.length * rowHeight + 2 * PAD - ROW_GAP + 4;
    const { x, y } = this.placeMenu(menuW, menuH);

    this.frame?.gfx.draw((g) => {
      g.clear();
      g.roundRect(x, y, menuW, menuH, this.cfg.cornerRadius).fill({
        color: this.cfg.frameColor,
        alpha: this.cfg.frameAlpha,
      });
      g.roundRect(x, y, menuW, menuH, this.cfg.cornerRadius).stroke({ color: this.cfg.borderColor, width: 1 });
    });

    this.rows = actions.map((action, i) => {
      const rect: Rect = {
        x: x + PAD - 4,
        y: y + PAD - 2 + i * rowHeight,
        width: menuW - 2 * (PAD - 4),
        height: rowHeight,
      };
      const entity = scene.spawn("inv-menu-row");
      entity.add(new Transform()).setPosition(x + PAD, rect.y + 1);
      const comp = entity.add(
        new TextComponent(
          makeTextOptions(this.cfg, action.label, this.cfg.textSize, this.cfg.actionColor, this.cfg.layerOverlay),
        ),
      );
      return { entity, comp, rect };
    });
    this.highlight(this.selected < this.rows.length ? this.selected : 0);
    this.applyHidden();
  }

  highlight(position: number): void {
    if (this.rows.length === 0) return;
    this.selected = Math.max(0, Math.min(position, this.rows.length - 1));
    this.rows.forEach((row, i) => {
      row.comp.text.tint = i === this.selected ? this.cfg.actionSelectedColor : this.cfg.actionColor;
    });
    const r = this.rows[this.selected]?.rect;
    this.bar?.gfx.draw((g) => {
      g.clear();
      if (!r) return;
      g.roundRect(r.x, r.y, r.width, r.height - 2, 3).fill({
        color: this.cfg.actionHighlightColor,
        alpha: 0.45,
      });
    });
  }

  /** {@link ActionMenuPresenter.actionAtPoint}: screen point → menu row. */
  actionAtPoint(x: number, y: number): number | undefined {
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]?.rect;
      if (r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return i;
    }
    return undefined;
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  clear(): void {
    for (const row of this.rows) row.entity.destroy();
    this.rows = [];
    this.selected = 0;
    this.frame?.gfx.draw((g) => g.clear());
    this.bar?.gfx.draw((g) => g.clear());
  }

  dispose(): void {
    this.clear();
    this.frame?.entity.destroy();
    this.bar?.entity.destroy();
    this.frame = this.bar = undefined;
  }

  // ------------------------------------------------------------- internals

  /** Beside the anchored cell (flipping left when it would overflow), clamped
   *  into the panel; no anchor → panel-centered. */
  private placeMenu(menuW: number, menuH: number): { x: number; y: number } {
    const panel = this.layout.panelRect();
    const anchor = this.anchor?.();
    if (!anchor) {
      return {
        x: panel.x + (panel.width - menuW) / 2,
        y: panel.y + (panel.height - menuH) / 2,
      };
    }
    let x = anchor.x + anchor.width + 6;
    if (x + menuW > panel.x + panel.width) x = anchor.x - menuW - 6;
    let y = anchor.y;
    y = Math.min(y, panel.y + panel.height - menuH - 4);
    x = Math.max(x, panel.x + 4);
    y = Math.max(y, panel.y + 4);
    return { x, y };
  }

  private applyHidden(): void {
    const visible = !this.hidden;
    if (this.frame) this.frame.gfx.graphics.visible = visible;
    if (this.bar) this.bar.gfx.graphics.visible = visible;
    for (const row of this.rows) row.comp.text.visible = visible;
  }
}
