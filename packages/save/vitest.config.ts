import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // Vitest 4 uses oxc for transforms. YAGE decorators such as @trait use
    // TypeScript's legacy decorator transform.
    decorator: {
      legacy: true,
    },
  },
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
