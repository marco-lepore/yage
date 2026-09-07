/**
 * E2E fixture for effect coordinates. Driven by
 * `e2e/specs/effects-center.spec.ts`.
 *
 * The scene draws a checkerboard that extends well past the virtual rect on
 * every side, so the filtered region clips to the whole canvas — the shape a
 * scrolling map produces, and the one where the region's origin and size stop
 * matching the play area. `hostWidth`, `hostHeight` and `resolution` come
 * from the query string so one page serves both letterbox orientations at
 * either renderer resolution; the device pixel ratio is set by the spec's
 * browser context.
 *
 * Exposes `window.__effectsCenter__` with the intensity driver and the
 * canvas → virtual mapping the spec needs to read a measured position back.
 */
import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import type { EffectHandle, LayerDef } from "@yagejs/renderer";
import { bulgePinch } from "@yagejs/effects";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 720;
/** Lens position in virtual pixels — the point the spec measures against. */
const CENTER = { x: 420, y: 400 };

const params = new URLSearchParams(window.location.search);
const hostWidth = Number(params.get("hostWidth") ?? 1200);
const hostHeight = Number(params.get("hostHeight") ?? 560);
const resolution = Number(params.get("resolution") ?? 1);

const container = setupContainer(hostWidth, hostHeight);

class CenterScene extends Scene {
  readonly name = "effects-center";
  readonly layers: readonly LayerDef[] = [{ name: "world", order: 0 }];

  effect!: EffectHandle;

  onEnter(): void {
    const board = this.spawn("board");
    board.add(new Transform({ position: new Vec2(0, 0) }));
    board.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        const cell = 16;
        const left = -VIRTUAL_WIDTH * 0.5;
        const top = -VIRTUAL_HEIGHT * 0.5;
        const right = VIRTUAL_WIDTH * 1.5;
        const bottom = VIRTUAL_HEIGHT * 1.5;
        g.rect(left, top, right - left, bottom - top).fill({ color: 0x101820 });
        let row = 0;
        for (let y = top; y < bottom; y += cell) {
          let col = 0;
          for (let x = left; x < right; x += cell) {
            if ((row + col) % 2 === 0) {
              g.rect(x, y, cell, cell).fill({ color: 0xf0f0f0 });
            }
            col += 1;
          }
          row += 1;
        }
      }),
    );

    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) throw new Error("scene render tree not yet attached");
    this.effect = tree.fx.addEffect(
      bulgePinch({ strength: 0.95, radius: 80, center: CENTER }),
    );
    this.effect.setIntensity(0);
  }
}

const engine = new Engine({ debug: true });
const renderer = new RendererPlugin({
  width: VIRTUAL_WIDTH,
  height: VIRTUAL_HEIGHT,
  backgroundColor: 0x000000,
  resolution,
  container,
});
engine.use(renderer);
await engine.start();

const scene = new CenterScene();
await engine.scenes.push(scene);

(
  window as Window & {
    __effectsCenter__?: {
      center: { x: number; y: number };
      setIntensity(value: number): void;
      canvasToVirtual(x: number, y: number): { x: number; y: number };
    };
  }
).__effectsCenter__ = {
  center: CENTER,
  setIntensity: (value) => {
    scene.effect.setIntensity(value);
  },
  canvasToVirtual: (x, y) => {
    const v = renderer.canvasToVirtual(x, y);
    return { x: v.x, y: v.y };
  },
};
