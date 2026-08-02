import type { CallbackErrorRecord } from "@yagejs/core";

/** One line in the panel's errors section. */
export interface LabError {
  /** What failed — the engine's own label for a callback, or one of the kinds below. */
  readonly kind: string;
  readonly message: string;
  /** Scene, entity and event, when the engine knew them. */
  readonly detail?: string | undefined;
}

/** Building the scene failed. The error boundary never sees this one. */
export const REBUILD_ERROR_KIND = "Rebuild";

/** Advancing frames failed. */
export const CLOCK_ERROR_KIND = "Clock";

/** The query string asked for something the registry does not have. */
export const LINK_ERROR_KIND = "Link";

/**
 * Shown while the engine's game loop is stopped, which is what it does when a
 * throw escapes a whole frame. It detaches its ticker on the way out, so no
 * scenario runs again until the page is reloaded — and a rebuild that looks
 * like it worked would otherwise be the only thing on screen.
 */
export const LOOP_STOPPED_ERROR: LabError = {
  kind: "Engine",
  message:
    "A frame threw, so the engine stopped its game loop. Reload the page to run scenarios again.",
};

function describe(record: CallbackErrorRecord): LabError {
  const detail = [record.scene, record.entity, record.event]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
  return {
    kind: record.kind,
    message: record.error,
    detail: detail === "" ? undefined : detail,
  };
}

/**
 * The errors to show for the mounted scenario, most recent last.
 *
 * `records` are the engine's, taken after `mark` so a previous scenario's
 * failures do not linger. `mark` is the record that was last in the log when
 * the scene was built, matched by identity rather than by position: the engine
 * caps its log and drops from the front, which moves every index. A `mark` that
 * has been dropped shows the whole log, so the panel over-reports rather than
 * going blank.
 *
 * `leading` are the lab's own. The last one is dropped when the error boundary
 * recorded the same message, because a `setup` that throws both rejects the
 * rebuild and is attributed to the hook it threw from, and the attributed one
 * says more.
 */
export function collectErrors(
  leading: readonly LabError[],
  records: readonly CallbackErrorRecord[],
  mark: CallbackErrorRecord | null,
): readonly LabError[] {
  const at = mark === null ? -1 : records.indexOf(mark);
  const recorded = records.slice(at + 1).map(describe);
  const newest = recorded[recorded.length - 1];
  const own = leading.filter((error) => error.message !== newest?.message);
  return [...own, ...recorded];
}
