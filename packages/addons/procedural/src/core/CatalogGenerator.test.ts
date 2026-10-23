import { describe, expect, it } from "vitest";
import {
  CatalogGenerator,
  validateCatalogSelection,
} from "./CatalogGenerator.js";
import { RoomGenerator, validateRoomLayout } from "./RoomGenerator.js";
import { isRoomLayoutWalkable } from "./layout.js";
import { RegionGraphGenerator } from "./RegionGraphGenerator.js";
import {
  crossRoom,
  dungeonRequirements,
  roomDefinition,
} from "./test-fixtures.js";
import type {
  CatalogDefinition,
  CatalogSelection,
  RoomDefinition,
  RoomLayout,
} from "./types.js";

const ports = [{ id: "door", capacity: 4 }];
function catalog(): CatalogDefinition {
  return {
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
        kind: "shop",
        templateId: "shop",
        variantId: "healing",
        metadata: { music: "market", stock: "potions" },
        tags: ["merchant", "healing"],
      });
      expect(selection.regions.find((r) => r.id === "b")!.variantId).toBe(
        "weapons",
      );
      expect(validateCatalogSelection(definition, selection)).toEqual([]);
      expect(selection.start).toBe("entry");
      expect(selection.connections.map((c) => c.id)).toEqual([
        "ea",
        "af",
        "eb",
      ]);
      expect(selection.regions.some((r) => "x" in r)).toBe(false);
    }
  });
  it("selects from a room catalog without placing anything", () => {
    const definition = roomDefinition();
    const selection = new CatalogGenerator(definition, { seed: 5 }).generate()!;
    expect(selection.regions.map((r) => r.templateId).sort()).toEqual(
      expect.arrayContaining(["cross"]),
    );
    expect(selection.regions.some((r) => "x" in r || "width" in r)).toBe(false);
    expect(validateCatalogSelection(definition, selection)).toEqual([]);
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
      "is invalid",
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
    // Region "b" can only be "weapons" through regionIds, so the rule leaves it nothing.
    expect(
      () =>
        new CatalogGenerator(
          {
            ...definition,
            rules: {
              ...definition.rules,
              regions: [{ regionId: "b", match: { variantId: "healing" } }],
            },
          },
          { seed: 0 },
        ),
    ).toThrow('region "b" has no eligible template');
  });
  it("uses weights for preference without excluding lower-weight candidates", () => {
    const definition: CatalogDefinition = {
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
  it("caps a template's uses across its variants with a count rule", () => {
    const base = catalog();
    const capped: CatalogDefinition = {
      ...base,
      rules: { counts: [{ match: { templateId: "shop" }, max: 1 }] },
    };
    // Both shop regions can only use "shop", so no selection meets the cap.
    expect(() => new CatalogGenerator(capped, { seed: 0 })).toThrow(
      'count rule {"templateId":"shop"}: at most 1, but at least 2 regions must match',
    );
    const withStall: CatalogDefinition = {
      ...capped,
      templates: [
        ...base.templates,
        { id: "stall", kinds: ["shop"], connections: ports },
      ],
    };
    for (let seed = 0; seed < 10; seed++)
      expect(
        new CatalogGenerator(withStall, { seed })
          .generate()!
          .regions.filter((r) => r.templateId === "shop"),
      ).toHaveLength(1);
  });
  it("copies inputs, is chunk-independent and freezes its result", () => {
    const definition = catalog(),
      input = { ...definition, templates: [...definition.templates] };
    const one = new CatalogGenerator(input, { seed: 20 }),
      many = new CatalogGenerator(input, { seed: 20 });
    input.templates.length = 0;
    while (one.status === "running") one.step(1);
    many.generate();
    expect(one.result).toEqual(many.result);
    expect(one.steps).toBe(many.steps);
    expect(Object.isFrozen(one.result!.regions[1]!.metadata)).toBe(true);
  });
  it("validates a saved selection against the current definition", () => {
    const definition = catalog();
    const selection = new CatalogGenerator(definition, { seed: 3 }).generate()!;
    const saved = JSON.parse(JSON.stringify(selection)) as CatalogSelection;
    expect(validateCatalogSelection(definition, saved)).toEqual([]);
    const tampered = (
      change: (region: CatalogSelection["regions"][number]) => object,
    ): CatalogSelection => ({
      ...saved,
      regions: saved.regions.map((r) =>
        r.id === "a" ? { ...r, ...change(r) } : r,
      ),
    });
    for (const selectionWithError of [
      tampered(() => ({ metadata: { tampered: true } })),
      tampered(() => ({ variantId: "missing" })),
      tampered(() => ({ kind: "forge" })),
      tampered(() => ({ grants: ["gold"] })),
    ])
      expect(validateCatalogSelection(definition, selectionWithError)).toEqual([
        'Region "a" does not match an eligible template or variant.',
      ]);
    expect(
      validateCatalogSelection(definition, { ...saved, connections: [] }),
    ).toEqual([
      'Connection "ea" is missing.',
      'Connection "af" is missing.',
      'Connection "eb" is missing.',
    ]);
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
    // Knowable before any search: no template carries the tag.
    expect(
      () =>
        new CatalogGenerator(
          {
            ...catalog(),
            rules: { counts: [{ match: { tags: ["missing"] }, min: 1 }] },
          },
          { seed: 0 },
        ),
    ).toThrow(
      'no selection can meet the count rule {"tags":["missing"]}: at least 1, but at most 0 regions can match',
    );
    // Knowable before any search: the entry only ever connects to shops.
    expect(
      () =>
        new CatalogGenerator(
          {
            ...catalog(),
            rules: {
              forbiddenConnections: [
                { from: { kind: "entry" }, to: { kind: "shop" } },
              ],
            },
          },
          { seed: 0 },
        ),
    ).toThrow(
      'connection "ea" has no pair of templates the forbidden-connection rules allow',
    );
    // Found by the search: the entry has two neighbours but one slot.
    const base = catalog();
    const impossible = new CatalogGenerator(
      {
        ...base,
        templates: base.templates.map((entry) =>
          entry.id === "entry"
            ? { ...entry, connections: [{ id: "only" }] }
            : entry,
        ),
      },
      { seed: 0 },
    );
    expect(impossible.generate()).toBeNull();
    expect(impossible.status).toBe("exhausted");
    expect(
      validateCatalogSelection(
        {
          ...catalog(),
          // The saved selection put the healing shop next to the entry.
          rules: {
            forbiddenConnections: [
              { from: { tags: ["healing"] }, to: { kind: "entry" } },
            ],
          },
        },
        new CatalogGenerator(catalog(), { seed: 0 }).generate()!,
      ),
    ).toEqual([
      'The selection breaks the forbidden connection {"tags":["healing"]} to {"kind":"entry"} on "ea".',
    ]);
  });
  it.each([0, -1, NaN, Infinity])(
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
  it("rejects invalid capacity, rule references and duplicate variants", () => {
    const base = catalog();
    expect(
      () =>
        new CatalogGenerator(
          {
            ...base,
            templates: base.templates.map((entry) => ({
              id: entry.id,
              kinds: entry.kinds,
              connections: [{ id: "x", capacity: NaN }],
            })),
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
            rules: { counts: [{ match: { templateId: "inn" }, min: 1 }] },
          },
          { seed: 0 },
        ),
    ).toThrow('unknown template "inn"');
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
    ).toThrow("duplicate");
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
      expect(layout!.regions).toHaveLength(15);
      expect(validateRoomLayout(definition, layout!)).toEqual([]);
    },
  );

  function spatial(): RoomDefinition {
    return {
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
  it("backtracks variants during placement and keeps the selected geometry", () => {
    const definition = spatial();
    const job = new RoomGenerator(definition, {
      seed: 0,
      maxSteps: 100_000,
      bounds: { x: 0, y: 0, width: 10, height: 5 },
    });
    const layout = job.generate()!;
    expect(layout).not.toBeNull();
    expect(layout.regions.map((r) => r.variantId)).toEqual(["small", "small"]);
    expect(layout.regions.map((r) => r.metadata["theme"])).toEqual([
      "intact",
      "intact",
    ]);
    expect(layout.regions[0]!.navigation).toEqual(crossRoom.navigation);
    expect(isRoomLayoutWalkable(layout, { x: 4, y: 2 })).toBe(true);
    expect(job.inspect().rejections["bounds"]).toBeGreaterThan(0);
    expect(validateRoomLayout(definition, layout)).toEqual([]);
    const relabelled: RoomLayout = {
      ...layout,
      regions: layout.regions.map((r) => ({
        ...r,
        variantId: "large",
        metadata: { theme: "ruined" },
      })),
    };
    expect(validateRoomLayout(definition, relabelled).join(" ")).toContain(
      "footprint",
    );
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
    expect(layout.regions[0]!.width).toBe(7);
    expect(layout.connections[0]!.fromOpening.areaId).toBe("east");
    expect(layout.regions[0]!.navigation).toBeUndefined();
    expect(layout.regions[1]!.navigation).toEqual(crossRoom.navigation);
    expect(validateRoomLayout(definition, layout)).toEqual([]);
  });
  it("rejects non-finite metadata at construction", () => {
    const base = catalog();
    expect(
      () =>
        new CatalogGenerator(
          {
            ...base,
            templates: base.templates.map((entry) =>
              entry.id === "forge"
                ? { ...entry, metadata: { cost: [1, NaN] } }
                : entry,
            ),
          },
          { seed: 0 },
        ),
    ).toThrow('template "forge" metadata.cost[1]: finite number required');
  });
});
