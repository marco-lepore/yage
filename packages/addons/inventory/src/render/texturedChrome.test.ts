import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@yagejs/renderer", () => import("./rendererTestStubs.js"));

import { createMockScene } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { createInventoryPanel } from "../factory/createInventoryPanel.js";
import { menuSkin } from "./menuSkin.js";
import { defaultInventoryTheme } from "../factory/defaultTheme.js";
import type { MenuSkinRow, Rect } from "../adapter.js";
import type { NineSliceFrame } from "../factory/theme.js";
import {
  GraphicsComponent,
  NineSliceSprite,
  resetTextures,
  seedTexture,
  type DrawOp,
} from "./rendererTestStubs.js";

beforeEach(() => resetTextures());

const named = (scene: Scene, name: string) =>
  [...scene.getEntities()].filter((e) => !e.isDestroyed && e.name === name);
const fills = (ops: readonly DrawOp[]) => ops.filter((o) => o.op === "fill");
const childSprites = (scene: Scene, name: string): unknown[] =>
  named(scene, name)[0]?.get(GraphicsComponent).graphics.children ?? [];

const FRAME: NineSliceFrame = { texture: "frame.png", insets: { left: 8, top: 8, right: 8, bottom: 8 } };
const BOUNDS: Rect = { x: 0, y: 0, width: 300, height: 200 };

describe("InventoryChrome textured panel", () => {
  it("parents a stretched nine-slice and skips the drawn fill when textured", () => {
    seedTexture("frame.png");
    const theme = { ...defaultInventoryTheme(), textured: { panel: FRAME } };
    const { scene } = createMockScene();
    createInventoryPanel(theme, { bounds: BOUNDS }).chrome?.mount(scene);

    const sprites = childSprites(scene, "inv-chrome-frame-tex");
    expect(sprites).toHaveLength(1);
    expect(sprites[0]).toBeInstanceOf(NineSliceSprite);
    const sprite = sprites[0] as NineSliceSprite;
    expect([sprite.x, sprite.y, sprite.width, sprite.height]).toEqual([0, 0, 300, 200]);
    // The drawn frame skips its fill (the texture owns the background).
    const frameOps = named(scene, "inv-chrome-frame")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fills(frameOps)).toHaveLength(0);
  });

  it("draws the Graphics fill and spawns no texture host when omitted", () => {
    const { scene } = createMockScene();
    createInventoryPanel(defaultInventoryTheme(), { bounds: BOUNDS }).chrome?.mount(scene);

    expect(named(scene, "inv-chrome-frame-tex")).toHaveLength(0);
    const frameOps = named(scene, "inv-chrome-frame")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fills(frameOps).length).toBeGreaterThan(0);
  });
});

describe("menuSkin textured frame", () => {
  const MENU: Rect = { x: 96, y: 36, width: 68, height: 60 };
  const rows: MenuSkinRow[] = [{ label: "Use", rect: { x: 100, y: 40, width: 56, height: 21 } }];

  it("parents a stretched nine-slice and skips the drawn fill when textured", () => {
    seedTexture("frame.png");
    const theme = { ...defaultInventoryTheme(), textured: { menu: FRAME } };
    const { scene } = createMockScene();
    menuSkin(theme).renderMenu(scene, MENU, rows);

    const sprites = childSprites(scene, "inv-menu-frame");
    expect(sprites).toHaveLength(1);
    const sprite = sprites[0] as NineSliceSprite;
    expect([sprite.x, sprite.y, sprite.width, sprite.height]).toEqual([96, 36, 68, 60]);
    const frameOps = named(scene, "inv-menu-frame")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fills(frameOps)).toHaveLength(0);
  });

  it("draws the Graphics fill when omitted", () => {
    const { scene } = createMockScene();
    menuSkin(defaultInventoryTheme()).renderMenu(scene, MENU, rows);
    expect(childSprites(scene, "inv-menu-frame")).toHaveLength(0);
    const frameOps = named(scene, "inv-menu-frame")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fills(frameOps).length).toBeGreaterThan(0);
  });
});
