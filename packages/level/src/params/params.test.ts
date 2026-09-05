import { AssetHandle, Entity, Vec2 } from "@yagejs/core";
import type { EntityHandle } from "@yagejs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  JsonObject,
  JsonValue,
  LevelTransform,
} from "../document/types.js";
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
  ParamKind,
  ParamsOf,
} from "./types.js";

/** A placement sitting at the world origin, unturned and unscaled. */
const AT_ORIGIN: LevelTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
};

/** A decode context for a schema with no reference parameter in it. */
const NO_REFS: ParamDecodeContext = {
  resolveEntityRef: (id) => {
    throw new Error(`unexpected reference to "${id}"`);
  },
  worldPose: AT_ORIGIN,
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
      { ...NO_REFS, resolveEntityRef: () => door.handle() },
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

  it("takes a choice's values from an object's keys", () => {
    const open = {
      none: () => "nothing",
      unlockBossRoom: () => "unlocked",
      startAlarm: () => "alarm",
    };
    const schema = defineParams({ onOpen: param.select("none", open) });

    expect(describeParams(schema)[0]?.options).toEqual([
      "none",
      "unlockBossRoom",
      "startAlarm",
    ]);
    expectTypeOf<ParamsOf<typeof schema>>().toEqualTypeOf<{
      onOpen: "none" | "unlockBossRoom" | "startAlarm";
    }>();
    expect(decodeParams(schema, { onOpen: "startAlarm" }, NO_REFS).onOpen).toBe(
      "startAlarm",
    );
  });

  it("refuses a name the object does not have, as a list does", () => {
    const schema = defineParams({
      onOpen: param.select("none", { none: () => {}, startAlarm: () => {} }),
    });

    expect(
      validateParams(schema, { onOpen: "unlockBossRoom" }).map(
        (error) => error.message,
      ),
    ).toEqual(['must be one of "none", "startAlarm"']);
    // @ts-expect-error a default that is not one of the object's keys
    param.select("unlockBossRoom", { none: () => {} });
  });

  it("reads an object's keys once, so a later change cannot widen them", () => {
    const open: Record<string, () => void> = { none: () => {} };
    const schema = defineParams({
      onOpen: param.select("none", open, { optional: true }),
    });

    open["startAlarm"] = () => {};

    expect(describeParams(schema)[0]?.options).toEqual(["none"]);
    expect(Object.isFrozen(describeParams(schema)[0]?.options)).toBe(true);
    expect(validateParams(schema, { onOpen: null })).toEqual([]);
    expectTypeOf<ParamsOf<typeof schema>>().toEqualTypeOf<{
      onOpen: string | undefined;
    }>();
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

describe("pair and place parameters", () => {
  const PatrolParams = defineParams({
    drift: param.vec2({ x: 12, y: -4 }),
    patrolEnd: param.point({ x: 120, y: 0 }, { relative: true }),
    spawn: param.point({ x: 0, y: 0 }),
  });

  const authoredPatrol = {
    drift: { x: 12, y: -4 },
    patrolEnd: { x: 120, y: 0 },
    spawn: { x: 0, y: 0 },
  } satisfies JsonObject;

  /** The reasons one field gives for one authored value. */
  function reasons(field: string, value: unknown): string[] {
    return validateParams(PatrolParams, {
      ...authoredPatrol,
      [field]: value,
    } as JsonObject)
      .filter((error) => error.path[0] === field)
      .map((error) => error.message);
  }

  it("decodes both kinds to a Vec2", () => {
    const params = decodeParams(PatrolParams, authoredPatrol, NO_REFS);

    expectTypeOf<ParamsOf<typeof PatrolParams>>().toEqualTypeOf<{
      drift: Vec2;
      patrolEnd: Vec2;
      spawn: Vec2;
    }>();
    expect(params.patrolEnd).toBeInstanceOf(Vec2);
    expect(params.patrolEnd.x).toBe(120);
    expect(params.drift.y).toBe(-4);
  });

  it("takes a Vec2 as the declared default and stores its two numbers", () => {
    const schema = defineParams({ drift: param.vec2(new Vec2(3, 4)) });

    expect({ ...defaultParams(schema) }).toEqual({ drift: { x: 3, y: 4 } });
    expect(schemaDefaultProblems(schema)).toEqual([]);
  });

  it("accepts an object with two finite numbers and refuses everything else", () => {
    expect(validateParams(PatrolParams, authoredPatrol)).toEqual([]);

    expect(reasons("drift", 12)).toEqual([
      "must be an object with finite x and y",
    ]);
    expect(reasons("drift", null)).toEqual([
      "must be an object with finite x and y",
    ]);
    expect(reasons("drift", [12, 4])).toEqual([
      "must be an object with finite x and y",
    ]);
    expect(reasons("drift", { x: 12 })).toEqual(["must hold a finite y"]);
    expect(reasons("drift", { x: "12", y: 4 })).toEqual([
      "must hold a finite x",
    ]);
    expect(reasons("drift", { x: Number.NaN, y: 4 })).toEqual([
      "must hold a finite x",
    ]);
    expect(reasons("drift", { x: 1, y: 2, z: 3 })).toEqual([
      'must not hold "z"',
    ]);
  });

  it("takes nothing at all only where the declaration said so", () => {
    const OptionalParams = defineParams({
      home: param.point({ x: 0, y: 0 }, { optional: true }),
    });

    expect(validateParams(OptionalParams, { home: null })).toEqual([]);
    expect(
      validateParams(OptionalParams, { home: 4 }).map((one) => one.message),
    ).toEqual(["must be an object with finite x and y or null"]);

    const params = decodeParams(OptionalParams, { home: null }, NO_REFS);
    expectTypeOf<ParamsOf<typeof OptionalParams>>().toEqualTypeOf<{
      home: Vec2 | undefined;
    }>();
    expect(params.home).toBeUndefined();
  });

  it("carries relative to the authoring tool, and only for a point", () => {
    expect(describeParams(PatrolParams)).toEqual([
      {
        name: "drift",
        kind: "vec2",
        optional: false,
        defaultValue: { x: 12, y: -4 },
      },
      {
        name: "patrolEnd",
        kind: "point",
        optional: false,
        relative: true,
        defaultValue: { x: 120, y: 0 },
      },
      {
        name: "spawn",
        kind: "point",
        optional: false,
        relative: false,
        defaultValue: { x: 0, y: 0 },
      },
    ] satisfies ParamFieldDescription[]);
  });

  it("gives each new placement its own object rather than a shared one", () => {
    const first = defaultParams(PatrolParams);
    const second = defaultParams(PatrolParams);

    expect(first["drift"]).toEqual(second["drift"]);
    expect(first["drift"]).not.toBe(second["drift"]);
  });

  describe("the frame setup() receives", () => {
    /** A placement turned a quarter turn, doubled, and moved off the origin. */
    const TURNED: LevelTransform = {
      position: { x: 100, y: 50 },
      rotation: Math.PI / 2,
      scale: { x: 2, y: 2 },
    };

    /** The same authored point, stored and wanted in all four combinations. */
    const FrameParams = defineParams({
      patrolEnd: param.point({ x: 10, y: 0 }, { relative: true }),
      muzzle: param.point({ x: 10, y: 0 }, { relative: true, space: "local" }),
      exit: param.point({ x: 100, y: 70 }),
      dock: param.point({ x: 100, y: 70 }, { space: "local" }),
    });

    function decodeAt(pose: LevelTransform): ParamsOf<typeof FrameParams> {
      return decodeParams(
        FrameParams,
        {
          patrolEnd: { x: 10, y: 0 },
          muzzle: { x: 10, y: 0 },
          exit: { x: 100, y: 70 },
          dock: { x: 100, y: 70 },
        },
        { ...NO_REFS, worldPose: pose },
      );
    }

    it("converts through the placement's world pose", () => {
      const params = decodeAt(TURNED);

      // Local (10, 0) doubled is (20, 0); a quarter turn puts it at (0, 20);
      // the placement's own position moves it to (100, 70).
      expect(params.patrolEnd.equals({ x: 100, y: 70 })).toBe(true);
      expect(params.exit.equals({ x: 100, y: 70 })).toBe(true);
      // And back the other way, from that same world point.
      expect(params.dock.equals({ x: 10, y: 0 })).toBe(true);
      expect(params.muzzle.equals({ x: 10, y: 0 })).toBe(true);
    });

    it("passes the authored numbers through when the frames agree", () => {
      const params = decodeAt(TURNED);

      expect({ ...params.muzzle }).toEqual({ x: 10, y: 0 });
      expect({ ...params.exit }).toEqual({ x: 100, y: 70 });
    });

    it("answers 0 on an axis the placement scaled to nothing", () => {
      const flattened: LevelTransform = {
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 0, y: 1 },
      };

      // Every local x draws at world 0, so no local x names the authored 100.
      expect({ ...decodeAt(flattened).dock }).toEqual({ x: 0, y: 70 });
    });

    it("leaves an optional point holding nothing alone", () => {
      const schema = defineParams({
        home: param.point({ x: 0, y: 0 }, { relative: true, optional: true }),
      });

      expect(
        decodeParams(schema, { home: null }, { ...NO_REFS, worldPose: TURNED })
          .home,
      ).toBeUndefined();
    });
  });
});

describe("values with a shape", () => {
  const SpawnParams = defineParams({
    spawns: param.array(
      param.object({
        type: param.select("slime", ["slime", "bat"]),
        count: param.integer(1, { min: 1 }),
      }),
      { min: 1, max: 3 },
    ),
  });

  function wave(spawns: JsonObject[]): JsonObject {
    return { spawns };
  }

  it("hands setup() the members and the elements it declared", () => {
    expectTypeOf<ParamsOf<typeof SpawnParams>>().toEqualTypeOf<{
      spawns: readonly { type: "slime" | "bat"; count: number }[];
    }>();

    const params = decodeParams(
      SpawnParams,
      wave([
        { type: "bat", count: 3 },
        { type: "slime", count: 1 },
      ]),
      NO_REFS,
    );

    expect(params.spawns.map((spawn) => spawn.type)).toEqual(["bat", "slime"]);
    expect(params.spawns[0]?.count).toBe(3);
  });

  it("validates each member by its own kind and names it", () => {
    const problems = validateParams(
      SpawnParams,
      wave([{ type: "ghost", count: 2.5 }]),
    );

    expect(problems).toEqual([
      {
        path: ["spawns", "0", "type"],
        message: 'must be one of "slime", "bat"',
      },
      { path: ["spawns", "0", "count"], message: "must be a whole number" },
    ]);
  });

  it("names an element by its position as a decimal string", () => {
    const problems = validateParams(
      SpawnParams,
      wave([
        { type: "bat", count: 1 },
        { type: "bat", count: 0 },
      ]),
    );

    expect(problems.map((one) => one.path)).toEqual([["spawns", "1", "count"]]);
  });

  it("reports a missing member and one that was not declared", () => {
    expect(validateParams(SpawnParams, wave([{ kind: "bat" }]))).toEqual([
      { path: ["spawns", "0", "kind"], message: "is not a declared member" },
      {
        path: ["spawns", "0", "type"],
        message: "is required and is missing",
      },
      {
        path: ["spawns", "0", "count"],
        message: "is required and is missing",
      },
    ]);
  });

  it("checks how many elements the list holds", () => {
    const short = validateParams(SpawnParams, { spawns: [] });
    const long = validateParams(
      SpawnParams,
      wave([
        { type: "bat", count: 1 },
        { type: "bat", count: 1 },
        { type: "bat", count: 1 },
        { type: "bat", count: 1 },
      ]),
    );

    expect(short).toEqual([
      { path: ["spawns"], message: "must hold at least 1 item" },
    ]);
    expect(long).toEqual([
      { path: ["spawns"], message: "must hold at most 3 items" },
    ]);
  });

  it("refuses a value that is not the shape the declaration names", () => {
    expect(
      validateParams(SpawnParams, { spawns: "slime" }).map(
        (one) => one.message,
      ),
    ).toEqual(["must be a list"]);
    expect(
      validateParams(SpawnParams, { spawns: [7] }).map((one) => one.message),
    ).toEqual(["must be an object"]);
  });

  it("starts a new placement with the members' own defaults, cloned", () => {
    const schema = defineParams({
      loot: param.object({
        item: param.string("coin"),
        count: param.integer(1),
      }),
      spawns: param.array(param.integer(0), { default: [1, 2] }),
    });

    const first = defaultParams(schema);
    const second = defaultParams(schema);

    expect({ ...first }).toEqual({
      loot: { item: "coin", count: 1 },
      spawns: [1, 2],
    });
    expect(first["loot"]).not.toBe(second["loot"]);
    expect(first["spawns"]).not.toBe(second["spawns"]);
    expect(validateParams(schema, first)).toEqual([]);
  });

  it("describes the tree, with the kind flat at every node", () => {
    expect(describeParams(SpawnParams)).toEqual([
      {
        name: "spawns",
        kind: "array",
        optional: false,
        min: 1,
        max: 3,
        item: {
          kind: "object",
          optional: false,
          fields: [
            {
              name: "type",
              kind: "select",
              optional: false,
              options: ["slime", "bat"],
              defaultValue: "slime",
            },
            {
              name: "count",
              kind: "integer",
              optional: false,
              min: 1,
              defaultValue: 1,
            },
          ],
          defaultValue: { type: "slime", count: 1 },
        },
        defaultValue: [],
      },
    ] satisfies readonly ParamFieldDescription[]);
  });

  it("loads the assets its members and elements name", () => {
    const schema = defineParams({
      sprites: param.array(
        param.object({
          idle: param.asset(textureAsset, "sprites/idle.png"),
        }),
      ),
    });
    const authoredValue = {
      sprites: [{ idle: "sprites/walk.png" }, { idle: "sprites/jump.png" }],
    };

    expect(paramAssets(schema, authoredValue).map((one) => one.path)).toEqual([
      "sprites/walk.png",
      "sprites/jump.png",
    ]);
  });

  it("decodes a member with the context the placement was given", () => {
    const schema = defineParams({
      route: param.object({
        end: param.point({ x: 10, y: 0 }, { relative: true }),
      }),
    });

    const params = decodeParams(
      schema,
      { route: { end: { x: 10, y: 0 } } },
      {
        ...NO_REFS,
        worldPose: {
          position: { x: 100, y: 50 },
          rotation: 0,
          scale: { x: 2, y: 2 },
        },
      },
    );

    expect(params.route.end.equals({ x: 120, y: 50 })).toBe(true);
  });

  it("takes null only where the declaration said it may", () => {
    const schema = defineParams({
      loot: param.object({ item: param.string("coin") }, { optional: true }),
      spawns: param.array(param.integer(0), { optional: true }),
    });

    expectTypeOf<ParamsOf<typeof schema>>().toEqualTypeOf<{
      loot: { item: string } | undefined;
      spawns: readonly number[] | undefined;
    }>();
    expect(validateParams(schema, { loot: null, spawns: null })).toEqual([]);

    const params = decodeParams(schema, { loot: null, spawns: null }, NO_REFS);
    expect(params.loot).toBeUndefined();
    expect(params.spawns).toBeUndefined();

    expect(
      validateParams(defineParams({ loot: param.object({}) }), {
        loot: null,
      }).map((one) => one.message),
    ).toEqual(["must be an object"]);
  });

  it("accepts any JSON value in a json parameter", () => {
    const schema = defineParams({
      noise: param.json({ default: { seed: 1 } }),
    });

    for (const value of [
      7,
      "text",
      true,
      [1, [2, { deep: null }]],
      { seed: 2, octaves: [1, 2] },
    ]) {
      expect(validateParams(schema, { noise: value })).toEqual([]);
    }
    expect(decodeParams(schema, { noise: { seed: 4 } }, NO_REFS).noise).toEqual(
      { seed: 4 },
    );
    expect({ ...defaultParams(schema) }).toEqual({ noise: { seed: 1 } });
  });

  it("treats null in a json parameter as nothing at all", () => {
    const required = defineParams({ noise: param.json() });
    const optional = defineParams({ noise: param.json({ optional: true }) });

    expect(
      validateParams(required, { noise: null }).map((one) => one.message),
    ).toEqual(["must not be null"]);
    expect(validateParams(optional, { noise: null })).toEqual([]);
    expect(
      decodeParams(optional, { noise: null }, NO_REFS).noise,
    ).toBeUndefined();
  });

  it("reports a bad default inside a value with members", () => {
    const schema = defineParams({
      loot: param.object({ count: param.integer(0, { min: 1 }) }),
    });

    expect(schemaDefaultProblems(schema)).toEqual([
      { path: ["loot", "count"], message: "default must be at least 1" },
    ]);
  });

  it("makes a declaration nested deeper than four levels a catalog error", () => {
    const four = param.object({
      a: param.array(param.object({ b: param.array(param.integer(0)) })),
    });
    const five = param.object({ deep: four });

    expect(schemaDefaultProblems(defineParams({ wave: four }))).toEqual([]);
    expect(schemaDefaultProblems(defineParams({ wave: five }))).toEqual([
      {
        path: ["wave"],
        message:
          "nests values 5 levels deep, and the most a level can author is 4",
      },
    ]);
  });

  it("reports a list default the declared minimum rejects", () => {
    const spawn = param.object({
      type: param.select("slime", ["slime", "bat"]),
      delay: param.number(1, { min: 0 }),
    });

    expect(
      schemaDefaultProblems(
        defineParams({ spawns: param.array(spawn, { min: 1 }) }),
      ),
    ).toEqual([
      { path: ["spawns"], message: "default must hold at least 1 item" },
    ]);
    expect(
      schemaDefaultProblems(
        defineParams({
          spawns: param.array(spawn, {
            default: [{ type: "slime", delay: 1 }],
            min: 1,
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("rejects a hand-built member kind without calling it", () => {
    const calls: JsonValue[] = [];
    const lookalike: ParamKind<number> = {
      name: "integer",
      defaultValue: 0,
      validate: (value) => {
        calls.push(value);
        return [];
      },
      decode: () => 0,
      assets: () => [],
    };
    const schema = defineParams({ loot: param.object({ count: lookalike }) });

    expect(schemaDefaultProblems(schema)).toEqual([
      { path: ["loot", "count"], message: "kind did not come from param.*" },
    ]);
    expect(calls).toEqual([]);
  });

  it("refuses a reference nested inside another value", () => {
    const schema = defineParams({
      guards: param.array(
        param.object({ door: param.entityRef({ types: ["game.door"] }) }),
      ),
    });

    expect(schemaDefaultProblems(schema)).toEqual([
      {
        path: ["guards", "0", "door"],
        message:
          "is a reference inside another value; a reference must be a " +
          "parameter of its own",
      },
    ]);
  });
});

describe("a value the game decodes", () => {
  /** A facing a level names and the game holds as an object of its own. */
  class Direction {
    static readonly left = new Direction("left", -1);
    static readonly right = new Direction("right", 1);

    private constructor(
      readonly name: string,
      readonly step: number,
    ) {}

    static fromName(name: string): Direction {
      return name === "right" ? Direction.right : Direction.left;
    }
  }

  const FacingParams = defineParams({
    facing: param.custom<Direction>({
      default: "left",
      decode: (value) => Direction.fromName(value as string),
      editor: { kind: "select", options: ["left", "right"] },
    }),
  });

  /** Every value the declaration's own rule was asked about. */
  const asked: JsonValue[] = [];

  const VolumeParams = defineParams({
    volume: param.custom<number>({
      default: 50,
      editor: { kind: "integer", min: 0, max: 100 },
      validate: (value) => {
        asked.push(value);
        return Number(value) % 5 === 0 ? [] : ["must be a multiple of 5"];
      },
      decode: (value) => Number(value) / 100,
    }),
  });

  function volumeReasons(value: JsonValue): string[] {
    return validateParams(VolumeParams, { volume: value }).map(
      (problem) => problem.message,
    );
  }

  it("hands setup() what the codec made of the authored JSON", () => {
    expectTypeOf<ParamsOf<typeof FacingParams>>().toEqualTypeOf<{
      facing: Direction;
    }>();

    const params = decodeParams(FacingParams, { facing: "right" }, NO_REFS);

    expect(params.facing).toBe(Direction.right);
    expect(params.facing.step).toBe(1);
    expect(decodeParams(VolumeParams, { volume: 50 }, NO_REFS).volume).toBe(
      0.5,
    );
  });

  it("checks the control's kind first, and the codec's rule after", () => {
    asked.length = 0;

    expect(volumeReasons(2.5)).toEqual(["must be a whole number"]);
    expect(volumeReasons(120)).toEqual(["must be at most 100"]);
    // The declaration's rule never met a value the control's kind refused, so
    // a check written for a whole number sees only whole numbers.
    expect(asked).toEqual([]);

    expect(volumeReasons(7)).toEqual(["must be a multiple of 5"]);
    expect(volumeReasons(60)).toEqual([]);
    expect(asked).toEqual([7, 60]);
  });

  it("refuses a choice the declaration does not list", () => {
    expect(
      validateParams(FacingParams, { facing: "up" }).map((one) => one.message),
    ).toEqual(['must be one of "left", "right"']);
    expect(validateParams(FacingParams, { facing: "right" })).toEqual([]);
  });

  it("refuses nothing at all where the declaration did not allow it", () => {
    expect(
      validateParams(FacingParams, { facing: null }).map((one) => one.message),
    ).toEqual(['must be one of "left", "right"']);
  });

  it("holds nothing where the declaration allows it, and decodes it so", () => {
    const schema = defineParams({
      facing: param.custom<Direction>({
        default: "left",
        optional: true,
        decode: (value) => Direction.fromName(value as string),
        validate: () => ["was asked about"],
        editor: { kind: "select", options: ["left", "right"] },
      }),
    });

    expectTypeOf<ParamsOf<typeof schema>>().toEqualTypeOf<{
      facing: Direction | undefined;
    }>();
    expect(describeParams(schema)).toEqual([
      {
        name: "facing",
        kind: "custom",
        optional: true,
        editor: "select",
        options: ["left", "right"],
        defaultValue: "left",
      },
    ] satisfies readonly ParamFieldDescription[]);
    // Neither the declaration's own rule nor its codec is asked about the
    // absence of a value: the rule refuses every value it is given, and the
    // codec would make a facing of `null`.
    expect(validateParams(schema, { facing: null })).toEqual([]);
    expect(
      validateParams(schema, { facing: "left" }).map((one) => one.message),
    ).toEqual(["was asked about"]);
    expect(
      decodeParams(schema, { facing: null }, NO_REFS).facing,
    ).toBeUndefined();
  });

  it("describes the control it named, with that control's own members", () => {
    expect(describeParams(FacingParams)).toEqual([
      {
        name: "facing",
        kind: "custom",
        optional: false,
        editor: "select",
        options: ["left", "right"],
        defaultValue: "left",
      },
    ] satisfies readonly ParamFieldDescription[]);
    expect(describeParams(VolumeParams)).toEqual([
      {
        name: "volume",
        kind: "custom",
        optional: false,
        editor: "integer",
        min: 0,
        max: 100,
        defaultValue: 50,
      },
    ] satisfies readonly ParamFieldDescription[]);
  });

  it("takes any JSON when the declaration names no control", () => {
    const schema = defineParams({
      terrain: param.custom<string>({
        default: { seed: 1 },
        decode: (value) => JSON.stringify(value),
      }),
    });

    expect(describeParams(schema)).toEqual([
      {
        name: "terrain",
        kind: "custom",
        optional: false,
        editor: "json",
        defaultValue: { seed: 1 },
      },
    ] satisfies readonly ParamFieldDescription[]);
    expect(validateParams(schema, { terrain: [1, { deep: true }] })).toEqual(
      [],
    );
    expect(
      validateParams(schema, { terrain: null }).map((one) => one.message),
    ).toEqual(["must not be null"]);
    expect({ ...defaultParams(schema) }).toEqual({ terrain: { seed: 1 } });
  });

  it("reports a default its own control refuses", () => {
    const schema = defineParams({
      facing: param.custom<string>({
        default: "up",
        decode: (value) => String(value),
        editor: { kind: "select", options: ["left", "right"] },
      }),
    });

    expect(schemaDefaultProblems(schema)).toEqual([
      {
        path: ["facing"],
        message: 'default must be one of "left", "right"',
      },
    ]);
  });

  it("reports a default the declaration's own rule refuses", () => {
    const schema = defineParams({
      volume: param.custom<number>({
        default: 7,
        editor: { kind: "integer" },
        validate: () => ["must be a multiple of 5"],
        decode: (value) => Number(value),
      }),
    });

    expect(schemaDefaultProblems(schema)).toEqual([
      { path: ["volume"], message: "default must be a multiple of 5" },
    ]);
  });

  it("reports a choice control with nothing to choose from", () => {
    const schema = defineParams({
      facing: param.custom<string>({
        default: "left",
        decode: (value) => String(value),
        editor: { kind: "select", options: [] },
      }),
    });

    expect(schemaDefaultProblems(schema).map((one) => one.message)).toContain(
      "is edited as a choice and lists no values to choose from",
    );
  });

  it("decodes a member with the context the placement was given", () => {
    const schema = defineParams({
      reach: param.custom<number>({
        default: 10,
        editor: { kind: "number" },
        decode: (value, context) => Number(value) * context.worldPose.scale.x,
      }),
    });

    const params = decodeParams(
      schema,
      { reach: 10 },
      {
        ...NO_REFS,
        worldPose: {
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 3, y: 3 },
        },
      },
    );

    expect(params.reach).toBe(30);
  });
});

describe("colour parameters", () => {
  const LampParams = defineParams({
    tint: param.color("#ffcc88"),
    glow: param.color("#f80", { optional: true }),
  });

  function reasons(value: JsonValue): string[] {
    return validateParams(LampParams, { tint: value, glow: null })
      .filter((problem) => problem.path[0] === "tint")
      .map((problem) => problem.message);
  }

  it("decodes both hex shapes to the number a drawing API takes", () => {
    expectTypeOf<ParamsOf<typeof LampParams>>().toEqualTypeOf<{
      tint: number;
      glow: number | undefined;
    }>();

    const params = decodeParams(
      LampParams,
      { tint: "#ff8800", glow: "#f80" },
      NO_REFS,
    );

    expect(params.tint).toBe(0xff8800);
    expect(params.glow).toBe(0xff8800);
    expect(
      decodeParams(LampParams, { tint: "#FF8800", glow: null }, NO_REFS).glow,
    ).toBeUndefined();
  });

  it("accepts three or six hex digits and nothing else", () => {
    expect(reasons("#ff8800")).toEqual([]);
    expect(reasons("#F80")).toEqual([]);

    for (const refused of ["#ff8800ff", 0xff8800, "orange", "ff8800", "#gg0"]) {
      expect(reasons(refused as JsonValue)).toEqual([
        'must be a colour such as "#ff8800"',
      ]);
    }
    expect(reasons(null)).toEqual(['must be a colour such as "#ff8800"']);
  });

  it("says null is a value only where the declaration did", () => {
    expect(validateParams(LampParams, { tint: "#fff", glow: null })).toEqual(
      [],
    );
    expect(
      validateParams(LampParams, { tint: "#fff", glow: "#ff8800ff" }).map(
        (one) => one.message,
      ),
    ).toEqual(['must be a colour such as "#ff8800", or null']);
  });

  it("describes the field and starts a new placement at the declared text", () => {
    expect(describeParams(LampParams)).toEqual([
      {
        name: "tint",
        kind: "color",
        optional: false,
        defaultValue: "#ffcc88",
      },
      { name: "glow", kind: "color", optional: true, defaultValue: "#f80" },
    ] satisfies readonly ParamFieldDescription[]);
    expect({ ...defaultParams(LampParams) }).toEqual({
      tint: "#ffcc88",
      glow: "#f80",
    });
  });

  it("reports a default that is not a colour", () => {
    expect(
      schemaDefaultProblems(defineParams({ tint: param.color("orange") })),
    ).toEqual([
      { path: ["tint"], message: 'default must be a colour such as "#ff8800"' },
    ]);
  });
});
