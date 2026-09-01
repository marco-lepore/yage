import type { PreparedLevel, PreparedPlacement } from "@yagejs/level";
import type { LevelPlacement } from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import {
  MAX_PREVIEW_ATTEMPTS,
  buildBestEffort,
  closeDependents,
  subsetOf,
} from "./projection.js";

function prepared(
  entries: Array<{ id: string; parent?: string }>,
  diagnosticIds: readonly string[] = [],
): PreparedLevel {
  const placements = entries.map((entry) => {
    const placement = {
      id: entry.id,
      type: "game.crate",
      typeVersion: 1,
      active: true,
      transform: {
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      params: {},
      extensions: {},
      ...(entry.parent === undefined ? {} : { parent: entry.parent }),
    } satisfies LevelPlacement;
    return {
      placement,
      entry: {} as PreparedPlacement["entry"],
      assets: [],
    } satisfies PreparedPlacement;
  });
  return {
    document: {
      format: "yage-level",
      version: 1,
      id: "forest",
      metadata: {},
      entities: placements.map((entry) => entry.placement),
      extensions: {},
    },
    placements,
    diagnostics: diagnosticIds.map((id) => ({
      code: "parameter-invalid" as const,
      placementId: id,
      path: [],
      message: `${id} is invalid.`,
    })),
  };
}

/** A load that refuses the named placements, one failure per attempt. */
function loaderRefusing(...ids: readonly string[]) {
  const remaining = [...ids];
  return (subset: PreparedLevel): readonly string[] => {
    const present = subset.placements.map((entry) => entry.placement.id);
    const next = remaining.find((id) => present.includes(id));
    if (next !== undefined) {
      remaining.splice(remaining.indexOf(next), 1);
      throw { placementId: next, message: `${next} failed.` };
    }
    return present;
  };
}

const describeFailure = (
  error: unknown,
): { placementId?: string; message: string } | undefined =>
  typeof error === "object" && error !== null && "placementId" in error
    ? (error as { placementId: string; message: string })
    : undefined;

describe("buildBestEffort", () => {
  it("builds everything when nothing fails", () => {
    const outcome = buildBestEffort(
      prepared([{ id: "a" }, { id: "b" }]),
      [],
      loaderRefusing(),
      describeFailure,
    );

    expect(outcome.built).toEqual(["a", "b"]);
    expect([...outcome.excluded]).toEqual([]);
    expect(outcome.attempts).toBe(1);
  });

  it("retries without the placement that failed", () => {
    const outcome = buildBestEffort(
      prepared([{ id: "a" }, { id: "broken" }, { id: "c" }]),
      [],
      loaderRefusing("broken"),
      describeFailure,
    );

    expect(outcome.built).toEqual(["a", "c"]);
    expect([...outcome.excluded]).toEqual(["broken"]);
    expect(outcome.attempts).toBe(2);
  });

  it("excludes the children of a placement that failed", () => {
    const outcome = buildBestEffort(
      prepared([
        { id: "broken" },
        { id: "child", parent: "broken" },
        { id: "grandchild", parent: "child" },
        { id: "other" },
      ]),
      [],
      loaderRefusing("broken"),
      describeFailure,
    );

    expect(outcome.built).toEqual(["other"]);
    expect([...outcome.excluded].sort()).toEqual([
      "broken",
      "child",
      "grandchild",
    ]);
  });

  it("starts from the placements preparation already rejected", () => {
    const level = prepared([{ id: "a" }, { id: "unprepared" }], ["unprepared"]);
    const outcome = buildBestEffort(
      level,
      level.diagnostics.map((diagnostic) => diagnostic.placementId),
      loaderRefusing(),
      describeFailure,
    );

    expect(outcome.built).toEqual(["a"]);
    expect(outcome.attempts).toBe(1);
  });

  it("gives up when every placement has failed", () => {
    const outcome = buildBestEffort(
      prepared([{ id: "a" }, { id: "b" }]),
      [],
      loaderRefusing("a", "b"),
      describeFailure,
    );

    expect(outcome.built).toBeUndefined();
    expect([...outcome.excluded].sort()).toEqual(["a", "b"]);
    // Two attempts, not three: an empty subset is not worth loading.
    expect(outcome.attempts).toBe(2);
  });

  it("rethrows a failure that names no placement", () => {
    expect(() =>
      buildBestEffort(
        prepared([{ id: "a" }]),
        [],
        () => {
          throw new Error("The renderer is gone.");
        },
        describeFailure,
      ),
    ).toThrow("The renderer is gone.");
  });

  it("stops at the attempt ceiling on a very large broken document", () => {
    const ids = Array.from(
      { length: 50 },
      (_value, index) => `p${String(index)}`,
    );
    const outcome = buildBestEffort(
      prepared(ids.map((id) => ({ id }))),
      [],
      loaderRefusing(...ids),
      describeFailure,
    );

    expect(outcome.attempts).toBe(MAX_PREVIEW_ATTEMPTS);
    expect(outcome.built).toBeUndefined();
  });
});

describe("subsetOf", () => {
  it("drops the excluded placements and the diagnostics with them", () => {
    const level = prepared([{ id: "a" }, { id: "b" }], ["b"]);
    const subset = subsetOf(level, new Set(["b"]));

    expect(subset.placements.map((entry) => entry.placement.id)).toEqual(["a"]);
    expect(subset.diagnostics).toEqual([]);
    // The document keeps every placement: what is authored does not change
    // because the preview could not build part of it.
    expect(subset.document.entities).toHaveLength(2);
  });
});

describe("closeDependents", () => {
  it("leaves a document with no excluded placements alone", () => {
    const excluded = new Set<string>();
    closeDependents(
      prepared([{ id: "a" }, { id: "b", parent: "a" }]).placements,
      excluded,
    );

    expect(excluded.size).toBe(0);
  });
});
