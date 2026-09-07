import { defineConfig } from "vite";
import { readdirSync } from "fs";
import { resolve } from "path";
import wasm from "vite-plugin-wasm";

// Every *.html in this directory is a fixture page. Discovered so a new
// fixture is in the built output without a config change. The E2E web server
// serves the pages from source, so a page missing here does not fail a spec.
const htmlInputs = Object.fromEntries(
  readdirSync(__dirname)
    .filter((f) => f.endsWith(".html"))
    .map((f) => [f.slice(0, -".html".length), resolve(__dirname, f)]),
);

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, "../../examples/public"),
  plugins: [wasm()],
  server: {
    port: 5200,
  },
  oxc: {
    // Transform TypeScript legacy (stage-2) decorators. See examples/vite.config.ts.
    decorator: {
      legacy: true,
    },
  },
  build: {
    rollupOptions: {
      // Preserve class/function names through the oxc minifier so Inspector
      // diagnostics keep readable component and system names. Vite 8 switched
      // from esbuild to oxc; the old `esbuild: { keepNames: true }` option is
      // silently dropped by the oxc converter.
      output: {
        keepNames: true,
      },
      input: htmlInputs,
    },
  },
});
