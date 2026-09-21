import type { SceneLightingOptions } from "./types.js";

declare module "@yagejs/core" {
  interface Scene {
    /**
     * How this scene's lighting is drawn: which of the plugin's configured
     * renderers, and how much light bounces. Read once, when the scene is
     * entered and its lighting world is created.
     */
    readonly lighting?: SceneLightingOptions;
  }
}

export {};
