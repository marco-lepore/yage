/**
 * E2E fixture for @yagejs/lighting occlusion. Driven by
 * `e2e/specs/lighting-shadows.spec.ts`.
 *
 * A white floor under one lamp and one wall, so the lighting overlay's
 * multiply composite puts the drawn light level straight into the canvas
 * pixels. A second lamp ignores occluders and starts dark.
 * `window.__lighting__.probe` returns what the query says about a world
 * point plus where that point lands on screen, which lets the spec compare
 * the queried level with the drawn one under a camera that is neither
 * centred nor at zoom 1.
 *
 * The scene is static and the page runs the engine's own loop, so the spec
 * waits on a frame counter rather than a frozen clock. A debug overlay scene
 * would bring a lighting world of its own, whose unlit overlay would cover
 * this one.
 */
import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraEntity,
} from "@yagejs/renderer";
import {
  LightOccluder,
  LightSource,
  LightingPlugin,
  LightingWorldKey,
} from "@yagejs/lighting";
import type { LightingWorld } from "@yagejs/lighting";
import { injectStyles, setupContainer } from "./shared.js";

// No border, so the container's content box is exactly the virtual viewport
// and one canvas pixel is one virtual pixel.
injectStyles("#game-container { border: none; }");

const WIDTH = 400;
const HEIGHT = 400;
const container = setupContainer(WIDTH, HEIGHT);

class FrameCounter extends Component {
  frames = 0;

  update(): void {
    this.frames++;
  }
}

class ShadowScene extends Scene {
  readonly name = "lighting-shadows";

  camera!: CameraEntity;
  world!: LightingWorld;
  fill!: LightSource;
  counter!: FrameCounter;

  onEnter(): void {
    const world = this.tryResolveScoped(LightingWorldKey);
    if (!world) throw new Error("LightingPlugin is not installed");
    this.world = world;

    const floor = this.spawn("floor");
    floor.add(new Transform());
    this.counter = floor.add(new FrameCounter());
    floor.add(
      new GraphicsComponent().draw((graphics) => {
        graphics.rect(-400, -400, 1200, 1200).fill({ color: 0xffffff });
      }),
    );

    const lamp = this.spawn("lamp");
    lamp.add(new Transform({ position: new Vec2(200, 200) }));
    lamp.add(new LightSource({ radius: 180, intensity: 1 }));

    const fill = this.spawn("fill-lamp");
    fill.add(new Transform({ position: new Vec2(200, 200) }));
    this.fill = fill.add(
      new LightSource({ radius: 180, intensity: 0, castShadows: false }),
    );

    const wall = this.spawn("wall");
    wall.add(new Transform({ position: new Vec2(250, 200) }));
    wall.add(
      new LightOccluder({ shape: { type: "box", width: 20, height: 120 } }),
    );

    this.camera = this.spawn(CameraEntity, {
      position: new Vec2(220, 210),
      zoom: 1.25,
    });
  }
}

const engine = new Engine();
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x000000,
    resolution: 1,
    container,
  }),
);
engine.use(new LightingPlugin({ ambient: { level: 0 } }));
await engine.start();

const scene = new ShadowScene();
await engine.scenes.push(scene);

(
  window as Window & {
    __lighting__?: {
      frames(): number;
      probe(
        x: number,
        y: number,
      ): { level: number; screenX: number; screenY: number };
      setFillIntensity(intensity: number): void;
    };
  }
).__lighting__ = {
  frames: () => scene.counter.frames,
  probe: (x, y) => {
    const screen = scene.camera.worldToScreen(x, y);
    return {
      level: scene.world.levelAt(x, y),
      screenX: screen.x,
      screenY: screen.y,
    };
  },
  setFillIntensity: (intensity) => {
    scene.fill.intensity = intensity;
  },
};
