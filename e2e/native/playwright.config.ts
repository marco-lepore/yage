import { defineConfig } from "@playwright/test";

/**
 * The native baseline suite: it builds each target's web directory itself and
 * runs it in the shells this machine has. CI does not run it — the shells are
 * installed per folder under `e2e/native` and a simulator needs Xcode.
 */
export default defineConfig({
  testDir: "./specs",
  outputDir: "./.work/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  projects: [
    {
      name: "harness",
      testMatch: "**/harness.spec.ts",
      timeout: 120_000,
    },
    {
      name: "browser",
      testMatch: ["**/fixture.spec.ts", "**/game.spec.ts"],
      timeout: 120_000,
    },
    {
      name: "electron",
      testMatch: ["**/fixture.spec.ts", "**/game.spec.ts"],
      timeout: 120_000,
    },
    {
      name: "ios-simulator",
      testMatch: ["**/fixture.spec.ts", "**/game.spec.ts"],
      timeout: 1_200_000,
    },
  ],
});
