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

  class MockNineSliceSprite extends MockContainer {
    texture: unknown;
    insets: number[];
    width: number;
    height: number;
    anchor = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    constructor(options: {
      texture: unknown;
      leftWidth: number;
      topHeight: number;
      rightWidth: number;
      bottomHeight: number;
      width: number;
      height: number;
    }) {
      super();
      this.texture = options.texture;
      this.insets = [
        options.leftWidth,
        options.topHeight,
        options.rightWidth,
        options.bottomHeight,
      ];
      this.width = options.width;
      this.height = options.height;
    }
  }

  return { mocks: { MockContainer, MockSprite, MockNineSliceSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  // Texture.from reads the asset cache: "missing" is the one key never loaded.
  Texture: {
    from: (key: string) => (key === "missing" ? undefined : `texture:${key}`),
  },
}));

import { Transform } from "@yagejs/core";
import { NineSliceComponent } from "./NineSliceComponent.js";
import {
  createRendererTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

type MockSlice = InstanceType<typeof mocks.MockNineSliceSprite>;

const INSETS = { left: 8, top: 6, right: 4, bottom: 2 };

describe("NineSliceComponent", () => {
  it("draws the texture at its size on the entity's layer", () => {
    const { scene, tree } = createRendererTestContext();
    tree.ensureLayer({ name: "ui", order: 10 });
    const entity = spawnEntityInScene(scene, "panel");
    entity.add(new Transform());
    const frame = entity.add(
      new NineSliceComponent({
        texture: "panel",
        insets: INSETS,
        width: 120,
        height: 40,
        anchor: { x: 0.5, y: 0.5 },
        layer: "ui",
      }),
    );
    const slice = frame.renderObject as unknown as MockSlice;

    expect(slice.texture).toBe("texture:panel");
    expect(slice.insets).toEqual([8, 6, 4, 2]);
    expect(slice.anchor.x).toBe(0.5);
    expect([frame.width, frame.height]).toEqual([120, 40]);
    expect(tree.get("ui").container.children).toContain(slice);
  });

  it("reads and writes the anchor after construction", () => {
    const frame = new NineSliceComponent({
      texture: "panel",
      insets: INSETS,
      width: 120,
      height: 40,
    });
    expect(frame.anchor).toEqual({ x: 0, y: 0 });
    frame.anchor = { x: 0.5, y: 1 };
    expect(frame.renderObject.anchor).toMatchObject({ x: 0.5, y: 1 });
    expect(frame.anchor).toEqual({ x: 0.5, y: 1 });
    expect(() => {
      frame.anchor = { x: NaN, y: 0 };
    }).toThrow("NineSliceComponent.anchor: anchor.x must be finite, got NaN.");
  });

  it("throws on a non-finite anchor option, naming the coordinate", () => {
    expect(
      () =>
        new NineSliceComponent({
          texture: "panel",
          insets: INSETS,
          width: 120,
          height: 40,
          anchor: { x: 0, y: NaN },
        }),
    ).toThrow(
      "NineSliceComponent.constructor: anchor.y must be finite, got NaN.",
    );
  });

  it("stretches to a new size", () => {
    const frame = new NineSliceComponent({
      texture: "panel",
      insets: INSETS,
      width: 10,
      height: 10,
    });

    frame.setSize(200, 80);

    expect([frame.width, frame.height]).toEqual([200, 80]);
  });

  it("rejects a negative or non-finite size before drawing", () => {
    expect(
      () =>
        new NineSliceComponent({
          texture: "panel",
          insets: INSETS,
          width: -1,
          height: 10,
        }),
    ).toThrow(
      "NineSliceComponent.constructor: width must be finite and >= 0, got -1.",
    );
    const frame = new NineSliceComponent({
      texture: "panel",
      insets: INSETS,
      width: 10,
      height: 10,
    });
    expect(() => frame.setSize(10, Number.NaN)).toThrow(
      "NineSliceComponent.setSize: height must be finite and >= 0, got NaN.",
    );
  });

  it("rejects a non-finite anchor before drawing", () => {
    expect(
      () =>
        new NineSliceComponent({
          texture: "panel",
          insets: INSETS,
          width: 10,
          height: 10,
          anchor: { x: Infinity, y: 0 },
        }),
    ).toThrow(
      "NineSliceComponent.constructor: anchor.x must be finite, got Infinity.",
    );
  });

  it("throws naming an unknown texture key", () => {
    expect(
      () =>
        new NineSliceComponent({
          texture: "missing",
          insets: INSETS,
          width: 10,
          height: 10,
        }),
    ).toThrow('Texture "missing" is not loaded');
  });
});
