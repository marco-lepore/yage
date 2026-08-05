/**
 * InventoryChrome — the drawn panel frame: rounded-rect background, header
 * band (title left, slot counter right), and the divider lines that separate
 * the header and detail bands from the content window. Zero assets — pure
 * Graphics + canvas text, like the dialogue addon's default chrome.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  createNineSlice,
  GraphicsComponent,
  RendererKey,
  TextComponent,
  type NineSliceSprite,
} from "@yagejs/renderer";
import type { InventoryChromeInfo } from "../core/session.js";
import type { ChromePresenter } from "../adapter.js";
import type { NineSliceFrame } from "../factory/theme.js";
import type { PanelLayout } from "./PanelLayout.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

export interface InventoryChromeConfig extends FontConfig {
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  /** Panel-frame stroke width. */
  readonly borderWidth: number;
  /** Opt-in nine-slice panel frame; replaces the drawn fill+stroke when set. */
  readonly textured?: NineSliceFrame | undefined;
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
  /** Nine-slice panel frame (only when `cfg.textured` is set): a sprite hosted
   *  in its own GraphicsComponent, below the divider draws. */
  private frameTex?: { entity: Entity; host: GraphicsComponent; sprite: NineSliceSprite } | undefined;
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
    // Textured frame spawns first so it paints UNDER the divider lines (same
    // panel layer → z is spawn order). Only when the theme opts in.
    if (this.cfg.textured) {
      const panel = this.layout.panelRect();
      const texEntity = scene.spawn("inv-chrome-frame-tex");
      texEntity.add(new Transform());
      const host = texEntity.add(new GraphicsComponent({ layer: this.cfg.layerPanel }));
      const sprite = createNineSlice({
        texture: this.cfg.textured.texture,
        leftWidth: this.cfg.textured.insets.left,
        topHeight: this.cfg.textured.insets.top,
        rightWidth: this.cfg.textured.insets.right,
        bottomHeight: this.cfg.textured.insets.bottom,
        width: panel.width,
        height: panel.height,
      });
      host.graphics.addChild(sprite);
      this.frameTex = { entity: texEntity, host, sprite };
    }
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
    this.title?.setText(info.title ?? "");
    // The counter only means something with a slot limit; unbounded
    // inventories show none.
    this.counter?.setText(info.capacity !== undefined ? `${info.used}/${info.capacity}` : "");
    this.redraw();
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  dispose(): void {
    this.frameTex?.entity.destroy();
    this.frame?.entity.destroy();
    this.title?.entity.destroy();
    this.counter?.entity.destroy();
    this.frameTex = this.frame = undefined;
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

    // A textured frame owns the background + border; the sprite stretches to
    // the panel rect and the drawn fill+stroke are skipped (dividers stay).
    if (this.frameTex) {
      this.frameTex.sprite.x = panel.x;
      this.frameTex.sprite.y = panel.y;
      this.frameTex.sprite.width = panel.width;
      this.frameTex.sprite.height = panel.height;
    }
    this.frame?.gfx.draw((g) => {
      g.clear();
      if (!this.frameTex) {
        g.roundRect(panel.x, panel.y, panel.width, panel.height, this.cfg.cornerRadius).fill({
          color: this.cfg.frameColor,
          alpha: this.cfg.frameAlpha,
        });
        g.roundRect(panel.x, panel.y, panel.width, panel.height, this.cfg.cornerRadius).stroke({
          color: this.cfg.borderColor,
          width: this.cfg.borderWidth,
        });
      }
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
    if (this.frameTex) this.frameTex.host.graphics.visible = visible;
    if (this.frame) this.frame.gfx.graphics.visible = visible;
    if (this.title) this.title.text.visible = visible;
    if (this.counter) this.counter.text.visible = visible;
  }
}
