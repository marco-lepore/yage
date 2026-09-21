import { BufferImageSource } from "pixi.js";
import { EDGE_TEXTURE_WIDTH } from "./light-shader.js";

/** Texture rows the buffer starts at, doubling from there as lights need it. */
const INITIAL_ROWS = 8;

/**
 * Rows the buffer may reach. Every WebGL2 and WebGPU device allows at least
 * this many texels down, and the product is half a million shapes in reach of
 * one frame's lights at once — orders past what a level puts in front of them.
 */
const MAX_ROWS = 2048;

/** Floats per texel: an edge's two ends, a disc, or one outline's run. */
const FLOATS_PER_SHAPE = 4;

/**
 * @internal The occluder shapes every light in one scene reads, as a
 * full-precision data texture.
 *
 * A frame writes each light's run in turn and the whole buffer goes to the GPU
 * once. Coordinates are measured from the light whose run they belong to, so
 * the shader works in small numbers however far from the origin the scene sits.
 *
 * A run that is unchanged since the last frame is skipped rather than written
 * again, and a frame that skips every run uploads nothing.
 */
export class LightEdgeTexture {
  readonly source: BufferImageSource;
  private texels: Float32Array;
  private rows = INITIAL_ROWS;
  private cursor = 0;
  private written = false;

  constructor(label: string) {
    this.texels = new Float32Array(
      EDGE_TEXTURE_WIDTH * this.rows * FLOATS_PER_SHAPE,
    );
    this.source = new BufferImageSource({
      resource: this.texels,
      width: EDGE_TEXTURE_WIDTH,
      height: this.rows,
      format: "rgba32float",
      alphaMode: "no-premultiply-alpha",
      scaleMode: "nearest",
      label,
    });
  }

  /** Start a frame's runs. */
  begin(): void {
    this.cursor = 0;
    this.written = false;
  }

  /** Index of the next texel a run would be written at. */
  get at(): number {
    return this.cursor;
  }

  /** Leave an unchanged run of `count` texels where it already stands. */
  skip(count: number): void {
    this.cursor += count;
  }

  /** Write one occluder edge, in coordinates measured from its light. */
  pushEdge(ax: number, ay: number, bx: number, by: number): void {
    const offset = this.reserve();
    const texels = this.texels;
    texels[offset] = ax;
    texels[offset + 1] = ay;
    texels[offset + 2] = bx;
    texels[offset + 3] = by;
  }

  /** Write one outline's run: where its first edge sits, and how many it has. */
  pushOutline(firstEdge: number, edgeCount: number): void {
    const offset = this.reserve();
    const texels = this.texels;
    texels[offset] = firstEdge;
    texels[offset + 1] = edgeCount;
    texels[offset + 2] = 0;
    texels[offset + 3] = 0;
  }

  /** Write one disc, in coordinates measured from its light. */
  pushDisc(centerX: number, centerY: number, radius: number): void {
    const offset = this.reserve();
    const texels = this.texels;
    texels[offset] = centerX;
    texels[offset + 1] = centerY;
    texels[offset + 2] = radius;
    texels[offset + 3] = 0;
  }

  /** Send the frame's shapes to the GPU, unless nothing was written. */
  flush(): void {
    if (!this.written) return;
    this.source.update();
  }

  destroy(): void {
    this.source.destroy();
  }

  /** Make room for one shape and return where its floats go. */
  private reserve(): number {
    const index = this.cursor++;
    this.written = true;
    if (index >= EDGE_TEXTURE_WIDTH * this.rows) this.grow(index);
    return index * FLOATS_PER_SHAPE;
  }

  private grow(index: number): void {
    let rows = this.rows;
    while (index >= EDGE_TEXTURE_WIDTH * rows) rows *= 2;
    if (rows > MAX_ROWS) {
      throw new RangeError(
        `ShaderLightingRenderer: a scene's lights reach more than ` +
          `${EDGE_TEXTURE_WIDTH * MAX_ROWS} occluder shapes at once, which is ` +
          `past what one light buffer holds. Reduce light radii or the number ` +
          `of occluders that cast shadows.`,
      );
    }
    const texels = new Float32Array(
      EDGE_TEXTURE_WIDTH * rows * FLOATS_PER_SHAPE,
    );
    texels.set(this.texels);
    this.texels = texels;
    this.rows = rows;
    this.source.resource = texels;
    this.source.resize(EDGE_TEXTURE_WIDTH, rows);
  }
}
