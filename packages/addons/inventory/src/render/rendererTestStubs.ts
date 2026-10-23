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
import type { SceneRenderTreeProvider } from "@yagejs/renderer";

// Test-only service identity, shared by the renderer mock and its callers.
export const SceneRenderTreeProviderKey =
  new ServiceKey<SceneRenderTreeProvider>("renderer-tree-stub");

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

export class GraphicsComponent extends Component {
  visible = true;
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
  readonly style: {
    readonly fontSize: number;
    readonly fill: number;
    readonly fontFamily?: string;
  };
  readonly layer: string;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly bitmap?: boolean;
  readonly resolution?: number;
}

export class TextComponent extends Component {
  visible = true;
  tint = 0xffffff;
  content: string;
  /** Every style patch passed to `mergeStyle`, latest last. */
  readonly styleMerges: Record<string, unknown>[] = [];
  constructor(readonly options: TextOptions) {
    super();
    this.content = options.text;
  }
  setText(value: string): void {
    this.content = value;
  }
  mergeStyle(style: Record<string, unknown>): void {
    this.styleMerges.push(style);
  }
}

export interface SpriteOptions {
  readonly texture: unknown;
  readonly layer: string;
  readonly anchor?: { readonly x: number; readonly y: number };
}

export class SpriteComponent extends Component {
  visible = true;
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
export function resolveTextureInput(input: string): {
  width: number;
  height: number;
} {
  if (!seededTextures.has(input))
    throw new Error(`stub: no texture seeded for "${input}"`);
  return { width: 32, height: 32 };
}

/** Mirrors the real `NineSliceComponent`: resolves its texture (throws on an
 *  unseeded key) and records its size, so the textured-frame views can be
 *  checked for what they stretch. */
export class NineSliceComponent extends Component {
  visible = true;
  width: number;
  height: number;
  constructor(
    readonly options: {
      readonly texture: string;
      readonly insets: {
        readonly left: number;
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
      };
      readonly width: number;
      readonly height: number;
      readonly layer: string;
    },
  ) {
    super();
    resolveTextureInput(options.texture);
    this.width = options.width;
    this.height = options.height;
  }
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
}
