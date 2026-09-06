import type {
  JsonValue,
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";

/** One placement's new local transform. */
export interface PoseEdit {
  readonly id: string;
  readonly transform: LevelTransform;
}

/**
 * One placement to add, and where it lands.
 *
 * `index` is the position in the document the command produces, not in the one
 * it applies to, and the inserts run in ascending order. That is what makes
 * restoring several removed placements exact: each goes back to the index it
 * was taken from.
 */
export interface PlacementInsert {
  readonly placement: LevelPlacement;
  readonly index: number;
}

/** One existing JSON value to replace when its precondition still matches. */
export interface ValueEdit {
  readonly placementId: string;
  /**
   * `params`, any value inside it however deep, or `typeVersion`. An array
   * element is named by its position written as a decimal string, so one
   * segment type reaches a member and an element alike.
   */
  readonly path: readonly string[];
  readonly expected: JsonValue;
  readonly value: JsonValue;
}

/** One placement's complete authored state on one side of a tree move. */
export interface MovePlacementState {
  readonly parent?: string;
  readonly transform: LevelTransform;
  /** Global index in the document represented by this state. */
  readonly index: number;
}

/**
 * One placement's move, from where it is to where it is going.
 *
 * `from.index` is its position in the document the command applies to, and
 * `to.index` its position in the document the command produces. Every move is
 * taken out first and then put back in ascending `to.index` order, which is
 * what lets one command move several placements and still invert exactly by
 * swapping the two sides.
 */
export interface PlacementMove {
  readonly id: string;
  readonly from: MovePlacementState;
  readonly to: MovePlacementState;
}

/**
 * A serializable edit to a level document.
 *
 * A command carries stable ids, plain values, and the preconditions needed to
 * reject an edit that can no longer apply — never a closure, an entity, or a
 * DOM node. The browser applies it optimistically and the server
 * authoritatively, both through {@link reduceCommand}, so one edit cannot mean
 * two things.
 *
 * Every kind is plural because {@link ReduceResult.inverse} is one command:
 * removing a placement removes its authored subtree, so the inverse of one
 * removal restores several placements, and a drag of a multi-selection is one
 * undo step however many placements it reparents.
 */
export type DocumentCommand =
  | {
      readonly kind: "set-poses";
      readonly commandId: string;
      readonly poses: readonly PoseEdit[];
    }
  | {
      readonly kind: "add-placements";
      readonly commandId: string;
      readonly inserts: readonly PlacementInsert[];
    }
  | {
      readonly kind: "remove-placements";
      readonly commandId: string;
      readonly ids: readonly string[];
    }
  | {
      readonly kind: "set-values";
      readonly commandId: string;
      readonly edits: readonly ValueEdit[];
    }
  | {
      readonly kind: "move-placements";
      readonly commandId: string;
      readonly moves: readonly PlacementMove[];
    };

/**
 * What a command costs the preview: nothing beyond the document, a pose the
 * preview can move in place, or a rebuild of the scene.
 */
export type PreviewImpact = "document-only" | "pose" | "rebuild";

export interface ReduceResult {
  readonly document: LevelDocument;
  /**
   * The command that turns {@link document} back into the one this reduction
   * applied to. Built from that document, so it restores the exact prior
   * state rather than a reconstruction of it, and it carries the same
   * `commandId` as the command it undoes.
   */
  readonly inverse: DocumentCommand;
  /** Placement ids the command changed. */
  readonly affected: readonly string[];
  readonly impact: PreviewImpact;
}

/**
 * A command that cannot apply to the document it was reduced against — an
 * unknown placement id, or a value the document already ruled out. Its
 * revision was current, so re-sending it will not help.
 */
export class CommandPreconditionError extends Error {
  constructor(
    readonly commandId: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandPreconditionError";
  }
}
