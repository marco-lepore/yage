import { createNineSlice } from "./assets.js";
import { assertFiniteNumber } from "./internal/validate.js";
import type { NineSliceSprite, TextureInput } from "./public-types.js";
import {
  VisualComponent,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/** Slice guides of a nine-slice texture: how far each edge's border reaches, in source pixels. */
export interface NineSliceInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Options for creating a {@link NineSliceComponent}. */
export interface NineSliceComponentOptions extends VisualComponentOptions {
  /** Frame texture: a loaded or registered asset key, a handle, or a texture. */
  texture: TextureInput;
  /** Border widths of the texture. Corners keep their size; edges and centre stretch. */
  insets: NineSliceInsets;
  /** Drawn width in pixels. */
  width: number;
  /** Drawn height in pixels. */
  height: number;
  /**
   * Anchor point (0-1). Default `{ x: 0, y: 0 }`: the entity's position is
   * the frame's top-left corner.
   */
  anchor?: { x: number; y: number };
}

/**
 * A stretchable textured frame whose corners stay crisp at any size: panels,
 * dialogue boxes, speech bubbles, buttons. The entity's `Transform` places it
 * like any other visual, and {@link setSize} resizes it.
 *
 * ```ts
 * const frame = entity.add(
 *   new NineSliceComponent({
 *     texture: "panel",
 *     insets: { left: 8, top: 8, right: 8, bottom: 8 },
 *     width: 320,
 *     height: 120,
 *     layer: "ui",
 *   }),
 * );
 * frame.setSize(400, 160);
 * ```
 */
export class NineSliceComponent extends VisualComponent {
  private readonly slice: NineSliceSprite;

  constructor(options: NineSliceComponentOptions) {
    super(options.layer);
    const context = "NineSliceComponent.constructor";
    assertFiniteNumber(context, "width", options.width, 0);
    assertFiniteNumber(context, "height", options.height, 0);
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      assertFiniteNumber(context, `insets.${edge}`, options.insets[edge], 0);
    }
    if (options.anchor) {
      assertFiniteNumber(context, "anchor.x", options.anchor.x);
      assertFiniteNumber(context, "anchor.y", options.anchor.y);
    }
    this.slice = createNineSlice({
      texture: options.texture,
      leftWidth: options.insets.left,
      topHeight: options.insets.top,
      rightWidth: options.insets.right,
      bottomHeight: options.insets.bottom,
      width: options.width,
      height: options.height,
    });
    if (options.anchor) {
      this.slice.anchor.set(options.anchor.x, options.anchor.y);
    }
    this.applyVisualOptions(options);
  }

  /**
   * The Pixi object this component draws with. Change the visual through the
   * component; see {@link VisualComponent.renderObject}.
   */
  get renderObject(): NineSliceSprite {
    return this.slice;
  }

  /** Drawn width in pixels. */
  get width(): number {
    return this.slice.width;
  }

  /** Drawn height in pixels. */
  get height(): number {
    return this.slice.height;
  }

  /** Stretch the frame to `width` × `height` pixels. */
  setSize(width: number, height: number): void {
    assertFiniteNumber("NineSliceComponent.setSize", "width", width, 0);
    assertFiniteNumber("NineSliceComponent.setSize", "height", height, 0);
    this.slice.width = width;
    this.slice.height = height;
  }
}
