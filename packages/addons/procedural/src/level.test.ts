import { expect, it } from "vitest";
import { createMockScene, Entity, Transform } from "@yagejs/core";
import {
  buildLevelCatalog,
  defineLevelEntity,
  defineLevelProject,
  prepareLevel,
} from "@yagejs/level";
import type { LevelDocument } from "@yagejs/level";
import { RoomGenerator } from "./core/RoomGenerator.js";
import { roomDefinition } from "./core/test-fixtures.js";
import type { RoomDefinition } from "./core/types.js";
import { instantiateRoomLayout, RoomLayoutLoadError } from "./level.js";
class Marker extends Entity {
  static readonly level = defineLevelEntity({ id: "marker", version: 1 });
  setup(): void {
    this.add(new Transform());
  }
}
it("loads existing authored levels at room offsets and preserves per-instance keys and cleanup", () => {
  const catalog = buildLevelCatalog(defineLevelProject({ entities: [Marker] }));
  if (!catalog.ok) throw new Error("test catalog failed");
  const document: LevelDocument = {
    format: "yage-level",
    version: 1,
    id: "room",
    metadata: {},
    extensions: {},
    entities: [
      {
        id: "marker",
        type: "marker",
        typeVersion: 1,
        active: true,
        transform: {
          position: { x: 40, y: 40 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
        params: {},
        extensions: {},
      },
    ],
  };
  const prepared = prepareLevel(document, catalog.catalog);
  const layout = new RoomGenerator(roomDefinition(), {
    seed: 0,
  }).generate()!;
  const { scene } = createMockScene();
  const options = {
    levels: { cross: prepared, other: prepared },
    namespace: "dungeon",
    tileWidth: 16,
    tileHeight: 32,
  };
  expect(() =>
    instantiateRoomLayout(scene, layout, {
      ...options,
      levels: { cross: prepared },
    }),
  ).toThrow('no prepared level for template "other"');
  expect(scene.findByKey("dungeon:0/marker")).toBeUndefined();
  const refused = prepareLevel(
    {
      ...document,
      entities: [{ ...document.entities[0]!, type: "missing" }],
    },
    catalog.catalog,
  );
  expect(refused.diagnostics.length).toBeGreaterThan(0);
  expect(() =>
    instantiateRoomLayout(scene, layout, {
      ...options,
      levels: { cross: prepared, other: refused },
    }),
  ).toThrow('prepared level for template "other" has');
  expect(scene.findByKey("dungeon:0/marker")).toBeUndefined();
  expect(() =>
    instantiateRoomLayout(scene, layout, { ...options, namespace: "" }),
  ).toThrow("namespace must not be empty");
  for (const tileWidth of [NaN, 0, -16])
    expect(() =>
      instantiateRoomLayout(scene, layout, { ...options, tileWidth }),
    ).toThrow("tileWidth");
  expect(scene.findByKey("dungeon:0/marker")).toBeUndefined();
  const instances = instantiateRoomLayout(scene, layout, options);
  for (let i = 0; i < instances.length; i++) {
    const marker = instances[i]!.get("marker")!;
    expect(scene.findByKey(`dungeon:${i}/marker`)).toBe(marker);
    expect(marker.get(Transform).position).toMatchObject({
      x: layout.regions[i]!.x * 16 + 40,
      y: layout.regions[i]!.y * 32 + 40,
    });
  }
  for (const instance of instances) instance.dispose();
  expect(
    instances.every(
      (instance) => instance.isDisposed && instance.entities.length === 0,
    ),
  ).toBe(true);
});

it("stops at a room whose scene key is taken and hands back the rooms loaded before it", () => {
  const catalog = buildLevelCatalog(defineLevelProject({ entities: [Marker] }));
  if (!catalog.ok) throw new Error("test catalog failed");
  const prepared = prepareLevel(
    {
      format: "yage-level",
      version: 1,
      id: "room",
      metadata: {},
      extensions: {},
      entities: [
        {
          id: "marker",
          type: "marker",
          typeVersion: 1,
          active: true,
          transform: {
            position: { x: 40, y: 40 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
          params: {},
          extensions: {},
        },
      ],
    },
    catalog.catalog,
  );
  const layout = new RoomGenerator(roomDefinition(), {
    seed: 0,
  }).generate()!;
  const { scene } = createMockScene();
  const existing = scene.spawn(Marker, { key: "dungeon:1/marker" });
  let failure: RoomLayoutLoadError | undefined;
  try {
    instantiateRoomLayout(scene, layout, {
      levels: { cross: prepared, other: prepared },
      namespace: "dungeon",
      tileWidth: 16,
      tileHeight: 32,
    });
  } catch (error) {
    if (!(error instanceof RoomLayoutLoadError)) throw error;
    failure = error;
  }
  expect(failure?.roomId).toBe(layout.regions[1]!.id);
  expect(String((failure?.cause as Error).message)).toContain(
    "dungeon:1/marker",
  );
  expect(failure?.instances).toHaveLength(1);
  expect(scene.findByKey("dungeon:0/marker")).toBe(
    failure!.instances[0]!.get("marker"),
  );
  expect(scene.findByKey("dungeon:1/marker")).toBe(existing);
});

it("preserves earlier handles and stops loading when a room's setup throws", () => {
  class BrokenMarker extends Entity {
    static readonly level = defineLevelEntity({ id: "broken", version: 1 });
    setup(): void {
      throw new Error("broken room setup");
    }
  }
  const catalog = buildLevelCatalog(
    defineLevelProject({ entities: [Marker, BrokenMarker] }),
  );
  if (!catalog.ok) throw new Error("test catalog failed");
  const makeDocument = (type: string): LevelDocument => ({
    format: "yage-level",
    version: 1,
    id: type,
    metadata: {},
    extensions: {},
    entities: [
      {
        id: "marker",
        type,
        typeVersion: 1,
        active: true,
        transform: {
          position: { x: 40, y: 40 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
        params: {},
        extensions: {},
      },
    ],
  });
  const definition: RoomDefinition = {
    ...roomDefinition(),
    templates: [
      { ...roomDefinition().templates[0]!, kinds: ["good"] },
      { ...roomDefinition().templates[1]!, kinds: ["bad"] },
    ],
    graph: {
      start: "start",
      regions: [
        { id: "start", kind: "good" },
        { id: "bad", kind: "bad" },
        { id: "later", kind: "good" },
      ],
      connections: [
        { id: "a", from: "start", to: "bad" },
        { id: "b", from: "bad", to: "later" },
      ],
    },
  };
  const layout = new RoomGenerator(definition, { seed: 0 }).generate()!;
  const { scene } = createMockScene();
  let failure: RoomLayoutLoadError | undefined;
  try {
    instantiateRoomLayout(scene, layout, {
      levels: {
        cross: prepareLevel(makeDocument("marker"), catalog.catalog),
        other: prepareLevel(makeDocument("broken"), catalog.catalog),
      },
      namespace: "dungeon",
      tileWidth: 16,
      tileHeight: 32,
    });
  } catch (error) {
    if (!(error instanceof RoomLayoutLoadError)) throw error;
    failure = error;
  }
  expect(failure?.roomId).toBe("bad");
  expect(failure?.cause).toBeInstanceOf(Error);
  expect(failure?.instances).toHaveLength(1);
  expect(scene.findByKey("dungeon:0/marker")).toBeDefined();
  expect(scene.findByKey("dungeon:2/marker")).toBeUndefined();
  const prior = failure!.instances[0]!;
  prior.dispose();
  expect(prior.entities).toHaveLength(0);
});
