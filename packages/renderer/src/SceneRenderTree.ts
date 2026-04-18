import { ServiceKey } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import type { Container } from "pixi.js";
import type { LayerDef } from "./LayerDef.js";
import type { RenderLayer } from "./RenderLayer.js";

/**
 * Scene-owned render tree. Created by `SceneRenderTreeProvider` when a scene
 * enters. Scoped DI: components resolve via `this.use(SceneRenderTreeKey)`.
 */
export interface SceneRenderTree {
  /** The single root container for the scene. Direct child of app.stage. */
  readonly root: Container;
  /** Get a layer by name. Throws if not found. */
  get(name: string): RenderLayer;
  /** Get a layer by name, or undefined if not found. */
  tryGet(name: string): RenderLayer | undefined;
  /** All layers, sorted by draw order. */
  getAll(): readonly RenderLayer[];
  /** The auto-created "default" layer (order 0). */
  readonly defaultLayer: RenderLayer;
  /**
   * Get an existing layer or create it from the given definition. Used by
   * plugins like UI that auto-provision a layer if the game didn't declare
   * one explicitly.
   */
  ensureLayer(def: LayerDef): RenderLayer;
}

/**
 * Provider that materializes and tears down per-scene render trees. Held
 * engine-globally so cross-scene tools (save, inspector) can enumerate
 * trees.
 */
export interface SceneRenderTreeProvider {
  createForScene(scene: Scene): SceneRenderTree;
  destroyForScene(scene: Scene): void;
  /** Look up the render tree for a given scene. */
  getTree(scene: Scene): SceneRenderTree | undefined;
  /** Iterate every live scene/tree pair. */
  allTrees(): Iterable<[Scene, SceneRenderTree]>;
  /** Reorder the scene's container to render on top of its root peers. */
  bringSceneToFront?(scene: Scene): void;
}

/**
 * Engine-scope key for the render-tree provider. Used by cross-scene tools
 * (inspector, debug plugin, tests) to enumerate or ensure layers.
 */
export const SceneRenderTreeProviderKey =
  new ServiceKey<SceneRenderTreeProvider>("sceneRenderTreeProvider");

/**
 * Scene-scope key for the active scene's render tree. Registered by the
 * renderer's `beforeEnter` hook; components resolve with `this.use()`.
 */
export const SceneRenderTreeKey = new ServiceKey<SceneRenderTree>(
  "sceneRenderTree",
  { scope: "scene" },
);
