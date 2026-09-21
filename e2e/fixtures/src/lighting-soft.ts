/**
 * E2E fixture for soft-edged lighting. Driven by
 * `e2e/specs/lighting-soft.spec.ts`.
 *
 * A white floor under a wide lamp, one wall and one spotlight, with ambient
 * light at zero, so a canvas pixel carries the light level the renderer drew
 * there. `window.__softLighting__.probe` returns what `levelAt()` says about a
 * world point plus where that point lands on screen, which lets the spec hold
 * the drawn picture against the query across a shadow's soft border and across
 * a cone's fade, under a camera that is neither centred nor at zoom 1.
 *
 * `?renderer=` picks a configured renderer, `?size=` the lamp's diameter and
 * `?softness=` the share of the cone its edge fades over, so the spec loads the
 * same page for the shader renderer and for the hard-edged overlay. `?lampX=`
 * moves the lamp, which at a few pixels from the wall puts part of the lamp
 * inside it.
 * `?backend=webgpu` asks Pixi for the WebGPU backend, and `backend()` reports
 * which one it actually started, so a spec can skip where none is available.
 *
 * The lamp and the spotlight start dark and the spec turns on the one it is
 * measuring, so neither adds light to the other's probes.
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
  shaderLighting,
} from "@yagejs/lighting";
import type { LightingWorld } from "@yagejs/lighting";
import { injectStyles, setupContainer } from "./shared.js";

// No border, so the container's content box is exactly the virtual viewport
// and one canvas pixel is one virtual pixel.
injectStyles("#game-container { border: none; }");

const WIDTH = 400;
const HEIGHT = 400;
const container = setupContainer(WIDTH, HEIGHT);

const params = new URLSearchParams(window.location.search);
const rendererName = params.get("renderer") ?? "shader";
const lampSize = Number(params.get("size") ?? 24);
const coneSoftness = Number(params.get("softness") ?? 0.6);
const preferWebGPU = params.get("backend") === "webgpu";
const lampX = Number(params.get("lampX") ?? 200);

class FrameCounter extends Component {
  frames = 0;

  update(): void {
    this.frames++;
  }
}

class SoftScene extends Scene {
  readonly name = "lighting-soft";
  readonly lighting = { renderer: rendererName };

  camera!: CameraEntity;
  world!: LightingWorld;
  lamp!: LightSource;
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

    // Wide enough that the wall's shadow border spreads over tens of pixels
    // by the time it reaches the probes.
    const lamp = this.spawn("lamp");
    lamp.add(new Transform({ position: new Vec2(lampX, 200) }));
    this.lamp = lamp.add(
      new LightSource({ radius: 320, intensity: 0, size: lampSize }),
    );

    // Aimed along +x with a sixty-degree spread, clear of the wall, and
    // passing through every occluder so the probes read the cone alone.
    const spot = this.spawn("spotlight");
    spot.add(new Transform({ position: new Vec2(120, 200), rotation: 0 }));
    this.spot = spot.add(
      new LightSource({
        radius: 300,
        intensity: 0,
        castShadows: false,
        cone: { angle: Math.PI / 3, softness: coneSoftness },
      }),
    );

    const wall = this.spawn("wall");
    wall.add(new Transform({ position: new Vec2(250, 200) }));
    wall.add(
      new LightOccluder({ shape: { type: "box", width: 24, height: 80 } }),
    );

    this.camera = this.spawn(CameraEntity, {
      position: new Vec2(210, 205),
      zoom: 1.25,
    });
  }
}

const engine = new Engine();
const renderer = new RendererPlugin({
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: 0x000000,
  resolution: 1,
  container,
  ...(preferWebGPU ? { pixi: { preference: "webgpu" as const } } : {}),
});
engine.use(renderer);
engine.use(
  new LightingPlugin({
    ambient: { level: 0 },
    renderers: { shader: shaderLighting(), overlay: overlayLighting() },
    defaultRenderer: "shader",
  }),
);
await engine.start();

const scene = new SoftScene();
await engine.scenes.push(scene);

(
  window as Window & {
    __softLighting__?: {
      backend(): string;
      frames(): number;
      probe(
        x: number,
        y: number,
      ): { level: number; screenX: number; screenY: number };
      setLampIntensity(intensity: number): void;
      setSpotIntensity(intensity: number): void;
    };
  }
).__softLighting__ = {
  backend: () => renderer.application.renderer.name,
  frames: () => scene.counter.frames,
  probe: (x, y) => {
    const screen = scene.camera.worldToScreen(x, y);
    return {
      level: scene.world.levelAt(x, y),
      screenX: screen.x,
      screenY: screen.y,
    };
  },
  setLampIntensity: (intensity) => {
    scene.lamp.intensity = intensity;
  },
  setSpotIntensity: (intensity) => {
    scene.spot.intensity = intensity;
  },
};
