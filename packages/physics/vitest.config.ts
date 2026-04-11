import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: {
    // Vitest 4 pulls Vite 8, which uses oxc for transforms. oxc only
    // implements the legacy (stage-2) TS decorator transform — without this
    // flag, `@serializable` in test files crashes the parser.
    decorator: {
      legacy: true,
    },
  },
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
