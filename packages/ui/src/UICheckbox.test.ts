import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    destroyed = false;
    eventMode = "auto";
    cursor = "default";
    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    addChildAt(child: MockContainer, index: number): MockContainer {
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const i = this.children.indexOf(child);
      if (i !== -1) {
        this.children.splice(i, 1);
        child.parent = null;
      }
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }

    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      const listeners = this._listeners.get(event);
      if (listeners) for (const fn of listeners) fn(...args);
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics {
      return this;
    }
    rect(): MockGraphics {
      return this;
    }
    /** The rectangle of the most recent rounded draw. */
    lastRect:
      | { x: number; y: number; width: number; height: number; radius?: number }
      | undefined;
    roundRect(
      x: number,
      y: number,
      width: number,
      height: number,
      radius?: number,
    ): MockGraphics {
      this.lastRect = {
        x,
        y,
        width,
        height,
        ...(radius === undefined ? {} : { radius }),
      };
      return this;
    }
    /** The style passed to the most recent `fill`. */
    lastFill: { color?: number; alpha?: number } | undefined;
    fill(style?: { color?: number; alpha?: number }): MockGraphics {
      this.lastFill = style;
      return this;
    }
    moveTo(): MockGraphics {
      return this;
    }
    lineTo(): MockGraphics {
      return this;
    }
    /** The style passed to the most recent `stroke`. */
    lastStroke: { color?: number; width?: number } | undefined;
    stroke(style?: { color?: number; width?: number }): MockGraphics {
      this.lastStroke = style;
      return this;
    }
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
    texture: unknown;
    width = 0;
    height = 0;
    constructor(texture?: unknown) {
      super();
      this.texture = texture;
    }
  }

  class MockNineSliceSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) this.texture = opts.texture;
    }
  }

  class MockTilingSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    tileScale = {
      x: 1,
      y: 1,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) this.texture = opts.texture;
    }
  }

  return {
    mocks: {
      MockContainer,
      MockGraphics,
      MockText,
      MockSprite,
      MockNineSliceSprite,
      MockTilingSprite,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
  Sprite: mocks.MockSprite,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { UICheckbox } from "./UICheckbox.js";
import { getFocusState } from "./focus/FocusState.js";
import { setUIFocusStyle } from "./internal/focus-outline.js";
import { takePointerRequest } from "./focus/pointer-request.js";

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
    const container = cb.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    container.emit("pointerdown");
    container.emit("pointerup");
    expect(cb.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);

    container.emit("pointerdown");
    container.emit("pointerup");
    expect(cb.checked).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not toggle when disabled", () => {
    const onChange = vi.fn();
    const cb = new UICheckbox({ onChange, disabled: true });
    const container = cb.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    container.emit("pointerdown");
    container.emit("pointerup");
    expect(cb.checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled state changes cursor and alpha", () => {
    const cb = new UICheckbox({});
    const container = cb.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
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
    const container = cb.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
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
    const container = cb.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    container.emit("pointerdown");
    container.emit("pointerup");
    expect(onChange1).not.toHaveBeenCalled();
    expect(onChange2).toHaveBeenCalledWith(true);
  });

  it("does not toggle when the press started outside the checkbox", () => {
    const onChange = vi.fn();
    const cb = new UICheckbox({ onChange });
    const container = cb.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;

    container.emit("pointerup");

    expect(cb.checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
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
    const container = cb.container as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    expect(container.destroyed).toBe(true);
  });

  it("reads the disabled flag back", () => {
    const cb = new UICheckbox({});
    expect(cb.disabled).toBe(false);

    cb.setDisabled(true);
    expect(cb.disabled).toBe(true);

    cb.update({ disabled: false });
    expect(cb.disabled).toBe(false);
  });

  it("starts disabled from its constructor options", () => {
    expect(new UICheckbox({ disabled: true }).disabled).toBe(true);
  });

  describe("hover callbacks", () => {
    it("fires all three on pointerover and pointerout", () => {
      const onHover = vi.fn();
      const onPointerOver = vi.fn();
      const onPointerOut = vi.fn();
      const cb = new UICheckbox({ onHover, onPointerOver, onPointerOut });
      const container = cb.container as unknown as InstanceType<
        typeof mocks.MockContainer
      >;

      container.emit("pointerover");
      container.emit("pointerout");

      expect(onPointerOver).toHaveBeenCalledTimes(1);
      expect(onPointerOut).toHaveBeenCalledTimes(1);
      expect(onHover.mock.calls).toEqual([[true], [false]]);
    });

    it("suppresses all three while disabled", () => {
      const onHover = vi.fn();
      const cb = new UICheckbox({ onHover, disabled: true });
      const container = cb.container as unknown as InstanceType<
        typeof mocks.MockContainer
      >;

      container.emit("pointerover");
      container.emit("pointerout");

      expect(onHover).not.toHaveBeenCalled();
    });

    it("swaps a handler through update", () => {
      const first = vi.fn();
      const second = vi.fn();
      const cb = new UICheckbox({ onHover: first });
      cb.update({ onHover: second });
      const container = cb.container as unknown as InstanceType<
        typeof mocks.MockContainer
      >;

      container.emit("pointerover");

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(true);
    });
  });

  describe("focus", () => {
    // An outline is drawn only where one is asked for, so these boxes are
    // measured against the outline a game asks for once for the whole UI.
    beforeEach(() => setUIFocusStyle({}));
    afterEach(() => setUIFocusStyle(undefined));

    /** Move focus the way a scope does. */
    function setFocused(cb: UICheckbox, focused: boolean): void {
      getFocusState(cb)?._setFocused(focused);
    }

    function containerOf(
      cb: UICheckbox,
    ): InstanceType<typeof mocks.MockContainer> {
      return cb.container as unknown as InstanceType<
        typeof mocks.MockContainer
      >;
    }

    /** The colour the box was last filled with. */
    function boxColor(cb: UICheckbox): number | undefined {
      const box = containerOf(cb).children[0] as InstanceType<
        typeof mocks.MockGraphics
      >;
      return box.lastFill?.color;
    }

    /** Lay the row out on its own, so its Yoga box carries real numbers. */
    function layout(cb: UICheckbox, width: number, height: number): void {
      cb.yogaNode.calculateLayout(width, height, Direction.LTR);
      cb.applyLayout();
    }

    /** The outline a focused row draws, or `undefined` before it takes focus. */
    function outline(
      cb: UICheckbox,
    ): InstanceType<typeof mocks.MockGraphics> | undefined {
      return containerOf(cb).children.find(
        (child): child is InstanceType<typeof mocks.MockGraphics> =>
          child instanceof mocks.MockGraphics && child.measurable === false,
      );
    }

    /** Hold or release a confirm press the way a scope does. */
    function setPressed(cb: UICheckbox, pressed: boolean): void {
      getFocusState(cb)?.behavior.setPressed?.(pressed);
    }

    it("darkens the box while the pointer holds the row down", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });

      containerOf(cb).emit("pointerdown");
      expect(boxColor(cb)).toBe(0x183048);

      containerOf(cb).emit("pointerup");
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("gives the box back when the pointer leaves the row still held", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });

      containerOf(cb).emit("pointerdown");
      containerOf(cb).emit("pointerout");

      expect(boxColor(cb)).toBe(0x204060);
    });

    it("darkens the box while a scope holds confirm on the row", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });
      setFocused(cb, true);

      setPressed(cb, true);
      expect(boxColor(cb)).toBe(0x183048);
      expect(cb._inspectState().pressed).toBe(true);

      setPressed(cb, false);
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("holds the darkened box while the pointer crosses a row under confirm", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });
      setFocused(cb, true);

      // 0x20 / 0x40 / 0x60 are 32 / 64 / 96, and the 0.75 press factor takes
      // them to 24 / 48 / 72 — 0x18 / 0x30 / 0x48.
      setPressed(cb, true);
      expect(boxColor(cb)).toBe(0x183048);

      containerOf(cb).emit("pointerover");
      expect(boxColor(cb)).toBe(0x183048);
      containerOf(cb).emit("pointerout");
      expect(boxColor(cb)).toBe(0x183048);

      setPressed(cb, false);
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("holds the darkened box when confirm ends under a pointer still down", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });

      containerOf(cb).emit("pointerdown");
      setPressed(cb, true);
      setPressed(cb, false);

      expect(boxColor(cb)).toBe(0x183048);
      expect(cb._inspectState().pressed).toBe(true);

      containerOf(cb).emit("pointerup");
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("holds a confirm press through a pointer release outside the row", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });
      setPressed(cb, true);

      containerOf(cb).emit("pointerdown");
      containerOf(cb).emit("pointerupoutside");

      expect(boxColor(cb)).toBe(0x183048);
      setPressed(cb, false);
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("forgets both presses when the row is disabled under them", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });
      containerOf(cb).emit("pointerdown");
      setPressed(cb, true);

      cb.setDisabled(true);
      expect(boxColor(cb)).toBe(0x204060);
      expect(cb._inspectState().pressed).toBe(false);

      // Enabling the row again shows what it is under now, not the press it
      // refused.
      cb.setDisabled(false);
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("takes focus by default and gives it up on request", () => {
      expect(new UICheckbox({}).focusable).toBe(true);
      expect(new UICheckbox({ focusable: false }).focusable).toBe(false);
    });

    it("outlines the row while it holds focus and leaves the box alone", () => {
      const cb = new UICheckbox({ boxColor: 0x204060 });
      layout(cb, 64, 24);
      expect(outline(cb)).toBeUndefined();

      setFocused(cb, true);
      expect(cb.focused).toBe(true);
      const ring = outline(cb);
      expect(ring?.visible).toBe(true);
      expect(ring?.lastRect).toMatchObject({
        x: 1,
        y: 1,
        width: 62,
        height: 22,
      });
      expect(ring?.lastStroke).toEqual({ color: 0xffffff, width: 2 });
      expect(boxColor(cb)).toBe(0x204060);

      setFocused(cb, false);
      expect(cb.focused).toBe(false);
      expect(ring?.visible).toBe(false);
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("keeps the box colour the caller chose through a colour change", () => {
      const cb = new UICheckbox({});
      setFocused(cb, true);
      cb.update({ boxColor: 0x204060 });
      expect(boxColor(cb)).toBe(0x204060);
    });

    it("follows the box a later layout pass gives it", () => {
      const cb = new UICheckbox({});
      layout(cb, 64, 24);
      setFocused(cb, true);

      layout(cb, 120, 24);

      expect(outline(cb)?.lastRect).toMatchObject({ width: 118 });
    });

    it("takes the outline style this row was given", () => {
      const cb = new UICheckbox({ focusStyle: { color: 0x33ff88, width: 1 } });
      layout(cb, 64, 24);

      setFocused(cb, true);

      expect(outline(cb)?.lastStroke).toEqual({ color: 0x33ff88, width: 1 });
    });

    it("asks for hover focus when the pointer arrives", () => {
      takePointerRequest();
      const cb = new UICheckbox({});

      containerOf(cb).emit("pointerover");

      const request = takePointerRequest();
      expect(request?.element).toBe(cb);
      expect(request?.trigger).toBe("hover");
    });

    it("asks for press focus when the pointer presses it", () => {
      takePointerRequest();
      const cb = new UICheckbox({});

      containerOf(cb).emit("pointerdown");

      const request = takePointerRequest();
      expect(request?.element).toBe(cb);
      expect(request?.trigger).toBe("press");
    });

    it("presses into focus and still toggles on the release", () => {
      const onChange = vi.fn();
      takePointerRequest();
      const cb = new UICheckbox({ onChange });

      containerOf(cb).emit("pointerdown");
      containerOf(cb).emit("pointerup");

      expect(takePointerRequest()?.trigger).toBe("press");
      expect(cb.checked).toBe(true);
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it("asks for nothing while disabled", () => {
      takePointerRequest();
      const cb = new UICheckbox({ disabled: true });

      containerOf(cb).emit("pointerover");
      containerOf(cb).emit("pointerdown");

      expect(takePointerRequest()).toBeNull();
    });

    it("toggles, redraws and reports once from activate()", () => {
      const onChange = vi.fn();
      const cb = new UICheckbox({ onChange });
      const checkmark = containerOf(cb).children[1] as InstanceType<
        typeof mocks.MockGraphics
      >;
      const redraw = vi.spyOn(checkmark, "clear");

      cb.activate();

      expect(cb.checked).toBe(true);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(true);
      expect(redraw).toHaveBeenCalled();
    });

    it("reports nothing from a silent update", () => {
      const onChange = vi.fn();
      const cb = new UICheckbox({ onChange });

      cb.update({ checked: true });

      expect(cb.checked).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does nothing from a disabled checkbox's activate()", () => {
      const onChange = vi.fn();
      const cb = new UICheckbox({ onChange, disabled: true });

      cb.activate();

      expect(cb.checked).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("sends the pointer release through activate()", () => {
      const cb = new UICheckbox({});
      const activate = vi.spyOn(cb, "activate");
      const container = containerOf(cb);

      container.emit("pointerdown");
      container.emit("pointerup");

      expect(activate).toHaveBeenCalledTimes(1);
      expect(cb.checked).toBe(true);
    });

    it("reports its state to the Inspector", () => {
      const cb = new UICheckbox({ checked: true });
      setFocused(cb, true);
      containerOf(cb).emit("pointerdown");

      expect(cb._inspectState()).toEqual({
        focused: true,
        focusable: true,
        pressed: true,
        checked: true,
        disabled: false,
      });
    });

    it("reports a checkbox taken out of focus navigation", () => {
      const cb = new UICheckbox({ focusable: false });

      expect(cb._inspectState()).toMatchObject({
        focusable: false,
        disabled: false,
      });
    });

    it("leaves focus navigation when the checkbox is destroyed", () => {
      const cb = new UICheckbox({});
      cb.destroy();
      expect(getFocusState(cb)).toBeUndefined();
    });
  });
});
