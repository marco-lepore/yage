/**
 * E2E fixture for @yagejs/lighting occlusion. Driven by
 * `e2e/specs/lighting-shadows.spec.ts`.
 *
 * A white floor under one lamp and one wall, so the lighting overlay's
 * multiply composite puts the drawn light level straight into the canvas
 * pixels. A second lamp ignores occluders and a third is a spotlight; both
 * start dark. `window.__lighting__.probe` returns what the query says about a world
 * point plus where that point lands on screen, which lets the spec compare
 * the queried level with the drawn one under a camera that is neither
 * centred nor at zoom 1.
 *
 * The scene picks its renderer by name and carries its own bounce setting,
 * which `?bounce=1` turns on, so the spec can load the same page with and
 * without it.
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
  overlayLighting,
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

const bounced = new URLSearchParams(window.location.search).has("bounce");

class ShadowScene extends Scene {
  readonly name = "lighting-shadows";
  // A reach wide enough to carry light to the probe deep behind the wall,
  // rather than only to the pixels along the shadow's edge.
  readonly lighting = {
    renderer: "overlay",
    bounce: bounced ? { strength: 0.7, radius: 192 } : null,
  };

  camera!: CameraEntity;
  world!: LightingWorld;
  fill!: LightSource;
  spot!: LightSource;
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

    // Aimed down the screen, so one probe sits inside its quarter-turn cone
    // and one the same distance away sits outside it.
    const spot = this.spawn("spotlight");
    spot.add(
      new Transform({ position: new Vec2(200, 200), rotation: Math.PI / 2 }),
    );
    this.spot = spot.add(
      new LightSource({
        radius: 180,
        intensity: 0,
        cone: { angle: Math.PI / 2 },
      }),
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
engine.use(
  new LightingPlugin({
    ambient: { level: 0 },
    renderers: { overlay: overlayLighting() },
    defaultRenderer: "overlay",
  }),
);
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
      setSpotIntensity(intensity: number): void;
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
  setSpotIntensity: (intensity) => {
    scene.spot.intensity = intensity;
  },
};
