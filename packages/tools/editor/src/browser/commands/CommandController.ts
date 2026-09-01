import { defaultParams, type LevelCatalog } from "@yagejs/level";
import type {
  JsonValue,
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import type {
  MovePlacementState,
  PlacementMove,
  PoseEdit,
  ValueEdit,
} from "../../shared/commands/index.js";
import {
  posesOf,
  snappedPoint,
  type EditorPoint,
  type EditorStore,
  type GizmoAnchor,
  type GizmoReference,
  type HandleId,
  type PoseComponent,
} from "../store/index.js";
import {
  gesturePoses,
  parentWorld,
  samePose,
  spunTo,
  toLocal,
  toWorld,
  UNIT_REFERENCE,
  withPoseNumber,
  WORLD_ORIGIN,
} from "./pose.js";
import {
  isAncestorOrSelf,
  placementById,
  selectionRoots,
  withDescendants,
} from "./graph.js";
import { clonePlacements, type CloneRequest } from "./clone.js";

/**
 * The part of `PreviewCoordinator` a drag needs, declared here rather than
 * imported, so producing commands never pulls the engine into this module's
 * import graph. The coordinator satisfies it as it stands.
 */
export interface PosePreview {
  applyPoseDraft(poses: readonly PoseEdit[]): void;
  /** The middle of the viewport in world space, where a created placement lands. */
  viewportCenter(): EditorPoint | undefined;
  /**
   * The point asked for, or the first step from it nothing is sitting on, so
   * repeated creation does not stack.
   */
  freeSpotNear(point: EditorPoint): EditorPoint;
}

export interface CommandControllerOptions {
  readonly store: EditorStore;
  readonly preview: PosePreview;
  /**
   * The catalog in force, read at each intent rather than held, because
   * `ProjectCoordinator` replaces it when the project's modules change.
   */
  readonly catalog: () => LevelCatalog | undefined;
  /** Ids for new commands and new placements. Injected so a test can read them. */
  readonly newId?: () => string;
}

/** What starts a drag: what is being moved, and where the pointer went down. */
/**
 * What a gesture needs to start, by what it edits.
 *
 * The kinds are separate rather than one shape with optional fields because
 * what each needs differs: a turn needs a pivot, and a scale needs a pivot and
 * the length it measures against. An absent reference would silently scale
 * sixty-four times too fast, so it is not expressible.
 */
export type GestureStart = {
  readonly ids: readonly string[];
  readonly origin: EditorPoint;
  /**
   * The world point the placements turn and scale about. Absent means each
   * about its own origin, which is what a single selection has always done.
   */
  readonly pivot?: EditorPoint | undefined;
} & (
  | {
      /** A drag on a placement's body, whatever gizmo the viewport shows. */
      readonly kind?: "translate" | undefined;
      readonly handle?: HandleId | undefined;
      readonly anchor?: GizmoAnchor | undefined;
      readonly reference?: GizmoReference | undefined;
    }
  | {
      readonly kind: "rotate";
      readonly handle?: HandleId | undefined;
      readonly anchor: GizmoAnchor;
      readonly reference?: GizmoReference | undefined;
    }
  | {
      readonly kind: "scale";
      readonly handle?: HandleId | undefined;
      readonly anchor: GizmoAnchor;
      /** What the scale measures against on each axis, in world units. */
      readonly reference: GizmoReference;
    }
);

/**
 * The modifiers held right now, read on every move rather than at the press.
 */
export interface GestureModifiers {
  /**
   * Shift: hold a move to one axis, step a turn, keep a scale's proportions.
   */
  readonly constrained?: boolean;
  /** Alt: let this gesture off the grid for as long as it is held. */
  readonly suspended?: boolean;
}

/**
 * Where a hierarchy drag drops one placement. Before or after a row keeps that
 * row's parent and takes the position next to it; onto a row makes the row
 * the parent; the root area clears the parent.
 */
export type HierarchyDrop =
  | { readonly kind: "before"; readonly siblingId: string }
  | { readonly kind: "after"; readonly siblingId: string }
  | { readonly kind: "into"; readonly parentId: string }
  | { readonly kind: "root" };

/**
 * The only producer of `DocumentCommand` values.
 *
 * A drag is not a command until it ends. While it runs, the pose lives in the
 * store's gesture and on the preview's entities; the draft service, and
 * therefore undo and validation, see one command when the pointer comes up.
 */
export class CommandController {
  private readonly store: EditorStore;
  private readonly preview: PosePreview;
  private readonly catalog: () => LevelCatalog | undefined;
  private readonly newId: () => string;

  constructor(options: CommandControllerOptions) {
    this.store = options.store;
    this.preview = options.preview;
    this.catalog = options.catalog;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /**
   * Put a new placement of `typeId` in the middle of the view, and select it.
   *
   * The placement is whole rather than sparse: `active`, a transform, and
   * every declared parameter at its default are written here. The server
   * normalizes what a command hands it, but the browser's optimistic
   * projection replays the raw command and the preview draws that, so a
   * placement missing a field would be drawn wrong until the answer arrived.
   *
   * Defaults are resolved now, once. A later change to a declaration's default
   * therefore cannot change a level that already exists.
   */
  createPlacement(typeId: string): void {
    if (!this.store.writable) return;
    const entry = this.catalog()?.get(typeId);
    if (!entry) return;
    const middle = this.preview.viewportCenter();
    if (!middle) return;
    // Not the middle itself when something is already there: ten Actors
    // clicks would otherwise stack ten placements on one point. The lattice
    // first, so the cascade steps from a point on the grid.
    const position = this.preview.freeSpotNear(this.landing(middle));

    const schema = entry.declaration.params;
    const placement: LevelPlacement = {
      id: this.newId(),
      type: entry.id,
      typeVersion: entry.declaration.version,
      active: true,
      transform: { ...WORLD_ORIGIN, position },
      params: schema === undefined ? {} : defaultParams(schema),
      extensions: {},
    };
    // At the end of the document, which is the top of the draw order for two
    // placements on one layer — the newest thing placed is the one on top.
    this.store.submit({
      kind: "add-placements",
      commandId: this.newId(),
      inserts: [
        { placement, index: this.store.getState().document.entities.length },
      ],
    });
    this.store.dispatch({
      type: "selection-changed",
      ids: [placement.id],
    });
  }

  /**
   * Put the selection on the clipboard.
   *
   * The placements themselves, not their ids: a paste has to work after the
   * originals are deleted, and after the level they came from is closed.
   * Copying is not an edit, so it needs no command and works on a level whose
   * writes are locked.
   */
  copyPlacements(ids: readonly string[]): void {
    const document = this.store.getState().document;
    const roots = new Set(selectionRoots(document, ids));
    const copying = withDescendants(document.entities, [...roots]);
    if (copying.length === 0) return;
    const byId = placementById(document);
    this.store.dispatch({
      type: "placements-copied",
      placements: copying
        .map((id) => byId.get(id))
        .filter((placement) => placement !== undefined)
        .map((placement) =>
          roots.has(placement.id)
            ? detached(document, placement)
            : structuredClone(placement),
        ),
    });
  }

  /**
   * Put the clipboard down in the open level, and select what it created.
   *
   * The copies land at the middle of the view rather than where they were
   * taken from, so a paste is always somewhere the developer is looking, and
   * they step aside when something is already there.
   *
   * A pasted placement never keeps a parent: the clipboard may have come from
   * another level, and a parent that happens to share an id there would be a
   * different placement here.
   */
  pastePlacements(): void {
    if (!this.store.writable) return;
    const clipboard = this.store.getState().clipboard;
    if (clipboard.length === 0) return;
    const document = this.store.getState().document;
    const source = { ...document, entities: clipboard };
    const roots = selectionRoots(
      source,
      clipboard.map((one) => one.id),
    );
    const anchor = worldPositionOf(source, roots[0]);
    const middle = this.preview.viewportCenter();
    if (!anchor || !middle) return;
    const landing = this.preview.freeSpotNear(this.landing(middle));

    this.submitClones({
      source,
      ids: roots,
      destination: document,
      mode: "paste",
      newId: () => this.newId(),
      offset: { x: landing.x - anchor.x, y: landing.y - anchor.y },
    });
  }

  /**
   * Copy the selection in place, offset so the copies are visible, and select
   * them.
   *
   * It does not touch the clipboard: duplicating something must not throw away
   * what you copied earlier.
   */
  duplicatePlacements(ids: readonly string[]): void {
    if (!this.store.writable) return;
    const document = this.store.getState().document;
    // Narrowed here to pick the point the cascade probes from. The clone does
    // its own narrowing, so this is about where the copies land rather than
    // about which of them are made.
    const roots = selectionRoots(document, ids);
    if (roots.length === 0) return;
    const anchor = worldPositionOf(document, roots[0]);
    if (!anchor) return;
    const landing = this.preview.freeSpotNear(this.landing(anchor));

    this.submitClones({
      source: document,
      ids: roots,
      destination: document,
      mode: "duplicate",
      newId: () => this.newId(),
      offset: { x: landing.x - anchor.x, y: landing.y - anchor.y },
    });
  }

  /** Send one `add-placements` for a set of clones, and select what it adds. */
  private submitClones(request: CloneRequest): void {
    const inserts = clonePlacements(request);
    if (inserts.length === 0) return;
    this.store.submit({
      kind: "add-placements",
      commandId: this.newId(),
      inserts,
    });
    this.store.dispatch({
      type: "selection-changed",
      // The roots only. Selecting a copied subtree whole would put the gizmo
      // on nothing and make the next drag move a child twice.
      ids: inserts
        .filter((insert) => insert.placement.parent === undefined)
        .map((insert) => insert.placement.id),
    });
  }

  /**
   * Delete placements and everything authored under them.
   *
   * The descendant closure is computed here because this side holds the
   * selection. The reducer refuses a removal that would orphan a survivor, so
   * a closure this misses is a refusal rather than a broken document.
   *
   * Settling first is what keeps a delete during a drag coherent. The delete
   * key is read from the same element that holds the pointer capture, so
   * pressing it mid-drag is ordinary; without this the open drag would then
   * commit a move for a placement the projection no longer holds, and the
   * refusal would be reported as an error for a delete that worked.
   */
  async deletePlacements(ids: readonly string[]): Promise<void> {
    await this.settleEdits();
    if (!this.store.writable) return;
    const removing = withDescendants(
      this.store.getState().document.entities,
      ids,
    );
    if (removing.length === 0) return;
    this.store.submit({
      kind: "remove-placements",
      commandId: this.newId(),
      ids: removing,
    });
  }

  /**
   * Set one declared parameter of one placement.
   *
   * The command carries the value the document holds now as its precondition,
   * so an edit typed against a placement the server has since changed is
   * refused rather than silently winning. A field the placement's `params`
   * does not have — a schema that moved under an older file — is written by
   * replacing the whole parameter object with one that adds it, which is the
   * same field-level change through the one path the reducer accepts for it.
   */
  setParam(id: string, field: string, value: JsonValue): void {
    if (!this.store.writable) return;
    const placement = this.placement(id);
    if (!placement) return;
    this.store.submit({
      kind: "set-values",
      commandId: this.newId(),
      edits: [fieldEdit(placement, field, value)],
    });
  }

  /**
   * Label one placement, or take its label away.
   *
   * `null` removes the field, which puts the hierarchy row and the control
   * bar's name box back to the placement's type. Nothing below the document reads a
   * name, so the reduction reports `document-only` and the preview stands.
   */
  setName(id: string, name: string | null): void {
    this.setOptionalField(id, "name", name);
  }

  /**
   * Give one placement the key a game looks it up by, or take it away.
   *
   * `null` removes the field, and the scene key goes back to deriving from the
   * placement id. A key another placement already derives is refused by the
   * reducer; the key box asks before it gets here, so the developer is told
   * which placement holds it instead of watching the edit come back.
   */
  setKey(id: string, key: string | null): void {
    this.setOptionalField(id, "key", key);
  }

  /**
   * Replace one placement's local transform.
   *
   * One typed field is one call, one command, and one undo step: the caller
   * carries the four components it did not change. A typed number is exact, so
   * nothing here snaps it, whatever the grid is set to.
   */
  setPose(id: string, transform: LevelTransform): void {
    // The number a field was stepping is this command now, so it must not
    // settle again behind it.
    const drafted = this.store.takePoseDraft() !== undefined;
    if (!this.store.writable) return;
    const placement = this.placement(id);
    if (!placement) return;
    if (samePose(placement.transform, transform)) {
      // Stepped up and back down again. There is nothing to write, and the
      // preview is still drawing the draft, so put it on the document.
      if (drafted)
        this.preview.applyPoseDraft(posesOf(this.store.getState(), [id]));
      return;
    }
    this.store.submit({
      kind: "set-poses",
      commandId: this.newId(),
      poses: [{ id, transform }],
    });
  }

  /**
   * Hold the number a field is stepping or scrubbing, and draw it.
   *
   * Every press paints the placement at once, so a box is as visible as a
   * drag. Nothing is written: the document sees one `set-poses` when the box
   * commits, which is Enter, a blur, or the settle any of save, run, undo and
   * a level switch begins with. A focus session is therefore one command and
   * one undo step.
   */
  draftPose(id: string, component: PoseComponent, value: number): void {
    if (!this.store.writable) return;
    const placement = this.placement(id);
    if (!placement) return;
    this.store.dispatch({
      type: "pose-drafted",
      draft: { id, component, value },
    });
    this.preview.applyPoseDraft([
      { id, transform: withPoseNumber(placement.transform, component, value) },
    ]);
  }

  /** Abandon a stepped number and put the preview back on the document's pose. */
  cancelPoseDraft(): void {
    const draft = this.store.takePoseDraft();
    if (!draft) return;
    this.preview.applyPoseDraft(posesOf(this.store.getState(), [draft.id]));
  }

  /**
   * One placement field the format lets a document leave out, where `null`
   * means the field is not there — on the wire and in the document alike.
   */
  private setOptionalField(
    id: string,
    field: "name" | "key",
    value: string | null,
  ): void {
    if (!this.store.writable) return;
    const placement = this.placement(id);
    if (!placement) return;
    const expected = placement[field] ?? null;
    if (expected === value) return;
    this.store.submit({
      kind: "set-values",
      commandId: this.newId(),
      edits: [{ placementId: id, path: [field], expected, value }],
    });
  }

  /**
   * Put one declared parameter back to the default its declaration gives it.
   * A field the current declaration does not have has no default to go to,
   * and produces nothing.
   */
  resetParam(id: string, field: string): void {
    const placement = this.placement(id);
    if (!placement) return;
    const defaults = this.defaultsFor(placement.type);
    if (!defaults || !Object.hasOwn(defaults, field)) return;
    this.setParam(id, field, defaults[field] as JsonValue);
  }

  /**
   * Discard a placement's authored parameters: every declared field at its
   * default, and the type version the declaration is at now, in one command
   * — so one undo restores both. This is the recovery for a placement whose
   * schema moved under it; the shell confirms it, because it loses what was
   * authored. A type the catalog does not have offers nothing to reset to.
   */
  resetPlacement(id: string): void {
    if (!this.store.writable) return;
    const placement = this.placement(id);
    if (!placement) return;
    const entry = this.catalog()?.get(placement.type);
    const defaults = this.defaultsFor(placement.type);
    if (!entry || !defaults) return;
    this.store.submit({
      kind: "set-values",
      commandId: this.newId(),
      edits: [
        {
          placementId: id,
          path: ["params"],
          expected: placement.params,
          value: defaults,
        },
        {
          placementId: id,
          path: ["typeVersion"],
          expected: placement.typeVersion,
          value: entry.declaration.version,
        },
      ],
    });
  }

  /**
   * Reparent or reorder placements from a hierarchy drag.
   *
   * A world pose is preserved across a change of parent: the placement stays
   * where it is drawn and its local transform is recomputed, which is the rule
   * the reducer cannot apply without knowing the engine. A move that keeps the
   * parent keeps the transform object as it is: no arithmetic, so a reorder
   * cannot perturb a pose by a rounding step.
   *
   * Dragging one row of a multi-selection moves the whole selection, in one
   * command and therefore one undo step. Only the selection's outermost
   * members move: a selected placement under another selected one already
   * travels with it, and moving it as well would apply the change twice.
   *
   * A drop that would put a placement inside itself produces nothing; the
   * reducer refuses it too, but the shell asks here before it sends.
   */
  movePlacements(ids: readonly string[], drop: HierarchyDrop): void {
    if (!this.store.writable) return;
    const document = this.store.getState().document;
    const roots = selectionRoots(document, ids);
    if (roots.length === 0) return;

    const moving = new Set(roots);
    const destination = destinationOf(document, moving, drop);
    if (!destination) return;
    // One check for the whole drag: a destination inside any moved placement
    // would leave that placement inside itself.
    if (
      roots.some((id) => isAncestorOrSelf(document, id, destination.parent))
    ) {
      return;
    }

    const moves: PlacementMove[] = [];
    for (const [offset, id] of roots.entries()) {
      const index = document.entities.findIndex((one) => one.id === id);
      const placement = document.entities[index];
      if (!placement) return;
      const from = moveState(placement.parent, placement.transform, index);
      const transform =
        from.parent === destination.parent
          ? placement.transform
          : toLocal(
              toWorld(placement.transform, parentWorld(document, from.parent)),
              parentWorld(document, destination.parent),
              placement.transform,
            );
      moves.push({
        id,
        from,
        // The roots land next to each other, in the order the document had
        // them, so a drag of several keeps their arrangement.
        to: moveState(
          destination.parent,
          transform,
          destination.index + offset,
        ),
      });
    }

    const changed = moves.some(
      (move) =>
        move.from.parent !== move.to.parent ||
        move.from.index !== move.to.index,
    );
    if (!changed) return;

    this.store.submit({
      kind: "move-placements",
      commandId: this.newId(),
      moves,
    });
  }

  /**
   * Take back the newest edit, or put back the newest one taken back.
   *
   * Both address an exact revision, so both settle first — the same rule save
   * and run follow. Neither is a command: the server holds the entry and
   * replays it, and this browser learns what happened from the answer.
   */
  async undo(): Promise<void> {
    await this.settleEdits();
    this.store.step("undo");
  }

  async redo(): Promise<void> {
    await this.settleEdits();
    this.store.step("redo");
  }

  beginGesture(start: GestureStart): void {
    if (!this.store.writable) return;
    // A second contact — another finger, a pen — must not replace a drag that
    // is already running: the first drag's movement would be lost with no
    // command and nothing said, and both pointers would then feed one gesture
    // whose origin belongs to the second.
    if (this.store.getState().gesture) return;
    const document = this.store.getState().document;
    // The outermost of what was asked for. A selected child of a selected
    // parent already travels with its parent, and moving it as well would
    // apply the change to it twice.
    const acting = new Set(selectionRoots(document, start.ids));
    const base = new Map<string, LevelTransform>();
    for (const placement of document.entities) {
      if (acting.has(placement.id)) base.set(placement.id, placement.transform);
    }
    // The last selected placement this gesture acts on, which is the one a
    // snap rounds. The gizmo's anchor follows the same rule with one more
    // condition: it skips a placement the preview left out. `start.ids` is in
    // selection order; `acting` and `base` are in document order and cannot
    // answer this.
    let activeId: string | undefined;
    for (const id of start.ids) if (acting.has(id)) activeId = id;
    if (activeId === undefined) return;
    const active = placementById(document).get(activeId);
    if (!active) return;
    const world = toWorld(
      active.transform,
      parentWorld(document, active.parent),
    );
    this.store.dispatch({
      type: "gesture-started",
      gesture: {
        kind: start.kind ?? "translate",
        handle: start.handle,
        anchor: start.anchor,
        pivot: start.pivot,
        spin: 0,
        reference: start.reference ?? UNIT_REFERENCE,
        constrained: false,
        suspended: false,
        snapFrom: { position: world.position, rotation: world.rotation },
        ids: [...base.keys()],
        origin: start.origin,
        current: start.origin,
        base,
      },
    });
  }

  /**
   * Move the open drag to a new pointer position.
   *
   * The modifiers are their state at this moment rather than at the press, so
   * either can be taken up and dropped part-way through a drag the way every
   * drawing tool allows.
   */
  updateGesture(current: EditorPoint, modifiers: GestureModifiers = {}): void {
    const gesture = this.store.getState().gesture;
    if (!gesture) return;
    const constrained = modifiers.constrained ?? false;
    const suspended = modifiers.suspended ?? false;
    // The turn accumulates across moves instead of being measured from the
    // gesture's origin, so it stays continuous when the pointer crosses the
    // ray opposite where it started, and a drag can pass a full turn.
    const spin = spunTo(gesture, current);
    this.store.dispatch({
      type: "gesture-moved",
      current,
      spin,
      constrained,
      suspended,
    });
    // Drawn from the gesture the dispatch just wrote, so the preview and every
    // reader of `state.gesture` compute the same poses from the same inputs.
    this.redrawGesture();
  }

  /**
   * Redraw the open drag from the state as it stands.
   *
   * The lattice is read at each move rather than frozen at the press, so
   * switching the snap or changing the step with the pointer still down
   * changes what a release writes. Only a pointer move redraws the preview, so
   * without this the viewport would keep showing the pose the last move drew
   * and a release in between would commit one that was never on screen.
   */
  redrawGesture(): void {
    const state = this.store.getState();
    if (!state.gesture) return;
    this.preview.applyPoseDraft(gesturePoses(state, state.gesture));
  }

  /** Abandons the drag and puts the preview back on the document's poses. */
  cancelGesture(): void {
    const gesture = this.store.takeGesture();
    if (!gesture) return;
    this.preview.applyPoseDraft(posesOf(this.store.getState(), gesture.ids));
  }

  /**
   * Commit the open drag, then wait out every write already sent.
   *
   * Everything that addresses an exact revision calls this first: a save sends
   * a revision number the browser computed, and an open drag, a sent command,
   * and an undo the server has not answered are all edits that revision would
   * not contain. It is a no-op when none exists, so calling it is never wrong.
   */
  async settleEdits(): Promise<void> {
    this.settleGesture();
    this.settlePoseDraft();
    const ids = this.store
      .getState()
      .pending.map((entry) => entry.command.commandId);
    await Promise.all([this.store.awaitResolved(ids), this.store.awaitSteps()]);
  }

  private settleGesture(): void {
    const gesture = this.store.takeGesture();
    if (gesture) {
      const poses = gesturePoses(this.store.getState(), gesture);
      const moved = poses.filter((pose) => {
        const base = gesture.base.get(pose.id);
        // The whole transform, not just the position: a rotate or a scale
        // leaves the position exactly where it was, and comparing only that
        // would drop the gesture as having changed nothing.
        return base !== undefined && !samePose(base, pose.transform);
      });
      if (moved.length > 0 && this.store.writable) {
        this.store.submit({
          kind: "set-poses",
          commandId: this.newId(),
          poses: moved,
        });
      } else if (moved.length > 0) {
        // The drag is over and its edit was refused, so the preview is showing
        // a pose no document holds. Put it back on what the document says.
        this.preview.applyPoseDraft(
          posesOf(this.store.getState(), gesture.ids),
        );
      }
    }
  }

  /**
   * Turn the number a field is holding into one command.
   *
   * The transform is composed here, from the projection as it stands, and only
   * the component the field changed is taken from the draft. `set-poses`
   * carries a whole transform and has no precondition on the four numbers it
   * does not change, so a transform captured when the box was first stepped
   * would write those four back over anything that moved underneath — a drag,
   * another tab, or an edit the server refused.
   */
  private settlePoseDraft(): void {
    const draft = this.store.takePoseDraft();
    if (!draft) return;
    const placement = this.placement(draft.id);
    if (!placement) return;
    const transform = withPoseNumber(
      placement.transform,
      draft.component,
      draft.value,
    );
    if (samePose(placement.transform, transform)) return;
    if (this.store.writable) {
      this.store.submit({
        kind: "set-poses",
        commandId: this.newId(),
        poses: [{ id: draft.id, transform }],
      });
      return;
    }
    // Refused, so the preview is drawing a pose no document holds.
    this.preview.applyPoseDraft(posesOf(this.store.getState(), [draft.id]));
  }

  private placement(id: string): LevelPlacement | undefined {
    return this.store
      .getState()
      .document.entities.find((placement) => placement.id === id);
  }

  /** The declared defaults for a type, or undefined when it is not catalogued. */
  private defaultsFor(typeId: string): Record<string, JsonValue> | undefined {
    const entry = this.catalog()?.get(typeId);
    if (!entry) return undefined;
    const schema = entry.declaration.params;
    return schema === undefined ? {} : defaultParams(schema);
  }

  /**
   * Where a placement put down without a gesture lands: the point asked for,
   * or that point on the lattice while snapping is on.
   */
  private landing(point: EditorPoint): EditorPoint {
    const view = this.store.getState().view;
    return view.snap ? snappedPoint(point, view.step) : point;
  }
}

/**
 * One field's edit as the reducer accepts it: through `["params", field]` when
 * the placement holds the field, and through `["params"]` — the whole object,
 * with the field added — when it does not, since a path into a missing
 * property is not one the reducer will write.
 */
function fieldEdit(
  placement: LevelPlacement,
  field: string,
  value: JsonValue,
): ValueEdit {
  if (Object.hasOwn(placement.params, field)) {
    return {
      placementId: placement.id,
      path: ["params", field],
      expected: placement.params[field] as JsonValue,
      value,
    };
  }
  return {
    placementId: placement.id,
    path: ["params"],
    expected: placement.params,
    value: { ...placement.params, [field]: value },
  };
}

/**
 * A copied root, holding the pose it was drawn at rather than the one it was
 * authored with.
 *
 * A root's parent is not copied with it, so the clipboard is the last place
 * that can see what the parent contributed. Storing the local transform
 * instead would paste a child of a turned parent without the turn, because a
 * paste has no parent left to compose one from.
 */
function detached(
  document: LevelDocument,
  placement: LevelPlacement,
): LevelPlacement {
  if (placement.parent === undefined) return structuredClone(placement);
  const copy = structuredClone(placement);
  Reflect.deleteProperty(copy, "parent");
  return {
    ...copy,
    transform: toWorld(
      placement.transform,
      parentWorld(document, placement.parent),
    ),
  };
}

/** Where a placement is drawn, which is what a paste or a duplicate offsets from. */
function worldPositionOf(
  document: LevelDocument,
  id: string | undefined,
): EditorPoint | undefined {
  if (id === undefined) return undefined;
  const placement = placementById(document).get(id);
  if (!placement) return undefined;
  const world = toWorld(
    placement.transform,
    parentWorld(document, placement.parent),
  );
  return world.position;
}

function moveState(
  parent: string | undefined,
  transform: LevelTransform,
  index: number,
): MovePlacementState {
  return {
    ...(parent === undefined ? {} : { parent }),
    transform,
    index,
  };
}

/**
 * The parent and global index a drop asks for, in the document the move
 * produces — the one without the moved placements, which is what the reducer
 * inserts into. Undefined when the drop names nothing the document has, or
 * names one of the placements being moved.
 *
 * "Into" appends to the parent's children: after the last placement listed
 * with that parent, or straight after the parent when it has none. That is
 * where the hierarchy shows a new last child, since it lists a parent's
 * children in document order.
 */
function destinationOf(
  document: LevelDocument,
  moving: ReadonlySet<string>,
  drop: HierarchyDrop,
): { parent: string | undefined; index: number } | undefined {
  const others = document.entities.filter(
    (placement) => !moving.has(placement.id),
  );
  const indexOf = (target: string): number =>
    others.findIndex((placement) => placement.id === target);
  switch (drop.kind) {
    case "before":
    case "after": {
      const at = indexOf(drop.siblingId);
      const sibling = others[at];
      if (!sibling) return undefined;
      return {
        parent: sibling.parent,
        index: drop.kind === "before" ? at : at + 1,
      };
    }
    case "into": {
      const at = indexOf(drop.parentId);
      if (at < 0) return undefined;
      let last = at;
      others.forEach((placement, index) => {
        if (placement.parent === drop.parentId) last = index;
      });
      return { parent: drop.parentId, index: last + 1 };
    }
    case "root":
      return { parent: undefined, index: others.length };
  }
}
