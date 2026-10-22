import { fail } from "./internal.js";
import type { Progression, ProgressionOptions, RegionGraph } from "./types.js";

/** @internal Duplicate ids, an unknown start, and connections with a bad endpoint. */
export function graphStructureErrors(graph: RegionGraph): string[] {
  const errors: string[] = [];
  const regions = new Set<string>();
  for (const region of graph.regions) {
    if (regions.has(region.id)) errors.push(`Duplicate region "${region.id}".`);
    regions.add(region.id);
  }
  if (!regions.has(graph.start))
    errors.push(`Unknown start region "${graph.start}".`);
  const connections = new Set<string>();
  for (const edge of graph.connections) {
    if (connections.has(edge.id))
      errors.push(`Duplicate connection "${edge.id}".`);
    connections.add(edge.id);
    if (!regions.has(edge.from) || !regions.has(edge.to))
      errors.push(`Connection "${edge.id}" has an unknown endpoint.`);
    else if (edge.from === edge.to)
      errors.push(`Connection "${edge.id}" connects a region to itself.`);
  }
  return errors;
}

/**
 * Regions reachable from the start with permanent, reusable keys. Collection
 * repeats until no further region opens. Throws for a malformed graph.
 */
export function inspectProgression(
  graph: RegionGraph,
  options: ProgressionOptions = {},
): Progression {
  const errors = graphStructureErrors(graph);
  if (errors.length) fail(errors.join(" "));
  const owned = new Set(options.keys ?? []);
  const collect = options.collectKeys ?? true;
  const reachable = new Set<string>();
  const open = (required: readonly string[] | undefined): boolean =>
    (required ?? []).every((key) => owned.has(key));
  let changed = true;
  while (changed) {
    changed = false;
    for (const region of graph.regions) {
      if (
        !reachable.has(region.id) &&
        open(region.requires) &&
        (region.id === graph.start ||
          graph.connections.some(
            (edge) =>
              open(edge.requires) &&
              ((edge.to === region.id && reachable.has(edge.from)) ||
                (edge.from === region.id && reachable.has(edge.to))),
          ))
      ) {
        reachable.add(region.id);
        changed = true;
      }
      if (collect && reachable.has(region.id))
        for (const key of region.grants ?? [])
          if (!owned.has(key)) {
            owned.add(key);
            changed = true;
          }
    }
  }
  return {
    reachable: [...reachable],
    keys: [...owned],
    unreachable: graph.regions
      .filter((region) => !reachable.has(region.id))
      .map((region) => region.id),
  };
}

/**
 * Errors for duplicate ids, unknown endpoints, keys that neither a region nor
 * `options.keys` provides, and regions no key collection reaches.
 */
export function validateRegionGraph(
  graph: RegionGraph,
  options: ProgressionOptions = {},
): readonly string[] {
  const errors = graphStructureErrors(graph);
  if (errors.length) return errors;
  const keys = new Set([
    ...(options.keys ?? []),
    ...graph.regions.flatMap((region) => region.grants ?? []),
  ]);
  for (const item of [...graph.regions, ...graph.connections])
    for (const key of item.requires ?? [])
      if (!keys.has(key))
        errors.push(
          `"${item.id}" requires key "${key}", which no region grants.`,
        );
  if (errors.length) return errors;
  return inspectProgression(graph, options).unreachable.map(
    (region) =>
      `Region "${region}" is unreachable with the keys it can collect.`,
  );
}
