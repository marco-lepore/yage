import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // YAGE decorators such as @trait use TypeScript's legacy transform.
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
