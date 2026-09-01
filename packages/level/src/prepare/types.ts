import type { AssetHandle } from "@yagejs/core";
import type { LevelCatalogEntry } from "../catalog/types.js";
import type { LevelDocument, LevelPlacement } from "../document/types.js";

/**
 * A problem with one placement, found by checking the document against the
 * catalog. Structural problems belong to `readLevel` and never reach here.
 *
 * Every diagnostic blocks a strict load. The code lets a tool choose an
 * action without parsing the human-readable message. There is no severity
 * property because every value here is an error.
 */
export interface LevelDiagnostic {
  readonly code: LevelDiagnosticCode;
  readonly placementId: string;
  /**
   * Path to the offending parameter, as segments — empty when the problem is
   * the placement itself. Segments rather than a joined string, because a
   * parameter name can contain a dot.
   */
  readonly path: readonly string[];
  readonly message: string;
}

/** Why preparation rejected one placement. */
export type LevelDiagnosticCode =
  | "unknown-type"
  | "migration-failed"
  | "parameter-invalid"
  | "asset-derivation-failed";

/** One placement that prepared cleanly, and everything loading it needs. */
export interface PreparedPlacement {
  /**
   * The placement with migrations applied: `params` are at the declaration's
   * current version, and `typeVersion` says so.
   */
  readonly placement: LevelPlacement;
  /**
   * The catalog entry this placement was prepared against. Carried rather than
   * looked up again at load, so a catalog rebuilt in between cannot change
   * what a placement means halfway.
   */
  readonly entry: LevelCatalogEntry;
  /** Handles derived from the migrated parameters, in field order. */
  readonly assets: readonly AssetHandle<unknown>[];
}

/**
 * What {@link prepareLevel} returns: the document with migrations applied,
 * the placements that can be loaded, and every problem with the ones that
 * cannot.
 */
export interface PreparedLevel {
  /**
   * The normalized document. A placement that prepared carries its migrated
   * parameters; a placement that failed keeps exactly what was authored, so
   * nothing is lost by saving this document back.
   */
  readonly document: LevelDocument;
  readonly placements: readonly PreparedPlacement[];
  readonly diagnostics: readonly LevelDiagnostic[];
}
