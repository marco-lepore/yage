import { assertInteger, fail, freezeCopy, id } from "./geometry.js";
import type { RegionGraph } from "./types.js";

function structureErrors(graph: RegionGraph): string[] {
  assertInteger("RegionGraph regions", graph.regions.length, 1, 64);
  assertInteger("RegionGraph connections", graph.connections.length, 0, 256);
  const errors: string[] = [];
  const regions = new Set<string>();
  const grants = new Set<string>();
  for (const region of graph.regions) {
    id(region.id, "region id");
    id(region.kind, `region ${region.id} kind`);
    if (regions.has(region.id)) errors.push(`Duplicate region "${region.id}".`);
    regions.add(region.id);
    for (const key of [...(region.grants ?? []), ...(region.requires ?? [])])
      id(key, `region ${region.id} key`);
    for (const key of region.grants ?? []) grants.add(key);
  }
  if (!regions.has(graph.start))
    errors.push(`Unknown start region "${graph.start}".`);
  const edges = new Set<string>(),
    pairs = new Set<string>();
  for (const edge of graph.connections) {
    id(edge.id, "connection id");
    if (edges.has(edge.id)) errors.push(`Duplicate connection "${edge.id}".`);
    edges.add(edge.id);
    const pair = JSON.stringify([edge.from, edge.to].sort());
    if (
      !regions.has(edge.from) ||
      !regions.has(edge.to) ||
      edge.from === edge.to ||
      pairs.has(pair)
    )
      errors.push(
        `Connection "${edge.id}" has unknown, repeated or identical endpoints.`,
      );
    pairs.add(pair);
    for (const key of edge.requires ?? []) id(key, `connection ${edge.id} key`);
  }
  for (const item of [...graph.regions, ...graph.connections])
    for (const key of item.requires ?? []) {
      if (!grants.has(key))
        errors.push(
          `"${item.id}" requires key "${key}" with no grant in the graph.`,
        );
    }
  return errors;
}
/** Reachability with reusable keys. Collection is automatic unless collectKeys is false. */
export function inspectProgression(
  graph: RegionGraph,
  keys: readonly string[] = [],
  collectKeys = true,
): {
  readonly reachable: readonly string[];
  readonly keys: readonly string[];
  readonly unreachable: readonly string[];
} {
  const errors = structureErrors(graph);
  if (errors.length) fail(errors.join("; "));
  const owned = new Set(keys),
    reachable = new Set<string>();
  const allowed = (required: readonly string[] | undefined): boolean =>
    (required ?? []).every((key) => owned.has(key));
  const start = graph.regions.find((region) => region.id === graph.start)!;
  if (allowed(start.requires)) reachable.add(start.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const region of graph.regions) {
      if (
        !reachable.has(region.id) &&
        allowed(region.requires) &&
        graph.connections.some(
          (edge) =>
            allowed(edge.requires) &&
            ((edge.to === region.id && reachable.has(edge.from)) ||
              (edge.from === region.id && reachable.has(edge.to))),
        )
      ) {
        reachable.add(region.id);
        changed = true;
      }
      if (collectKeys && reachable.has(region.id))
        for (const key of region.grants ?? [])
          if (!owned.has(key)) {
            owned.add(key);
            changed = true;
          }
    }
  }
  return freezeCopy({
    reachable: [...reachable],
    keys: [...owned],
    unreachable: graph.regions
      .filter((region) => !reachable.has(region.id))
      .map((region) => region.id),
  });
}
/** Checks the declared graph, including cycles and keys locked behind their own requirements. */
export function validateRegionGraph(graph: RegionGraph): readonly string[] {
  const errors = structureErrors(graph);
  if (errors.length) return errors;
  const progression = inspectProgression(graph);
  return progression.unreachable.map(
    (region) => `Region "${region}" is unreachable with collectible keys.`,
  );
}
