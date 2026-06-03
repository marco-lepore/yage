import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { SplitTextRenderFacet } from "@yagejs/renderer";
import { gotoFixture, stepFrames, waitForClock } from "./helpers.js";

type RenderFacet = SplitTextRenderFacet;

/**
 * Reads the SplitTextComponent render facet for the reveal label out of the
 * active scene snapshot — never touching live Pixi display objects. This is
 * the AGENTS.md "assert via the Inspector, not screenshots / Pixi internals"
 * path: per-glyph reveal state is observable purely from
 * `snapshotScene().entities[].render`.
 */
async function readReveal(
  page: Page,
): Promise<{ entity: RenderFacet | undefined; component: RenderFacet | undefined }> {
  return page.evaluate(() => {
    const inspector = window.__yage__?.inspector;
    if (!inspector) throw new Error("__yage__.inspector is not available.");
    // Resolve the active scene from the full snapshot rather than guessing ids.
    const scene = inspector
      .snapshot()
      .scenes.find((s) => s.name === "split-text-reveal-scene");
    const entity = scene?.entities.find((e) =>
      e.components.some((c) => c.type === "SplitTextComponent"),
    );
    const component = entity?.components.find(
      (c) => c.type === "SplitTextComponent",
    );
    return {
      entity: entity?.render as RenderFacet | undefined,
      component: component?.render as RenderFacet | undefined,
    };
  });
}

test.describe("Split text reveal fixture", () => {
  test("per-glyph reveal is observable through the inspector render facet", async ({
    page,
  }) => {
    await gotoFixture(page, "/split-text-reveal.html");
    await waitForClock(page);

    // Frame 0 ran onAdd (all glyphs hidden) but no update yet. Step three
    // frames to reveal the first three glyphs of "Hello world".
    await stepFrames(page, 3);

    const afterThree = await readReveal(page);

    // The facet is surfaced both at the entity level and on the component.
    expect(afterThree.entity).toBeDefined();
    expect(afterThree.component).toBeDefined();
    expect(afterThree.entity).toEqual(afterThree.component);

    // "Hello world" has 10 non-space glyphs; the space is dropped by SplitText.
    expect(afterThree.component?.glyphs).toHaveLength(10);
    const visibleCount = afterThree.component?.glyphs?.filter(
      (g) => g.visible,
    ).length;
    expect(visibleCount).toBe(3);
    expect(afterThree.component?.visibleText).toBe("Hel");

    // Bounds are present and non-empty for the laid-out (visible) glyphs.
    const bounds = afterThree.component?.bounds;
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);
    const widthAfterThree = bounds!.width;

    // Reveal the rest; the visible substring catches up to the full string.
    // SplitText.chars excludes whitespace (the space lives in `words`, not
    // `chars`), so the fully-revealed visibleText is "Helloworld", not
    // "Hello world". This is the documented behaviour of the facet.
    await stepFrames(page, 10);
    const afterAll = await readReveal(page);
    expect(afterAll.component?.glyphs?.every((g) => g.visible)).toBe(true);
    expect(afterAll.component?.visibleText).toBe("Helloworld");

    // The facet measures *painted* geometry, not the declared string: with the
    // remaining (monospace) glyphs now visible, the world-space box is wider
    // than it was at three glyphs. The pure coordinate-mapping math under
    // camera zoom / rotation is covered in renderFacet.test.ts.
    expect(afterAll.component!.bounds!.width).toBeGreaterThan(widthAfterThree);
  });
});
