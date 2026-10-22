import { expect, test, type Page } from "@playwright/test";
import {
  getComponentData,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers.js";

interface ProbeData {
  offset: number;
  maxScroll: number;
  orderCount: number;
  orderClicks: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen boxes of the first order row and the two control buttons. */
interface Boxes {
  row: Box;
  scroll: Box;
  end: Box;
}

// Control buttons are CTRL_W x CTRL_H in the fixture; click their centers.
const CTRL_W = 110;
const CTRL_H = 32;

async function probe(page: Page): Promise<ProbeData> {
  const data = await getComponentData<ProbeData>(
    page,
    "ui-state",
    "ScrollProbe",
  );
  if (!data) throw new Error("ScrollProbe data unavailable");
  return data;
}

/**
 * Read the boxes from the Inspector's UI snapshot. The surface's root panel
 * holds the scroll view, the control row and the End Day button, in that
 * order. The fixture's virtual size equals its canvas size, so the boxes are
 * canvas pixels.
 */
async function boxes(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const scene = window.__yage__!.inspector.snapshot().scenes.at(-1);
    const root = scene?.ui?.root;
    const [list, controls, end] = root?.children ?? [];
    const row = list?.children[0]?.bounds;
    const scroll = controls?.children[0]?.bounds;
    const endBox = end?.bounds;
    if (list?.type !== "UIScrollView" || !row || !scroll || !endBox) {
      throw new Error(`unexpected UI tree: ${JSON.stringify(root)}`);
    }
    return { row, scroll, end: endBox };
  });
}

test.describe("ScrollView fixture", () => {
  test("dragging the button list scrolls without clicking a row", async ({
    page,
  }) => {
    await gotoFixture(page, "/scroll-view.html");
    await waitForClock(page);
    // Pointer dispatch needs a drawn frame, and the fixture can freeze
    // before drawing one.
    await stepFrames(page, 2, { render: "last" });
    const { row } = await boxes(page);
    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas has no bounding box");

    await page.mouse.move(box.x + row.x + 110, box.y + row.y + 18);
    await page.mouse.down();
    await page.mouse.move(box.x + row.x + 110, box.y + row.y - 32, {
      steps: 5,
    });
    await page.mouse.up();
    await stepFrames(page, 2);

    const afterDrag = await probe(page);
    expect(afterDrag.offset).toBeGreaterThan(10);
    expect(afterDrag.orderClicks).toBe(0);
  });

  test("declarative list scrolls past the viewport while the footer stays fixed", async ({
    page,
  }) => {
    await gotoFixture(page, "/scroll-view.html");
    await waitForClock(page);
    await stepFrames(page, 2, { render: "last" });

    const canvas = page.locator("canvas");

    const clickAt = async (target: Box) =>
      canvas.click({
        position: {
          x: Math.round(target.x + CTRL_W / 2),
          y: Math.round(target.y + CTRL_H / 2),
        },
      });
    const clickScroll = async () => clickAt((await boxes(page)).scroll);
    const clickEnd = async () => clickAt((await boxes(page)).end);

    // 1. Content overflows the fixed-height viewport.
    const initial = await probe(page);
    expect(initial.orderCount).toBe(8);
    expect(
      initial.maxScroll,
      `content should overflow viewport: ${JSON.stringify(initial)}`,
    ).toBeGreaterThan(0);
    expect(initial.offset).toBe(0);
    const initialBoxes = await boxes(page);
    const scrollBtnY0 = initialBoxes.scroll.y;
    const endY0 = initialBoxes.end.y;

    // 2. Scrolling (public API via the control button) pans the list; the
    //    sibling control/footer buttons do not move.
    await clickScroll();
    await stepFrames(page, 2);

    const afterScroll = await probe(page);
    const afterScrollBoxes = await boxes(page);
    expect(afterScroll.offset).toBeGreaterThan(0);
    expect(afterScroll.offset).toBeLessThanOrEqual(afterScroll.maxScroll);
    expect(Math.abs(afterScrollBoxes.scroll.y - scrollBtnY0)).toBeLessThan(1);
    expect(Math.abs(afterScrollBoxes.end.y - endY0)).toBeLessThan(1);

    // 3. Scrolling past the end clamps to maxScroll (never overshoots).
    for (let i = 0; i < 8; i++) {
      await clickScroll();
      await stepFrames(page, 1);
    }
    const clamped = await probe(page);
    expect(Math.abs(clamped.offset - clamped.maxScroll)).toBeLessThan(0.5);
    expect(Math.abs((await boxes(page)).scroll.y - scrollBtnY0)).toBeLessThan(
      1,
    );

    // 4. A store-driven re-render (rebuild children on the same node, via
    //    the End Day button) preserves the scroll offset.
    const before = clamped.offset;
    expect(before).toBeGreaterThan(0);

    await clickEnd();
    await stepFrames(page, 2);

    const afterRefill = await probe(page);
    expect(afterRefill.orderCount).toBe(8);
    expect(Math.abs((await boxes(page)).end.y - endY0)).toBeLessThan(1);
    // Same instance, same content height → offset retained (clamped).
    expect(Math.abs(afterRefill.offset - before)).toBeLessThanOrEqual(1);
  });
});
