import { BufferImageSource } from "pixi.js";
import { EDGE_TEXTURE_WIDTH } from "./light-visibility.js";

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

  /** Write one light or shape texel in the shared data layout. */
  pushValues(a: number, b: number, c: number, d: number): void {
    const fa = Math.fround(a);
    const fb = Math.fround(b);
    const fc = Math.fround(c);
    const fd = Math.fround(d);
    if (
      !Number.isFinite(fa) ||
      !Number.isFinite(fb) ||
      !Number.isFinite(fc) ||
      !Number.isFinite(fd)
    ) {
      throw new RangeError(
        `Lighting buffer: values must fit finite GPU floats, got ${a}, ${b}, ${c}, ${d}.`,
      );
    }
    const offset = this.reserve();
    this.write(offset, fa);
    this.write(offset + 1, fb);
    this.write(offset + 2, fc);
    this.write(offset + 3, fd);
  }

  /** Write one occluder edge, in coordinates measured from its light. */
  pushEdge(ax: number, ay: number, bx: number, by: number): void {
    this.pushValues(ax, ay, bx, by);
  }

  /** Write one outline's run: where its first edge sits, and how many it has. */
  pushOutline(firstEdge: number, edgeCount: number): void {
    this.pushValues(firstEdge, edgeCount, 0, 0);
  }

  /** Write one disc, in coordinates measured from its light. */
  pushDisc(centerX: number, centerY: number, radius: number): void {
    this.pushValues(centerX, centerY, radius, 0);
  }

  /** Send the frame's shapes to the GPU, unless nothing was written. */
  flush(): void {
    if (!this.written) return;
    this.source.update();
  }

  destroy(): void {
    this.source.destroy();
  }

  /** Store one float, and mark the frame written only when it differs. */
  private write(index: number, value: number): void {
    if (this.texels[index] !== value) {
      this.texels[index] = value;
      this.written = true;
    }
  }

  /** Make room for one shape and return where its floats go. */
  private reserve(): number {
    const index = this.cursor;
    if (index >= EDGE_TEXTURE_WIDTH * this.rows) this.grow(index);
    this.cursor++;
    return index * FLOATS_PER_SHAPE;
  }

  private grow(index: number): void {
    let rows = this.rows;
    while (index >= EDGE_TEXTURE_WIDTH * rows) rows *= 2;
    if (rows > MAX_ROWS) {
      throw new RangeError(
        `Lighting buffer "${this.source.label}": needs ${index + 1} texels, ` +
          `exceeding its ${EDGE_TEXTURE_WIDTH * MAX_ROWS} texel capacity. ` +
          `Reduce light counts, light radii, or shadow-casting occluders.`,
      );
    }
    const texels = new Float32Array(
      EDGE_TEXTURE_WIDTH * rows * FLOATS_PER_SHAPE,
    );
    texels.set(this.texels);
    this.texels = texels;
    this.rows = rows;
    this.written = true;
    this.source.resource = texels;
    this.source.resize(EDGE_TEXTURE_WIDTH, rows);
  }
}
