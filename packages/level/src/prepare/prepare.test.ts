import { describe, expect, it } from "vitest";
import { AssetHandle, Entity } from "@yagejs/core";
import { buildLevelCatalog } from "../catalog/build.js";
import { defineLevelEntity, defineLevelProject } from "../catalog/declare.js";
import type {
  LevelCatalog,
  LevelEntityClass,
  ParamsMigration,
} from "../catalog/types.js";
import type {
  JsonObject,
  LevelDocument,
  LevelPlacement,
} from "../document/types.js";
import { defineLevelAsset, param } from "../params/kinds.js";
import { defineParams } from "../params/schema.js";
import { levelAssets, prepareLevel, validateLevel } from "./prepare.js";

const textureAsset = defineLevelAsset<string>({
  kind: "texture",
  create: (path) => new AssetHandle<string>("texture", path),
});

const soundAsset = defineLevelAsset<string>({
  kind: "sound",
  create: (path) => new AssetHandle<string>("sound", path),
});

const CrateParams = defineParams({
  texture: param.asset(textureAsset, "sprites/crate.png"),
});

class Crate extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.crate",
    version: 1,
    params: CrateParams,
  });
}

class Marker extends Entity {
  static readonly level = defineLevelEntity({ id: "game.marker", version: 1 });
}

function catalogOf(...entities: LevelEntityClass[]): LevelCatalog {
  const result = buildLevelCatalog(defineLevelProject({ entities }));
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "no catalog");
  return result.catalog;
}

function placement(overrides: Partial<LevelPlacement> = {}): LevelPlacement {
  return {
    id: "p1",
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    params: { texture: "sprites/crate.png" },
    extensions: {},
    ...overrides,
  };
}

function documentOf(...entities: LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities,
    extensions: {},
  };
}

/** An entity class declared without `defineLevelEntity`, for version fixtures. */
function crateAt(
  version: number,
  migrations: Record<number, ParamsMigration>,
): LevelEntityClass {
  return class Versioned extends Entity {
    static readonly level = defineLevelEntity({
      id: "game.crate",
      version,
      params: CrateParams,
      migrations,
    });
  };
}

describe("prepareLevel", () => {
  it("prepares a placement whose type and parameters the catalog accepts", () => {
    const prepared = prepareLevel(documentOf(placement()), catalogOf(Crate));

    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.placements).toHaveLength(1);
    expect(prepared.placements[0]?.entry.id).toBe("game.crate");
    expect(prepared.placements[0]?.assets).toEqual([
      new AssetHandle("texture", "sprites/crate.png"),
    ]);
  });

  it("reports a type the catalog does not declare, and keeps the placement", () => {
    const document = documentOf(placement({ type: "game.ghost" }));

    const prepared = prepareLevel(document, catalogOf(Crate));

    expect(prepared.placements).toEqual([]);
    expect(prepared.diagnostics).toEqual([
      {
        code: "unknown-type",
        placementId: "p1",
        path: [],
        message: 'Entity type "game.ghost" is not in this project\'s catalog.',
      },
    ]);
    expect(prepared.document.entities).toHaveLength(1);
  });

  it("reports a missing parameter with the path that names it", () => {
    const prepared = prepareLevel(
      documentOf(placement({ params: {} })),
      catalogOf(Crate),
    );

    expect(prepared.diagnostics).toEqual([
      {
        code: "parameter-invalid",
        placementId: "p1",
        path: ["texture"],
        message: 'Parameter "texture" is required and is missing.',
      },
    ]);
  });

  it("reports a parameter the declaration does not have", () => {
    const prepared = prepareLevel(
      documentOf(
        placement({ params: { texture: "sprites/crate.png", speed: 4 } }),
      ),
      catalogOf(Crate),
    );

    expect(prepared.diagnostics).toEqual([
      {
        code: "parameter-invalid",
        placementId: "p1",
        path: ["speed"],
        message: 'Parameter "speed" is not a declared parameter.',
      },
    ]);
  });

  it("reports every parameter a placement gets wrong at once", () => {
    const prepared = prepareLevel(
      documentOf(placement({ params: { texture: "", speed: 4 } })),
      catalogOf(Crate),
    );

    expect(prepared.diagnostics.map((entry) => entry.path)).toEqual([
      ["speed"],
      ["texture"],
    ]);
  });

  it("reports a value the parameter's own kind rejects", () => {
    const prepared = prepareLevel(
      documentOf(placement({ params: { texture: "..\\crate.png" } })),
      catalogOf(Crate),
    );

    expect(prepared.diagnostics[0]?.message).toContain("backslashes");
    expect(prepared.diagnostics[0]?.code).toBe("parameter-invalid");
  });

  it("rejects a placement authored against a version newer than the declaration", () => {
    const prepared = prepareLevel(
      documentOf(placement({ typeVersion: 3 })),
      catalogOf(Crate),
    );

    expect(prepared.placements).toEqual([]);
    expect(prepared.diagnostics[0]?.message).toContain(
      "This level is newer than the game",
    );
    expect(prepared.diagnostics[0]?.code).toBe("migration-failed");
  });

  it("accepts a declaration with no parameters", () => {
    const prepared = prepareLevel(
      documentOf(placement({ type: "game.marker", params: {} })),
      catalogOf(Marker),
    );

    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.placements[0]?.assets).toEqual([]);
  });

  it("rejects parameters authored for a declaration that has none", () => {
    const prepared = prepareLevel(
      documentOf(placement({ type: "game.marker", params: { speed: 1 } })),
      catalogOf(Marker),
    );

    expect(prepared.diagnostics).toEqual([
      {
        code: "parameter-invalid",
        placementId: "p1",
        path: ["speed"],
        message: 'Parameter "speed" is not a declared parameter.',
      },
    ]);
  });
});

describe("prepareLevel migrations", () => {
  const renameToTexture: ParamsMigration = (params) => ({
    texture: params["image"] as string,
  });

  it("runs each declared migration up to the declaration's version", () => {
    const catalog = catalogOf(
      crateAt(3, {
        1: (params) => ({ image: params["sprite"] as string }),
        2: renameToTexture,
      }),
    );

    const prepared = prepareLevel(
      documentOf(placement({ params: { sprite: "sprites/crate.png" } })),
      catalog,
    );

    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.document.entities[0]?.params).toEqual({
      texture: "sprites/crate.png",
    });
    expect(prepared.document.entities[0]?.typeVersion).toBe(3);
  });

  it("starts from the version the placement was authored against", () => {
    const catalog = catalogOf(
      crateAt(3, {
        1: () => {
          throw new Error("version 1 migration must not run");
        },
        2: renameToTexture,
      }),
    );

    const prepared = prepareLevel(
      documentOf(
        placement({ typeVersion: 2, params: { image: "sprites/crate.png" } }),
      ),
      catalog,
    );

    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.placements[0]?.placement.typeVersion).toBe(3);
  });

  it("reports a gap in the declared migrations", () => {
    const prepared = prepareLevel(
      documentOf(placement()),
      catalogOf(crateAt(3, { 2: renameToTexture })),
    );

    expect(prepared.diagnostics[0]?.message).toBe(
      '"game.crate" declares no migration from type version 1 to 2.',
    );
    expect(prepared.diagnostics[0]?.code).toBe("migration-failed");
  });

  it("keeps the authored parameters when a migration throws", () => {
    const prepared = prepareLevel(
      documentOf(placement({ params: { image: "sprites/crate.png" } })),
      catalogOf(
        crateAt(3, {
          1: renameToTexture,
          2: () => {
            throw new Error("no");
          },
        }),
      ),
    );

    expect(prepared.placements).toEqual([]);
    expect(prepared.diagnostics[0]?.message).toBe(
      "The migration from type version 2 failed: no",
    );
    expect(prepared.document.entities[0]?.params).toEqual({
      image: "sprites/crate.png",
    });
    expect(prepared.document.entities[0]?.typeVersion).toBe(1);
  });

  it("rejects a migration that returns something JSON cannot store", () => {
    const cases: readonly [string, unknown][] = [
      ["a Map", new Map()],
      ["a Date", new Date()],
      ["an array", []],
      ["null", null],
      ["nothing", undefined],
      ["a nested Date", { texture: new Date() }],
      ["a nested function", { texture: () => "x" }],
    ];

    for (const [label, returned] of cases) {
      const prepared = prepareLevel(
        documentOf(placement()),
        catalogOf(crateAt(2, { 1: () => returned as JsonObject })),
      );

      expect(prepared.placements, label).toEqual([]);
      expect(prepared.diagnostics[0]?.message, label).toContain(
        "The migration from type version 1 returned",
      );
    }
  });

  it("names the class a migration returned instead of a parameter object", () => {
    const prepared = prepareLevel(
      documentOf(placement()),
      catalogOf(crateAt(2, { 1: () => new Map() as unknown as JsonObject })),
    );

    expect(prepared.diagnostics[0]?.message).toBe(
      "The migration from type version 1 returned a Map, not a parameter object.",
    );
  });

  it("names the path inside a migration's return that is not JSON", () => {
    const prepared = prepareLevel(
      documentOf(placement()),
      catalogOf(
        crateAt(2, {
          1: () => ({ texture: new Date() }) as unknown as JsonObject,
        }),
      ),
    );

    expect(prepared.diagnostics[0]?.message).toContain("params.texture");
  });

  it("keeps the authored parameters when a migration rewrites its argument and then throws", () => {
    const prepared = prepareLevel(
      documentOf(placement({ params: { texture: "sprites/crate.png" } })),
      catalogOf(
        crateAt(2, {
          1: (params) => {
            (params as Record<string, unknown>)["texture"] = "clobbered";
            (params as Record<string, unknown>)["extra"] = true;
            throw new Error("half way");
          },
        }),
      ),
    );

    expect(prepared.placements).toEqual([]);
    expect(prepared.document.entities[0]?.params).toEqual({
      texture: "sprites/crate.png",
    });
    expect(prepared.document.entities[0]?.typeVersion).toBe(1);
  });

  it("hands each migration a copy, so rewriting its argument changes nothing", () => {
    const document = documentOf(placement());
    const prepared = prepareLevel(
      document,
      catalogOf(
        crateAt(2, {
          1: (params) => {
            (params as Record<string, unknown>)["texture"] =
              "sprites/other.png";
            return { texture: "sprites/crate.png" };
          },
        }),
      ),
    );

    expect(prepared.diagnostics).toEqual([]);
    expect(document.entities[0]?.params).toEqual({
      texture: "sprites/crate.png",
    });
  });
});

describe("prepareLevel immutability", () => {
  it("leaves the document it was given untouched", () => {
    const document = documentOf(
      placement({ params: { image: "sprites/crate.png" } }),
    );
    const before = structuredClone(document);

    prepareLevel(
      document,
      catalogOf(
        crateAt(2, {
          1: (params) => ({ texture: params["image"] as string }),
        }),
      ),
    );

    expect(document).toEqual(before);
  });

  it("does not freeze objects the caller still holds", () => {
    const params: Record<string, unknown> = { texture: "sprites/crate.png" };
    const document = documentOf(
      placement({ params: params as unknown as JsonObject }),
    );

    prepareLevel(document, catalogOf(Crate));

    expect(() => {
      params["texture"] = "sprites/other.png";
    }).not.toThrow();
  });

  it("freezes the result all the way down", () => {
    const prepared = prepareLevel(documentOf(placement()), catalogOf(Crate));
    const first = prepared.placements[0];

    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.document)).toBe(true);
    expect(Object.isFrozen(prepared.document.entities)).toBe(true);
    expect(Object.isFrozen(prepared.document.entities[0])).toBe(true);
    expect(Object.isFrozen(prepared.document.entities[0]?.params)).toBe(true);
    expect(Object.isFrozen(prepared.document.entities[0]?.transform)).toBe(
      true,
    );
    expect(Object.isFrozen(prepared.placements)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.assets)).toBe(true);
    expect(Object.isFrozen(prepared.diagnostics)).toBe(true);
  });

  it("freezes each diagnostic and its path, whichever check produced it", () => {
    const prepared = prepareLevel(
      documentOf(
        placement({ id: "a", params: {} }),
        placement({ id: "b", type: "game.ghost" }),
      ),
      catalogOf(Crate),
    );

    expect(prepared.diagnostics).toHaveLength(2);
    for (const entry of prepared.diagnostics) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.path)).toBe(true);
    }
  });

  it("keeps a parameter named __proto__ as an ordinary key", () => {
    const params = JSON.parse(
      '{"texture":"sprites/crate.png","__proto__":{"x":1}}',
    ) as JsonObject;

    const prepared = prepareLevel(
      documentOf(placement({ params })),
      catalogOf(Crate),
    );

    expect(prepared.diagnostics).toEqual([
      {
        code: "parameter-invalid",
        placementId: "p1",
        path: ["__proto__"],
        message: 'Parameter "__proto__" is not a declared parameter.',
      },
    ]);
  });
});

describe("prepareLevel asset derivation", () => {
  it("reports a descriptor that does not return a handle", () => {
    const broken = defineLevelAsset<string>({
      kind: "texture",
      create: () => undefined as unknown as AssetHandle<string>,
    });
    class Broken extends Entity {
      static readonly level = defineLevelEntity({
        id: "game.crate",
        version: 1,
        params: defineParams({
          texture: param.asset(broken, "sprites/crate.png"),
        }),
      });
    }

    const prepared = prepareLevel(documentOf(placement()), catalogOf(Broken));

    expect(prepared.placements).toEqual([]);
    expect(prepared.diagnostics[0]?.message).toContain(
      "Deriving assets failed",
    );
    expect(prepared.diagnostics[0]?.code).toBe("asset-derivation-failed");
  });
});

describe("levelAssets", () => {
  class Sounded extends Entity {
    static readonly level = defineLevelEntity({
      id: "game.sounded",
      version: 1,
      params: defineParams({
        texture: param.asset(textureAsset, "sprites/crate.png"),
        sound: param.asset(soundAsset, "sfx/hit.wav"),
      }),
    });
  }

  it("returns one handle per loader type and path, in first-use order", () => {
    const prepared = prepareLevel(
      documentOf(
        placement({ id: "a", params: { texture: "sprites/b.png" } }),
        placement({ id: "b", params: { texture: "sprites/a.png" } }),
        placement({ id: "c", params: { texture: "sprites/b.png" } }),
      ),
      catalogOf(Crate),
    );

    expect(levelAssets(prepared).map((handle) => handle.path)).toEqual([
      "sprites/b.png",
      "sprites/a.png",
    ]);
  });

  it("keeps two loader types that share one path apart", () => {
    const prepared = prepareLevel(
      documentOf(
        placement({
          type: "game.sounded",
          params: { texture: "shared/asset", sound: "shared/asset" },
        }),
      ),
      catalogOf(Sounded),
    );

    expect(levelAssets(prepared).map((handle) => handle.type)).toEqual([
      "texture",
      "sound",
    ]);
  });

  it("returns nothing for a level whose placements all failed", () => {
    const prepared = prepareLevel(
      documentOf(placement({ type: "game.ghost" })),
      catalogOf(Crate),
    );

    expect(levelAssets(prepared)).toEqual([]);
  });
});

describe("validateLevel", () => {
  it("reports exactly what preparation reports", () => {
    const document = documentOf(placement({ params: {} }));
    const catalog = catalogOf(Crate);

    expect(validateLevel(document, catalog)).toEqual(
      prepareLevel(document, catalog).diagnostics,
    );
  });

  it("says nothing about a level that prepares cleanly", () => {
    expect(validateLevel(documentOf(placement()), catalogOf(Crate))).toEqual(
      [],
    );
  });
});
