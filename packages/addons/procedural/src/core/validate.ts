import { validateTemplate } from "./spatial.js";
import { assertInteger, freezeCopy, fail } from "./geometry.js";
import {
  CatalogCandidates,
  validateCatalogDefinition,
  spatialTemplate,
} from "./catalog.js";
import type {
  CatalogDefinition,
  RoomGenerationOptions,
  ResolvedRoomOptions,
} from "./types.js";
export function validateDefinition(
  definition: CatalogDefinition,
): CatalogDefinition {
  validateCatalogDefinition(definition);
  const candidates = new CatalogCandidates(definition);
  for (const region of definition.graph.regions)
    for (const choice of candidates.forRegion(region)) {
      const template = spatialTemplate(choice);
      if (!template)
        fail(
          `region "${region.id}" has a candidate without complete spatial data`,
        );
      validateTemplate(template);
    }
  return freezeCopy(definition);
}
export function resolveOptions(
  options: RoomGenerationOptions,
): ResolvedRoomOptions {
  assertInteger("RoomGenerator seed", options.seed, 0, 0xffff_ffff);
  assertInteger(
    "RoomGenerator maxSteps",
    options.maxSteps ?? 20_000,
    1,
    10_000_000,
  );
  const origin = options.origin ?? { x: 0, y: 0 };
  for (const key of ["x", "y"] as const)
    assertInteger(
      `RoomGenerator origin.${key}`,
      origin[key],
      -1_000_000,
      1_000_000,
    );
  if (options.bounds)
    for (const key of ["x", "y", "width", "height"] as const)
      assertInteger(
        `RoomGenerator bounds.${key}`,
        options.bounds[key],
        key === "x" || key === "y" ? -1_000_000 : 1,
        1_000_000,
      );
  return freezeCopy({
    seed: options.seed,
    maxSteps: options.maxSteps ?? 20_000,
    origin,
    ...(options.bounds ? { bounds: options.bounds } : {}),
    preferUniqueTemplates: options.preferUniqueTemplates ?? true,
  });
}
