import { describe, expect, it, vi } from "vitest";
vi.mock("@yagejs/renderer", () => import("./rendererTestStubs.js"));
import { createMockScene } from "@yagejs/core";
import { SceneRenderTreeProviderKey } from "@yagejs/renderer";
import type { LayerDef, SceneRenderTreeProvider } from "@yagejs/renderer";
import { createInventoryPanel } from "../factory/createInventoryPanel.js";
import { defaultInventoryTheme } from "../factory/defaultTheme.js";
import { menuSkin } from "./menuSkin.js";

describe("inventory presenter layers", () => {
  it("provisions custom layers for standalone presenters and disposes their visuals", () => {
    const { scene, context } = createMockScene();
    const defs = new Map<string, LayerDef>();
    const ensureLayer = vi.fn((def: LayerDef) => {
      defs.set(def.name, def);
    });
    context.register(SceneRenderTreeProviderKey, {
      getTree: () => ({ ensureLayer }),
    } as unknown as SceneRenderTreeProvider);
    const theme = {
      ...defaultInventoryTheme(),
      layerPanel: "my-panel",
      layerContent: "my-content",
      layerOverlay: "my-menu",
    };
    const bundle = createInventoryPanel(theme, {
      bounds: { x: 0, y: 0, width: 300, height: 200 },
    });
    bundle.chrome?.mount(scene);
    bundle.slots.mount(scene);
    bundle.detail?.mount(scene);
    const skin = menuSkin(theme).renderMenu(
      scene,
      { x: 0, y: 0, width: 100, height: 100 },
      [],
    );
    expect([...defs.values()]).toEqual([
      { name: "my-panel", order: 1050, space: "screen" },
      { name: "my-content", order: 1060, space: "screen" },
      { name: "my-menu", order: 1070, space: "screen" },
    ]);
    skin.dispose();
    bundle.chrome?.dispose();
    bundle.slots.dispose();
    bundle.detail?.dispose();
    scene._flushDestroyQueue();
    expect(scene.findEntities()).toHaveLength(0);
    bundle.chrome?.mount(scene);
    expect(defs.size).toBe(3);
    bundle.chrome?.dispose();
  });
});
