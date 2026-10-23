import { describe, expect, it } from "vitest";
import { CatalogGenerator } from "./CatalogGenerator.js";
import { RoomGenerator, validateRoomLayout } from "./RoomGenerator.js";
import { isRoomLayoutWalkable, roomOpenings } from "./layout.js";
import { crossRoom, roomDefinition } from "./test-fixtures.js";
import type {
  RoomDefinition,
  RoomGenerationOptions,
  RoomLayout,
} from "./types.js";

/** Every walkable tile of the layout with all keys held. */
function floorTiles(layout: RoomLayout): Set<string> {
  const floor = new Set<string>();
  for (const room of layout.regions)
    for (let y = room.y; y < room.y + room.height; y++)
      for (let x = room.x; x < room.x + room.width; x++)
        if (isRoomLayoutWalkable(layout, { x, y }, () => true))
          floor.add(`${x},${y}`);
  return floor;
}
/** Removes every tile reachable from the first one; the remainder is disconnected. */
function unreachable(floor: Set<string>): number {
  const queue = [floor.values().next().value!];
  floor.delete(queue[0]!);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!.split(",").map(Number) as [number, number];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const key = `${x + dx},${y + dy}`;
      if (floor.delete(key)) queue.push(key);
    }
  }
  return floor.size;
}

describe("RoomGenerator", () => {
  it("realises the graph and connects the actual floor across 100 seeds", () => {
    const definition = roomDefinition(),
      layouts = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const job = new RoomGenerator(definition, { seed }),
        layout = job.generate()!;
      expect(job.status).toBe("succeeded");
      expect(validateRoomLayout(definition, layout)).toEqual([]);
      expect(layout.regions.map((r) => r.id)).toEqual(
        definition.graph.regions.map((r) => r.id),
      );
      expect(layout.connections.map((c) => c.id)).toEqual(["a", "b", "c"]);
      layouts.add(JSON.stringify(layout.regions));
      expect(unreachable(floorTiles(layout))).toBe(0);
    }
    expect(layouts.size).toBeGreaterThan(20);
  });
  it("carries the region's kind and keys on every placed room", () => {
    const base = roomDefinition();
    const definition: RoomDefinition = {
      ...base,
      graph: {
        ...base.graph,
        regions: base.graph.regions.map((r) =>
          r.id === "shop"
            ? { ...r, grants: ["coin"] }
            : r.id === "goal"
              ? { ...r, requires: ["coin"] }
              : r,
        ),
      },
    };
    const layout = new RoomGenerator(definition, { seed: 3 }).generate()!;
    expect(layout.start).toBe("start");
    expect(layout.regions.find((r) => r.id === "shop")).toMatchObject({
      kind: "shop",
      grants: ["coin"],
    });
    expect(layout.regions.find((r) => r.id === "goal")).toMatchObject({
      kind: "goal",
      requires: ["coin"],
    });
  });
  it("selects a two-tile opening at the position required by bounds", () => {
    const a = {
      ...crossRoom,
      id: "a",
      kinds: ["a"],
      size: { width: 7, height: 5 },
      navigation: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
      connections: [
        {
          id: "south",
          side: "south" as const,
          offset: { min: 1, max: 4 },
          width: 2,
        },
      ],
    };
    const b = {
      ...crossRoom,
      id: "b",
      kinds: ["b"],
      connections: [
        { id: "north", side: "north" as const, offset: 1, width: 2 },
      ],
    };
    const definition: RoomDefinition = {
      templates: [a, b],
      graph: {
        start: "a",
        regions: [
          { id: "a", kind: "a" },
          { id: "b", kind: "b" },
        ],
        connections: [{ id: "join", from: "a", to: "b" }],
      },
    };
    const layout = new RoomGenerator(definition, {
      seed: 42,
      bounds: { x: 0, y: 0, width: 7, height: 10 },
    }).generate()!;
    expect(layout).not.toBeNull();
    const edge = layout.connections[0]!;
    expect(edge.fromOpening.width).toBe(2);
    expect(edge.fromOpening.offset).toBeGreaterThanOrEqual(1);
    expect(edge.fromOpening.offset).toBeLessThanOrEqual(3);
    for (let x = 0; x < 7; x++)
      expect(isRoomLayoutWalkable(layout, { x, y: 4 })).toBe(
        x >= edge.fromOpening.offset && x < edge.fromOpening.offset + 2,
      );
    expect(roomOpenings(layout, "b")).toEqual([edge.toOpening]);
  });
  it("places a four-room cycle with an opening pair for every connection", () => {
    const definition: RoomDefinition = {
      ...roomDefinition(),
      graph: {
        start: "a",
        regions: ["a", "b", "c", "d"].map((id) => ({ id, kind: "hall" })),
        connections: [
          { id: "ab", from: "a", to: "b" },
          { id: "bc", from: "b", to: "c" },
          { id: "cd", from: "c", to: "d" },
          { id: "da", from: "d", to: "a" },
        ],
      },
    };
    for (let seed = 0; seed < 10; seed++) {
      const layout = new RoomGenerator(definition, {
        seed,
        maxSteps: 100000,
      }).generate()!;
      expect(layout).not.toBeNull();
      expect(layout.connections).toHaveLength(4);
      expect(validateRoomLayout(definition, layout)).toEqual([]);
    }
  });
  it("treats a room without a mask as walls around an open floor", () => {
    const definition: RoomDefinition = {
      ...roomDefinition(),
      templates: roomDefinition().templates.map((template) => ({
        id: template.id,
        kinds: template.kinds,
        size: { width: 6, height: 4 },
        connections: [
          { id: "n", side: "north" as const, offset: { min: 1, max: 4 } },
          { id: "e", side: "east" as const, offset: { min: 1, max: 2 } },
          { id: "s", side: "south" as const, offset: { min: 1, max: 4 } },
          { id: "w", side: "west" as const, offset: { min: 1, max: 2 } },
        ],
      })),
    };
    for (let seed = 0; seed < 20; seed++) {
      const layout = new RoomGenerator(definition, { seed }).generate()!;
      expect(validateRoomLayout(definition, layout)).toEqual([]);
      expect(layout.regions.every((room) => !room.navigation)).toBe(true);
      const start = layout.regions[0]!;
      expect(
        isRoomLayoutWalkable(layout, { x: start.x + 1, y: start.y + 1 }),
      ).toBe(true);
      expect(isRoomLayoutWalkable(layout, { x: start.x, y: start.y })).toBe(
        false,
      );
      expect(unreachable(floorTiles(layout))).toBe(0);
    }
  });
  it("is independent of frame chunks and copies caller inputs", () => {
    const options = { seed: 72, origin: { x: 1, y: 2 } },
      definition = roomDefinition();
    const one = new RoomGenerator(definition, options),
      many = new RoomGenerator(definition, options);
    options.origin.x = 6;
    while (one.status === "running") one.step(1);
    many.generate();
    expect(one.result).toEqual(many.result);
    expect(one.steps).toBe(many.steps);
    expect(one.result!.regions[0]!.x).toBe(1);
    expect(Object.isFrozen(definition)).toBe(false);
    expect(Object.isFrozen(one.result!.regions[0])).toBe(true);
  });
  it("backtracks into a bounded strip", () => {
    const base = roomDefinition();
    const definition = {
      ...base,
      graph: {
        start: "start",
        regions: base.graph.regions.slice(0, 3),
        connections: base.graph.connections.slice(0, 2),
      },
    };
    const job = new RoomGenerator(definition, {
      seed: 5,
      bounds: { x: 0, y: 0, width: 15, height: 5 },
    });
    expect(job.generate()).not.toBeNull();
    expect(job.result!.regions.map((r) => r.x)).toEqual([0, 5, 10]);
    expect(job.inspect().rejections["bounds"]).toBeGreaterThan(0);
  });
  it("accepts footprints larger than 64 tiles", () => {
    const arena = {
      id: "arena",
      kinds: ["start", "hall", "goal", "shop"],
      size: { width: 96, height: 72 },
      connections: [
        { id: "n", side: "north" as const, offset: { min: 1, max: 94 } },
        { id: "s", side: "south" as const, offset: { min: 1, max: 94 } },
        { id: "e", side: "east" as const, offset: { min: 1, max: 70 } },
        { id: "w", side: "west" as const, offset: { min: 1, max: 70 } },
      ],
    };
    const layout = new RoomGenerator(
      { ...roomDefinition(), templates: [arena] },
      { seed: 0, maxSteps: 200_000 },
    ).generate();
    expect(layout?.regions[0]).toMatchObject({ width: 96, height: 72 });
  });
  it("distinguishes bounded failure, exhaustive rejection and cancellation", () => {
    const budget = new RoomGenerator(roomDefinition(), {
      seed: 0,
      maxSteps: 1,
    });
    expect(budget.generate()).toBeNull();
    expect(budget.status).toBe("budget-exceeded");
    expect(
      budget
        .inspect()
        .diagnostics.some((d) => d.message.includes("does not prove")),
    ).toBe(true);
    expect(
      () =>
        new RoomGenerator(
          {
            ...roomDefinition(),
            rules: { counts: [{ match: { templateId: "cross" }, max: 1 }] },
            templates: [crossRoom],
          },
          { seed: 0 },
        ),
    ).toThrow("at most 1, but at least 4 regions must match");
    expect(
      () =>
        new RoomGenerator(
          {
            ...roomDefinition(),
            rules: { forbiddenConnections: [{ from: {}, to: {} }] },
          },
          { seed: 0 },
        ),
    ).toThrow("no pair of templates the forbidden-connection rules allow");
    // Bounds that hold only the start room: every neighbour falls outside.
    const impossible = new RoomGenerator(roomDefinition(), {
      seed: 0,
      bounds: { x: 0, y: 0, ...crossRoom.size },
    });
    expect(impossible.generate()).toBeNull();
    expect(impossible.status).toBe("exhausted");
    expect(impossible.inspect().rejections["bounds"]).toBeGreaterThan(0);
    const cancelled = new RoomGenerator(roomDefinition(), { seed: 0 });
    cancelled.step(1);
    cancelled.cancel();
    const steps = cancelled.steps;
    cancelled.generate();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.steps).toBe(steps);
  });
  it("validates a saved layout against the current definition", () => {
    const definition = roomDefinition();
    const layout = new RoomGenerator(definition, { seed: 42 }).generate()!;
    const saved = JSON.parse(JSON.stringify(layout)) as RoomLayout;
    expect(validateRoomLayout(definition, saved)).toEqual([]);
    expect(
      validateRoomLayout(definition, {
        ...saved,
        regions: saved.regions.slice(1),
      }),
    ).toContain('Region "start" is missing.');
    expect(
      validateRoomLayout(definition, { ...saved, connections: [] }),
    ).toContain('Connection "a" is missing.');
    expect(
      validateRoomLayout(definition, {
        ...saved,
        regions: saved.regions.map((room) =>
          room.id === "goal" ? { ...room, x: room.x + 1 } : room,
        ),
      }).join(" "),
    ).toMatch(/misaligned|overlap/);
    const edge = saved.connections[0]!;
    expect(
      validateRoomLayout(definition, {
        ...saved,
        connections: [
          { ...edge, fromOpening: { ...edge.fromOpening, width: 3 } },
          ...saved.connections.slice(1),
        ],
      }),
    ).toContain(
      `Connection "${edge.id}" has undeclared or misaligned openings.`,
    );
    // Content changed since the layout was saved.
    const resized: RoomDefinition = {
      ...definition,
      templates: definition.templates.map((t) => ({
        ...t,
        size: { width: 6, height: 5 },
        navigation: ["######", "#....#", "#....#", "#....#", "######"],
      })),
    };
    expect(validateRoomLayout(resized, saved).join(" ")).toContain(
      "does not match its template's footprint",
    );
  });
  it.each([NaN, Infinity, -1, 1.5, 0x1_0000_0000])(
    "rejects invalid seed %s",
    (seed) =>
      expect(() => new RoomGenerator(roomDefinition(), { seed })).toThrow(
        "seed",
      ),
  );
  it.each([
    { seed: 0, maxSteps: 0 },
    { seed: 0, origin: { x: Infinity, y: 0 } },
    { seed: 0, bounds: { x: 0, y: 0, width: 1.5, height: 5 } },
  ] satisfies RoomGenerationOptions[])("validates options %s", (options) =>
    expect(() => new RoomGenerator(roomDefinition(), options)).toThrow(),
  );
  it("rejects disconnected masks, invalid opening ranges and unknown region kinds", () => {
    const base = roomDefinition();
    const invalid: [RoomDefinition, string][] = [
      [
        {
          ...base,
          templates: [
            {
              ...crossRoom,
              navigation: ["#####", "#.#.#", "#.#.#", "#.#.#", "#####"],
            },
          ],
        },
        "connected",
      ],
      [
        {
          ...base,
          templates: [
            {
              ...crossRoom,
              connections: [
                { id: "bad", side: "north", offset: { min: 2, max: 4 } },
              ],
            },
          ],
        },
        "offset max",
      ],
      [
        { ...base, templates: [{ ...crossRoom, kinds: ["missing"] }] },
        "no eligible template",
      ],
    ];
    for (const [definition, message] of invalid)
      expect(() => new RoomGenerator(definition, { seed: 0 })).toThrow(message);
  });
  it("names the catalog rule that rejected candidates during the search", () => {
    // Every connection has an allowed template pair, so the constructor
    // accepts the rules; only the search finds that the count rule needs the
    // pair the forbidden-connection rule rejects.
    const definition: RoomDefinition = {
      ...roomDefinition(),
      rules: {
        counts: [{ match: { templateId: "other" }, min: 4 }],
        forbiddenConnections: [
          { from: { templateId: "other" }, to: { templateId: "other" } },
        ],
      },
    };
    const rooms = new RoomGenerator(definition, { seed: 0 });
    const catalog = new CatalogGenerator(definition, { seed: 0 });
    for (const job of [rooms, catalog]) {
      expect(job.generate()).toBeNull();
      expect(job.status).toBe("exhausted");
      expect(
        job.inspect().diagnostics.find((d) => d.code === "catalog-rule")
          ?.message,
      ).toMatch(
        /^A candidate for "\w+" breaks the forbidden connection \{"templateId":"other"\} to \{"templateId":"other"\} on "\w+"\.$/,
      );
    }
    expect(rooms.inspect().rejections["catalog-rule"]).toBeGreaterThan(0);
  });
});
