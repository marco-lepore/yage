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

/** An element that takes part in focus navigation, as a button does. */
function makeElement(parent?: MockContainer): {
  element: UIElement;
  container: MockContainer;
} {
  const container = new MockContainer();
  if (parent) container.parent = parent;
  const element = {
    displayObject: container as unknown as DisplayContainer,
  } as unknown as UIElement;
  new FocusState(element, {}, { focusableByDefault: true });
  return { element, container };
}

/** An element with no focus state of its own, as a label is. */
function makePlainElement(parent?: MockContainer): UIElement {
  const container = new MockContainer();
  if (parent) container.parent = parent;
  return {
    displayObject: container as unknown as DisplayContainer,
  } as unknown as UIElement;
}

/** A row under a panel, and a button inside that row. */
function rowAndButton(): { row: UIElement; button: UIElement } {
  const panel = new MockContainer();
  const row = makeElement(panel);
  const button = makeElement(row.container);
  return { row: row.element, button: button.element };
}

describe("pointer request cell", () => {
  beforeEach(() => {
    takePointerRequest();
  });

  it("hands the request back once and leaves the cell empty", () => {
    const { element } = makeElement();

    requestHoverFocus(element);

    expect(takePointerRequest()?.element).toBe(element);
    expect(takePointerRequest()).toBeNull();
  });

  it("is empty until something asks", () => {
    expect(takePointerRequest()).toBeNull();
  });

  it("says the pointer passed over the element", () => {
    const { element } = makeElement();

    requestHoverFocus(element);

    expect(takePointerRequest()?.trigger).toBe("hover");
  });

  it("says the pointer pressed the element", () => {
    const { element } = makeElement();

    requestPressFocus(element);

    expect(takePointerRequest()?.trigger).toBe("press");
  });

  it("keeps the deeper element when a shallower one asks after it", () => {
    const { row, button } = rowAndButton();

    // The order one `pointerover` dispatch produces: the element under the
    // pointer first, then the focusable ancestor it bubbles to.
    requestHoverFocus(button);
    requestHoverFocus(row);

    expect(takePointerRequest()?.element).toBe(button);
  });

  it("takes the deeper element when it asks after a shallower one", () => {
    const { row, button } = rowAndButton();

    requestHoverFocus(row);
    requestHoverFocus(button);

    expect(takePointerRequest()?.element).toBe(button);
  });

  it("keeps the deeper element of a press dispatch too", () => {
    const { row, button } = rowAndButton();

    requestPressFocus(button);
    requestPressFocus(row);

    const request = takePointerRequest();
    expect(request?.element).toBe(button);
    expect(request?.trigger).toBe("press");
  });

  it("takes the press over the hover that came before it", () => {
    const { element } = makeElement();

    requestHoverFocus(element);
    requestPressFocus(element);

    expect(takePointerRequest()?.trigger).toBe("press");
  });

  it("takes a press on one element over a hover on another", () => {
    const { element } = makeElement();
    const pressed = makeElement().element;

    requestHoverFocus(element);
    requestPressFocus(pressed);

    const request = takePointerRequest();
    expect(request?.element).toBe(pressed);
    expect(request?.trigger).toBe("press");
  });

  it("keeps a press through a hover the same drag moved on to", () => {
    const { element } = makeElement();
    const hovered = makeElement().element;

    // The pointer pressed one control and was dragged over another before a
    // scope ticked. The press is where the player aimed.
    requestPressFocus(element);
    requestHoverFocus(hovered);

    const request = takePointerRequest();
    expect(request?.element).toBe(element);
    expect(request?.trigger).toBe("press");
  });

  it("takes a request from elsewhere over one nothing consumed", () => {
    const { button } = rowAndButton();
    const elsewhere = makeElement().element;

    // No scope ticked between the two pointer moves, so the first request is
    // still in the cell when the second arrives from another subtree.
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
    const container = new MockContainer();
    const element = {
      displayObject: container as unknown as DisplayContainer,
    } as unknown as UIElement;
    new FocusState(element, { focusable: false }, { focusableByDefault: true });

    requestHoverFocus(element);
    requestPressFocus(element);

    expect(takePointerRequest()).toBeNull();
  });

  it("drops a request from an element with no focus state", () => {
    requestHoverFocus(makePlainElement());

    expect(takePointerRequest()).toBeNull();
  });

  it("leaves a focusable ancestor's request in place under a label", () => {
    const panel = new MockContainer();
    const row = makeElement(panel);
    const label = makePlainElement(row.container);

    requestHoverFocus(label);
    requestHoverFocus(row.element);

    expect(takePointerRequest()?.element).toBe(row.element);
  });

  it("presses the focusable row a press on a plain label bubbled to", () => {
    const panel = new MockContainer();
    const row = makeElement(panel);
    const label = makePlainElement(row.container);

    requestPressFocus(label);
    requestPressFocus(row.element);

    const request = takePointerRequest();
    expect(request?.element).toBe(row.element);
    expect(request?.trigger).toBe("press");
  });

  it("starts fresh after the cell is taken", () => {
    const { row, button } = rowAndButton();

    requestPressFocus(button);
    takePointerRequest();
    requestHoverFocus(row);

    const request = takePointerRequest();
    expect(request?.element).toBe(row);
    expect(request?.trigger).toBe("hover");
  });

  it("empties on a frame end nothing consumed it in", () => {
    const { element } = makeElement();
    requestPressFocus(element);

    clearPointerRequest();

    expect(takePointerRequest()).toBeNull();
  });

  it("takes a hover once a cleared frame dropped the press before it", () => {
    const { element } = makeElement();
    const hovered = makeElement().element;
    requestPressFocus(element);
    clearPointerRequest();

    requestHoverFocus(hovered);

    expect(takePointerRequest()?.element).toBe(hovered);
  });

  it("drops the request of an element being torn down", () => {
    const { element } = makeElement();
    requestHoverFocus(element);

    releasePointerRequest(element);

    expect(takePointerRequest()).toBeNull();
  });

  it("keeps a request another element made while one is torn down", () => {
    const { element } = makeElement();
    const other = makeElement().element;
    requestHoverFocus(element);

    releasePointerRequest(other);

    expect(takePointerRequest()?.element).toBe(element);
  });
});
