import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@yagejs/renderer", () => import("./rendererTestStubs.js"));

import { createMockScene } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { iconCell } from "./iconCell.js";
import { rowCell } from "./rowCell.js";
import { defaultInventoryTheme } from "../factory/defaultTheme.js";
import type { SlotView } from "../core/session.js";
import type { Rect } from "../adapter.js";
import {
  GraphicsComponent,
  SpriteComponent,
  TextComponent,
  resetTextures,
  seedTexture,
  type DrawOp,
} from "./rendererTestStubs.js";

beforeEach(() => resetTextures());

const RECT: Rect = { x: 0, y: 0, width: 56, height: 56 };

function occupied(opts: { name?: string; icon?: string; color?: number; quantity?: number } = {}): SlotView {
  return {
    slot: 0,
    stack: { itemId: "x", quantity: opts.quantity ?? 1 } as unknown as SlotView["stack"],
    def: {
      id: "x",
      name: opts.name ?? "Potion",
      ...(opts.icon !== undefined ? { icon: opts.icon } : {}),
      ...(opts.color !== undefined ? { color: opts.color } : {}),
    } as unknown as SlotView["def"],
  };
}
const empty: SlotView = { slot: 0, stack: null, def: null };

const named = (scene: Scene, name: string) =>
  [...scene.getEntities()].filter((e) => !e.isDestroyed && e.name === name);
const fillColors = (ops: readonly DrawOp[]): number[] =>
  ops.filter((o) => o.op === "fill").map((o) => (o.args[0] as { color: number }).color);
const strokeColors = (ops: readonly DrawOp[]): number[] =>
  ops.filter((o) => o.op === "stroke").map((o) => (o.args[0] as { color: number }).color);

describe("iconCell", () => {
  it("draws a background box for an empty slot, no content", () => {
    const { scene } = createMockScene();
    const cell = iconCell(defaultInventoryTheme());
    cell.renderCell(scene, empty, RECT, false);

    expect(named(scene, "inv-cell-bg")).toHaveLength(1);
    expect(named(scene, "inv-cell-letter")).toHaveLength(0);
    expect(named(scene, "inv-cell-icon")).toHaveLength(0);
    const ops = named(scene, "inv-cell-bg")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fillColors(ops)).toEqual([0x262643]); // just the cell background
  });

  it("draws a letter tile at the default color when the item has no icon", () => {
    const { scene } = createMockScene();
    iconCell(defaultInventoryTheme()).renderCell(scene, occupied({ name: "Potion" }), RECT, false);

    const letter = named(scene, "inv-cell-letter")[0]?.get(TextComponent);
    expect(letter?.options.text).toBe("P");
    expect(letter?.options.style.fill).toBe(0x1a1a2e); // default tileLetterColor
    // Background fill + tile fill (the tinted inset square).
    const ops = named(scene, "inv-cell-bg")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fillColors(ops)).toHaveLength(2);
  });

  it("honors a themed tileLetterColor", () => {
    const { scene } = createMockScene();
    const theme = { ...defaultInventoryTheme(), tileLetterColor: 0x445566 };
    iconCell(theme).renderCell(scene, occupied(), RECT, false);
    expect(named(scene, "inv-cell-letter")[0]?.get(TextComponent).options.style.fill).toBe(0x445566);
  });

  it("uses a sprite when the icon resolves", () => {
    seedTexture("sword.png");
    const { scene } = createMockScene();
    iconCell(defaultInventoryTheme()).renderCell(scene, occupied({ icon: "sword.png" }), RECT, false);
    expect(named(scene, "inv-cell-icon")).toHaveLength(1);
    expect(named(scene, "inv-cell-letter")).toHaveLength(0);
    expect(named(scene, "inv-cell-icon")[0]?.get(SpriteComponent).options.texture).toBeDefined();
  });

  it("warns once for an unresolvable icon and falls back to the tile", () => {
    const { scene } = createMockScene();
    const cell = iconCell(defaultInventoryTheme());
    const warnings: string[] = [];
    cell.setDiagnostics?.((m) => warnings.push(m));
    cell.renderCell(scene, occupied({ icon: "missing.png" }), RECT, false);
    cell.renderCell(createMockScene().scene, occupied({ icon: "missing.png" }), RECT, false);
    expect(warnings).toHaveLength(1); // cached after the first miss
    expect(named(scene, "inv-cell-letter")).toHaveLength(1); // fell back to the tile
  });

  it("draws a quantity badge only when the stack is > 1", () => {
    const a = createMockScene().scene;
    iconCell(defaultInventoryTheme()).renderCell(a, occupied({ quantity: 1 }), RECT, false);
    expect(named(a, "inv-cell-qty")).toHaveLength(0);

    const b = createMockScene().scene;
    iconCell(defaultInventoryTheme()).renderCell(b, occupied({ quantity: 7 }), RECT, false);
    expect(named(b, "inv-cell-qty")[0]?.get(TextComponent).options.text).toBe("7");
  });

  it("setSelected redraws the background without spawning entities", () => {
    const { scene } = createMockScene();
    const handle = iconCell(defaultInventoryTheme()).renderCell(scene, occupied(), RECT, false);
    const bg = named(scene, "inv-cell-bg")[0]?.get(GraphicsComponent);
    const before = [...scene.getEntities()].length;

    handle.setSelected(true);
    expect([...scene.getEntities()].length).toBe(before); // no churn
    expect(strokeColors(bg?.lastOps() ?? [])).toContain(0xffd866); // selection outline
    handle.setSelected(false);
    expect(strokeColors(bg?.lastOps() ?? [])).not.toContain(0xffd866);
  });

  it("dispose destroys every entity it spawned", () => {
    const { scene } = createMockScene();
    const handle = iconCell(defaultInventoryTheme()).renderCell(scene, occupied({ quantity: 3 }), RECT, false);
    expect([...scene.getEntities()].filter((e) => !e.isDestroyed)).not.toHaveLength(0);
    handle.dispose();
    expect([...scene.getEntities()].filter((e) => !e.isDestroyed)).toHaveLength(0);
  });
});

describe("rowCell", () => {
  it("draws a name and a right-aligned ×qty", () => {
    const { scene } = createMockScene();
    rowCell(defaultInventoryTheme()).renderCell(scene, occupied({ name: "Elixir", quantity: 4 }), RECT, false);
    expect(named(scene, "inv-row-name")[0]?.get(TextComponent).options.text).toBe("Elixir");
    expect(named(scene, "inv-row-qty")[0]?.get(TextComponent).options.text).toBe("×4");
  });

  it("an empty row draws only the bar (blank, still selectable)", () => {
    const { scene } = createMockScene();
    const handle = rowCell(defaultInventoryTheme()).renderCell(scene, empty, RECT, false);
    expect(named(scene, "inv-row-name")).toHaveLength(0);
    const bar = named(scene, "inv-row-bar")[0]?.get(GraphicsComponent);
    expect(fillColors(bar?.lastOps() ?? [])).toEqual([]); // unselected -> no fill
    handle.setSelected(true);
    expect(fillColors(bar?.lastOps() ?? [])).toEqual([0xffd866]); // bar appears on select
  });

  it("spawns the bar before the text (paints underneath)", () => {
    const { scene } = createMockScene();
    rowCell(defaultInventoryTheme()).renderCell(scene, occupied(), RECT, false);
    const order = [...scene.getEntities()].map((e) => e.name);
    expect(order.indexOf("inv-row-bar")).toBeLessThan(order.indexOf("inv-row-name"));
  });

  it("dispose destroys every entity it spawned", () => {
    const { scene } = createMockScene();
    const handle = rowCell(defaultInventoryTheme()).renderCell(scene, occupied({ quantity: 2 }), RECT, false);
    handle.dispose();
    expect([...scene.getEntities()].filter((e) => !e.isDestroyed)).toHaveLength(0);
  });
});
