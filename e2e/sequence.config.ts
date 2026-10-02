import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./specs",
  testMatch: "sequence-editor.spec.ts",
  workers: 1,
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5202" },
  reporter: "list",
  webServer: {
    command:
      "node ../packages/tools/editor/dist/cli.js --config editor.sequence.config.ts --port 5202 --no-open",
    cwd: `${import.meta.dirname}/../examples`,
    url: "http://127.0.0.1:5202/",
    reuseExistingServer: false,
    env: { YAGE_E2E: "1" },
  },
});
