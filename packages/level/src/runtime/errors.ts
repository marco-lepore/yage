import type { LevelDiagnostic } from "../prepare/types.js";

/** What went wrong, and where, for {@link LevelLoadError}. */
export interface LevelLoadContext {
  readonly documentId: string;
  readonly placementId?: string | undefined;
  readonly typeId?: string | undefined;
  /** Parameter path as segments, when the failure was one parameter's. */
  readonly path?: readonly string[] | undefined;
  /** Every problem preparation found, when that is why the load was refused. */
  readonly diagnostics?: readonly LevelDiagnostic[] | undefined;
  readonly cause?: unknown;
}

/**
 * The one error a strict level load throws. No level is left half-loaded: a
 * construction failure rolls the whole batch back before it publishes
 * anything, and an activation failure disposes the instance it had already
 * committed. Disposal destroys through the engine's ordinary path, so those
 * entities leave the scene at the end of the frame rather than immediately.
 */
export class LevelLoadError extends Error {
  readonly documentId: string;
  readonly placementId: string | undefined;
  readonly typeId: string | undefined;
  readonly path: readonly string[] | undefined;
  readonly diagnostics: readonly LevelDiagnostic[];

  /** @internal Thrown by the loader; a game catches one rather than building it. */
  constructor(message: string, context: LevelLoadContext) {
    super(
      message,
      context.cause === undefined ? undefined : { cause: context.cause },
    );
    this.name = "LevelLoadError";
    this.documentId = context.documentId;
    this.placementId = context.placementId;
    this.typeId = context.typeId;
    this.path = context.path;
    this.diagnostics = context.diagnostics ?? [];
  }
}
