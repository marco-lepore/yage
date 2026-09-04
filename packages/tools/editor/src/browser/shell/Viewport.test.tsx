// @vitest-environment happy-dom
import type { LevelDocument } from "@yagejs/level/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoseEdit } from "../../shared/commands/index.js";
import type { DraftSnapshot } from "../../shared/protocol/index.js";
import { CommandController } from "../commands/index.js";
import {
  DEFAULT_VIEW,
  EditorStore,
  type DraftApi,
  type GizmoAnchor,
  type GizmoMode,
  type GizmoReference,
  type HandleId,
} from "../store/index.js";
import {
  Viewport,
  cssCursor,
  cursorFor,
  type ViewportCursor,
} from "./Viewport.js";

/** A drag ends by sending one command; these cases stop before it lands. */
const unusedApi: DraftApi = {
  sendCommand: () => Promise.reject(new Error("not used")),
  undo: () => Promise.reject(new Error("not used")),
  redo: () => Promise.reject(new Error("not used")),
};

const level: LevelDocument = {
  format: "yage-level",
  version: 1,
  id: "forest",
  metadata: {},
  entities: [
    {
      id: "crate",
      type: "game.crate",
      typeVersion: 1,
      active: true,
      transform: {
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      params: {},
      extensions: {},
    },
  ],
  extensions: {},
};

const snapshot: DraftSnapshot = {
  path: "levels/forest.yage-level.json",
  epoch: "epoch-1",
  document: level,
  draftRevision: 0,
  diskRevision: "disk-1",
  contentHash: "content-0",
  savedContentHash: "content-0",
  dirty: false,
  history: { undoDepth: 0, redoDepth: 0 },
};

function createHarness(
  hit: string | null | (() => string | null),
  grab?: () => {
    readonly mode: GizmoMode;
    readonly handle: HandleId;
    readonly anchor: GizmoAnchor;
    readonly reference: GizmoReference;
  } | null,
  /** Whether every press counts as a missed grab. Off unless a case says so. */
  near = false,
  /** What a marquee covers, for the cases that drag one. */
  covered: readonly string[] = [],
  /** What the mark under the pointer stands for, when a case draws one. */
  named: string | null = null,
  /** The reference target under the pointer, for the cases that arm a pick. */
  picked: string | null = null,
  /** The parameter handle under the pointer, for the cases that drag one. */
  value?: () => {
    readonly id: string;
    readonly field: string;
    readonly grip: HandleId;
  } | null,
) {
  const store = new EditorStore({
    api: unusedApi,
    epoch: "epoch-1",
    projectId: "project-1",
  });
  store.dispatch({ type: "level-opened", snapshot });
  // Off unless a case turns it on: these cases are about what a pointer event
  // means, and a lattice would round every position they assert.
  store.dispatch({ type: "snap-toggled" });

  const drafts: PoseEdit[][] = [];
  const removed: string[][] = [];
  const commands = new CommandController({
    store,
    preview: {
      applyPoseDraft: (poses) => drafts.push([...poses]),
      viewportCenter: () => undefined,
      freeSpotNear: (point: { x: number; y: number }) => point,
    },
    catalog: () => undefined,
  });
  // `deletePlacements` reaches the store; recording the call is what these
  // cases are about, and the controller's own tests cover what it does with one.
  commands.deletePlacements = (ids) => {
    removed.push([...ids]);
    return Promise.resolve();
  };
  // The same, for the parameter drag: what a press routes to is this
  // component's business, and what the controller does with it is its own.
  const valueDrags: string[] = [];
  commands.beginParamDrag = (id, field, grip, origin) => {
    valueDrags.push(
      `begin ${id}.${field} ${grip} at ${String(origin.x)},${String(origin.y)}`,
    );
    store.dispatch({
      type: "param-drag-started",
      drag: {
        id,
        field,
        kind: "point",
        grip,
        relative: false,
        from: origin,
        origin,
        current: origin,
        constrained: false,
        suspended: false,
      },
    });
  };
  commands.updateParamDrag = (current, modifiers = {}) => {
    valueDrags.push(
      `move ${String(current.x)},${String(current.y)}${modifiers.constrained === true ? " shift" : ""}`,
    );
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(
      <Viewport
        canvasHost={document.createElement("div")}
        store={store}
        commands={commands}
        preview={{
          hitTest: () => (typeof hit === "function" ? hit() : hit),
          // No gizmo unless a case asks for one: these drive selection, drags,
          // and the view, none of which a handle takes part in.
          gizmoAt: () => grab?.() ?? null,
          paramHandleAt: () => value?.() ?? null,
          gizmoNear: () => near,
          markAt: () => named,
          pickAt: () => picked,
          placementsWithin: () => covered,
          // The identity conversion keeps the arithmetic under test in the
          // controller rather than in a stand-in camera.
          screenToWorld: (point) => point,
        }}
      />,
    );
  });

  const frame = host.querySelector<HTMLElement>(
    '[data-testid="yage-editor-viewport"]',
  );
  if (!frame) throw new Error("The viewport did not render.");
  // happy-dom lays nothing out, so pointer coordinates are already frame-local.
  frame.setPointerCapture = () => {};
  frame.releasePointerCapture = () => {};

  return { store, drafts, removed, valueDrags, host, root, frame };
}

function key(frame: HTMLElement, value: string): boolean {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: value,
  });
  act(() => {
    frame.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function pointer(
  frame: HTMLElement,
  type: string,
  x: number,
  y: number,
  button = 0,
  pointerId = 1,
  modifiers: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): void {
  act(() => {
    frame.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId,
        button,
        ...modifiers,
      }),
    );
  });
}

/** Hold or release the space bar on the window. Returns whether it was consumed. */
function space(
  down: boolean,
  target: EventTarget = window,
  repeat = false,
): boolean {
  const event = new KeyboardEvent(down ? "keydown" : "keyup", {
    bubbles: true,
    cancelable: true,
    key: " ",
    code: "Space",
    repeat,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Returns whether the page's own scrolling was suppressed. */
function wheel(frame: HTMLElement, deltaY: number, x = 0, y = 0): boolean {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY,
  });
  // happy-dom's `WheelEvent` constructor drops the pointer position its
  // `MouseEvent` half carries, and the handler zooms around exactly that.
  Object.defineProperty(event, "clientX", { value: x });
  Object.defineProperty(event, "clientY", { value: y });
  act(() => {
    frame.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("Viewport", () => {
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

  it("leaves space to a focused button instead of arming a pan", () => {
    harness = createHarness("crate");
    const button = document.createElement("button");
    document.body.append(button);

    // Defaulting the keystroke away here would cancel the button's own
    // activation, which is how every control in the shell is pressed.
    expect(space(true, button)).toBe(false);

    // And nothing armed: a left press still drags the placement under it.
    pointer(harness.frame, "pointerdown", 10, 10);
    expect(harness.store.getState().gesture).toBeDefined();

    button.remove();
  });

  it("refuses a pan while a placement drag is running", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 10, 10);
    const view = harness.store.getState().view;

    pointer(harness.frame, "pointerdown", 10, 10, 1);
    pointer(harness.frame, "pointermove", 40, 10);

    // The drag kept the pointer: the placement moved and the view did not.
    expect(harness.store.getState().view).toBe(view);
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 30,
      y: 0,
    });
  });

  it("leaves a running drag alone when a second pointer presses empty space", () => {
    let over: string | null = "crate";
    harness = createHarness(() => over);
    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 30, 10);
    const view = harness.store.getState().view;

    // Capture on the first pointer does not redirect the second, so a pen and
    // a finger both reach this handler.
    over = null;
    pointer(harness.frame, "pointerdown", 200, 200, 0, 2);

    expect(harness.store.getState().view).toBe(view);
    expect([...harness.store.getState().selection]).toEqual(["crate"]);

    // And the first pointer still owns the drag.
    over = "crate";
    pointer(harness.frame, "pointermove", 50, 10);
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 40,
      y: 0,
    });
  });

  it("does not settle the drag when another button is released during it", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 30, 10);

    // A mouse puts every button on one pointer, so this arrives as a release
    // of the pointer that is dragging.
    pointer(harness.frame, "pointerdown", 30, 10, 1);
    pointer(harness.frame, "pointerup", 30, 10, 1);

    expect(harness.store.getState().gesture).toBeDefined();
    pointer(harness.frame, "pointermove", 60, 10);
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 50,
      y: 0,
    });
  });

  it("keeps a middle-button pan running when another button is released", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 10, 10, 1);
    pointer(harness.frame, "pointermove", 40, 10);
    const view = harness.store.getState().view;

    // The left button goes down and up while the middle one is still held.
    pointer(harness.frame, "pointerdown", 40, 10);
    pointer(harness.frame, "pointerup", 40, 10);

    pointer(harness.frame, "pointermove", 60, 10);
    expect(harness.store.getState().view.center.x).toBeLessThan(view.center.x);
  });

  it("starts a gizmo gesture from a handle, ahead of the placement under it", () => {
    const anchor = { position: { x: 0, y: 0 }, rotation: 0 };
    harness = createHarness("crate", () => ({
      mode: "rotate" as const,
      handle: "ring" as const,
      anchor,
      reference: { x: 64, y: 64, kind: "length" },
    }));
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    pointer(harness.frame, "pointerdown", 10, 0);

    const gesture = harness.store.getState().gesture;
    expect(gesture?.kind).toBe("rotate");
    expect(gesture?.handle).toBe("ring");
    expect(gesture?.anchor).toEqual(anchor);
  });

  it("pans from empty space only when no handle is there", () => {
    const anchor = { position: { x: 0, y: 0 }, rotation: 0 };
    harness = createHarness(null, () => ({
      mode: "translate" as const,
      handle: "x" as const,
      anchor,
      reference: { x: 64, y: 64, kind: "length" },
    }));
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    const view = harness.store.getState().view;

    // An arm reaches past its placement's bounds, so the hit test misses and
    // the press would otherwise pan.
    pointer(harness.frame, "pointerdown", 64, 0);
    pointer(harness.frame, "pointermove", 90, 0);

    expect(harness.store.getState().view).toBe(view);
    expect(harness.store.getState().gesture?.handle).toBe("x");
  });

  it("keeps the drag when a second pointer cancels", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 30, 10);

    // A palm landing and lifting, or a pen leaving range, cancels its own
    // pointer and not the one making the edit.
    pointer(harness.frame, "pointercancel", 0, 0, 0, 2);

    expect(harness.store.getState().gesture).toBeDefined();
    pointer(harness.frame, "pointermove", 50, 10);
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 40,
      y: 0,
    });
  });

  it("ignores a second pointer's release of the drag", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 30, 10);

    pointer(harness.frame, "pointerup", 30, 10, 0, 2);

    expect(harness.store.getState().gesture).toBeDefined();
  });

  it("disarms space when the window loses focus", () => {
    harness = createHarness("crate");
    space(true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    // The key was released somewhere this page never saw, so a press on the
    // placement drags it rather than panning.
    pointer(harness.frame, "pointerdown", 10, 10);
    expect(harness.store.getState().gesture).toBeDefined();
  });

  it("selects the placement under the pointer and drags it", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 10, 10);

    expect([...harness.store.getState().selection]).toEqual(["crate"]);
    expect(harness.store.getState().gesture?.origin).toEqual({ x: 10, y: 10 });

    pointer(harness.frame, "pointermove", 30, 10);
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 20,
      y: 0,
    });

    pointer(harness.frame, "pointerup", 30, 10);
    expect(harness.store.getState().gesture).toBeUndefined();
  });

  it("carries both modifiers as they stand on each pointer move", () => {
    harness = createHarness("crate");
    // Snapping is what the suspend modifier suspends, so this case is one of
    // the few that turns it on.
    harness.store.dispatch({ type: "snap-toggled" });
    harness.store.dispatch({ type: "step-changed", step: 10 });
    pointer(harness.frame, "pointerdown", 0, 0);

    pointer(harness.frame, "pointermove", 13, 4);
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 10,
      y: 0,
    });

    pointer(harness.frame, "pointermove", 13, 4, 0, 1, { altKey: true });
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 13,
      y: 4,
    });

    // Dropped again part-way through, without a fresh press.
    pointer(harness.frame, "pointermove", 13, 4);
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: 10,
      y: 0,
    });
  });

  it("clears the selection when the pointer lands on nothing", () => {
    harness = createHarness(null);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    pointer(harness.frame, "pointerdown", 10, 10);

    expect([...harness.store.getState().selection]).toEqual([]);
    expect(harness.store.getState().gesture).toBeUndefined();
  });

  it("keeps the selection when a press misses a handle", () => {
    // The press lands on nothing, near the gizmo. Clearing the selection would
    // take the gizmo away at the moment it was being reached for.
    harness = createHarness(null, undefined, true);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    pointer(harness.frame, "pointerdown", 10, 10);

    expect([...harness.store.getState().selection]).toEqual(["crate"]);
    // It still pans, which is what a press on empty space does.
    pointer(harness.frame, "pointermove", 0, 10);
    expect(harness.store.getState().view.center).toEqual({ x: 10, y: 0 });
  });

  it("still selects what is under a press that misses a handle", () => {
    // Near the gizmo but over another placement: the placement wins, because
    // the guard is about not losing the selection to empty space.
    harness = createHarness("barrel", undefined, true);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    pointer(harness.frame, "pointerdown", 10, 10);

    expect([...harness.store.getState().selection]).toEqual(["barrel"]);
  });

  it("ignores pointer moves when no drag is running", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointermove", 30, 10);

    expect(harness.drafts).toEqual([]);
  });

  it("takes focus on a press, so the delete key reaches it", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 10, 10);

    expect(document.activeElement).toBe(harness.frame);
  });

  it("deletes the selection on Delete and on Backspace", () => {
    harness = createHarness("crate");
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    expect(key(harness.frame, "Delete")).toBe(true);
    expect(key(harness.frame, "Backspace")).toBe(true);
    expect(harness.removed).toEqual([["crate"], ["crate"]]);
  });

  it("leaves a key it does not handle alone", () => {
    harness = createHarness("crate");
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    expect(key(harness.frame, "a")).toBe(false);
    expect(harness.removed).toEqual([]);
  });

  it("does not consume Backspace when nothing is selected", () => {
    harness = createHarness("crate");

    // Consuming it would stop the browser's own back navigation for a delete
    // that had nothing to delete.
    expect(key(harness.frame, "Backspace")).toBe(false);
    expect(harness.removed).toEqual([]);
  });

  it("pans on a drag that starts on empty space", () => {
    harness = createHarness(null);
    pointer(harness.frame, "pointerdown", 100, 100);
    pointer(harness.frame, "pointermove", 70, 90);

    // The world point the press grabbed stays under the pointer, so the view
    // moves the other way.
    expect(harness.store.getState().view.center).toEqual({ x: 30, y: 10 });

    pointer(harness.frame, "pointerup", 70, 90);
    pointer(harness.frame, "pointermove", 0, 0);
    expect(harness.store.getState().view.center).toEqual({ x: 30, y: 10 });
  });

  it("pans on a middle-button drag over a placement, and selects nothing", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 100, 100, 1);
    pointer(harness.frame, "pointermove", 80, 100, 1);

    expect(harness.store.getState().view.center).toEqual({ x: 20, y: 0 });
    expect([...harness.store.getState().selection]).toEqual([]);
    expect(harness.store.getState().gesture).toBeUndefined();
  });

  it("never starts a pan and a placement drag from one press", () => {
    harness = createHarness("crate");
    pointer(harness.frame, "pointerdown", 100, 100);
    pointer(harness.frame, "pointermove", 60, 100);

    // A press on a placement drags it. Nothing about the view moves.
    expect(harness.store.getState().gesture).toBeDefined();
    expect(harness.store.getState().view).toEqual({
      ...DEFAULT_VIEW,
      snap: false,
    });
    expect(harness.drafts.at(-1)?.[0]?.transform.position).toEqual({
      x: -40,
      y: 0,
    });
  });

  it("sends no command while panning", () => {
    harness = createHarness(null);
    pointer(harness.frame, "pointerdown", 100, 100);
    pointer(harness.frame, "pointermove", 70, 90);
    pointer(harness.frame, "pointerup", 70, 90);

    expect(harness.store.getState().pending).toEqual([]);
    expect(harness.drafts).toEqual([]);
  });

  it("drops the pan when the pointer is cancelled", () => {
    harness = createHarness(null);
    pointer(harness.frame, "pointerdown", 100, 100);
    act(() => {
      harness.frame.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
      );
    });
    pointer(harness.frame, "pointermove", 0, 0);

    expect(harness.store.getState().view).toEqual({
      ...DEFAULT_VIEW,
      snap: false,
    });
  });

  it("zooms around the pointer, and keeps the page from scrolling", () => {
    harness = createHarness(null);

    expect(wheel(harness.frame, -100, 60, 20)).toBe(true);

    const view = harness.store.getState().view;
    expect(view.zoom).toBeGreaterThan(1);
    // The identity conversion puts the anchor at (60, 20) in world space, and
    // zooming around it leaves it exactly there on screen.
    expect((60 - view.center.x) * view.zoom).toBeCloseTo(60 - 0, 9);
    expect((20 - view.center.y) * view.zoom).toBeCloseTo(20 - 0, 9);
  });

  it("zooms out when the wheel turns the other way", () => {
    harness = createHarness(null);
    wheel(harness.frame, 100, 0, 0);

    expect(harness.store.getState().view.zoom).toBeLessThan(1);
  });

  it("pans on a left drag while space is held, over a placement", () => {
    harness = createHarness("crate");

    expect(space(true)).toBe(true);
    pointer(harness.frame, "pointerdown", 100, 100);
    pointer(harness.frame, "pointermove", 60, 100);

    expect(harness.store.getState().view.center).toEqual({ x: 40, y: 0 });
    // The press pans instead of selecting, the way the middle button does.
    expect([...harness.store.getState().selection]).toEqual([]);
    expect(harness.store.getState().gesture).toBeUndefined();

    pointer(harness.frame, "pointerup", 60, 100);
    space(false);
  });

  it("stops arming a pan when space is released", () => {
    harness = createHarness("crate");
    space(true);
    space(false);

    pointer(harness.frame, "pointerdown", 100, 100);

    expect([...harness.store.getState().selection]).toEqual(["crate"]);
    expect(harness.store.getState().gesture).toBeDefined();
  });

  it("leaves space to a text field that owns it", () => {
    harness = createHarness("crate");
    const field = document.createElement("input");
    document.body.append(field);

    expect(space(true, field)).toBe(false);
    pointer(harness.frame, "pointerdown", 100, 100);

    expect(harness.store.getState().gesture).toBeDefined();
    field.remove();
    space(false);
  });

  it("shows what a press would do", () => {
    harness = createHarness("crate");
    expect(harness.frame.style.cursor).toBe("grab");

    // Over a placement, a press moves it.
    pointer(harness.frame, "pointermove", 10, 10);
    expect(harness.frame.style.cursor).toBe("move");

    // Holding space makes every press a pan, wherever the pointer is.
    space(true);
    expect(harness.frame.style.cursor).toBe("grab");
    pointer(harness.frame, "pointerdown", 10, 10);
    expect(harness.frame.style.cursor).toBe("grabbing");

    pointer(harness.frame, "pointerup", 10, 10);
    space(false);
    expect(harness.frame.style.cursor).toBe("move");
  });

  it("names the mark under the pointer, and puts the name away with it", () => {
    // The mark is drawn by the renderer, so the name is the only part of it
    // the shell can show — and the only thing that tells two lights apart.
    harness = createHarness(null, undefined, false, [], "LightSource");
    pointer(harness.frame, "pointermove", 40, 60);

    const name = harness.frame.querySelector<HTMLElement>(
      '[data-testid="yage-editor-mark-name"]',
    );
    expect(name?.textContent).toBe("LightSource");
    // Beside the pointer rather than on it, since the mark it names is there.
    expect(name?.style.left).toBe("54px");
    expect(name?.style.top).toBe("74px");

    pointer(harness.frame, "pointerdown", 40, 60);
    expect(
      harness.frame.querySelector('[data-testid="yage-editor-mark-name"]'),
    ).toBeNull();
  });

  it("names nothing where a handle is drawn over the mark", () => {
    // A press there grabs the handle, so naming the mark under it would
    // describe something the pointer cannot reach.
    harness = createHarness(
      null,
      () => ({
        mode: "translate" as const,
        handle: "x" as const,
        anchor: { position: { x: 0, y: 0 }, rotation: 0 },
        reference: { x: 64, y: 64, kind: "length" },
      }),
      false,
      [],
      "LightSource",
    );
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    pointer(harness.frame, "pointermove", 40, 60);

    expect(
      harness.frame.querySelector('[data-testid="yage-editor-mark-name"]'),
    ).toBeNull();
  });

  it("names nothing where there is no mark", () => {
    harness = createHarness(null);
    pointer(harness.frame, "pointermove", 40, 60);

    expect(
      harness.frame.querySelector('[data-testid="yage-editor-mark-name"]'),
    ).toBeNull();
  });

  it("shows the grab cursor over empty space", () => {
    harness = createHarness(null);
    pointer(harness.frame, "pointermove", 10, 10);

    expect(harness.frame.style.cursor).toBe("grab");
  });
});

describe("a reference field waiting for a target", () => {
  /** Arm the mode, as the inspector's Pick button does. */
  function waitFor(store: EditorStore): void {
    act(() => {
      store.dispatch({
        type: "pick-started",
        pick: { placementId: "switch", field: "door", types: ["game.crate"] },
      });
    });
  }

  it("chooses the target a press lands on, and nothing else happens", () => {
    const harness = createHarness("crate", undefined, false, [], null, "door");
    waitFor(harness.store);

    pointer(harness.frame, "pointerdown", 10, 10);

    const state = harness.store.getState();
    // The press wrote the id and stopped waiting; it selected nothing and
    // started no drag.
    expect(state.pick).toBeUndefined();
    expect([...state.selection]).toEqual([]);
    expect(state.gesture).toBeUndefined();
  });

  it("ignores a press on anything it cannot choose", () => {
    const harness = createHarness("crate");
    waitFor(harness.store);

    pointer(harness.frame, "pointerdown", 10, 10);

    const state = harness.store.getState();
    expect(state.pick).toBeDefined();
    expect([...state.selection]).toEqual([]);
    expect(state.gesture).toBeUndefined();
  });

  it("still pans with Space held", () => {
    const harness = createHarness("crate");
    waitFor(harness.store);

    space(true);
    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 30, 10);
    space(false);

    expect(harness.store.getState().view.center.x).toBe(-20);
    expect(harness.store.getState().pick).toBeDefined();
  });

  it("says whether a press would choose anything, and names no mark", () => {
    const overTarget = createHarness(
      "crate",
      undefined,
      false,
      [],
      "LightSource",
      "door",
    );
    waitFor(overTarget.store);
    pointer(overTarget.frame, "pointermove", 10, 10);
    expect(overTarget.frame.style.cursor).toBe("crosshair");
    expect(overTarget.host.textContent).not.toContain("LightSource");

    const overNothing = createHarness(
      "crate",
      undefined,
      false,
      [],
      null,
      null,
    );
    waitFor(overNothing.store);
    pointer(overNothing.frame, "pointermove", 10, 10);
    expect(overNothing.frame.style.cursor).toBe("not-allowed");
  });
});

describe("cursorFor", () => {
  const idle = {
    panning: false,
    dragging: false,
    spaceHeld: false,
    overHandle: undefined,
    overPlacement: false,
  };

  it("shows what a press would choose while a field waits for a target", () => {
    expect(cursorFor({ ...idle, picking: true, overTarget: true })).toBe(
      "crosshair",
    );
    expect(cursorFor({ ...idle, picking: true, overPlacement: true })).toBe(
      "not-allowed",
    );
    // Finding the target is half the gesture, so both pans still win.
    expect(cursorFor({ ...idle, picking: true, panning: true })).toBe(
      "grabbing",
    );
    expect(cursorFor({ ...idle, picking: true, spaceHeld: true })).toBe("grab");
  });

  it("shows a pan in progress over everything else", () => {
    expect(
      cursorFor({
        ...idle,
        panning: true,
        dragging: true,
        overPlacement: true,
      }),
    ).toBe("grabbing");
  });

  it("shows a drag in progress even once the pointer leaves the placement", () => {
    expect(cursorFor({ ...idle, dragging: true })).toBe("move");
  });

  it("shows an armed pan over a placement", () => {
    expect(cursorFor({ ...idle, spaceHeld: true, overPlacement: true })).toBe(
      "grab",
    );
  });

  it("shows what the pointer is over when nothing is armed", () => {
    expect(cursorFor({ ...idle, overPlacement: true })).toBe("move");
    expect(cursorFor(idle)).toBe("grab");
  });

  it("shows a gizmo handle ahead of the placement it sits on", () => {
    expect(
      cursorFor({
        ...idle,
        overHandle: { mode: "scale", along: { x: 1, y: 0 } },
        overPlacement: true,
      }),
    ).toBe("ew-resize");
    expect(
      cursorFor({
        ...idle,
        overHandle: { mode: "rotate" },
        overPlacement: true,
      }),
    ).toBe("rotate");
  });

  it("shows a part of the gizmo that moves the placement as a move", () => {
    // The box gizmo's interior. It does what a press on the placement does,
    // so it says the same thing rather than promising a transform.
    expect(
      cursorFor({
        ...idle,
        overHandle: { mode: "translate" },
        overPlacement: true,
      }),
    ).toBe("move");
  });

  it("points a scale cursor the way the handle grows the placement", () => {
    const over = (x: number, y: number): ViewportCursor =>
      cursorFor({ ...idle, overHandle: { mode: "scale", along: { x, y } } });
    // The world's y runs down the screen, so a handle pointing down and to the
    // right is the "\\" diagonal.
    expect(over(1, 0)).toBe("ew-resize");
    expect(over(0, 1)).toBe("ns-resize");
    expect(over(1, 1)).toBe("nwse-resize");
    expect(over(1, -1)).toBe("nesw-resize");
  });

  it("gives a handle and the one opposite it the same cursor", () => {
    // A resize cursor is double-headed, so the side of the box a handle sits
    // on cannot change which of the four it is.
    const over = (x: number, y: number): ViewportCursor =>
      cursorFor({ ...idle, overHandle: { mode: "scale", along: { x, y } } });
    expect(over(-1, 0)).toBe(over(1, 0));
    expect(over(0, -1)).toBe(over(0, 1));
    expect(over(-1, -1)).toBe(over(1, 1));
    expect(over(-1, 1)).toBe(over(1, -1));
  });

  it("turns a corner's cursor with the placement", () => {
    // The same corner of a box turned a quarter turn: it now grows the
    // placement along the other diagonal, and says so.
    const upright = cursorFor({
      ...idle,
      overHandle: { mode: "scale", along: { x: -1, y: -1 } },
    });
    const turned = cursorFor({
      ...idle,
      overHandle: { mode: "scale", along: { x: 1, y: -1 } },
    });
    expect(upright).toBe("nwse-resize");
    expect(turned).toBe("nesw-resize");
  });

  it("rounds a direction between two cursors to the nearer one", () => {
    const over = (degrees: number): ViewportCursor =>
      cursorFor({
        ...idle,
        overHandle: {
          mode: "scale",
          along: {
            x: Math.cos((degrees * Math.PI) / 180),
            y: Math.sin((degrees * Math.PI) / 180),
          },
        },
      });
    // A long flat box's corner points nearly along its wide axis.
    expect(over(20)).toBe("ew-resize");
    expect(over(70)).toBe("ns-resize");
    // And a direction just short of half a turn is horizontal again, not
    // whatever the fold left at the far end of the range.
    expect(over(179)).toBe("ew-resize");
  });

  it("keeps the generic cursor for a scale handle with no direction", () => {
    expect(cursorFor({ ...idle, overHandle: { mode: "scale" } })).toBe(
      "crosshair",
    );
  });
});

describe("cssCursor", () => {
  it("passes a CSS keyword through unchanged", () => {
    expect(cssCursor("move")).toBe("move");
    expect(cssCursor("nwse-resize")).toBe("nwse-resize");
  });

  it("draws the rotate cursor, which CSS has no keyword for", () => {
    const value = cssCursor("rotate");
    expect(value.startsWith('url("data:image/svg+xml,')).toBe(true);
    // The hotspot is the middle of the glyph, and a browser that refuses SVG
    // cursors gets the keyword the editor used before there was one.
    expect(value.endsWith('") 12 12, crosshair')).toBe(true);
    expect(decodeURIComponent(value)).toContain("<svg");
  });
});

describe("the additive modifier", () => {
  it("adds a placement to the selection instead of replacing it", () => {
    const harness = createHarness("crate");
    harness.store.dispatch({ type: "selection-changed", ids: ["other"] });

    pointer(harness.frame, "pointerdown", 10, 10, 0, 1, { metaKey: true });

    expect([...harness.store.getState().selection].sort()).toEqual([
      "crate",
      "other",
    ]);
    harness.root.unmount();
  });

  it("takes a placement out again", () => {
    const harness = createHarness("crate");
    harness.store.dispatch({
      type: "selection-changed",
      ids: ["crate", "other"],
    });

    pointer(harness.frame, "pointerdown", 10, 10, 0, 1, { metaKey: true });

    expect([...harness.store.getState().selection]).toEqual(["other"]);
    harness.root.unmount();
  });

  it("starts no drag, because the press was choosing rather than moving", () => {
    const harness = createHarness("crate");

    pointer(harness.frame, "pointerdown", 10, 10, 0, 1, { metaKey: true });
    pointer(harness.frame, "pointermove", 40, 40);

    // A drag here would shift whatever the developer had just picked.
    expect(harness.store.getState().gesture).toBeUndefined();
    expect(harness.drafts).toEqual([]);
    harness.root.unmount();
  });

  it("keeps the selection on a modified press over empty space", () => {
    const harness = createHarness(null);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    pointer(harness.frame, "pointerdown", 10, 10, 0, 1, { metaKey: true });

    expect([...harness.store.getState().selection]).toEqual(["crate"]);
    harness.root.unmount();
  });
});

describe("the marquee", () => {
  function selecting(covered: readonly string[] = []) {
    const harness = createHarness(null, undefined, false, covered);
    act(() => {
      harness.store.dispatch({ type: "tool-changed", tool: "select" });
    });
    return harness;
  }

  it("drags a rectangle instead of panning under Select", () => {
    const harness = selecting();
    const before = harness.store.getState().view.center;

    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 60, 40);

    expect(harness.store.getState().marquee).toMatchObject({
      from: { x: 10, y: 10 },
      to: { x: 60, y: 40 },
    });
    expect(harness.store.getState().view.center).toEqual(before);
    harness.root.unmount();
  });

  it("still pans from empty space under a gizmo tool", () => {
    const harness = createHarness(null);

    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 60, 40);

    expect(harness.store.getState().marquee).toBeUndefined();
    expect(harness.store.getState().view.center).not.toEqual({ x: 0, y: 0 });
    harness.root.unmount();
  });

  it("selects what it covered when it is released", () => {
    const harness = selecting(["crate", "barrel"]);

    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 60, 40);
    pointer(harness.frame, "pointerup", 60, 40);

    expect([...harness.store.getState().selection]).toEqual([
      "crate",
      "barrel",
    ]);
    expect(harness.store.getState().marquee).toBeUndefined();
    harness.root.unmount();
  });

  it("replaces the selection, and adds to it with the modifier", () => {
    const harness = selecting(["barrel"]);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    pointer(harness.frame, "pointerdown", 10, 10, 0, 1, { metaKey: true });
    pointer(harness.frame, "pointermove", 60, 40, 0, 1, { metaKey: true });
    pointer(harness.frame, "pointerup", 60, 40, 0, 1, { metaKey: true });

    expect([...harness.store.getState().selection].sort()).toEqual([
      "barrel",
      "crate",
    ]);
    harness.root.unmount();
  });

  it("chooses nothing when the gesture is cancelled", () => {
    const harness = selecting(["barrel"]);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 60, 40);
    act(() => {
      harness.frame.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
      );
    });

    // A palm or a pen leaving range must not replace what was selected.
    expect([...harness.store.getState().selection]).toEqual(["crate"]);
    expect(harness.store.getState().marquee).toBeUndefined();
    harness.root.unmount();
  });

  it("refuses a second pointer while one is dragging a rectangle", () => {
    const harness = selecting(["barrel"]);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 60, 40);
    // A pen and a finger, or two fingers: capture on the first does not
    // redirect the second. A second marquee would throw away the first one's
    // remembered selection, which a cancel then could not put back.
    pointer(harness.frame, "pointerdown", 200, 200, 0, 2);

    expect(harness.store.getState().marquee).toMatchObject({
      from: { x: 10, y: 10 },
      base: ["crate"],
    });
    harness.root.unmount();
  });

  it("starts no drag from a second pointer landing on a placement", () => {
    // Empty space for the first press, so it starts a marquee, and a
    // placement for everything after it.
    let pressed = 0;
    const harness = createHarness(
      () => (pressed++ === 0 ? null : "crate"),
      undefined,
      false,
      [],
    );
    act(() => {
      harness.store.dispatch({ type: "tool-changed", tool: "select" });
    });

    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 60, 40);
    pointer(harness.frame, "pointerdown", 200, 200, 0, 2);

    // A gesture and a marquee open at once is the state the store's own note
    // says cannot happen.
    expect(harness.store.getState().gesture).toBeUndefined();
    expect(harness.store.getState().marquee).toBeDefined();
    harness.root.unmount();
  });

  it("still moves a placement that is dragged directly", () => {
    const harness = createHarness("crate", undefined, false, []);
    act(() => {
      harness.store.dispatch({ type: "tool-changed", tool: "select" });
    });

    pointer(harness.frame, "pointerdown", 10, 10);
    pointer(harness.frame, "pointermove", 40, 10);

    // Select changes what an empty-space drag means and nothing else.
    expect(harness.store.getState().gesture).toBeDefined();
    expect(harness.store.getState().marquee).toBeUndefined();
    harness.root.unmount();
  });
});

describe("Viewport parameter handles", () => {
  const HANDLE = { id: "crate", field: "patrolEnd", grip: "body" as const };

  it("drags the parameter's value rather than the gizmo under it", () => {
    const harness = createHarness(
      "crate",
      () => ({
        mode: "translate" as const,
        handle: "xy" as const,
        anchor: { position: { x: 0, y: 0 }, rotation: 0 },
        reference: { x: 64, y: 64, kind: "length" as const },
      }),
      false,
      [],
      null,
      null,
      () => HANDLE,
    );
    act(() => {
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    });

    // A relative point at the origin sits on the translate gizmo's centre
    // grip, whose two arms still reach the same gesture.
    pointer(harness.frame, "pointerdown", 0, 0);
    pointer(harness.frame, "pointermove", 30, 10, 0, 1, { shiftKey: true });

    expect(harness.valueDrags).toEqual([
      "begin crate.patrolEnd body at 0,0",
      "move 30,10 shift",
    ]);
    expect(harness.store.getState().gesture).toBeUndefined();
    harness.root.unmount();
  });

  it("names the parameter while the pointer rests on its handle", () => {
    const harness = createHarness(
      "crate",
      undefined,
      false,
      [],
      "SpriteComponent",
      null,
      () => HANDLE,
    );

    pointer(harness.frame, "pointermove", 0, 0);

    // The handle wins over the mark under it: it is what a press there grabs.
    expect(
      harness.host.querySelector('[data-testid="yage-editor-mark-name"]')
        ?.textContent,
    ).toBe("patrolEnd");
    harness.root.unmount();
  });
});
