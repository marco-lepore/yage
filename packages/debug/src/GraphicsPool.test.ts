import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Graphics: class MockGraphics {
    visible = true;
    eventMode = "auto";
    position = {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    rotation = 0;
    scale = {
      x: 1,
      y: 1,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    clear = vi.fn().mockReturnThis();
    destroy = vi.fn();
  },
  Container: class MockContainer {
    children: unknown[] = [];
    addChild(child: unknown) {
      this.children.push(child);
      return child;
    }
    destroy = vi.fn();
  },
}));

import { GraphicsPool } from "./GraphicsPool.js";
import { Container } from "pixi.js";

describe("GraphicsPool", () => {
  it("acquires graphics up to the cap", () => {
    const pool = new GraphicsPool(new Container(), 3);
    expect(pool.acquire()).toBeDefined();
    expect(pool.acquire()).toBeDefined();
    expect(pool.acquire()).toBeDefined();
    expect(pool.acquire()).toBeUndefined();
  });

  it("resets and allows re-acquiring", () => {
    const pool = new GraphicsPool(new Container(), 2);
    pool.acquire();
    pool.acquire();
    expect(pool.acquire()).toBeUndefined();

    pool.resetFrame();

    expect(pool.acquire()).toBeDefined();
    expect(pool.acquire()).toBeDefined();
  });

  it("hides graphics on reset", () => {
    const pool = new GraphicsPool(new Container(), 2);
    const g1 = pool.acquire()!;
    expect(g1.visible).toBe(true);

    pool.resetFrame();
    expect(g1.visible).toBe(false);
  });
});
