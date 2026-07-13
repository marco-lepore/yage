import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // This package has no decorators. The flag is set anyway to keep this
    // config identical to the other addon packages' vitest configs.
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
