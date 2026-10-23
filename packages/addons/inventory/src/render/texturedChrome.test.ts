import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@yagejs/renderer", () => import("./rendererTestStubs.js"));

import { createMockScene, Transform } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { createInventoryPanel } from "../factory/createInventoryPanel.js";
import { menuSkin } from "./menuSkin.js";
import { defaultInventoryTheme } from "../factory/defaultTheme.js";
import type { MenuSkinRow, Rect } from "../adapter.js";
import type { NineSliceFrame } from "../factory/theme.js";
import {
  GraphicsComponent,
  NineSliceComponent,
  resetTextures,
  seedTexture,
  type DrawOp,
} from "./rendererTestStubs.js";

beforeEach(() => resetTextures());

const named = (scene: Scene, name: string) =>
  [...scene.getEntities()].filter((e) => !e.isDestroyed && e.name === name);
const fills = (ops: readonly DrawOp[]) => ops.filter((o) => o.op === "fill");
/** The nine-slice frame on the named entity, as [x, y, width, height]. */
const frameBox = (scene: Scene, name: string): number[] | undefined => {
  const entity = named(scene, name)[0];
  const slice = entity?.tryGet(NineSliceComponent);
  if (!entity || !slice) return undefined;
  const { x, y } = entity.get(Transform).position;
  return [x, y, slice.width, slice.height];
};

const FRAME: NineSliceFrame = {
  texture: "frame.png",
  insets: { left: 8, top: 8, right: 8, bottom: 8 },
};
const BOUNDS: Rect = { x: 0, y: 0, width: 300, height: 200 };

describe("InventoryChrome textured panel", () => {
  it("stretches a nine-slice frame and skips the drawn fill when textured", () => {
    seedTexture("frame.png");
    const theme = { ...defaultInventoryTheme(), textured: { panel: FRAME } };
    const { scene } = createMockScene();
    createInventoryPanel(theme, { bounds: BOUNDS }).chrome?.mount(scene);

    expect(frameBox(scene, "inv-chrome-frame-tex")).toEqual([0, 0, 300, 200]);
    // The drawn frame skips its fill (the texture owns the background).
    const frameOps =
      named(scene, "inv-chrome-frame")[0]?.get(GraphicsComponent).lastOps() ??
      [];
    expect(fills(frameOps)).toHaveLength(0);
  });

  it("draws the Graphics fill and spawns no texture host when omitted", () => {
    const { scene } = createMockScene();
    createInventoryPanel(defaultInventoryTheme(), {
      bounds: BOUNDS,
    }).chrome?.mount(scene);

    expect(named(scene, "inv-chrome-frame-tex")).toHaveLength(0);
    const frameOps =
      named(scene, "inv-chrome-frame")[0]?.get(GraphicsComponent).lastOps() ??
      [];
    expect(fills(frameOps).length).toBeGreaterThan(0);
  });
});

describe("menuSkin textured frame", () => {
  const MENU: Rect = { x: 96, y: 36, width: 68, height: 60 };
  const rows: MenuSkinRow[] = [
    { label: "Use", rect: { x: 100, y: 40, width: 56, height: 21 } },
  ];

  it("stretches a nine-slice frame in place of the drawn one when textured", () => {
    seedTexture("frame.png");
    const theme = { ...defaultInventoryTheme(), textured: { menu: FRAME } };
    const { scene } = createMockScene();
    menuSkin(theme).renderMenu(scene, MENU, rows);

    expect(frameBox(scene, "inv-menu-frame")).toEqual([96, 36, 68, 60]);
    expect(named(scene, "inv-menu-frame")[0]?.tryGet(GraphicsComponent)).toBe(
      undefined,
    );
  });

  it("draws the Graphics fill when omitted", () => {
    const { scene } = createMockScene();
    menuSkin(defaultInventoryTheme()).renderMenu(scene, MENU, rows);
    expect(frameBox(scene, "inv-menu-frame")).toBeUndefined();
    const frameOps =
      named(scene, "inv-menu-frame")[0]?.get(GraphicsComponent).lastOps() ?? [];
    expect(fills(frameOps).length).toBeGreaterThan(0);
  });
});
