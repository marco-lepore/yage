import { Container } from "pixi.js";
import type { Scene } from "@yagejs/core";
import type { LayerDef } from "./LayerDef.js";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "./SceneRenderTree.js";
import { RenderLayerManager } from "./RenderLayer.js";
import type { RenderLayer } from "./RenderLayer.js";

interface SceneEntry {
  worldContainer: Container;
  screenContainer: Container;
  manager: RenderLayerManager;
  tree: SceneRenderTreeImpl;
}

/**
 * Scene-bound wrapper around a `RenderLayerManager`. Exposed via
 * `SceneRenderTreeKey`; components resolve it through `Component.use()`.
 */
class SceneRenderTreeImpl implements SceneRenderTree {
  constructor(private readonly manager: RenderLayerManager) {}

  get(name: string): RenderLayer {
    return this.manager.get(name);
  }

  tryGet(name: string): RenderLayer | undefined {
    return this.manager.tryGet(name);
  }

  getAll(): readonly RenderLayer[] {
    return this.manager.getAll();
  }

  get defaultLayer(): RenderLayer {
    return this.manager.defaultLayer;
  }

  ensureLayer(def: LayerDef): RenderLayer {
    return this.manager.tryGet(def.name) ?? this.manager.createFromDef(def);
  }
}

/**
 * Materializes a per-scene render tree with two root containers
 * (world + screen). Registered under `SceneRenderTreeProviderKey` by the
 * renderer plugin and consumed via the `beforeEnter` scene hook.
 */
export class SceneRenderTreeProviderImpl implements SceneRenderTreeProvider {
  private entries = new Map<Scene, SceneEntry>();

  constructor(
    private readonly worldRoot: Container,
    private readonly screenRoot: Container,
  ) {}

  createForScene(scene: Scene): SceneRenderTree {
    if (this.entries.has(scene)) {
      throw new Error(
        `Scene "${scene.name}" already has a render tree attached.`,
      );
    }

    const worldContainer = new Container();
    worldContainer.label = `scene:${scene.name}:world`;
    this.worldRoot.addChild(worldContainer);

    const screenContainer = new Container();
    screenContainer.label = `scene:${scene.name}:screen`;
    this.screenRoot.addChild(screenContainer);

    const manager = new RenderLayerManager(worldContainer, screenContainer);

    // Known limitation: the manager already auto-created a world-space
    // "default" layer in its constructor, so a user-declared LayerDef for
    // "default" is silently dropped by `tryGet` below. Pick a different
    // name if you need custom space/order/eventMode for your main layer.
    for (const def of scene.layers ?? []) {
      if (manager.tryGet(def.name)) continue;
      manager.createFromDef(def);
    }

    const tree = new SceneRenderTreeImpl(manager);
    this.entries.set(scene, { worldContainer, screenContainer, manager, tree });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.entries.get(scene);
    if (!entry) return;
    entry.worldContainer.removeFromParent();
    entry.worldContainer.destroy({ children: true });
    entry.screenContainer.removeFromParent();
    entry.screenContainer.destroy({ children: true });
    entry.manager.destroy();
    this.entries.delete(scene);
  }

  /**
   * Move the scene's world + screen containers to the end of their
   * respective roots so they render on top of peers. Used by DebugPlugin to
   * keep the debug scene visually above the stacked user scenes.
   */
  bringSceneToFront(scene: Scene): void {
    const entry = this.entries.get(scene);
    if (!entry) return;
    if (entry.worldContainer.parent === this.worldRoot) {
      this.worldRoot.removeChild(entry.worldContainer);
      this.worldRoot.addChild(entry.worldContainer);
    }
    if (entry.screenContainer.parent === this.screenRoot) {
      this.screenRoot.removeChild(entry.screenContainer);
      this.screenRoot.addChild(entry.screenContainer);
    }
  }

  /** Destroy every tracked scene's tree. Used on renderer shutdown. */
  destroyAll(): void {
    for (const scene of [...this.entries.keys()]) {
      this.destroyForScene(scene);
    }
  }
}
