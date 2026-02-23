import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@dimforge/rapier2d": path.resolve(
        __dirname,
        "../../node_modules/@dimforge/rapier2d/rapier.js",
      ),
    },
  },
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
    },
  },
});
