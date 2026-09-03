import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CommandController } from "../commands/index.js";
import type {
  EditorPoint,
  EditorStore,
  GizmoAnchor,
  GizmoMode,
  GizmoReference,
  HandleId,
} from "../store/index.js";
import { selectedAfter } from "./selection.js";
import { ownsSpace } from "./useShortcuts.js";

/**
 * What the viewport needs from the preview. Both take client pixels — the
 * coordinates a pointer event carries — because the preview owns the canvas
 * and is the only module that knows where it sits and how it is scaled.
 */
export interface ViewportPreview {
  hitTest(clientPoint: { x: number; y: number }): string | null;
  /**
   * The reference target a press here would choose while a field is waiting
   * for one, or `null` — including whenever nothing is waiting.
   */
  pickAt(clientPoint: { x: number; y: number }): string | null;
  /**
   * Which gizmo handle is under the pointer, or `null` for none. The handles
   * are drawn by the renderer rather than the DOM, so nothing in this
   * component can see them.
   */
  gizmoAt(clientPoint: { x: number; y: number }): {
    readonly mode: GizmoMode;
    readonly handle: HandleId;
    readonly anchor: GizmoAnchor;
    readonly reference: GizmoReference;
    /** Which way the handle scales, for the cursor. Absent for the rest. */
    readonly along?: EditorPoint | undefined;
    /** What the placements turn and scale about, when not their own origins. */
    readonly pivot?: EditorPoint | undefined;
  } | null;
  /**
   * Whether the point is near enough to the gizmo that a press there reads as
   * a missed grab rather than as a press on the empty space behind it.
   */
  gizmoNear(clientPoint: { x: number; y: number }): boolean;
  /**
   * What the mark under the pointer stands for — a component's type string —
   * or `null` where there is no mark. The marks are drawn by the renderer, so
   * this component cannot see them either.
   */
  markAt(clientPoint: { x: number; y: number }): string | null;
  /**
   * Which placements a world rectangle covers entirely. The corners arrive in
   * either order, so a marquee dragged up and left means the same thing.
   */
  placementsWithin(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): readonly string[];
  /** Undefined before the preview has a camera to convert through. */
  screenToWorld(clientPoint: {
    x: number;
    y: number;
  }): { x: number; y: number } | undefined;
}

export interface ViewportProps {
  /** The element the engine renders into, created and owned by the preview. */
  readonly canvasHost: HTMLElement;
  readonly store: EditorStore;
  readonly commands: CommandController;
  readonly preview: ViewportPreview;
}

/** `PointerEvent.button` for the middle button. */
const MIDDLE_BUTTON = 1;
const LEFT_BUTTON = 0;

/** How much a wheel notch zooms: 100 pixels of scroll is about 12%. */
const ZOOM_PER_PIXEL = 0.0011;
/** What a wheel reports instead of pixels when it measures in lines or pages. */
const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;

/**
 * A pan in progress: which pointer and button, and the world point it grabbed.
 *
 * The button is part of the identity because a mouse reports all of them on
 * one pointer, so the release that ends the pan is the release of the button
 * that started it and not of whichever one comes up first.
 */
interface PanGesture {
  readonly pointerId: number;
  readonly button: number;
  readonly anchor: EditorPoint;
}

/**
 * What the pointer looks like over the viewport.
 *
 * Every name but `rotate` is already a CSS keyword; see {@link cssCursor}.
 */
export type ViewportCursor =
  | "move"
  | "grab"
  | "grabbing"
  | "crosshair"
  | "default"
  | "ew-resize"
  | "ns-resize"
  | "nwse-resize"
  | "nesw-resize"
  | "not-allowed"
  | "rotate";

/** What is under the pointer, when a gizmo handle is. */
export interface HandleUnderPointer {
  readonly mode: GizmoMode;
  /** Which way a scale handle grows the placement. Absent for the rest. */
  readonly along?: EditorPoint | undefined;
}

/**
 * What the pointer should look like, from what a press would do next.
 *
 * A pan in progress wins because it is already happening, and holding space
 * wins over whatever is under the pointer, because it turns every press into
 * a pan.
 */
export function cursorFor(state: {
  readonly panning: boolean;
  readonly dragging: boolean;
  readonly spaceHeld: boolean;
  /** Which transform a press would perform, when one is under the pointer. */
  readonly overHandle?: HandleUnderPointer | undefined;
  readonly overPlacement: boolean;
  /** True under the Select tool, where an empty-space drag is a marquee. */
  readonly selecting?: boolean | undefined;
  /** True while a reference field is waiting for a target to be pointed at. */
  readonly picking?: boolean | undefined;
  /** Whether a press would choose a target, while picking. */
  readonly overTarget?: boolean | undefined;
}): ViewportCursor {
  if (state.panning) return "grabbing";
  if (state.dragging) return "move";
  if (state.spaceHeld) return "grab";
  // Finding the target is half the gesture, so a pan in progress and a held
  // Space still win over it.
  if (state.picking) return state.overTarget ? "crosshair" : "not-allowed";
  const handle = state.overHandle;
  if (handle) {
    // The box gizmo's interior moves the placement, and looks like it: the
    // same cursor a press on the placement itself gets.
    if (handle.mode === "translate") return "move";
    // Both the rotate ring and the box's turn band, which are one gesture.
    if (handle.mode === "rotate") return "rotate";
    return handle.along ? resizeCursor(handle.along) : "crosshair";
  }
  if (state.overPlacement) return "move";
  // Under Select an empty-space drag draws a rectangle rather than moving the
  // view, so the open hand would promise the wrong thing.
  return state.selecting ? "default" : "grab";
}

/**
 * Which of the four resize cursors points along a world direction.
 *
 * The world's `y` runs down the screen and the editor's camera never turns, so
 * a world direction is a screen direction. A resize cursor is double-headed,
 * which is why the angle folds into half a turn first: a handle on the left of
 * a box and one on its right get the same cursor. The four then cover 45° each,
 * which is coarse by design — they are the whole vocabulary CSS has.
 */
function resizeCursor(along: EditorPoint): ViewportCursor {
  const angle = Math.atan2(along.y, along.x);
  const folded = ((angle % Math.PI) + Math.PI) % Math.PI;
  switch (Math.round(folded / (Math.PI / 4)) % 4) {
    case 0:
      return "ew-resize";
    case 1:
      return "nwse-resize";
    case 2:
      return "ns-resize";
    default:
      return "nesw-resize";
  }
}

/**
 * A curved arrow, drawn white over a dark casing so it reads over whatever the
 * project renders behind it. Its hotspot is the middle of the arc, so the
 * arrow encircles the point being pressed.
 */
const ROTATE_GLYPH = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`,
  `<g fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">`,
  `<path d="M18.8 12A6.8 6.8 0 1 1 12 5.2"/>`,
  `<path d="M15.4 5.2 12 2.8 12 7.6Z" fill="#000"/>`,
  `</g>`,
  `<g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">`,
  `<path d="M18.8 12A6.8 6.8 0 1 1 12 5.2"/>`,
  `<path d="M15.4 5.2 12 2.8 12 7.6Z" fill="#fff"/>`,
  `</g>`,
  `</svg>`,
].join("");

/**
 * The CSS value for a cursor.
 *
 * CSS has no rotate cursor, so that one is an inline image. The keyword after
 * it is what a browser that refuses SVG cursors falls back to.
 */
export function cssCursor(cursor: ViewportCursor): string {
  if (cursor !== "rotate") return cursor;
  return `url("data:image/svg+xml,${encodeURIComponent(ROTATE_GLYPH)}") 12 12, crosshair`;
}

/**
 * The editing surface.
 *
 * It places the element the engine draws into and turns pointer events into
 * selection, drags, and view changes. Everything visible inside it is drawn by
 * the engine — this component owns the events, not the picture.
 */
export function Viewport(props: ViewportProps): React.JSX.Element {
  const { canvasHost, store, commands, preview } = props;
  const frame = useRef<HTMLDivElement>(null);
  const pan = useRef<PanGesture | undefined>(undefined);
  // Which pointer owns the drag, so a second one's release or cancel cannot
  // end it. The store's gesture holds no pointer — it is a document edit, and
  // which contact is making it is the viewport's business.
  const dragPointer = useRef<number | undefined>(undefined);
  const spaceHeld = useRef(false);
  const overHandle = useRef<HandleUnderPointer | undefined>(undefined);
  const overPlacement = useRef(false);
  /** Whether a press where the pointer rests would choose a target. */
  const overTarget = useRef(false);
  const marqueePointer = useRef<number | undefined>(undefined);
  const [cursor, setCursor] = useState<ViewportCursor>("grab");
  /** The name of the mark under the pointer, and where to show it. */
  const [named, setNamed] = useState<NamedMark | undefined>(undefined);

  const refreshCursor = (): void => {
    setCursor(
      cursorFor({
        panning: pan.current !== undefined,
        dragging: store.getState().gesture !== undefined,
        spaceHeld: spaceHeld.current,
        overHandle: overHandle.current,
        overPlacement: overPlacement.current,
        selecting: store.getState().tool === "select",
        picking: store.getState().pick !== undefined,
        overTarget: overTarget.current,
      }),
    );
  };

  useEffect(() => {
    const host = frame.current;
    if (!host) return;
    host.append(canvasHost);
    return () => {
      canvasHost.remove();
    };
  }, [canvasHost]);

  useEffect(() => {
    const host = frame.current;
    if (!host) return;
    /**
     * Zoom around the pointer. It is registered here rather than as an
     * `onWheel` prop because React registers wheel listeners passively, and a
     * passive listener cannot stop the page from scrolling or the browser from
     * zooming while the view does.
     */
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const anchor = preview.screenToWorld({
        x: event.clientX,
        y: event.clientY,
      });
      if (!anchor) return;
      store.dispatch({
        type: "view-zoomed",
        factor: zoomFactorOf(event),
        anchor,
      });
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      host.removeEventListener("wheel", onWheel);
    };
  }, [store, preview]);

  useEffect(() => {
    /**
     * Space arms a pan, which is how a trackpad with no middle button pans
     * from anywhere. It is read on the window rather than on this element: the
     * levels that need it are the dense ones, where the pointer is rarely over
     * empty space, and requiring canvas focus first would make the gesture
     * depend on where the last click landed.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || event.repeat) return;
      // A focused button, link, or text field owns Space, and defaulting it
      // away there would leave that control reachable by Enter and nothing
      // else. Everywhere else the keystroke is the viewport's, and it is
      // defaulted away because Space scrolls.
      if (ownsSpace(event.target)) return;
      event.preventDefault();
      spaceHeld.current = true;
      refreshCursor();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      spaceHeld.current = false;
      refreshCursor();
    };
    // A pan armed before the window lost focus would still be armed when it
    // came back, with the key released somewhere this page never saw.
    const onBlur = (): void => {
      spaceHeld.current = false;
      refreshCursor();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // No dependencies: every handler reads refs and the store, both of which
    // outlive a render, so one registration serves the component's life.
  }, []);

  const pointIn = (event: ReactPointerEvent<HTMLDivElement>) => ({
    x: event.clientX,
    y: event.clientY,
  });

  const beginPan = (
    event: ReactPointerEvent<HTMLDivElement>,
    anchor: EditorPoint | undefined,
  ): void => {
    if (!anchor) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = { pointerId: event.pointerId, button: event.button, anchor };
    refreshCursor();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = pointIn(event);
    // Whatever the press starts, the pointer is no longer resting on a mark.
    setNamed(undefined);
    // Focus explicitly: a `tabIndex` element is focused by a click in most
    // browsers and not all of them, and the delete key is read from here.
    event.currentTarget.focus();
    // Middle and space-held both pan from anywhere, including from on top of a
    // placement, and neither changes the selection. Defaulting the press away
    // is what stops Chrome opening its autoscroll widget on the compatibility
    // mouse event.
    const pans =
      event.button === MIDDLE_BUTTON ||
      (event.button === LEFT_BUTTON && spaceHeld.current);
    if (pans) event.preventDefault();
    if (!pans && event.button !== LEFT_BUTTON) return;
    // Every press below is a second contact once a drag or a marquee is
    // running, and `CommandController.beginGesture` refuses one for the same
    // reason: a pan would freeze the drag, a selection change would drop what
    // it is moving, and taking the pointer capture would strand it if the
    // pointer then left the viewport. A second marquee would throw away the
    // first one's remembered selection, and one starting on a placement would
    // leave a gesture and a marquee open at once. A second pointer is how this
    // is reached — a pen and a finger, or two fingers — because capture on the
    // first does not redirect the second.
    const running = store.getState();
    if (running.gesture !== undefined || running.marquee !== undefined) return;
    if (pans) {
      beginPan(event, preview.screenToWorld(point));
      return;
    }
    // While a reference field is waiting, a press chooses a target and does
    // nothing else: no selection change, no drag, no marquee. A press on
    // anything the field cannot accept is ignored rather than treated as
    // giving up — a near miss costs a second click, not the mode.
    if (running.pick) {
      const target = preview.pickAt(point);
      if (target !== null) commands.pickTarget(target);
      return;
    }
    // A handle is tested before the placements: it is drawn on top of them,
    // and an arm reaches past its placement's bounds onto whatever is behind.
    const grab = preview.gizmoAt(point);
    const grabbed = grab ? preview.screenToWorld(point) : undefined;
    if (grab && grabbed) {
      event.currentTarget.setPointerCapture(event.pointerId);
      commands.beginGesture({
        ids: [...store.getState().selection],
        origin: grabbed,
        kind: grab.mode,
        handle: grab.handle,
        anchor: grab.anchor,
        reference: grab.reference,
        pivot: grab.pivot,
      });
      dragPointer.current = event.pointerId;
      refreshCursor();
      return;
    }
    const hit = preview.hitTest(point);
    const state = store.getState();
    const additive = event.metaKey || event.ctrlKey;
    // A press that nearly hit a handle keeps the selection. Clearing it there
    // would take the gizmo away at the moment the developer was reaching for
    // it, and leave them re-selecting before they could try again. Anywhere
    // else, a press on empty space still means "select nothing".
    if (hit !== null || !preview.gizmoNear(point)) {
      store.dispatch({
        type: "selection-changed",
        ids: selectedAfter(state.selection, hit, additive),
      });
    }
    const origin = preview.screenToWorld(point);
    if (hit === null) {
      // Under Select, an empty-space drag draws a rectangle. Everywhere else
      // it pans, which is what a gizmo tool does and this leaves alone.
      if (state.tool === "select" && origin) {
        event.currentTarget.setPointerCapture(event.pointerId);
        store.dispatch({
          type: "marquee-started",
          marquee: {
            from: origin,
            to: origin,
            additive,
            base: [...state.selection],
          },
        });
        marqueePointer.current = event.pointerId;
        refreshCursor();
        return;
      }
      beginPan(event, origin);
      return;
    }
    if (!origin) return;
    // A press that added to the selection is choosing, not dragging: starting
    // a move here would shift whatever the developer just picked.
    if (additive) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    commands.beginGesture({ ids: [hit], origin });
    dragPointer.current = event.pointerId;
    refreshCursor();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = pointIn(event);
    const panning = pan.current;
    if (panning) {
      if (event.pointerId !== panning.pointerId) return;
      const world = preview.screenToWorld(point);
      if (!world) return;
      // The world point the press grabbed stays under the pointer: the camera
      // moves by whatever has slid out from under it since the last move.
      store.dispatch({
        type: "view-panned",
        by: { x: panning.anchor.x - world.x, y: panning.anchor.y - world.y },
      });
      return;
    }
    if (marqueePointer.current === event.pointerId) {
      const world = preview.screenToWorld(point);
      if (world) {
        store.dispatch({
          type: "marquee-moved",
          to: world,
          additive: event.metaKey || event.ctrlKey,
        });
      }
      return;
    }
    if (store.getState().pick) {
      overTarget.current = preview.pickAt(point) !== null;
      // A mark that is not drawn must not be named.
      setNamed(undefined);
      refreshCursor();
      return;
    }
    if (!store.getState().gesture) {
      // Only while nothing is being dragged: a hit test walks every
      // placement's bounds, and during a drag the answer cannot change what
      // the pointer means.
      const grab = preview.gizmoAt(point);
      overHandle.current = grab
        ? { mode: grab.mode, along: grab.along }
        : undefined;
      overPlacement.current = !grab && preview.hitTest(point) !== null;
      // A handle drawn over a mark wins: it is what a press there would grab.
      const mark = grab ? null : preview.markAt(point);
      setNamed(mark === null ? undefined : namedAt(mark, event, frame.current));
      refreshCursor();
      return;
    }
    const world = preview.screenToWorld(point);
    if (world)
      commands.updateGesture(world, {
        constrained: event.shiftKey,
        suspended: event.altKey,
      });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const panning = pan.current;
    if (
      panning?.pointerId === event.pointerId &&
      panning.button === event.button
    ) {
      pan.current = undefined;
      event.currentTarget.releasePointerCapture(event.pointerId);
      refreshCursor();
      return;
    }
    // A mouse reports every button on one pointer, so a middle or right button
    // released during a drag arrives here as an ordinary release. Settling on
    // it would commit the placement wherever it had reached and drop the
    // capture the left button still needs.
    if (event.button !== LEFT_BUTTON) return;
    if (marqueePointer.current === event.pointerId) {
      marqueePointer.current = undefined;
      event.currentTarget.releasePointerCapture(event.pointerId);
      commitMarquee();
      refreshCursor();
      return;
    }
    if (dragPointer.current !== event.pointerId) return;
    if (!store.getState().gesture) return;
    dragPointer.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    // The drag becomes one command here, which is also what makes it one undo
    // step once history exists.
    void commands.settleEdits();
    refreshCursor();
  };

  /**
   * Select what the rectangle covers, and put it away.
   *
   * Covers, not touches: a rectangle that took everything it clipped would
   * pick up the scenery behind the one thing the developer was aiming at.
   */
  const commitMarquee = (): void => {
    const marquee = store.getState().marquee;
    if (!marquee) return;
    const covered = preview.placementsWithin(marquee.from, marquee.to);
    store.dispatch({ type: "marquee-ended" });
    store.dispatch({
      type: "selection-changed",
      ids: marquee.additive
        ? [...new Set([...marquee.base, ...covered])]
        : covered,
    });
  };

  /**
   * Delete removes the selection. It is read here rather than on the window so
   * it fires only while the editing surface has focus, which is what keeps it
   * from deleting a placement while a field elsewhere in the shell is being
   * typed into.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const selection = store.getState().selection;
    if (selection.size === 0) return;
    // Backspace navigates back in some browsers when nothing consumes it.
    event.preventDefault();
    void commands.deletePlacements([...selection]);
  };

  return (
    <div
      ref={frame}
      data-testid="yage-editor-viewport"
      className="ye-viewport"
      tabIndex={0}
      // The cursor is the one thing here that changes with state, and the
      // stylesheet cannot see the state.
      style={{ cursor: cssCursor(cursor) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => {
        // Only the pointer that started something ends it. A second contact
        // cancelling — a palm, a pen leaving range — must not drop the drag
        // the first one is still making.
        if (pan.current?.pointerId === event.pointerId) {
          pan.current = undefined;
        }
        if (dragPointer.current === event.pointerId) {
          dragPointer.current = undefined;
          commands.cancelGesture();
        }
        if (marqueePointer.current === event.pointerId) {
          const base = store.getState().marquee?.base ?? [];
          marqueePointer.current = undefined;
          store.dispatch({ type: "marquee-ended" });
          // A cancelled gesture means nothing happened. The press that started
          // it had already cleared the selection, so putting it back is what
          // keeps a palm or a pen leaving range from costing the developer
          // what they had chosen.
          store.dispatch({ type: "selection-changed", ids: base });
        }
        refreshCursor();
      }}
      onKeyDown={onKeyDown}
      onPointerLeave={() => {
        setNamed(undefined);
      }}
    >
      {named ? (
        <div
          data-testid="yage-editor-mark-name"
          className="ye-viewport__mark-name"
          style={{ left: `${String(named.x)}px`, top: `${String(named.y)}px` }}
        >
          {named.type}
        </div>
      ) : null}
    </div>
  );
}

/** A mark's name, and where in the viewport to draw it. */
interface NamedMark {
  readonly type: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The name placed just below and right of the pointer, in the viewport's own
 * pixels. Below, because the row of marks it names runs above the placement's
 * origin and a name over that row would hide the marks beside the one it is
 * about.
 */
function namedAt(
  type: string,
  event: ReactPointerEvent<HTMLDivElement>,
  frame: HTMLElement | null,
): NamedMark {
  const rect = frame?.getBoundingClientRect();
  return {
    type,
    x: event.clientX - (rect?.left ?? 0) + NAME_OFFSET,
    y: event.clientY - (rect?.top ?? 0) + NAME_OFFSET,
  };
}

/** How far from the pointer the name sits, in CSS pixels. */
const NAME_OFFSET = 14;

/**
 * How much one wheel event zooms by. Scrolling up magnifies.
 *
 * The exponential is what makes the gesture reversible: scrolling down by as
 * much as you scrolled up returns the exact zoom you started from, which a
 * linear step does not.
 */
function zoomFactorOf(event: WheelEvent): number {
  const perUnit =
    event.deltaMode === 1
      ? LINE_PIXELS
      : event.deltaMode === 2
        ? PAGE_PIXELS
        : 1;
  return Math.exp(-event.deltaY * perUnit * ZOOM_PER_PIXEL);
}
