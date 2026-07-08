import { describe, expect, it } from "vitest";
import { DETAIL_GAP, HEADER_GAP, PanelLayout } from "./PanelLayout.js";

function make(over: Partial<ConstructorParameters<typeof PanelLayout>[0]> = {}): PanelLayout {
  return new PanelLayout({
    width: 400,
    height: 300,
    padding: 16,
    headerHeight: 20,
    detailHeight: 60,
    ...over,
  });
}

describe("PanelLayout", () => {
  it("centers the panel in the viewport and carves the bands", () => {
    const layout = make();
    layout.setViewport(800, 600);
    expect(layout.panelRect()).toEqual({ x: 200, y: 150, width: 400, height: 300 });
    const content = layout.contentRect();
    expect(content.y).toBe(150 + 16 + 20 + HEADER_GAP);
    expect(content.height).toBe(300 - 2 * 16 - (20 + HEADER_GAP) - (60 + DETAIL_GAP));
    expect(layout.detailRect().height).toBe(60);
  });

  it("explicit bounds pin the panel regardless of viewport", () => {
    const layout = make({ bounds: { x: 10, y: 20, width: 200, height: 150 } });
    layout.setViewport(800, 600);
    expect(layout.panelRect()).toEqual({ x: 10, y: 20, width: 200, height: 150 });
  });

  it("zero-height bands carve nothing", () => {
    const layout = make({ headerHeight: 0, detailHeight: 0 });
    layout.setViewport(800, 600);
    const panel = layout.panelRect();
    const content = layout.contentRect();
    expect(content.y).toBe(panel.y + 16);
    expect(content.height).toBe(panel.height - 32);
  });

  it("onChange fires on viewport rebinds and stops after unsubscribe", () => {
    const layout = make();
    let fired = 0;
    const unsub = layout.onChange(() => fired++);
    layout.setViewport(1024, 768);
    expect(fired).toBe(1);
    layout.setViewport(1024, 768); // unchanged — no notify
    expect(fired).toBe(1);
    unsub();
    layout.setViewport(640, 480);
    expect(fired).toBe(1); // a disposed view is never re-placed
  });
});
