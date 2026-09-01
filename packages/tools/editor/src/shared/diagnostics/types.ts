import type { LevelDiagnosticCode } from "@yagejs/level";

/**
 * Where a diagnostic came from. A newer document, catalog, or preview revision
 * replaces every diagnostic carrying the same source, which is what keeps a
 * fixed error from staying on screen.
 */
export type DiagnosticSource =
  | "file"
  | "catalog"
  | "validation"
  | "asset"
  | "preview"
  | "runtime"
  | "merge"
  | "server";

export type DiagnosticSeverity = "error" | "warning";

/**
 * Stable identifier for what went wrong, independent of the message text, so a
 * panel can group and a test can assert without matching prose. Each producer
 * adds its own; the union is the set produced today.
 *
 * A finding `@yagejs/level` made keeps its own code: it is stamped with a
 * source and revision and forwarded, not converted, so a repair control can
 * switch on the code and path the package reported.
 */
export type DiagnosticCode =
  | LevelDiagnosticCode
  /** The project's declarations did not build into a catalog. */
  | "catalog-invalid"
  /**
   * A placement could not be built into the preview and was left out, for a
   * reason preparation did not report: an asset that failed to load, or a
   * `setup()` that threw.
   */
  | "placement-excluded"
  /** The preview could not be built at all. */
  | "preview-failed"
  /** An edit could not be applied and was abandoned. */
  | "command-dropped"
  /** The server refused an operation. */
  | "server-rejected";

/**
 * One reportable failure. Every module that reports a failure produces one of
 * these rather than throwing, logging, or holding a private error field.
 */
export interface EditorDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly message: string;
  /**
   * The producer's revision when it was reported — the document revision for
   * document-scoped sources, the preview revision for `preview`. It is what a
   * reader compares to tell a current diagnostic from one that outlived its
   * cause.
   */
  readonly revision: number;
  readonly placementId?: string;
  /** Segments rather than a joined string: a parameter name can contain a dot. */
  readonly path?: readonly string[];
}
