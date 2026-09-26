import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    // vite-plugin-wasm is required by @yagejs/physics, which depends on
    // @dimforge/rapier2d — a WebAssembly module that needs proper ESM loading.
    wasm(),
    // Makes the production build an installable, offline-capable app. The
    // service worker only exists in `vite build` output; `npm run dev` never
    // registers one, so the dev server always serves fresh files.
    VitePWA({
      // A new deploy downloads in the background and takes over the next time
      // the game is launched, never in the middle of a session.
      registerType: "prompt",
      manifest: {
        name: "My YAGE Game",
        short_name: "YAGE Game",
        description: "A game made with YAGE.",
        // Chrome, Edge, and Samsung Internet read display_override and open
        // the installed game fullscreen, hiding Android's status and
        // navigation bars. iOS and Firefox do not read it and open the game
        // "standalone", without browser toolbars. iOS has no "fullscreen".
        display: "standalone",
        display_override: ["fullscreen"],
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache every file in the build — code, the physics .wasm, and
        // everything under public/ — so the game runs offline. New or changed
        // files are picked up on each build without being listed here.
        globPatterns: ["**/*"],
        // A file above this size fails the build with an error naming it.
        // Raise the limit if a large asset, such as a music track, trips it.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  oxc: {
    // YAGE's @trait decorator uses TypeScript's legacy decorator transform.
    decorator: {
      legacy: true,
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Preserve readable class and function names in diagnostics.
        keepNames: true,
      },
    },
  },
});
