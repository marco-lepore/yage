import { Graphics, Sprite, NineSliceSprite, TilingSprite } from "pixi.js";
import type { Container } from "pixi.js";
import type { BackgroundOptions, ColorBackground, TextureBackground } from "./types.js";
import { isTextureBackground } from "./types.js";
import { resolveTexture } from "./asset-helpers.js";

/**
 * Manages a background display object for UI elements.
 * Supports solid-color (Graphics) and texture-based (Sprite/NineSliceSprite/TilingSprite) backgrounds.
 */
export class BackgroundRenderer {
  private displayObject: Graphics | Sprite | NineSliceSprite | TilingSprite | undefined;
  private opts: BackgroundOptions | undefined;
  private lastWidth = 0;
  private lastHeight = 0;

  /** Create or replace the background display object. */
  set(opts: BackgroundOptions, parent: Container, insertIndex = 0): void {
    // If the type of background changed, destroy the old one
    if (this.displayObject) {
      const wasTexture = this.opts && isTextureBackground(this.opts);
      const isTexture = isTextureBackground(opts);
      const modeChanged =
        wasTexture &&
        isTexture &&
        (this.opts as TextureBackground).mode !== (opts as TextureBackground).mode;

      if (wasTexture !== isTexture || modeChanged) {
        this.destroyDisplayObject();
      }
    }

    this.opts = opts;

    if (!this.displayObject) {
      this.displayObject = this.createDisplayObject(opts);
      parent.addChildAt(this.displayObject as unknown as Container, insertIndex);
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

  /** Resize the background to match Yoga computed dimensions. */
  resize(w: number, h: number): void {
    this.lastWidth = w;
    this.lastHeight = h;

    if (!this.displayObject || !this.opts) return;

    if (isTextureBackground(this.opts)) {
      this.resizeTexture(w, h);
    } else {
      this.drawColor(this.opts, w, h);
    }
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
    const texture = resolveTexture(opts.texture);
    const mode = opts.mode ?? "stretch";

    switch (mode) {
      case "nine-slice": {
        const insets = opts.nineSlice ?? 0;
        if (typeof insets === "number") {
          return new NineSliceSprite({ texture, leftWidth: insets, topHeight: insets, rightWidth: insets, bottomHeight: insets });
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
    const texture = resolveTexture(opts.texture);
    if ("texture" in this.displayObject) {
      (this.displayObject as Sprite | NineSliceSprite | TilingSprite).texture = texture;
    }

    if (opts.alpha !== undefined) {
      this.displayObject.alpha = opts.alpha;
    }
    if (opts.tint !== undefined) {
      (this.displayObject as Sprite | NineSliceSprite | TilingSprite).tint = opts.tint;
    }

    if (opts.mode === "tile" && opts.tileScale && this.displayObject instanceof TilingSprite) {
      const s = opts.tileScale;
      if (typeof s === "number") {
        this.displayObject.tileScale.set(s, s);
      } else {
        this.displayObject.tileScale.set(s.x, s.y);
      }
    }
  }

  private resizeTexture(w: number, h: number): void {
    if (!this.displayObject) return;
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
    if (this.displayObject) {
      (this.displayObject as unknown as Container).destroy();
      this.displayObject = undefined;
    }
  }
}
