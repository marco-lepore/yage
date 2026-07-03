import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // Vitest 4 transforms TS with oxc; YAGE decorators (@serializable) are
    // legacy stage-2, so oxc must be told explicitly.
    decorator: { legacy: true },
  },
  test: {
    coverage: { provider: "v8" },
  },
});
