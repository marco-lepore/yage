import { expect, test, type Page } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames, waitForClock } from "./helpers";

interface ProbeData {
  offset: number;
  maxScroll: number;
  orderCount: number;
  scrollBtnX: number;
  scrollBtnY: number;
  endX: number;
  endY: number;
}

// Control buttons are CTRL_W x CTRL_H in the fixture; click their centers.
const CTRL_W = 110;
const CTRL_H = 32;

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

    const clickScroll = async (p: ProbeData) =>
      canvas.click({
        position: {
          x: Math.round(p.scrollBtnX + CTRL_W / 2),
          y: Math.round(p.scrollBtnY + CTRL_H / 2),
        },
      });
    const clickEnd = async (p: ProbeData) =>
      canvas.click({
        position: {
          x: Math.round(p.endX + CTRL_W / 2),
          y: Math.round(p.endY + CTRL_H / 2),
        },
      });

    // 1. Content overflows the fixed-height viewport.
    const initial = await probe(page);
    expect(initial.orderCount).toBe(8);
    expect(
      initial.maxScroll,
      `content should overflow viewport: ${JSON.stringify(initial)}`,
    ).toBeGreaterThan(0);
    expect(initial.offset).toBe(0);
    const scrollBtnY0 = initial.scrollBtnY;
    const endY0 = initial.endY;

    // 2. Scrolling (public API via the control button) pans the list; the
    //    sibling control/footer buttons do not move.
    await clickScroll(initial);
    await stepFrames(page, 2);

    const afterScroll = await probe(page);
    expect(afterScroll.offset).toBeGreaterThan(0);
    expect(afterScroll.offset).toBeLessThanOrEqual(afterScroll.maxScroll);
    expect(Math.abs(afterScroll.scrollBtnY - scrollBtnY0)).toBeLessThan(1);
    expect(Math.abs(afterScroll.endY - endY0)).toBeLessThan(1);

    // 3. Scrolling past the end clamps to maxScroll (never overshoots).
    for (let i = 0; i < 8; i++) {
      await clickScroll(await probe(page));
      await stepFrames(page, 1);
    }
    const clamped = await probe(page);
    expect(Math.abs(clamped.offset - clamped.maxScroll)).toBeLessThan(0.5);
    expect(Math.abs(clamped.scrollBtnY - scrollBtnY0)).toBeLessThan(1);

    // 4. A store-driven re-render (rebuild children on the same node, via
    //    the End Day button) preserves the scroll offset.
    const before = clamped.offset;
    expect(before).toBeGreaterThan(0);

    await clickEnd(clamped);
    await stepFrames(page, 2);

    const afterRefill = await probe(page);
    expect(afterRefill.orderCount).toBe(8);
    expect(Math.abs(afterRefill.endY - endY0)).toBeLessThan(1);
    // Same instance, same content height → offset retained (clamped).
    expect(Math.abs(afterRefill.offset - before)).toBeLessThanOrEqual(1);
  });
});
