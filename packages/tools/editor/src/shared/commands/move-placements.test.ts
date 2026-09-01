import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import { reduceCommand } from "./reduce.js";
import type { DocumentCommand } from "./types.js";
import { isDocumentCommand } from "./validate.js";

function transform(x: number): LevelTransform {
  return {
    position: { x, y: x + 1 },
    rotation: x / 10,
    scale: { x: 1 + x / 100, y: 1 - x / 100 },
  };
}

function placement(id: string, x: number, parent?: string): LevelPlacement {
  return {
    id,
    type: "Crate",
    typeVersion: 1,
    active: true,
    transform: transform(x),
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
    entities,
    extensions: {},
  };
}

function move(
  id: string,
  from: {
    readonly parent?: string;
    readonly transform: LevelTransform;
    readonly index: number;
  },
  to: {
    readonly parent?: string;
    readonly transform: LevelTransform;
    readonly index: number;
  },
): DocumentCommand {
  return {
    kind: "move-placements",
    commandId: "c1",
    moves: [{ id, from, to }],
  } as unknown as DocumentCommand;
}

/** A command carrying several moves at once. */
function moves(
  ...entries: readonly {
    id: string;
    from: { parent?: string; transform: LevelTransform; index: number };
    to: { parent?: string; transform: LevelTransform; index: number };
  }[]
): DocumentCommand {
  return {
    kind: "move-placements",
    commandId: "c1",
    moves: entries,
  } as unknown as DocumentCommand;
}

function idsOf(document: LevelDocument): readonly string[] {
  return document.entities.map((entity) => entity.id);
}

describe("reduceCommand — move-placements", () => {
  it("reparents and reorders one placement using the supplied local pose", () => {
    const before = levelOf(
      placement("root", 0),
      placement("child", 1, "root"),
      placement("other", 2),
    );

    const result = reduceCommand(
      before,
      move(
        "child",
        { parent: "root", transform: transform(1), index: 1 },
        { parent: "other", transform: transform(20), index: 2 },
      ),
    );

    expect(idsOf(result.document)).toEqual(["root", "other", "child"]);
    expect(result.document.entities[2]).toMatchObject({
      id: "child",
      parent: "other",
      transform: transform(20),
    });
    expect(result.affected).toEqual(["child"]);
    expect(result.impact).toBe("rebuild");
    expect(idsOf(before)).toEqual(["root", "child", "other"]);
  });

  it("removes the parent property when moving to the top level", () => {
    const before = levelOf(placement("root", 0), placement("child", 1, "root"));

    const result = reduceCommand(
      before,
      move(
        "child",
        { parent: "root", transform: transform(1), index: 1 },
        { transform: transform(10), index: 0 },
      ),
    );

    expect(result.document.entities[0]?.id).toBe("child");
    expect(Object.hasOwn(result.document.entities[0] ?? {}, "parent")).toBe(
      false,
    );
  });

  it("moves only the named placement and preserves descendant order", () => {
    const before = levelOf(
      placement("root", 0),
      placement("child", 1, "root"),
      placement("grandchild", 2, "child"),
      placement("other", 3),
    );

    const result = reduceCommand(
      before,
      move(
        "root",
        { transform: transform(0), index: 0 },
        { transform: transform(30), index: 3 },
      ),
    );

    expect(idsOf(result.document)).toEqual([
      "child",
      "grandchild",
      "other",
      "root",
    ]);
    expect(result.document.entities[0]).toBe(before.entities[1]);
    expect(result.document.entities[1]).toBe(before.entities[2]);
  });

  it("inverts to the exact source and destination states", () => {
    const before = levelOf(
      placement("root", 0),
      placement("child", 1, "root"),
      placement("other", 2),
    );
    const from = { parent: "root", transform: transform(1), index: 1 };
    const to = { parent: "other", transform: transform(20), index: 2 };
    const command = move("child", from, to);

    const applied = reduceCommand(before, command);

    expect(applied.inverse).toEqual({
      kind: "move-placements",
      commandId: "c1",
      moves: [{ id: "child", from: to, to: from }],
    });
    expect(reduceCommand(applied.document, applied.inverse).document).toEqual(
      before,
    );
  });

  it.each([
    [
      "an unknown placement",
      "ghost",
      { transform: transform(0), index: 0 },
      { transform: transform(10), index: 1 },
      /No placement/,
    ],
    [
      "a stale source index",
      "root",
      { transform: transform(0), index: 1 },
      { transform: transform(10), index: 1 },
      /source index/i,
    ],
    [
      "a stale source parent",
      "child",
      { transform: transform(1), index: 1 },
      { transform: transform(10), index: 1 },
      /source parent/i,
    ],
    [
      "a stale source transform",
      "root",
      { transform: transform(99), index: 0 },
      { transform: transform(10), index: 1 },
      /source transform/i,
    ],
    [
      "a negative destination index",
      "root",
      { transform: transform(0), index: 0 },
      { transform: transform(10), index: -1 },
      /destination index/i,
    ],
    [
      "a fractional destination index",
      "root",
      { transform: transform(0), index: 0 },
      { transform: transform(10), index: 0.5 },
      /destination index/i,
    ],
    [
      "a destination past the result",
      "root",
      { transform: transform(0), index: 0 },
      { transform: transform(10), index: 3 },
      /destination index/i,
    ],
    [
      "an unknown destination parent",
      "root",
      { transform: transform(0), index: 0 },
      { parent: "ghost", transform: transform(10), index: 1 },
      /destination parent/i,
    ],
    [
      "itself as destination parent",
      "root",
      { transform: transform(0), index: 0 },
      { parent: "root", transform: transform(10), index: 1 },
      /own parent/i,
    ],
    [
      "a descendant as destination parent",
      "root",
      { transform: transform(0), index: 0 },
      { parent: "child", transform: transform(10), index: 1 },
      /descendant/i,
    ],
  ])("rejects %s without changing the input", (_name, id, from, to, error) => {
    const before = levelOf(
      placement("root", 0),
      placement("child", 1, "root"),
      placement("other", 2),
    );
    const snapshot = structuredClone(before);

    expect(() => reduceCommand(before, move(id, from, to))).toThrow(error);
    expect(before).toEqual(snapshot);
  });
});

describe("isDocumentCommand — move-placements", () => {
  const entry = {
    id: "child",
    from: { parent: "root", transform: transform(1), index: 1 },
    to: { transform: transform(10), index: 0 },
  };
  const valid = { kind: "move-placements", commandId: "c1", moves: [entry] };

  it("accepts a well-formed command", () => {
    expect(isDocumentCommand(valid)).toBe(true);
  });

  it("accepts several moves in one command", () => {
    expect(
      isDocumentCommand({
        ...valid,
        moves: [entry, { ...entry, id: "other" }],
      }),
    ).toBe(true);
  });

  it("accepts a command that moves nothing", () => {
    expect(isDocumentCommand({ ...valid, moves: [] })).toBe(true);
  });

  it("rejects the singular shape this replaced", () => {
    // The wire is a trust boundary, and a browser sending the old shape is
    // telling the server something it no longer means.
    expect(
      isDocumentCommand({
        kind: "move-placement",
        commandId: "c1",
        ...entry,
      }),
    ).toBe(false);
  });

  it.each([
    ["moves that are not an array", { ...valid, moves: entry }],
    ["a missing id", { ...valid, moves: [{ ...entry, id: undefined }] }],
    ["a missing source", { ...valid, moves: [{ ...entry, from: undefined }] }],
    [
      "a negative index",
      { ...valid, moves: [{ ...entry, to: { ...entry.to, index: -1 } }] },
    ],
    [
      "a fractional index",
      { ...valid, moves: [{ ...entry, to: { ...entry.to, index: 0.5 } }] },
    ],
    [
      "a non-string parent",
      { ...valid, moves: [{ ...entry, from: { ...entry.from, parent: 7 } }] },
    ],
    [
      "a malformed transform",
      {
        ...valid,
        moves: [{ ...entry, to: { ...entry.to, transform: { position: {} } } }],
      },
    ],
    [
      "an extra state field",
      {
        ...valid,
        moves: [{ ...entry, to: { ...entry.to, sibling: "other" } }],
      },
    ],
    ["an extra move field", { ...valid, moves: [{ ...entry, keep: true }] }],
    ["an extra command field", { ...valid, preserveWorld: true }],
  ])("rejects %s", (_name, value) => {
    expect(isDocumentCommand(value)).toBe(false);
  });
});

describe("reduceCommand — several placements at once", () => {
  it("moves each one to the index it names, in the produced document", () => {
    const before = levelOf(
      placement("a", 0),
      placement("b", 1),
      placement("c", 2),
      placement("d", 3),
    );

    const result = reduceCommand(
      before,
      moves(
        {
          id: "a",
          from: { transform: transform(0), index: 0 },
          to: { transform: transform(0), index: 2 },
        },
        {
          id: "b",
          from: { transform: transform(1), index: 1 },
          to: { transform: transform(1), index: 3 },
        },
      ),
    );

    // Both come out first, leaving [c, d], and then go back at 2 and 3.
    expect(idsOf(result.document)).toEqual(["c", "d", "a", "b"]);
  });

  it("inverts a move of several exactly", () => {
    const before = levelOf(
      placement("a", 0),
      placement("b", 1),
      placement("c", 2),
    );
    const command = moves(
      {
        id: "a",
        from: { transform: transform(0), index: 0 },
        to: { parent: "c", transform: transform(9), index: 1 },
      },
      {
        id: "b",
        from: { transform: transform(1), index: 1 },
        to: { parent: "c", transform: transform(8), index: 2 },
      },
    );

    const applied = reduceCommand(before, command);

    expect(reduceCommand(applied.document, applied.inverse).document).toEqual(
      before,
    );
  });

  it("reports every moved placement as affected", () => {
    const before = levelOf(placement("a", 0), placement("b", 1));

    const result = reduceCommand(
      before,
      moves(
        {
          id: "a",
          from: { transform: transform(0), index: 0 },
          to: { transform: transform(0), index: 1 },
        },
        {
          id: "b",
          from: { transform: transform(1), index: 1 },
          to: { transform: transform(1), index: 0 },
        },
      ),
    );

    expect([...result.affected].sort()).toEqual(["a", "b"]);
  });

  it("rejects two placements moved to one index", () => {
    const before = levelOf(placement("a", 0), placement("b", 1));

    // Both would go to 0, so the second pushes the first to 1 and neither ends
    // up where the command says — which would make the inverse address the
    // wrong rows.
    expect(() =>
      reduceCommand(
        before,
        moves(
          {
            id: "a",
            from: { transform: transform(0), index: 0 },
            to: { transform: transform(0), index: 0 },
          },
          {
            id: "b",
            from: { transform: transform(1), index: 1 },
            to: { transform: transform(1), index: 0 },
          },
        ),
      ),
    ).toThrow(/moved to index 0/);
  });

  it("rejects the same placement moved twice", () => {
    const before = levelOf(placement("a", 0), placement("b", 1));

    expect(() =>
      reduceCommand(
        before,
        moves(
          {
            id: "a",
            from: { transform: transform(0), index: 0 },
            to: { transform: transform(0), index: 0 },
          },
          {
            id: "a",
            from: { transform: transform(0), index: 0 },
            to: { transform: transform(0), index: 1 },
          },
        ),
      ),
    ).toThrow(/moved twice/);
  });

  it("rejects two placements moved inside each other", () => {
    const before = levelOf(placement("a", 0), placement("b", 1));

    // Each passes the per-move check, which reads the document as it was and
    // sees no ancestry between them. Only the result has the ring.
    expect(() =>
      reduceCommand(
        before,
        moves(
          {
            id: "a",
            from: { transform: transform(0), index: 0 },
            to: { parent: "b", transform: transform(0), index: 0 },
          },
          {
            id: "b",
            from: { transform: transform(1), index: 1 },
            to: { parent: "a", transform: transform(1), index: 1 },
          },
        ),
      ),
    ).toThrow(/inside itself/);
  });

  it("leaves the input alone when it refuses", () => {
    const before = levelOf(placement("a", 0), placement("b", 1));
    const snapshot = structuredClone(before);

    expect(() =>
      reduceCommand(
        before,
        moves(
          {
            id: "a",
            from: { transform: transform(0), index: 0 },
            to: { parent: "b", transform: transform(0), index: 0 },
          },
          {
            id: "b",
            from: { transform: transform(1), index: 1 },
            to: { parent: "a", transform: transform(1), index: 1 },
          },
        ),
      ),
    ).toThrow();
    expect(before).toEqual(snapshot);
  });
});
