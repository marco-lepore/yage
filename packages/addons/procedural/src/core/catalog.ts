import type { RandomService } from "@yagejs/core";
import {
  assertInteger,
  fail,
  freezeCopy,
  id,
  templateUseLimit,
} from "./geometry.js";
import { validateRegionGraph } from "./progression.js";
import { validateTemplate } from "./spatial.js";
import type {
  CatalogAssignment,
  CatalogDefinition,
  CatalogEntry,
  CatalogLink,
  CatalogMetadata,
  CatalogPort,
  CatalogSelection,
  CatalogSelector,
  CatalogVariant,
  ResolvedCatalogEntry,
  Region,
  RoomConnectionArea,
  RoomTemplate,
} from "./types.js";

export interface CatalogChoice extends ResolvedCatalogEntry {
  readonly kind: string;
  readonly weight: number;
  readonly connections: readonly (CatalogPort | RoomConnectionArea)[];
  readonly size?: { readonly width: number; readonly height: number };
  readonly navigation?: readonly string[];
}
function resolve(
  entry: CatalogEntry,
  variant: CatalogVariant | undefined,
  region: Region,
): CatalogChoice {
  const navigation =
    variant?.navigation === null
      ? undefined
      : (variant?.navigation ?? entry.navigation);
  const size = variant?.size ?? entry.size;
  const combinedWeight = (entry.weight ?? 1) * (variant?.weight ?? 1);
  if (!Number.isFinite(combinedWeight) || combinedWeight <= 0)
    fail(
      `template "${entry.id}" combined weight: finite positive number required, got ${combinedWeight}`,
    );
  return {
    id: region.id,
    kind: region.kind,
    templateId: entry.id,
    variantId: variant?.id ?? null,
    metadata: { ...entry.metadata, ...variant?.metadata },
    tags: [...new Set([...(entry.tags ?? []), ...(variant?.tags ?? [])])],
    weight: combinedWeight,
    connections: variant?.connections ?? entry.connections,
    ...(size ? { size } : {}),
    ...(navigation ? { navigation } : {}),
  };
}
export function assignment(choice: CatalogChoice): CatalogAssignment {
  return {
    id: choice.id,
    templateId: choice.templateId,
    variantId: choice.variantId,
    metadata: choice.metadata,
    tags: choice.tags,
  };
}
export function spatialTemplate(choice: CatalogChoice): RoomTemplate | null {
  if (
    !choice.size ||
    !choice.connections.every(
      (port): port is RoomConnectionArea => "side" in port,
    )
  )
    return null;
  return {
    id: choice.templateId,
    kinds: [choice.kind],
    size: choice.size,
    connections: choice.connections,
    ...(choice.navigation ? { navigation: choice.navigation } : {}),
  };
}
function selectedChoice(
  definition: CatalogDefinition,
  selected: CatalogAssignment,
): CatalogChoice {
  const region = definition.graph.regions.find((r) => r.id === selected.id);
  const entry = definition.templates.find((t) => t.id === selected.templateId);
  const variant = entry?.variants?.find((v) => v.id === selected.variantId);
  if (
    !entry ||
    !region ||
    (entry.variants ? !variant : selected.variantId !== null)
  )
    fail(`unknown catalog selection for "${selected.id}"`);
  return resolve(entry, variant, region);
}
/** Read the selected entry's data and connections without requiring spatial information. */
export function resolveCatalogEntry(
  definition: CatalogDefinition,
  selected: CatalogAssignment,
): ResolvedCatalogEntry {
  const choice = selectedChoice(definition, selected);
  return freezeCopy({
    ...assignment(choice),
    connections: choice.connections,
    ...(choice.size ? { size: choice.size } : {}),
    ...(choice.navigation ? { navigation: choice.navigation } : {}),
  });
}
/** Resolve the chosen variant's footprint, openings and optional mask. Use a validated result. */
export function resolveRoomTemplate(
  definition: CatalogDefinition,
  selected: CatalogAssignment,
): RoomTemplate {
  const template = spatialTemplate(selectedChoice(definition, selected));
  if (!template)
    fail(`selection "${selected.id}" has no complete spatial data`);
  return template;
}
function matches(selector: CatalogSelector, choice: CatalogChoice): boolean {
  return (
    (selector.kind === undefined || choice.kind === selector.kind) &&
    (selector.templateId === undefined ||
      choice.templateId === selector.templateId) &&
    (selector.variantId === undefined ||
      choice.variantId === selector.variantId) &&
    (selector.tags ?? []).every((tag) => choice.tags.includes(tag))
  );
}
/** One candidate and rule mechanism for abstract selection and spatial placement. */
export class CatalogCandidates {
  private readonly candidates = new Map<string, readonly CatalogChoice[]>();
  constructor(readonly definition: CatalogDefinition) {
    for (const region of definition.graph.regions) {
      const choices = definition.templates
        .filter((entry) => entry.kinds.includes(region.kind))
        .flatMap((entry) =>
          (entry.variants ?? [undefined])
            .filter(
              (variant) =>
                (!variant?.regionIds ||
                  variant.regionIds.includes(region.id)) &&
                (!variant?.kinds || variant.kinds.includes(region.kind)),
            )
            .map((variant) => resolve(entry, variant, region)),
        )
        .filter((choice) =>
          (definition.rules?.regions ?? []).every(
            (rule) =>
              rule.regionId !== region.id || matches(rule.match, choice),
          ),
        );
      this.candidates.set(region.id, choices);
    }
  }
  forRegion(region: Region): readonly CatalogChoice[] {
    return this.candidates.get(region.id)!;
  }
  find(selected: CatalogAssignment): CatalogChoice | undefined {
    return this.candidates
      .get(selected.id)
      ?.find(
        (choice) =>
          choice.templateId === selected.templateId &&
          choice.variantId === selected.variantId,
      );
  }
  ordered(region: Region, random: RandomService): CatalogChoice[] {
    const pending = [...this.forRegion(region)],
      result: CatalogChoice[] = [];
    while (pending.length) {
      let target =
        random.float() *
        pending.reduce((sum, choice) => sum + choice.weight, 0);
      let index = 0;
      while (index < pending.length - 1 && target >= pending[index]!.weight)
        target -= pending[index++]!.weight;
      result.push(pending.splice(index, 1)[0]!);
    }
    return result;
  }
  accepts(selected: readonly CatalogAssignment[], complete = false): boolean {
    const choices = selected.map((value) => this.find(value));
    if (choices.some((choice) => !choice)) return false;
    const resolved = choices as CatalogChoice[];
    for (const choice of resolved)
      if (
        resolved.filter((other) => other.templateId === choice.templateId)
          .length > templateUseLimit(this.definition, choice.templateId)
      )
        return false;
    for (const rule of this.definition.rules?.counts ?? []) {
      const count = resolved.filter((choice) =>
        matches(rule.match, choice),
      ).length;
      if (count > (rule.max ?? 64) || (complete && count < rule.min))
        return false;
      const possible = this.definition.graph.regions.filter(
        (region) =>
          !selected.some((value) => value.id === region.id) &&
          this.forRegion(region).some((choice) => matches(rule.match, choice)),
      ).length;
      if (count + possible < rule.min) return false;
    }
    for (const edge of this.definition.graph.connections) {
      const a = resolved.find((choice) => choice.id === edge.from),
        b = resolved.find((choice) => choice.id === edge.to);
      if (!a || !b) continue;
      if (
        (this.definition.rules?.forbiddenConnections ?? []).some(
          (rule) =>
            (matches(rule.from, a) && matches(rule.to, b)) ||
            (matches(rule.to, a) && matches(rule.from, b)),
        )
      )
        return false;
    }
    return true;
  }
}
export function portAvailable(
  choice: CatalogChoice,
  portId: string,
  links: readonly CatalogLink[],
): boolean {
  const port = choice.connections.find((p) => p.id === portId);
  return (
    !!port &&
    links.filter(
      (link) =>
        (link.from === choice.id && link.fromPort === portId) ||
        (link.to === choice.id && link.toPort === portId),
    ).length < (port.capacity ?? 1)
  );
}
function metadata(value: CatalogMetadata | undefined, context: string): void {
  if (value === undefined) return;
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 10_000 || depth > 32)
      fail(`${context} metadata exceeds 10000 values or depth 32`);
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || item === null || ancestors.has(item))
      fail(`${context} metadata must be finite, acyclic JSON data`);
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      fail(`${context} metadata must use plain objects`);
    if (Object.getOwnPropertySymbols(item).length)
      fail(`${context} metadata cannot contain symbol keys`);
    if (
      Array.isArray(item) &&
      (item.length > 10_000 ||
        Object.keys(item).length !== item.length ||
        !Array.from({ length: item.length }, (_, index) =>
          Object.hasOwn(item, index),
        ).every(Boolean))
    )
      fail(`${context} metadata arrays must be dense JSON arrays`);
    ancestors.add(item);
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(item),
    )) {
      if (!Object.hasOwn(descriptor, "value"))
        fail(`${context} metadata cannot contain accessors`);
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  };
  if (!value || Array.isArray(value) || typeof value !== "object")
    fail(`${context} metadata must be an object`);
  visit(value, 0);
}
function strings(values: readonly string[] | undefined, context: string): void {
  if (values === undefined) return;
  assertInteger(context, values.length, 0, 256);
  values.forEach((value) => id(value, context));
  if (new Set(values).size !== values.length) fail(`${context} must be unique`);
}
function weight(value: number | undefined, context: string): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value <= 0 || value > 1_000_000)
  )
    fail(
      `${context} weight: finite number in (0, 1000000] required, got ${value}`,
    );
}
export function validateCatalogDefinition(
  definition: CatalogDefinition,
): CatalogDefinition {
  id(definition.id, "definition id");
  id(definition.revision, "definition revision");
  const errors = validateRegionGraph(definition.graph);
  if (errors.length) fail(errors.join("; "));
  assertInteger("Catalog template count", definition.templates.length, 1, 128);
  const entries = new Set<string>();
  for (const entry of definition.templates) {
    id(entry.id, "template id");
    if (entries.has(entry.id)) fail(`duplicate template "${entry.id}"`);
    entries.add(entry.id);
    strings(entry.kinds, `template "${entry.id}" kinds`);
    if (!entry.kinds.length) fail(`template "${entry.id}" needs kinds`);
    strings(entry.tags, `template "${entry.id}" tags`);
    metadata(entry.metadata, entry.id);
    weight(entry.weight, entry.id);
    if (entry.variants)
      assertInteger(
        `template "${entry.id}" variants`,
        entry.variants.length,
        1,
        64,
      );
    const variants = new Set<string>();
    for (const variant of entry.variants ?? []) {
      id(variant.id, `template "${entry.id}" variant id`);
      if (variants.has(variant.id))
        fail(`duplicate variant "${variant.id}" in "${entry.id}"`);
      variants.add(variant.id);
      strings(variant.tags, variant.id);
      strings(variant.regionIds, variant.id);
      strings(variant.kinds, variant.id);
      if (
        variant.regionIds?.some(
          (regionId) =>
            !definition.graph.regions.some((r) => r.id === regionId),
        )
      )
        fail(`variant "${variant.id}" references unknown region`);
      if (variant.kinds?.some((kind) => !entry.kinds.includes(kind)))
        fail(`variant "${variant.id}" references a kind absent from its entry`);
      metadata(variant.metadata, variant.id);
      weight(variant.weight, variant.id);
    }
    for (const variant of entry.variants ?? [undefined]) {
      const choice = resolve(entry, variant, {
        id: entry.id,
        kind: entry.kinds[0]!,
      });
      assertInteger(
        `template "${entry.id}" connections`,
        choice.connections.length,
        0,
        64,
      );
      const ports = new Set<string>();
      for (const port of choice.connections) {
        id(port.id, `${entry.id} connection id`);
        id(port.socket ?? "passage", `${entry.id} socket`);
        assertInteger(
          `${entry.id} connection capacity`,
          port.capacity ?? 1,
          1,
          64,
        );
        if (ports.has(port.id))
          fail(`duplicate connection "${port.id}" in "${entry.id}"`);
        ports.add(port.id);
      }
      if (choice.size) {
        assertInteger(`${entry.id} width`, choice.size.width, 1, 1_000_000);
        assertInteger(`${entry.id} height`, choice.size.height, 1, 1_000_000);
      }
      if (
        choice.navigation ||
        choice.connections.some((port) => "side" in port)
      ) {
        if (!choice.size)
          fail(`template "${entry.id}" needs size for spatial data`);
        validateTemplate({
          id: entry.id,
          kinds: entry.kinds,
          size: choice.size,
          connections: choice.connections.filter(
            (port): port is RoomConnectionArea => "side" in port,
          ),
          ...(choice.navigation ? { navigation: choice.navigation } : {}),
        });
      }
    }
  }
  for (const region of definition.graph.regions)
    if (
      !definition.templates.some((entry) => entry.kinds.includes(region.kind))
    )
      fail(`region "${region.id}" has no template for kind "${region.kind}"`);
  for (const [key, count] of Object.entries(definition.maxUses ?? {})) {
    if (!entries.has(key)) fail(`maxUses references unknown template "${key}"`);
    assertInteger(`Catalog maxUses.${key}`, count, 0, 64);
  }
  const selector = (match: CatalogSelector): void => {
    if (match.kind !== undefined) {
      id(match.kind, "selector kind");
      if (!definition.graph.regions.some((r) => r.kind === match.kind))
        fail(`selector references unknown kind "${match.kind}"`);
    }
    if (match.templateId !== undefined && !entries.has(match.templateId))
      fail(`selector references unknown template "${match.templateId}"`);
    if (
      match.variantId !== undefined &&
      !definition.templates.some(
        (entry) =>
          (match.templateId === undefined || entry.id === match.templateId) &&
          entry.variants?.some((v) => v.id === match.variantId),
      )
    )
      fail(`selector references unknown variant "${match.variantId}"`);
    strings(match.tags, "selector tags");
  };
  for (const rules of [
    definition.rules?.counts,
    definition.rules?.regions,
    definition.rules?.forbiddenConnections,
  ])
    if (rules) assertInteger("Catalog rule count", rules.length, 0, 256);
  for (const rule of definition.rules?.counts ?? []) {
    selector(rule.match);
    assertInteger("Catalog count min", rule.min, 0, 64);
    assertInteger("Catalog count max", rule.max ?? 64, rule.min, 64);
  }
  for (const rule of definition.rules?.regions ?? []) {
    if (!definition.graph.regions.some((r) => r.id === rule.regionId))
      fail(`rule references unknown region "${rule.regionId}"`);
    selector(rule.match);
  }
  for (const rule of definition.rules?.forbiddenConnections ?? []) {
    selector(rule.from);
    selector(rule.to);
  }
  return freezeCopy(definition);
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const x = Object.keys(a),
    y = Object.keys(b);
  return (
    x.length === y.length &&
    x.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equal(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  );
}
export function validateAssignments(
  definition: CatalogDefinition,
  selected: readonly CatalogAssignment[],
  links: readonly CatalogLink[],
): string[] {
  const errors: string[] = [],
    candidates = new CatalogCandidates(definition);
  const ids = new Set(selected.map((value) => value.id));
  if (ids.size !== selected.length)
    errors.push("Duplicate catalog region ids.");
  for (const region of definition.graph.regions)
    if (!ids.has(region.id))
      errors.push(`Required region "${region.id}" missing.`);
  for (const value of selected) {
    const choice = candidates.find(value);
    if (
      !choice ||
      !equal(choice.metadata, value.metadata) ||
      !equal(choice.tags, value.tags)
    )
      errors.push(`Invalid catalog variant or metadata for "${value.id}".`);
  }
  if (!candidates.accepts(selected, true))
    errors.push(
      "Catalog selection violates count, region, adjacency or usage rules.",
    );
  const seen = new Set<string>(),
    accepted: CatalogLink[] = [];
  for (const link of links) {
    const expected = definition.graph.connections.find(
      (edge) => edge.id === link.id,
    );
    const a = selected.find((value) => value.id === link.from),
      b = selected.find((value) => value.id === link.to);
    const ac = a && candidates.find(a),
      bc = b && candidates.find(b);
    const ap = ac?.connections.find((port) => port.id === link.fromPort),
      bp = bc?.connections.find((port) => port.id === link.toPort);
    if (
      !expected ||
      expected.from !== link.from ||
      expected.to !== link.to ||
      seen.has(link.id) ||
      !ac ||
      !bc ||
      !ap ||
      !bp ||
      (ap.socket ?? "passage") !== (bp.socket ?? "passage") ||
      !portAvailable(ac, ap.id, accepted) ||
      !portAvailable(bc, bp.id, accepted)
    )
      errors.push(`Invalid catalog connection "${link.id}".`);
    seen.add(link.id);
    accepted.push(link);
  }
  for (const edge of definition.graph.connections)
    if (!seen.has(edge.id))
      errors.push(`Required connection "${edge.id}" missing.`);
  return errors;
}
export function validateCatalogSelection(
  definition: CatalogDefinition,
  selection: CatalogSelection,
): readonly string[] {
  validateCatalogDefinition(definition);
  assertInteger("Catalog seed", selection.options.seed, 0, 0xffff_ffff);
  assertInteger("Catalog maxSteps", selection.options.maxSteps, 1, 10_000_000);
  const errors = validateAssignments(
    definition,
    selection.regions,
    selection.connections,
  );
  if (
    selection.generatorVersion !== 1 ||
    selection.definitionId !== definition.id ||
    selection.definitionRevision !== definition.revision
  )
    errors.push(
      "Generator version or definition identity/revision does not match.",
    );
  return errors;
}
