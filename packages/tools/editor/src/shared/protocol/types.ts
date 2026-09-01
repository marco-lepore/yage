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
