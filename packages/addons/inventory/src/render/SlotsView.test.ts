import { describe, it, expect, vi } from "vitest";

vi.mock("@yagejs/renderer", () => import("./rendererTestStubs.js"));

import { createMockScene } from "@yagejs/core";
import { SlotsView, type SlotsViewConfig } from "./SlotsView.js";
import { hints } from "./hints.js";
import { PanelLayout } from "./PanelLayout.js";
import { GraphicsComponent } from "./rendererTestStubs.js";
import { defaultInventoryTheme } from "../factory/defaultTheme.js";
import type { CellDefaults, CellHandle, CellPresenter, DiagnosticSink, Rect } from "../adapter.js";
import type { SlotView } from "../core/session.js";

/** A recording cell presenter — the view's collaborator under test. */
class FakeCell implements CellPresenter {
  readonly defaults: CellDefaults = {
    columns: 3,
    visibleRows: 2,
    cellWidth: 40,
    cellHeight: 40,
    gapX: 4,
    gapY: 4,
  };
  readonly renders: Array<{ slot: number; selected: boolean; empty: boolean; rect: Rect }> = [];
  readonly selects: Array<{ slot: number; selected: boolean }> = [];
  readonly disposed: number[] = [];
  live = 0;
  warn: DiagnosticSink | undefined;

  setDiagnostics(warn: DiagnosticSink): void {
    this.warn = warn;
  }

  renderCell(_scene: unknown, view: SlotView, rect: Rect, selected: boolean): CellHandle {
    this.renders.push({ slot: view.slot, selected, empty: view.stack === null, rect });
    this.live++;
    const slot = view.slot;
    return {
      setSelected: (s: boolean): void => {
        this.selects.push({ slot, selected: s });
      },
      setVisible: (): void => {},
      dispose: (): void => {
        this.live--;
        this.disposed.push(slot);
      },
    };
  }
}

function slotViews(count: number, emptyAt: readonly number[] = []): SlotView[] {
  return Array.from({ length: count }, (_, i) => {
    const filled = !emptyAt.includes(i);
    return {
      slot: i,
      stack: filled ? ({ itemId: "x", quantity: 1 } as unknown as SlotView["stack"]) : null,
      def: filled ? ({ id: "x", name: "X" } as unknown as SlotView["def"]) : null,
    };
  });
}

/** A 200×200 bounds-pinned panel with no bands → content rect {10,10,180,180}. */
function makeView(cfgOverride: Partial<SlotsViewConfig> = {}): {
  view: SlotsView;
  cell: FakeCell;
  layout: PanelLayout;
} {
  const layout = new PanelLayout({
    width: 200,
    height: 200,
    padding: 10,
    headerHeight: 0,
    detailHeight: 0,
    bounds: { x: 0, y: 0, width: 200, height: 200 },
  });
  const cell = new FakeCell();
  const cfg: SlotsViewConfig = {
    columns: 3,
    visibleRows: 2,
    cellWidth: 40,
    cellHeight: 40,
    gapX: 4,
    gapY: 4,
    layerContent: "content",
    ...cfgOverride,
  };
  return { view: new SlotsView(cfg, cell, hints(defaultInventoryTheme()), layout), cell, layout };
}

describe("SlotsView present / rebuild", () => {
  it("renders one cell per windowed slot, including empty ones", () => {
    const { view, cell } = makeView();
    const { scene } = createMockScene();
    view.mount(scene);
    view.present(slotViews(8, [2])); // 8 slots, slot 2 empty

    // 3 cols × 2 visible rows -> the first 6 slots are windowed.
    expect(cell.renders).toHaveLength(6);
    expect(cell.renders.map((r) => r.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    // Slot 2 is empty but still rendered (blank, selectable cell).
    expect(cell.renders.find((r) => r.slot === 2)?.empty).toBe(true);
    // Origin centers the 128×84 window in the 180×180 content rect.
    expect(cell.renders[0]?.rect).toEqual({ x: 36, y: 58, width: 40, height: 40 });
  });
});

describe("SlotsView selection", () => {
  it("moving within the window redraws two cells, spawns none", () => {
    const { view, cell } = makeView();
    const { scene } = createMockScene();
    view.mount(scene);
    view.present(slotViews(8));
    const spawned = cell.renders.length;

    view.setSelected(1); // still in row 0 -> cheap path
    expect(cell.renders).toHaveLength(spawned); // no respawn
    expect(cell.selects).toEqual([
      { slot: 0, selected: false },
      { slot: 1, selected: true },
    ]);
  });

  it("moving out of the window re-windows (dispose + respawn)", () => {
    const { view, cell } = makeView();
    const { scene } = createMockScene();
    view.mount(scene);
    view.present(slotViews(8));
    const spawned = cell.renders.length; // 6
    cell.selects.length = 0;

    view.setSelected(7); // row 2 -> scrolls; window moves
    expect(cell.disposed).toHaveLength(6); // all prior cells disposed
    // Rows 1..2 now visible: slots 3,4,5,6,7.
    expect(cell.renders.slice(spawned).map((r) => r.slot)).toEqual([3, 4, 5, 6, 7]);
    expect(cell.selects).toEqual([]); // re-window, not the cheap path
  });
});

describe("SlotsView geometry seams", () => {
  it("slotAtPoint hits cells and misses gaps", () => {
    const { view } = makeView();
    const { scene } = createMockScene();
    view.mount(scene);
    view.present(slotViews(8));
    // Cell 0 occupies x[36,76) y[58,98); the x-gap is [76,80).
    expect(view.slotAtPoint(50, 68)).toBe(0);
    expect(view.slotAtPoint(78, 68)).toBeUndefined(); // in the column gap
  });

  it("selectionAnchor returns the selected rect, or undefined when scrolled out", () => {
    const { view } = makeView();
    const { scene } = createMockScene();
    view.mount(scene);
    view.present(slotViews(8));
    expect(view.selectionAnchor()).toEqual({ x: 36, y: 58, width: 40, height: 40 });

    view.setSelected(7);
    view.present(slotViews(3)); // selection (7) now beyond the slots
    expect(view.selectionAnchor()).toBeUndefined();
  });

  it("navigate delegates to the unified geometry (down = +columns)", () => {
    const { view } = makeView();
    const { scene } = createMockScene();
    view.mount(scene);
    view.present(slotViews(8));
    expect(view.navigate(1, "down")).toBe(4); // +columns
    expect(view.navigate(1, "right")).toBe(2); // +1 within row
  });
});

describe("SlotsView lifecycle + diagnostics", () => {
  it("emits factory mount warnings through the sink at mount", () => {
    const { view } = makeView({ mountWarnings: ["overdetermined-x"] });
    const { scene } = createMockScene();
    const messages: string[] = [];
    view.setDiagnostics((m) => messages.push(m));
    view.mount(scene);
    expect(messages).toContain("overdetermined-x");
  });

  it("warns when the window overflows a too-small content rect", () => {
    // 5 columns of 40px + gaps = 216px window in a 180px content rect.
    const { view } = makeView({ columns: 5 });
    const { scene } = createMockScene();
    const messages: string[] = [];
    view.setDiagnostics((m) => messages.push(m));
    view.mount(scene);
    expect(messages.some((m) => m.includes("overflows its panel content area"))).toBe(true);
  });

  it("clear/dispose disposes every cell and the hints entity", () => {
    const { view, cell } = makeView();
    const { scene } = createMockScene();
    const liveHints = (): number =>
      [...scene.getEntities()].filter((e) => !e.isDestroyed && e.name === "inv-slots-hints").length;

    view.mount(scene);
    expect(liveHints()).toBe(1);
    view.present(slotViews(8));
    expect(cell.live).toBe(6);

    view.clear();
    expect(cell.live).toBe(0); // cells gone
    expect(liveHints()).toBe(1); // hints entity survives clear

    view.dispose();
    expect(liveHints()).toBe(0); // and is destroyed on dispose
  });

  it("setVisible toggles the hints graphics", () => {
    const { view } = makeView();
    const { scene } = createMockScene();
    view.mount(scene);
    view.present(slotViews(8));
    const hints = [...scene.getEntities()].find((e) => e.name === "inv-slots-hints");
    const gfx = hints?.get(GraphicsComponent);
    view.setVisible(false);
    expect(gfx?.graphics.visible).toBe(false);
    view.setVisible(true);
    expect(gfx?.graphics.visible).toBe(true);
  });
});
