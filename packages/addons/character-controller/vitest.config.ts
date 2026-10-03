import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    // Vitest 4 uses oxc for transforms. YAGE decorators such as @trait use
    // TypeScript's legacy decorator transform.
    decorator: {
      legacy: true,
    },
  },
  resolve: {
    alias: {
      "@yagejs/physics": new URL("../../physics/src/index.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    coverage: {
      provider: "v8",
    },
  },
});
