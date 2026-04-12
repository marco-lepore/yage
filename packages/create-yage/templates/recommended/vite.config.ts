import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // vite-plugin-wasm is required by @yagejs/physics, which depends on
  // @dimforge/rapier2d — a WebAssembly module that needs proper ESM loading.
  plugins: [wasm()],
  oxc: {
    // Forward-compat: enable legacy (stage-2) decorators so that if you add
    // @yagejs/save later and put @serializable on your own components, it Just
    // Works without a config change. Not strictly required today — all
    // @yagejs/* packages are pre-transpiled and their dists contain no raw
    // decorator syntax. Costs nothing to include.
    decorator: {
      legacy: true,
    },
  },
});
