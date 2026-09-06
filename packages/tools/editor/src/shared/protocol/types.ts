import type { LevelDocument } from "@yagejs/level/document";
import type { DocumentCommand } from "../commands/index.js";

/**
 * Every editor route lives under this prefix. The version is in the path so a
 * browser page left open across a package upgrade fails on the route rather
 * than on a field it does not understand.
 */
export const EDITOR_API_PREFIX = "/__yage_editor/api/v1";

/** Header carrying the per-process project token. */
export const EDITOR_TOKEN_HEADER = "x-yage-editor-token";

/** One level file the server is willing to open. */
export interface LevelSummary {
  readonly path: string;
  readonly diskRevision: string;
}

/** What the asset picker lists: every project file the config's globs match. */
export interface AssetListing {
  /**
   * Project-relative POSIX paths, sorted. They are the same shape a level
   * stores, so a picked path needs no conversion on its way into `params`.
   */
  readonly paths: readonly string[];
  /**
   * Whether more files matched than `paths` carries. A project that hits this
   * narrows its `assets` globs; the picker says so rather than pretending the
   * list is complete.
   */
  readonly truncated: boolean;
}

export interface BootstrapResponse {
  readonly projectId: string;
  /** Unique per server boot: a request from an older boot cannot be applied. */
  readonly epoch: string;
  readonly levels: readonly LevelSummary[];
  /**
   * Where a new level can be put: the fixed directory of each configured level
   * glob, in config order. `""` is the project root. Whatever a dialog offers
   * from it, the path a create asks for is matched against the globs.
   */
  readonly levelDirectories: readonly string[];
}

/**
 * How much of a level's history is available, mirrored so the browser can
 * enable or disable its controls without asking a second time.
 */
export interface HistorySummary {
  /** Accepted edits that can still be undone. */
  readonly undoDepth: number;
  /** Undone edits that can still be redone. */
  readonly redoDepth: number;
}

/**
 * Everything a browser needs to hold one level, read in a single queue step so
 * the revisions and hashes in it describe one moment.
 */
export interface DraftSnapshot {
  readonly path: string;
  readonly epoch: string;
  /**
   * Which of the page's imported layer sets this level is authored against.
   *
   * The index is into the layer modules the config named, once each and in
   * config order. It comes from the first `levels` entry that both names a
   * layers module and matches this path; entries naming none are skipped
   * rather than ending the search. Absent when no entry that names one
   * matches.
   */
  readonly layerSet?: number;
  readonly document: LevelDocument;
  /** Ordering for commands. Advances whenever the document changes. */
  readonly draftRevision: number;
  /** Hash of the exact bytes on disk, which a save compares against. */
  readonly diskRevision: string;
  /** Hash of the canonical draft, which drives the dirty indicator. */
  readonly contentHash: string;
  readonly savedContentHash: string;
  readonly dirty: boolean;
  readonly history: HistorySummary;
}

export type DraftRejectionCode =
  /** The server restarted: refetch bootstrap and the snapshot. */
  | "epoch-mismatch"
  /** The command cannot apply to this document; re-sending will not help. */
  | "invalid-command"
  /** Applying it would produce a document the level format rejects. */
  | "structurally-invalid"
  /** The addressed revision is no longer retained. */
  | "unretained-revision"
  /** The file changed underneath the editor. */
  | "stale-disk"
  /** The write itself failed; the file on disk is unchanged. */
  | "write-failed"
  /** No readable level file at that path. */
  | "missing-file";

export type DraftOutcome =
  | { readonly status: "accepted"; readonly snapshot: DraftSnapshot }
  /**
   * The request addressed an older draft revision. The snapshot is the current
   * one, so the browser rebases without a second round trip.
   */
  | { readonly status: "stale"; readonly snapshot: DraftSnapshot }
  | {
      readonly status: "rejected";
      readonly code: DraftRejectionCode;
      readonly message: string;
      /** Absent when the level has no draft, which is why it was rejected. */
      readonly snapshot?: DraftSnapshot;
    };

/** Why a request about a level file changed nothing. */
export type LevelFileRefusal =
  /** The server restarted: refetch bootstrap and the snapshot. */
  | "epoch-mismatch"
  /** A file already holds that path. A level is never created over one. */
  | "exists"
  /** No configured level glob matches the path. */
  | "not-configured"
  /** There is no level file to copy or remove at that path. */
  | "not-found"
  /** The file is there but is not a level this version can read. */
  | "unreadable"
  /** The write itself failed; the project's files are unchanged. */
  | "write-failed";

/**
 * What creating and duplicating a level answer.
 *
 * A created level carries its own summary and its draft, so the browser adds
 * it to the picker and opens it without asking again.
 */
export type LevelCreateOutcome =
  | {
      readonly status: "created";
      readonly level: LevelSummary;
      readonly snapshot: DraftSnapshot;
    }
  | {
      readonly status: "refused";
      readonly reason: LevelFileRefusal;
      readonly message: string;
    };

/** What deleting a level answers: the levels that are left. */
export type LevelDeleteOutcome =
  | { readonly status: "deleted"; readonly levels: readonly LevelSummary[] }
  | {
      readonly status: "refused";
      readonly reason: LevelFileRefusal;
      readonly message: string;
    };

/**
 * What each route answers when it is handled at all.
 *
 * The server annotates each response with its entry and the browser reads the
 * same entry, so two halves that disagree about a body are a type error rather
 * than an undefined field two modules away from the route. Transport failures
 * are not here: those are HTTP statuses with no typed body.
 */
export interface EditorRouteResponses {
  "GET /bootstrap": BootstrapResponse;
  "GET /assets": AssetListing;
  "GET /draft": DraftOutcome;
  "POST /draft/command": DraftOutcome;
  "POST /draft/undo": DraftOutcome;
  "POST /draft/redo": DraftOutcome;
  "POST /draft/save": DraftOutcome;
  "POST /levels/create": LevelCreateOutcome;
  "POST /levels/duplicate": LevelCreateOutcome;
  "POST /levels/delete": LevelDeleteOutcome;
}

/**
 * Every route this version serves, in one place. The server matches a request
 * against this list before anything else about it, so a route from a newer or
 * older browser build is a 404 rather than a complaint about its arguments.
 */
export const EDITOR_ROUTES = [
  "GET /bootstrap",
  "GET /assets",
  "GET /draft",
  "POST /draft/command",
  "POST /draft/undo",
  "POST /draft/redo",
  "POST /draft/save",
  "POST /levels/create",
  "POST /levels/duplicate",
  "POST /levels/delete",
] as const satisfies readonly (keyof EditorRouteResponses)[];

export type EditorRoute = (typeof EDITOR_ROUTES)[number];

/**
 * An operation that changes a level's draft and carries nothing else. Undo and
 * redo replay what the server already holds, so naming the revision they apply
 * to is the whole request.
 */
export interface RevisionedRequest {
  readonly epoch: string;
  readonly expectedDraftRevision: number;
}

export interface DraftCommandRequest {
  readonly epoch: string;
  readonly expectedDraftRevision: number;
  readonly command: DocumentCommand;
}

export interface DraftSaveRequest {
  readonly epoch: string;
  readonly expectedDraftRevision: number;
  readonly expectedDiskRevision: string;
}

/**
 * Create a level at the path the request names in its query, under this id.
 *
 * These three carry no revision. A level file is not a draft: nothing is being
 * applied to a document, so there is no revision to apply it to and no history
 * entry to undo.
 */
export interface LevelCreateRequest {
  readonly epoch: string;
  /** The `id` the new document holds, which the game reads. */
  readonly levelId: string;
}

/** The same, copying an existing level instead of writing an empty one. */
export interface LevelDuplicateRequest {
  readonly epoch: string;
  readonly levelId: string;
  /** The level being copied, project-relative. */
  readonly sourcePath: string;
}

/** Remove the level the request names in its query. */
export interface LevelDeleteRequest {
  readonly epoch: string;
}
