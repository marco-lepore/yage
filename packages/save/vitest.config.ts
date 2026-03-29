import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 99,
        branches: 96,
        functions: 100,
        lines: 100,
      },
    },
  },
});
