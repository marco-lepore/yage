import { expect, test } from "@playwright/test";
import {
  getComponentData,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers";

interface ConsumeProbeData {
  fireDowns: number;
  fireUps: number;
  fireHeldThisFrame: boolean;
  pointerDowns: number;
  wheelUps: number;
  wheelDowns: number;
}

async function probe(page: Parameters<typeof gotoFixture>[0]) {
  return getComponentData<ConsumeProbeData>(page, "probe", "ConsumeProbe");
}

test.describe("Input UI auto-consume fixture", () => {
  test("frame deferral — DOM keydown only lands on the next drain", async ({
    page,
  }) => {
    await gotoFixture(page, "/input-ui-consume.html");
    await waitForClock(page);

    // Pre-step: nothing fired yet.
    const initial = await probe(page);
    expect(initial?.pointerDowns).toBe(0);

    // Synthetic dispatch is the canonical "before drain" path: the event
    // lands in the queue but no action edge has been applied. Stepping a
    // frame runs InputPollSystem and drains the buffer.
    await page.dispatchEvent("canvas", "pointerdown", { button: 0 });
    const queued = await probe(page);
    expect(queued?.pointerDowns).toBe(1); // listener fires sync at enqueue
    expect(queued?.fireDowns).toBe(0); // action edge deferred

    await stepFrames(page, 1);
    const drained = await probe(page);
    expect(drained?.fireDowns).toBe(1);

    // pointerup is attached on window (so releases outside the canvas still
    // get captured). Playwright doesn't expose a "window" locator, so go via
    // `evaluate`.
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { button: 0 }));
    });
    await stepFrames(page, 1);
    const released = await probe(page);
    expect(released?.fireUps).toBe(1);
  });

  test("UI panel auto-consumes — clicking it does not fire MouseLeft action", async ({
    page,
  }) => {
    await gotoFixture(page, "/input-ui-consume.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    const canvas = page.locator("canvas");

    // 1. Click on the default-consume UI panel (top-left, 0..100 × 0..60).
    //    The renderer's hitTestUI fallback auto-claims this pointer at drain
    //    time, suppressing the `fire` action edge.
    await canvas.click({ position: { x: 50, y: 30 } });
    await stepFrames(page, 1);
    const onUi = await probe(page);
    expect(onUi?.pointerDowns).toBe(1); // listener still fires
    expect(onUi?.fireDowns).toBe(0); // action edge suppressed

    // 2. Click on the play area (outside both panels). No UI under cursor,
    //    so the action edge propagates normally.
    await canvas.click({ position: { x: 160, y: 120 } });
    await stepFrames(page, 1);
    const offUi = await probe(page);
    expect(offUi?.pointerDowns).toBe(2);
    expect(offUi?.fireDowns).toBe(1);
  });

  test("`consumeInput: false` lets pointer events pass through to gameplay", async ({
    page,
  }) => {
    await gotoFixture(page, "/input-ui-consume.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    // The top-right panel was created with `consumeInput: false`. Hit-testing
    // walks past it and the action edge fires through.
    await page.locator("canvas").click({ position: { x: 270, y: 30 } });
    await stepFrames(page, 1);

    const data = await probe(page);
    expect(data?.pointerDowns).toBe(1);
    expect(data?.fireDowns).toBe(1);
  });

  test("drag-through-up — pointerdown on UI then up off UI suppresses both edges", async ({
    page,
  }) => {
    await gotoFixture(page, "/input-ui-consume.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas has no bounding box");

    // Press inside the default-consume panel. The pointer is auto-claimed
    // for the entire event cycle — even if the cursor leaves the panel
    // before release, the matching pointerup must NOT fire MouseLeft.
    await page.mouse.move(box.x + 50, box.y + 30);
    await page.mouse.down();
    await stepFrames(page, 1);

    await page.mouse.move(box.x + 200, box.y + 130);
    await stepFrames(page, 1);

    await page.mouse.up();
    await stepFrames(page, 1);

    const data = await probe(page);
    expect(data?.fireDowns).toBe(0);
    expect(data?.fireUps).toBe(0);
    expect(data?.fireHeldThisFrame).toBe(false);
  });

  test("scroll wheel emits one-frame WheelUp/WheelDown edges", async ({
    page,
  }) => {
    await gotoFixture(page, "/input-ui-consume.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas has no bounding box");
    await page.mouse.move(box.x + 160, box.y + 120);

    await page.mouse.wheel(0, -120); // scroll up (negative dy)
    await stepFrames(page, 1);
    let data = await probe(page);
    expect(data?.wheelUps).toBe(1);
    expect(data?.wheelDowns).toBe(0);

    await page.mouse.wheel(0, 120); // scroll down
    await stepFrames(page, 1);
    data = await probe(page);
    expect(data?.wheelUps).toBe(1);
    expect(data?.wheelDowns).toBe(1);
  });
});
