import type { LevelPlacement } from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import {
  inboundReferences,
  referenceTargets,
  rewriteReferences,
} from "./references.js";

function placement(
  id: string,
  type: string,
  params: LevelPlacement["params"] = {},
): LevelPlacement {
  return {
    id,
    type,
    typeVersion: 1,
    active: true,
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    params,
    extensions: {},
  };
}

/** The same placement, parented under another. */
function under(child: LevelPlacement, parentId: string): LevelPlacement {
  return { ...child, parent: parentId };
}

/** `game.switch` declares one reference parameter; a crate declares none. */
const FIELDS = (typeId: string): readonly string[] =>
  typeId === "game.switch" ? ["door"] : [];

describe("inboundReferences", () => {
  it("finds a referrer outside the removed set", () => {
    const entities = [
      placement("s1", "game.switch", { door: "c1" }),
      placement("c1", "game.crate"),
    ];

    expect(inboundReferences(entities, new Set(["c1"]), FIELDS)).toEqual([
      { placementId: "s1", field: "door", targetId: "c1" },
    ]);
  });

  it("ignores a referrer inside the removed set", () => {
    const entities = [
      placement("s1", "game.switch", { door: "c1" }),
      placement("c1", "game.crate"),
    ];

    expect(inboundReferences(entities, new Set(["s1", "c1"]), FIELDS)).toEqual(
      [],
    );
  });

  it("ignores a reference with nothing chosen", () => {
    const entities = [
      placement("s1", "game.switch", { door: null }),
      placement("c1", "game.crate"),
    ];

    expect(inboundReferences(entities, new Set(["c1"]), FIELDS)).toEqual([]);
  });

  it("ignores a placement of a type that declares no reference", () => {
    const entities = [
      placement("c2", "game.crate", { door: "c1" }),
      placement("c1", "game.crate"),
    ];

    expect(inboundReferences(entities, new Set(["c1"]), FIELDS)).toEqual([]);
  });

  it("reports every reference a placement holds into the set", () => {
    const two = (typeId: string): readonly string[] =>
      typeId === "game.switch" ? ["door", "spare"] : [];
    const entities = [
      placement("s1", "game.switch", { door: "c1", spare: "c2" }),
      placement("c1", "game.crate"),
      placement("c2", "game.crate"),
    ];

    expect(inboundReferences(entities, new Set(["c1", "c2"]), two)).toEqual([
      { placementId: "s1", field: "door", targetId: "c1" },
      { placementId: "s1", field: "spare", targetId: "c2" },
    ]);
  });
});

describe("rewriteReferences", () => {
  it("replaces the ids the map covers and keeps the rest", () => {
    const params = { door: "a", spare: "b", texture: "art.png" };

    expect(
      rewriteReferences(params, ["door", "spare"], new Map([["a", "copy-1"]])),
    ).toEqual({ door: "copy-1", spare: "b", texture: "art.png" });
  });

  it("returns the same object when nothing changes", () => {
    const params = { door: "a" };

    expect(rewriteReferences(params, ["door"], new Map())).toBe(params);
    expect(rewriteReferences(params, [], new Map([["a", "b"]]))).toBe(params);
  });

  it("leaves a field holding nothing alone", () => {
    expect(
      rewriteReferences({ door: null }, ["door"], new Map([["a", "b"]])),
    ).toEqual({ door: null });
  });
});

describe("referenceTargets", () => {
  it("maps a placement of an accepted type to itself", () => {
    const entities = [placement("c1", "game.crate")];

    expect([...referenceTargets(entities, ["game.crate"])]).toEqual([
      ["c1", "c1"],
    ]);
  });

  it("maps a descendant to the accepted placement above it", () => {
    const entities = [
      placement("c1", "game.crate"),
      under(placement("lamp", "game.lamp"), "c1"),
      under(placement("bulb", "game.bulb"), "lamp"),
      under(placement("wick", "game.wick"), "bulb"),
    ];

    const targets = referenceTargets(entities, ["game.crate"]);

    expect(targets.get("lamp")).toBe("c1");
    expect(targets.get("wick")).toBe("c1");
  });

  it("maps an accepted placement under another one to itself", () => {
    const entities = [
      placement("outer", "game.crate"),
      under(placement("inner", "game.crate"), "outer"),
    ];

    expect(referenceTargets(entities, ["game.crate"]).get("inner")).toBe(
      "inner",
    );
  });

  it("leaves out a placement with no accepted placement above it", () => {
    const entities = [
      placement("s1", "game.switch"),
      under(placement("knob", "game.knob"), "s1"),
    ];

    expect([...referenceTargets(entities, ["game.crate"])]).toEqual([]);
  });

  it("accepts nothing when the list of types is empty", () => {
    const entities = [placement("c1", "game.crate")];

    expect([...referenceTargets(entities, [])]).toEqual([]);
  });
});
