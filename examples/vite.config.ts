import { defineConfig, type PluginOption } from "vite";
import { readdirSync } from "fs";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

// Test server only: inject the deterministic E2E harness ahead of each
// example's own module so Playwright can drive the unmodified examples. Gated
// on YAGE_E2E so normal `npm run dev` and production builds never include it.
function e2eHarness(): PluginOption {
  return {
    name: "yage-e2e-harness",
    apply: () => Boolean(process.env.YAGE_E2E),
    configureServer(server) {
      // Silence the favicon 404 so the suite's no-console-error assertion
      // isn't tripped by a missing icon every example would otherwise request.
      server.middlewares.use((req, res, next) => {
        if (req.url === "/favicon.ico") {
          res.statusCode = 204;
          res.end();
          return;
        }
        next();
      });
    },
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module", src: "/e2e/harness.ts" },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

// Auto-discover every *.html at the examples root so new examples are picked
// up by the production build without touching this file. `index.html` keeps
// the conventional "main" key; everything else uses its filename stem.
const htmlInputs = Object.fromEntries(
  readdirSync(__dirname)
    .filter((f) => f.endsWith(".html"))
    .map((f) => {
      const stem = f.slice(0, -".html".length);
      return [stem === "index" ? "main" : stem, resolve(__dirname, f)];
    }),
);

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), wasm(), e2eHarness()],
  server: {
    port: 5199,
  },
  oxc: {
    // Transform TypeScript's legacy (stage-2) decorators. oxc only supports
    // the legacy transform — stage-3 decorators would be passed through to
    // the browser, which can't parse them yet. @yagejs/save's @serializable
    // decorator works under either transform, so legacy mode is the safe pick.
    decorator: {
      legacy: true,
    },
  },
  build: {
    rollupOptions: {
      // Preserve class/function names through the oxc minifier so that
      // @yagejs/save's class-name-based snapshot restoration still works in
      // production builds. Vite 8 switched from esbuild to oxc; the old
      // `esbuild: { keepNames: true }` option is silently dropped by the
      // oxc converter.
      output: {
        keepNames: true,
      },
      input: htmlInputs,
    },
  },
});
