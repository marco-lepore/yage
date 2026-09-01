import { describe, expect, it } from "vitest";
import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { reduceCommand } from "./reduce.js";
import { CommandPreconditionError } from "./types.js";
import type { DocumentCommand } from "./types.js";
import { isDocumentCommand } from "./validate.js";

function transform(x: number, y: number): LevelTransform {
  return { position: { x, y }, rotation: 0, scale: { x: 1, y: 1 } };
}

function placement(id: string, parent?: string): LevelPlacement {
  return {
    id,
    type: "Crate",
    typeVersion: 1,
    active: true,
    transform: transform(0, 0),
    params: {},
    extensions: {},
    ...(parent === undefined ? {} : { parent }),
  };
}

function levelOf(...entities: readonly LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    extensions: {},
    entities,
  };
}

/** Apply a command, then apply its own inverse to the result. */
function roundTrip(
  before: LevelDocument,
  command: DocumentCommand,
): LevelDocument {
  const applied = reduceCommand(before, command);
  return reduceCommand(applied.document, applied.inverse).document;
}

function idsOf(level: LevelDocument): readonly string[] {
  return level.entities.map((entity) => entity.id);
}

function document(): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    extensions: {},
    entities: [
      {
        id: "crate-1",
        type: "Crate",
        typeVersion: 1,
        active: true,
        transform: transform(0, 0),
        params: {},
        extensions: {},
      },
      {
        id: "crate-2",
        type: "Crate",
        typeVersion: 1,
        active: true,
        transform: transform(10, 10),
        params: {},
        extensions: {},
      },
    ],
  };
}

describe("reduceCommand", () => {
  it("returns a new document with the addressed poses replaced", () => {
    const before = document();

    const result = reduceCommand(before, {
      kind: "set-poses",
      commandId: "c1",
      poses: [{ id: "crate-2", transform: transform(42, -8) }],
    });

    expect(result.document.entities[1]?.transform.position).toEqual({
      x: 42,
      y: -8,
    });
    expect(result.affected).toEqual(["crate-2"]);
    expect(result.impact).toBe("pose");
    // The input is the server's held draft; a reducer that wrote through it
    // would change a revision that was already accepted.
    expect(before.entities[1]?.transform.position).toEqual({ x: 10, y: 10 });
  });

  it("leaves untouched placements identical", () => {
    const before = document();

    const after = reduceCommand(before, {
      kind: "set-poses",
      commandId: "c1",
      poses: [{ id: "crate-2", transform: transform(1, 1) }],
    }).document;

    expect(after.entities[0]).toBe(before.entities[0]);
    expect(after.entities[1]).not.toBe(before.entities[1]);
  });

  it("moves several placements in one command", () => {
    const result = reduceCommand(document(), {
      kind: "set-poses",
      commandId: "c1",
      poses: [
        { id: "crate-1", transform: transform(1, 2) },
        { id: "crate-2", transform: transform(3, 4) },
      ],
    });

    expect(
      result.document.entities.map((entity) => entity.transform.position),
    ).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(result.affected).toEqual(["crate-1", "crate-2"]);
  });

  it("rejects a placement the document does not have", () => {
    expect(() =>
      reduceCommand(document(), {
        kind: "set-poses",
        commandId: "c1",
        poses: [{ id: "ghost", transform: transform(0, 0) }],
      }),
    ).toThrow(CommandPreconditionError);
  });

  it("rejects one placement addressed twice, rather than letting one win", () => {
    expect(() =>
      reduceCommand(document(), {
        kind: "set-poses",
        commandId: "c1",
        poses: [
          { id: "crate-1", transform: transform(1, 1) },
          { id: "crate-1", transform: transform(2, 2) },
        ],
      }),
    ).toThrow(/twice/);
  });

  it("changes nothing when a precondition fails", () => {
    const before = document();

    expect(() =>
      reduceCommand(before, {
        kind: "set-poses",
        commandId: "c1",
        poses: [
          { id: "crate-1", transform: transform(9, 9) },
          { id: "ghost", transform: transform(0, 0) },
        ],
      }),
    ).toThrow(CommandPreconditionError);
    expect(before.entities[0]?.transform.position).toEqual({ x: 0, y: 0 });
  });

  it("inverts a move with the transforms from before it", () => {
    const before = document();

    const result = reduceCommand(before, {
      kind: "set-poses",
      commandId: "c1",
      poses: [{ id: "crate-2", transform: transform(42, -8) }],
    });

    expect(result.inverse).toEqual({
      kind: "set-poses",
      commandId: "c1",
      poses: [{ id: "crate-2", transform: transform(10, 10) }],
    });
    expect(
      roundTrip(before, {
        kind: "set-poses",
        commandId: "c1",
        poses: [{ id: "crate-2", transform: transform(42, -8) }],
      }),
    ).toEqual(before);
  });
});

describe("reduceCommand — add-placements", () => {
  it("inserts at the index the command names", () => {
    const before = levelOf(placement("a"), placement("b"));

    const result = reduceCommand(before, {
      kind: "add-placements",
      commandId: "c1",
      inserts: [{ placement: placement("new"), index: 1 }],
    });

    expect(idsOf(result.document)).toEqual(["a", "new", "b"]);
    expect(result.affected).toEqual(["new"]);
    expect(result.impact).toBe("rebuild");
    expect(idsOf(before)).toEqual(["a", "b"]);
  });

  it("reads each index as a position in the document it produces", () => {
    const result = reduceCommand(levelOf(placement("a"), placement("b")), {
      kind: "add-placements",
      commandId: "c1",
      inserts: [
        { placement: placement("y"), index: 3 },
        { placement: placement("x"), index: 1 },
      ],
    });

    expect(idsOf(result.document)).toEqual(["a", "x", "b", "y"]);
  });

  it("produces the same document whatever order the inserts arrive in", () => {
    const before = levelOf(placement("a"), placement("b"));
    const inserts = [
      { placement: placement("x"), index: 1 },
      { placement: placement("y"), index: 3 },
    ];

    const forward = reduceCommand(before, {
      kind: "add-placements",
      commandId: "c1",
      inserts,
    });
    const reversed = reduceCommand(before, {
      kind: "add-placements",
      commandId: "c1",
      inserts: [...inserts].reverse(),
    });

    expect(forward.document).toEqual(reversed.document);
  });

  it("inverts to a removal of exactly what it added", () => {
    const before = levelOf(placement("a"));
    const command: DocumentCommand = {
      kind: "add-placements",
      commandId: "c1",
      inserts: [{ placement: placement("new"), index: 0 }],
    };

    expect(reduceCommand(before, command).inverse).toEqual({
      kind: "remove-placements",
      commandId: "c1",
      ids: ["new"],
    });
    expect(roundTrip(before, command)).toEqual(before);
  });

  it("accepts a placement parented to one added by the same command", () => {
    const result = reduceCommand(levelOf(), {
      kind: "add-placements",
      commandId: "c1",
      inserts: [
        { placement: placement("parent"), index: 0 },
        { placement: placement("child", "parent"), index: 1 },
      ],
    });

    expect(idsOf(result.document)).toEqual(["parent", "child"]);
  });

  it.each([
    [
      "an id the document already holds",
      [{ placement: placement("a"), index: 0 }],
      /already in level/,
    ],
    [
      "one id added twice",
      [
        { placement: placement("new"), index: 0 },
        { placement: placement("new"), index: 1 },
      ],
      /added twice/,
    ],
    [
      "two placements at one index",
      [
        { placement: placement("x"), index: 1 },
        { placement: placement("y"), index: 1 },
      ],
      /at index 1/,
    ],
    [
      "an index past the end of the result",
      [{ placement: placement("x"), index: 3 }],
      /outside 0 to 2/,
    ],
    [
      "a negative index",
      [{ placement: placement("x"), index: -1 }],
      /outside 0 to 2/,
    ],
    [
      "a parent that is nowhere",
      [{ placement: placement("x", "ghost"), index: 0 }],
      /parent "ghost" that is not there/,
    ],
    [
      "two placements that parent each other",
      [
        { placement: placement("x", "y"), index: 0 },
        { placement: placement("y", "x"), index: 1 },
      ],
      /its own ancestor/,
    ],
  ])("rejects %s", (_name, inserts, message) => {
    const before = levelOf(placement("a"), placement("b"));

    expect(() =>
      reduceCommand(before, {
        kind: "add-placements",
        commandId: "c1",
        inserts,
      }),
    ).toThrow(message);
    expect(idsOf(before)).toEqual(["a", "b"]);
  });
});

describe("reduceCommand — remove-placements", () => {
  it("removes the placements it names", () => {
    const before = levelOf(placement("a"), placement("b"), placement("c"));

    const result = reduceCommand(before, {
      kind: "remove-placements",
      commandId: "c1",
      ids: ["b"],
    });

    expect(idsOf(result.document)).toEqual(["a", "c"]);
    expect(result.affected).toEqual(["b"]);
    expect(result.impact).toBe("rebuild");
    expect(idsOf(before)).toEqual(["a", "b", "c"]);
  });

  it("inverts to the placements at the indices they were taken from", () => {
    const before = levelOf(
      placement("a"),
      placement("b"),
      placement("c"),
      placement("d"),
      placement("e"),
    );
    const command: DocumentCommand = {
      kind: "remove-placements",
      commandId: "c1",
      ids: ["d", "b"],
    };

    expect(reduceCommand(before, command).inverse).toEqual({
      kind: "add-placements",
      commandId: "c1",
      inserts: [
        { placement: placement("b"), index: 1 },
        { placement: placement("d"), index: 3 },
      ],
    });
    // Order is authored order, so restoring to the end would be a different
    // document even though it holds the same placements.
    expect(roundTrip(before, command)).toEqual(before);
  });

  it("restores a whole subtree in order", () => {
    const before = levelOf(
      placement("root"),
      placement("child", "root"),
      placement("other"),
      placement("grandchild", "child"),
    );

    expect(
      roundTrip(before, {
        kind: "remove-placements",
        commandId: "c1",
        ids: ["root", "child", "grandchild"],
      }),
    ).toEqual(before);
  });

  it("restores a subtree whose children precede their parent", () => {
    // Authored order is free: a placement may be listed before its parent, and
    // the restore has to put both back where they were rather than in tree
    // order.
    const before = levelOf(
      placement("child", "root"),
      placement("other"),
      placement("root"),
    );

    expect(
      roundTrip(before, {
        kind: "remove-placements",
        commandId: "c1",
        ids: ["root", "child"],
      }),
    ).toEqual(before);
  });

  it("refuses a removal that would leave a placement without its parent", () => {
    const before = levelOf(placement("root"), placement("child", "root"));

    expect(() =>
      reduceCommand(before, {
        kind: "remove-placements",
        commandId: "c1",
        ids: ["root"],
      }),
    ).toThrow(/would leave "child" without its parent/);
  });

  it.each([
    ["a placement the document does not have", ["ghost"], /No placement/],
    ["one id removed twice", ["a", "a"], /removed twice/],
  ])("rejects %s", (_name, ids, message) => {
    const before = levelOf(placement("a"), placement("b"));

    expect(() =>
      reduceCommand(before, {
        kind: "remove-placements",
        commandId: "c1",
        ids,
      }),
    ).toThrow(message);
    expect(idsOf(before)).toEqual(["a", "b"]);
  });
});

describe("isDocumentCommand", () => {
  const valid = {
    kind: "set-poses",
    commandId: "c1",
    poses: [{ id: "crate-1", transform: transform(1, 2) }],
  };

  it("accepts a well-formed command", () => {
    expect(isDocumentCommand(valid)).toBe(true);
  });

  it("accepts an empty pose list", () => {
    expect(isDocumentCommand({ ...valid, poses: [] })).toBe(true);
  });

  it.each([
    ["a missing kind", { commandId: "c1", poses: [] }],
    ["an unknown kind", { ...valid, kind: "set-name" }],
    ["a missing command id", { kind: "set-poses", poses: [] }],
    ["an empty command id", { ...valid, commandId: "" }],
    ["poses that are not an array", { ...valid, poses: {} }],
    [
      "a pose with no id",
      { ...valid, poses: [{ transform: transform(0, 0) }] },
    ],
    [
      "a coordinate that parsed as infinity",
      {
        ...valid,
        poses: [
          {
            id: "crate-1",
            transform: {
              // What `JSON.parse` gives for an exponent JSON allows and a
              // double cannot hold, which is how one reaches the wire.
              position: JSON.parse('{"x":1e999,"y":0}') as unknown,
              rotation: 0,
              scale: { x: 1, y: 1 },
            },
          },
        ],
      },
    ],
    [
      "a coordinate that is a string",
      {
        ...valid,
        poses: [
          {
            id: "crate-1",
            transform: {
              position: { x: "1", y: 0 },
              rotation: 0,
              scale: { x: 1, y: 1 },
            },
          },
        ],
      },
    ],
    ["an extra field on the command", { ...valid, label: "drag" }],
    [
      "an extra field inside a transform",
      {
        ...valid,
        poses: [
          {
            id: "crate-1",
            transform: { ...transform(0, 0), skew: { x: 0, y: 0 } },
          },
        ],
      },
    ],
    ["a null command", null],
    ["an array", [valid]],
  ])("refuses %s", (_name, value) => {
    expect(isDocumentCommand(value)).toBe(false);
  });

  it("accepts the two authoring kinds", () => {
    expect(
      isDocumentCommand({
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: placement("x"), index: 0 }],
      }),
    ).toBe(true);
    expect(
      isDocumentCommand({
        kind: "remove-placements",
        commandId: "c1",
        ids: ["x"],
      }),
    ).toBe(true);
  });

  it.each([
    [
      "an insert list that is not an array",
      { kind: "add-placements", commandId: "c1", inserts: {} },
    ],
    [
      "an insert with no index",
      {
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: placement("x") }],
      },
    ],
    [
      "a fractional index",
      {
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: placement("x"), index: 1.5 }],
      },
    ],
    [
      "a negative index",
      {
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: placement("x"), index: -1 }],
      },
    ],
    [
      "a placement with no id",
      {
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: { type: "Crate" }, index: 0 }],
      },
    ],
    [
      "a parent that is not a string",
      {
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: { ...placement("x"), parent: 7 }, index: 0 }],
      },
    ],
    [
      "an extra field beside an insert",
      {
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: placement("x"), index: 0, label: "crate" }],
      },
    ],
    [
      "ids that are not an array",
      { kind: "remove-placements", commandId: "c1", ids: "x" },
    ],
    [
      "an id that is not a string",
      { kind: "remove-placements", commandId: "c1", ids: [7] },
    ],
    [
      "an extra field on a removal",
      { kind: "remove-placements", commandId: "c1", ids: [], reason: "delete" },
    ],
  ])("refuses %s", (_name, value) => {
    expect(isDocumentCommand(value)).toBe(false);
  });

  it("accepts a placement whose other fields the document layer rejects", () => {
    // The wire check reads `id` and `parent`, which is what the reducer reads.
    // A missing `type` is the level format's rule, and the queue applies it to
    // the document the command produces.
    expect(
      isDocumentCommand({
        kind: "add-placements",
        commandId: "c1",
        inserts: [{ placement: { id: "x" }, index: 0 }],
      }),
    ).toBe(true);
  });

  it("accepts a zero scale, which the document layer is what rejects", () => {
    const zeroScale = {
      ...valid,
      poses: [
        {
          id: "crate-1",
          transform: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 0, y: 1 },
          },
        },
      ],
    };

    expect(isDocumentCommand(zeroScale)).toBe(true);
  });
});
