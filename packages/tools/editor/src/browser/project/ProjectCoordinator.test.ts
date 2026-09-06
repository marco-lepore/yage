import type { AssetHandle } from "@yagejs/core";
import {
  defineLevelAsset,
  defineLevelEntity,
  defineParams,
  param,
  type LevelEntityClass,
  type PackageContribution,
} from "@yagejs/level";
import { describe, expect, it } from "vitest";
import { ProjectCoordinator } from "./ProjectCoordinator.js";

/**
 * The catalog checks that an entry is a class carrying its own `level`
 * declaration, so a test class needs no engine base class to be catalogued.
 */
function entityClass(id: string): LevelEntityClass {
  return class Placeable {
    static level = defineLevelEntity({ id, version: 1 });
    readonly placed = true;
  } as unknown as LevelEntityClass;
}

function contribution(
  packageName: string,
  ...ids: readonly string[]
): PackageContribution {
  return { packageName, entities: ids.map(entityClass) };
}

const textureDescriptor = defineLevelAsset({
  kind: "texture",
  create: (path: string) => ({ type: "texture", path }) as AssetHandle<unknown>,
});

const soundDescriptor = defineLevelAsset({
  kind: "sound",
  create: (path: string) => ({ type: "sound", path }) as AssetHandle<unknown>,
});

function withParams(
  id: string,
  params: ReturnType<typeof defineParams>,
): LevelEntityClass {
  return class Placeable {
    static level = defineLevelEntity({ id, version: 1, params });
    readonly placed = true;
  } as unknown as LevelEntityClass;
}

describe("ProjectCoordinator", () => {
  it("builds a catalog from the project's own entities", () => {
    const coordinator = new ProjectCoordinator();
    const result = coordinator.initialize({
      project: { entities: [entityClass("game.crate")] },
      contributions: [],
    });

    expect(result.ok).toBe(true);
    expect(coordinator.current.catalog?.get("game.crate")?.source).toBe(
      "project",
    );
  });

  it("adds the entities a package contributes", () => {
    const coordinator = new ProjectCoordinator();
    const result = coordinator.initialize({
      project: { entities: [entityClass("game.crate")] },
      contributions: [contribution("@yagejs/tilemap", "tilemap.layer")],
    });

    expect(result.ok).toBe(true);
    const entry = coordinator.current.catalog?.get("tilemap.layer");
    expect(entry?.source).toBe("package");
    expect(entry?.packageName).toBe("@yagejs/tilemap");
  });

  it("says nothing when everything declared is usable", () => {
    const coordinator = new ProjectCoordinator();
    const result = coordinator.initialize({
      project: { entities: [entityClass("game.crate")] },
      contributions: [contribution("@yagejs/tilemap", "tilemap.layer")],
    });

    expect(result.ok && result.diagnostics).toEqual([]);
  });

  it("reports a declaration the catalog refuses and keeps no catalog", () => {
    const coordinator = new ProjectCoordinator();
    const duplicate = entityClass("game.crate");
    const result = coordinator.initialize({
      project: { entities: [duplicate, entityClass("game.crate")] },
      contributions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.diagnostics.some((one) => one.code === "catalog-invalid"),
    ).toBe(true);
    expect(coordinator.current.catalog).toBeUndefined();
  });

  describe("inspectable", () => {
    const texture = defineLevelAsset({
      kind: "texture",
      create: (path: string) =>
        ({ type: "texture", path }) as AssetHandle<unknown>,
    });

    function crateClass(): LevelEntityClass {
      return class Crate {
        static level = defineLevelEntity({
          id: "game.crate",
          version: 2,
          params: defineParams({
            texture: param.asset(texture, "sprites/crate.png"),
            shadow: param.asset(texture, "sprites/shadow.png"),
          }),
        });
        readonly placed = true;
      } as unknown as LevelEntityClass;
    }

    it("describes a type's fields as plain data, in declaration order", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: { entities: [crateClass()] },
        contributions: [],
      });

      // What React receives: names, kinds, and defaults. No schema object,
      // validator, decoder, entity class, or asset factory.
      expect(coordinator.inspectable("game.crate")).toEqual({
        typeId: "game.crate",
        fields: [
          {
            name: "texture",
            kind: "asset",
            assetKind: "texture",
            defaultValue: "sprites/crate.png",
          },
          {
            name: "shadow",
            kind: "asset",
            assetKind: "texture",
            defaultValue: "sprites/shadow.png",
          },
        ],
      });
    });

    it("gives a type with no parameters an empty field list", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: { entities: [entityClass("game.wall")] },
        contributions: [],
      });

      expect(coordinator.inspectable("game.wall")).toEqual({
        typeId: "game.wall",
        fields: [],
      });
    });

    it("has nothing for a type the catalog does not have, or before it builds", () => {
      const coordinator = new ProjectCoordinator();
      expect(coordinator.inspectable("game.crate")).toBeUndefined();
      coordinator.initialize({
        project: { entities: [crateClass()] },
        contributions: [],
      });
      expect(coordinator.inspectable("game.absent")).toBeUndefined();
    });
  });

  describe("placeables", () => {
    it("lists nothing before a catalog builds", () => {
      expect(new ProjectCoordinator().placeables).toEqual([]);
    });

    it("says where each type came from, for the Actors panel to show", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: { entities: [entityClass("game.crate")] },
        contributions: [contribution("@yagejs/tilemap", "tilemap.layer")],
      });

      expect(coordinator.placeables).toEqual([
        { typeId: "game.crate", source: "project" },
        {
          typeId: "tilemap.layer",
          source: "package",
          packageName: "@yagejs/tilemap",
        },
      ]);
    });

    it("carries the first texture parameter's default as the thumbnail", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: {
          entities: [
            withParams(
              "game.crate",
              defineParams({
                hum: param.asset(soundDescriptor, "audio/hum.mp3"),
                sprite: param.asset(textureDescriptor, "sprites/crate.png"),
                shadow: param.asset(textureDescriptor, "sprites/shadow.png"),
              }),
            ),
          ],
        },
        contributions: [],
      });

      // The sound is skipped and the second texture is not reached: nothing
      // marks which parameter is the art, so the first texture is the rule.
      expect(coordinator.placeables).toEqual([
        {
          typeId: "game.crate",
          source: "project",
          thumbnail: "sprites/crate.png",
        },
      ]);
    });

    it("finds the texture past a parameter whose default is not a path", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: {
          entities: [
            withParams(
              "game.slime",
              defineParams({
                speed: param.number(40),
                awake: param.boolean(true),
                sprite: param.asset(textureDescriptor, "sprites/slime.png"),
              }),
            ),
          ],
        },
        contributions: [],
      });

      expect(coordinator.placeables[0]?.thumbnail).toBe("sprites/slime.png");
    });

    it("takes no thumbnail from a type whose parameters are all plain", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: {
          entities: [
            withParams("game.slime", defineParams({ speed: param.number(40) })),
          ],
        },
        contributions: [],
      });

      expect(coordinator.placeables[0]?.thumbnail).toBeUndefined();
    });

    it("leaves out the thumbnail for a type with no texture parameter", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: {
          entities: [
            entityClass("game.wall"),
            withParams(
              "game.chime",
              defineParams({
                hum: param.asset(soundDescriptor, "audio/hum.mp3"),
              }),
            ),
          ],
        },
        contributions: [],
      });

      expect(coordinator.placeables.map((type) => type.thumbnail)).toEqual([
        undefined,
        undefined,
      ]);
    });

    it("carries the texture parameter's declared frame grid, when it has one", () => {
      const coordinator = new ProjectCoordinator();
      coordinator.initialize({
        project: {
          entities: [
            withParams(
              "game.torch",
              defineParams({
                sprite: param.asset(textureDescriptor, "sprites/torch.png", {
                  frameWidth: 48,
                }),
              }),
            ),
            withParams(
              "game.crate",
              defineParams({
                sprite: param.asset(textureDescriptor, "sprites/crate.png"),
              }),
            ),
          ],
        },
        contributions: [],
      });

      expect(coordinator.placeables).toEqual([
        {
          typeId: "game.torch",
          source: "project",
          thumbnail: "sprites/torch.png",
          thumbnailFrames: { frameWidth: 48 },
        },
        {
          typeId: "game.crate",
          source: "project",
          thumbnail: "sprites/crate.png",
        },
      ]);
      expect(
        Object.hasOwn(coordinator.placeables[1] as object, "thumbnailFrames"),
      ).toBe(false);
    });
  });
});
