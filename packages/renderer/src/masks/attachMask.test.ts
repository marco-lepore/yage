/**
 * Unit tests for the low-level `attachMask` helper and the three factories
 * (`rectMask`, `spriteMask`, `graphicsMask`). Cover ownership, parenting,
 * inverse toggling, redraw, and idempotent remove.
 */
import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    mask: MockContainer | null = null;
    maskInverse = false;
    destroyed = false;
    setMask(opts: { mask: MockContainer | null; inverse?: boolean }): void {
      this.mask = opts.mask;
      this.maskInverse = opts.inverse ?? false;
    }
    addChild(c: MockContainer): MockContainer {
      this.children.push(c);
      c.parent = this;
      return c;
    }
    removeChild(c: MockContainer): MockContainer {
      const i = this.children.indexOf(c);
      if (i !== -1) {
        this.children.splice(i, 1);
        c.parent = null;
      }
      return c;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    drawCalls: string[] = [];
    clear(): MockGraphics {
      this.drawCalls.push("clear");
      return this;
    }
    rect(x: number, y: number, w: number, h: number): MockGraphics {
      this.drawCalls.push(`rect:${x},${y},${w},${h}`);
      return this;
    }
    roundRect(
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
    ): MockGraphics {
      this.drawCalls.push(`roundRect:${x},${y},${w},${h},${r}`);
      return this;
    }
    fill(): MockGraphics {
      this.drawCalls.push("fill");
      return this;
    }
  }

  class MockSprite extends MockContainer {}

  return { mocks: { MockContainer, MockGraphics, MockSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Sprite: mocks.MockSprite,
}));

import { attachMask } from "./attachMask.js";
import { rectMask } from "./rectMask.js";
import { spriteMask } from "./spriteMask.js";
import { graphicsMask } from "./graphicsMask.js";

describe("attachMask + rectMask", () => {
  it("parents the Graphics under the target and assigns it via setMask", () => {
    const target = new mocks.MockContainer();
    const handle = attachMask(
      target as never,
      rectMask({ x: 0, y: 0, width: 100, height: 50 }),
    );

    expect(target.children.length).toBe(1);
    const g = target.children[0]! as InstanceType<typeof mocks.MockGraphics>;
    expect(target.mask).toBe(g);
    expect(target.maskInverse).toBe(false);
    expect(g.drawCalls).toEqual(["rect:0,0,100,50", "fill"]);
    expect(handle.inverse).toBe(false);
  });

  it("uses roundRect when rounded > 0", () => {
    const target = new mocks.MockContainer();
    attachMask(
      target as never,
      rectMask({ x: 5, y: 5, width: 40, height: 40, rounded: 8 }),
    );
    const g = target.children[0]! as InstanceType<typeof mocks.MockGraphics>;
    expect(g.drawCalls).toEqual(["roundRect:5,5,40,40,8", "fill"]);
  });

  it("destroys the owned Graphics on remove and clears the mask", () => {
    const target = new mocks.MockContainer();
    const handle = attachMask(
      target as never,
      rectMask({ x: 0, y: 0, width: 10, height: 10 }),
    );
    const g = target.children[0]! as InstanceType<typeof mocks.MockGraphics>;

    handle.remove();
    expect(target.mask).toBeNull();
    expect(g.destroyed).toBe(true);
    expect(target.children.length).toBe(0);
  });

  it("remove is idempotent", () => {
    const target = new mocks.MockContainer();
    const handle = attachMask(
      target as never,
      rectMask({ x: 0, y: 0, width: 10, height: 10 }),
    );
    handle.remove();
    handle.remove(); // second call should be a no-op
    expect(target.mask).toBeNull();
  });

  it("setInverse flips the mask configuration", () => {
    const target = new mocks.MockContainer();
    const handle = attachMask(
      target as never,
      rectMask({ x: 0, y: 0, width: 10, height: 10 }),
    );
    const g = target.children[0]!;

    handle.setInverse(true);
    expect(target.maskInverse).toBe(true);
    expect(target.mask).toBe(g);
    expect(handle.inverse).toBe(true);

    handle.setInverse(false);
    expect(target.maskInverse).toBe(false);
    expect(handle.inverse).toBe(false);
  });

  it("setInverse no-ops after remove", () => {
    const target = new mocks.MockContainer();
    const handle = attachMask(
      target as never,
      rectMask({ x: 0, y: 0, width: 10, height: 10 }),
    );
    handle.remove();
    handle.setInverse(true);
    expect(target.mask).toBeNull();
    expect(target.maskInverse).toBe(false);
  });

  it("redraw on a rectMask is a no-op", () => {
    const target = new mocks.MockContainer();
    const handle = attachMask(
      target as never,
      rectMask({ x: 0, y: 0, width: 10, height: 10 }),
    );
    expect(() => handle.redraw()).not.toThrow();
  });
});

describe("spriteMask", () => {
  it("uses the supplied sprite without re-parenting it", () => {
    const target = new mocks.MockContainer();
    const sprite = new mocks.MockSprite();

    const handle = attachMask(target as never, spriteMask(sprite as never));

    // Sprite is NOT added as a child — caller retains parenting responsibility.
    expect(target.children.length).toBe(0);
    expect(target.mask).toBe(sprite);
    expect(handle.inverse).toBe(false);
  });

  it("does not destroy the sprite on remove (caller-owned)", () => {
    const target = new mocks.MockContainer();
    const sprite = new mocks.MockSprite();
    const handle = attachMask(target as never, spriteMask(sprite as never));

    handle.remove();
    expect(target.mask).toBeNull();
    expect(sprite.destroyed).toBe(false);
  });
});

describe("graphicsMask", () => {
  it("runs the draw fn once at attach time", () => {
    const target = new mocks.MockContainer();
    const draw = vi.fn((g: { rect: (x: number, y: number, w: number, h: number) => unknown }) => {
      g.rect(0, 0, 20, 20);
    });
    attachMask(target as never, graphicsMask(draw as never));
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("redraw re-invokes the draw fn on the same Graphics instance", () => {
    const target = new mocks.MockContainer();
    let dim = 10;
    const handle = attachMask(
      target as never,
      graphicsMask((g) => {
        g.clear();
        g.rect(0, 0, dim, dim);
        g.fill({ color: 0xffffff });
      }),
    );
    const g = target.children[0]! as InstanceType<typeof mocks.MockGraphics>;
    expect(g.drawCalls).toEqual(["clear", "rect:0,0,10,10", "fill"]);

    dim = 25;
    handle.redraw();
    expect(g.drawCalls).toEqual([
      "clear",
      "rect:0,0,10,10",
      "fill",
      "clear",
      "rect:0,0,25,25",
      "fill",
    ]);
  });

  it("destroys the owned Graphics on remove", () => {
    const target = new mocks.MockContainer();
    const handle = attachMask(
      target as never,
      graphicsMask((g) => g.rect(0, 0, 5, 5)),
    );
    const g = target.children[0]! as InstanceType<typeof mocks.MockGraphics>;
    handle.remove();
    expect(g.destroyed).toBe(true);
    expect(target.mask).toBeNull();
  });

  it("redraw no-ops after remove", () => {
    const target = new mocks.MockContainer();
    const draw = vi.fn();
    const handle = attachMask(target as never, graphicsMask(draw as never));
    expect(draw).toHaveBeenCalledTimes(1);
    handle.remove();
    handle.redraw();
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
