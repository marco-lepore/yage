import { coverageConfigDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Every Capacitor import a test loads reads the stand-in in `src/test`. */
const fakeCapacitor = fileURLToPath(
  new URL("./src/test/fakeCapacitor.ts", import.meta.url),
);

export default defineConfig({
  oxc: {
    // Vitest 4 uses oxc for transforms. YAGE decorators such as @trait use
    // TypeScript's legacy decorator transform.
    decorator: {
      legacy: true,
    },
  },
  test: {
    alias: {
      "@capacitor/core": fakeCapacitor,
      "@capacitor/app": fakeCapacitor,
      "@capacitor/filesystem": fakeCapacitor,
      "@capacitor/screen-orientation": fakeCapacitor,
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [...coverageConfigDefaults.exclude, "src/test/**"],
      thresholds: {
        statements: 99,
        branches: 96,
        functions: 100,
        lines: 100,
      },
    },
  },
});
