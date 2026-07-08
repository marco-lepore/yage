/**
 * Test doubles for the `@yagejs/renderer` surface the slot views touch, so the
 * views and cell presets can be driven in a bare {@link createMockScene} (the
 * real components need a `sceneRenderTree` service). A test swaps the module in
 * with `vi.mock("@yagejs/renderer", () => import("./rendererTestStubs.js"))`.
 *
 * The stubs extend the REAL core `Component`, so `entity.add(...)` /
 * `entity.destroy()` lifecycles are genuine; only the pixi drawing is recorded
 * instead of rendered. Not shipped — nothing outside test files imports it, so
 * it never enters the tsup bundle.
 */

import { Component, ServiceKey } from "@yagejs/core";

/** One recorded drawing call inside a `draw()` block. */
export interface DrawOp {
  readonly op: string;
  readonly args: readonly unknown[];
}

/** Records the chained graphics calls a `draw()` callback makes. */
export class RecordingContext {
  readonly ops: DrawOp[] = [];
  private push(op: string, ...args: unknown[]): this {
    this.ops.push({ op, args });
    return this;
  }
  clear(): this {
    return this.push("clear");
  }
  roundRect(x: number, y: number, w: number, h: number, r: number): this {
    return this.push("roundRect", x, y, w, h, r);
  }
  fill(o: unknown): this {
    return this.push("fill", o);
  }
  stroke(o: unknown): this {
    return this.push("stroke", o);
  }
  moveTo(x: number, y: number): this {
    return this.push("moveTo", x, y);
  }
  lineTo(x: number, y: number): this {
    return this.push("lineTo", x, y);
  }
  closePath(): this {
    return this.push("closePath");
  }
}

/** A minimal Pixi-Container stand-in: records added children (nine-slice
 *  sprites) so tests can assert a textured frame was parented. */
export class StubContainer {
  visible = true;
  readonly children: unknown[] = [];
  addChild(child: unknown): void {
    this.children.push(child);
  }
}

export class GraphicsComponent extends Component {
  readonly graphics = new StubContainer();
  /** Every `draw()` call's recorded ops, latest last. */
  readonly draws: RecordingContext[] = [];
  constructor(readonly options: { readonly layer: string }) {
    super();
  }
  draw(fn: (g: RecordingContext) => void): void {
    const ctx = new RecordingContext();
    fn(ctx);
    this.draws.push(ctx);
  }
  /** Ops from the most recent draw() (what is currently painted). */
  lastOps(): readonly DrawOp[] {
    return this.draws.at(-1)?.ops ?? [];
  }
}

export interface TextOptions {
  readonly text: string;
  readonly style: { readonly fontSize: number; readonly fill: number; readonly fontFamily?: string };
  readonly layer: string;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly bitmap?: boolean;
  readonly resolution?: number;
}

export class TextComponent extends Component {
  readonly text = { visible: true };
  constructor(readonly options: TextOptions) {
    super();
  }
}

export interface SpriteOptions {
  readonly texture: unknown;
  readonly layer: string;
  readonly anchor?: { readonly x: number; readonly y: number };
}

export class SpriteComponent extends Component {
  readonly sprite = { visible: true };
  constructor(readonly options: SpriteOptions) {
    super();
  }
}

/** A stand-in key; never registered in a mock scene, so `tryResolve` returns
 *  undefined and the view falls back to the layout's default viewport. */
export const RendererKey = new ServiceKey<unknown>("renderer-stub");

const seededTextures = new Set<string>();
/** Make `resolveTextureInput(key)` resolve instead of throw. */
export function seedTexture(key: string): void {
  seededTextures.add(key);
}
/** Forget all seeded textures (call between tests). */
export function resetTextures(): void {
  seededTextures.clear();
}
export function resolveTextureInput(input: string): { width: number; height: number } {
  if (!seededTextures.has(input)) throw new Error(`stub: no texture seeded for "${input}"`);
  return { width: 32, height: 32 };
}

/** A stand-in nine-slice sprite: a plain display object with mutable
 *  position/size, enough for the textured-frame views to place and stretch it. */
export class NineSliceSprite {
  visible = true;
  x = 0;
  y = 0;
  width: number;
  height: number;
  constructor(readonly options: { readonly texture: string; readonly width: number; readonly height: number }) {
    this.width = options.width;
    this.height = options.height;
  }
}

/** Mirrors the real `createNineSlice`: resolves (throws on an unseeded key)
 *  then builds a sprite sized to `width`/`height`. */
export function createNineSlice(options: {
  readonly texture: string;
  readonly leftWidth: number;
  readonly topHeight: number;
  readonly rightWidth: number;
  readonly bottomHeight: number;
  readonly width: number;
  readonly height: number;
}): NineSliceSprite {
  resolveTextureInput(options.texture);
  return new NineSliceSprite({ texture: options.texture, width: options.width, height: options.height });
}
