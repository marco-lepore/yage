import { ServiceKey } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import type { Container } from "pixi.js";
import type { LayerDef } from "./LayerDef.js";
import type { RenderLayer, CreateLayerOptions } from "./RenderLayer.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle } from "./masks/MaskHandle.js";

/**
 * Options for `ensureLayer` beyond the declarative `LayerDef`. Used by
 * plugins (e.g. UI) to auto-provision screen-space layers so they stay
 * fixed to the viewport under the default camera.
 */
export type EnsureLayerOptions = Pick<
  CreateLayerOptions,
  "space" | "eventMode"
>;

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
   * one explicitly. Pass `{ space: "screen" }` so a default camera leaves
   * the layer fixed to the viewport (e.g. screen-space HUD).
   */
  ensureLayer(def: LayerDef, opts?: EnsureLayerOptions): RenderLayer;
  /**
   * Attach a scene-scope effect — applied to the entire per-scene root
   * container, after layer-scope effects have composited. Common use:
   * scene-wide CRT, color grade, vignette. Survives until the scene exits
   * or the handle is `.remove()`d.
   */
  addEffect<H extends EffectHandle>(factory: EffectFactory<H>): H;
  /**
   * Attach a scene-scope mask, replacing any existing one. Clips the entire
   * per-scene root. Torn down on scene exit.
   */
  setMask(factory: MaskFactory): MaskHandle;
  /** Detach and destroy the scene-scope mask, if any. */
  clearMask(): void;
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
