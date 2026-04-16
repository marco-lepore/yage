import type { LayerDef } from "./LayerDef.js";

declare module "@yagejs/core" {
  interface Scene {
    /**
     * Declarative render-layer definitions. Materialized into a
     * `SceneRenderTree` by the renderer's `beforeEnter` hook.
     */
    readonly layers?: readonly LayerDef[];
  }
}

export {};
