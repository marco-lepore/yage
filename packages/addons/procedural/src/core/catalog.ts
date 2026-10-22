import type { RandomService } from "@yagejs/core";
import { validateRoomGeometry } from "./geometry.js";
import { assertInteger, assertPositive, fail } from "./internal.js";
import { disconnectedRegions, graphStructureErrors } from "./progression.js";
import type {
  CatalogDefinition,
  CatalogLink,
  CatalogPort,
  CatalogSelector,
  CatalogValue,
  CatalogTemplate,
  CatalogVariant,
  Region,
  RoomConnectionArea,
  SelectedRegion,
  TileSize,
} from "./types.js";

type AnyTemplate = CatalogTemplate & {
  readonly size?: TileSize;
  readonly navigation?: readonly string[];
};
type AnyVariant = CatalogVariant & {
  readonly size?: TileSize;
  readonly navigation?: readonly string[] | null;
};

/** One template or variant resolved for one region. */
export interface Candidate {
  readonly region: Region;
  readonly selected: SelectedRegion;
  readonly weight: number;
  readonly ports: readonly CatalogPort[];
  /** Room templates only. */
  readonly size: TileSize | undefined;
  readonly navigation: readonly string[] | undefined;
}
function resolve(
  template: AnyTemplate,
  variant: AnyVariant | undefined,
  region: Region,
): Candidate {
  const navigation =
    variant?.navigation === null
      ? undefined
      : (variant?.navigation ?? template.navigation);
  return {
    region,
    selected: {
      ...region,
      templateId: template.id,
      variantId: variant?.id ?? null,
      metadata: { ...template.metadata, ...variant?.metadata },
      tags: [...new Set([...(template.tags ?? []), ...(variant?.tags ?? [])])],
    },
    weight: (template.weight ?? 1) * (variant?.weight ?? 1),
    ports: variant?.connections ?? template.connections,
    size: variant?.size ?? template.size,
    navigation,
  };
}
function matches(selector: CatalogSelector, selected: SelectedRegion): boolean {
  return (
    (selector.kind === undefined || selected.kind === selector.kind) &&
    (selector.templateId === undefined ||
      selected.templateId === selector.templateId) &&
    (selector.variantId === undefined ||
      selected.variantId === selector.variantId) &&
    (selector.tags ?? []).every((tag) => selected.tags.includes(tag))
  );
}

/** The candidates of every region and the catalog rules, shared by both generators. */
export class CatalogCandidates {
  private readonly byRegion = new Map<string, readonly Candidate[]>();
  /**
   * Per count rule: the regions with at least one matching candidate, and
   * the regions whose every candidate matches.
   */
  private readonly matching: readonly {
    readonly can: readonly string[];
    readonly must: readonly string[];
  }[];
  constructor(readonly definition: CatalogDefinition) {
    for (const region of definition.graph.regions)
      this.byRegion.set(
        region.id,
        definition.templates
          .filter((template) => template.kinds.includes(region.kind))
          .flatMap((template) =>
            (template.variants ?? [undefined])
              .filter(
                (variant) =>
                  (!variant?.regionIds ||
                    variant.regionIds.includes(region.id)) &&
                  (!variant?.kinds || variant.kinds.includes(region.kind)),
              )
              .map((variant) => resolve(template, variant, region)),
          )
          .filter((candidate) =>
            (definition.rules?.regions ?? []).every(
              (rule) =>
                rule.regionId !== region.id ||
                matches(rule.match, candidate.selected),
            ),
          ),
      );
    const regions = definition.graph.regions;
    this.matching = (definition.rules?.counts ?? []).map((rule) => {
      const test = (candidate: Candidate): boolean =>
        matches(rule.match, candidate.selected);
      return {
        can: regions
          .filter((r) => this.forRegion(r.id).some(test))
          .map((r) => r.id),
        must: regions
          .filter((r) => this.forRegion(r.id).every(test))
          .map((r) => r.id),
      };
    });
  }
  forRegion(regionId: string): readonly Candidate[] {
    return this.byRegion.get(regionId) ?? [];
  }
  find(selected: SelectedRegion): Candidate | undefined {
    return this.forRegion(selected.id).find(
      (candidate) =>
        candidate.selected.templateId === selected.templateId &&
        candidate.selected.variantId === selected.variantId,
    );
  }
  /** Seeded weighted order: heavier candidates tend to come first. */
  ordered(regionId: string, random: RandomService): Candidate[] {
    const pending = [...this.forRegion(regionId)],
      result: Candidate[] = [];
    while (pending.length) {
      let target =
        random.float() * pending.reduce((sum, c) => sum + c.weight, 0);
      let index = 0;
      while (index < pending.length - 1 && target >= pending[index]!.weight)
        target -= pending[index++]!.weight;
      result.push(pending.splice(index, 1)[0]!);
    }
    return result;
  }
  /**
   * The first count or connection rule these choices break, described for a
   * diagnostic, or null. A partial selection breaks a minimum only when no
   * completion could reach it.
   */
  brokenRule(chosen: readonly Candidate[], complete: boolean): string | null {
    const rules = this.definition.rules;
    const ids = new Set(chosen.map((c) => c.region.id));
    const open = (regionIds: readonly string[]): number =>
      regionIds.filter((id) => !ids.has(id)).length;
    for (const [index, rule] of (rules?.counts ?? []).entries()) {
      const label = `count rule ${JSON.stringify(rule.match)}`;
      const count = chosen.filter((c) =>
        matches(rule.match, c.selected),
      ).length;
      const min = rule.min ?? 0;
      if (rule.max !== undefined && count > rule.max)
        return `${label}: at most ${rule.max}, got ${count}`;
      if (complete) {
        if (count < min) return `${label}: at least ${min}, got ${count}`;
        continue;
      }
      const { can, must } = this.matching[index]!;
      if (count < min && count + open(can) < min)
        return `${label}: at least ${min}, but at most ${count + open(can)} regions can match`;
      if (rule.max !== undefined && count + open(must) > rule.max)
        return `${label}: at most ${rule.max}, but at least ${count + open(must)} regions must match`;
    }
    const byId = new Map(chosen.map((c) => [c.region.id, c.selected]));
    for (const edge of this.definition.graph.connections) {
      const a = byId.get(edge.from),
        b = byId.get(edge.to);
      if (!a || !b) continue;
      const rule = this.forbidding(a, b);
      if (rule)
        return `forbidden connection ${JSON.stringify(rule.from)} to ${JSON.stringify(rule.to)} on "${edge.id}"`;
    }
    return null;
  }
  /** The forbidden-connection rule a direct link between `a` and `b` breaks, in either direction. */
  forbidding(
    a: SelectedRegion,
    b: SelectedRegion,
  ):
    | { readonly from: CatalogSelector; readonly to: CatalogSelector }
    | undefined {
    return this.definition.rules?.forbiddenConnections?.find(
      (rule) =>
        (matches(rule.from, a) && matches(rule.to, b)) ||
        (matches(rule.to, a) && matches(rule.from, b)),
    );
  }
}

/** Whether `candidate` can use `portId` for one more link. */
export function portAvailable(
  candidate: Candidate,
  portId: string,
  links: readonly CatalogLink[],
): boolean {
  const port = candidate.ports.find((p) => p.id === portId);
  if (!port) return false;
  const id = candidate.region.id;
  const used = links.filter(
    (link) =>
      (link.from === id && link.fromPort === portId) ||
      (link.to === id && link.toPort === portId),
  ).length;
  return used < (port.capacity ?? 1);
}

/**
 * Throws naming the first invalid template, variant, rule or region. With
 * `rooms`, every candidate also needs placeable geometry.
 */
export function validateCatalogDefinition(
  definition: CatalogDefinition,
  rooms: boolean,
): CatalogCandidates {
  // Progression is the game's to check with validateRegionGraph: only the
  // game knows which keys the player holds at the start. The search grows
  // outwards from the start, so every region needs a connection path to it.
  const graphErrors = graphStructureErrors(definition.graph);
  if (graphErrors.length) fail(graphErrors.join(" "));
  const disconnected = disconnectedRegions(definition.graph);
  if (disconnected.length)
    fail(
      `${disconnected.map((id) => `region "${id}"`).join(", ")} has no connection path to start region "${definition.graph.start}"`,
    );
  const regionIds = new Set(definition.graph.regions.map((r) => r.id));
  const templateIds = new Set<string>();
  for (const template of definition.templates as readonly AnyTemplate[]) {
    const label = `template "${template.id}"`;
    if (templateIds.has(template.id)) fail(`duplicate ${label}`);
    templateIds.add(template.id);
    if (template.weight !== undefined)
      assertPositive(`${label} weight`, template.weight);
    assertFiniteData(`${label} metadata`, template.metadata ?? {});
    const variantIds = new Set<string>();
    for (const variant of template.variants ?? []) {
      const variantLabel = `${label} variant "${variant.id}"`;
      if (variantIds.has(variant.id)) fail(`duplicate ${variantLabel}`);
      variantIds.add(variant.id);
      if (variant.weight !== undefined)
        assertPositive(`${variantLabel} weight`, variant.weight);
      assertFiniteData(`${variantLabel} metadata`, variant.metadata ?? {});
      for (const regionId of variant.regionIds ?? [])
        if (!regionIds.has(regionId))
          fail(`${variantLabel} names unknown region "${regionId}"`);
      for (const kind of variant.kinds ?? [])
        if (!template.kinds.includes(kind))
          fail(
            `${variantLabel} names kind "${kind}", which its template lacks`,
          );
    }
    for (const variant of (template.variants ?? [undefined]) as readonly (
      | AnyVariant
      | undefined
    )[]) {
      const candidateLabel = variant
        ? `${label} variant "${variant.id}"`
        : label;
      const candidate = resolve(template, variant, {
        id: template.id,
        kind: template.kinds[0] ?? "",
      });
      assertPositive(`${candidateLabel} combined weight`, candidate.weight);
      const portIds = new Set<string>();
      for (const port of candidate.ports) {
        if (portIds.has(port.id))
          fail(`${candidateLabel} has duplicate connection "${port.id}"`);
        portIds.add(port.id);
        assertInteger(
          `${candidateLabel} connection "${port.id}" capacity`,
          port.capacity ?? 1,
          1,
        );
      }
      if (rooms)
        validateRoomGeometry(
          candidateLabel,
          candidate.size!,
          candidate.ports as readonly RoomConnectionArea[],
          candidate.navigation,
        );
    }
  }
  const kinds = new Set(definition.graph.regions.map((r) => r.kind));
  const selector = (match: CatalogSelector, context: string): void => {
    if (match.kind !== undefined && !kinds.has(match.kind))
      fail(`${context} names unknown kind "${match.kind}"`);
    if (match.templateId !== undefined && !templateIds.has(match.templateId))
      fail(`${context} names unknown template "${match.templateId}"`);
    if (
      match.variantId !== undefined &&
      !definition.templates.some(
        (template) =>
          (match.templateId === undefined ||
            template.id === match.templateId) &&
          template.variants?.some((v) => v.id === match.variantId),
      )
    )
      fail(`${context} names unknown variant "${match.variantId}"`);
  };
  for (const [index, rule] of (definition.rules?.counts ?? []).entries()) {
    const context = `rules.counts[${index}]`;
    selector(rule.match, context);
    const min = rule.min ?? 0;
    assertInteger(`${context} min`, min, 0);
    if (rule.max !== undefined) assertInteger(`${context} max`, rule.max, min);
  }
  for (const [index, rule] of (definition.rules?.regions ?? []).entries()) {
    const context = `rules.regions[${index}]`;
    if (!regionIds.has(rule.regionId))
      fail(`${context} names unknown region "${rule.regionId}"`);
    selector(rule.match, context);
  }
  for (const [index, rule] of (
    definition.rules?.forbiddenConnections ?? []
  ).entries()) {
    selector(rule.from, `rules.forbiddenConnections[${index}].from`);
    selector(rule.to, `rules.forbiddenConnections[${index}].to`);
  }
  const candidates = new CatalogCandidates(definition);
  for (const region of definition.graph.regions)
    if (!candidates.forRegion(region.id).length)
      fail(
        `region "${region.id}" has no eligible template for kind "${region.kind}"`,
      );
  const broken = candidates.brokenRule([], false);
  if (broken) fail(`no selection can meet the ${broken}`);
  for (const edge of definition.graph.connections)
    if (
      !candidates
        .forRegion(edge.from)
        .some((a) =>
          candidates
            .forRegion(edge.to)
            .some((b) => !candidates.forbidding(a.selected, b.selected)),
        )
    )
      fail(
        `connection "${edge.id}" has no pair of templates the forbidden-connection rules allow`,
      );
  return candidates;
}

/** Metadata is compared and saved as JSON, so every number must be finite. */
function assertFiniteData(context: string, value: CatalogValue): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      fail(`${context}: finite number required, got ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((item: CatalogValue, i) =>
      assertFiniteData(`${context}[${i}]`, item),
    );
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      assertFiniteData(`${context}.${key}`, item);
  }
}

/** Deep equality for JSON-shaped data; `undefined` fields count as absent. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const record = (value: object): [string, unknown][] =>
    Object.entries(value).filter(([, v]) => v !== undefined);
  const x = record(a),
    y = new Map(record(b));
  return (
    x.length === y.size &&
    x.every(([key, value]) => y.has(key) && sameData(value, y.get(key)))
  );
}

function sameRegion(a: Region, b: Region): boolean {
  return (
    a.kind === b.kind &&
    sameData(a.grants ?? [], b.grants ?? []) &&
    sameData(a.requires ?? [], b.requires ?? [])
  );
}

/**
 * Errors for a saved selection or layout checked against the current
 * definition: graph, eligibility, resolved data, rules, slots and capacities.
 */
export function selectionErrors(
  candidates: CatalogCandidates,
  start: string,
  regions: readonly SelectedRegion[],
  links: readonly CatalogLink[],
): { errors: string[]; chosen: ReadonlyMap<string, Candidate> } {
  const graph = candidates.definition.graph;
  const errors: string[] = [];
  if (start !== graph.start)
    errors.push(
      `Start "${start}" does not match graph start "${graph.start}".`,
    );
  const chosen = new Map<string, Candidate>();
  for (const selected of regions) {
    const region = graph.regions.find((r) => r.id === selected.id);
    if (!region) {
      errors.push(`Region "${selected.id}" is not in the graph.`);
      continue;
    }
    if (chosen.has(selected.id)) {
      errors.push(`Region "${selected.id}" appears twice.`);
      continue;
    }
    const candidate = candidates.find(selected);
    if (
      !candidate ||
      !sameRegion(region, selected) ||
      !sameData(candidate.selected.metadata, selected.metadata) ||
      !sameData(candidate.selected.tags, selected.tags)
    ) {
      errors.push(
        `Region "${selected.id}" does not match an eligible template or variant.`,
      );
      continue;
    }
    chosen.set(selected.id, candidate);
  }
  for (const region of graph.regions)
    if (!regions.some((r) => r.id === region.id))
      errors.push(`Region "${region.id}" is missing.`);
  const broken = errors.length
    ? null
    : candidates.brokenRule([...chosen.values()], true);
  if (broken) errors.push(`The selection breaks the ${broken}.`);
  const accepted: CatalogLink[] = [];
  for (const link of links) {
    const edge = graph.connections.find((c) => c.id === link.id);
    const a = chosen.get(link.from),
      b = chosen.get(link.to);
    if (
      !edge ||
      accepted.some((l) => l.id === link.id) ||
      edge.from !== link.from ||
      edge.to !== link.to ||
      !sameData(edge.requires ?? [], link.requires ?? [])
    ) {
      errors.push(`Connection "${link.id}" is invalid.`);
      continue;
    }
    // An endpoint that failed its own check is already reported.
    if (!a || !b) continue;
    const ap = a.ports.find((p) => p.id === link.fromPort),
      bp = b.ports.find((p) => p.id === link.toPort);
    if (
      !ap ||
      !bp ||
      (ap.socket ?? "passage") !== (bp.socket ?? "passage") ||
      !portAvailable(a, ap.id, accepted) ||
      !portAvailable(b, bp.id, accepted)
    ) {
      errors.push(`Connection "${link.id}" is invalid.`);
      continue;
    }
    accepted.push(link);
  }
  for (const edge of graph.connections)
    if (!links.some((l) => l.id === edge.id))
      errors.push(`Connection "${edge.id}" is missing.`);
  return { errors, chosen };
}
