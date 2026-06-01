/**
 * Default chrome — draws the dialogue box frame, the name plate, and the
 * blinking "continue" caret with the renderer (Graphics + Text on screen-space
 * layers), so this addon needs only renderer + core, not ui-react. The choice
 * list lives in its own {@link ChoiceListPresenter}; the body text lives in
 * {@link DialogueTextView}. This class owns only the frame + nameplate + caret,
 * which makes z-order deterministic and the seams swappable independently.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import type { ChromePresenter } from "./DialogueUiAdapter.js";

export interface DialogueChromeConfig {
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly padding: number;
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly nameColor: number;
  readonly nameSize: number;
  readonly indicatorColor: number;
  readonly bitmapFont?: string | undefined;
  readonly fontFamily?: string | undefined;
  readonly resolution?: number | undefined;
  /** Frame + continue indicator. */
  readonly layerFrame: string;
  /** Name plate (drawn above the frame layer). */
  readonly layerText: string;
}

export class DialogueChrome implements ChromePresenter {
  private frame?: Entity | undefined;
  private frameGfx?: GraphicsComponent | undefined;
  private name?: { entity: Entity; comp: TextComponent } | undefined;
  private indicator?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private indicatorVisible = false;
  private indicatorTime = 0;

  constructor(private readonly cfg: DialogueChromeConfig) {}

  mount(scene: Scene): void {
    const { box, cfg } = { box: this.cfg.box, cfg: this.cfg };

    // Frame.
    const frame = scene.spawn("dlg-frame");
    frame.add(new Transform()).setPosition(0, 0);
    this.frameGfx = frame.add(new GraphicsComponent({ layer: cfg.layerFrame }));
    this.frameGfx.draw((g) => {
      g.roundRect(box.x, box.y, box.width, box.height, cfg.cornerRadius)
        .fill({ color: cfg.frameColor, alpha: cfg.frameAlpha })
        .stroke({ color: cfg.borderColor, alpha: 1, width: 2 });
    });
    this.frame = frame;

    // Name plate.
    const nameEntity = scene.spawn("dlg-name");
    nameEntity.add(new Transform()).setPosition(box.x + cfg.padding, box.y + cfg.padding - 1);
    const nameComp = nameEntity.add(
      new TextComponent(this.textOptions("", cfg.nameSize, cfg.nameColor)),
    );
    this.name = { entity: nameEntity, comp: nameComp };

    // Continue indicator (blinking caret at bottom-right).
    const ind = scene.spawn("dlg-indicator");
    ind.add(new Transform()).setPosition(0, 0);
    const indGfx = ind.add(new GraphicsComponent({ layer: cfg.layerFrame }));
    const ix = box.x + box.width - cfg.padding - 8;
    const iy = box.y + box.height - cfg.padding - 6;
    indGfx.draw((g) => {
      g.poly([ix, iy, ix + 8, iy, ix + 4, iy + 5]).fill({ color: cfg.indicatorColor, alpha: 1 });
    });
    indGfx.graphics.visible = false;
    this.indicator = { entity: ind, gfx: indGfx };
  }

  setNameplate(name: string | undefined, color?: number): void {
    if (!this.name) return;
    if (name) {
      // Mutate fill in place — replacing the whole style would drop the bitmap
      // font (BitmapText resolves its font from style.fontFamily).
      this.name.comp.text.style.fill = color ?? this.cfg.nameColor;
      this.name.comp.setText(name);
      this.name.comp.text.visible = true;
    } else {
      this.name.comp.text.visible = false;
    }
  }

  setContinueVisible(visible: boolean): void {
    this.indicatorVisible = visible;
    if (this.indicator) this.indicator.gfx.graphics.visible = visible;
    this.indicatorTime = 0;
  }

  /** Show/hide the whole box (frame always; name/caret follow their own state). */
  setVisible(visible: boolean): void {
    if (this.frameGfx) this.frameGfx.graphics.visible = visible;
    if (!visible) {
      if (this.name) this.name.comp.text.visible = false;
      if (this.indicator) this.indicator.gfx.graphics.visible = false;
    }
  }

  update(dt: number): void {
    if (this.indicator && this.indicatorVisible) {
      this.indicatorTime += dt;
      this.indicator.gfx.graphics.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.indicatorTime / 260));
    }
  }

  dispose(): void {
    this.frame?.destroy();
    this.name?.entity.destroy();
    this.indicator?.entity.destroy();
    this.frame = undefined;
    this.name = undefined;
    this.indicator = undefined;
  }

  private styleFor(size: number, color: number): TextStyle {
    const style: TextStyle = { fontSize: size, fill: color };
    if (this.cfg.fontFamily) style.fontFamily = this.cfg.fontFamily;
    return style;
  }

  private textOptions(text: string, size: number, color: number): TextComponentOptions {
    // Colour via `style.fill`; the bitmap font name lives in `style.fontFamily`.
    const style = this.styleFor(size, color);
    if (this.cfg.bitmapFont) style.fontFamily = this.cfg.bitmapFont;
    const base: TextComponentOptions = { text, style, layer: this.cfg.layerText, anchor: { x: 0, y: 0 } };
    if (this.cfg.bitmapFont) base.bitmap = true;
    // `exactOptionalPropertyTypes` rejects `resolution: undefined`; omit when unset.
    else if (this.cfg.resolution !== undefined) base.resolution = this.cfg.resolution;
    return base;
  }
}
