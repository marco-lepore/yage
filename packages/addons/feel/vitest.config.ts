import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // Keep addon tests ready for YAGE's legacy TypeScript decorators.
    decorator: {
      legacy: true,
    },
  },
  test: {
    coverage: {
      provider: "v8",
    },
  },
});
