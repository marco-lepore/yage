import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import {
  isAncestorOrSelf,
  placementById,
  placementTree,
  rootsWithout,
  selectionRoots,
  sharedParent,
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

describe("sharedParent", () => {
  it("answers the parent every named placement is under", () => {
    expect(sharedParent(FAMILY, ["child"])).toBe("root");
  });

  it("answers null for placements at the top level", () => {
    expect(sharedParent(FAMILY, ["root", "stranger"])).toBeNull();
  });

  it("answers undefined when they are under different parents", () => {
    expect(sharedParent(FAMILY, ["child", "grandchild"])).toBeUndefined();
  });

  it("counts the top level as a parent, not as the absence of one", () => {
    // A root and a child are two frames, so a number typed for both would
    // mean two things.
    expect(sharedParent(FAMILY, ["root", "child"])).toBeUndefined();
  });

  it("answers undefined for nothing named", () => {
    expect(sharedParent(FAMILY, [])).toBeUndefined();
  });

  it("skips an id the document does not hold", () => {
    expect(sharedParent(FAMILY, ["ghost", "child"])).toBe("root");
  });

  it("answers the roots of a selection when it is handed them", () => {
    // What ordering asks: a selected child travels with its selected parent,
    // so the roots are what has to share a group to move within.
    const ids = ["root", "child", "grandchild", "stranger"];

    expect(sharedParent(FAMILY, ids)).toBeUndefined();
    expect(sharedParent(FAMILY, selectionRoots(FAMILY, ids))).toBeNull();
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

describe("rootsWithout", () => {
  it("names every top-level placement the named ones are not part of", () => {
    expect(rootsWithout(FAMILY, ["grandchild"])).toEqual(["stranger"]);
    expect(rootsWithout(FAMILY, ["root"])).toEqual(["stranger"]);
    expect(rootsWithout(FAMILY, ["stranger"])).toEqual(["root"]);
  });

  it("names every root when nothing is chosen", () => {
    expect(rootsWithout(FAMILY, [])).toEqual(["root", "stranger"]);
  });

  it("names none when the chosen ones cover every tree", () => {
    expect(rootsWithout(FAMILY, ["child", "stranger"])).toEqual([]);
  });

  it("ignores an id the document does not hold", () => {
    expect(rootsWithout(FAMILY, ["ghost"])).toEqual(["root", "stranger"]);
  });
});
