import { defineConfig, type PluginOption } from "vite";
import { readdirSync } from "fs";
import { basename, resolve } from "path";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { EXAMPLES } from "./src/catalog.js";

// Test server only: inject the deterministic E2E harness ahead of each
// example's own module so Playwright can drive the unmodified examples. Gated
// on YAGE_E2E so normal `npm run dev` and production builds never include it.
function e2eHarness(): PluginOption {
  return {
    name: "yage-e2e-harness",
    apply: (_config, { command }) =>
      command === "serve" && Boolean(process.env.YAGE_E2E),
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

// The index runs each example in a frame and shows its title and the way back
// itself. Mark a framed example page before it renders, so shared.css can
// hide that part of the page.
function embeddedMarker(): PluginOption {
  return {
    name: "yage-examples-embedded",
    transformIndexHtml(_html, ctx) {
      if (basename(ctx.filename) === "index.html") return;
      return [
        {
          tag: "script",
          children:
            'if (window.parent !== window) document.documentElement.dataset.embedded = "";',
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

// The index lists what src/catalog.ts lists, so a page without an entry would
// be built but never shown. Stop here instead.
function checkCatalog(pages: string[]): void {
  const slugs = EXAMPLES.map((example) => example.slug);
  const problems = [
    ...pages
      .filter((page) => !slugs.includes(page))
      .map((page) => `${page}.html has no entry`),
    ...slugs
      .filter((slug) => !pages.includes(slug))
      .map((slug) => `"${slug}" has no ${slug}.html page`),
    ...slugs
      .filter((slug, i) => slugs.indexOf(slug) !== i)
      .map((slug) => `"${slug}" is listed twice`),
  ];
  if (problems.length > 0) {
    throw new Error(
      `examples/src/catalog.ts does not match the example pages:\n  ${problems.join("\n  ")}`,
    );
  }
}
checkCatalog(Object.keys(htmlInputs).filter((key) => key !== "main"));

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), wasm(), e2eHarness(), embeddedMarker()],
  server: {
    port: 5199,
  },
  oxc: {
    // YAGE decorators such as @trait use TypeScript's legacy transform.
    decorator: {
      legacy: true,
    },
  },
  build: {
    rollupOptions: {
      // Preserve readable class/function names in production diagnostics.
      output: {
        keepNames: true,
      },
      input: htmlInputs,
    },
  },
});
