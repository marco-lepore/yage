import { resolve } from "node:path";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vite";

// The project the editor E2E path runs against. `yage-editor` reads this config
// first, so the root it sets is the root every editor path is resolved against.
export default defineConfig({
  root: __dirname,
  plugins: [wasm()],
  // The textures the fixture level names live with the other example assets.
  publicDir: resolve(__dirname, "../../examples/public"),
});
