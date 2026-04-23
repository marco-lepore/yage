/**
 * E2E fixture for camera parallax + screen-space UI layer. Driven by
 * `e2e/specs/camera-parallax.spec.ts`. Uses `manualClock: true` so the
 * spec can deterministically step frames.
 *
 * Exposes `window.__cameraTest__` with helpers to drive the camera.
 */
import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraEntity,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { UIPlugin, UIPanel, Anchor } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

class ParallaxScene extends Scene {
  readonly name = "parallax";

  readonly layers: readonly LayerDef[] = [
    { name: "sky", order: -30 },
    { name: "far", order: -20 },
    { name: "mid", order: -10 },
    { name: "world", order: 0 },
  ];

  camera!: CameraEntity;

  onEnter(): void {
    // Deterministic content on every layer so presence is visible, but
    // the spec only reads container transforms.
    for (const name of ["sky", "far", "mid", "world"]) {
      const e = this.spawn(`${name}-content`);
      e.add(new Transform({ position: new Vec2(0, 0) }));
      e.add(
        new GraphicsComponent({ layer: name }).draw((g) => {
          g.rect(0, 0, 40, 40).fill({ color: 0x888888 });
        }),
      );
    }

    this.camera = this.spawn(CameraEntity, {
      position: new Vec2(0, 0),
      bindings: [
        { layer: "sky", translateRatio: 0.1 },
        { layer: "far", translateRatio: 0.3 },
        { layer: "mid", translateRatio: 0.6 },
        { layer: "world", translateRatio: 1 },
      ],
    });

    // Trigger UI layer auto-provisioning (space: "screen").
    const hud = this.spawn("hud");
    hud.add(new UIPanel({ anchor: Anchor.TopLeft, padding: 8 })).text("HUD");
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();

const scene = new ParallaxScene();
await engine.scenes.push(scene);

(
  window as Window & {
    __cameraTest__?: {
      setCameraPosition(x: number, y: number): void;
      setCameraZoom(z: number): void;
    };
  }
).__cameraTest__ = {
  setCameraPosition: (x, y) => {
    scene.camera.position = new Vec2(x, y);
  },
  setCameraZoom: (z) => {
    scene.camera.zoom = z;
  },
};
