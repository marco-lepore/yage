import { beforeAll, describe, expect, it } from "vitest";
import {
  Container,
  EventBoundary,
  extensions,
  FederatedContainer,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
} from "pixi.js";
import { isPointerConsumeContainer } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import { clearConsumeInput, createPointerBlocker } from "./consume-input.js";

// Pixi puts the pointer members on `Container` when a renderer is built. These
// tests run its hit test with no renderer, so they install the mixin
// themselves and then search a tree the way a real canvas does.
beforeAll(() => {
  extensions.mixin(Container, FederatedContainer);
});

/**
 * A leaf that answers the pointer across one box. The box is its hit area, not
 * a position: no frame is drawn here, so Pixi composes no transforms.
 */
function hitSurface(x: number, y: number, size = 20): Container {
  const container = new Container();
  container.eventMode = "static";
  container.hitArea = new Rectangle(x, y, size, size);
  return container;
}

/** What Pixi's own hit test finds at a point, given a tree to search. */
function hitAt(root: Container, x: number, y: number): unknown {
  return new EventBoundary(root).hitTest(x, y);
}

/** The pointer events a UI element listens for. */
const POINTER_EVENTS = [
  "pointerover",
  "pointerout",
  "pointerdown",
  "pointerup",
  "pointerupoutside",
  "click",
  "pointertap",
] as const;

/** One event from the mouse, the way the event system hands one over. */
function pointerEvent(
  boundary: EventBoundary,
  type: string,
  x: number,
  y: number,
): FederatedPointerEvent {
  const event = new FederatedPointerEvent(boundary);
  event.type = type;
  event.global.set(x, y);
  event.pointerId = 1;
  event.pointerType = "mouse";
  event.button = 0;
  event.buttons = 1;
  event.isPrimary = true;
  event.nativeEvent = { type } as never;
  return event;
}

describe("createPointerBlocker", () => {
  it("claims the pointer for the UI until the mark is cleared", () => {
    const blocker = createPointerBlocker();
    expect(isPointerConsumeContainer(blocker)).toBe(true);
    expect(blocker.eventMode).toBe("static");

    clearConsumeInput(blocker);
    expect(isPointerConsumeContainer(blocker)).toBe(false);
  });

  it("answers the hit test wherever it is asked, and draws nothing", () => {
    const root = new Container();
    root.addChild(hitSurface(0, 0, 30));
    const before = root.getLocalBounds().rectangle.clone();
    const blocker = createPointerBlocker();
    root.addChildAt(blocker as Container, 0);

    expect(hitAt(root, 4000, -9000)).toBe(blocker);
    expect(root.getLocalBounds().rectangle).toEqual(before);
  });
});

describe("a pointer blocker under a dialog", () => {
  interface Tree {
    root: Container;
    behind: Container;
    dialog: Container;
    dialogRow: Container;
    blocker: DisplayContainer;
  }

  /**
   * A menu row and, drawn over it, a dialog holding a row of its own. The
   * blocker goes at the bottom of the dialog, where a modal scope puts it.
   */
  function buildTree(): Tree {
    const root = new Container();
    const behind = hitSurface(0, 0);
    root.addChild(behind);
    const dialog = new Container();
    root.addChild(dialog);
    const blocker = createPointerBlocker();
    dialog.addChild(blocker as Container);
    const dialogRow = hitSurface(200, 200);
    dialog.addChild(dialogRow);
    return { root, behind, dialog, dialogRow, blocker };
  }

  /** Keep the dialog inside the 100 x 100 box at (200, 200). */
  function clip(dialog: Container): void {
    const mask = new Graphics();
    mask.rect(200, 200, 100, 100);
    mask.fill({ color: 0xffffff });
    dialog.addChild(mask);
    dialog.setMask({ mask });
  }

  /** Record every pointer event the menu row hears. */
  function listen(behind: Container): string[] {
    const heard: string[] = [];
    for (const type of POINTER_EVENTS) {
      behind.on(type as "pointerdown", () => heard.push(type));
    }
    return heard;
  }

  it("swallows every point but the dialog's own rows, while the dialog shows", () => {
    const { root, behind, dialog, dialogRow, blocker } = buildTree();

    expect(hitAt(root, 10, 10)).toBe(blocker);
    expect(hitAt(root, 290, 290)).toBe(blocker);
    expect(hitAt(root, 210, 210)).toBe(dialogRow);

    dialog.visible = false;
    expect(hitAt(root, 10, 10)).toBe(behind);

    dialog.visible = true;
    blocker.removeFromParent();
    expect(hitAt(root, 10, 10)).toBe(behind);
  });

  it("blocks only what is outside the scope it sits in", () => {
    const { root, dialog } = buildTree();
    // A second blocker, for a scope nested inside the dialog.
    const nested = new Container();
    dialog.addChild(nested);
    const inner = createPointerBlocker();
    nested.addChild(inner as Container);
    const innerRow = hitSurface(210, 210, 5);
    nested.addChild(innerRow);

    expect(hitAt(root, 212, 212)).toBe(innerRow);
    // The dialog's own row at (205, 205) goes to the nested blocker too.
    expect(hitAt(root, 205, 205)).toBe(inner);
    expect(hitAt(root, 10, 10)).toBe(inner);
  });

  it("ends a press the pointer began before it, without a click", () => {
    const { root, behind, dialog, blocker } = buildTree();
    blocker.removeFromParent();
    const heard = listen(behind);
    const boundary = new EventBoundary(root);
    boundary.mapEvent(pointerEvent(boundary, "pointermove", 10, 10));
    boundary.mapEvent(pointerEvent(boundary, "pointerdown", 10, 10));
    expect(heard).toEqual(["pointerover", "pointerdown"]);

    // The dialog takes the pointer while the press is still down.
    dialog.addChild(blocker as Container);
    heard.length = 0;
    boundary.mapEvent(pointerEvent(boundary, "pointerup", 10, 10));

    expect(heard).toEqual(["pointerupoutside"]);
  });

  it("clears the look of an element hovered before it, on the next move", () => {
    const { root, behind, dialog, blocker } = buildTree();
    blocker.removeFromParent();
    const heard = listen(behind);
    const boundary = new EventBoundary(root);
    boundary.mapEvent(pointerEvent(boundary, "pointermove", 10, 10));
    expect(heard).toEqual(["pointerover"]);

    // Pixi hit-tests on a pointer event only, so the hover look stays until
    // the pointer moves.
    dialog.addChild(blocker as Container);
    heard.length = 0;
    boundary.mapEvent(pointerEvent(boundary, "pointermove", 11, 11));

    expect(heard).toEqual(["pointerout"]);
  });

  it("answers only inside a clip on the container holding it", () => {
    const { root, behind, dialog, blocker } = buildTree();
    clip(dialog);

    expect(hitAt(root, 250, 250)).toBe(blocker);
    // Pixi reads the clip at the dialog and prunes the blocker with it.
    expect(hitAt(root, 10, 10)).toBe(behind);
  });

  it("answers everywhere from the far side of a clipped container", () => {
    const { root, dialog, dialogRow, blocker } = buildTree();
    clip(dialog);
    // Directly under the clipped dialog, where a modal scope seats it when
    // something between its host and the screen clips.
    root.addChildAt(blocker as Container, root.children.indexOf(dialog));

    expect(hitAt(root, 10, 10)).toBe(blocker);
    expect(hitAt(root, 210, 210)).toBe(dialogRow);
  });
});
