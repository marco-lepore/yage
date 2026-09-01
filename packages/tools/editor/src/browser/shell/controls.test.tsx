// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TextField, type TextFieldProps } from "./controls.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * A box over a value the harness holds, so a commit moves what the box shows
 * the way a real call site's state does.
 */
function createHarness(overrides: Partial<TextFieldProps> = {}) {
  const commits: string[] = [];
  const steps: string[] = [];
  const cancels: number[] = [];
  let value = overrides.value ?? "10";
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  const render = (): void => {
    act(() => {
      root.render(
        <TextField
          label="Count"
          testId="count"
          value={value}
          onCommit={(text) => {
            commits.push(text);
            value = text;
            render();
          }}
          {...overrides}
        />,
      );
    });
  };
  render();
  return {
    host,
    root,
    commits,
    steps,
    cancels,
    value: () => value,
    box: (): HTMLInputElement => {
      const found = host.querySelector<HTMLInputElement>(
        '[data-testid="count"]',
      );
      if (!found) throw new Error("No box rendered.");
      return found;
    },
    label: (): HTMLElement => {
      const found = host.querySelector<HTMLElement>(
        '[data-testid="count-label"]',
      );
      if (!found) throw new Error("No label rendered.");
      return found;
    },
    reason: (): string | undefined =>
      host.querySelector('[data-testid="count-reason"]')?.textContent ??
      undefined,
  };
}

/** A ladder that adds one, ten with Shift, and a tenth with Alt. */
function ladder(steps: string[]) {
  return (
    text: string,
    intent: { direction: 1 | -1; coarse: boolean; fine: boolean },
  ) => {
    const from = Number(text.trim());
    if (!Number.isFinite(from)) return undefined;
    const by = intent.coarse ? 10 : intent.fine ? 0.1 : 1;
    const next = String(Number((from + by * intent.direction).toFixed(4)));
    steps.push(next);
    return next;
  };
}

/** Press a key, answering whether the box took it over from the browser. */
function press(
  box: HTMLInputElement,
  name: string,
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
): boolean {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    box.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function blur(box: HTMLInputElement): void {
  act(() => {
    box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function pointer(
  target: HTMLElement,
  type: string,
  clientX: number,
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX,
        ...modifiers,
      }),
    );
  });
}

/** Click a target, answering whether a handler cancelled it. */
function click(target: HTMLElement): boolean {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail: 1,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("TextField stepping", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      harness.root.unmount();
    });
    harness.host.remove();
  });

  it("leaves the arrows alone in a box that does not step", () => {
    harness = createHarness();

    expect(press(harness.box(), "ArrowUp")).toBe(false);
    expect(harness.box().value).toBe("10");
    expect(harness.commits).toEqual([]);
    // Nothing on the label says it can be dragged, because it cannot.
    expect(harness.label().className).toBe("ye-field__label");
  });

  it("holds a burst of presses as one draft and commits it once", () => {
    const steps: string[] = [];
    harness = createHarness({
      stepping: {
        step: ladder(steps),
        onStep: (text) => steps.push(`!${text}`),
      },
    });
    const box = harness.box();

    expect(press(box, "ArrowUp")).toBe(true);
    press(box, "ArrowUp");
    press(box, "ArrowDown");

    // Each press is visible at once through onStep, and shown in the box.
    expect(steps).toEqual(["11", "!11", "12", "!12", "11", "!11"]);
    expect(box.value).toBe("11");
    expect(harness.commits).toEqual([]);

    blur(box);
    expect(harness.commits).toEqual(["11"]);
  });

  it("takes the coarse unit with Shift and the fine one with Alt", () => {
    harness = createHarness({ stepping: { step: ladder([]) } });
    const box = harness.box();

    press(box, "ArrowUp", { shiftKey: true });
    expect(box.value).toBe("20");
    press(box, "ArrowDown", { altKey: true });
    expect(box.value).toBe("19.9");
  });

  it("commits every press when the value takes no undo entry", () => {
    harness = createHarness({
      stepping: { step: ladder([]), commitEach: true },
    });
    const box = harness.box();

    press(box, "ArrowUp");
    press(box, "ArrowUp");

    expect(harness.commits).toEqual(["11", "12"]);
    expect(box.value).toBe("12");
  });

  it("keeps a refused step in the box and says why", () => {
    harness = createHarness({
      stepping: { step: ladder([]), commitEach: true },
      reject: (text) => (Number(text) > 11 ? "Too many." : undefined),
    });
    const box = harness.box();

    press(box, "ArrowUp");
    press(box, "ArrowUp");

    expect(harness.commits).toEqual(["11"]);
    expect(box.value).toBe("12");
    expect(harness.reason()).toBe("Too many.");
    expect(box.getAttribute("aria-invalid")).toBe("true");
  });

  it("steps nothing while the box is disabled", () => {
    harness = createHarness({ stepping: { step: ladder([]) }, disabled: true });

    press(harness.box(), "ArrowUp");
    expect(harness.box().value).toBe("10");
    expect(harness.commits).toEqual([]);
    // And the label offers no drag either.
    expect(harness.label().className).toBe("ye-field__label");
  });

  it("refuses the press when the box is showing something that is not a number", () => {
    harness = createHarness({ value: "auto", stepping: { step: ladder([]) } });

    press(harness.box(), "ArrowUp");
    expect(harness.box().value).toBe("auto");
    expect(harness.commits).toEqual([]);
  });

  it("gives the arrows to a completion list rather than to the ladder", () => {
    harness = createHarness({
      stepping: { step: ladder([]) },
      completion: { values: ["11", "12"], onOpen: () => undefined },
    });
    const box = harness.box();

    press(box, "ArrowDown");
    expect(box.value).toBe("10");
    expect(harness.host.querySelectorAll('[role="option"]')).toHaveLength(2);
    press(box, "ArrowUp");
    expect(box.value).toBe("10");
    expect(harness.commits).toEqual([]);
  });

  it("puts a stepped draft back on Escape and tells the caller", () => {
    const cancels: number[] = [];
    harness = createHarness({
      stepping: {
        step: ladder([]),
        onCancel: () => {
          cancels.push(1);
        },
      },
    });
    const box = harness.box();

    press(box, "ArrowUp");
    press(box, "Escape");

    expect(box.value).toBe("10");
    expect(cancels).toEqual([1]);
    blur(box);
    expect(harness.commits).toEqual([]);
  });

  it("tells the caller when a step comes back to the value it started from", () => {
    const cancels: number[] = [];
    harness = createHarness({
      stepping: {
        step: ladder([]),
        onCancel: () => {
          cancels.push(1);
        },
      },
    });
    const box = harness.box();

    press(box, "ArrowUp");
    press(box, "ArrowDown");
    blur(box);

    expect(harness.commits).toEqual([]);
    expect(cancels).toEqual([1]);
  });

  describe("dragging the label", () => {
    it("steps once per four pixels and commits on release", () => {
      harness = createHarness({ stepping: { step: ladder([]) } });
      const label = harness.label();

      expect(label.className).toContain("ye-field__label--scrub");
      pointer(label, "pointerdown", 100);
      pointer(label, "pointermove", 112);
      expect(harness.box().value).toBe("13");
      expect(harness.commits).toEqual([]);

      pointer(label, "pointerup", 112);
      expect(harness.commits).toEqual(["13"]);
    });

    it("reads the modifiers at each move, not at the press", () => {
      harness = createHarness({ stepping: { step: ladder([]) } });
      const label = harness.label();

      pointer(label, "pointerdown", 100);
      pointer(label, "pointermove", 104, { shiftKey: true });
      expect(harness.box().value).toBe("20");
      pointer(label, "pointermove", 100);
      expect(harness.box().value).toBe("19");
      pointer(label, "pointerup", 100);
      expect(harness.commits).toEqual(["19"]);
    });

    it("commits nothing when the drag never crossed a step", () => {
      harness = createHarness({ stepping: { step: ladder([]) } });
      const label = harness.label();

      pointer(label, "pointerdown", 100);
      pointer(label, "pointermove", 102);
      pointer(label, "pointerup", 102);

      expect(harness.box().value).toBe("10");
      expect(harness.commits).toEqual([]);
    });

    it("refuses the click a drag ends in, so the box does not take focus", () => {
      harness = createHarness({ stepping: { step: ladder([]) } });
      const label = harness.label();

      pointer(label, "pointerdown", 100);
      pointer(label, "pointermove", 112);
      pointer(label, "pointerup", 112);

      // A click inside a `<label>` focuses the box it wraps, and every
      // one-letter shortcut in the shell would then be typed into the number.
      expect(click(label)).toBe(true);
    });

    it("leaves a press that took no step as an ordinary click", () => {
      harness = createHarness({ stepping: { step: ladder([]) } });
      const label = harness.label();

      pointer(label, "pointerdown", 100);
      pointer(label, "pointermove", 102);
      pointer(label, "pointerup", 102);

      // Nothing was dragged, so this is a click on a label and it may focus
      // the box the way any label does.
      expect(click(label)).toBe(false);
    });

    it("puts the steps back when the pointer is taken away", () => {
      const cancels: number[] = [];
      harness = createHarness({
        stepping: {
          step: ladder([]),
          onCancel: () => {
            cancels.push(1);
          },
        },
      });
      const label = harness.label();

      pointer(label, "pointerdown", 100);
      pointer(label, "pointermove", 112);
      expect(harness.box().value).toBe("13");
      pointer(label, "pointercancel", 112);

      // No final value was delivered, so there is nothing to commit.
      expect(harness.box().value).toBe("10");
      expect(harness.commits).toEqual([]);
      expect(cancels).toEqual([1]);
    });

    it("refuses the press so the words under the pointer are not selected", () => {
      harness = createHarness({ stepping: { step: ladder([]) } });
      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: 100,
      });
      act(() => {
        harness.label().dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
    });
  });
});
