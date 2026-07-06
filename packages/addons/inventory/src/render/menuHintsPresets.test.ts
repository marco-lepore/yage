import { describe, it, expect, vi } from "vitest";

vi.mock("@yagejs/renderer", () => import("./rendererTestStubs.js"));

import { createMockScene } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { menuSkin } from "./menuSkin.js";
import { hints } from "./hints.js";
import { defaultInventoryTheme } from "../factory/defaultTheme.js";
import type { MenuSkinRow } from "../adapter.js";
import { GraphicsComponent, type DrawOp } from "./rendererTestStubs.js";

const named = (scene: Scene, name: string) =>
  [...scene.getEntities()].filter((e) => !e.isDestroyed && e.name === name);
const fills = (ops: readonly DrawOp[]): { color: number; alpha?: number }[] =>
  ops.filter((o) => o.op === "fill").map((o) => o.args[0] as { color: number; alpha?: number });

const rows = (labels: string[]): MenuSkinRow[] =>
  labels.map((label, i) => ({ label, rect: { x: 100, y: 40 + i * 21, width: 56, height: 21 } }));
const MENU_RECT = { x: 96, y: 36, width: 68, height: 60 };

describe("menuSkin (default action-menu renderer)", () => {
  it("draws a frame and one row entity per action", () => {
    const { scene } = createMockScene();
    menuSkin(defaultInventoryTheme()).renderMenu(scene, MENU_RECT, rows(["Use", "Drop"]));

    expect(named(scene, "inv-menu-frame")).toHaveLength(1);
    expect(named(scene, "inv-menu-bar")).toHaveLength(1);
    expect(named(scene, "inv-menu-row")).toHaveLength(2);
    const frameOps = named(scene, "inv-menu-frame")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fills(frameOps).map((f) => f.color)).toEqual([0x1a1a2e]); // frameColor
  });

  it("draws the highlight bar at the selected row's rect", () => {
    const { scene } = createMockScene();
    const handle = menuSkin(defaultInventoryTheme()).renderMenu(scene, MENU_RECT, rows(["Use", "Drop", "Examine"]));
    handle.highlight(2);

    const barOps = named(scene, "inv-menu-bar")[0]?.get(GraphicsComponent).lastOps() ?? [];
    const bar = barOps.find((o) => o.op === "roundRect");
    expect(bar?.args.slice(0, 2)).toEqual([100, 40 + 2 * 21]); // row 2's x,y
    expect(fills(barOps).map((f) => f.color)).toEqual([0x4a4a8a]); // actionHighlightColor
  });

  it("disposes every entity it spawned", () => {
    const { scene } = createMockScene();
    const handle = menuSkin(defaultInventoryTheme()).renderMenu(scene, MENU_RECT, rows(["Use", "Drop"]));
    handle.dispose();
    expect(named(scene, "inv-menu-frame")).toHaveLength(0);
    expect(named(scene, "inv-menu-bar")).toHaveLength(0);
    expect(named(scene, "inv-menu-row")).toHaveLength(0);
  });
});

describe("hints (default scroll-hint renderer)", () => {
  const WINDOW = { x: 100, y: 50, width: 120, height: 84 };

  it("draws both triangles when scrolled off top and bottom", () => {
    const { scene } = createMockScene();
    hints(defaultInventoryTheme()).render(scene, { up: true, down: true, window: WINDOW });
    const ops = named(scene, "inv-slots-hints")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fills(ops)).toHaveLength(2);
    expect(fills(ops)[0]).toEqual({ color: 0xffd866, alpha: 0.6 }); // highlightColor / hintAlpha
  });

  it("draws one triangle for a single direction and none when in view", () => {
    const { scene } = createMockScene();
    const preset = hints(defaultInventoryTheme());
    const handle = preset.render(scene, { up: true, down: false, window: WINDOW });
    const gfx = named(scene, "inv-slots-hints")[0]?.get(GraphicsComponent);
    expect(fills(gfx?.lastOps() ?? [])).toHaveLength(1);

    handle.update({ up: false, down: false, window: WINDOW });
    expect(fills(gfx?.lastOps() ?? [])).toHaveLength(0); // cleared, nothing scrolled out
  });

  it("toggles visibility and disposes its entity", () => {
    const { scene } = createMockScene();
    const handle = hints(defaultInventoryTheme()).render(scene, { up: true, down: true, window: WINDOW });
    const gfx = named(scene, "inv-slots-hints")[0]?.get(GraphicsComponent);
    handle.setVisible(false);
    expect(gfx?.graphics.visible).toBe(false);
    handle.dispose();
    expect(named(scene, "inv-slots-hints")).toHaveLength(0);
  });
});
