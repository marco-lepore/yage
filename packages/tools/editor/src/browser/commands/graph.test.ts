import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import {
  isAncestorOrSelf,
  placementById,
  placementTree,
  selectionRoots,
  withDescendants,
} from "./graph.js";

function placement(id: string, parent?: string): LevelPlacement {
  return {
    id,
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
    ...(parent === undefined ? {} : { parent }),
  };
}

function document(...entities: LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "level-1",
    metadata: {},
    entities,
    extensions: {},
  };
}

/** root › child › grandchild, plus an unrelated placement. */
const FAMILY = document(
  placement("root"),
  placement("child", "root"),
  placement("grandchild", "child"),
  placement("stranger"),
);

describe("isAncestorOrSelf", () => {
  it("finds a placement above the candidate", () => {
    expect(isAncestorOrSelf(FAMILY, "root", "grandchild")).toBe(true);
  });

  it("counts the candidate itself", () => {
    expect(isAncestorOrSelf(FAMILY, "child", "child")).toBe(true);
  });

  it("does not look downwards", () => {
    expect(isAncestorOrSelf(FAMILY, "grandchild", "root")).toBe(false);
  });

  it("answers for no candidate at all", () => {
    expect(isAncestorOrSelf(FAMILY, "root", undefined)).toBe(false);
  });

  it("stops on a chain that loops", () => {
    const looped = document(placement("a", "b"), placement("b", "a"));

    expect(isAncestorOrSelf(looped, "missing", "a")).toBe(false);
  });
});

describe("withDescendants", () => {
  it("takes everything authored under the named placements", () => {
    expect(withDescendants(FAMILY.entities, ["root"])).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
  });

  it("returns document order, not the order it was asked in", () => {
    expect(withDescendants(FAMILY.entities, ["stranger", "child"])).toEqual([
      "child",
      "grandchild",
      "stranger",
    ]);
  });

  it("reaches a child listed above its own parent", () => {
    // One pass over a list in this order would miss `low`: it is visited
    // before the parent that brings it in.
    const inverted = document(
      placement("low", "high"),
      placement("high", "top"),
      placement("top"),
    );

    expect(withDescendants(inverted.entities, ["top"])).toEqual([
      "low",
      "high",
      "top",
    ]);
  });

  it("ignores an id the document does not hold", () => {
    expect(withDescendants(FAMILY.entities, ["ghost"])).toEqual([]);
  });
});

describe("selectionRoots", () => {
  it("drops a member whose ancestor is also selected", () => {
    expect(selectionRoots(FAMILY, ["root", "child", "grandchild"])).toEqual([
      "root",
    ]);
  });

  it("keeps members that are not related", () => {
    expect(selectionRoots(FAMILY, ["child", "stranger"])).toEqual([
      "child",
      "stranger",
    ]);
  });

  it("drops a member under a selected ancestor that is not its parent", () => {
    expect(selectionRoots(FAMILY, ["root", "grandchild"])).toEqual(["root"]);
  });

  it("returns document order, not the order it was asked in", () => {
    expect(selectionRoots(FAMILY, ["stranger", "root"])).toEqual([
      "root",
      "stranger",
    ]);
  });

  it("ignores an id the document does not hold", () => {
    expect(selectionRoots(FAMILY, ["ghost", "child"])).toEqual(["child"]);
  });

  it("stops on a chain that loops rather than walking it", () => {
    const looped = document(placement("a", "b"), placement("b", "a"));

    expect(selectionRoots(looped, ["a"])).toEqual(["a"]);
  });
});

describe("placementTree", () => {
  it("nests each placement under the one it names", () => {
    const roots = placementTree(FAMILY);

    expect(roots.map((node) => node.placement.id)).toEqual([
      "root",
      "stranger",
    ]);
    expect(roots[0]?.children.map((node) => node.placement.id)).toEqual([
      "child",
    ]);
    expect(
      roots[0]?.children[0]?.children.map((node) => node.placement.id),
    ).toEqual(["grandchild"]);
  });

  it("leaves out a placement whose parent is not in the document", () => {
    const orphaned = document(placement("kept"), placement("lost", "ghost"));

    expect(placementTree(orphaned).map((node) => node.placement.id)).toEqual([
      "kept",
    ]);
  });
});

describe("placementById", () => {
  it("finds each placement by its id", () => {
    expect(placementById(FAMILY).get("child")?.parent).toBe("root");
    expect(placementById(FAMILY).get("ghost")).toBeUndefined();
  });
});
