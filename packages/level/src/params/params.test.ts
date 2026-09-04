import { AssetHandle, Entity } from "@yagejs/core";
import type { EntityHandle } from "@yagejs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { JsonObject } from "../document/types.js";
import { defineLevelAsset, param } from "./kinds.js";
import type { NumberParamOptions } from "./kinds.js";
import {
  decodeParams,
  defaultParams,
  describeParams,
  defineParams,
  paramAssets,
  schemaDefaultProblems,
  validateParams,
} from "./schema.js";
import { buildLevelCatalog } from "../catalog/build.js";
import { defineLevelEntity, defineLevelProject } from "../catalog/declare.js";
import type {
  ParamDecodeContext,
  ParamFieldDescription,
  ParamsOf,
} from "./types.js";

/** A decode context for a schema with no reference parameter in it. */
const NO_REFS: ParamDecodeContext = {
  resolveEntityRef: (id) => {
    throw new Error(`unexpected reference to "${id}"`);
  },
};

/** What `@yagejs/renderer`'s `texture()` does, without the renderer import. */
const textureAsset = defineLevelAsset({
  kind: "texture",
  create: (path: string) =>
    new AssetHandle<{ pixels: number }>("texture", path),
});

const CrateParams = defineParams({
  texture: param.asset(textureAsset, "sprites/crate.png"),
});

function authored(texture: string): JsonObject {
  return { texture };
}

describe("parameter schemas", () => {
  it("infers the setup parameter type from the schema", () => {
    // Compared with the concrete type a game would write by hand, not with
    // `decodeParams`'s own return type — that comparison holds even if
    // `ParamsOf` collapses to `never`.
    expectTypeOf<ParamsOf<typeof CrateParams>>().toEqualTypeOf<{
      texture: AssetHandle<{ pixels: number }>;
    }>();

    const params: ParamsOf<typeof CrateParams> = decodeParams(
      CrateParams,
      authored("sprites/barrel.png"),
      NO_REFS,
    );
    expect(params.texture.type).toBe("texture");
    expect(params.texture.path).toBe("sprites/barrel.png");
  });

  it("resolves defaults for a new placement", () => {
    expect({ ...defaultParams(CrateParams) }).toEqual({
      texture: "sprites/crate.png",
    });
  });

  it("describes asset fields in declaration order for authoring tools", () => {
    const schema = defineParams({
      foreground: param.asset(textureAsset, "sprites/front.png"),
      background: param.asset(textureAsset, "sprites/back.png"),
    });

    const descriptions = describeParams(schema);

    expect(descriptions).toEqual([
      {
        name: "foreground",
        kind: "asset",
        assetKind: "texture",
        defaultValue: "sprites/front.png",
      },
      {
        name: "background",
        kind: "asset",
        assetKind: "texture",
        defaultValue: "sprites/back.png",
      },
    ] satisfies readonly ParamFieldDescription[]);
    expect(Object.isFrozen(descriptions)).toBe(true);
    expect(descriptions.every(Object.isFrozen)).toBe(true);
  });

  it("carries each descriptor's own asset kind, so a tool can tell them apart", () => {
    const soundAsset = defineLevelAsset({
      kind: "sound",
      create: (path: string) =>
        new AssetHandle<{ seconds: number }>("sound", path),
    });
    const schema = defineParams({
      sprite: param.asset(textureAsset, "sprites/front.png"),
      hum: param.asset(soundAsset, "audio/hum.mp3"),
    });

    // `kind` says which control to render and stays closed; `assetKind` is the
    // descriptor's own name and is whatever the project declared.
    expect(describeParams(schema).map((field) => field.assetKind)).toEqual([
      "texture",
      "sound",
    ]);
  });

  it("accepts authored parameters that match the schema", () => {
    expect(validateParams(CrateParams, authored("a/b/c.png"))).toEqual([]);
  });

  it("reports a missing key rather than filling in the default", () => {
    expect(validateParams(CrateParams, {})).toEqual([
      { path: ["texture"], message: "is required and is missing" },
    ]);
  });

  it("reports an unknown key", () => {
    expect(
      validateParams(CrateParams, { texture: "a.png", speed: 40 }),
    ).toEqual([{ path: ["speed"], message: "is not a declared parameter" }]);
  });

  it("collects every problem in one pass", () => {
    expect(validateParams(CrateParams, { speed: 40 })).toEqual([
      { path: ["speed"], message: "is not a declared parameter" },
      { path: ["texture"], message: "is required and is missing" },
    ]);
  });

  it("rejects a value the kind cannot carry", () => {
    const rejected = (value: unknown): string[] =>
      validateParams(CrateParams, { texture: value } as JsonObject).map(
        (error) => error.message,
      );

    expect(rejected(7)).toEqual(["must be an asset path string"]);
    expect(rejected(null)).toEqual(["must be an asset path string"]);
    expect(rejected({ path: "a.png" })).toEqual([
      "must be an asset path string",
    ]);
    expect(rejected("")).toEqual(["must not be empty"]);
    expect(rejected("sprites\\crate.png")).toEqual([
      "must use POSIX separators, not backslashes",
    ]);
    expect(rejected("/etc/passwd")).toEqual([
      "must be relative to the project",
    ]);
    expect(rejected("sprites//crate.png")).toEqual([
      'must not contain an empty or "." path segment',
    ]);
    expect(rejected("./sprites/crate.png")).toEqual([
      'must not contain an empty or "." path segment',
    ]);
    expect(rejected("../../secrets/key.png")).toEqual([
      'must not contain a ".." path segment',
    ]);
  });

  it("keeps a parameter named __proto__ as its own key", () => {
    const schema = defineParams({
      ["__proto__"]: param.asset(textureAsset, "a.png"),
    });
    const params = JSON.parse('{"__proto__":"b.png"}') as JsonObject;

    expect(validateParams(schema, params)).toEqual([]);
    expect(Object.hasOwn(defaultParams(schema), "__proto__")).toBe(true);
    expect(paramAssets(schema, params).map((handle) => handle.path)).toEqual([
      "b.png",
    ]);
  });

  it("does not read an inherited key as an authored value", () => {
    // A parsed document cannot produce this, but a caller handing over data it
    // built itself can: `{}.toString` exists without being authored.
    const schema = defineParams({
      ["toString"]: param.asset(textureAsset, "a.png"),
    });

    expect(validateParams(schema, {} as JsonObject)).toEqual([
      { path: ["toString"], message: "is required and is missing" },
    ]);
  });

  it("derives the assets a parameter object needs", () => {
    const handles = paramAssets(CrateParams, authored("sprites/barrel.png"));
    expect(handles).toHaveLength(1);
    expect(handles[0]).toBeInstanceOf(AssetHandle);
    expect(handles[0]?.type).toBe("texture");
    expect(handles[0]?.path).toBe("sprites/barrel.png");
  });

  it("refuses to decode what was never validated", () => {
    expect(() => decodeParams(CrateParams, {}, NO_REFS)).toThrow(
      /Parameter "texture" is missing/,
    );
    expect(() => paramAssets(CrateParams, {})).toThrow(
      /Parameter "texture" is missing/,
    );
  });

  it("reports a default its own kind rejects", () => {
    // Reported, not thrown: `buildLevelCatalog` turns this into a diagnostic,
    // because throwing here would fail the entity module's import.
    const schema = defineParams({
      texture: param.asset(textureAsset, "../outside.png"),
    });

    expect(schemaDefaultProblems(schema)).toEqual([
      {
        path: ["texture"],
        message: 'default must not contain a ".." path segment',
      },
    ]);
    expect(schemaDefaultProblems(CrateParams)).toEqual([]);
  });

  it("rejects a descriptor that returns something other than a handle", () => {
    const broken = defineLevelAsset({
      kind: "texture",
      create: () => undefined as unknown as AssetHandle<unknown>,
    });
    const schema = defineParams({ texture: param.asset(broken, "a.png") });

    expect(() => decodeParams(schema, authored("a.png"), NO_REFS)).toThrow(
      /returned undefined for "a.png" instead of an AssetHandle/,
    );
  });

  it("accepts a handle from another copy of the core package", () => {
    // Shape, not `instanceof`: a duplicated `@yagejs/core` must not make every
    // valid handle look wrong.
    const foreign = defineLevelAsset({
      kind: "texture",
      create: (path: string) =>
        ({ type: "texture", path }) as unknown as AssetHandle<unknown>,
    });
    const schema = defineParams({ texture: param.asset(foreign, "a.png") });

    expect(paramAssets(schema, authored("b.png"))[0]?.path).toBe("b.png");
  });

  it("freezes the schema and the descriptor", () => {
    expect(Object.isFrozen(CrateParams)).toBe(true);
    expect(Object.isFrozen(CrateParams._fields)).toBe(true);
    expect(Object.isFrozen(textureAsset)).toBe(true);
  });
});

describe("declared frame grids", () => {
  it("leaves the key off a parameter that declares no grid", () => {
    const description = describeParams(CrateParams)[0];

    expect(description).toBeDefined();
    expect(Object.hasOwn(description as object, "frames")).toBe(false);
  });

  it("carries a declared grid to the authoring tool, copied", () => {
    const declared = { frameWidth: 48 };
    const schema = defineParams({
      texture: param.asset(textureAsset, "sprites/walk.png", declared),
    });

    const frames = describeParams(schema)[0]?.frames;
    expect(frames).toEqual({ frameWidth: 48 });
    expect(Object.isFrozen(frames)).toBe(true);

    // The caller keeps the object to spread into its own frame source, and a
    // later change to it must not change what the schema says.
    declared.frameWidth = 24;
    expect(describeParams(schema)[0]?.frames).toEqual({ frameWidth: 48 });
  });

  it("carries every member of the grid", () => {
    const declared = {
      frameWidth: 48,
      frameHeight: 32,
      startX: 4,
      startY: 8,
      columns: 3,
      count: 6,
      gapX: 1,
      gapY: 2,
    };
    const schema = defineParams({
      texture: param.asset(textureAsset, "sprites/walk.png", declared),
    });

    expect(describeParams(schema)[0]?.frames).toEqual(declared);
  });

  it("changes nothing about what the parameter decodes to", () => {
    const schema = defineParams({
      texture: param.asset(textureAsset, "sprites/crate.png", {
        frameWidth: 48,
      }),
    });

    const params = decodeParams(
      schema,
      authored("sprites/barrel.png"),
      NO_REFS,
    );
    expect(params.texture).toBeInstanceOf(AssetHandle);
    expect(params.texture.path).toBe("sprites/barrel.png");
    expect({ ...defaultParams(schema) }).toEqual({
      texture: "sprites/crate.png",
    });
  });

  it("reports a grid the renderer could not slice with, rather than throwing", () => {
    const schema = defineParams({
      flat: param.asset(textureAsset, "a.png", { frameWidth: 0 }),
      behind: param.asset(textureAsset, "b.png", { frameWidth: 8, startX: -1 }),
      endless: param.asset(textureAsset, "c.png", {
        frameWidth: 8,
        count: Number.POSITIVE_INFINITY,
      }),
    });

    expect(schemaDefaultProblems(schema)).toEqual([
      {
        path: ["flat"],
        message: "frames.frameWidth must be a finite number of at least 1",
      },
      {
        path: ["behind"],
        message: "frames.startX must be a finite number of at least 0",
      },
      {
        path: ["endless"],
        message: "frames.count must be a finite number of at least 1",
      },
    ]);
    expect(() =>
      param.asset(textureAsset, "a.png", { frameWidth: 0 }),
    ).not.toThrow();
  });

  it("makes a bad grid a catalog error rather than a failed import", () => {
    class Torch extends Entity {
      static readonly level = defineLevelEntity({
        id: "game.torch",
        version: 1,
        params: defineParams({
          sprite: param.asset(textureAsset, "a.png", { frameWidth: 0 }),
        }),
      });
    }

    const result = buildLevelCatalog(defineLevelProject({ entities: [Torch] }));

    expect(result.ok).toBe(false);
    expect(
      result.ok ? [] : result.errors.map((error) => error.message),
    ).toEqual([
      'Entity type "game.torch" parameter "sprite" frames.frameWidth must ' +
        "be a finite number of at least 1.",
    ]);
  });
});

describe("entity reference parameters", () => {
  class Door extends Entity {}

  const SwitchParams = defineParams({
    door: param.entityRef<Door>({ types: ["game.door"] }),
    chime: param.entityRef({ types: ["game.chime"], optional: true }),
  });

  it("accepts a placement id or nothing, and refuses anything else", () => {
    const rejected = (value: unknown): string[] =>
      validateParams(SwitchParams, {
        door: value,
        chime: null,
      } as JsonObject).map((error) => error.message);

    expect(validateParams(SwitchParams, { door: "p1", chime: null })).toEqual(
      [],
    );
    expect(validateParams(SwitchParams, { door: null, chime: "p2" })).toEqual(
      [],
    );
    expect(rejected("")).toEqual(["must not be empty"]);
    expect(rejected(7)).toEqual(["must be a placement id or null"]);
    expect(rejected({ id: "p1" })).toEqual(["must be a placement id or null"]);
  });

  it("describes the accepted types and whether the field may be empty", () => {
    const descriptions = describeParams(SwitchParams);

    expect(descriptions).toEqual([
      {
        name: "door",
        kind: "entityRef",
        types: ["game.door"],
        optional: false,
        defaultValue: null,
      },
      {
        name: "chime",
        kind: "entityRef",
        types: ["game.chime"],
        optional: true,
        defaultValue: null,
      },
    ] satisfies readonly ParamFieldDescription[]);
    expect(Object.isFrozen(descriptions[0]?.types)).toBe(true);
  });

  it("keeps the asset field's own data off a reference field", () => {
    const mixed = defineParams({
      sprite: param.asset(textureAsset, "a.png", { frameWidth: 48 }),
      door: param.entityRef({ types: ["game.door"] }),
    });

    const [sprite, door] = describeParams(mixed);

    expect(sprite).toEqual({
      name: "sprite",
      kind: "asset",
      assetKind: "texture",
      frames: { frameWidth: 48 },
      defaultValue: "a.png",
    });
    expect(Object.hasOwn(door as object, "assetKind")).toBe(false);
    expect(Object.hasOwn(door as object, "frames")).toBe(false);
    expect(Object.hasOwn(sprite as object, "types")).toBe(false);
  });

  it("writes nothing chosen into a new placement, required or not", () => {
    expect({ ...defaultParams(SwitchParams) }).toEqual({
      door: null,
      chime: null,
    });
  });

  it("does not call a required reference's empty default a problem", () => {
    // The catalog validates every declared default. A required reference
    // defaults to nothing chosen, and preparation is what reports that.
    expect(schemaDefaultProblems(SwitchParams)).toEqual([]);
  });

  it("needs no assets", () => {
    expect(paramAssets(SwitchParams, { door: "p1", chime: null })).toEqual([]);
  });

  it("decodes an id to a handle and nothing to undefined", () => {
    const door = new Door();
    const params = decodeParams(
      SwitchParams,
      { door: "p1", chime: null },
      { resolveEntityRef: () => door.handle() },
    );

    expectTypeOf(params.door).toEqualTypeOf<EntityHandle<Door>>();
    expectTypeOf(params.chime).toEqualTypeOf<EntityHandle | undefined>();
    expect(params.door.current).toBe(door);
    expect(params.chime).toBeUndefined();
  });

  it("copies the accepted types, so a later change cannot widen them", () => {
    const types = ["game.door"];
    const schema = defineParams({ door: param.entityRef({ types }) });

    types.push("game.crate");

    expect(describeParams(schema)[0]?.types).toEqual(["game.door"]);
  });
});

describe("the plain parameter kinds", () => {
  const SlimeParams = defineParams({
    speed: param.number(40, { min: 5, max: 200, step: 5 }),
    coins: param.integer(3, { min: 0 }),
    locked: param.boolean(true),
    title: param.string("Slime"),
    facing: param.select("left", ["left", "right"]),
  });

  const authoredSlime = {
    speed: 40,
    coins: 3,
    locked: true,
    title: "Slime",
    facing: "left",
  } satisfies JsonObject;

  /** The reasons one field gives for one authored value. */
  function reasons(field: string, value: unknown): string[] {
    return validateParams(SlimeParams, {
      ...authoredSlime,
      [field]: value,
    } as JsonObject)
      .filter((error) => error.path[0] === field)
      .map((error) => error.message);
  }

  it("decodes each kind to the type its declaration promises", () => {
    const params = decodeParams(SlimeParams, authoredSlime, NO_REFS);

    expectTypeOf<ParamsOf<typeof SlimeParams>>().toEqualTypeOf<{
      speed: number;
      coins: number;
      locked: boolean;
      title: string;
      facing: "left" | "right";
    }>();
    expect({ ...params }).toEqual(authoredSlime);
  });

  it("writes every declared default into a new placement", () => {
    expect({ ...defaultParams(SlimeParams) }).toEqual(authoredSlime);
    expect(schemaDefaultProblems(SlimeParams)).toEqual([]);
  });

  it("accepts each kind's own JSON and refuses the others", () => {
    expect(validateParams(SlimeParams, authoredSlime)).toEqual([]);

    expect(reasons("speed", "40")).toEqual(["must be a number"]);
    expect(reasons("speed", true)).toEqual(["must be a number"]);
    expect(reasons("coins", "3")).toEqual(["must be a whole number"]);
    expect(reasons("locked", 1)).toEqual(["must be true or false"]);
    expect(reasons("title", 7)).toEqual(["must be a string"]);
    expect(reasons("facing", 7)).toEqual(['must be one of "left", "right"']);
  });

  it("refuses a fraction in a whole-number field", () => {
    expect(reasons("coins", 2.5)).toEqual(["must be a whole number"]);
    expect(reasons("coins", 2)).toEqual([]);
    // The fraction is the number's own business.
    expect(reasons("speed", 40.5)).toEqual([]);
  });

  it("refuses a number that is not finite", () => {
    expect(reasons("speed", Number.NaN)).toEqual(["must be a number"]);
    expect(reasons("speed", Number.POSITIVE_INFINITY)).toEqual([
      "must be a number",
    ]);
  });

  it("refuses a number outside the range it was declared in", () => {
    expect(reasons("speed", 4)).toEqual(["must be at least 5"]);
    expect(reasons("speed", 201)).toEqual(["must be at most 200"]);
    expect(reasons("speed", 5)).toEqual([]);
    expect(reasons("speed", 200)).toEqual([]);
    expect(reasons("coins", -1)).toEqual(["must be at least 0"]);
  });

  it("does not treat the step as a rule about the value", () => {
    // The step sizes an authoring control's presses. A number between two
    // steps is a number the field takes.
    expect(reasons("speed", 42)).toEqual([]);
  });

  it("refuses a string outside a choice's own list", () => {
    expect(reasons("facing", "up")).toEqual(['must be one of "left", "right"']);
    expect(reasons("facing", "right")).toEqual([]);
  });

  it("accepts nothing at all only where the declaration said so", () => {
    const OptionalParams = defineParams({
      speed: param.number(40, { optional: true }),
      coins: param.integer(3, { optional: true }),
      locked: param.boolean(true, { optional: true }),
      title: param.string("Slime", { optional: true }),
      facing: param.select("left", ["left", "right"], { optional: true }),
    });
    const empty = {
      speed: null,
      coins: null,
      locked: null,
      title: null,
      facing: null,
    } satisfies JsonObject;

    expect(validateParams(OptionalParams, empty)).toEqual([]);
    expect(
      validateParams(SlimeParams, {
        ...authoredSlime,
        ...empty,
      } as JsonObject).map((error) => error.message),
    ).toEqual([
      "must be a number",
      "must be a whole number",
      "must be true or false",
      "must be a string",
      'must be one of "left", "right"',
    ]);
  });

  it("decodes nothing at all to undefined, as a reference does", () => {
    const OptionalParams = defineParams({
      speed: param.number(40, { optional: true }),
      facing: param.select("left", ["left", "right"], { optional: true }),
    });

    const params = decodeParams(
      OptionalParams,
      { speed: null, facing: null },
      NO_REFS,
    );

    expectTypeOf<ParamsOf<typeof OptionalParams>>().toEqualTypeOf<{
      speed: number | undefined;
      facing: "left" | "right" | undefined;
    }>();
    expect(params.speed).toBeUndefined();
    expect(params.facing).toBeUndefined();
  });

  it("says nothing at all is a value in the reason it gives", () => {
    const OptionalParams = defineParams({
      speed: param.number(40, { optional: true }),
      locked: param.boolean(true, { optional: true }),
      title: param.string("Slime", { optional: true }),
      facing: param.select("left", ["left", "right"], { optional: true }),
    });

    expect(
      validateParams(OptionalParams, {
        speed: "40",
        locked: 1,
        title: 7,
        facing: "up",
      }).map((error) => error.message),
    ).toEqual([
      "must be a number or null",
      "must be true, false or null",
      "must be a string or null",
      'must be one of "left", "right", or null',
    ]);
  });

  it("describes each kind's own extras and leaves the rest off", () => {
    const descriptions = describeParams(SlimeParams);

    expect(descriptions).toEqual([
      {
        name: "speed",
        kind: "number",
        optional: false,
        min: 5,
        max: 200,
        step: 5,
        defaultValue: 40,
      },
      {
        name: "coins",
        kind: "integer",
        optional: false,
        min: 0,
        defaultValue: 3,
      },
      { name: "locked", kind: "boolean", optional: false, defaultValue: true },
      { name: "title", kind: "string", optional: false, defaultValue: "Slime" },
      {
        name: "facing",
        kind: "select",
        optional: false,
        options: ["left", "right"],
        defaultValue: "left",
      },
    ] satisfies readonly ParamFieldDescription[]);
    expect(descriptions.every(Object.isFrozen)).toBe(true);
  });

  it("describes a multiline string as one", () => {
    const schema = defineParams({
      body: param.string("", { multiline: true }),
      title: param.string(""),
    });

    const [body, title] = describeParams(schema);
    expect(body?.multiline).toBe(true);
    expect(Object.hasOwn(title as object, "multiline")).toBe(false);
  });

  it("copies a choice's values, so a later change cannot widen them", () => {
    const values = ["left", "right"];
    const schema = defineParams({ facing: param.select("left", values) });

    values.push("up");

    expect(describeParams(schema)[0]?.options).toEqual(["left", "right"]);
    expect(Object.isFrozen(describeParams(schema)[0]?.options)).toBe(true);
  });

  it("reports a default its own kind rejects rather than throwing", () => {
    // A list typed as `string[]` rather than read literally offers no
    // compile-time check of the default, so the catalog is what catches it.
    const facings: string[] = ["left", "right"];
    const schema = defineParams({
      speed: param.number(400, { max: 200 }),
      coins: param.integer(2.5),
      facing: param.select("up", facings),
    });

    expect(schemaDefaultProblems(schema)).toEqual([
      { path: ["speed"], message: "default must be at most 200" },
      { path: ["coins"], message: "default must be a whole number" },
      {
        path: ["facing"],
        message: 'default must be one of "left", "right"',
      },
    ]);
    expect(() => param.integer(2.5)).not.toThrow();
  });

  it("needs no assets", () => {
    expect(paramAssets(SlimeParams, authoredSlime)).toEqual([]);
  });
});

describe("what optional says setup() receives", () => {
  it("answers from the options it can read, and widens when it cannot", () => {
    // Options a caller holds in a variable decide nothing at compile time:
    // this one is optional and the next one is not, and both have the type
    // the parameter list gave them.
    const held: NumberParamOptions = { optional: true };

    const schema = defineParams({
      plain: param.number(1),
      bounded: param.number(1, { min: 0 }),
      notOptional: param.number(1, { optional: false }),
      optional: param.number(1, { optional: true }),
      fromVariable: param.number(1, held),
    });
    type Params = ParamsOf<typeof schema>;

    expectTypeOf<Params["plain"]>().toEqualTypeOf<number>();
    expectTypeOf<Params["bounded"]>().toEqualTypeOf<number>();
    expectTypeOf<Params["notOptional"]>().toEqualTypeOf<number>();
    expectTypeOf<Params["optional"]>().toEqualTypeOf<number | undefined>();
    // Wider than this call needs, and never narrower than what it can hand
    // over: the alternative is a signature that promises a number and passes
    // nothing.
    expectTypeOf<Params["fromVariable"]>().toEqualTypeOf<number | undefined>();

    expect(defaultParams(schema)).toEqual({
      plain: 1,
      bounded: 1,
      notOptional: 1,
      optional: 1,
      fromVariable: 1,
    });
  });
});
