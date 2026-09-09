import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    vite: "src/vite.ts",
    cli: "src/cli.ts",
    gallery: "src/gallery/main.ts",
  },
  format: ["esm"],
  loader: { ".html": "text" },
  // The HTTP application serves the gallery as one standalone browser asset.
  splitting: false,
  dts: true,
  clean: true,
  target: "es2022",
});
