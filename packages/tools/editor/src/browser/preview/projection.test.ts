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
  entries: Array<{ id: string; parent?: string; refs?: readonly string[] }>,
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
      references: (entry.refs ?? []).map((targetId) => ({
        path: ["target"],
        targetId,
      })),
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
      new Map(),
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
      new Map(),
      loaderRefusing("broken"),
      describeFailure,
    );

    expect(outcome.built).toEqual(["a", "c"]);
    expect([...outcome.excluded]).toEqual(["broken"]);
    expect(outcome.attempts).toBe(2);
    expect(outcome.reasons.get("broken")).toBe("broken failed.");
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
      new Map(),
      loaderRefusing("broken"),
      describeFailure,
    );

    expect(outcome.built).toEqual(["other"]);
    expect([...outcome.excluded].sort()).toEqual([
      "broken",
      "child",
      "grandchild",
    ]);
    expect(outcome.reasons.get("broken")).toBe("broken failed.");
    // The two that went with it name the placement that took them out, which
    // carries its own reason in the same report.
    expect(outcome.reasons.get("child")).toBe(
      'Placement "child" was left out with its parent "broken".',
    );
    expect(outcome.reasons.get("grandchild")).toBe(
      'Placement "grandchild" was left out with its parent "child".',
    );
  });

  it("names the reference target a placement went out with", () => {
    const outcome = buildBestEffort(
      prepared([{ id: "door" }, { id: "switch", refs: ["door"] }]),
      [],
      new Map(),
      loaderRefusing("door"),
      describeFailure,
    );

    expect(outcome.built).toBeUndefined();
    expect(outcome.reasons.get("switch")).toBe(
      'Placement "switch" was left out with "door", which it points at.',
    );
  });

  it("keeps the reason for a placement the caller already ruled out", () => {
    const outcome = buildBestEffort(
      prepared([
        { id: "a" },
        { id: "noArt" },
        { id: "child", parent: "noArt" },
      ]),
      [],
      new Map([["noArt", 'Asset "/coin.png" failed to load.']]),
      loaderRefusing(),
      describeFailure,
    );

    expect(outcome.built).toEqual(["a"]);
    expect(outcome.reasons.get("noArt")).toBe(
      'Asset "/coin.png" failed to load.',
    );
    expect(outcome.reasons.get("child")).toBe(
      'Placement "child" was left out with its parent "noArt".',
    );
  });

  it("starts from the placements preparation already rejected", () => {
    const level = prepared([{ id: "a" }, { id: "unprepared" }], ["unprepared"]);
    const outcome = buildBestEffort(
      level,
      level.diagnostics.map((diagnostic) => diagnostic.placementId),
      new Map(),
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
      new Map(),
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
        new Map(),
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
      new Map(),
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
      new Map(),
    );

    expect(excluded.size).toBe(0);
  });

  it("excludes a placement whose reference target is excluded", () => {
    const excluded = new Set(["door"]);
    const reasons = new Map<string, string>();
    closeDependents(
      prepared([{ id: "door" }, { id: "switch", refs: ["door"] }]).placements,
      excluded,
      reasons,
    );

    expect([...excluded]).toEqual(["door", "switch"]);
    expect(reasons.get("switch")).toBe(
      'Placement "switch" was left out with "door", which it points at.',
    );
  });

  it("follows a chain of references", () => {
    const excluded = new Set(["a"]);
    closeDependents(
      prepared([
        { id: "a" },
        { id: "b", refs: ["a"] },
        { id: "c", refs: ["b"] },
      ]).placements,
      excluded,
      new Map(),
    );

    expect([...excluded]).toEqual(["a", "b", "c"]);
  });

  it("terminates on two placements that reference each other", () => {
    const excluded = new Set<string>(["outside"]);
    closeDependents(
      prepared([
        { id: "a", refs: ["b"] },
        { id: "b", refs: ["a"] },
      ]).placements,
      excluded,
      new Map(),
    );

    expect([...excluded]).toEqual(["outside"]);
  });

  it("excludes a cycle once one of its members is excluded", () => {
    const excluded = new Set(["a"]);
    closeDependents(
      prepared([
        { id: "a", refs: ["b"] },
        { id: "b", refs: ["a"] },
      ]).placements,
      excluded,
      new Map(),
    );

    expect([...excluded]).toEqual(["a", "b"]);
  });
});
