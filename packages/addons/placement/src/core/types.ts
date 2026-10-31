import type { CallbackErrorInfo, ErrorBoundary } from "@yagejs/core";
import type { JsonObject, LevelCatalog, LevelDocument } from "@yagejs/level";

/** Pixels, with clockwise radians as in Transform. */
export interface PlacementPose {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** Local rectangle relative to the object's pivot. */
export interface PlacementRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacementSocket {
  readonly pose: PlacementPose;
  /** A game label, commonly floor, wall or surface. */
  readonly surface: string;
  readonly accepts?: readonly string[];
  /** Default 1. A table surface can accept several objects. */
  readonly capacity?: number;
  /** Omit for a fixed snap point. Otherwise the child's footprint must fit. */
  readonly bounds?: PlacementRect;
  /** Default 24 pixels. */
  readonly radius?: number;
  /** Highest priority, then nearest distance, then authored order. Default 0. */
  readonly priority?: number;
}

/** Placement rules keyed by the existing LevelCatalog's type IDs. */
export interface PlacementDefinition {
  readonly label?: string;
  readonly category?: string;
  readonly footprint: readonly PlacementRect[];
  /** Space around each footprint rectangle, in pixels. Default 0. */
  readonly clearance?: number;
  /** Default ["floor"]. A wall-only item needs a wall socket. */
  readonly surfaces?: readonly string[];
  readonly sockets?: Readonly<Record<string, PlacementSocket>>;
  /** Styles are named parameter patches, checked by the level schema. */
  readonly variants?: Readonly<Record<string, JsonObject>>;
  readonly params?: JsonObject;
}

export type PlacementOperation =
  | "place"
  | "move"
  | "remove"
  | "modify"
  | "customize";

export interface PlacementArea {
  readonly bounds: PlacementRect;
  readonly surface?: string;
  readonly categories?: readonly string[];
  readonly capacity?: number;
  /** Omitted operations are allowed. Dynamic permissions belong in rules. */
  readonly permissions?: Readonly<Partial<Record<PlacementOperation, boolean>>>;
  /** Named finish channels; the first value in each channel is the default. */
  readonly finishes?: Readonly<Record<string, readonly string[]>>;
}

export interface PlacementAttachment {
  readonly parent: string;
  readonly socket: string;
}

export interface PlacementTarget {
  readonly area: string;
  /** World pose for roots; socket-local pose for attached objects. */
  readonly pose: PlacementPose;
  readonly attachment?: PlacementAttachment;
}

export interface PlacedObject extends PlacementTarget {
  readonly id: string;
  readonly type: string;
  readonly variant?: string;
  readonly params: JsonObject;
}

export interface PlacementSnapshot {
  readonly version: 1;
  readonly nextId: number;
  readonly objects: readonly PlacedObject[];
  readonly finishes: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export type PlacementCommand =
  | {
      readonly kind: "place";
      readonly type: string;
      readonly target: PlacementTarget;
      readonly variant?: string;
      readonly params?: JsonObject;
    }
  | {
      readonly kind: "move";
      readonly id: string;
      readonly target: PlacementTarget;
    }
  | {
      readonly kind: "duplicate";
      readonly id: string;
      readonly target: PlacementTarget;
    }
  | { readonly kind: "remove"; readonly id: string; readonly cascade?: boolean }
  | {
      readonly kind: "modify";
      readonly id: string;
      /** Null clears the named variant; omitted keeps it. Explicit params override variants. */
      readonly variant?: string | null;
      readonly params?: JsonObject;
    }
  | {
      readonly kind: "customize";
      readonly area: string;
      readonly finishes: Readonly<Record<string, string>>;
    }
  | { readonly kind: "batch"; readonly commands: readonly PlacementCommand[] };

export interface PlacementIssue {
  /** Stable machine-readable code. Custom rules can supply their own codes. */
  readonly code: string;
  readonly message: string;
  readonly object?: string;
  readonly other?: string;
  readonly area?: string;
  readonly path?: string;
  readonly rule?: string;
}

export interface PlacementChange {
  readonly operation: PlacementOperation;
  readonly before?: PlacedObject;
  readonly after?: PlacedObject;
  readonly area?: string;
}

export type PlacementIntent =
  | PlacementCommand["kind"]
  | "undo"
  | "redo"
  | "restore";

export interface PlacementEvaluation {
  readonly intent: PlacementIntent;
  readonly before: PlacementSnapshot;
  readonly after: PlacementSnapshot;
  /** Includes descendants moved with a parent, and both ends of an area move. */
  readonly changes: readonly PlacementChange[];
}

export interface PlacementRule {
  readonly id: string;
  /** Pure and synchronous. Called again at commit, undo and redo. */
  readonly evaluate: (
    evaluation: PlacementEvaluation,
  ) => readonly PlacementIssue[];
}

export interface PlacementExecution {
  readonly errorBoundary?: ErrorBoundary;
  readonly errorContext?: Omit<CallbackErrorInfo, "kind">;
}

export interface PlacementOptions extends PlacementExecution {
  readonly catalog: LevelCatalog;
  readonly definitions: Readonly<Record<string, PlacementDefinition>>;
  readonly areas: Readonly<Record<string, PlacementArea>>;
  readonly rules?: readonly PlacementRule[];
  /** Default 50 committed edits. Zero disables history. */
  readonly historyLimit?: number;
}

export interface PlacementResult extends PlacementEvaluation {
  readonly ok: boolean;
  readonly revision: number;
  readonly issues: readonly PlacementIssue[];
}

export interface PlacementEvent {
  readonly kind: "committed" | "rejected";
  readonly result: PlacementResult;
}

/** Replace the model without replacing a session or controller. */
export interface PlacementModel {
  readonly definitions: Readonly<Record<string, PlacementDefinition>>;
  readonly areas: Readonly<Record<string, PlacementArea>>;
  readonly revision: number;
  snapshot(): PlacementSnapshot;
  preview(
    command: PlacementCommand,
    execution?: PlacementExecution,
  ): PlacementResult;
  commit(
    command: PlacementCommand,
    execution?: PlacementExecution,
  ): PlacementResult;
  undo(execution?: PlacementExecution): PlacementResult;
  redo(execution?: PlacementExecution): PlacementResult;
  restore(
    snapshot: PlacementSnapshot,
    execution?: PlacementExecution,
  ): PlacementResult;
  worldPose(id: string, snapshot?: PlacementSnapshot): PlacementPose;
  toLevelDocument(snapshot?: PlacementSnapshot): LevelDocument;
  subscribe(
    listener: (event: PlacementEvent) => void,
    execution?: PlacementExecution,
  ): () => void;
}
