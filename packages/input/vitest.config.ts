import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // Vitest 4 pulls Vite 8, which uses oxc for transforms. oxc only
    // implements the legacy (stage-2) TS decorator transform — without this
    // flag, `@serializable` in test files crashes the parser.
    decorator: {
      legacy: true,
    },
  },
  test: {
    environment: "happy-dom",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
