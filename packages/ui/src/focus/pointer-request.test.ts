import { describe, it, expect, beforeEach } from "vitest";
import type { DisplayContainer } from "@yagejs/renderer";
import type { UIElement } from "../types.js";
import { FocusState } from "./FocusState.js";
import {
  clearPointerRequest,
  releasePointerRequest,
  requestHoverFocus,
  requestPressFocus,
  takePointerRequest,
} from "./pointer-request.js";

/** Minimal Pixi-Container stand-in: the parent chain a depth walk reads. */
class MockContainer {
  parent: MockContainer | null = null;
}

/** An element with no focus state of its own, as a label is. */
function makePlainElement(parent?: MockContainer): {
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

/** An element that takes part in focus navigation, as a button does. */
function makeElement(parent?: MockContainer): {
  element: UIElement;
  container: MockContainer;
} {
  const made = makePlainElement(parent);
  new FocusState(made.element, {}, { focusableByDefault: true });
  return made;
}

/** A row under a panel, and a button inside that row. */
function rowAndButton(): { row: UIElement; button: UIElement } {
  const row = makeElement(new MockContainer());
  const button = makeElement(row.container);
  return { row: row.element, button: button.element };
}

/** Take the cell and check it holds this very element. */
function expectTaken(element: UIElement, trigger: Trigger): void {
  const request = takePointerRequest();
  expect(request?.element).toBe(element);
  expect(request?.trigger).toBe(trigger);
}

const REQUEST = { hover: requestHoverFocus, press: requestPressFocus };
type Trigger = keyof typeof REQUEST;

describe("pointer request cell", () => {
  beforeEach(() => {
    takePointerRequest();
  });

  it.each(["hover", "press"] as const)(
    "hands a %s request back once and leaves the cell empty",
    (trigger) => {
      const { element } = makeElement();
      expect(takePointerRequest()).toBeNull();

      REQUEST[trigger](element);

      expectTaken(element, trigger);
      expect(takePointerRequest()).toBeNull();
    },
  );

  // One dispatch reaches the element under the pointer first, then the
  // focusable ancestor it bubbles to.
  it.each<[Trigger, "button" | "row", "button" | "row"]>([
    ["hover", "button", "row"],
    ["hover", "row", "button"],
    ["press", "button", "row"],
  ])("keeps the deeper element of a %s, %s asking first", (trigger, a, b) => {
    const pair = rowAndButton();

    REQUEST[trigger](pair[a]);
    REQUEST[trigger](pair[b]);

    expectTaken(pair.button, trigger);
  });

  it.each<[string, [Trigger, 0 | 1][], 0 | 1]>([
    [
      "a press over the hover before it",
      [
        ["hover", 0],
        ["press", 0],
      ],
      0,
    ],
    [
      "a press on one element over a hover on another",
      [
        ["hover", 0],
        ["press", 1],
      ],
      1,
    ],
    [
      "a press through a hover the same drag moved on to",
      [
        ["press", 0],
        ["hover", 1],
      ],
      0,
    ],
  ])("takes %s", (_name, steps, expected) => {
    const elements = [makeElement().element, makeElement().element] as const;

    for (const [trigger, index] of steps) REQUEST[trigger](elements[index]);

    expectTaken(elements[expected], "press");
  });

  it("takes a request from elsewhere over one nothing consumed", () => {
    const { button } = rowAndButton();
    const elsewhere = makeElement().element;

    requestHoverFocus(button);
    requestHoverFocus(elsewhere);

    expect(takePointerRequest()?.element).toBe(elsewhere);
  });

  it("takes the later of two requests at one depth", () => {
    const panel = new MockContainer();
    const first = makeElement(panel).element;
    const second = makeElement(panel).element;

    requestHoverFocus(first);
    requestHoverFocus(second);

    expect(takePointerRequest()?.element).toBe(second);
  });

  it("drops a request from an element outside focus navigation", () => {
    const { element } = makePlainElement();
    new FocusState(element, { focusable: false }, { focusableByDefault: true });

    requestHoverFocus(element);
    requestPressFocus(element);
    requestHoverFocus(makePlainElement().element);

    expect(takePointerRequest()).toBeNull();
  });

  it.each(["hover", "press"] as const)(
    "gives a %s on a plain label to the focusable row it bubbled to",
    (trigger) => {
      const row = makeElement(new MockContainer());
      const label = makePlainElement(row.container).element;

      REQUEST[trigger](label);
      REQUEST[trigger](row.element);

      expectTaken(row.element, trigger);
    },
  );

  it("starts fresh after the cell is taken", () => {
    const { row, button } = rowAndButton();

    requestPressFocus(button);
    takePointerRequest();
    requestHoverFocus(row);

    expectTaken(row, "hover");
  });

  it("empties on a frame end nothing consumed it in, press included", () => {
    const { element } = makeElement();
    const hovered = makeElement().element;
    requestPressFocus(element);

    clearPointerRequest();
    expect(takePointerRequest()).toBeNull();

    requestPressFocus(element);
    clearPointerRequest();
    requestHoverFocus(hovered);
    expect(takePointerRequest()?.element).toBe(hovered);
  });

  it("drops only the request of the element being torn down", () => {
    const { element } = makeElement();
    const other = makeElement().element;
    requestHoverFocus(element);

    releasePointerRequest(other);
    expectTaken(element, "hover");

    requestHoverFocus(element);
    releasePointerRequest(element);
    expect(takePointerRequest()).toBeNull();
  });
});
