import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";
import {
  GraphicsComponent,
  SceneRenderTreeProviderImpl,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import type { BoxLayout } from "./BoxLayout.js";
import { createMixedDialogue } from "../factory/createMixedDialogue.js";
import { createBoxDialogue } from "../factory/createBoxDialogue.js";
import { createBubbleDialogue } from "../factory/createBubbleDialogue.js";
import { defaultDialogueTheme } from "../factory/defaultTheme.js";
import { InBoxAvatarPresenter } from "../avatar/InBoxAvatarPresenter.js";
import { BubbleAvatarPresenter } from "../avatar/BubbleAvatarPresenter.js";
import { PortraitPresenter } from "../avatar/PortraitPresenter.js";

describe("dialogue presenter layers", () => {
  it("provisions custom screen and bubble world layers on standalone mount", () => {
    const { scene, context } = createMockScene();
    const root = new GraphicsComponent();
    const provider = new SceneRenderTreeProviderImpl(root.graphics);
    const tree = provider.createForScene(scene);
    const ensureLayer = vi.spyOn(tree, "ensureLayer");
    context.register(SceneRenderTreeProviderKey, provider);
    scene._registerScoped(SceneRenderTreeKey, tree);
    const theme = {
      ...defaultDialogueTheme(),
      layerFrame: "my-frame",
      layerText: "my-text",
    };
    const box = createBoxDialogue(theme, {
      avatar: (layout) => {
        layout.setViewport(800, 600);
        return new InBoxAvatarPresenter(layout, {
          layer: "my-avatar",
          width: 96,
        });
      },
    });
    const bubble = createBubbleDialogue(theme, {
      worldLayer: "speech",
      avatar: (layout) =>
        new BubbleAvatarPresenter(layout, { layer: "speech", size: 48 }),
    });
    const portrait = new PortraitPresenter({
      layer: "portrait",
      leftX: 0,
      rightX: 100,
      y: 0,
      scale: 1,
    });
    for (const presenter of [
      box.chrome,
      box.text,
      box.choices,
      box.avatar!,
      bubble.chrome,
      bubble.text,
      bubble.choices,
      bubble.avatar!,
      portrait,
    ]) {
      presenter.mount(scene);
      presenter.dispose();
    }
    const defs = ensureLayer.mock.calls.map(([def]) => def);
    expect(defs).toContainEqual({
      name: "my-frame",
      order: 1100,
      space: "screen",
    });
    expect(defs).toContainEqual({
      name: "my-text",
      order: 1110,
      space: "screen",
    });
    expect(defs).toContainEqual({
      name: "my-avatar",
      order: 1105,
      space: "screen",
    });
    expect(defs.filter((def) => def.name === "speech")).toHaveLength(4);
    expect(
      defs
        .filter((def) => def.name === "speech")
        .every((def) => def.order === 0 && def.space === "world"),
    ).toBe(true);
    box.text.mount(scene);
    box.text.dispose();
    scene._flushDestroyQueue();
    expect(scene.findEntities()).toHaveLength(0);
    provider.destroyAll();
  });
});

describe("configured dialogue layer orders", () => {
  it("passes theme orders through box and mixed bundles and respects an intentional host layer", () => {
    for (const mixed of [false, true]) {
      const { scene, context } = createMockScene();
      const provider = new SceneRenderTreeProviderImpl(
        new GraphicsComponent().graphics,
      );
      const tree = provider.createForScene(scene);
      context.register(SceneRenderTreeProviderKey, provider);
      scene._registerScoped(SceneRenderTreeKey, tree);
      tree.ensureLayer({ name: "portrait", order: 1095, space: "screen" });
      const ensureLayer = vi.spyOn(tree, "ensureLayer");
      const theme = {
        ...defaultDialogueTheme(),
        layerFrameOrder: 1120,
        layerTextOrder: 1130,
      };
      const bind = (layout: BoxLayout) => {
        layout.setViewport(800, 450);
        return new InBoxAvatarPresenter(layout, {
          layer: "portrait",
          layerOrder: 1095,
          width: 80,
        });
      };
      const bundle = mixed
        ? createMixedDialogue(theme, {
            worldLayer: "world",
            avatar: { box: bind },
          })
        : createBoxDialogue(theme, { avatar: bind });
      bundle.chrome.mount(scene);
      bundle.choices.mount(scene);
      bundle.text.mount(scene);
      bundle.avatar?.mount(scene);
      const requested = ensureLayer.mock.calls.map(([def]) => def);
      expect(
        requested
          .filter((d) => d.name === theme.layerFrame)
          .every((d) => d.order === 1120),
      ).toBe(true);
      expect(requested.filter((d) => d.name === theme.layerText)).toHaveLength(
        3,
      );
      expect(
        requested
          .filter((d) => d.name === theme.layerText)
          .every((d) => d.order === 1130),
      ).toBe(true);
      expect(requested).toContainEqual({
        name: "portrait",
        order: 1095,
        space: "screen",
      });
      bundle.chrome.dispose();
      bundle.choices.dispose();
      bundle.text.dispose();
      bundle.avatar?.dispose();
      scene._flushDestroyQueue();
      provider.destroyAll();
    }
  });
});
