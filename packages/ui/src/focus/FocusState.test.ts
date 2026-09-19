import { describe, it, expect, vi } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import type { UIElement } from "../types.js";
import type { UIFocusScope } from "./UIFocusScope.js";
import { bindUIErrorBoundary } from "../error-boundary.js";
import { FocusState, getFocusState } from "./FocusState.js";
import type { FocusBehavior } from "./FocusState.js";
import { requestHoverFocus, takePointerRequest } from "./pointer-request.js";

/** Minimal Pixi-Container stand-in: the parent chain the boundary walks. */
class MockContainer {
  parent: MockContainer | null = null;
}

/** An element with nothing but the container a callback is attributed to. */
function makeElement(parent?: MockContainer): {
  element: UIElement;
  container: MockContainer;
} {
  const container = new MockContainer();
  if (parent) container.parent = parent;
  const element = {
    displayObject: container as unknown as DisplayContainer,
  } as unknown as UIElement;
  return { element, container };
}

const PRESSABLE: FocusBehavior = { focusableByDefault: true };
const INERT: FocusBehavior = { focusableByDefault: false };

describe("FocusState", () => {
  it.each([
    [PRESSABLE, undefined, true],
    [INERT, undefined, false],
    [PRESSABLE, false, false],
    [INERT, true, true],
  ])(
    "reads focusable from the prop, then the default",
    (behavior, prop, expected) => {
      const props = prop === undefined ? {} : { focusable: prop };
      const state = new FocusState(makeElement().element, props, behavior);
      expect(state.focusable).toBe(expected);
    },
  );

  it("reads the id and the neighbours the element was built with", () => {
    const { element } = makeElement();
    const state = new FocusState(
      element,
      { focusId: "volume", focusNeighbors: { down: "saves-first" } },
      PRESSABLE,
    );
    expect(state.id).toBe("volume");
    expect(state.neighbors).toEqual({ down: "saves-first" });
  });

  it("reports disabled from the element's own hook, and enabled with none", () => {
    let disabled = false;
    const state = new FocusState(makeElement().element, {}, {
      focusableByDefault: true,
      isDisabled: () => disabled,
    } satisfies FocusBehavior);

    expect(state.disabled).toBe(false);
    disabled = true;
    expect(state.disabled).toBe(true);
    expect(new FocusState(makeElement().element, {}, PRESSABLE).disabled).toBe(
      false,
    );
  });

  describe("set", () => {
    it("clears a handler a present key holds as undefined", () => {
      const { element } = makeElement();
      const onFocusChange = vi.fn();
      const state = new FocusState(element, { onFocusChange }, PRESSABLE);

      state.set({ onFocusChange: undefined });
      state._setFocused(true);

      expect(onFocusChange).not.toHaveBeenCalled();
    });

    it("leaves a handler an absent key does not mention", () => {
      const { element } = makeElement();
      const onFocusChange = vi.fn();
      const state = new FocusState(element, { onFocusChange }, PRESSABLE);

      state.set({ focusId: "row-2" });
      state._setFocused(true);

      expect(state.id).toBe("row-2");
      expect(onFocusChange).toHaveBeenCalledWith(true);
    });

    it("swaps the id, the neighbours and the focusable flag", () => {
      const { element } = makeElement();
      const state = new FocusState(
        element,
        { focusId: "first", focusNeighbors: { up: "last" } },
        PRESSABLE,
      );

      state.set({
        focusId: undefined,
        focusNeighbors: { up: null },
        focusable: false,
      });

      expect(state.id).toBeUndefined();
      expect(state.neighbors).toEqual({ up: null });
      expect(state.focusable).toBe(false);
    });
  });

  describe("_setFocused", () => {
    it("paints before it tells the game", () => {
      const { element } = makeElement();
      const order: string[] = [];
      const state = new FocusState(
        element,
        { onFocusChange: () => order.push("callback") },
        {
          focusableByDefault: true,
          paint: () => order.push("paint"),
        },
      );

      state._setFocused(true);

      expect(order).toEqual(["paint", "callback"]);
    });

    it("fires on the edges only", () => {
      const { element } = makeElement();
      const onFocusChange = vi.fn();
      const paint = vi.fn();
      const state = new FocusState(element, { onFocusChange }, {
        focusableByDefault: true,
        paint,
      } satisfies FocusBehavior);

      state._setFocused(true);
      state._setFocused(true);
      state._setFocused(false);

      expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
      expect(paint.mock.calls).toEqual([[true], [false]]);
      expect(state.focused).toBe(false);
    });

    it("attributes a throwing onFocusChange and rethrows", () => {
      const boundary = new ErrorBoundary(new Logger({ level: LogLevel.None }));
      const root = new MockContainer();
      const { element } = makeElement(root);
      bindUIErrorBoundary(root as unknown as DisplayContainer, boundary);
      const error = new Error("cue failed");
      const state = new FocusState(
        element,
        {
          onFocusChange: () => {
            throw error;
          },
        },
        PRESSABLE,
      );

      expect(() => state._setFocused(true)).toThrow(error);
      expect(boundary.getCallbackErrors()).toEqual([
        { kind: "UI onFocusChange", error: "cue failed" },
      ]);
      // Committed before the callback runs, so state and paint agree.
      expect(state.focused).toBe(true);
    });
  });

  describe("_adjust", () => {
    it("gives left and right to the game's handler", () => {
      const { element } = makeElement();
      const onAdjust = vi.fn();
      const adjust = vi.fn(() => true);
      const state = new FocusState(element, { onAdjust }, {
        focusableByDefault: true,
        adjust,
      } satisfies FocusBehavior);

      expect(state._adjust("left")).toBe(true);
      expect(state._adjust("right")).toBe(true);

      expect(onAdjust.mock.calls).toEqual([[-1], [1]]);
      expect(adjust).not.toHaveBeenCalled();
    });

    it("gives the other axis to the element's own stepper", () => {
      const { element } = makeElement();
      const onAdjust = vi.fn();
      const state = new FocusState(element, { onAdjust }, {
        focusableByDefault: true,
        adjust: (direction) => direction === "down",
      } satisfies FocusBehavior);

      expect(state._adjust("down")).toBe(true);
      expect(state._adjust("up")).toBe(false);
      expect(onAdjust).not.toHaveBeenCalled();
    });

    it("refuses the press when the element has no stepper", () => {
      const { element } = makeElement();
      expect(new FocusState(element, {}, PRESSABLE)._adjust("left")).toBe(
        false,
      );
    });
  });

  describe("getFocusState", () => {
    it("finds the state an element built, until it is destroyed", () => {
      const { element } = makeElement();
      expect(getFocusState(element)).toBeUndefined();

      const state = new FocusState(element, {}, PRESSABLE);
      expect(getFocusState(element)).toBe(state);

      state.destroy();
      expect(getFocusState(element)).toBeUndefined();
    });
  });

  describe("destroy", () => {
    it("clears the scope's reference with no callback and no paint", () => {
      const { element } = makeElement();
      const onFocusChange = vi.fn();
      const paint = vi.fn();
      const state = new FocusState(element, { onFocusChange }, {
        focusableByDefault: true,
        paint,
      } satisfies FocusBehavior);
      const clearFocused = vi.fn();
      state._setScope({
        _clearFocusedOnDestroy: clearFocused,
      } as unknown as UIFocusScope);
      state._setFocused(true);
      onFocusChange.mockClear();
      paint.mockClear();

      state.destroy();

      expect(clearFocused).toHaveBeenCalledWith(element);
      expect(onFocusChange).not.toHaveBeenCalled();
      expect(paint).not.toHaveBeenCalled();
      expect(state.focused).toBe(false);
    });

    it("takes the element's pending pointer request with it", () => {
      const { element } = makeElement();
      const state = new FocusState(element, {}, PRESSABLE);
      requestHoverFocus(element);

      state.destroy();

      expect(takePointerRequest()).toBeNull();
    });
  });
});
