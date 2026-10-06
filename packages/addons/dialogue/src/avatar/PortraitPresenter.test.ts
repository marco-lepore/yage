import { afterEach, describe, expect, it } from "vitest";
import { createMockScene, Transform } from "@yagejs/core";
import {
  GraphicsComponent,
  SceneRenderTreeProviderImpl,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import { Assets, Texture } from "pixi.js";
import { PortraitPresenter } from "./PortraitPresenter.js";
import { InBoxAvatarPresenter } from "./InBoxAvatarPresenter.js";
import { BoxLayout } from "../render/BoxLayout.js";
import { defaultDialogueTheme } from "../factory/defaultTheme.js";

const KEY = "dialogue-flip-test";
afterEach(() => {
  Assets.cache.remove(KEY);
});

describe("portrait mirroring", () => {
  it("centers a right-side portrait and background above the caret footer", () => {
    Assets.cache.set(KEY, Texture.WHITE);
    const { scene, context } = createMockScene();
    const provider = new SceneRenderTreeProviderImpl(
      new GraphicsComponent().graphics,
    );
    scene._registerScoped(SceneRenderTreeKey, provider.createForScene(scene));
    context.register(SceneRenderTreeProviderKey, provider);
    const layout = new BoxLayout({
      ...defaultDialogueTheme(),
      padding: 10,
      choiceGap: 6,
    });
    layout.setViewport(800, 450);
    layout.setCaretHeight(12);
    const presenter = new InBoxAvatarPresenter(layout, {
      layer: "portrait",
      width: 140,
      scale: 140,
      background: { color: 0 },
    });
    presenter.mount(scene);
    const line = {
      text: { runs: [], tokens: [], length: 0 },
      speed: 1,
      meta: { portrait: KEY, side: "right" },
    };
    layout.layoutLine(line);
    presenter.present(line);
    const caretY = layout.caretPos({ width: 7, height: 12 }).y;
    const portraitY = scene.findEntity("dlg-inbox-avatar")!.get(Transform)
      .position.y;
    const backgroundY = scene.findEntity("dlg-inbox-avatar-bg")!.get(Transform)
      .position.y;
    expect(portraitY + 70).toBeLessThan(caretY);
    expect(backgroundY + 70).toBeLessThan(caretY);
    presenter.dispose();
    scene._flushDestroyQueue();
    provider.destroyAll();
  });
  it("keeps the flip across expressions and resets it for another speaker", () => {
    Assets.cache.set(KEY, Texture.WHITE);
    const { scene, context } = createMockScene();
    const provider = new SceneRenderTreeProviderImpl(
      new GraphicsComponent().graphics,
    );
    scene._registerScoped(SceneRenderTreeKey, provider.createForScene(scene));
    context.register(SceneRenderTreeProviderKey, provider);
    const presenter = new PortraitPresenter({
      layer: "portraits",
      leftX: 20,
      rightX: 200,
      y: 80,
      scale: 2,
    });
    presenter.mount(scene);
    presenter.setSpeaker({
      id: "a",
      name: "A",
      avatar: {
        kind: "portrait",
        ref: KEY,
        flipX: true,
        expressions: { happy: KEY },
      },
    });
    const transform = scene.findEntity("dlg-portrait")!.get(Transform);
    expect(transform.scale.x).toBe(-2);
    expect(transform.scale.y).toBe(2);
    expect(transform.position.x).toBe(20);
    presenter.setExpression("happy");
    expect(transform.scale.x).toBe(-2);
    presenter.setSpeaker({
      id: "b",
      name: "B",
      avatar: { kind: "portrait", ref: KEY, side: "right" },
    });
    expect(transform.scale.x).toBe(2);
    expect(transform.position.x).toBe(200);
    presenter.dispose();
    scene._flushDestroyQueue();
    provider.destroyAll();
  });

  it("reads the in-box flip per line without flipping the background", () => {
    Assets.cache.set(KEY, Texture.WHITE);
    const { scene, context } = createMockScene();
    const provider = new SceneRenderTreeProviderImpl(
      new GraphicsComponent().graphics,
    );
    scene._registerScoped(SceneRenderTreeKey, provider.createForScene(scene));
    context.register(SceneRenderTreeProviderKey, provider);
    const layout = new BoxLayout({ ...defaultDialogueTheme(), choiceGap: 6 });
    layout.setViewport(800, 450);
    const presenter = new InBoxAvatarPresenter(layout, {
      layer: "portrait",
      width: 80,
      scale: 2,
      background: { color: 0 },
      align: "top",
    });
    presenter.mount(scene);
    const text = { runs: [], tokens: [], length: 0 };
    presenter.present({ text, speed: 1, meta: { portrait: KEY, flipX: true } });
    const transform = scene.findEntity("dlg-inbox-avatar")!.get(Transform);
    expect(transform.scale.x).toBe(-2);
    expect(transform.position.y).toBe(layout.textRegion().y + 1);
    expect(layout.frameRect().height).toBe(112);
    expect(
      scene.findEntity("dlg-inbox-avatar-bg")!.get(Transform).scale.x,
    ).toBe(1);
    presenter.present({ text, speed: 1, meta: { portrait: KEY } });
    expect(transform.scale.x).toBe(2);
    presenter.dispose();
    scene._flushDestroyQueue();
    provider.destroyAll();
  });
});
