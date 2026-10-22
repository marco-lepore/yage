import { GenerationSearch, restartAfter } from "./GenerationSearch.js";
import { assertInteger, fail, freezeCopy } from "./internal.js";
import type {
  GenerationOptions,
  Region,
  RegionConnection,
  RegionGraph,
  RegionRequirements,
} from "./types.js";

/**
 * Generates a connected tree with the requested regions, kind counts,
 * forbidden neighbours, degree limit and key requirements. A region that
 * requires keys joins the tree only after the regions granting them.
 */
export class RegionGraphGenerator extends GenerationSearch<RegionGraph> {
  readonly requirements: RegionRequirements;
  constructor(requirements: RegionRequirements, options: GenerationOptions) {
    super(options, restartAfter(requirements.minRegions));
    assertInteger("RegionRequirements minRegions", requirements.minRegions, 1);
    assertInteger(
      "RegionRequirements maxConnections",
      requirements.maxConnections ?? 4,
      1,
    );
    const named = [requirements.start, ...(requirements.required ?? [])];
    const ids = new Set<string>();
    for (const region of named) {
      if (ids.has(region.id)) fail(`duplicate required region "${region.id}"`);
      ids.add(region.id);
    }
    if (requirements.start.requires?.length)
      fail(`start region "${requirements.start.id}" cannot require keys`);
    const grants = new Set(named.flatMap((region) => region.grants ?? []));
    for (const region of named)
      for (const key of region.requires ?? [])
        if (!grants.has(key))
          fail(
            `region "${region.id}" requires key "${key}", which no region grants`,
          );
    const kinds = new Set<string>();
    for (const count of requirements.counts ?? []) {
      const label = `RegionRequirements count "${count.kind}"`;
      if (kinds.has(count.kind)) fail(`duplicate ${label}`);
      kinds.add(count.kind);
      assertInteger(`${label} min`, count.min, 0);
      if (count.max === undefined) continue;
      assertInteger(`${label} max`, count.max, count.min);
      const existing = named.filter((r) => r.kind === count.kind).length;
      if (existing > count.max)
        fail(`${existing} named regions exceed ${label} max ${count.max}`);
    }
    // Fill regions make up whatever the other kinds leave short of
    // minRegions, so their max can rule out every draw.
    const fill = requirements.counts?.find(
      (count) => count.kind === requirements.fillKind,
    );
    if (fill?.max !== undefined) {
      const counted = new Set(requirements.counts!.map((count) => count.kind));
      let others = named.filter(
        (r) => r.kind !== fill.kind && !counted.has(r.kind),
      ).length;
      for (const count of requirements.counts!)
        if (count.kind !== fill.kind)
          others += Math.max(
            count.max ?? count.min,
            named.filter((r) => r.kind === count.kind).length,
          );
      const needed = requirements.minRegions - others;
      if (needed > fill.max)
        fail(
          `reaching ${requirements.minRegions} regions needs at least ${needed} "${fill.kind}" regions, over its max of ${fill.max}`,
        );
    }
    this.requirements = freezeCopy(requirements);
  }
  protected *run(): Generator<void, RegionGraph | null> {
    // Counts with a range are drawn per attempt. A search that fails for one
    // draw proves nothing about the others, so it draws again; only fixed
    // counts can end exhausted.
    const ranged = (this.requirements.counts ?? []).some(
      (count) => count.max !== undefined && count.max > count.min,
    );
    for (;;) {
      const graph = yield* this.attempt();
      if (graph || !ranged) return graph;
      yield;
    }
  }
  private *attempt(): Generator<void, RegionGraph | null> {
    const spec = this.requirements,
      random = this.random;
    const regions: Region[] = [spec.start, ...(spec.required ?? [])];
    const countOf = (kind: string): number =>
      regions.filter((region) => region.kind === kind).length;
    const add = (kind: string): void => {
      let n = 1;
      while (regions.some((region) => region.id === `${kind}:${n}`)) n++;
      regions.push({ id: `${kind}:${n}`, kind });
    };
    for (const count of spec.counts ?? []) {
      const target = random.int(count.min, count.max ?? count.min);
      for (let i = countOf(count.kind); i < target; i++) add(count.kind);
    }
    while (regions.length < spec.minRegions) add(spec.fillKind);
    const fill = spec.counts?.find((count) => count.kind === spec.fillKind);
    // Only a ranged draw can get here; the constructor rules out fixed ones.
    if (fill?.max !== undefined && countOf(fill.kind) > fill.max) {
      return null;
    }
    const placed: Region[] = [spec.start],
      connections: RegionConnection[] = [];
    const forbidden = spec.forbiddenConnections ?? [];
    const allowed = (a: Region, b: Region): boolean =>
      !forbidden.some(
        ([x, y]) =>
          (a.kind === x && b.kind === y) || (a.kind === y && b.kind === x),
      );
    const maxConnections = spec.maxConnections ?? 4;
    const degree = (region: Region): number =>
      connections.filter(
        (edge) => edge.from === region.id || edge.to === region.id,
      ).length;
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
          if (!allowed(parent, region) || degree(parent) >= maxConnections)
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
        }
      return false;
    }
    if (!(yield* search())) return null;
    return { start: spec.start.id, regions, connections };
  }
}
