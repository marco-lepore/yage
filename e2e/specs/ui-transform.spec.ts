import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames } from "./helpers.js";

interface ProbeData {
  spinClicks: number;
}

interface UiNode {
  id: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

interface PointerHit {
  path: Array<{ id: string; type: string }>;
  point: { x: number; y: number };
  consumed: boolean;
}

async function probe(page: Page): Promise<ProbeData | undefined> {
  return getComponentData<ProbeData>(page, "probe", "ClickProbe");
}

/** The one button the fixture builds. */
async function spinButton(page: Page): Promise<UiNode> {
  const found = await page.evaluate(() => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) throw new Error("__yage__.inspector is not available.");
    const flat: UiNode[] = [];
    const visit = (node: UiNode & { children: UiNode[] }): void => {
      if (node.type === "UIButton") {
        flat.push({ id: node.id, type: node.type, bounds: node.bounds });
      }
      for (const child of node.children) {
        visit(child as UiNode & { children: UiNode[] });
      }
    };
    for (const scene of inspector.snapshot().scenes) {
      if (scene.ui) {
        visit(scene.ui.root as unknown as UiNode & { children: UiNode[] });
      }
    }
    return flat;
  });
  expect(found).toHaveLength(1);
  return found[0] as UiNode;
}

function click(
  page: Page,
  target: string | { x: number; y: number },
): Promise<PointerHit> {
  return page.evaluate((aim) => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) throw new Error("__yage__.inspector is not available.");
    return inspector.pointer.click(aim) as unknown as PointerHit;
  }, target);
}

test.describe("UI element transform", () => {
  test("reports and clicks a scaled, rotated button where it is drawn", async ({
    page,
  }) => {
    await gotoFixture(page, "/ui-transform.html");
    await stepFrames(page, 1);
    const spin = await spinButton(page);

    // An 80 x 30 box turned an eighth covers (80 + 30) / √2 on both axes,
    // and 1.25 times that at its scale, around its centre (100, 75).
    const side = (110 / Math.SQRT2) * 1.25;
    expect(spin.bounds?.width).toBeCloseTo(side, 1);
    expect(spin.bounds?.height).toBeCloseTo(side, 1);
    expect(spin.bounds?.x).toBeCloseTo(100 - side / 2, 1);
    expect(spin.bounds?.y).toBeCloseTo(75 - side / 2, 1);

    const byId = await click(page, spin.id);
    expect(byId.point.x).toBeCloseTo(100, 1);
    expect(byId.point.y).toBeCloseTo(75, 1);
    expect(byId.path.map((node) => node.id)).toContain(spin.id);
    await stepFrames(page, 1);
    expect((await probe(page))?.spinClicks).toBe(1);

    // Below the layout box, which ends at y 90, but on the turned button.
    const outsideLayout = await click(page, { x: 100, y: 95 });
    expect(outsideLayout.path.map((node) => node.id)).toContain(spin.id);
    await stepFrames(page, 1);
    expect((await probe(page))?.spinClicks).toBe(2);
  });
});
