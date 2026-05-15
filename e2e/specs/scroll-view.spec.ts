import { expect, test, type Page } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames, waitForClock } from "./helpers";

interface ProbeData {
  offset: number;
  maxScroll: number;
  orderCount: number;
  footerX: number;
  footerY: number;
}

async function probe(page: Page): Promise<ProbeData> {
  const data = await getComponentData<ProbeData>(page, "ui-state", "ScrollProbe");
  if (!data) throw new Error("ScrollProbe data unavailable");
  return data;
}

test.describe("ScrollView fixture", () => {
  test("declarative list scrolls past the viewport while the footer stays fixed", async ({
    page,
  }) => {
    await gotoFixture(page, "/scroll-view.html");
    await waitForClock(page);
    await stepFrames(page, 2);

    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas has no bounding box");

    // 1. Content overflows the fixed-height viewport.
    const initial = await probe(page);
    expect(initial.orderCount).toBe(8);
    expect(initial.maxScroll).toBeGreaterThan(0);
    expect(initial.offset).toBe(0);
    const footerY0 = initial.footerY;

    // 2. Wheel over the list scrolls it; the sibling footer does not move.
    await page.mouse.move(box.x + 180, box.y + 90);
    await page.mouse.wheel(0, 300);
    await stepFrames(page, 2);

    const afterWheel = await probe(page);
    expect(afterWheel.offset).toBeGreaterThan(0);
    expect(afterWheel.offset).toBeLessThanOrEqual(afterWheel.maxScroll);
    expect(Math.abs(afterWheel.footerY - footerY0)).toBeLessThan(1);

    // 3. Drag-scrolling also pans content, still within clamp.
    await page.mouse.move(box.x + 180, box.y + 110);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 60, { steps: 6 });
    await page.mouse.up();
    await stepFrames(page, 2);

    const afterDrag = await probe(page);
    expect(afterDrag.offset).toBeGreaterThanOrEqual(0);
    expect(afterDrag.offset).toBeLessThanOrEqual(afterDrag.maxScroll);
    expect(Math.abs(afterDrag.footerY - footerY0)).toBeLessThan(1);

    // 4. A store-driven re-render (rebuild children on the same node, via
    //    the End Day button) preserves the scroll offset.
    const before = afterDrag.offset;
    expect(before).toBeGreaterThan(0);

    await canvas.click({
      position: {
        x: Math.round(afterDrag.footerX + 10),
        y: Math.round(afterDrag.footerY + 10),
      },
    });
    await stepFrames(page, 2);

    const afterRefill = await probe(page);
    expect(afterRefill.orderCount).toBe(8);
    expect(Math.abs(afterRefill.footerY - footerY0)).toBeLessThan(1);
    // Same instance → offset retained (clamped to the unchanged max).
    expect(Math.abs(afterRefill.offset - before)).toBeLessThanOrEqual(1);
  });
});
