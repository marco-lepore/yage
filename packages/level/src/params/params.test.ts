import { AssetHandle } from "@yagejs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { JsonObject } from "../document/types.js";
import { defineLevelAsset, param } from "./kinds.js";
import {
  decodeParams,
  defaultParams,
  describeParams,
  defineParams,
  paramAssets,
  schemaDefaultProblems,
  validateParams,
} from "./schema.js";
import type { ParamFieldDescription, ParamsOf } from "./types.js";

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
    expect(() => decodeParams(CrateParams, {})).toThrow(
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

    expect(() => decodeParams(schema, authored("a.png"))).toThrow(
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
