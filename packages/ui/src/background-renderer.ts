import { Graphics, Sprite, NineSliceSprite, TilingSprite } from "pixi.js";
import type { DisplayContainer } from "@yagejs/renderer";
import type {
  BackgroundOptions,
  ColorBackground,
  TextureBackground,
} from "./types.js";
import { isTextureBackground } from "./types.js";
import { resolveTextureInput } from "@yagejs/renderer";
import type { NineSliceInsets } from "./internal/nine-slice-guard.js";
import { warnNineSliceTooSmall } from "./internal/nine-slice-guard.js";

/** Expand `nineSlice`, one number or four named sides, to the four sprite insets. */
function resolveNineSliceInsets(
  nineSlice: TextureBackground["nineSlice"],
): NineSliceInsets {
  const insets = nineSlice ?? 0;
  if (typeof insets === "number") {
    return {
      leftWidth: insets,
      topHeight: insets,
      rightWidth: insets,
      bottomHeight: insets,
    };
  }
  return {
    leftWidth: insets.left,
    topHeight: insets.top,
    rightWidth: insets.right,
    bottomHeight: insets.bottom,
  };
}

/** Equality for `nineSlice`: absent, one number, or the four named sides. */
function sameNineSlice(
  a: TextureBackground["nineSlice"],
  b: TextureBackground["nineSlice"],
): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom
  );
}

/** Equality for `tileScale`: absent, one number, or an x/y pair. */
function sameTileScale(
  a: TextureBackground["tileScale"],
  b: TextureBackground["tileScale"],
): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return a.x === b.x && a.y === b.y;
}

/**
 * Field-by-field equality for two background options. Textures compare by
 * identity, so a caller that resolves its own texture object per call counts
 * as a change; every other field is a primitive or one of the two small
 * objects above.
 */
function sameBackground(a: BackgroundOptions, b: BackgroundOptions): boolean {
  if (isTextureBackground(a)) {
    if (!isTextureBackground(b)) return false;
    return (
      a.texture === b.texture &&
      a.mode === b.mode &&
      a.tint === b.tint &&
      a.alpha === b.alpha &&
      sameNineSlice(a.nineSlice, b.nineSlice) &&
      sameTileScale(a.tileScale, b.tileScale)
    );
  }
  if (isTextureBackground(b)) return false;
  return a.color === b.color && a.alpha === b.alpha && a.radius === b.radius;
}

type MustBeNever<T extends never> = T;

/**
 * Every field of both background shapes is compared by `sameBackground`. A
 * field added to either shape without a comparison there fails the typecheck
 * here, naming the field left out. Exported so the compiler counts the aliases
 * as used.
 */
export type EveryColorFieldIsCompared = MustBeNever<
  Exclude<keyof ColorBackground, "color" | "alpha" | "radius">
>;
export type EveryTextureFieldIsCompared = MustBeNever<
  Exclude<
    keyof TextureBackground,
    "texture" | "mode" | "tint" | "alpha" | "nineSlice" | "tileScale"
  >
>;

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
  // Size the current drawing was made at. `NaN` never equals a computed size,
  // so writing it forces the next `resize` to draw — which is how a same-size
  // colour swap, such as a button's hover state, still repaints.
  private lastWidth = Number.NaN;
  private lastHeight = Number.NaN;

  /** Create or replace the background display object. */
  set(
    opts: BackgroundOptions,
    parent: DisplayContainer,
    insertIndex = 0,
  ): void {
    // A display object that is already in this container, drawn from these
    // values, has nothing to apply. The React reconciler passes every current
    // prop to an element's `update()` on each commit, so an unchanged
    // background prop reaches this method once per re-render. Checked ahead
    // of the copy below, so such a call allocates nothing.
    if (
      this.displayObject &&
      this.opts &&
      (this.displayObject as unknown as DisplayContainer).parent === parent &&
      sameBackground(this.opts, opts)
    ) {
      return;
    }

    // The size to redraw at, read before the new options invalidate it.
    const w = this.lastWidth;
    const h = this.lastHeight;
    this.invalidate();

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

    // A copy, so a later resize redraws the values passed here rather than the
    // caller's object as it is by then. Only top-level fields are read once
    // this call returns, so a shallow copy is enough; the texture stays shared.
    this.opts = { ...opts };

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

    // Repaint at the size already computed, so the new options land in this
    // call rather than a frame later.
    if (!Number.isNaN(w)) {
      this.resize(w, h);
    }
  }

  /**
   * Resize the background to match Yoga computed dimensions. A redraw at a
   * size already drawn is skipped: re-tessellating an unchanged rounded
   * rectangle every frame is the package's largest per-frame allocation.
   */
  resize(w: number, h: number): void {
    if (w === this.lastWidth && h === this.lastHeight) return;

    // Nothing to draw yet. The sizes stay invalid, so the first draw after
    // `set` creates the display object still gets through.
    if (!this.displayObject || !this.opts) return;

    if (isTextureBackground(this.opts)) {
      this.resizeTexture(w, h);
    } else {
      this.drawColor(this.opts, w, h);
    }

    this.lastWidth = w;
    this.lastHeight = h;
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
      case "nine-slice":
        return new NineSliceSprite({
          texture,
          ...resolveNineSliceInsets(opts.nineSlice),
        });
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

    // The insets are set from the options on every apply, because the display
    // object outlives a texture swap. Options without `nineSlice` give insets
    // of 0, so a caller swapping art passes its insets again.
    if (this.displayObject instanceof NineSliceSprite) {
      const insets = resolveNineSliceInsets(opts.nineSlice);
      this.displayObject.leftWidth = insets.leftWidth;
      this.displayObject.topHeight = insets.topHeight;
      this.displayObject.rightWidth = insets.rightWidth;
      this.displayObject.bottomHeight = insets.bottomHeight;
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

  /** Forget the drawn size, so the next `resize` redraws whatever it is given. */
  private invalidate(): void {
    this.lastWidth = Number.NaN;
    this.lastHeight = Number.NaN;
  }

  private destroyDisplayObject(): void {
    this.invalidate();
    if (this.displayObject) {
      (this.displayObject as unknown as DisplayContainer).removeFromParent();
      (this.displayObject as unknown as DisplayContainer).destroy();
      this.displayObject = undefined;
    }
  }
}
