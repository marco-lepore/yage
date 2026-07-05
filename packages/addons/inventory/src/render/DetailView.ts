/**
 * DetailView — the selected-item pane in the panel's bottom band: item name
 * (with quantity) and the wrapped description. Two persistent TextComponents
 * updated in place; nothing to rebuild per selection.
 */

import { Transform, type Scene } from "@yagejs/core";
import { RendererKey, TextComponent } from "@yagejs/renderer";
import type { SlotView } from "../core/session.js";
import type { DetailPresenter } from "../adapter.js";
import type { PanelLayout } from "./PanelLayout.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

export interface DetailConfig extends FontConfig {
  readonly textSize: number;
  readonly textColor: number;
  readonly descriptionColor: number;
  readonly descriptionSize: number;
  readonly layerContent: string;
}

export class DetailView implements DetailPresenter {
  private name?: TextComponent | undefined;
  private description?: TextComponent | undefined;
  private hidden = true;
  /** The last presented view, so a layout change can re-place live text. */
  private current: SlotView | null = null;
  private layoutUnsub: (() => void) | undefined;

  constructor(
    private readonly cfg: DetailConfig,
    private readonly layout: PanelLayout,
  ) {}

  mount(scene: Scene): void {
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer) this.layout.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
    // One entity per text node (one component of a class per entity), placed
    // through each entity's Transform.
    const name = scene.spawn("inv-detail-name");
    name.add(new Transform());
    this.name = name.add(
      new TextComponent(makeTextOptions(this.cfg, "", this.cfg.textSize, this.cfg.textColor, this.cfg.layerContent)),
    );
    const description = scene.spawn("inv-detail-desc");
    description.add(new Transform());
    this.description = description.add(
      new TextComponent(
        makeTextOptions(this.cfg, "", this.cfg.descriptionSize, this.cfg.descriptionColor, this.cfg.layerContent),
      ),
    );
    this.place();
    this.layoutUnsub = this.layout.onChange(() => {
      this.place();
      this.present(this.current);
    });
    this.applyHidden();
  }

  present(view: SlotView | null): void {
    this.current = view;
    if (!this.name || !this.description) return;
    const stack = view?.stack;
    const def = view?.def;
    if (!stack || !def) {
      this.name.text.text = "";
      this.description.text.text = "";
      return;
    }
    this.name.text.text = stack.quantity > 1 ? `${def.name} ×${stack.quantity}` : def.name;
    this.description.text.text = def.description ?? "";
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  clear(): void {
    this.present(null);
  }

  dispose(): void {
    this.name?.entity.destroy();
    this.description?.entity.destroy();
    this.name = this.description = undefined;
    this.layoutUnsub?.();
    this.layoutUnsub = undefined;
  }

  private place(): void {
    const r = this.layout.detailRect();
    this.name?.entity.get(Transform).setPosition(r.x + 2, r.y);
    if (this.description) {
      this.description.entity.get(Transform).setPosition(r.x + 2, r.y + this.cfg.textSize + 7);
      this.description.text.style.wordWrap = true;
      this.description.text.style.wordWrapWidth = Math.max(10, r.width - 4);
    }
  }

  private applyHidden(): void {
    const visible = !this.hidden;
    if (this.name) this.name.text.visible = visible;
    if (this.description) this.description.text.visible = visible;
  }
}
