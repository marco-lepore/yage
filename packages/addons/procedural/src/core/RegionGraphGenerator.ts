import { createRandomService } from "@yagejs/core";
import { GenerationSearch } from "./GenerationSearch.js";
import { assertInteger, fail, freezeCopy, id } from "./geometry.js";
import { validateRegionGraph } from "./progression.js";
import type {
  GenerationOptions,
  Region,
  RegionConnection,
  RegionGraph,
  RegionRequirements,
} from "./types.js";

/** Generates a connected tree satisfying counts, forbidden neighbours and reusable key requirements. */
export class RegionGraphGenerator extends GenerationSearch<RegionGraph> {
  readonly requirements: RegionRequirements;
  constructor(requirements: RegionRequirements, options: GenerationOptions) {
    super(options);
    assertInteger(
      "RegionGraphGenerator minRegions",
      requirements.minRegions,
      1,
      64,
    );
    assertInteger(
      "RegionGraphGenerator maxConnections",
      requirements.maxConnections ?? 4,
      1,
      63,
    );
    id(requirements.fillKind, "fillKind");
    const named = [requirements.start, ...(requirements.required ?? [])];
    assertInteger("RegionGraphGenerator required regions", named.length, 1, 64);
    const ids = new Set<string>();
    for (const region of named) {
      id(region.id, "required region id");
      id(region.kind, "required region kind");
      if (ids.has(region.id)) fail(`duplicate required region "${region.id}"`);
      ids.add(region.id);
      for (const key of [...(region.grants ?? []), ...(region.requires ?? [])])
        id(key, "region key");
    }
    const kinds = new Set<string>();
    let total = named.length;
    for (const count of requirements.counts ?? []) {
      id(count.kind, "count kind");
      if (kinds.has(count.kind)) fail(`duplicate count kind "${count.kind}"`);
      kinds.add(count.kind);
      assertInteger(`count ${count.kind} min`, count.min, 0, 64);
      assertInteger(
        `count ${count.kind} max`,
        count.max ?? count.min,
        count.min,
        64,
      );
      const existing = named.filter(
        (region) => region.kind === count.kind,
      ).length;
      if (existing > (count.max ?? count.min))
        fail(`required regions exceed count maximum for "${count.kind}"`);
      total += Math.max(0, (count.max ?? count.min) - existing);
    }
    assertInteger(
      "RegionGraphGenerator maximum region count",
      Math.max(total, requirements.minRegions),
      1,
      64,
    );
    for (const pair of requirements.forbiddenConnections ?? []) {
      if (pair.length !== 2) fail("forbiddenConnections needs pairs of kinds");
      pair.forEach((kind) => id(kind, "forbidden kind"));
    }
    const grants = new Set(named.flatMap((region) => region.grants ?? []));
    for (const region of named)
      for (const key of region.requires ?? [])
        if (!grants.has(key))
          fail(`region "${region.id}" requires unknown key "${key}"`);
    this.requirements = freezeCopy(requirements);
  }
  protected *run(): Generator<void, RegionGraph | null> {
    const random = createRandomService(this.seed),
      spec = this.requirements;
    const regions: Region[] = [spec.start, ...(spec.required ?? [])];
    const add = (kind: string): void => {
      let n = 1;
      while (regions.some((region) => region.id === `${kind}:${n}`)) n++;
      regions.push({ id: `${kind}:${n}`, kind });
    };
    for (const count of spec.counts ?? []) {
      const existing = regions.filter(
        (region) => region.kind === count.kind,
      ).length;
      const target = random.int(
        Math.max(count.min, existing),
        count.max ?? count.min,
      );
      for (let i = existing; i < target; i++) add(count.kind);
    }
    while (regions.length < spec.minRegions) add(spec.fillKind);
    // Minimum filler counts also obey explicitly configured maxima.
    for (const count of spec.counts ?? [])
      if (
        regions.filter((region) => region.kind === count.kind).length >
        (count.max ?? count.min)
      ) {
        this.diagnostics.push({
          code: "count",
          message: `Filling minRegions exceeds the maximum for "${count.kind}".`,
        });
        return null;
      }
    const placed: Region[] = [spec.start],
      connections: RegionConnection[] = [];
    const allowed = (a: Region, b: Region): boolean =>
      !(spec.forbiddenConnections ?? []).some(
        ([x, y]) =>
          (a.kind === x && b.kind === y) || (a.kind === y && b.kind === x),
      );
    const max = spec.maxConnections ?? 4;
    function* search(): Generator<void, boolean> {
      if (placed.length === regions.length) return true;
      const keys = new Set(placed.flatMap((region) => region.grants ?? []));
      const pending = random.shuffle(
        regions.filter(
          (region) =>
            !placed.includes(region) &&
            (region.requires ?? []).every((key) => keys.has(key)),
        ),
      );
      for (const region of pending)
        for (const parent of random.shuffle([...placed])) {
          yield;
          if (
            !allowed(parent, region) ||
            connections.filter(
              (edge) => edge.from === parent.id || edge.to === parent.id,
            ).length >= max
          )
            continue;
          placed.push(region);
          connections.push({
            id: `connection:${connections.length + 1}`,
            from: parent.id,
            to: region.id,
          });
          if (yield* search()) return true;
          placed.pop();
          connections.pop();
          yield;
        }
      return false;
    }
    if ((spec.start.requires ?? []).length || !(yield* search())) return null;
    const graph = { start: spec.start.id, regions, connections };
    const errors = validateRegionGraph(graph);
    if (errors.length) fail(errors.join("; "));
    return graph;
  }
}
