/**
 * Default chrome — draws the dialogue box frame, the name plate, and the
 * blinking "continue" caret with the renderer (Graphics + Text on screen-space
 * layers), so this addon needs only renderer + core, not ui-react. The choice
 * list lives in its own {@link ChoiceListPresenter}; the body text lives in
 * {@link DialogueTextView}. This class owns only the frame + nameplate + caret,
 * which makes z-order deterministic and the seams swappable independently.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { caretAlpha, drawCaret } from "./caret.js";
import type { ChromePresenter } from "./DialogueUiAdapter.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

export interface DialogueChromeConfig extends FontConfig {
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly padding: number;
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly nameColor: number;
  readonly nameSize: number;
  readonly indicatorColor: number;
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
  private indicatorTime = 0;
  /** Master gate (from {@link setVisible}); the Session drives it. Hidden at
   *  mount until a line shows. The name/caret also need their own content
   *  sub-state — each renders only when shown AND its content is present. */
  private visible = false;
  private nameShown = false;
  private caretShown = false;

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
    // Hidden at mount (the Session shows it via setVisible when a line arrives),
    // so a box-only bundle doesn't show an empty frame from scene start.
    this.frameGfx.graphics.visible = false;
    this.frame = frame;

    // Name plate.
    const nameEntity = scene.spawn("dlg-name");
    nameEntity.add(new Transform()).setPosition(box.x + cfg.padding, box.y + cfg.padding - 1);
    const nameComp = nameEntity.add(
      new TextComponent(makeTextOptions(cfg, "", cfg.nameSize, cfg.nameColor, cfg.layerText)),
    );
    this.name = { entity: nameEntity, comp: nameComp };

    // Continue indicator (blinking caret at bottom-right).
    const ind = scene.spawn("dlg-indicator");
    ind
      .add(new Transform())
      .setPosition(box.x + box.width - cfg.padding - 7, box.y + box.height - cfg.padding - 6);
    const indGfx = ind.add(new GraphicsComponent({ layer: cfg.layerFrame }));
    indGfx.draw((g) => drawCaret(g, cfg.indicatorColor));
    indGfx.graphics.visible = false;
    this.indicator = { entity: ind, gfx: indGfx };
  }

  setNameplate(name: string | undefined, color?: number): void {
    if (!this.name) return;
    // D1: `undefined` means "no name" — only the nameplate text, NOT a covert
    // hide-all (that overload died; the Session hides via setVisible). The
    // PR-1 tactical F33 hide-on-nameplate-undefined is gone with it.
    this.nameShown = name !== undefined;
    if (name !== undefined) {
      // Mutate fill in place — replacing the whole style would drop the bitmap
      // font (BitmapText resolves its font from style.fontFamily).
      this.name.comp.text.style.fill = color ?? this.cfg.nameColor;
      this.name.comp.setText(name);
    }
    this.apply();
  }

  setContinueVisible(visible: boolean): void {
    this.caretShown = visible;
    this.indicatorTime = 0;
    this.apply();
  }

  /** Show or hide the whole box (D1). State-preserving — the name/caret content
   *  sub-state survives, so showing again restores exactly what was up. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.apply();
  }

  /** Render each piece = master-visible AND its own content present. */
  private apply(): void {
    if (this.frameGfx) this.frameGfx.graphics.visible = this.visible;
    if (this.name) this.name.comp.text.visible = this.visible && this.nameShown;
    if (this.indicator) {
      this.indicator.gfx.graphics.visible = this.visible && this.caretShown;
    }
  }

  update(dt: number): void {
    // Read pixi's `visible` directly — a parallel boolean could desync (e.g.
    // keep animating a caret that `setVisible(false)` hid).
    const gfx = this.indicator?.gfx.graphics;
    if (gfx?.visible) {
      this.indicatorTime += dt;
      gfx.alpha = caretAlpha(this.indicatorTime);
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
}
