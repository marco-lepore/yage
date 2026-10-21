import { describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set() {} };
    scale = { x: 1, y: 1, set() {} };
    rotation = 0;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    visible = true;
    destroyed = false;
    eventMode = "passive";
    localBounds = { x: 0, y: 0, width: 0, height: 0 };
    listeners = new Map<string, Set<() => void>>();

    on(event: string, fn: () => void): this {
      let set = this.listeners.get(event);
      if (!set) this.listeners.set(event, (set = new Set()));
      set.add(fn);
      return this;
    }
    off(event: string, fn: () => void): this {
      this.listeners.get(event)?.delete(fn);
      return this;
    }
    emit(event: string): void {
      for (const fn of [...(this.listeners.get(event) ?? [])]) fn();
    }
    getLocalBounds(): { x: number; y: number; width: number; height: number } {
      return this.localBounds;
    }

    addChild(child: MockContainer): MockContainer {
      child.parent?.removeChild(child);
      this.children.push(child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const index = this.children.indexOf(child);
      if (index !== -1) {
        this.children.splice(index, 1);
        child.parent = null;
      }
      return child;
    }
    removeChildren(): MockContainer[] {
      const removed = [...this.children];
      for (const child of removed) this.removeChild(child);
      return removed;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown = null;
    static from(texture: unknown): MockSprite {
      const sprite = new MockSprite();
      sprite.texture = texture;
      return sprite;
    }
  }

  return { mocks: { MockContainer, MockSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
}));

import { ErrorBoundaryKey, Transform } from "@yagejs/core";
import { SpriteComponent } from "./SpriteComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

type MockSprite = InstanceType<typeof mocks.MockSprite>;

function spawnSprite(ctx: ReturnType<typeof createRendererTestContext>) {
  const entity = spawnEntityInScene(ctx.scene, "card");
  entity.add(new Transform());
  const sprite = entity.add(new SpriteComponent({ texture: {} as never }));
  return { sprite, pixi: sprite.renderObject as unknown as MockSprite };
}

describe("VisualComponent.localBounds", () => {
  it("reports the drawn box in the visual's own pixels", () => {
    const { sprite, pixi } = spawnSprite(createRendererTestContext());
    pixi.localBounds = { x: -16, y: -8, width: 32, height: 16 };

    expect(sprite.localBounds).toEqual({
      x: -16,
      y: -8,
      width: 32,
      height: 16,
    });
  });
});

describe("VisualComponent.onPointer", () => {
  it("calls the handler for its event until unsubscribed", () => {
    const { sprite, pixi } = spawnSprite(createRendererTestContext());
    const fn = vi.fn();

    const off = sprite.onPointer("down", fn);
    expect(pixi.eventMode).toBe("static");
    pixi.emit("pointerdown");
    pixi.emit("pointerup");
    expect(fn).toHaveBeenCalledTimes(1);

    off();
    pixi.emit("pointerdown");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps an eventMode the interactive option set", () => {
    const ctx = createRendererTestContext();
    const entity = spawnEntityInScene(ctx.scene, "card");
    entity.add(new Transform());
    const sprite = entity.add(
      new SpriteComponent({
        texture: {} as never,
        interactive: { eventMode: "dynamic" },
      }),
    );

    sprite.onPointer("tap", () => {});
    expect((sprite.renderObject as unknown as MockSprite).eventMode).toBe(
      "dynamic",
    );
  });

  it("records a throwing handler on the error boundary and rethrows", () => {
    const ctx = createRendererTestContext();
    const { sprite, pixi } = spawnSprite(ctx);
    sprite.onPointer("over", () => {
      throw new Error("hover broke");
    });

    expect(() => pixi.emit("pointerover")).toThrow("hover broke");
    const errors = ctx.context.resolve(ErrorBoundaryKey).getCallbackErrors();
    expect(errors.at(-1)?.kind).toBe("SpriteComponent over pointer handler");
  });
});
