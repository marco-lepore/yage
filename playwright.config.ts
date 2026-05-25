import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: "html",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    // Hand-written deterministic fixtures (e2e/fixtures), served on :5200.
    {
      name: "fixtures",
      testIgnore: "**/examples.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5200" },
    },
    // The shipped examples (examples/*.html), served on :5199 and driven
    // through the deterministic `?test` harness by examples.spec.ts.
    {
      name: "examples",
      testMatch: "**/examples.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5199" },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5200 --strictPort",
      cwd: `${__dirname}/e2e`,
      url: "http://127.0.0.1:5200/inspector-scene.html",
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5199 --strictPort",
      cwd: `${__dirname}/examples`,
      url: "http://127.0.0.1:5199/",
      reuseExistingServer: !process.env["CI"],
      // Enables the example-page E2E harness injection (examples/e2e/harness.ts).
      env: { YAGE_E2E: "1" },
    },
  ],
});
