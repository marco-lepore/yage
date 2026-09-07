/**
 * E2E fixture for the `shockwave` ring's travel. Driven by
 * `e2e/specs/shockwave-direction.spec.ts`.
 *
 * The scene draws vertical grey stripes that ramp over a 64 px period in 4 px
 * columns, extending well past the virtual rect on every side so the filtered
 * region covers the whole canvas. Any horizontal displacement under 64 px
 * therefore changes the pixel it lands on, which is how the spec locates the
 * ring. `hostWidth`, `hostHeight`, `resolution` and `direction` come from the
 * query string; the device pixel ratio is set by the spec's browser context.
 *
 * Exposes `window.__shockwaveDirection__` with the trigger and both canvas
 * mappings the spec needs to convert a measured radius back to virtual pixels.
 */
import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { DebugPlugin } from "@yagejs/debug";
import {
  GraphicsComponent,
  RendererPlugin,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { shockwave } from "@yagejs/effects";
import type { ShockwaveDirection, ShockwaveHandle } from "@yagejs/effects";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 720;
/** Ripple travel in virtual pixels per second. */
const SPEED = 500;
/** Seconds the ramp takes end to end. */
const DURATION = 1;
/** Stripe period in virtual pixels — wider than any displacement the ring makes. */
const STRIPE_PERIOD = 64;
/** Stripe column width in virtual pixels. */
const STRIPE_STEP = 4;

const params = new URLSearchParams(window.location.search);
const hostWidth = Number(params.get("hostWidth") ?? 1200);
const hostHeight = Number(params.get("hostHeight") ?? 560);
const resolution = Number(params.get("resolution") ?? 1);
const direction = (params.get("direction") ?? "out") as ShockwaveDirection;

const container = setupContainer(hostWidth, hostHeight);

class ShockwaveScene extends Scene {
  readonly name = "shockwave-direction";
  readonly layers: readonly LayerDef[] = [{ name: "world", order: 0 }];

  effect!: ShockwaveHandle;

  onEnter(): void {
    const stripes = this.spawn("stripes");
    stripes.add(new Transform({ position: new Vec2(0, 0) }));
    stripes.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        const left = -VIRTUAL_WIDTH * 0.5;
        const top = -VIRTUAL_HEIGHT * 0.5;
        const right = VIRTUAL_WIDTH * 1.5;
        const bottom = VIRTUAL_HEIGHT * 1.5;
        for (let x = left; x < right; x += STRIPE_STEP) {
          const phase =
            (((x % STRIPE_PERIOD) + STRIPE_PERIOD) % STRIPE_PERIOD) /
            STRIPE_PERIOD;
          const level = Math.round(phase * 255);
          g.rect(x, top, STRIPE_STEP, bottom - top).fill({
            color: (level << 16) | (level << 8) | level,
          });
        }
      }),
    );

    const tree = this.context.resolve(SceneRenderTreeProviderKey).getTree(this);
    if (!tree) throw new Error("scene render tree not yet attached");
    this.effect = tree.fx.addEffect(
      shockwave({
        speed: SPEED,
        amplitude: 30,
        wavelength: 160,
        duration: DURATION,
        direction,
      }),
    );
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
engine.use(new DebugPlugin());
await engine.start();

const scene = new ShockwaveScene();
await engine.scenes.push(scene);

(
  window as Window & {
    __shockwaveDirection__?: {
      speed: number;
      duration: number;
      trigger(x: number, y: number): void;
      canvasToVirtual(x: number, y: number): { x: number; y: number };
      virtualToCanvas(x: number, y: number): { x: number; y: number };
    };
  }
).__shockwaveDirection__ = {
  speed: SPEED,
  duration: DURATION,
  trigger: (x, y) => {
    scene.effect.trigger(x, y);
  },
  canvasToVirtual: (x, y) => {
    const v = renderer.canvasToVirtual(x, y);
    return { x: v.x, y: v.y };
  },
  virtualToCanvas: (x, y) => {
    const v = renderer.virtualToCanvas(x, y);
    return { x: v.x, y: v.y };
  },
};
