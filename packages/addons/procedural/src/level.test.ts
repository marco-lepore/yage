import { expect, it, vi } from "vitest";
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
  const definition = roomDefinition(),
    layout = new RoomGenerator(definition, { seed: 0 }).generate()!;
  const { scene } = createMockScene();
  expect(() =>
    instantiateRoomLayout(scene, definition, layout, {}, "dungeon", {
      tileWidth: 16,
      tileHeight: 32,
    }),
  ).toThrow("missing prepared level");
  expect(scene.findByKey("dungeon:0/marker")).toBeUndefined();
  expect(() =>
    instantiateRoomLayout(
      scene,
      definition,
      layout,
      { cross: prepared, other: prepared },
      "dungeon",
      {
        tileWidth: NaN,
        tileHeight: 32,
      },
    ),
  ).toThrow("tileWidth");
  expect(scene.findByKey("dungeon:0/marker")).toBeUndefined();
  const instances = instantiateRoomLayout(
    scene,
    definition,
    layout,
    { cross: prepared, other: prepared },
    "dungeon",
    { tileWidth: 16, tileHeight: 32 },
  );
  for (let i = 0; i < instances.length; i++) {
    const marker = instances[i]!.get("marker")!;
    expect(scene.findByKey(`dungeon:${i}/marker`)).toBe(marker);
    expect(marker.get(Transform).position).toMatchObject({
      x: layout.rooms[i]!.x * 16 + 40,
      y: layout.rooms[i]!.y * 32 + 40,
    });
  }
  for (const instance of instances) instance.dispose();
  expect(
    instances.every(
      (instance) => instance.isDisposed && instance.entities.length === 0,
    ),
  ).toBe(true);
});

it.each([undefined, "landmark/entrance"])(
  "rejects occupied later-room keys before setup, with placement key %s",
  (key) => {
    const catalog = buildLevelCatalog(
      defineLevelProject({ entities: [Marker] }),
    );
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
            ...(key === undefined ? {} : { key }),
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
    const definition = roomDefinition();
    const layout = new RoomGenerator(definition, { seed: 0 }).generate()!;
    const { scene } = createMockScene();
    const occupiedKey = `dungeon:${layout.rooms.length - 1}/${key ?? "marker"}`;
    const existing = scene.spawn(Marker, { key: occupiedKey, active: false });
    const setup = vi.spyOn(Marker.prototype, "setup");
    try {
      expect(() =>
        instantiateRoomLayout(
          scene,
          definition,
          layout,
          { cross: prepared, other: prepared },
          "dungeon",
          { tileWidth: 16, tileHeight: 32 },
        ),
      ).toThrow(`scene key "${occupiedKey}" is already occupied`);
      expect(setup).not.toHaveBeenCalled();
      expect([...scene.getEntities()]).toEqual([existing]);
      expect(scene.findByKey(occupiedKey)).toBe(existing);
    } finally {
      setup.mockRestore();
    }
  },
);

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
  const definition = {
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
    instantiateRoomLayout(
      scene,
      definition,
      layout,
      {
        cross: prepareLevel(makeDocument("marker"), catalog.catalog),
        other: prepareLevel(makeDocument("broken"), catalog.catalog),
      },
      "dungeon",
      { tileWidth: 16, tileHeight: 32 },
    );
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
