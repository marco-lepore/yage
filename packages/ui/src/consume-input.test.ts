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
 * A leaf that answers the pointer across one box, the way a panel does.
 *
 * The box is the leaf's own hit area rather than a position, because Pixi
 * composes the transforms these points would be read through while it draws
 * a frame, and no frame is drawn here. Every container therefore sits at the
 * origin and each box says where it is.
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
  it("claims the pointer for the UI, so a press on it never reaches the game", () => {
    const blocker = createPointerBlocker();

    expect(isPointerConsumeContainer(blocker)).toBe(true);
    expect(blocker.eventMode).toBe("static");
  });

  it("gives the mark back, so a torn-down blocker claims nothing", () => {
    const blocker = createPointerBlocker();

    clearConsumeInput(blocker);

    expect(isPointerConsumeContainer(blocker)).toBe(false);
  });

  it("answers the hit test wherever it is asked", () => {
    const root = new Container();
    const blocker = createPointerBlocker();
    root.addChild(blocker as Container);

    expect(hitAt(root, 0, 0)).toBe(blocker);
    expect(hitAt(root, 4000, -9000)).toBe(blocker);
  });

  it("draws nothing, so a parent measures the same box with it or without", () => {
    const parent = new Container();
    parent.addChild(hitSurface(0, 0, 30));
    const before = parent.getLocalBounds().rectangle.clone();

    parent.addChildAt(createPointerBlocker() as Container, 0);

    expect(parent.getLocalBounds().rectangle).toEqual(before);
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

  it("swallows a point over the menu behind it", () => {
    const { root, behind, blocker } = buildTree();

    expect(hitAt(root, 10, 10)).toBe(blocker);
    expect(hitAt(root, 10, 10)).not.toBe(behind);
  });

  it("leaves the menu answering once the blocker is taken away", () => {
    const { root, behind, blocker } = buildTree();

    blocker.removeFromParent();

    expect(hitAt(root, 10, 10)).toBe(behind);
  });

  it("leaves the dialog's own rows answering", () => {
    const { root, dialogRow } = buildTree();

    expect(hitAt(root, 210, 210)).toBe(dialogRow);
  });

  it("swallows the gap inside the dialog that no row of its own covers", () => {
    const { root, blocker } = buildTree();

    expect(hitAt(root, 290, 290)).toBe(blocker);
  });

  it("blocks only what is outside the scope it sits in", () => {
    const { root, dialog, dialogRow } = buildTree();
    // A second blocker, for a scope nested inside the dialog.
    const nested = new Container();
    dialog.addChild(nested);
    const inner = createPointerBlocker();
    nested.addChild(inner as Container);
    const innerRow = hitSurface(210, 210, 5);
    nested.addChild(innerRow);

    // The nested scope's own row keeps the point it covers.
    expect(hitAt(root, 212, 212)).toBe(innerRow);
    // Everything around it, the dialog's own row included, goes to the
    // nested blocker rather than to the blocker under the dialog.
    expect(hitAt(root, 205, 205)).toBe(inner);
    expect(hitAt(root, 10, 10)).toBe(inner);
    expect(hitAt(root, 205, 205)).not.toBe(dialogRow);
  });

  it("stops answering while the subtree holding it is hidden", () => {
    const { root, behind, dialog } = buildTree();

    dialog.visible = false;

    expect(hitAt(root, 10, 10)).toBe(behind);
  });

  it("ends a press the pointer began before it, without a click", () => {
    const { root, behind, dialog, blocker } = buildTree();
    blocker.removeFromParent();
    const heard: string[] = [];
    for (const type of POINTER_EVENTS) {
      behind.on(type as "pointerdown", () => heard.push(type));
    }
    const boundary = new EventBoundary(root);
    boundary.mapEvent(pointerEvent(boundary, "pointermove", 10, 10));
    boundary.mapEvent(pointerEvent(boundary, "pointerdown", 10, 10));
    expect(heard).toEqual(["pointerover", "pointerdown"]);

    // The dialog takes the pointer while the press is still down.
    dialog.addChild(blocker as Container);
    heard.length = 0;
    boundary.mapEvent(pointerEvent(boundary, "pointerup", 10, 10));

    // The release the element hears is one that landed elsewhere, which the
    // pointer path already refuses to turn into a click.
    expect(heard).toEqual(["pointerupoutside"]);
  });

  it("answers only inside a clip on the container holding it", () => {
    const { root, behind, dialog, blocker } = buildTree();
    // The dialog keeps its rows inside the 100 x 100 box at (200, 200), the
    // way a panel that hides its overflow does.
    const clip = new Graphics();
    clip.rect(200, 200, 100, 100);
    clip.fill({ color: 0xffffff });
    dialog.addChild(clip);
    dialog.setMask({ mask: clip });

    // (250, 250) is inside the clip and on no row of the dialog's own.
    expect(hitAt(root, 250, 250)).toBe(blocker);
    // (10, 10) is outside it, on the menu row at (0, 0) — and the menu row is
    // what answers, because Pixi reads the clip at the dialog and prunes the
    // blocker with the rest of the subtree before its hit area is asked.
    expect(hitAt(root, 10, 10)).toBe(behind);
  });

  it("answers everywhere from the far side of a clipped container", () => {
    const { root, behind, dialog, dialogRow, blocker } = buildTree();
    const clip = new Graphics();
    clip.rect(200, 200, 100, 100);
    clip.fill({ color: 0xffffff });
    dialog.addChild(clip);
    dialog.setMask({ mask: clip });
    // Out of the clipped dialog and directly under it, where a modal scope
    // seats it when something between its host and the screen clips.
    root.addChildAt(blocker as Container, root.children.indexOf(dialog));

    expect(hitAt(root, 10, 10)).toBe(blocker);
    expect(hitAt(root, 10, 10)).not.toBe(behind);
    // The dialog's own row, inside the clip, still answers for itself.
    expect(hitAt(root, 210, 210)).toBe(dialogRow);
  });

  it("clears the look of an element hovered before it, on the next move", () => {
    const { root, behind, dialog, blocker } = buildTree();
    blocker.removeFromParent();
    const heard: string[] = [];
    for (const type of POINTER_EVENTS) {
      behind.on(type as "pointerdown", () => heard.push(type));
    }
    const boundary = new EventBoundary(root);
    boundary.mapEvent(pointerEvent(boundary, "pointermove", 10, 10));
    expect(heard).toEqual(["pointerover"]);

    dialog.addChild(blocker as Container);
    heard.length = 0;
    // The hover look stays until the pointer moves: Pixi hit-tests on a
    // pointer event and on nothing else, so a player who reaches for the
    // gamepad leaves a lit row behind the dialog.
    expect(heard).toEqual([]);

    boundary.mapEvent(pointerEvent(boundary, "pointermove", 11, 11));

    expect(heard).toEqual(["pointerout"]);
  });
});
