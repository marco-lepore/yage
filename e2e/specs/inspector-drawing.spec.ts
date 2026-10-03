import { expect, test } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

interface DrawingProbe {
  redrawGraphic(): void;
  graphicPixel(): number[];
  requestHiddenLight(): void;
  showLight(): void;
  reset(): void;
  setDrawing(enabled: boolean): void;
  move(x: number): void;
  replace(): Promise<void>;
  read(): {
    canvasDraws: number;
    lightDraws: number;
    bounceDraws: number;
    lightColor: number;
    color: number;
    ticks: number;
    clicks: number;
    focus: boolean;
    drawing: boolean;
    visible: boolean;
  };
}

test("batch and drive stepping skip draws but retain interaction and fresh lighting", async ({
  page,
}) => {
  await gotoFixture(page, "/inspector-drawing.html");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector?.getExtension("drawing-test") !== undefined,
  );
  const result = await page.evaluate(async () => {
    const i = window.__yage__!.inspector;
    const probe = i.getExtension<DrawingProbe>("drawing-test")!;
    probe.reset();
    const start = i.time.getFrame();
    await i.time.stepAsync(20, { render: "last" });
    const batch = { ...probe.read(), frames: i.time.getFrame() - start };
    probe.reset();
    const drive = await i.drive(
      async ({ step, capture, pointer, input }) => {
        probe.move(150);
        await step();
        await step();
        pointer.click({ x: 180, y: 25 });
        await input.tap("Enter");
        await step();
        const beforeCapture = probe.read();
        const frame = i.time.getFrame();
        await capture();
        const afterCapture = {
          ...probe.read(),
          spent: i.time.getFrame() - frame,
        };
        await probe.replace();
        probe.move(120);
        await step();
        pointer.click({ x: 145, y: 25 });
        return { beforeCapture, afterCapture, afterReplace: probe.read() };
      },
      { render: "none" },
    );
    const restored = probe.read().drawing;
    probe.reset();
    await i.time.stepAsync();
    const normal = probe.read();
    probe.setDrawing(false);
    probe.reset();
    await i.time.stepAsync(2);
    const disabled = probe.read();
    await i.capture.dataURL();
    const capturedWhileDisabled = probe.read();
    probe.setDrawing(true);
    return { batch, drive, restored, normal, disabled, capturedWhileDisabled };
  });
  expect(result.batch).toMatchObject({
    frames: 20,
    canvasDraws: 1,
    lightDraws: 1,
    bounceDraws: 1,
    focus: true,
    visible: true,
  });
  expect(result.drive.ok).toBe(true);
  if (!result.drive.ok) throw new Error(result.drive.error);
  expect(result.drive.value.beforeCapture).toMatchObject({
    clicks: 2,
    canvasDraws: 0,
    lightDraws: 0,
    bounceDraws: 0,
    focus: true,
  });
  expect(result.drive.value.afterCapture).toMatchObject({
    spent: 0,
    canvasDraws: 1,
    lightDraws: 1,
    bounceDraws: 1,
  });
  expect(result.drive.value.afterCapture.lightColor).toBe(
    result.drive.value.afterCapture.color,
  );
  expect(result.drive.value.afterReplace).toMatchObject({
    clicks: 1,
    focus: true,
  });
  expect(result.restored).toBe(true);
  expect(result.disabled).toMatchObject({
    drawing: false,
    canvasDraws: 0,
    lightDraws: 0,
  });
  expect(result.capturedWhileDisabled).toMatchObject({
    drawing: false,
    canvasDraws: 1,
    lightDraws: 1,
    bounceDraws: 1,
  });
  expect(result.normal).toMatchObject({
    canvasDraws: 1,
    lightDraws: 1,
    bounceDraws: 1,
  });
});

test("captures graphics redrawn and moved during suppressed frames", async ({
  page,
}) => {
  await gotoFixture(page, "/inspector-drawing.html");
  await page.waitForFunction(() =>
    window.__yage__?.inspector?.getExtension("drawing-test"),
  );
  const pixel = await page.evaluate(async () => {
    const inspector = window.__yage__!.inspector;
    const probe = inspector.getExtension<DrawingProbe>("drawing-test")!;
    probe.redrawGraphic();
    await inspector.time.stepAsync(2, { render: "none" });
    return probe.graphicPixel();
  });
  expect(pixel).toEqual([0, 255, 0, 255]);
});

for (const enabled of [true, false]) {
  test(`capture keeps hidden light and bounce requests together (drawing: ${enabled})`, async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-drawing.html");
    await page.waitForFunction(() =>
      window.__yage__?.inspector?.getExtension("drawing-test"),
    );
    const result = await page.evaluate(async (enabled) => {
      const inspector = window.__yage__!.inspector;
      const probe = inspector.getExtension<DrawingProbe>("drawing-test")!;
      probe.reset();
      probe.setDrawing(enabled);
      probe.requestHiddenLight();
      await inspector.capture.dataURL();
      const hidden = probe.read();
      probe.showLight();
      await inspector.capture.dataURL();
      const shown = probe.read();
      await inspector.capture.dataURL();
      return { hidden, shown, again: probe.read() };
    }, enabled);
    expect(result.hidden).toMatchObject({ lightDraws: 0, bounceDraws: 0 });
    expect(result.shown).toMatchObject({ lightDraws: 1, bounceDraws: 1 });
    expect(result.again).toMatchObject({ lightDraws: 1, bounceDraws: 1 });
  });
}
