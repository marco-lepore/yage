/**
 * E2E fixture for scene-scoped DI. Drives the assertions in
 * `e2e/specs/scene-di.spec.ts`:
 * 1. PhysicsWorldKey resolves in a component via `this.use()`.
 * 2. SceneRenderTreeKey resolves and declared layers are accessible.
 * 3. The scene is on the stack with the expected name and entities.
 */
import {
  Engine,
  Component,
  Scene,
  Transform,
  Vec2,
  serializable,
} from "@yagejs/core";
import {
  RendererPlugin,
  GraphicsComponent,
  SceneRenderTreeKey,
} from "@yagejs/renderer";
import type { LayerDef, SceneRenderTree } from "@yagejs/renderer";
import {
  PhysicsPlugin,
  PhysicsWorldKey,
  RigidBodyComponent,
  ColliderComponent,
} from "@yagejs/physics";
import type { PhysicsWorld } from "@yagejs/physics";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;

// ---------------------------------------------------------------------------
// Components that record scoped-DI resolution results as inspectable data
// ---------------------------------------------------------------------------

@serializable
class PhysicsProbe extends Component {
  hasWorld = false;

  onAdd(): void {
    const world: PhysicsWorld = this.use(PhysicsWorldKey);
    this.hasWorld = world !== undefined && world !== null;
  }

  serialize() {
    return { hasWorld: this.hasWorld };
  }

  static fromSnapshot(data: { hasWorld: boolean }) {
    const p = new PhysicsProbe();
    p.hasWorld = data.hasWorld;
    return p;
  }
}

@serializable
class RenderTreeProbe extends Component {
  hasTree = false;
  layerCount = 0;
  hasCustomLayer = false;

  onAdd(): void {
    const tree: SceneRenderTree | undefined = this.use(SceneRenderTreeKey);
    if (!tree) return;
    this.hasTree = true;
    this.layerCount = tree.getAll().length;
    this.hasCustomLayer = tree.tryGet("world") !== undefined;
  }

  serialize() {
    return {
      hasTree: this.hasTree,
      layerCount: this.layerCount,
      hasCustomLayer: this.hasCustomLayer,
    };
  }

  static fromSnapshot(data: {
    hasTree: boolean;
    layerCount: number;
    hasCustomLayer: boolean;
  }) {
    const p = new RenderTreeProbe();
    p.hasTree = data.hasTree;
    p.layerCount = data.layerCount;
    p.hasCustomLayer = data.hasCustomLayer;
    return p;
  }
}

// ---------------------------------------------------------------------------
// Scene A — declares layers, spawns probes
// ---------------------------------------------------------------------------
class SceneA extends Scene {
  readonly name = "scene-a";
  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
  ];

  onEnter(): void {
    // Physics probe entity (needs Transform + RigidBody to create a world)
    const probeEntity = this.spawn("physics-probe");
    probeEntity.add(new Transform({ position: new Vec2(100, 100) }));
    probeEntity.add(new RigidBodyComponent({ type: "static" }));
    probeEntity.add(
      new ColliderComponent({ shape: { type: "box", width: 10, height: 10 } }),
    );
    probeEntity.add(new PhysicsProbe());

    // Render tree probe
    const renderProbe = this.spawn("render-tree-probe");
    renderProbe.add(new Transform());
    renderProbe.add(new RenderTreeProbe());

    // Visible entity to confirm rendering works
    const box = this.spawn("box");
    box.add(new Transform({ position: new Vec2(200, 300) }));
    box.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(-20, -20, 40, 40).fill({ color: 0x22c55e });
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: document.getElementById("game-container")!,
    }),
  );
  engine.use(new PhysicsPlugin());
  engine.use(new DebugPlugin({ manualClock: true }));

  await engine.start();
  await engine.scenes.push(new SceneA());
}

main().catch(console.error);
