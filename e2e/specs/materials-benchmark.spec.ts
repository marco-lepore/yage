import { expect, test } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

test.skip(
  process.env["YAGE_MATERIAL_BENCHMARK"] !== "1",
  "Opt-in hardware benchmark",
);
test.describe.configure({ mode: "serial" });
test.use({
  launchOptions: {
    args: [
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    ],
  },
});
for (const backend of ["webgl", "webgpu"]) {
  for (const variant of ["ordinary", "", "overlap", "stress"]) {
    test(`material benchmark ${backend} ${variant || "mapped"}`, async ({
      page,
    }, info) => {
      await gotoFixture(
        page,
        `/materials-benchmark.html?backend=${backend}&${variant}`,
      );
      await page.waitForFunction(
        () =>
          window.__yage__?.inspector.getExtension("materials-benchmark") !==
          undefined,
      );
      const result = await page.evaluate(async () => {
        const probe = window.__yage__!.inspector.getExtension<{
          measure(): Promise<{ backend: string }>;
        }>("materials-benchmark")!;
        return probe.measure();
      });
      expect(result.backend).toBe(backend);
      await info.attach("measurements", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
      console.log(JSON.stringify(result));
    });
  }
}
