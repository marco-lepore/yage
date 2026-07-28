import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
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
