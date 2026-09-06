import { createMockScene, type Scene } from "@yagejs/core";
import {
  EffectsHost,
  RenderLayerManager,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
  type SceneRenderTree,
  type SceneRenderTreeProvider,
} from "@yagejs/renderer";
import { Container } from "pixi.js";

/** A real render tree without a canvas or renderer application. */
export function createExampleScene() {
  const { scene, context } = createMockScene();
  const root = new Container();
  const layers = new RenderLayerManager(root);
  layers.create("world", 1);
  const tree: SceneRenderTree = {
    root,
    get: (name) => layers.get(name),
    tryGet: (name) => layers.tryGet(name),
    getAll: () => layers.getAll(),
    defaultLayer: layers.defaultLayer,
    ensureLayer: (definition, options) =>
      layers.tryGet(definition.name) ??
      layers.createFromDef(definition, options),
    fx: new EffectsHost(() => root, "scene", undefined),
    setMask: () => {
      throw new Error("Masks are outside this test scene.");
    },
    clearMask: () => {},
  };
  const provider: SceneRenderTreeProvider = {
    createForScene: () => tree,
    destroyForScene: () => root.destroy({ children: true }),
    getTree: (target) => (target === scene ? tree : undefined),
    allTrees: function* (): Iterable<[Scene, SceneRenderTree]> {
      yield [scene, tree];
    },
  };
  scene.registerScoped(SceneRenderTreeKey, tree);
  context.register(SceneRenderTreeProviderKey, provider);
  return { scene, context, tree, layers };
}
