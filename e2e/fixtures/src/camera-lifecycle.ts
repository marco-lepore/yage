/**
 * E2E fixture for camera lifecycle + multi-scene camera behavior. Driven
 * by `e2e/specs/camera-lifecycle.spec.ts`.
 *
 * Exercises:
 *   1. Layer transform resets to identity when the last camera is disabled.
 *   2. A layer opted out of auto-binding stays at identity even under
 *      aggressive camera motion.
 *   3. Pushing a second scene with its own camera doesn't disturb the
 *      lower scene's layer transforms.
 */
import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  CameraEntity,
  CameraComponent,
  SceneRenderTreeKey,
} from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { UIPlugin, UIPanel, Anchor } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;

class BaseScene extends Scene {
  readonly name = "base";

  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
  ];

  camera!: CameraEntity;

  onEnter(): void {
    const e = this.spawn("world-content");
    e.add(new Transform());
    e.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(0, 0, 30, 30).fill({ color: 0x22c55e });
      }),
    );

    this.camera = this.spawn(CameraEntity, {
      position: new Vec2(0, 0),
    });

    // Force UI-layer auto-provisioning (autoBindable: false).
    const hud = this.spawn("hud");
    hud.add(new UIPanel({ anchor: Anchor.TopLeft, padding: 8 })).text("HUD");
  }
}

class OverlayScene extends Scene {
  readonly name = "overlay";
  override readonly transparentBelow = true;

  readonly layers: readonly LayerDef[] = [
    { name: "overlay-content", order: 0 },
  ];

  camera!: CameraEntity;

  onEnter(): void {
    const e = this.spawn("overlay-content");
    e.add(new Transform());
    e.add(
      new GraphicsComponent({ layer: "overlay-content" }).draw((g) => {
        g.rect(0, 0, 30, 30).fill({ color: 0xf97316 });
      }),
    );
    this.camera = this.spawn(CameraEntity, {
      position: new Vec2(0, 0),
    });
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container: document.getElementById("game-container") ?? document.body,
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin({ manualClock: true }));
await engine.start();

const baseScene = new BaseScene();
await engine.scenes.push(baseScene);

let overlayScene: OverlayScene | null = null;

interface LayerXform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

function layerTransformOf(scene: Scene, name: string): LayerXform | null {
  const tree = scene._resolveScoped(SceneRenderTreeKey);
  if (!tree) return null;
  const layer = tree.tryGet(name);
  if (!layer) return null;
  const c = layer.container;
  return {
    x: c.position.x,
    y: c.position.y,
    scaleX: c.scale.x,
    scaleY: c.scale.y,
    rotation: c.rotation,
  };
}

(window as Window & {
  __cameraTest__?: {
    setBaseCameraPosition(x: number, y: number): void;
    setBaseCameraZoom(z: number): void;
    disableBaseCamera(): void;
    enableBaseCamera(): void;
    getBaseLayerTransform(name: string): LayerXform | null;
    getOverlayLayerTransform(name: string): LayerXform | null;
    pushOverlay(): Promise<void>;
    popTop(): void;
    getSceneStackNames(): string[];
    getCameraNamesInStack(): string[];
  };
}).__cameraTest__ = {
  setBaseCameraPosition: (x, y) => {
    baseScene.camera.position = new Vec2(x, y);
  },
  setBaseCameraZoom: (z) => {
    baseScene.camera.zoom = z;
  },
  disableBaseCamera: () => {
    baseScene.camera.get(CameraComponent).enabled = false;
  },
  enableBaseCamera: () => {
    baseScene.camera.get(CameraComponent).enabled = true;
  },
  getBaseLayerTransform: (name) => layerTransformOf(baseScene, name),
  getOverlayLayerTransform: (name) =>
    overlayScene ? layerTransformOf(overlayScene, name) : null,
  pushOverlay: async () => {
    overlayScene = new OverlayScene();
    await engine.scenes.push(overlayScene);
  },
  popTop: () => {
    engine.scenes.pop();
    overlayScene = null;
  },
  getSceneStackNames: () => engine.scenes.all.map((s) => s.name),
  getCameraNamesInStack: () => {
    const names: string[] = [];
    for (const scene of engine.scenes.all) {
      for (const entity of scene.getEntities()) {
        if (entity.tryGet(CameraComponent)) {
          names.push(scene.name);
          break;
        }
      }
    }
    return names;
  },
};
