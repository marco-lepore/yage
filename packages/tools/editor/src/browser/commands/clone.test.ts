import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { readLevel } from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import { clonePlacements } from "./clone.js";
import { parentWorld, toWorld } from "./pose.js";

function transform(
  x: number,
  y: number,
  rest: Partial<LevelTransform> = {},
): LevelTransform {
  return {
    position: { x, y },
    rotation: 0,
    scale: { x: 1, y: 1 },
    ...rest,
  };
}

function placement(
  id: string,
  extra: Partial<LevelPlacement> = {},
): LevelPlacement {
  return {
    id,
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform: transform(0, 0),
    params: {},
    extensions: {},
    ...extra,
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

/** Ids a case can read back: `copy-1`, `copy-2`, in the order they were asked. */
function counter(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `copy-${String(next)}`;
  };
}

/** A project whose types declare no reference parameter. */
const NO_REFERENCE_FIELDS = (): readonly string[] => [];

function clones(
  inserts: ReturnType<typeof clonePlacements>,
): readonly LevelPlacement[] {
  return inserts.map((insert) => insert.placement);
}

/** root at (100, 0) › child at a local (10, 0), plus an unrelated placement. */
const NESTED = document(
  placement("root", { transform: transform(100, 0) }),
  placement("child", { parent: "root", transform: transform(10, 0) }),
  placement("stranger", { transform: transform(-50, -50) }),
);

describe("clonePlacements", () => {
  it("gives every copy a fresh id and keeps the links inside the set", () => {
    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["root"],
        destination: NESTED,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies.map((copy) => copy.id)).toEqual(["copy-1", "copy-2"]);
    // The copied child points at the copied root, not at the original.
    expect(copies[1]?.parent).toBe("copy-1");
    expect(copies[0]?.parent).toBeUndefined();
  });

  it("takes everything under a copied placement, not just the named one", () => {
    const deep = document(
      placement("a"),
      placement("b", { parent: "a" }),
      placement("c", { parent: "b" }),
    );

    const copies = clones(
      clonePlacements({
        source: deep,
        ids: ["a"],
        destination: deep,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies).toHaveLength(3);
    expect(copies[2]?.parent).toBe("copy-2");
  });

  it("duplicates a child as a sibling, keeping the parent it still has", () => {
    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["child"],
        destination: NESTED,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies).toHaveLength(1);
    expect(copies[0]?.parent).toBe("root");
    // Same parent, so the local transform still means the same place.
    expect(copies[0]?.transform.position).toEqual({ x: 10, y: 0 });
  });

  it("detaches a paste at the world pose the original had", () => {
    const empty = document();

    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["child"],
        destination: empty,
        mode: "paste",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.parent).toBeUndefined();
    // The child sat at a local (10, 0) under a root at (100, 0), so it looked
    // like it was at (110, 0). Keeping the local transform would put the copy
    // at (10, 0), a hundred units from where it was drawn.
    expect(copies[0]?.transform.position).toEqual({ x: 110, y: 0 });
  });

  it("detaches a paste even where the destination holds the same parent", () => {
    // The clipboard may have come from another level, where an id that also
    // exists here belongs to a different placement. Only a duplicate, which
    // is copying within one level, may keep a parent it did not copy.
    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["child"],
        destination: NESTED,
        mode: "paste",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.parent).toBeUndefined();
    expect(copies[0]?.transform.position).toEqual({ x: 110, y: 0 });
  });

  it("detaches a duplicate whose parent the destination does not hold", () => {
    const elsewhere = document(placement("unrelated"));

    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["child"],
        destination: elsewhere,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.parent).toBeUndefined();
    expect(copies[0]?.transform.position).toEqual({ x: 110, y: 0 });
  });

  it("carries no parent key at all when it detaches", () => {
    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["child"],
        destination: document(),
        mode: "paste",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    // Not `parent: undefined`, which the document writer would put in the file.
    expect(Object.hasOwn(copies[0] ?? {}, "parent")).toBe(false);
  });

  it("detaches through a turned and scaled parent at the pose it looked", () => {
    const turned = document(
      placement("root", {
        transform: transform(50, 20, {
          rotation: Math.PI / 2,
          scale: { x: 2, y: 2 },
        }),
      }),
      placement("child", { parent: "root", transform: transform(10, 0) }),
    );

    const copies = clones(
      clonePlacements({
        source: turned,
        ids: ["child"],
        destination: document(),
        mode: "paste",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    const expected = toWorld(transform(10, 0), parentWorld(turned, "root"));
    expect(copies[0]?.transform.position.x).toBeCloseTo(expected.position.x, 9);
    expect(copies[0]?.transform.position.y).toBeCloseTo(expected.position.y, 9);
    expect(copies[0]?.transform.rotation).toBeCloseTo(expected.rotation, 9);
    expect(copies[0]?.transform.scale).toEqual(expected.scale);
  });

  it("copies each placement once when an ancestor and a descendant are both named", () => {
    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["root", "child"],
        destination: NESTED,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    // Two, not three: the child travels with the root and is not copied again.
    expect(copies).toHaveLength(2);
    expect(copies[1]?.parent).toBe("copy-1");
  });

  it("renames a developer key the destination already holds", () => {
    const keyed = document(placement("one", { key: "player" }));

    const copies = clones(
      clonePlacements({
        source: keyed,
        ids: ["one"],
        destination: keyed,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    // The key becomes the entity's scene key, and two entities cannot hold
    // one, so a copy that kept it would make the level refuse to load.
    expect(copies[0]?.key).toBe("player-2");
  });

  it("steps a key clear of an id as well as of another key", () => {
    // A placement's scene key is its `key`, or its `id` when it has none, so
    // the two share one space. A copy that took `wall-2` as a key when another
    // placement already carries it as an id makes the level refuse to load.
    const mixed = document(
      placement("wall-2"),
      placement("b", { key: "wall" }),
    );

    const copies = clones(
      clonePlacements({
        source: mixed,
        ids: ["b"],
        destination: mixed,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.key).toBe("wall-3");
    // Asserted against the format rather than against a restatement of its
    // rule: `readLevel` is what refuses a document, so it is what says the
    // copy is safe to write.
    expect(
      readLevel({ ...mixed, entities: [...mixed.entities, ...copies] }).ok,
    ).toBe(true);
  });

  it("counts on from a key that already ends in a number", () => {
    const keyed = document(
      placement("one", { key: "prop" }),
      placement("two", { key: "prop-2" }),
    );

    const copies = clones(
      clonePlacements({
        source: keyed,
        ids: ["one", "two"],
        destination: keyed,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    // Not `prop-3` and `prop-2-2`: a key ending in a number counts on from it.
    expect(copies.map((copy) => copy.key)).toEqual(["prop-3", "prop-4"]);
  });

  it("leaves a placement with no key without one", () => {
    const copies = clones(
      clonePlacements({
        source: NESTED,
        ids: ["stranger"],
        destination: NESTED,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(Object.hasOwn(copies[0] ?? {}, "key")).toBe(false);
  });

  it("offsets the copied roots and leaves what hangs off them", () => {
    const inserts = clonePlacements({
      source: NESTED,
      ids: ["root"],
      destination: NESTED,
      mode: "duplicate",
      newId: counter(),
      referenceFields: NO_REFERENCE_FIELDS,
      offset: { x: 24, y: 24 },
    });
    const copies = clones(inserts);

    expect(copies[0]?.transform.position).toEqual({ x: 124, y: 24 });
    // The child is placed relative to the root, which already moved. Offsetting
    // it too would move it twice.
    expect(copies[1]?.transform.position).toEqual({ x: 10, y: 0 });
  });

  it("offsets every root by the same amount, keeping their arrangement", () => {
    const row = document(
      placement("a", { transform: transform(0, 0) }),
      placement("b", { transform: transform(30, 0) }),
      placement("c", { transform: transform(60, 0) }),
    );

    const copies = clones(
      clonePlacements({
        source: row,
        ids: ["a", "b", "c"],
        destination: row,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
        offset: { x: 10, y: 5 },
      }),
    );

    expect(copies.map((copy) => copy.transform.position)).toEqual([
      { x: 10, y: 5 },
      { x: 40, y: 5 },
      { x: 70, y: 5 },
    ]);
  });

  it("takes the offset through the frame of a parent it kept", () => {
    // The parent is turned a quarter turn, so a world offset along x is a
    // local offset along the parent's own y.
    const turned = document(
      placement("root", {
        transform: transform(0, 0, { rotation: Math.PI / 2 }),
      }),
      placement("child", { parent: "root", transform: transform(0, 0) }),
    );

    const copies = clones(
      clonePlacements({
        source: turned,
        ids: ["child"],
        destination: turned,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
        offset: { x: 10, y: 0 },
      }),
    );

    expect(copies[0]?.parent).toBe("root");
    expect(copies[0]?.transform.position.x).toBeCloseTo(0, 9);
    expect(copies[0]?.transform.position.y).toBeCloseTo(-10, 9);
  });

  it("puts the copies after the last of their sources", () => {
    const inserts = clonePlacements({
      source: NESTED,
      ids: ["root"],
      destination: NESTED,
      mode: "duplicate",
      newId: counter(),
      referenceFields: NO_REFERENCE_FIELDS,
    });

    // `root` and `child` are at 0 and 1, so the copies take 2 and 3 and land
    // above `stranger` rather than at the end of the hierarchy.
    expect(inserts.map((insert) => insert.index)).toEqual([2, 3]);
  });

  it("appends when the destination holds none of the sources", () => {
    const elsewhere = document(placement("x"), placement("y"));

    const inserts = clonePlacements({
      source: NESTED,
      ids: ["stranger"],
      destination: elsewhere,
      mode: "paste",
      newId: counter(),
      referenceFields: NO_REFERENCE_FIELDS,
    });

    expect(inserts.map((insert) => insert.index)).toEqual([2]);
  });

  it("copies params and extensions rather than sharing them", () => {
    const held = document(
      placement("one", {
        params: { sprite: "crate.png", nested: { deep: 1 } },
        extensions: { "studio.nav": { walkable: true } },
      }),
    );

    const copies = clones(
      clonePlacements({
        source: held,
        ids: ["one"],
        destination: held,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.params).toEqual(held.entities[0]?.params);
    expect(copies[0]?.params).not.toBe(held.entities[0]?.params);
    // Deeply, not just at the top: a shared nested object would let an edit to
    // the copy reach the original.
    expect(copies[0]?.params["nested"]).not.toBe(
      held.entities[0]?.params["nested"],
    );
    expect(copies[0]?.extensions).toEqual(held.entities[0]?.extensions);
  });

  it("copies nothing for an empty selection", () => {
    expect(
      clonePlacements({
        source: NESTED,
        ids: [],
        destination: NESTED,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    ).toEqual([]);
  });

  it("copies nothing for an id the source does not hold", () => {
    expect(
      clonePlacements({
        source: NESTED,
        ids: ["ghost"],
        destination: NESTED,
        mode: "duplicate",
        newId: counter(),
        referenceFields: NO_REFERENCE_FIELDS,
      }),
    ).toEqual([]);
  });
});

describe("clonePlacements and entity references", () => {
  /** Both types declare one reference parameter named `door`. */
  const REFERENCE_FIELDS = (): readonly string[] => ["door"];

  function referrer(
    id: string,
    door: string | null,
    extra: Partial<LevelPlacement> = {},
  ): LevelPlacement {
    return placement(id, { type: "game.switch", params: { door }, ...extra });
  }

  it("rewrites a reference inside the copied set to the copy", () => {
    const source = document(
      referrer("a", "b"),
      referrer("b", "a"),
      placement("outside"),
    );

    const copies = clones(
      clonePlacements({
        source,
        ids: ["a", "b"],
        destination: source,
        mode: "duplicate",
        newId: counter(),
        referenceFields: REFERENCE_FIELDS,
      }),
    );

    expect(copies.map((copy) => copy.id)).toEqual(["copy-1", "copy-2"]);
    expect(copies[0]?.params.door).toBe("copy-2");
    expect(copies[1]?.params.door).toBe("copy-1");
  });

  it("keeps the id of a target that was not copied", () => {
    const source = document(referrer("a", "target"), placement("target"));

    const copies = clones(
      clonePlacements({
        source,
        ids: ["a"],
        destination: source,
        mode: "duplicate",
        newId: counter(),
        referenceFields: REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.params.door).toBe("target");
  });

  it("keeps the id when pasting into a document that does not hold it", () => {
    // The paste lands as a missing target the picker fixes in one click.
    // Guessing a replacement is the thing the editor must not do.
    const source = document(referrer("a", "target"), placement("target"));
    const elsewhere = document(placement("unrelated"));

    const copies = clones(
      clonePlacements({
        source,
        ids: ["a"],
        destination: elsewhere,
        mode: "paste",
        newId: counter(),
        referenceFields: REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.params.door).toBe("target");
  });

  it("leaves an unchosen reference unchosen", () => {
    const source = document(referrer("a", null));

    const copies = clones(
      clonePlacements({
        source,
        ids: ["a"],
        destination: source,
        mode: "duplicate",
        newId: counter(),
        referenceFields: REFERENCE_FIELDS,
      }),
    );

    expect(copies[0]?.params.door).toBeNull();
  });

  it("leaves the source's own parameters alone", () => {
    const source = document(referrer("a", "b"), referrer("b", "a"));

    clonePlacements({
      source,
      ids: ["a", "b"],
      destination: source,
      mode: "duplicate",
      newId: counter(),
      referenceFields: REFERENCE_FIELDS,
    });

    expect(source.entities[0]?.params.door).toBe("b");
  });
});
