import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames } from "./helpers.js";

interface ProbeData {
  plainClicks: number;
  disabledClicks: number;
  coveredClicks: number;
  fireDowns: number;
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

/** The innermost node a hit reached, or undefined when it reached none. */
function innermost(hit: PointerHit): { id: string; type: string } | undefined {
  return hit.path[0];
}

/** The id of the surface node a child id sits under. */
function parentId(id: string): string {
  return id.slice(0, id.lastIndexOf("/"));
}

async function probe(page: Page): Promise<ProbeData | undefined> {
  return getComponentData<ProbeData>(page, "probe", "ClickProbe");
}

/** Every user-interface node in the snapshot, flattened in tree order. */
async function uiNodes(page: Page): Promise<UiNode[]> {
  return page.evaluate(() => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) throw new Error("__yage__.inspector is not available.");
    const flat: UiNode[] = [];
    const visit = (node: UiNode & { children: UiNode[] }): void => {
      flat.push({ id: node.id, type: node.type, bounds: node.bounds });
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
}

/** The three buttons the fixture spawns, in the order it spawns them. */
async function buttons(page: Page): Promise<{
  nodes: UiNode[];
  plain: UiNode;
  disabled: UiNode;
  covered: UiNode;
}> {
  const nodes = await uiNodes(page);
  const found = nodes.filter((node) => node.type === "UIButton");
  expect(found).toHaveLength(3);
  const [plain, disabled, covered] = found as [UiNode, UiNode, UiNode];
  // Spawn order is also screen order: top-left, top-right, bottom-left.
  expect(plain.bounds?.x).toBeLessThan(disabled.bounds?.x ?? 0);
  expect(covered.bounds?.y).toBeGreaterThan(plain.bounds?.y ?? 0);
  return { nodes, plain, disabled, covered };
}

/** One half of a click, so a test can assert between the two. */
function pointerHalf(
  page: Page,
  half: "down" | "up",
  target: string | { x: number; y: number },
): Promise<PointerHit> {
  return page.evaluate(
    ([which, aim]) => {
      const inspector = window.__yage__?.inspector;
      if (!inspector) throw new Error("__yage__.inspector is not available.");
      return inspector.pointer[which as "down" | "up"](
        aim as string | { x: number; y: number },
      ) as unknown as PointerHit;
    },
    [half, target] as [string, string | { x: number; y: number }],
  );
}

/** The action names the engine currently reads as held. */
function heldActions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) throw new Error("__yage__.inspector is not available.");
    return inspector.getInputState().actions;
  });
}

function pointerClick(
  page: Page,
  target: string | { x: number; y: number },
): Promise<PointerHit> {
  return page.evaluate((aim) => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) throw new Error("__yage__.inspector is not available.");
    return inspector.pointer.click(aim) as unknown as PointerHit;
  }, target);
}

test.describe("Inspector pointer verbs", () => {
  test("clicking a button by snapshot id runs its onClick", async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-pointer.html");
    await stepFrames(page, 1);
    const { plain } = await buttons(page);

    const hit = await pointerClick(page, plain.id);

    // The label is a node of its own and sits on top, so the button is the
    // second link of the chain rather than the innermost hit.
    expect(hit.path.map((node) => node.id)).toContain(plain.id);
    expect(hit.path.map((node) => node.type)).toContain("UIButton");
    expect(hit.consumed).toBe(true);
    // The handler has already run: the renderer delivers synchronously, so
    // no frame is stepped between the click and this read.
    expect((await probe(page))?.plainClicks).toBe(1);
  });

  test("hitTest reports the same node without dispatching", async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-pointer.html");
    await stepFrames(page, 1);
    const { plain } = await buttons(page);

    const hit = await page.evaluate((id) => {
      const inspector = window.__yage__?.inspector;
      if (!inspector) throw new Error("__yage__.inspector is not available.");
      return inspector.pointer.hitTest(id) as unknown as PointerHit;
    }, plain.id);

    expect(hit.path.map((node) => node.id)).toContain(plain.id);
    expect((await probe(page))?.plainClicks).toBe(0);
  });

  test("a disabled button takes no click and the panel behind it is reported", async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-pointer.html");
    await stepFrames(page, 1);
    const { disabled } = await buttons(page);

    const hit = await pointerClick(page, disabled.id);

    expect(innermost(hit)?.id).toBe(parentId(disabled.id));
    expect(innermost(hit)?.type).toBe("UIPanel");
    expect(hit.path.map((node) => node.id)).not.toContain(disabled.id);
    expect((await probe(page))?.disabledClicks).toBe(0);
  });

  test("an overlay over a button takes the click", async ({ page }) => {
    await gotoFixture(page, "/inspector-pointer.html");
    await stepFrames(page, 1);
    const { nodes, covered } = await buttons(page);
    // The overlay is the button's sibling inside the same surface.
    const surface = parentId(covered.id);
    const overlay = nodes.find(
      (node) =>
        node.type === "UIPanel" &&
        node.id.startsWith(`${surface}/`) &&
        node.id !== covered.id,
    );
    if (!overlay) throw new Error("the fixture spawned no overlay panel");

    const hit = await pointerClick(page, covered.id);

    expect(innermost(hit)?.id).toBe(overlay.id);
    expect(innermost(hit)?.type).toBe("UIPanel");
    expect(hit.path.map((node) => node.id)).not.toContain(covered.id);
    expect((await probe(page))?.coveredClicks).toBe(0);
  });

  test("clicks land on the right element on a letterboxed canvas", async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-pointer.html?letterbox=1");
    await stepFrames(page, 1);

    // A 400 x 300 host for a 320 x 180 virtual space: the fit scales up and
    // leaves bars, so canvas pixels and virtual pixels differ on both axes.
    const box = await page.locator("canvas").boundingBox();
    expect(box?.width).toBeGreaterThan(320);
    expect(box?.height).toBeGreaterThan(180);

    const { plain, disabled } = await buttons(page);

    const hitPlain = await pointerClick(page, plain.id);
    expect(hitPlain.path.map((node) => node.id)).toContain(plain.id);
    expect((await probe(page))?.plainClicks).toBe(1);

    // The off-centre button too: a constant offset would still hit the first.
    const hit = await pointerClick(page, disabled.id);
    expect(innermost(hit)?.type).toBe("UIPanel");
    expect((await probe(page))?.disabledClicks).toBe(0);
  });

  test("engine input state lags the press and the release by one frame", async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-pointer.html");
    await stepFrames(page, 1);

    // The middle of the play area, clear of all three surfaces.
    const hit = await pointerHalf(page, "down", { x: 160, y: 90 });

    expect(hit.path).toEqual([]);
    expect(hit.consumed).toBe(false);
    // Nothing has drained yet, so the action edge has not been applied.
    expect((await probe(page))?.fireDowns).toBe(0);
    expect(await heldActions(page)).not.toContain("fire");

    await stepFrames(page, 1);
    expect((await probe(page))?.fireDowns).toBe(1);
    expect(await heldActions(page)).toContain("fire");

    // The release travels the same way: the engine's own listener takes it,
    // and the next drain applies it.
    await pointerHalf(page, "up", { x: 160, y: 90 });
    expect(await heldActions(page)).toContain("fire");

    await stepFrames(page, 1);
    expect(await heldActions(page)).not.toContain("fire");
  });

  test("a click on a button raises no gameplay action edge", async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-pointer.html");
    await stepFrames(page, 1);
    const { plain } = await buttons(page);

    await pointerClick(page, plain.id);
    await stepFrames(page, 1);

    const data = await probe(page);
    expect(data?.plainClicks).toBe(1);
    expect(data?.fireDowns).toBe(0);
  });

  test("clicking before the first rendered frame throws", async ({ page }) => {
    // `startFrozen` stops the renderer's ticker, but only once the debug
    // plugin installs: the ticker auto-starts inside the renderer's own
    // startup and can draw one frame before then. Holding back animation
    // frames for the whole page is what keeps this at zero rendered frames
    // every run. Nothing in this test steps, so nothing needs them.
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await gotoFixture(page, "/inspector-pointer.html?frozen=1");

    await expect(
      page.evaluate(() => {
        const inspector = window.__yage__?.inspector;
        if (!inspector) throw new Error("__yage__.inspector is not available.");
        inspector.pointer.click({ x: 10, y: 10 });
      }),
    ).rejects.toThrow(/needs a rendered frame/);
  });
});
