import { describe, expect, it } from "vitest";
import { emptyLevelDocument } from "./empty.js";
import { formatLevel } from "./format.js";
import { readLevel } from "./read.js";
import type { LevelDocument, StructuralError } from "./types.js";

/** The document editor.md's format section publishes, as a file would hold it. */
const EXAMPLE = {
  $schema: "https://yage.dev/schemas/level-1.json",
  format: "yage-level",
  version: 1,
  id: "forest-west",
  metadata: { music: "forest-night" },
  entities: [
    {
      id: "3e9de855-262c-4bb3-ad59-a8e91f17931e",
      type: "game.slime",
      typeVersion: 1,
      name: "Bridge guard",
      key: "bridge-guard",
      active: true,
      transform: {
        position: { x: 320, y: 176 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
      params: { speed: 40, patrolEnd: { x: 128, y: 0 } },
      extensions: {},
    },
  ],
  extensions: {},
};

function readOrThrow(source: unknown): LevelDocument {
  const result = readLevel(source);
  if (!result.ok) {
    throw new Error(
      `expected a valid document, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.document;
}

function errorsOf(source: unknown): readonly StructuralError[] {
  const result = readLevel(source);
  if (result.ok) throw new Error("expected the document to be rejected");
  return result.errors;
}

/** A minimal valid document, as an object literal a test can bend. */
function minimal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: "yage-level",
    version: 1,
    id: "level",
    entities: [],
    ...overrides,
  };
}

function placement(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: "a", type: "game.thing", typeVersion: 1, ...overrides };
}

describe("readLevel", () => {
  it("reads the published example from text and from parsed data", () => {
    const fromText = readOrThrow(JSON.stringify(EXAMPLE));
    const fromData = readOrThrow(EXAMPLE);

    expect(fromText).toEqual(fromData);
    expect(fromText.id).toBe("forest-west");
    expect(fromText.$schema).toBe("https://yage.dev/schemas/level-1.json");
    expect(fromText.metadata).toEqual({ music: "forest-night" });
    expect(fromText.entities).toHaveLength(1);

    const [guard] = fromText.entities;
    expect(guard?.key).toBe("bridge-guard");
    expect(guard?.transform.position).toEqual({ x: 320, y: 176 });
    expect(guard?.params).toEqual({ speed: 40, patrolEnd: { x: 128, y: 0 } });
  });

  it("fills the fields a hand-written document leaves out", () => {
    const document = readOrThrow(minimal({ entities: [placement()] }));

    expect(document.metadata).toEqual({});
    expect(document.extensions).toEqual({});
    expect(document.$schema).toBeUndefined();

    const [only] = document.entities;
    expect(only?.active).toBe(true);
    expect(only?.params).toEqual({});
    expect(only?.extensions).toEqual({});
    expect(only?.transform).toEqual({
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    });
    expect(only?.name).toBeUndefined();
    expect(only?.key).toBeUndefined();
    expect(only?.parent).toBeUndefined();
  });

  it("reports the format and version gate", () => {
    expect(errorsOf(minimal({ format: "tiled" }))).toEqual([
      { path: "format", message: 'must be "yage-level"' },
    ]);
    expect(errorsOf(minimal({ version: 2 }))).toEqual([
      {
        path: "version",
        message: "must be 1; this parser reads version 1 documents",
      },
    ]);
  });

  it("rejects a field the format does not have, at the document and the placement", () => {
    expect(errorsOf(minimal({ music: "forest" }))).toEqual([
      {
        path: "music",
        message:
          "is not a field of this format; put your own data under extensions",
      },
    ]);
    expect(
      errorsOf(minimal({ entities: [placement({ colour: "green" })] })),
    ).toEqual([
      {
        path: "entities[0].colour",
        message:
          "is not a field of this format; put your own data under extensions",
      },
    ]);
  });

  it("collects every problem rather than stopping at the first", () => {
    const errors = errorsOf(
      minimal({
        id: "",
        entities: [placement({ id: 4, type: "" })],
      }),
    );

    expect(errors.map((error) => error.path)).toEqual([
      "id",
      "entities[0].id",
      "entities[0].type",
    ]);
  });

  it("requires typeVersion, which selects the migrations that run", () => {
    expect(
      errorsOf(minimal({ entities: [placement({ typeVersion: undefined })] })),
    ).toEqual([
      {
        path: "entities[0].typeVersion",
        message: "must be an integer of 1 or more",
      },
    ]);
    expect(
      errorsOf(minimal({ entities: [placement({ typeVersion: 1.5 })] })),
    ).toHaveLength(1);
    expect(
      errorsOf(minimal({ entities: [placement({ typeVersion: 0 })] })),
    ).toHaveLength(1);
  });

  it("rejects a repeated placement id and names the first holder", () => {
    const errors = errorsOf(
      minimal({ entities: [placement(), placement({ type: "game.other" })] }),
    );

    expect(errors).toEqual([
      {
        path: "entities[1].id",
        message:
          "repeats the id of entities[0]; a placement id is its identity",
      },
    ]);
  });

  it("rejects a repeated developer key and names the first holder", () => {
    const errors = errorsOf(
      minimal({
        entities: [
          placement({ key: "hero" }),
          placement({ id: "other", key: "hero" }),
        ],
      }),
    );

    expect(errors).toEqual([
      {
        path: "entities[1].key",
        message:
          "derives the same scene key as entities[0]; a placement uses its key, or its id when it has none, and two cannot share one",
      },
    ]);
  });

  it("reads an authored layer, and refuses one that is not a name", () => {
    const document = readOrThrow(
      minimal({ entities: [placement({ layer: "props" })] }),
    );
    expect(document.entities[0]?.layer).toBe("props");

    expect(errorsOf(minimal({ entities: [placement({ layer: "" })] }))).toEqual(
      [{ path: "entities[0].layer", message: "must be a non-empty string" }],
    );
  });

  it("writes an authored layer back and leaves out an absent one", () => {
    const authored = readOrThrow(
      minimal({ entities: [placement({ layer: "props" })] }),
    );
    expect(formatLevel(authored)).toContain(`"layer": "props"`);

    const plain = readOrThrow(minimal({ entities: [placement()] }));
    expect(formatLevel(plain)).not.toContain(`"layer"`);
  });

  it("rejects a key that collides with another placement's id", () => {
    const errors = errorsOf(
      minimal({
        entities: [
          placement({ id: "hero" }),
          placement({ id: "p2", key: "hero" }),
        ],
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("entities[1].key");
  });

  it("names the id when the placement that collides has no key", () => {
    const errors = errorsOf(
      minimal({
        entities: [
          placement({ id: "p1", key: "hero" }),
          placement({ id: "hero" }),
        ],
      }),
    );

    expect(errors[0]?.path).toBe("entities[1].id");
  });

  it("rejects a parent link that leaves the document", () => {
    const errors = errorsOf(
      minimal({ entities: [placement({ parent: "elsewhere" })] }),
    );

    expect(errors).toEqual([
      {
        path: "entities[0].parent",
        message: 'names "elsewhere", which this level does not contain',
      },
    ]);
  });

  it("rejects a parent cycle, direct or around a longer loop", () => {
    expect(
      errorsOf(minimal({ entities: [placement({ parent: "a" })] })),
    ).toEqual([
      { path: "entities[0].parent", message: "names its own placement" },
    ]);

    const errors = errorsOf(
      minimal({
        entities: [
          placement({ id: "a", parent: "c" }),
          placement({ id: "b", parent: "a" }),
          placement({ id: "c", parent: "b" }),
        ],
      }),
    );

    // Every placement in the loop carries a link that closes it, so fixing the
    // file does not need one parse per hop.
    expect(errors.map((error) => error.path)).toEqual([
      "entities[0].parent",
      "entities[1].parent",
      "entities[2].parent",
    ]);
    expect(errors[0]?.message).toBe("closes a parent cycle");
  });

  it("reports one error for a self-parent, not two", () => {
    const errors = errorsOf(
      minimal({
        entities: [
          placement({ id: "a", parent: "a" }),
          placement({ id: "b", parent: "a" }),
        ],
      }),
    );

    // "b" names a placement the level does contain. Dropping "a" for its own
    // mistake would make "b" look broken too.
    expect(errors).toEqual([
      { path: "entities[0].parent", message: "names its own placement" },
    ]);
  });

  it("accepts a deep hierarchy that is not a cycle", () => {
    const entities = Array.from({ length: 40 }, (_unused, index) =>
      placement({
        id: `p${index}`,
        ...(index === 0 ? {} : { parent: `p${index - 1}` }),
      }),
    );

    expect(readOrThrow(minimal({ entities })).entities).toHaveLength(40);
  });

  it("rejects numbers a transform cannot use", () => {
    const nonFinite = errorsOf(
      minimal({
        entities: [
          placement({
            transform: {
              position: { x: 0, y: 0 },
              rotation: Number.NaN,
              scale: { x: 1, y: 1 },
            },
          }),
        ],
      }),
    );
    expect(nonFinite).toEqual([
      {
        path: "entities[0].transform.rotation",
        message: "must be a finite number",
      },
    ]);
  });

  it("reads a scale of zero, which is a value a placement holds", () => {
    // What a placement that pops in under an animation starts at. Nothing else
    // says that: an inactive placement is not in the scene at all, so it
    // cannot be tweened up.
    const read = readLevel(
      minimal({
        entities: [
          placement({
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 1, y: 0 },
            },
          }),
        ],
      }),
    );

    expect(read.ok).toBe(true);
    expect(read.ok && read.document.entities[0]?.transform.scale).toEqual({
      x: 1,
      y: 0,
    });
  });

  it("defaults an absent scale to one and an absent position to nothing", () => {
    const read = readLevel(
      minimal({ entities: [placement({ transform: { rotation: 0 } })] }),
    );

    expect(read.ok && read.document.entities[0]?.transform).toEqual({
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    });
  });

  it("rejects values JSON cannot carry, wherever they sit", () => {
    expect(
      errorsOf(
        minimal({ entities: [placement({ params: { at: new Date(0) } })] }),
      ),
    ).toEqual([
      { path: "entities[0].params.at", message: "is not a plain object" },
    ]);
    expect(
      errorsOf(minimal({ metadata: { speed: Number.POSITIVE_INFINITY } })),
    ).toEqual([
      {
        path: "metadata.speed",
        message: "is not a finite number, and JSON cannot store it",
      },
    ]);
    expect(errorsOf(minimal({ metadata: { onLoad: (): void => {} } }))).toEqual(
      [
        {
          path: "metadata.onLoad",
          message: "is a function, which JSON cannot store",
        },
      ],
    );
  });

  it("bounds how deep a value may nest", () => {
    const deep: Record<string, unknown> = {};
    let leaf = deep;
    for (let depth = 0; depth < 80; depth++) {
      const next: Record<string, unknown> = {};
      leaf["down"] = next;
      leaf = next;
    }

    const errors = errorsOf(minimal({ metadata: deep }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("nests deeper than 64 levels");
  });

  it("reports text that is not JSON at all", () => {
    const errors = errorsOf("{ not json");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("");
    expect(errors[0]?.message).toMatch(/^is not JSON: /);
  });

  it("rejects a document that is not an object", () => {
    expect(errorsOf("[]")).toEqual([
      { path: "", message: "must be an object" },
    ]);
    expect(errorsOf(null)).toEqual([
      { path: "", message: "must be an object" },
    ]);
    expect(errorsOf(42)).toEqual([{ path: "", message: "must be an object" }]);
  });
});

describe("formatLevel", () => {
  it("writes the canonical form of the published example", () => {
    expect(formatLevel(readOrThrow(EXAMPLE))).toBe(
      `{
  "$schema": "https://yage.dev/schemas/level-1.json",
  "format": "yage-level",
  "version": 1,
  "id": "forest-west",
  "metadata": {
    "music": "forest-night"
  },
  "entities": [
    {
      "id": "3e9de855-262c-4bb3-ad59-a8e91f17931e",
      "type": "game.slime",
      "typeVersion": 1,
      "name": "Bridge guard",
      "key": "bridge-guard",
      "transform": {
        "position": {
          "x": 320,
          "y": 176
        },
        "rotation": 0,
        "scale": {
          "x": 1,
          "y": 1
        }
      },
      "params": {
        "patrolEnd": {
          "x": 128,
          "y": 0
        },
        "speed": 40
      }
    }
  ]
}
`,
    );
  });

  it("produces the same bytes whatever order the document was built in", () => {
    const forward = readOrThrow(
      minimal({
        metadata: { a: 1, b: 2 },
        entities: [placement({ params: { first: 1, second: 2 } })],
      }),
    );
    const reversed = readOrThrow(
      minimal({
        metadata: { b: 2, a: 1 },
        entities: [placement({ params: { second: 2, first: 1 } })],
      }),
    );

    expect(formatLevel(forward)).toBe(formatLevel(reversed));
  });

  it("keeps array order, which is data", () => {
    const document = readOrThrow(
      minimal({ metadata: { waves: ["late", "early"] } }),
    );

    expect(formatLevel(document)).toContain('"late"');
    expect(JSON.parse(formatLevel(document))).toMatchObject({
      metadata: { waves: ["late", "early"] },
    });
  });

  it("leaves out what the parser would fill back in", () => {
    const document = readOrThrow(minimal({ entities: [placement()] }));
    const text = formatLevel(document);

    expect(text).not.toContain("transform");
    expect(text).not.toContain("params");
    expect(text).not.toContain("extensions");
    expect(text).not.toContain("active");
    expect(readOrThrow(text)).toEqual(document);
  });

  it("writes an inactive placement, because the default is active", () => {
    const document = readOrThrow(
      minimal({ entities: [placement({ active: false })] }),
    );

    expect(formatLevel(document)).toContain('"active": false');
    expect(readOrThrow(formatLevel(document)).entities[0]?.active).toBe(false);
  });

  it("writes a key named __proto__ instead of losing it", () => {
    // Assigning that key to a plain object runs the prototype setter, so the
    // entry never becomes an own property and disappears from the file.
    const document = readOrThrow(
      '{"format":"yage-level","version":1,"id":"level","entities":[],' +
        '"metadata":{"__proto__":{"kept":1},"other":2}}',
    );
    const text = formatLevel(document);
    const written = JSON.parse(text) as { metadata: Record<string, unknown> };

    // Built by parsing, not as a literal: an object literal gives `__proto__`
    // the same special treatment, so the expectation would share the bug.
    expect(written.metadata).toEqual(
      JSON.parse('{"__proto__":{"kept":1},"other":2}'),
    );
    expect(Object.keys(written.metadata)).toEqual(["__proto__", "other"]);
    expect(formatLevel(readOrThrow(text))).toBe(text);
  });

  it("keeps a null parameter, which is a reference with nothing chosen", () => {
    const text =
      '{"format":"yage-level","version":1,"id":"level","entities":[' +
      '{"id":"s1","type":"game.switch","typeVersion":1,' +
      '"transform":{"position":{"x":0,"y":0},"rotation":0,' +
      '"scale":{"x":1,"y":1}},"params":{"door":"p1","chime":null}}]}';

    const document = readOrThrow(text);

    expect(document.entities[0]?.params).toEqual({
      door: "p1",
      chime: null,
    });
    expect(formatLevel(document)).toContain('"chime": null');
    expect(formatLevel(readOrThrow(formatLevel(document)))).toBe(
      formatLevel(document),
    );
  });

  it("round-trips through text without drifting", () => {
    const once = formatLevel(readOrThrow(EXAMPLE));
    const twice = formatLevel(readOrThrow(once));

    expect(twice).toBe(once);
    expect(once.endsWith("}\n")).toBe(true);
  });
});

describe("emptyLevelDocument", () => {
  it("writes a level a reader accepts, with the id it was given", () => {
    const text = formatLevel(emptyLevelDocument("forest"));

    expect(text).toBe(
      `{
  "format": "yage-level",
  "version": 1,
  "id": "forest",
  "entities": []
}
`,
    );
    expect(readOrThrow(text)).toEqual(emptyLevelDocument("forest"));
  });
});
