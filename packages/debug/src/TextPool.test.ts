import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Text: class MockText {
    text = "";
    visible = false;
    eventMode = "auto";
    position = {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    destroy = vi.fn();
    constructor(options?: { text?: string }) {
      if (options?.text) this.text = options.text;
    }
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

import { TextPool } from "./TextPool.js";
import { Container } from "pixi.js";

describe("TextPool", () => {
  it("adds lines with correct text and visibility", () => {
    const container = new Container();
    const pool = new TextPool(container, 3);

    pool.addLine("hello");
    pool.addLine("world");

    const children = container.children as unknown as Array<{
      text: string;
      visible: boolean;
    }>;
    expect(children[0]!.text).toBe("hello");
    expect(children[0]!.visible).toBe(true);
    expect(children[1]!.text).toBe("world");
    expect(children[1]!.visible).toBe(true);
    expect(children[2]!.visible).toBe(false);
  });

  it("resets all lines", () => {
    const container = new Container();
    const pool = new TextPool(container, 3);

    pool.addLine("hello");
    pool.addLine("world");
    pool.resetFrame();

    const children = container.children as unknown as Array<{ visible: boolean }>;
    expect(children[0]!.visible).toBe(false);
    expect(children[1]!.visible).toBe(false);
  });

  it("stops adding past the cap", () => {
    const container = new Container();
    const pool = new TextPool(container, 2);

    pool.addLine("a");
    pool.addLine("b");
    pool.addLine("c"); // should be a no-op

    const children = container.children as unknown as Array<{
      text: string;
      visible: boolean;
    }>;
    expect(children.length).toBe(2);
    expect(children[0]!.text).toBe("a");
    expect(children[1]!.text).toBe("b");
  });
});
