import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import type {
  DocumentCommand,
  PreviewImpact,
} from "../../shared/commands/index.js";
import type {
  DiagnosticSource,
  EditorDiagnostic,
} from "../../shared/diagnostics/index.js";
import type {
  DraftSnapshot,
  HistorySummary,
} from "../../shared/protocol/index.js";

/** A point in world space, the units every editor-facing API works in. */
export interface EditorPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A command the browser has applied to its own projection and sent, waiting
 * for the server to accept it.
 */
export interface PendingCommand {
  readonly command: DocumentCommand;
  /**
   * How many times the server has answered `stale` and the browser has
   * re-sent it against a newer revision.
   */
  readonly rebases: number;
}

/**
 * Why document writes are refused. Each reason is set by the module that
 * discovered the problem and stays until that module clears it.
 */
export type WriteLockReason = "stale-project" | "stale-command";

/** The open level's server file state, mirrored from the last snapshot. */
export interface EditorFileState {
  readonly path: string;
  /**
   * Which of the page's imported layer sets this level is authored against,
   * as the server matched it. Absent when its glob declared no layers.
   */
  readonly layerSet?: number;
  readonly diskRevision: string;
  /** Hash of the canonical committed draft. */
  readonly contentHash: string;
  /** Hash of the canonical document last written to disk. */
  readonly savedContentHash: string;
}

/**
 * The editor's own camera: the world point the middle of the viewport shows,
 * and how much the picture is magnified. It is browser-local — it never
 * reaches a command, the draft, or a level document, and it makes nothing
 * dirty.
 */
export interface EditorViewState {
  readonly center: EditorPoint;
  /** Rendered pixels per world unit. Always above zero. */
  readonly zoom: number;
  /**
   * Whether the viewport draws its reference guides: the grid, the world axes,
   * and the rectangle the game starts out showing. One switch for all three —
   * they answer the same question, which is where the level sits in the world
   * and what the player will see of it.
   */
  readonly guides: boolean;
  /**
   * Whether a gesture puts what it moves on the grid.
   *
   * It is in `view` rather than beside `tool` — where `pivot` and `axes` sit
   * for changing what an edit does — because the grid draws the lattice and
   * the toolbar shows the switch. The surprise a stored mode causes is finding
   * an edit behave differently with nothing on screen to explain it, and both
   * halves of this one are on screen.
   */
  readonly snap: boolean;
  /**
   * World units between grid lines, and what a snapped gesture lands on.
   *
   * It sizes the drawing whether or not `snap` is on: one lattice, so a line
   * you can see is always a place you can land.
   */
  readonly step: number;
}

/** Which transform a gesture performs. */
export type GizmoMode = "translate" | "rotate" | "scale";

/**
 * Which gizmo the viewport draws.
 *
 * The three modes each draw the handles for one transform. `box` draws the
 * placement's own rectangle and carries all three at once: its interior moves,
 * its handles scale, and the band outside it turns. Which transform a `box`
 * gesture performs comes from the handle, not from the tool, which is why this
 * is a wider type than {@link GizmoMode}.
 */
export type GizmoTool = GizmoMode | "box";

/**
 * What the toolbar offers and what the viewport is in.
 *
 * The four gizmo tools transform the selection. `select` transforms nothing:
 * it turns an empty-space drag into a marquee instead of a pan, and draws no
 * handles, so it is the tool for choosing what to work on rather than a fifth
 * way to change it.
 */
export type EditorTool = GizmoTool | "select";

/**
 * What rotate and scale work about.
 *
 * `active` is the last placement added to the selection — the one clicked, for
 * a click. `center` is the middle of the rectangle the selection covers.
 * `individual` gives every placement its own origin, so a row of signs turns
 * to face a new direction without leaving their posts.
 *
 * With one placement selected, `active` and `individual` are the same point
 * and are what the editor has always done; `center` is the one that moves it.
 */
export type PivotMode = "active" | "center" | "individual";

/**
 * Which axes the gizmo lies along.
 *
 * `local` is the active placement's own axes; `world` is the level's. Several
 * placements at several rotations have no shared local axis, which is why
 * `local` means the active one's rather than each placement's.
 */
export type AxisMode = "world" | "local";

/**
 * Which part of a gizmo a press landed on.
 *
 * The first four belong to the single-transform gizmos: `x` and `y` constrain
 * the gesture to one of the placement's own axes, `xy` is the unconstrained
 * centre, and `ring` is the rotate gizmo's only handle.
 *
 * The rest belong to the box. The eight compass points name the box's own
 * sides rather than the screen's — `n` is the side at the placement's own
 * lower `y`, which is the top of an unrotated one. `body` is the interior and
 * `turn` is the band outside.
 */
export type HandleId =
  | "x"
  | "y"
  | "xy"
  | "ring"
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "body"
  | "turn";

/**
 * What a scale gesture measures against, per axis, in world units, and what
 * the fraction of it the pointer travels means.
 *
 * Signed: a handle on the side of the box towards lower `x` has a negative
 * `x`, so dragging it further that way grows the placement rather than
 * shrinking it.
 *
 * `extent` is the dragged side's own offset from the anchor at a scale of one,
 * which only a box handle over a single placement scaling about its own origin
 * has. The fraction is then the change in the scale itself, so the side lands
 * under the pointer whatever the scale was — including zero, which no factor
 * can leave.
 *
 * `length` is a distance the gizmo drew: an arm's own length, or the box round
 * a selection. It says nothing about how large the placements are, so the
 * fraction is a change in size rather than in scale.
 */
export interface GizmoReference {
  readonly x: number;
  readonly y: number;
  readonly kind: "extent" | "length";
}

/** Where a gizmo sits and which way its axes point, in world space. */
export interface GizmoAnchor {
  readonly position: EditorPoint;
  /** The placement's world rotation, so the arms lie along its own axes. */
  readonly rotation: number;
}

/**
 * A marquee in progress: the two world corners of the rectangle being dragged,
 * and whether it adds to the selection rather than replacing it.
 */
export interface MarqueeGesture {
  readonly from: EditorPoint;
  readonly to: EditorPoint;
  readonly additive: boolean;
  /**
   * What was selected when the press happened. An additive marquee adds to
   * it, and a cancelled one puts it back — the press itself has already
   * cleared the selection, the way a press on empty space does.
   */
  readonly base: readonly string[];
}

/**
 * A drag in progress. It holds each placement's transform from before the
 * drag, so every pointer move computes the same offset from a fixed base
 * rather than accumulating rounding across moves.
 */
export interface EditGesture {
  readonly kind: GizmoMode;
  /**
   * Which handle started it. Absent for a drag on the placement's body, which
   * is an unconstrained translate however the gizmo is set.
   */
  readonly handle?: HandleId | undefined;
  /**
   * Where the gizmo sits and which way its axes point. Every measurement a
   * gesture makes is taken from here. Absent for a body drag, which needs
   * neither.
   */
  readonly anchor?: GizmoAnchor | undefined;
  /**
   * The world point the placements turn and scale about, when that is not
   * each placement's own origin.
   *
   * Absent means each about its own, which is the `individual` pivot and also
   * a single placement under `active` — where the anchor already sits on the
   * placement's origin, and going out through world space and back would cost
   * a rounding for no change.
   */
  readonly pivot?: EditorPoint | undefined;
  /**
   * How far a rotate gesture has turned in total, accumulated across moves
   * rather than measured from `origin`. Measuring from the origin would jump
   * by a full turn the moment the pointer crossed the ray opposite it, and
   * would cap one drag at half a turn. Zero for the other two kinds.
   */
  readonly spin: number;
  /**
   * What a scale measures against, in world units, frozen when the gesture
   * began so that zooming mid-drag does not jump it.
   *
   * For an arm it is the arm's own length on both axes: measuring against
   * where along the arm the press landed would divide by nearly nothing at its
   * base. For a box handle it is that handle's distance from the pivot on each
   * axis, which is what makes the handle follow the pointer exactly.
   */
  readonly reference: GizmoReference;
  /**
   * Whether the developer is holding the constraint modifier. Read on every
   * move rather than at the press, so it can be taken up and dropped part-way
   * through a drag.
   *
   * It means the same thing in each gesture and a different thing in each:
   * hold a move to one axis, step a turn by 15°, keep a scale's proportions.
   */
  readonly constrained: boolean;
  /**
   * Whether the developer is holding the suspend modifier, which lets this
   * gesture off the grid. Read on every move for the same reason
   * {@link EditGesture.constrained} is, and stored for the same reason:
   * committing recomputes the pose from the gesture alone, and has to
   * reproduce the last one the preview drew.
   */
  readonly suspended: boolean;
  /**
   * The active placement's world position and rotation when the drag began:
   * what a snapped move rounds and what a stepped turn is measured from, and
   * what every other placement keeps its offset from.
   *
   * Frozen at the press for the reason `anchor` is, and separate from `anchor`
   * because `anchor` is the box centre under the `center` pivot, is absent for
   * a drag that started on no gizmo, and carries a zero rotation under the
   * rotate tool and under World axes.
   */
  readonly snapFrom: GizmoAnchor;
  readonly ids: readonly string[];
  /** Pointer position in world space when the drag began. */
  readonly origin: EditorPoint;
  readonly current: EditorPoint;
  readonly base: ReadonlyMap<string, LevelTransform>;
}

/**
 * One number of a placement's local transform, named as a panel types it:
 * `x` and `y` in world units, `rotation` in degrees, and the two scale
 * factors. There is no sixth — a placement has a position, an angle, and a
 * scale per axis, and no shear.
 */
export type PoseComponent = "x" | "y" | "rotation" | "scaleX" | "scaleY";

/**
 * A number a field is part-way through changing, by the arrow keys or by
 * dragging its label.
 *
 * It holds the component rather than a whole transform, so a settle composes
 * the command from the projection as it stands and writes back only what the
 * field changed. It lives here beside {@link EditorState.gesture} for the same
 * reason a gesture does: `settleEdits` has to find it, undo and save have to
 * wait for it, and `isDirty` has to count it.
 */
export interface PoseDraft {
  readonly id: string;
  readonly component: PoseComponent;
  /** In the field's own unit, so degrees for `rotation`. */
  readonly value: number;
}

/**
 * Which kind of parameter value a viewport handle drags. A point today; a
 * value with more than one handle joins as a second name.
 */
export type ParamValueKind = "point";

/**
 * A parameter value being dragged by its handle in the viewport.
 *
 * It holds the handle's world point and the pointer's world point from the
 * press, so every move computes the same offset from a fixed base rather than
 * accumulating rounding across moves — the reason {@link EditGesture} holds a
 * base too.
 *
 * `kind` and `relative` are read off the field's description when the drag
 * starts, so working out the value needs the document and this alone, and
 * never the catalog.
 */
export interface ParamDrag {
  readonly id: string;
  /** The parameter's name. */
  readonly field: string;
  readonly kind: ParamValueKind;
  /** Which part of the handle the press landed on. A point answers `body`. */
  readonly grip: HandleId;
  /** Whether the value is in the placement's own frame rather than the world's. */
  readonly relative: boolean;
  /** Where the handle sat in world space when the press happened. */
  readonly from: EditorPoint;
  /** Where the pointer was in world space when the press happened. */
  readonly origin: EditorPoint;
  readonly current: EditorPoint;
  /** Shift is held: the move is kept to one axis of the value's own frame. */
  readonly constrained: boolean;
  /** Alt is held: this drag is off the grid for as long as it is. */
  readonly suspended: boolean;
}

/**
 * A reference parameter waiting for its target to be pointed at.
 *
 * `types` is captured when the mode is armed rather than looked up on each
 * read: the accepted types come from the type declaration, and the preview and
 * the hierarchy both need them without either reaching the catalog.
 */
export interface ReferencePick {
  /** The placement whose parameter is waiting. */
  readonly placementId: string;
  /** The parameter's name. */
  readonly field: string;
  /** The placement types it accepts, as catalog type ids. Never empty. */
  readonly types: readonly string[];
}

export interface EditorState {
  /** Absent until a level is open. */
  readonly file?: EditorFileState;
  /** The last document the server accepted, and the revision it accepted it at. */
  readonly committed: {
    readonly document: LevelDocument;
    readonly draftRevision: number;
  };
  readonly pending: readonly PendingCommand[];
  /** The committed document with every pending command replayed on top. */
  readonly document: LevelDocument;
  readonly selection: ReadonlySet<string>;
  /**
   * What a paste would put down: the placements copied last, held as they were
   * rather than as ids, so a paste still works after the originals are gone.
   *
   * It is not persisted and it is not part of `view`. It outlives the open
   * level, which is what lets a developer copy from one level and paste into
   * another; it does not outlive the tab, which a stored one would have to
   * promise and could not keep once the source level changed underneath it.
   */
  readonly clipboard: readonly LevelPlacement[];
  readonly view: EditorViewState;
  /**
   * Which gizmo the viewport draws over the selection. It is not part of
   * `view`: the view has a stored shape that outlives the session, and a tool
   * mode is re-picked in one keystroke.
   */
  readonly tool: EditorTool;
  /**
   * What rotate and scale work about, and which axes the gizmo lies along.
   *
   * Beside `tool` rather than in `view`, and for a stronger reason than
   * `tool` has: these change what an edit *does*. A stored pivot mode would
   * mean opening the editor tomorrow to find that a rotate moves things, with
   * nothing on screen having changed since yesterday.
   */
  readonly pivot: PivotMode;
  readonly axes: AxisMode;
  /**
   * What the server's history holds, mirrored from the last snapshot. It is
   * the only thing the undo and redo controls read: an operation that changes
   * nothing answers `accepted` at the revision it was sent against, so a
   * control that inferred availability from the revision moving would be wrong
   * exactly when the stack is empty.
   */
  readonly history: HistorySummary;
  readonly gesture?: EditGesture | undefined;
  /** A marquee being dragged. Never set at the same time as `gesture`. */
  readonly marquee?: MarqueeGesture | undefined;
  /** A number a field is stepping or scrubbing. At most one at a time. */
  readonly poseDraft?: PoseDraft | undefined;
  /**
   * A parameter value being dragged by its handle in the viewport. Never set
   * at the same time as `gesture`: a press starts one or the other.
   */
  readonly paramDrag?: ParamDrag | undefined;
  /**
   * The placements a delete is waiting for an answer about, because something
   * outside the set points at one of them. Absent while no question is open.
   */
  readonly pendingDelete?: readonly string[] | undefined;
  /**
   * The reference parameter waiting for a target to be pointed at. Absent
   * while nothing is waiting.
   */
  readonly pick?: ReferencePick | undefined;
  readonly diagnostics: ReadonlyMap<
    DiagnosticSource,
    readonly EditorDiagnostic[]
  >;
  readonly writesLocked: readonly WriteLockReason[];
  /**
   * How large the preview's pane is and how large the game says its picture
   * is, which together decide the zoom a level opens at when nothing is
   * remembered for it. Absent until the preview has measured, which is after
   * the shell first renders.
   */
  readonly viewport?: ViewportSizes | undefined;
}

/** The two rectangles a default zoom is derived from, in canvas pixels. */
export interface ViewportSizes {
  /** The pane the level is drawn in. */
  readonly pane: { readonly width: number; readonly height: number };
  /** The picture size the game's renderer was configured with. */
  readonly design: { readonly width: number; readonly height: number };
}

/**
 * Everything that changes editor state. A document change is always a command
 * or a server snapshot — never a field written directly — so the browser's
 * projection cannot drift from the draft the server holds.
 */
export type EditorAction =
  /** A level was opened, or its draft was re-read whole. */
  | { readonly type: "level-opened"; readonly snapshot: DraftSnapshot }
  /**
   * A local command was applied optimistically and sent. `impact` is what the
   * reduction said the preview has to do: rebuild the scene, write the
   * affected poses, or nothing. It lives on the action alone: a rebase or a
   * history step rebuilds whatever the impact was, so nothing reads it after
   * this dispatch.
   */
  | {
      readonly type: "command-applied";
      readonly command: DocumentCommand;
      readonly affected: readonly string[];
      readonly impact: PreviewImpact;
    }
  /** The server accepted a command; its snapshot becomes the committed state. */
  | {
      readonly type: "command-accepted";
      readonly commandId: string;
      readonly snapshot: DraftSnapshot;
    }
  /** The server answered stale; the command stays pending against a newer base. */
  | {
      readonly type: "command-rebased";
      readonly commandId: string;
      readonly snapshot: DraftSnapshot;
    }
  /** The command will not be sent again, and its edit is gone. */
  | {
      readonly type: "command-dropped";
      readonly commandId: string;
      readonly diagnostic: EditorDiagnostic;
      readonly snapshot?: DraftSnapshot;
    }
  /**
   * The server replayed a history entry. It carries no command id: undo and
   * redo never enter `pending`, because an inverse reuses the `commandId` of
   * the command it undoes and that list is keyed by it.
   */
  | { readonly type: "history-stepped"; readonly snapshot: DraftSnapshot }
  /** A save completed; only the file hashes and the revision move. */
  | { readonly type: "saved"; readonly snapshot: DraftSnapshot }
  | { readonly type: "selection-changed"; readonly ids: readonly string[] }
  /** Placements were copied. An empty list is a copy of nothing, not a clear. */
  | {
      readonly type: "placements-copied";
      readonly placements: readonly LevelPlacement[];
    }
  /** The view moved by a world-space delta. A pan sends one per pointer move. */
  | { readonly type: "view-panned"; readonly by: EditorPoint }
  /**
   * The view zoomed by a factor around a world point, which stays where it is
   * on screen.
   */
  | {
      readonly type: "view-zoomed";
      readonly factor: number;
      readonly anchor: EditorPoint;
    }
  /** The whole view was replaced: framing a selection, a reset, or a restore. */
  | { readonly type: "view-changed"; readonly view: EditorViewState }
  /** The reference guides were switched on or off. */
  | { readonly type: "guides-toggled" }
  /** Snapping was switched on or off. */
  | { readonly type: "snap-toggled" }
  /** The lattice was resized: what the grid draws and what a gesture lands on. */
  | { readonly type: "step-changed"; readonly step: number }
  /**
   * The preview measured its pane, at start and on every resize. It decides
   * the zoom a level with nothing remembered opens at, so it is not written
   * back to storage: the pane is a property of this window, not of the level.
   */
  | { readonly type: "viewport-measured"; readonly viewport: ViewportSizes }
  | { readonly type: "tool-changed"; readonly tool: EditorTool }
  /** The pivot rotate and scale work about. */
  | { readonly type: "pivot-changed"; readonly pivot: PivotMode }
  /** Which axes the gizmo lies along. */
  | { readonly type: "axes-changed"; readonly axes: AxisMode }
  | { readonly type: "gesture-started"; readonly gesture: EditGesture }
  | {
      readonly type: "gesture-moved";
      readonly current: EditorPoint;
      readonly spin: number;
      readonly constrained: boolean;
      readonly suspended: boolean;
    }
  | { readonly type: "gesture-ended" }
  | { readonly type: "marquee-started"; readonly marquee: MarqueeGesture }
  | {
      readonly type: "marquee-moved";
      readonly to: EditorPoint;
      readonly additive: boolean;
    }
  | { readonly type: "marquee-ended" }
  /** A field stepped or scrubbed one number of one placement's transform. */
  | { readonly type: "pose-drafted"; readonly draft: PoseDraft }
  /** That number was abandoned or committed; either way nothing is pending. */
  | { readonly type: "pose-draft-dropped" }
  /** A press landed on a parameter's handle in the viewport. */
  | { readonly type: "param-drag-started"; readonly drag: ParamDrag }
  | {
      readonly type: "param-drag-moved";
      readonly current: EditorPoint;
      readonly constrained: boolean;
      readonly suspended: boolean;
    }
  /** The drag was committed or abandoned; either way nothing is pending. */
  | { readonly type: "param-drag-ended" }
  /** A delete is waiting: something outside `ids` points into it. */
  | {
      readonly type: "delete-confirm-requested";
      readonly ids: readonly string[];
    }
  | { readonly type: "delete-confirm-dismissed" }
  /** A reference field started waiting for a target. */
  | { readonly type: "pick-started"; readonly pick: ReferencePick }
  /** Nothing is waiting any more: a target was chosen, or the mode was left. */
  | { readonly type: "pick-ended" }
  | {
      readonly type: "diagnostics-replaced";
      readonly source: DiagnosticSource;
      readonly diagnostics: readonly EditorDiagnostic[];
    }
  | { readonly type: "writes-locked"; readonly reason: WriteLockReason };
