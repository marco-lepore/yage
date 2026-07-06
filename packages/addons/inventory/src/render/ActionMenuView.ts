/**
 * ActionMenuView — the per-item context popup ("Use / Drop / Examine"): a
 * small list anchored beside the selected cell/row (via the anchor provider the
 * factory wires), clamped into the panel. It owns the BEHAVIOR — label
 * measurement, placement, row-rect computation, and pointer hit-testing — and
 * delegates the DRAWING to a swappable {@link MenuSkinPresenter}. Placement and
 * hit-tests derive from the ONE set of row rects {@link layoutActionMenu}
 * computes, so a custom skin can never desync its drawing from the hit-targets.
 */

import type { Scene } from "@yagejs/core";
import { measureWrappedText, RendererKey } from "@yagejs/renderer";
import type { PresentedAction } from "../core/session.js";
import type { ActionMenuPresenter, MenuSkinHandle, MenuSkinPresenter, MenuSkinRow, Rect } from "../adapter.js";
import type { PanelLayout } from "./PanelLayout.js";
import { layoutActionMenu } from "./menuLayout.js";
import type { FontConfig } from "./textOptions.js";

export interface ActionMenuConfig extends FontConfig {
  readonly textSize: number;
  /** Inner margin between the menu frame and its rows. */
  readonly padding: number;
  /** Vertical gap between menu rows. */
  readonly rowGap: number;
}

export interface ActionMenuViewOptions {
  /** Where to anchor the popup — the factory wires the slots view's
   *  `selectionAnchor`. Undefined (or no provider) centers it in the panel. */
  readonly anchor?: (() => Rect | undefined) | undefined;
}

export class ActionMenuView implements ActionMenuPresenter {
  private scene?: Scene | undefined;
  private handle?: MenuSkinHandle | undefined;
  private rows: readonly MenuSkinRow[] = [];
  private selected = 0;
  private hidden = true;
  private readonly anchor: (() => Rect | undefined) | undefined;

  onActionChosen?: (position: number) => void;

  constructor(
    private readonly cfg: ActionMenuConfig,
    private readonly skin: MenuSkinPresenter,
    private readonly layout: PanelLayout,
    opts: ActionMenuViewOptions = {},
  ) {
    this.anchor = opts.anchor;
  }

  mount(scene: Scene): void {
    this.scene = scene;
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer) this.layout.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
  }

  // Implements (actions, slot) — the slot isn't needed: the anchor provider
  // already points at the selected cell's geometry.
  present(actions: readonly PresentedAction[]): void {
    this.clear();
    const scene = this.scene;
    if (!scene || actions.length === 0) return;

    const labels = actions.map((a) => a.label);
    const font = this.cfg.bitmapFont ?? this.cfg.fontFamily;
    const labelWidths = labels.map(
      (label) =>
        measureWrappedText(label, {
          fontSize: this.cfg.textSize,
          ...(font !== undefined ? { fontFamily: font } : {}),
          ...(this.cfg.bitmapFont !== undefined ? { bitmap: true } : {}),
        }).width,
    );
    const { menu, rows } = layoutActionMenu({
      labels,
      labelWidths,
      anchor: this.anchor?.(),
      panel: this.layout.panelRect(),
      padding: this.cfg.padding,
      rowGap: this.cfg.rowGap,
      textSize: this.cfg.textSize,
    });
    this.rows = rows;
    this.handle = this.skin.renderMenu(scene, menu, rows);
    this.handle.highlight(this.selected < rows.length ? this.selected : 0);
    this.handle.setVisible(!this.hidden);
  }

  highlight(position: number): void {
    if (this.rows.length === 0) return;
    this.selected = Math.max(0, Math.min(position, this.rows.length - 1));
    this.handle?.highlight(this.selected);
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
    this.handle?.setVisible(visible);
  }

  clear(): void {
    this.handle?.dispose();
    this.handle = undefined;
    this.rows = [];
    this.selected = 0;
  }

  dispose(): void {
    this.clear();
    this.scene = undefined;
  }
}
