import { describe, expect, it } from "vitest";
import { CatalogGenerator } from "./CatalogGenerator.js";
import {
  resolveCatalogEntry,
  resolveRoomTemplate,
  validateCatalogSelection,
} from "./catalog.js";
import { RoomGenerator } from "./RoomGenerator.js";
import { isRoomLayoutWalkable, validateRoomLayout } from "./layout.js";
import { RegionGraphGenerator } from "./RegionGraphGenerator.js";
import { crossRoom, dungeonRequirements } from "./test-fixtures.js";
import type {
  CatalogDefinition,
  CatalogMetadata,
  RoomDefinition,
} from "./types.js";

const ports = [{ id: "door", capacity: 4 }];
function catalog(): CatalogDefinition {
  return {
    id: "town",
    revision: "1",
    graph: {
      start: "entry",
      regions: [
        { id: "entry", kind: "entry" },
        { id: "a", kind: "shop" },
        { id: "forge", kind: "forge" },
        { id: "b", kind: "shop" },
      ],
      connections: [
        { id: "ea", from: "entry", to: "a" },
        { id: "af", from: "a", to: "forge" },
        { id: "eb", from: "entry", to: "b" },
      ],
    },
    templates: [
      { id: "entry", kinds: ["entry"], connections: ports },
      { id: "forge", kinds: ["forge"], connections: ports },
      {
        id: "shop",
        kinds: ["shop"],
        connections: ports,
        metadata: { music: "market", stock: "none" },
        tags: ["merchant"],
        variants: [
          {
            id: "weapons",
            weight: 1000,
            metadata: { stock: "weapons" },
            tags: ["weapons"],
          },
          {
            id: "healing",
            weight: 0.001,
            metadata: { stock: "potions", merchant: { name: "apothecary" } },
            tags: ["healing"],
          },
        ],
      },
    ],
    rules: {
      counts: [{ match: { tags: ["healing"] }, min: 1, max: 1 }],
      forbiddenConnections: [
        { from: { tags: ["weapons"] }, to: { kind: "forge" } },
      ],
    },
  };
}
describe("CatalogGenerator", () => {
  it("satisfies hard variant rules across seeds without any spatial data", () => {
    for (let seed = 0; seed < 40; seed++) {
      const definition = catalog(),
        job = new CatalogGenerator(definition, { seed });
      const selection = job.generate()!;
      expect(job.status).toBe("succeeded");
      expect(selection.regions.find((r) => r.id === "a")).toMatchObject({
        templateId: "shop",
        variantId: "healing",
        metadata: { music: "market", stock: "potions" },
        tags: ["merchant", "healing"],
      });
      expect(selection.regions.find((r) => r.id === "b")!.variantId).toBe(
        "weapons",
      );
      expect(validateCatalogSelection(definition, selection)).toEqual([]);
      expect(selection.connections).toHaveLength(3);
      expect(selection.regions.some((r) => "x" in r)).toBe(false);
    }
  });
  it("allows optional size without opening coordinates and resolves selected data", () => {
    const base = catalog();
    const definition = {
      ...base,
      templates: base.templates.map((entry) => ({
        ...entry,
        size: { width: 12, height: 8 },
      })),
    };
    const selection = new CatalogGenerator(definition, { seed: 5 }).generate()!;
    const selected = selection.regions.find((r) => r.id === "a")!;
    expect(resolveCatalogEntry(definition, selected)).toMatchObject({
      size: { width: 12, height: 8 },
      metadata: { stock: "potions" },
      connections: ports,
    });
    expect(() => resolveRoomTemplate(definition, selected)).toThrow("spatial");
  });
  it("backtracks when the preferred variant lacks sufficient connection capacity", () => {
    const base = catalog();
    const definition: CatalogDefinition = {
      ...base,
      templates: base.templates.map((entry) =>
        entry.id === "entry"
          ? {
              ...entry,
              variants: [
                {
                  id: "small",
                  weight: 1_000_000,
                  connections: [{ id: "door" }],
                },
                {
                  id: "large",
                  weight: 0.001,
                  connections: [{ id: "door", capacity: 2 }],
                },
              ],
            }
          : entry,
      ),
    };
    const selection = new CatalogGenerator(definition, { seed: 0 }).generate()!;
    expect(selection.regions[0]!.variantId).toBe("large");
    expect(validateCatalogSelection(definition, selection)).toEqual([]);
    const impossible = new CatalogGenerator(
      {
        ...definition,
        templates: definition.templates.map((entry) =>
          entry.id === "entry"
            ? { ...entry, variants: entry.variants!.slice(0, 1) }
            : entry,
        ),
      },
      { seed: 0 },
    );
    expect(impossible.generate()).toBeNull();
    expect(impossible.status).toBe("exhausted");
  });
  it("supports cycles with matched sockets and detects exhausted capacities in saved selections", () => {
    const definition: CatalogDefinition = {
      id: "cycle",
      revision: "1",
      templates: [
        {
          id: "portal",
          kinds: ["portal"],
          connections: [{ id: "link", socket: "portal", capacity: 2 }],
        },
      ],
      graph: {
        start: "a",
        regions: ["a", "b", "c"].map((id) => ({ id, kind: "portal" })),
        connections: [
          { id: "ab", from: "a", to: "b" },
          { id: "bc", from: "b", to: "c" },
          { id: "ca", from: "c", to: "a" },
        ],
      },
    };
    const selection = new CatalogGenerator(definition, { seed: 0 }).generate()!;
    expect(selection.connections).toHaveLength(3);
    expect(validateCatalogSelection(definition, selection)).toEqual([]);
    const limited = {
      ...definition,
      templates: [
        {
          ...definition.templates[0]!,
          connections: [{ id: "link", socket: "portal" }],
        },
      ],
    };
    expect(validateCatalogSelection(limited, selection).join(" ")).toContain(
      "connection",
    );
    const mismatch = {
      ...definition,
      templates: [
        {
          id: "a",
          kinds: ["portal"],
          connections: [{ id: "a", socket: "a", capacity: 2 }],
        },
        {
          id: "b",
          kinds: ["portal"],
          connections: [{ id: "b", socket: "b", capacity: 2 }],
        },
      ],
      rules: {
        regions: [
          { regionId: "a", match: { templateId: "a" } },
          { regionId: "b", match: { templateId: "b" } },
        ],
      },
    };
    const job = new CatalogGenerator(mismatch, { seed: 0 });
    expect(job.generate()).toBeNull();
    expect(job.status).toBe("exhausted");
  });
  it("supports per-region restrictions and rejects contradictory rules", () => {
    const base = catalog();
    const templates = base.templates.map((entry) =>
      entry.id === "shop"
        ? {
            ...entry,
            variants: entry.variants!.map((variant) => ({
              ...variant,
              regionIds: [variant.id === "healing" ? "a" : "b"],
            })),
          }
        : entry,
    );
    const definition: CatalogDefinition = {
      ...base,
      templates,
      rules: {
        ...base.rules,
        regions: [{ regionId: "a", match: { variantId: "healing" } }],
      },
    };
    expect(
      new CatalogGenerator(definition, { seed: 0 }).generate(),
    ).not.toBeNull();
    const job = new CatalogGenerator(
      {
        ...definition,
        rules: {
          ...definition.rules,
          regions: [{ regionId: "b", match: { variantId: "healing" } }],
        },
      },
      { seed: 0 },
    );
    expect(job.generate()).toBeNull();
    expect(job.status).toBe("exhausted");
  });
  it("uses weights for preference without excluding lower-weight candidates", () => {
    const definition: CatalogDefinition = {
      id: "weight",
      revision: "1",
      graph: {
        start: "shop",
        regions: [{ id: "shop", kind: "shop" }],
        connections: [],
      },
      templates: [
        {
          id: "shop",
          kinds: ["shop"],
          connections: [],
          variants: [
            { id: "common", weight: 9 },
            { id: "rare", weight: 1 },
          ],
        },
      ],
    };
    let common = 0;
    for (let seed = 0; seed < 200; seed++)
      if (
        new CatalogGenerator(definition, { seed }).generate()!.regions[0]!
          .variantId === "common"
      )
        common++;
    expect(common).toBeGreaterThan(150);
    expect(common).toBeLessThan(200);
  });
  it("counts usage across variants of an entry", () => {
    const job = new CatalogGenerator(
      { ...catalog(), maxUses: { shop: 1 } },
      { seed: 0 },
    );
    expect(job.generate()).toBeNull();
    expect(job.status).toBe("exhausted");
  });
  it("copies inputs, is chunk-independent, and restores frozen resolved metadata", () => {
    const definition = catalog(),
      input = { ...definition, templates: [...definition.templates] };
    const one = new CatalogGenerator(input, { seed: 20 }),
      many = new CatalogGenerator(input, { seed: 20 });
    input.templates.length = 0;
    while (one.status === "running") one.step(1);
    many.generate();
    expect(one.result).toEqual(many.result);
    expect(one.steps).toBe(many.steps);
    const snapshot = one.snapshot(),
      restored = CatalogGenerator.restore(
        JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
      );
    expect(restored.snapshot()).toEqual(snapshot);
    expect(Object.isFrozen(restored.result!.regions[1]!.metadata)).toBe(true);
    expect(() =>
      CatalogGenerator.restore({
        ...snapshot,
        selection: {
          ...snapshot.selection,
          regions: snapshot.selection.regions.map((r) => ({
            ...r,
            metadata: { tampered: true },
          })),
        },
      }),
    ).toThrow("metadata");
    expect(() =>
      CatalogGenerator.restore({
        ...snapshot,
        selection: {
          ...snapshot.selection,
          regions: snapshot.selection.regions.map((r) => ({
            ...r,
            variantId: "missing",
          })),
        },
      }),
    ).toThrow("variant");
    expect(() =>
      CatalogGenerator.restore({
        ...snapshot,
        selection: { ...snapshot.selection, connections: [] },
      }),
    ).toThrow("connection");
  });
  it("distinguishes budgets, cancellation and unsatisfied hard rules", () => {
    const job = new CatalogGenerator(catalog(), { seed: 0, maxSteps: 1 });
    expect(job.generate()).toBeNull();
    expect(job.status).toBe("budget-exceeded");
    const cancelled = new CatalogGenerator(catalog(), { seed: 0 });
    cancelled.step(1);
    cancelled.cancel();
    expect(cancelled.generate()).toBeNull();
    expect(cancelled.status).toBe("cancelled");
    expect(() => cancelled.snapshot()).toThrow("completed");
    const impossible = new CatalogGenerator(
      {
        ...catalog(),
        rules: { counts: [{ match: { tags: ["missing"] }, min: 1 }] },
      },
      { seed: 0 },
    );
    expect(impossible.generate()).toBeNull();
    expect(impossible.status).toBe("exhausted");
  });
  it.each([0, -1, NaN, Infinity, 1_000_001])(
    "rejects invalid weight %s at construction",
    (weight) => {
      const base = catalog();
      expect(
        () =>
          new CatalogGenerator(
            {
              ...base,
              templates: base.templates.map((entry) => ({ ...entry, weight })),
            },
            { seed: 0 },
          ),
      ).toThrow("weight");
    },
  );
  it("rejects invalid metadata, capacity, rule references and duplicate variants", () => {
    const base = catalog();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const metadata of [
      { n: Infinity },
      { n: undefined },
      { fn: () => 1 },
      { date: new Date() },
      cycle,
    ])
      expect(
        () =>
          new CatalogGenerator(
            {
              ...base,
              templates: base.templates.map((entry) => ({
                ...entry,
                metadata: metadata as CatalogMetadata,
              })),
            },
            { seed: 0 },
          ),
      ).toThrow("metadata");
    expect(
      () =>
        new CatalogGenerator(
          {
            ...base,
            templates: base.templates.map(
              (entry) =>
                ({
                  ...entry,
                  connections: [{ id: "x", capacity: NaN }],
                  variants: undefined,
                }) as unknown as typeof entry,
            ),
          },
          { seed: 0 },
        ),
    ).toThrow("capacity");
    expect(
      () =>
        new CatalogGenerator(
          { ...base, rules: { regions: [{ regionId: "unknown", match: {} }] } },
          { seed: 0 },
        ),
    ).toThrow("unknown region");
    expect(
      () =>
        new CatalogGenerator(
          {
            ...base,
            templates: base.templates.map((entry) => ({
              ...entry,
              variants: [{ id: "same" }, { id: "same" }],
            })),
          },
          { seed: 0 },
        ),
    ).toThrow("duplicate variant");
  });
});

describe("spatial catalog variants", () => {
  it.each([9, 627078])(
    "places a fifteen-room variant catalog within its budget for seed %s",
    (seed) => {
      const graph = new RegionGraphGenerator(
        {
          ...dungeonRequirements,
          start: { id: "start", kind: "entrance" },
          fillKind: "encounter",
        },
        { seed },
      ).generate()!;
      const definition: RoomDefinition = {
        id: "catalog-dungeon",
        revision: "1",
        graph,
        templates: [
          ["entry", "entrance"],
          ["hall", "encounter"],
          ["shop", "shop"],
          ["forge", "forge"],
          ["treasure", "treasure"],
          ["boss", "boss"],
        ].map(([id, kind]) => ({
          id: id!,
          kinds: [kind!],
          size: { width: 9, height: 7 },
          navigation: [
            "#########",
            ...Array<string>(5).fill("#.......#"),
            "#########",
          ],
          connections: [
            { id: "north", side: "north", offset: { min: 2, max: 6 } },
            { id: "south", side: "south", offset: { min: 2, max: 6 } },
            { id: "east", side: "east", offset: { min: 2, max: 4 } },
            { id: "west", side: "west", offset: { min: 2, max: 4 } },
          ],
          ...(id === "hall"
            ? {
                variants: [
                  { id: "stone", weight: 3 },
                  { id: "moss", weight: 1, tags: ["moss"] },
                ],
              }
            : id === "shop"
              ? {
                  variants: [
                    { id: "weapons", weight: 4 },
                    { id: "healing", weight: 1, tags: ["healing"] },
                  ],
                }
              : {}),
        })),
        rules: {
          counts: [
            { match: { tags: ["healing"] }, min: 1 },
            { match: { tags: ["moss"] }, min: 2, max: 5 },
          ],
        },
      };
      const job = new RoomGenerator(definition, { seed, maxSteps: 5_000 });
      const layout = job.generate();
      expect(job.status).toBe("succeeded");
      expect(layout!.rooms).toHaveLength(15);
      expect(validateRoomLayout(definition, layout!)).toEqual([]);
    },
  );

  it("accepts geometry supplied entirely by a variant", () => {
    const definition: CatalogDefinition = {
      id: "variant-only",
      revision: "1",
      graph: {
        start: "a",
        regions: [{ id: "a", kind: "hall" }],
        connections: [],
      },
      templates: [
        {
          id: "room",
          kinds: ["hall"],
          connections: [],
          variants: [
            {
              id: "small",
              size: crossRoom.size,
              connections: crossRoom.connections,
              navigation: crossRoom.navigation!,
            },
          ],
        },
      ],
    };
    const layout = new RoomGenerator(definition, { seed: 0 }).generate()!;
    expect(layout.rooms[0]).toMatchObject({
      variantId: "small",
      width: 5,
      height: 5,
    });
    expect(validateRoomLayout(definition, layout)).toEqual([]);
  });
  function spatial(): RoomDefinition {
    return {
      id: "variants",
      revision: "1",
      graph: {
        start: "a",
        regions: [
          { id: "a", kind: "hall" },
          { id: "b", kind: "hall" },
        ],
        connections: [{ id: "ab", from: "a", to: "b" }],
      },
      templates: [
        {
          ...crossRoom,
          variants: [
            {
              id: "large",
              weight: 1_000_000,
              size: { width: 7, height: 5 },
              navigation: null,
              metadata: { theme: "ruined" },
            },
            { id: "small", weight: 0.001, metadata: { theme: "intact" } },
          ],
        },
      ],
    };
  }
  it("backtracks variants during placement and snapshots the actual selected geometry", () => {
    const definition = spatial();
    const job = new RoomGenerator(definition, {
      seed: 0,
      maxSteps: 100_000,
      bounds: { x: 0, y: 0, width: 10, height: 5 },
    });
    const layout = job.generate()!;
    expect(layout).not.toBeNull();
    expect(layout.rooms.map((r) => r.variantId)).toEqual(["small", "small"]);
    expect(layout.rooms.map((r) => r.metadata.theme)).toEqual([
      "intact",
      "intact",
    ]);
    expect(layout.validation.connectedWalkableCells).toBe(true);
    expect(isRoomLayoutWalkable(definition, layout, { x: 4, y: 2 })).toBe(true);
    expect(job.inspect().rejections.bounds).toBeGreaterThan(0);
    expect(validateRoomLayout(definition, layout)).toEqual([]);
    const snapshot = job.snapshot();
    expect(
      RoomGenerator.restore(
        JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
      ).snapshot(),
    ).toEqual(snapshot);
    expect(() =>
      RoomGenerator.restore({
        ...snapshot,
        layout: {
          ...layout,
          rooms: layout.rooms.map((r) => ({
            ...r,
            variantId: "large",
            metadata: { theme: "ruined" },
          })),
        },
      }),
    ).toThrow("geometry");
  });
  it("enforces catalog rules in spatial mode and resolves overridden masks and ports", () => {
    const base = spatial();
    const definition: RoomDefinition = {
      ...base,
      rules: {
        counts: [{ match: { variantId: "large" }, min: 1, max: 1 }],
        regions: [{ regionId: "b", match: { variantId: "small" } }],
      },
      templates: [
        {
          ...base.templates[0]!,
          variants: [
            {
              ...base.templates[0]!.variants![0]!,
              connections: [{ id: "east", side: "east", offset: 2 }],
            },
            base.templates[0]!.variants![1]!,
          ],
        },
      ],
    };
    const layout = new RoomGenerator(definition, { seed: 0 }).generate()!;
    expect(layout.rooms[0]!.width).toBe(7);
    expect(layout.connections[0]!.fromOpening.areaId).toBe("east");
    expect(layout.validation.connectedWalkableCells).toBeNull();
    expect(
      resolveRoomTemplate(definition, layout.rooms[0]!).navigation,
    ).toBeUndefined();
    expect(validateRoomLayout(definition, layout)).toEqual([]);
  });
});
