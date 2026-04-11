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
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      thresholds: {
        // Global thresholds accommodate Engine.ts topologicalSort() which has
        // ?? operators whose fallback branches are structurally unreachable
        // (Map lookups guaranteed by preceding population loops). V8's branch
        // tracking counts these as uncovered phantom branches.
        statements: 99,
        branches: 96,
        functions: 100,
        lines: 100,
        // Per-file 100% for all files except Engine.ts
        "**/!(Engine).ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "**/Engine.ts": {
          statements: 97,
          branches: 80,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
