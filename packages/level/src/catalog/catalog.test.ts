import { AssetHandle, Entity } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { defineLevelAsset, param } from "../params/kinds.js";
import { defineParams } from "../params/schema.js";
import { buildLevelCatalog } from "./build.js";
import { defineLevelEntity, defineLevelProject } from "./declare.js";
import type {
  CatalogError,
  LevelCatalog,
  LevelEntityClass,
  LevelEntityDeclaration,
  PackageContribution,
  ParamsMigration,
} from "./types.js";

const textureAsset = defineLevelAsset({
  kind: "texture",
  create: (path: string) =>
    new AssetHandle<{ pixels: number }>("texture", path),
});

class Crate extends Entity {
  static readonly level = defineLevelEntity({ id: "game.crate", version: 1 });
}

class Barrel extends Entity {
  static readonly level = defineLevelEntity({ id: "game.barrel", version: 1 });
}

/** A subclass with no declaration of its own reads `Crate.level`. */
class HeavyCrate extends Crate {}

class CameraEntity extends Entity {
  static readonly level = defineLevelEntity({ id: "yage.camera", version: 1 });
}

function contribution(
  packageName: string,
  entities: LevelEntityClass[],
): PackageContribution {
  return { packageName, entities };
}

function catalogOrThrow(project: Parameters<typeof buildLevelCatalog>[0]) {
  const result = buildLevelCatalog(project);
  if (!result.ok) {
    throw new Error(`expected a catalog, got ${JSON.stringify(result.errors)}`);
  }
  return result.catalog;
}

function errorsOf(project: Parameters<typeof buildLevelCatalog>[0]) {
  const result = buildLevelCatalog(project);
  if (result.ok) throw new Error("expected the catalog to be rejected");
  return result.errors;
}

function ids(catalog: LevelCatalog): string[] {
  return catalog.entries.map((entry) => entry.id);
}

describe("the level catalog", () => {
  it("lists project entities, then each contribution's", () => {
    const catalog = catalogOrThrow(
      defineLevelProject({
        entities: [Crate, Barrel],
        contributions: [contribution("@yagejs/renderer", [CameraEntity])],
      }),
    );

    expect(ids(catalog)).toEqual(["game.crate", "game.barrel", "yage.camera"]);
    expect(catalog.entries[0]).toMatchObject({
      source: "project",
      EntityClass: Crate,
      declaration: Crate.level,
    });
    expect(catalog.entries[0]?.packageName).toBeUndefined();
    expect(catalog.entries[2]).toMatchObject({
      source: "package",
      packageName: "@yagejs/renderer",
      EntityClass: CameraEntity,
    });
  });

  it("finds an entry by its type id", () => {
    const catalog = catalogOrThrow(defineLevelProject({ entities: [Crate] }));

    expect(catalog.get("game.crate")?.EntityClass).toBe(Crate);
    expect(catalog.get("game.missing")).toBeUndefined();
  });

  it("resolves a type named like an object member as unknown", () => {
    const catalog = catalogOrThrow(defineLevelProject({ entities: [Crate] }));

    for (const typeId of ["toString", "constructor", "__proto__", "valueOf"]) {
      expect(catalog.get(typeId)).toBeUndefined();
    }
  });

  it("carries the contributions it was built from", () => {
    const renderer = contribution("@yagejs/renderer", [CameraEntity]);
    const catalog = catalogOrThrow(
      defineLevelProject({ entities: [], contributions: [renderer] }),
    );

    expect(catalog.contributions).toHaveLength(1);
    expect(catalog.contributions[0]?.packageName).toBe("@yagejs/renderer");
  });

  it("rejects a duplicate type id and builds no partial catalog", () => {
    class OtherCrate extends Entity {
      static readonly level = defineLevelEntity({
        id: "game.crate",
        version: 1,
      });
    }

    expect(
      errorsOf(defineLevelProject({ entities: [Crate, OtherCrate] })),
    ).toEqual([
      {
        entityId: "game.crate",
        message:
          'Entity type "game.crate" is declared by both Crate and OtherCrate.',
      },
    ] satisfies CatalogError[]);
  });

  it("rejects a package entity that collides with a project entity", () => {
    const errors = errorsOf(
      defineLevelProject({
        entities: [CameraEntity],
        contributions: [contribution("@yagejs/renderer", [CameraEntity])],
      }),
    );

    expect(errors).toEqual([
      {
        entityId: "yage.camera",
        message:
          'Entity type "yage.camera" is declared by both CameraEntity and CameraEntity (@yagejs/renderer).',
      },
    ]);
  });

  it("reports an entry that is not a class instead of throwing", () => {
    // An import cycle, or a module that stopped exporting the class, hands
    // this array `undefined` with no type error.
    const missing = undefined as unknown as LevelEntityClass;
    const notAClass = { level: Crate.level } as unknown as LevelEntityClass;

    expect(
      errorsOf(
        defineLevelProject({
          entities: [missing, notAClass],
          contributions: [contribution("@yagejs/renderer", [missing])],
        }),
      ),
    ).toEqual([
      {
        entityId: null,
        message: "Project entity 0 is undefined, not an entity class.",
      },
      {
        entityId: null,
        message: "Project entity 1 is object, not an entity class.",
      },
      {
        entityId: null,
        message:
          'Entity 0 contributed by "@yagejs/renderer" is undefined, not an entity class.',
      },
    ]);
  });

  it("accepts a declaration carrying a parameter schema", () => {
    const CrateParams = defineParams({
      texture: param.asset(textureAsset, "sprites/crate.png"),
    });
    class Box extends Entity {
      static readonly level = defineLevelEntity({
        id: "game.box",
        version: 1,
        params: CrateParams,
      });
    }

    const catalog = catalogOrThrow(defineLevelProject({ entities: [Box] }));
    expect(catalog.get("game.box")?.declaration.params).toBe(CrateParams);
  });

  it("rejects a class whose declaration is inherited", () => {
    expect(errorsOf(defineLevelProject({ entities: [HeavyCrate] }))).toEqual([
      {
        entityId: null,
        message:
          'Entity class "HeavyCrate" has no level declaration of its own.',
      },
    ]);
  });

  it("collects every problem in one pass", () => {
    expect(
      errorsOf(
        defineLevelProject({
          entities: [Crate, HeavyCrate, Crate],
        }),
      ).map((error) => error.entityId),
    ).toEqual([null, "game.crate"]);
  });

  it("names the contributing package when two packages collide", () => {
    const errors = errorsOf(
      defineLevelProject({
        entities: [],
        contributions: [
          contribution("@yagejs/renderer", [CameraEntity]),
          contribution("@yagejs-addons/other", [CameraEntity]),
        ],
      }),
    );

    expect(errors[0]?.message).toBe(
      'Entity type "yage.camera" is declared by both CameraEntity ' +
        "(@yagejs/renderer) and CameraEntity (@yagejs-addons/other).",
    );
  });
});

describe("level declarations", () => {
  /** A class carrying one declaration, so the catalog can be asked about it. */
  function declaring(declaration: LevelEntityDeclaration): LevelEntityClass {
    return class Declared extends Entity {
      static readonly level = declaration;
    };
  }

  function declarationErrors(
    declaration: LevelEntityDeclaration,
  ): readonly CatalogError[] {
    const result = buildLevelCatalog(
      defineLevelProject({ entities: [declaring(declaration)] }),
    );
    return result.ok ? [] : result.errors;
  }

  it("declaring never throws, so an entity module always imports", () => {
    // The failure matrix separates an entity module that throws on import,
    // which locks edits and saves, from an invalid declaration, which is a
    // diagnostic the editor shows while staying editable.
    expect(() => defineLevelEntity({ id: "", version: 0 })).not.toThrow();
    expect(() =>
      defineParams({ bad: param.asset(textureAsset, "") }),
    ).not.toThrow();
  });

  it("reports an empty id", () => {
    expect(declarationErrors({ id: "", version: 1 })[0]?.message).toMatch(
      /has a level declaration with no id/,
    );
  });

  it("reports a version that is not a positive integer", () => {
    for (const version of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        declarationErrors({ id: "game.crate", version })[0]?.message,
      ).toMatch(/needs a positive integer version/);
    }
  });

  it("reports a migration that could never run", () => {
    const migration: ParamsMigration = (params) => params;

    for (const key of ["0", "2", "3", "-1", "01", "1.0", "first"]) {
      const errors = declarationErrors({
        id: "game.crate",
        version: 2,
        migrations: { [key]: migration } as Record<number, ParamsMigration>,
      });
      expect(errors[0]?.message).toMatch(/which never runs/);
      expect(errors[0]?.entityId).toBe("game.crate");
    }
  });

  it("reports a migration that is not a function", () => {
    const errors = declarationErrors({
      id: "game.crate",
      version: 2,
      migrations: { 1: "not a migration" } as unknown as Record<
        number,
        ParamsMigration
      >,
    });

    expect(errors[0]?.message).toMatch(/as string, not a function/);
    expect(errors[0]?.entityId).toBe("game.crate");
  });

  it("reports a parameter default the kind rejects", () => {
    const errors = declarationErrors({
      id: "game.crate",
      version: 1,
      params: defineParams({ texture: param.asset(textureAsset, "../up.png") }),
    });

    expect(errors[0]?.message).toMatch(
      /parameter "texture" default must not contain a "\.\." path segment/,
    );
  });

  it("rejects a parameter kind that did not come from param", () => {
    const lookalike = {
      name: "asset",
      defaultValue: "sprites/crate.png",
      validate: () => {
        throw new Error("the catalog must not call an untrusted validator");
      },
      decode: () => new AssetHandle("texture", "sprites/crate.png"),
      assets: () => [],
    } as unknown as ReturnType<typeof param.asset>;

    const errors = declarationErrors({
      id: "game.crate",
      version: 1,
      params: defineParams({ texture: lookalike }),
    });

    expect(errors).toEqual([
      {
        entityId: "game.crate",
        message:
          'Entity type "game.crate" parameter "texture" kind did not come from param.*.',
      },
    ]);
  });

  it("rejects a copied built-in kind before calling a replaced callback", () => {
    let callbackCalls = 0;
    const copiedKind = {
      ...param.asset(textureAsset, "sprites/crate.png"),
      validate: () => {
        callbackCalls += 1;
        throw new Error("the catalog must not call a copied validator");
      },
    } as ReturnType<typeof param.asset>;

    const errors = declarationErrors({
      id: "game.crate",
      version: 1,
      params: defineParams({ texture: copiedKind }),
    });

    expect(errors).toEqual([
      {
        entityId: "game.crate",
        message:
          'Entity type "game.crate" parameter "texture" kind did not come from param.*.',
      },
    ]);
    expect(callbackCalls).toBe(0);
  });

  it("collects every problem in one declaration", () => {
    const errors = declarationErrors({
      id: "game.crate",
      version: 0,
      migrations: { 9: (params) => params },
      params: defineParams({ texture: param.asset(textureAsset, "") }),
    });

    expect(errors).toHaveLength(3);
  });

  it("keeps the migrations that bridge each version", () => {
    const declaration = defineLevelEntity({
      id: "game.crate",
      version: 3,
      migrations: {
        1: (params) => ({ ...params, speed: 1 }),
        2: (params) => ({ ...params, speed: 2 }),
      },
    });

    expect(Object.keys(declaration.migrations ?? {})).toEqual(["1", "2"]);
    expect(Object.isFrozen(declaration.migrations)).toBe(true);
    expect(declarationErrors(declaration)).toEqual([]);
  });

  it("keeps a migration under the key it was written with", () => {
    const migration: ParamsMigration = (params) => params;
    const declaration = defineLevelEntity({
      id: "game.crate",
      version: 2,
      migrations: { "01": migration } as Record<number, ParamsMigration>,
    });

    // Normalizing "01" to 1 here would make a migration the catalog reports as
    // dead run anyway, and the report and the behaviour would disagree.
    expect(Object.keys(declaration.migrations ?? {})).toEqual(["01"]);
  });

  it("keeps the parameter schema it was given", () => {
    const params = defineParams({});
    expect(
      defineLevelEntity({ id: "game.crate", version: 1, params }).params,
    ).toBe(params);
  });

  it("freezes the declaration", () => {
    expect(Object.isFrozen(Crate.level)).toBe(true);
    expect(() => {
      (Crate.level as { id: string }).id = "game.moved";
    }).toThrow(TypeError);
    expect(() => {
      (Crate.level.migrations as Record<number, ParamsMigration>)[1] = (p) => p;
    }).toThrow(TypeError);
  });

  it("freezes the composed project and the built catalog", () => {
    const renderer = contribution("@yagejs/renderer", [CameraEntity]);
    const project = defineLevelProject({
      entities: [Crate],
      contributions: [renderer],
    });
    const catalog = catalogOrThrow(project);

    for (const frozen of [
      project,
      project.entities,
      project.contributions,
      project.contributions[0],
      project.contributions[0]?.entities,
      catalog,
      catalog.entries,
      catalog.entries[0],
      catalog.contributions,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
    expect(() => {
      (catalog.entries as unknown[]).push("another");
    }).toThrow(TypeError);
  });

  it("reports a contribution that does not name its package", () => {
    expect(
      errorsOf(
        defineLevelProject({
          entities: [],
          contributions: [contribution("", [CameraEntity])],
        }),
      )[0]?.message,
    ).toMatch(/Contribution 0 does not name the package/);
  });

  it("reports a malformed contribution instead of throwing", () => {
    const missing = undefined as unknown as PackageContribution;
    const noEntities = {
      packageName: "@yagejs/renderer",
    } as unknown as PackageContribution;

    // Composition runs while the generated entry module is evaluated, so
    // neither `defineLevelProject` nor the catalog may throw here.
    expect(() =>
      defineLevelProject({
        entities: [],
        contributions: [missing, noEntities],
      }),
    ).not.toThrow();
    expect(
      errorsOf(
        defineLevelProject({
          entities: [],
          contributions: [missing, noEntities],
        }),
      ).map((error) => error.message),
    ).toEqual([
      "Contribution 0 is undefined, not a package contribution.",
      'Contribution "@yagejs/renderer" does not list its entities.',
    ]);
  });

  it("reports a declaration whose migrations or params are the wrong shape", () => {
    const wrong = (declaration: Record<string, unknown>): string | undefined =>
      declarationErrors(declaration as unknown as LevelEntityDeclaration)[0]
        ?.message;

    expect(wrong({ id: "game.crate", version: 1, migrations: "none" })).toMatch(
      /declares migrations as string, not an object/,
    );
    expect(wrong({ id: "game.crate", version: 1, params: {} })).toMatch(
      /did not come from defineParams/,
    );
  });

  it("copies what it composes, so a later mutation cannot change it", () => {
    const contributed: LevelEntityClass[] = [CameraEntity];
    const renderer = contribution("@yagejs/renderer", contributed);
    const entities: LevelEntityClass[] = [Crate];
    const project = defineLevelProject({ entities, contributions: [renderer] });

    entities.push(Barrel);
    contributed.length = 0;

    expect(ids(catalogOrThrow(project))).toEqual(["game.crate", "yage.camera"]);
  });
});
