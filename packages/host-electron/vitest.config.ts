import { coverageConfigDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
      // Every test reads the stand-in, so no test starts Electron's binary
      // download by loading the real package.
      electron: fileURLToPath(
        new URL("./src/test/fakeElectron.ts", import.meta.url),
      ),
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // One line that hands the bridge to the page; a unit test cannot
        // load it, because `contextBridge` exists only in a preload script.
        "src/preload/index.ts",
        "src/test/**",
      ],
      thresholds: {
        statements: 99,
        branches: 96,
        functions: 100,
        lines: 100,
      },
    },
  },
});
