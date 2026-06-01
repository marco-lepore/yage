/**
 * TexturedChrome — opt-in nine-slice variant of {@link DialogueChrome}.
 *
 * Drop-in for the default Graphics chrome in a {@link DialogueBundle}: it
 * implements the same {@link ChromePresenter} contract (mount / setNameplate /
 * setContinueVisible / setVisible / update / dispose), but paints the box frame
 * with a stretchable nine-slice sprite instead of a drawn rounded rect. The
 * name plate + blinking continue caret are unchanged (Graphics + Text).
 *
 * Use this when a theme supplies textured chrome (`theme.textured.frameTexture`).
 * The nine-slice sprite is parented into the frame layer via a host
 * {@link GraphicsComponent} (Pixi Graphics is a Container), so this reuses the
 * exact same layer-resolution path as the Graphics chrome — no new DI surface.
 *
 * Implemented with `@yagejs/renderer`'s `createNineSlice` primitive — no direct
 * `pixi.js` import and no `@yagejs/ui` dependency.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  createNineSlice,
  GraphicsComponent,
  TextComponent,
  type NineSliceSprite,
  type TextComponentOptions,
  type TextStyle,
  type TextureInput,
} from "@yagejs/renderer";

import type { ChromePresenter } from "./DialogueUiAdapter.js";
import type { NineSliceInsets } from "../factory/theme.js";

export interface TexturedChromeConfig {
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly padding: number;
  /** Nine-slice texture (string key or Texture) for the frame. */
  readonly frameTexture: TextureInput;
  /** Border insets for the nine-slice, in source-texture pixels. */
  readonly insets: NineSliceInsets;
  readonly nameColor: number;
  readonly nameSize: number;
  readonly indicatorColor: number;
  readonly bitmapFont?: string;
  readonly fontFamily?: string;
  readonly resolution?: number;
  /** Frame + continue indicator layer. */
  readonly layerFrame: string;
  /** Name plate layer (drawn above the frame layer). */
  readonly layerText: string;
}

export class TexturedChrome implements ChromePresenter {
  // Fields use explicit `| undefined` (not `?`) so they stay clean under the
  // repo's `useDefineForClassFields` + `exactOptionalPropertyTypes`.
  private frame: Entity | undefined;
  private frameHost: GraphicsComponent | undefined;
  private nineSlice: NineSliceSprite | undefined;
  private name: { entity: Entity; comp: TextComponent } | undefined;
  private indicator: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private indicatorVisible = false;
  private indicatorTime = 0;

  constructor(private readonly cfg: TexturedChromeConfig) {}

  mount(scene: Scene): void {
    const cfg = this.cfg;
    const box = cfg.box;

    // Frame: a nine-slice sprite parented into a GraphicsComponent host (Pixi
    // Graphics is a Container) so it lands on the named frame layer.
    const frame = scene.spawn("dlg-frame");
    frame.add(new Transform()).setPosition(box.x, box.y);
    this.frameHost = frame.add(
      new GraphicsComponent({ layer: cfg.layerFrame }),
    );
    this.nineSlice = createNineSlice({
      texture: cfg.frameTexture,
      leftWidth: cfg.insets.left,
      topHeight: cfg.insets.top,
      rightWidth: cfg.insets.right,
      bottomHeight: cfg.insets.bottom,
      width: box.width,
      height: box.height,
    });
    this.frameHost.graphics.addChild(this.nineSlice);
    this.frame = frame;

    // Name plate.
    const nameEntity = scene.spawn("dlg-name");
    nameEntity
      .add(new Transform())
      .setPosition(box.x + cfg.padding, box.y + cfg.padding - 1);
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
      g.poly([ix, iy, ix + 8, iy, ix + 4, iy + 5]).fill({
        color: cfg.indicatorColor,
        alpha: 1,
      });
    });
    indGfx.graphics.visible = false;
    this.indicator = { entity: ind, gfx: indGfx };
  }

  setNameplate(name: string | undefined, color?: number): void {
    if (!this.name) return;
    if (name) {
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

  setVisible(visible: boolean): void {
    if (this.frameHost) this.frameHost.graphics.visible = visible;
    if (!visible) {
      if (this.name) this.name.comp.text.visible = false;
      if (this.indicator) this.indicator.gfx.graphics.visible = false;
    }
  }

  update(dt: number): void {
    if (this.indicator && this.indicatorVisible) {
      this.indicatorTime += dt;
      this.indicator.gfx.graphics.alpha =
        0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.indicatorTime / 260));
    }
  }

  dispose(): void {
    this.frame?.destroy();
    this.name?.entity.destroy();
    this.indicator?.entity.destroy();
    this.frame = undefined;
    this.frameHost = undefined;
    this.nineSlice = undefined;
    this.name = undefined;
    this.indicator = undefined;
  }

  private styleFor(size: number, color: number): TextStyle {
    const style: TextStyle = { fontSize: size, fill: color };
    if (this.cfg.fontFamily) style.fontFamily = this.cfg.fontFamily;
    return style;
  }

  private textOptions(
    text: string,
    size: number,
    color: number,
  ): TextComponentOptions {
    const style = this.styleFor(size, color);
    if (this.cfg.bitmapFont) style.fontFamily = this.cfg.bitmapFont;
    const base = {
      text,
      style,
      layer: this.cfg.layerText,
      anchor: { x: 0, y: 0 },
    };
    // Conditionally include the optional fields so we never assign `undefined`
    // to a `?`-optional property (exactOptionalPropertyTypes).
    if (this.cfg.bitmapFont) return { ...base, bitmap: true };
    if (this.cfg.resolution !== undefined) {
      return { ...base, resolution: this.cfg.resolution };
    }
    return base;
  }
}
