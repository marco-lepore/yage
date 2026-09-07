/**
 * E2E fixture for effect scoping: `tree.addLayerEffect` over a set of layers,
 * and `renderAboveEffects` on a visual. Driven by
 * `e2e/specs/effect-scoping.spec.ts`, which reads canvas pixels, so every
 * rect is a flat colour at a known position.
 *
 * Exposes `window.__effectScoping__`.
 */
import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraEntity,
  SceneRenderTreeKey,
  rawFilter,
  graphicsMask,
} from "@yagejs/renderer";
import type {
  EffectFactory,
  EffectHandle,
  LayerDef,
  SceneRenderTree,
} from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { ColorMatrixFilter } from "pixi.js";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

/**
 * Keeps red, zeroes green and blue — a white rect reads pure red and a blue
 * one reads black, so one sample says whether a filter covers a pixel.
 * A fresh filter per attach, because `addLayerEffect` calls the factory once
 * per layer and `rawFilter` wraps a single instance.
 */
const redOnly: EffectFactory = () => {
  const filter = new ColorMatrixFilter();
  filter.matrix = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
  return rawFilter(filter)();
};

const WHITE = 0xffffff;
const BLUE = 0x0000ff;

class EffectScopingScene extends Scene {
  readonly name = "effect-scoping";
  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
    { name: "fg", order: 10 },
    { name: "ui", order: 1000, space: "screen" },
  ];

  readonly rects = new Map<string, GraphicsComponent>();
  tree!: SceneRenderTree;
  private camera: CameraEntity | undefined;

  onEnter(): void {
    this.tree = this.use(SceneRenderTreeKey);
    this.rect("bg", "bg", 50, 50, WHITE);
    this.rect("world", "world", 200, 50, WHITE);
    this.rect("fg", "fg", 350, 50, WHITE);
    this.rect("ui", "ui", 500, 50, BLUE);

    // Second row: world rects the spec lifts above the effects, each under a
    // screen-space rect so a change in draw order is visible too.
    this.rect("free", "world", 200, 250, WHITE);
    this.rect("covered", "world", 500, 250, WHITE);
    this.rect("ui-over-covered", "ui", 500, 250, BLUE);
    this.rect("optioned", "world", 650, 250, WHITE, true);
    this.rect("ui-over-optioned", "ui", 650, 250, BLUE);
  }

  /** Move the camera, spawning it on first use. Centred = identity. */
  moveCamera(x: number, y: number): void {
    if (!this.camera) {
      this.camera = this.spawn(CameraEntity, { position: new Vec2(x, y) });
      return;
    }
    this.camera.position = new Vec2(x, y);
  }

  private rect(
    name: string,
    layer: string,
    x: number,
    y: number,
    color: number,
    renderAboveEffects = false,
  ): void {
    const entity = this.spawn(name);
    entity.add(new Transform({ position: new Vec2(x, y) }));
    const graphics = entity.add(
      new GraphicsComponent({ layer, renderAboveEffects }).draw((g) => {
        g.rect(0, 0, 100, 100).fill({ color });
      }),
    );
    this.rects.set(name, graphics);
  }
}

const engine = new Engine({ debug: true });
const renderer = new RendererPlugin({
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: 0x000000,
  container,
});
engine.use(renderer);
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();

const scene = new EffectScopingScene();
await engine.scenes.push(scene);

const handles: EffectHandle[] = [];
const rect = (name: string): GraphicsComponent => {
  const graphics = scene.rects.get(name);
  if (!graphics) throw new Error(`no rect named "${name}"`);
  return graphics;
};

(window as Window & { __effectScoping__?: unknown }).__effectScoping__ = {
  addLayerEffect(layers: string[]) {
    handles.push(scene.tree.addLayerEffect(redOnly, layers));
  },
  addSceneEffect() {
    handles.push(scene.tree.fx.addEffect(redOnly));
  },
  addScreenEffect() {
    handles.push(renderer.fx.addEffect(redOnly));
  },
  removeEffects() {
    for (const handle of handles.splice(0)) handle.remove();
  },
  /** The message `addLayerEffect` throws for `layers`, or null if it attached. */
  layerEffectError(layers: string[]): string | null {
    try {
      handles.push(scene.tree.addLayerEffect(redOnly, layers));
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  },
  setAbove(names: string[], on: boolean) {
    for (const name of names) rect(name).renderAboveEffects = on;
  },
  setLayer(name: string, layer: string) {
    rect(name).setLayer(layer);
  },
  /** Where a rect sits logically, independent of where it draws. */
  parentOf(name: string): { layer: string; parent: string | undefined } {
    const graphics = rect(name);
    return {
      layer: graphics.layerName,
      parent: graphics.renderObject.parent?.label,
    };
  },
  destroyRect(name: string) {
    rect(name).entity.destroy();
  },
  setSceneAlpha(alpha: number) {
    scene.tree.root.alpha = alpha;
  },
  setSceneVisible(visible: boolean) {
    scene.tree.root.visible = visible;
  },
  setSceneMask(x: number, y: number, radius: number) {
    scene.tree.setMask(
      graphicsMask((g) => {
        g.circle(x, y, radius).fill(0xffffff);
      }),
    );
  },
  moveCamera(x: number, y: number) {
    scene.moveCamera(x, y);
  },
};
