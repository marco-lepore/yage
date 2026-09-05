import type {
  JsonObject,
  JsonValue,
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import { reduceCommand } from "./reduce.js";
import { CommandPreconditionError } from "./types.js";
import type { DocumentCommand } from "./types.js";
import { isDocumentCommand } from "./validate.js";

function transform(x = 0): LevelTransform {
  return {
    position: { x, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  };
}

function placement(
  id: string,
  params: JsonObject,
  typeVersion = 1,
): LevelPlacement {
  return {
    id,
    type: "Crate",
    typeVersion,
    active: true,
    transform: transform(),
    params,
    extensions: {},
  };
}

function levelOf(...entities: readonly LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities,
    extensions: {},
  };
}

function setValues(
  edits: readonly {
    readonly placementId: string;
    readonly path: readonly string[];
    readonly expected: JsonValue;
    readonly value: JsonValue;
  }[],
): DocumentCommand {
  return {
    kind: "set-values",
    commandId: "c1",
    edits,
  } as unknown as DocumentCommand;
}

describe("reduceCommand — set-values", () => {
  it("applies several disjoint values atomically", () => {
    const before = levelOf(
      placement("a", { asset: "old.png", nested: { count: 1 } }, 1),
    );

    const result = reduceCommand(
      before,
      setValues([
        {
          placementId: "a",
          path: ["params", "asset"],
          expected: "old.png",
          value: "new.png",
        },
        {
          placementId: "a",
          path: ["typeVersion"],
          expected: 1,
          value: 2,
        },
      ]),
    );

    expect(result.document.entities[0]).toMatchObject({
      typeVersion: 2,
      params: { asset: "new.png", nested: { count: 1 } },
    });
    expect(before.entities[0]).toMatchObject({
      typeVersion: 1,
      params: { asset: "old.png", nested: { count: 1 } },
    });
    expect(result.affected).toEqual(["a"]);
    expect(result.impact).toBe("rebuild");
  });

  it("reports each affected placement once in first-edit order", () => {
    const result = reduceCommand(
      levelOf(
        placement("a", { asset: "a.png", label: "A" }),
        placement("b", { asset: "b.png" }),
      ),
      setValues([
        {
          placementId: "b",
          path: ["params", "asset"],
          expected: "b.png",
          value: "b2.png",
        },
        {
          placementId: "a",
          path: ["params", "asset"],
          expected: "a.png",
          value: "a2.png",
        },
        {
          placementId: "a",
          path: ["params", "label"],
          expected: "A",
          value: "A2",
        },
      ]),
    );

    expect(result.affected).toEqual(["b", "a"]);
  });

  it("builds an inverse from the exact prior values", () => {
    const prior = JSON.parse('{"z":1,"a":[2,{"x":3}]}') as JsonValue;
    const before = levelOf(placement("a", { config: prior }));
    const command = setValues([
      {
        placementId: "a",
        path: ["params", "config"],
        expected: { a: [2, { x: 3 }], z: 1 },
        value: { replacement: true },
      },
    ]);

    const applied = reduceCommand(before, command);

    expect(applied.inverse).toEqual({
      kind: "set-values",
      commandId: "c1",
      edits: [
        {
          placementId: "a",
          path: ["params", "config"],
          expected: { replacement: true },
          value: prior,
        },
      ],
    });
    expect(reduceCommand(applied.document, applied.inverse).document).toEqual(
      before,
    );
  });

  it("compares JSON values structurally, including nested array order", () => {
    const before = levelOf(
      placement("a", { config: { first: 1, second: [2, 3] } }),
    );

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path: ["params", "config"],
            expected: { second: [2, 3], first: 1 },
            value: null,
          },
        ]),
      ),
    ).not.toThrow();

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path: ["params", "config"],
            expected: { first: 1, second: [3, 2] },
            value: null,
          },
        ]),
      ),
    ).toThrow(/expected value/i);
  });

  it("uses own-property reads and writes for every path segment", () => {
    const params = JSON.parse('{"__proto__":"before"}') as JsonObject;
    const before = levelOf(placement("a", params));

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path: ["params", "toString"],
            expected: "inherited",
            value: "written",
          },
        ]),
      ),
    ).toThrow(/missing path/i);

    const result = reduceCommand(
      before,
      setValues([
        {
          placementId: "a",
          path: ["params", "__proto__"],
          expected: "before",
          value: "after",
        },
      ]),
    );
    const nextParams = result.document.entities[0]?.params;

    expect(Object.hasOwn(nextParams ?? {}, "__proto__")).toBe(true);
    expect(nextParams?.["__proto__"]).toBe("after");
    expect(Object.getPrototypeOf(nextParams)).toBe(Object.prototype);
  });

  it("changes nothing when any edit has a stale expected value", () => {
    const before = levelOf(
      placement("a", { asset: "a.png" }),
      placement("b", { asset: "b.png" }),
    );
    const snapshot = structuredClone(before);

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path: ["params", "asset"],
            expected: "a.png",
            value: "changed.png",
          },
          {
            placementId: "b",
            path: ["params", "asset"],
            expected: "stale.png",
            value: "also-changed.png",
          },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
    expect(before).toEqual(snapshot);
  });

  it.each([
    ["an empty path", []],
    ["a missing path", ["params", "missing"]],
  ])("rejects %s", (_name, path) => {
    expect(() =>
      reduceCommand(
        levelOf(placement("a", { asset: "a.png" })),
        setValues([
          {
            placementId: "a",
            path,
            expected: "a.png",
            value: "b.png",
          },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
  });

  it("rejects an unknown placement", () => {
    expect(() =>
      reduceCommand(
        levelOf(placement("a", { asset: "a.png" })),
        setValues([
          {
            placementId: "ghost",
            path: ["params", "asset"],
            expected: "a.png",
            value: "b.png",
          },
        ]),
      ),
    ).toThrow(/No placement/);
  });

  it.each([
    ["placement identity", ["id"]],
    ["a normalized transform", ["transform"]],
    ["a nested type version member", ["typeVersion", "value"]],
  ])("rejects an unsupported path to %s", (_name, path) => {
    const before = levelOf(placement("a", { items: ["first", "second"] }));
    const snapshot = structuredClone(before);

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path,
            expected: path[0] === "id" ? "a" : 2,
            value: 1,
          },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
    expect(before).toEqual(snapshot);
  });

  it.each([
    ["duplicate paths", ["params", "asset"], ["params", "asset"]],
    ["an earlier parent path", ["params"], ["params", "asset"]],
    ["a later parent path", ["params", "asset"], ["params"]],
  ])("rejects %s on one placement", (_name, first, second) => {
    const before = levelOf(placement("a", { asset: "a.png" }));

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path: first,
            expected: first.length === 1 ? { asset: "a.png" } : "a.png",
            value: first.length === 1 ? { asset: "b.png" } : "b.png",
          },
          {
            placementId: "a",
            path: second,
            expected: second.length === 1 ? { asset: "a.png" } : "a.png",
            value: second.length === 1 ? { asset: "b.png" } : "b.png",
          },
        ]),
      ),
    ).toThrow(/duplicate|overlap/i);
  });

  it("allows the same path on different placements", () => {
    expect(() =>
      reduceCommand(
        levelOf(
          placement("a", { asset: "a.png" }),
          placement("b", { asset: "b.png" }),
        ),
        setValues([
          {
            placementId: "a",
            path: ["params", "asset"],
            expected: "a.png",
            value: "a2.png",
          },
          {
            placementId: "b",
            path: ["params", "asset"],
            expected: "b.png",
            value: "b2.png",
          },
        ]),
      ),
    ).not.toThrow();
  });
});

describe("isDocumentCommand — set-values", () => {
  const valid = {
    kind: "set-values",
    commandId: "c1",
    edits: [
      {
        placementId: "a",
        path: ["params", "asset"],
        expected: "a.png",
        value: "b.png",
      },
    ],
  };

  it("accepts a well-formed command", () => {
    expect(isDocumentCommand(valid)).toBe(true);
  });

  it("accepts every value path used by the structured inspector", () => {
    expect(
      isDocumentCommand({
        ...valid,
        edits: [
          {
            placementId: "a",
            path: ["params"],
            expected: { asset: "a.png" },
            value: { asset: "b.png" },
          },
          {
            placementId: "a",
            path: ["params", "asset"],
            expected: "a.png",
            value: "b.png",
          },
          {
            placementId: "a",
            path: ["typeVersion"],
            expected: 1,
            value: 2,
          },
          {
            placementId: "b",
            path: ["name"],
            expected: null,
            value: "Left crate",
          },
          {
            placementId: "c",
            path: ["key"],
            expected: "door",
            value: null,
          },
          {
            placementId: "d",
            path: ["params", "spawns", "0", "count"],
            expected: 1,
            value: 2,
          },
        ],
      }),
    ).toBe(true);
  });

  it.each([
    ["an empty path", { ...valid, edits: [{ ...valid.edits[0], path: [] }] }],
    [
      "a non-string path segment",
      { ...valid, edits: [{ ...valid.edits[0], path: ["params", 1] }] },
    ],
    [
      "a placement identity path",
      { ...valid, edits: [{ ...valid.edits[0], path: ["id"] }] },
    ],
    [
      "a normalized placement field",
      { ...valid, edits: [{ ...valid.edits[0], path: ["transform"] }] },
    ],
    [
      "the parent link, which moves through move-placements",
      { ...valid, edits: [{ ...valid.edits[0], path: ["parent"] }] },
    ],
    [
      "a path into a placement field that is not params",
      {
        ...valid,
        edits: [{ ...valid.edits[0], path: ["extensions", "editor"] }],
      },
    ],
    [
      "a missing expected value",
      {
        ...valid,
        edits: [{ placementId: "a", path: ["params"], value: {} }],
      },
    ],
    [
      "a non-JSON value",
      { ...valid, edits: [{ ...valid.edits[0], value: undefined }] },
    ],
    [
      "a non-finite nested number",
      {
        ...valid,
        edits: [{ ...valid.edits[0], expected: { value: Infinity } }],
      },
    ],
    [
      "an extra edit field",
      { ...valid, edits: [{ ...valid.edits[0], label: "Asset" }] },
    ],
    ["an extra command field", { ...valid, reason: "inspector" }],
  ])("rejects %s", (_name, value) => {
    expect(isDocumentCommand(value)).toBe(false);
  });
});

describe("reduceCommand — a value with a shape", () => {
  /** Two spawns, the shape a wave parameter holds. */
  function wave(): LevelPlacement {
    return placement("a", {
      spawns: [
        { type: "slime", count: 1 },
        { type: "bat", count: 3 },
      ],
    });
  }

  it("writes one member of one element and leaves the rest alone", () => {
    const result = reduceCommand(
      levelOf(wave()),
      setValues([
        {
          placementId: "a",
          path: ["params", "spawns", "1", "count"],
          expected: 3,
          value: 5,
        },
      ]),
    );

    expect(result.document.entities[0]?.params).toEqual({
      spawns: [
        { type: "slime", count: 1 },
        { type: "bat", count: 5 },
      ],
    });
    expect(result.impact).toBe("rebuild");
    expect(result.inverse).toEqual({
      kind: "set-values",
      commandId: "c1",
      edits: [
        {
          placementId: "a",
          path: ["params", "spawns", "1", "count"],
          expected: 5,
          value: 3,
        },
      ],
    });
  });

  it("refuses an element member whose expected value has moved on", () => {
    const before = levelOf(wave());
    const snapshot = structuredClone(before);

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path: ["params", "spawns", "1", "count"],
            expected: 1,
            value: 5,
          },
        ]),
      ),
    ).toThrow(/expected value/i);
    expect(before).toEqual(snapshot);
  });

  it("refuses a position the list does not have", () => {
    expect(() =>
      reduceCommand(
        levelOf(wave()),
        setValues([
          {
            placementId: "a",
            path: ["params", "spawns", "2"],
            expected: null,
            value: { type: "bat", count: 1 },
          },
        ]),
      ),
    ).toThrow(/missing path/i);
  });

  it("reorders as one edit on the list, and inverts by the same shape", () => {
    const before = levelOf(wave());
    const reordered = [
      { type: "bat", count: 3 },
      { type: "slime", count: 1 },
    ];

    const result = reduceCommand(
      before,
      setValues([
        {
          placementId: "a",
          path: ["params", "spawns"],
          expected: before.entities[0]?.params["spawns"] as JsonValue,
          value: reordered,
        },
      ]),
    );

    expect(result.document.entities[0]?.params["spawns"]).toEqual(reordered);
    const inverse = result.inverse as Extract<
      DocumentCommand,
      { kind: "set-values" }
    >;
    expect(inverse.edits).toHaveLength(1);
    expect(inverse.edits[0]?.value).toEqual([
      { type: "slime", count: 1 },
      { type: "bat", count: 3 },
    ]);
  });

  it("shifts later positions when an element is removed", () => {
    const before = levelOf(wave());

    const result = reduceCommand(
      before,
      setValues([
        {
          placementId: "a",
          path: ["params", "spawns"],
          expected: before.entities[0]?.params["spawns"] as JsonValue,
          value: [{ type: "bat", count: 3 }],
        },
      ]),
    );

    // What was at position 1 is now at position 0, so an edit at the old
    // position is an edit to a different spawn.
    expect(result.document.entities[0]?.params["spawns"]).toEqual([
      { type: "bat", count: 3 },
    ]);
    expect(() =>
      reduceCommand(
        result.document,
        setValues([
          {
            placementId: "a",
            path: ["params", "spawns", "1"],
            expected: { type: "bat", count: 3 },
            value: { type: "bat", count: 4 },
          },
        ]),
      ),
    ).toThrow(/missing path/i);
  });

  it("refuses a segment the document does not hold as a value", () => {
    const before = levelOf(placement("a", { spawns: ["slime"] }));

    expect(() =>
      reduceCommand(
        before,
        setValues([
          {
            placementId: "a",
            path: ["params", "spawns", "length"],
            expected: 1,
            value: 0,
          },
        ]),
      ),
    ).toThrow(/missing path/i);
    expect(before.entities[0]?.params["spawns"]).toEqual(["slime"]);
  });
});

describe("reduceCommand — an optional placement field", () => {
  it("names a placement that has no name, and inverts by taking it back", () => {
    const before = levelOf(placement("a", {}));

    const result = reduceCommand(
      before,
      setValues([
        {
          placementId: "a",
          path: ["name"],
          expected: null,
          value: "Crate",
        },
      ]),
    );

    expect(result.document.entities[0]?.name).toBe("Crate");
    expect(result.inverse).toEqual({
      kind: "set-values",
      commandId: "c1",
      edits: [
        {
          placementId: "a",
          path: ["name"],
          expected: "Crate",
          value: null,
        },
      ],
    });
  });

  it("removes the field when the inverse is applied, leaving nothing else", () => {
    const before = levelOf(placement("a", {}));
    const named = reduceCommand(
      before,
      setValues([
        { placementId: "a", path: ["name"], expected: null, value: "Crate" },
      ]),
    );

    const back = reduceCommand(named.document, named.inverse);

    const restored = back.document.entities[0] as LevelPlacement;
    // `toStrictEqual` and not `toEqual`: an own `name` holding `undefined`
    // would pass the looser comparison and would still be written out.
    expect(Object.hasOwn(restored, "name")).toBe(false);
    expect(back.document).toStrictEqual(before);
  });

  it("refuses a precondition the placement no longer matches", () => {
    const named = levelOf({ ...placement("a", {}), name: "Crate" });

    expect(() =>
      reduceCommand(
        named,
        setValues([
          { placementId: "a", path: ["name"], expected: null, value: "Box" },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
    expect(() =>
      reduceCommand(
        levelOf(placement("a", {})),
        setValues([
          { placementId: "a", path: ["name"], expected: "Crate", value: "Box" },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
  });

  it("still refuses a missing path that is not one of the two", () => {
    expect(() =>
      reduceCommand(
        levelOf(placement("a", {})),
        setValues([
          {
            placementId: "a",
            path: ["params", "gone"],
            expected: null,
            value: 1,
          },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
  });

  it("gives and takes back a key the same way", () => {
    const before = levelOf(placement("a", {}));
    const keyed = reduceCommand(
      before,
      setValues([
        { placementId: "a", path: ["key"], expected: null, value: "door" },
      ]),
    );

    expect(keyed.document.entities[0]?.key).toBe("door");

    const back = reduceCommand(keyed.document, keyed.inverse);

    expect(
      Object.hasOwn(back.document.entities[0] as LevelPlacement, "key"),
    ).toBe(false);
    expect(back.document).toStrictEqual(before);
  });

  it("refuses a stale precondition on a key the same way", () => {
    const keyed = levelOf({ ...placement("a", {}), key: "door" });

    expect(() =>
      reduceCommand(
        keyed,
        setValues([
          { placementId: "a", path: ["key"], expected: null, value: "gate" },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
    expect(() =>
      reduceCommand(
        levelOf(placement("a", {})),
        setValues([
          { placementId: "a", path: ["key"], expected: "door", value: "gate" },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
  });

  it("reports document-only for a rename and rebuild for everything else", () => {
    const before = levelOf(
      { ...placement("a", { asset: "a.png" }), name: "Crate" },
      placement("b", {}),
    );

    expect(
      reduceCommand(
        before,
        setValues([
          { placementId: "a", path: ["name"], expected: "Crate", value: "Box" },
          { placementId: "b", path: ["name"], expected: null, value: "Two" },
        ]),
      ).impact,
    ).toBe("document-only");
    expect(
      reduceCommand(
        before,
        setValues([
          { placementId: "a", path: ["name"], expected: "Crate", value: "Box" },
          {
            placementId: "a",
            path: ["params", "asset"],
            expected: "a.png",
            value: "b.png",
          },
        ]),
      ).impact,
    ).toBe("rebuild");
    expect(
      reduceCommand(
        before,
        setValues([
          { placementId: "a", path: ["key"], expected: null, value: "door" },
        ]),
      ).impact,
    ).toBe("rebuild");
  });
});

describe("reduceCommand — the derived scene key", () => {
  const keyed = (id: string, key?: string): LevelPlacement =>
    key === undefined ? placement(id, {}) : { ...placement(id, {}), key };

  it("refuses a key another placement already derives from its id", () => {
    expect(() =>
      reduceCommand(
        levelOf(keyed("a"), keyed("b")),
        setValues([
          { placementId: "b", path: ["key"], expected: null, value: "a" },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
  });

  it("refuses a key another placement already carries", () => {
    expect(() =>
      reduceCommand(
        levelOf(keyed("a", "door"), keyed("b")),
        setValues([
          { placementId: "b", path: ["key"], expected: null, value: "door" },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
  });

  it("accepts a key equal to the placement's own id", () => {
    const result = reduceCommand(
      levelOf(keyed("a"), keyed("b")),
      setValues([
        { placementId: "b", path: ["key"], expected: null, value: "b" },
      ]),
    );

    expect(result.document.entities[1]?.key).toBe("b");
  });

  it("refuses taking a key away when the id underneath it is taken", () => {
    // "a" derives "gate" while it holds that key; clearing it puts "a" back
    // on its own id, which "b" already carries as its key.
    expect(() =>
      reduceCommand(
        levelOf(keyed("a", "gate"), keyed("b", "a")),
        setValues([
          { placementId: "a", path: ["key"], expected: "gate", value: null },
        ]),
      ),
    ).toThrow(CommandPreconditionError);
  });

  it("refuses an added placement whose key collides", () => {
    expect(() =>
      reduceCommand(levelOf(keyed("a")), {
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: keyed("c", "a"), index: 1 }],
      }),
    ).toThrow(CommandPreconditionError);
  });

  it("accepts an added placement whose key is free", () => {
    const result = reduceCommand(levelOf(keyed("a")), {
      kind: "add-placements",
      commandId: "c1",
      inserts: [{ placement: keyed("c", "gate"), index: 1 }],
    });

    expect(result.document.entities.map((one) => one.id)).toEqual(["a", "c"]);
  });
});
