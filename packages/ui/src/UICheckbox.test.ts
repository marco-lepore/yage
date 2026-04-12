import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    destroyed = false;
    eventMode = "auto";
    cursor = "default";
    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    addChild(child: MockContainer): MockContainer { this.children.push(child); child.parent = this; return child; }
    addChildAt(child: MockContainer, index: number): MockContainer { this.children.splice(index, 0, child); child.parent = this; return child; }
    removeChild(child: MockContainer): MockContainer { const i = this.children.indexOf(child); if (i !== -1) { this.children.splice(i, 1); child.parent = null; } return child; }
    removeFromParent(): void { this.parent?.removeChild(this); }

    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      const listeners = this._listeners.get(event);
      if (listeners) for (const fn of listeners) fn(...args);
    }

    destroy(): void { this.destroyed = true; this.removeFromParent(); }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics { return this; }
    rect(): MockGraphics { return this; }
    roundRect(): MockGraphics { return this; }
    fill(): MockGraphics { return this; }
    moveTo(): MockGraphics { return this; }
    lineTo(): MockGraphics { return this; }
    stroke(): MockGraphics { return this; }
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    width: number;
    height: number;

    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      this.width = 50;
      this.height = 14;
    }
  }

  class MockSprite extends MockContainer {
    texture: unknown; width = 0; height = 0;
    constructor(texture?: unknown) { super(); this.texture = texture; }
  }

  class MockNineSliceSprite extends MockContainer {
    texture: unknown; width = 0; height = 0;
    constructor(opts?: Record<string, unknown>) { super(); if (opts) this.texture = opts.texture; }
  }

  class MockTilingSprite extends MockContainer {
    texture: unknown; width = 0; height = 0;
    tileScale = { x: 1, y: 1, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
    constructor(opts?: Record<string, unknown>) { super(); if (opts) this.texture = opts.texture; }
  }

  return { mocks: { MockContainer, MockGraphics, MockText, MockSprite, MockNineSliceSprite, MockTilingSprite } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

import Yoga from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UICheckbox } from "./UICheckbox.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("UICheckbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates with default unchecked state", () => {
    const cb = new UICheckbox({});
    expect(cb.displayObject).toBeDefined();
    expect(cb.checked).toBe(false);
    expect(cb.visible).toBe(true);
  });

  it("creates with checked initial state", () => {
    const cb = new UICheckbox({ checked: true });
    expect(cb.checked).toBe(true);
  });

  it("toggles checked on pointerup", () => {
    const onChange = vi.fn();
    const cb = new UICheckbox({ onChange });
    const container = cb.container as unknown as InstanceType<typeof mocks.MockContainer>;

    container.emit("pointerup");
    expect(cb.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);

    container.emit("pointerup");
    expect(cb.checked).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not toggle when disabled", () => {
    const onChange = vi.fn();
    const cb = new UICheckbox({ onChange, disabled: true });
    const container = cb.container as unknown as InstanceType<typeof mocks.MockContainer>;

    container.emit("pointerup");
    expect(cb.checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled state changes cursor and alpha", () => {
    const cb = new UICheckbox({});
    const container = cb.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.cursor).toBe("pointer");
    expect(container.alpha).toBe(1);

    cb.setDisabled(true);
    expect(container.cursor).toBe("default");
    expect(container.alpha).toBe(0.5);
    expect(container.eventMode).toBe("none");

    cb.setDisabled(false);
    expect(container.cursor).toBe("pointer");
    expect(container.alpha).toBe(1);
  });

  it("creates a label when provided", () => {
    const cb = new UICheckbox({ label: "Accept" });
    const container = cb.container as unknown as InstanceType<typeof mocks.MockContainer>;
    // Should have box + checkmark + label = 3 children
    expect(container.children.length).toBe(3);
  });

  it("update changes checked state", () => {
    const cb = new UICheckbox({});
    expect(cb.checked).toBe(false);
    cb.update({ checked: true });
    expect(cb.checked).toBe(true);
  });

  it("update changes onChange handler", () => {
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();
    const cb = new UICheckbox({ onChange: onChange1 });
    cb.update({ onChange: onChange2 });
    const container = cb.container as unknown as InstanceType<typeof mocks.MockContainer>;
    container.emit("pointerup");
    expect(onChange1).not.toHaveBeenCalled();
    expect(onChange2).toHaveBeenCalledWith(true);
  });

  it("visibility can be toggled", () => {
    const cb = new UICheckbox({});
    cb.visible = false;
    expect(cb.visible).toBe(false);
    cb.visible = true;
    expect(cb.visible).toBe(true);
  });

  it("destroy cleans up", () => {
    const cb = new UICheckbox({});
    cb.destroy();
    const container = cb.container as unknown as InstanceType<typeof mocks.MockContainer>;
    expect(container.destroyed).toBe(true);
  });
});
