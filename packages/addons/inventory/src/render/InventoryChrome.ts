/**
 * InventoryChrome — the drawn panel frame: rounded-rect background, header
 * band (title left, slot counter right), and the divider lines that separate
 * the header and detail bands from the content window. Zero assets — pure
 * Graphics + canvas text, like the dialogue addon's default chrome.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent, RendererKey, TextComponent } from "@yagejs/renderer";
import type { InventoryChromeInfo } from "../core/session.js";
import type { ChromePresenter } from "../adapter.js";
import type { PanelLayout } from "./PanelLayout.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

export interface InventoryChromeConfig extends FontConfig {
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly titleSize: number;
  readonly titleColor: number;
  readonly quantitySize: number;
  readonly quantityColor: number;
  /** Frame + dividers. */
  readonly layerPanel: string;
  /** Title + counter text. */
  readonly layerContent: string;
}

export class InventoryChrome implements ChromePresenter {
  private frame?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private title?: TextComponent | undefined;
  private counter?: TextComponent | undefined;
  private hidden = true;
  private layoutUnsub: (() => void) | undefined;

  constructor(
    private readonly cfg: InventoryChromeConfig,
    private readonly layout: PanelLayout,
  ) {}

  mount(scene: Scene): void {
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer) this.layout.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
    // One entity per display component: an entity holds at most one component
    // of a class, and positions flow from each entity's Transform.
    const frame = scene.spawn("inv-chrome-frame");
    frame.add(new Transform());
    this.frame = {
      entity: frame,
      gfx: frame.add(new GraphicsComponent({ layer: this.cfg.layerPanel })),
    };
    const title = scene.spawn("inv-chrome-title");
    title.add(new Transform());
    this.title = title.add(
      new TextComponent(
        makeTextOptions(this.cfg, "", this.cfg.titleSize, this.cfg.titleColor, this.cfg.layerContent),
      ),
    );
    const counter = scene.spawn("inv-chrome-counter");
    counter.add(new Transform());
    this.counter = counter.add(
      new TextComponent(
        makeTextOptions(this.cfg, "", this.cfg.quantitySize, this.cfg.quantityColor, this.cfg.layerContent, {
          x: 1,
          y: 0,
        }),
      ),
    );
    this.layoutUnsub = this.layout.onChange(() => this.redraw());
    this.redraw();
    this.applyHidden();
  }

  present(info: InventoryChromeInfo): void {
    if (this.title) this.title.text.text = info.title ?? "";
    if (this.counter) {
      // The counter only means something with a slot limit; unbounded
      // inventories show none.
      this.counter.text.text = info.capacity !== undefined ? `${info.used}/${info.capacity}` : "";
    }
    this.redraw();
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  dispose(): void {
    this.frame?.entity.destroy();
    this.title?.entity.destroy();
    this.counter?.entity.destroy();
    this.frame = undefined;
    this.title = this.counter = undefined;
    this.layoutUnsub?.();
    this.layoutUnsub = undefined;
  }

  // ------------------------------------------------------------- internals

  private redraw(): void {
    const panel = this.layout.panelRect();
    const header = this.layout.headerRect();
    const detail = this.layout.detailRect();
    const pad = this.layout.padding();

    this.frame?.gfx.draw((g) => {
      g.clear();
      g.roundRect(panel.x, panel.y, panel.width, panel.height, this.cfg.cornerRadius).fill({
        color: this.cfg.frameColor,
        alpha: this.cfg.frameAlpha,
      });
      g.roundRect(panel.x, panel.y, panel.width, panel.height, this.cfg.cornerRadius).stroke({
        color: this.cfg.borderColor,
        width: 1.5,
      });
      if (header.height > 0) {
        const y = header.y + header.height + 4;
        g.moveTo(panel.x + pad, y)
          .lineTo(panel.x + panel.width - pad, y)
          .stroke({ color: this.cfg.borderColor, width: 1, alpha: 0.6 });
      }
      if (detail.height > 0) {
        const y = detail.y - 5;
        g.moveTo(panel.x + pad, y)
          .lineTo(panel.x + panel.width - pad, y)
          .stroke({ color: this.cfg.borderColor, width: 1, alpha: 0.6 });
      }
    });

    this.title?.entity.get(Transform).setPosition(header.x, header.y);
    this.counter?.entity
      .get(Transform)
      .setPosition(header.x + header.width, header.y + (this.cfg.titleSize - this.cfg.quantitySize) / 2 + 1);
  }

  private applyHidden(): void {
    const visible = !this.hidden;
    if (this.frame) this.frame.gfx.graphics.visible = visible;
    if (this.title) this.title.text.visible = visible;
    if (this.counter) this.counter.text.visible = visible;
  }
}
