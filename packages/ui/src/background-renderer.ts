import { Graphics, Sprite, NineSliceSprite, TilingSprite } from "pixi.js";
import type { DisplayContainer } from "@yagejs/renderer";
import type {
  BackgroundOptions,
  ColorBackground,
  TextureBackground,
} from "./types.js";
import { isTextureBackground } from "./types.js";
import { resolveTextureInput } from "@yagejs/renderer";
import { warnNineSliceTooSmall } from "./internal/nine-slice-guard.js";

/**
 * Manages a background display object for UI elements.
 * Supports solid-color (Graphics) and texture-based (Sprite/NineSliceSprite/TilingSprite) backgrounds.
 */
export class BackgroundRenderer {
  private displayObject:
    | Graphics
    | Sprite
    | NineSliceSprite
    | TilingSprite
    | undefined;
  private opts: BackgroundOptions | undefined;
  private lastWidth = 0;
  private lastHeight = 0;
  // Raised whenever the drawn content would differ at an unchanged size: a
  // new options object, a newly created display object, or a destroyed one.
  // `resize` skips its redraw only while this is down AND the size matches
  // the last draw, so a same-size colour swap (a button's hover state) still
  // repaints. A `NaN` size sentinel cannot stand in for this flag, because
  // `set` re-applies the cached size under `lastWidth > 0 || lastHeight > 0`
  // and `NaN > 0` is false.
  private needsRedraw = true;

  /** Create or replace the background display object. */
  set(
    opts: BackgroundOptions,
    parent: DisplayContainer,
    insertIndex = 0,
  ): void {
    this.needsRedraw = true;

    // If the type of background changed, destroy the old one
    if (this.displayObject) {
      const wasTexture = this.opts && isTextureBackground(this.opts);
      const isTexture = isTextureBackground(opts);
      const modeChanged =
        wasTexture &&
        isTexture &&
        (this.opts as TextureBackground).mode !==
          (opts as TextureBackground).mode;

      if (wasTexture !== isTexture || modeChanged) {
        this.destroyDisplayObject();
      }
    }

    this.opts = opts;

    if (!this.displayObject) {
      this.displayObject = this.createDisplayObject(opts);
      parent.addChildAt(
        this.displayObject as unknown as DisplayContainer,
        insertIndex,
      );
    }

    // Apply properties
    if (isTextureBackground(opts)) {
      this.applyTextureProps(opts);
    }

    // If we have a cached size, resize immediately
    if (this.lastWidth > 0 || this.lastHeight > 0) {
      this.resize(this.lastWidth, this.lastHeight);
    }
  }

  /**
   * Resize the background to match Yoga computed dimensions. A redraw at a
   * size already drawn is skipped: re-tessellating an unchanged rounded
   * rectangle every frame is the package's largest per-frame allocation.
   */
  resize(w: number, h: number): void {
    if (!this.needsRedraw && w === this.lastWidth && h === this.lastHeight) {
      return;
    }

    this.lastWidth = w;
    this.lastHeight = h;

    // Nothing to draw yet. Leave the flag raised so the first draw after
    // `set` creates the display object still gets through.
    if (!this.displayObject || !this.opts) return;

    if (isTextureBackground(this.opts)) {
      this.resizeTexture(w, h);
    } else {
      this.drawColor(this.opts, w, h);
    }

    this.needsRedraw = false;
  }

  /** Clean up the display object. */
  destroy(): void {
    this.destroyDisplayObject();
    this.opts = undefined;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private createDisplayObject(
    opts: BackgroundOptions,
  ): Graphics | Sprite | NineSliceSprite | TilingSprite {
    if (isTextureBackground(opts)) {
      return this.createTextureObject(opts);
    }
    return new Graphics();
  }

  private createTextureObject(
    opts: TextureBackground,
  ): Sprite | NineSliceSprite | TilingSprite {
    const texture = resolveTextureInput(opts.texture);
    const mode = opts.mode ?? "stretch";

    switch (mode) {
      case "nine-slice": {
        const insets = opts.nineSlice ?? 0;
        if (typeof insets === "number") {
          return new NineSliceSprite({
            texture,
            leftWidth: insets,
            topHeight: insets,
            rightWidth: insets,
            bottomHeight: insets,
          });
        }
        return new NineSliceSprite({
          texture,
          leftWidth: insets.left,
          topHeight: insets.top,
          rightWidth: insets.right,
          bottomHeight: insets.bottom,
        });
      }
      case "tile":
        return new TilingSprite({ texture, width: 1, height: 1 });
      case "stretch":
      default:
        return new Sprite(texture);
    }
  }

  private applyTextureProps(opts: TextureBackground): void {
    if (!this.displayObject) return;

    // Update the texture on the existing display object
    const texture = resolveTextureInput(opts.texture);
    if ("texture" in this.displayObject) {
      (this.displayObject as Sprite | NineSliceSprite | TilingSprite).texture =
        texture;
    }

    this.displayObject.alpha = opts.alpha ?? 1;
    (this.displayObject as Sprite | NineSliceSprite | TilingSprite).tint =
      opts.tint ?? 0xffffff;

    if (opts.mode === "tile" && this.displayObject instanceof TilingSprite) {
      const s = opts.tileScale ?? 1;
      if (typeof s === "number") {
        this.displayObject.tileScale.set(s, s);
      } else {
        this.displayObject.tileScale.set(s.x, s.y);
      }
    }
  }

  private resizeTexture(w: number, h: number): void {
    if (!this.displayObject) return;
    if (this.displayObject instanceof NineSliceSprite) {
      warnNineSliceTooSmall(
        this,
        this.displayObject,
        w,
        h,
        "UI nine-slice background",
      );
    }
    this.displayObject.width = w;
    this.displayObject.height = h;
  }

  private drawColor(opts: ColorBackground, w: number, h: number): void {
    const g = this.displayObject as Graphics;
    const r = opts.radius ?? 0;
    g.clear();
    if (r > 0) {
      g.roundRect(0, 0, w, h, r);
    } else {
      g.rect(0, 0, w, h);
    }
    g.fill({ color: opts.color ?? 0x000000, alpha: opts.alpha ?? 1 });
  }

  private destroyDisplayObject(): void {
    this.needsRedraw = true;
    if (this.displayObject) {
      (this.displayObject as unknown as DisplayContainer).removeFromParent();
      (this.displayObject as unknown as DisplayContainer).destroy();
      this.displayObject = undefined;
    }
  }
}
