import { GenerationSearch, restartAfter } from "./GenerationSearch.js";
import {
  portAvailable,
  selectionErrors,
  validateCatalogDefinition,
} from "./catalog.js";
import type { Candidate, CatalogCandidates } from "./catalog.js";
import { freezeCopy } from "./internal.js";
import type {
  CatalogDefinition,
  CatalogGenerationInspection,
  CatalogLink,
  CatalogSelection,
  GenerationOptions,
  RegionConnection,
} from "./types.js";

/**
 * Selects a template, variant and connection slots for every region of the
 * supplied graph, without placing anything. The graph is kept as given,
 * cycles included.
 */
export class CatalogGenerator extends GenerationSearch<CatalogSelection> {
  readonly definition: CatalogDefinition;
  private readonly candidates: CatalogCandidates;
  private readonly chosen: Candidate[] = [];
  private readonly links: CatalogLink[] = [];
  constructor(definition: CatalogDefinition, options: GenerationOptions) {
    super(options, restartAfter(definition.graph.regions.length));
    this.definition = freezeCopy(definition);
    this.candidates = validateCatalogDefinition(this.definition, false);
  }
  override inspect(): CatalogGenerationInspection {
    return {
      ...super.inspect(),
      regions: this.chosen.map((c) => c.selected),
      connections: [...this.links],
    };
  }
  protected *run(): Generator<void, CatalogSelection | null> {
    this.chosen.length = 0;
    this.links.length = 0;
    if (!(yield* this.search())) return null;
    const graph = this.definition.graph;
    // Results follow the graph's own order.
    return {
      start: graph.start,
      regions: graph.regions.map(
        (region) =>
          this.chosen.find((c) => c.region.id === region.id)!.selected,
      ),
      connections: graph.connections.map(
        (edge) => this.links.find((link) => link.id === edge.id)!,
      ),
    };
  }
  /** Graph connections between `regionId` and regions already chosen. */
  private edgesToChosen(regionId: string): RegionConnection[] {
    const chosen = (id: string): boolean =>
      this.chosen.some((c) => c.region.id === id);
    return this.definition.graph.connections.filter(
      (edge) =>
        (edge.from === regionId && chosen(edge.to)) ||
        (edge.to === regionId && chosen(edge.from)),
    );
  }
  private *search(): Generator<void, boolean> {
    const graph = this.definition.graph;
    if (this.chosen.length === graph.regions.length) {
      const broken = this.candidates.brokenRule(this.chosen, true);
      if (broken)
        this.note(
          "catalog-rule",
          `The complete selection breaks the ${broken}.`,
        );
      return !broken;
    }
    // Start first, then the connected region with the fewest candidates.
    const region = this.chosen.length
      ? graph.regions
          .filter(
            (r) =>
              !this.chosen.some((c) => c.region.id === r.id) &&
              this.edgesToChosen(r.id).length,
          )
          .sort(
            (a, b) =>
              this.candidates.forRegion(a.id).length -
              this.candidates.forRegion(b.id).length,
          )[0]!
      : graph.regions.find((r) => r.id === graph.start)!;
    const edges = this.edgesToChosen(region.id);
    for (const candidate of this.candidates.ordered(region.id, this.random)) {
      yield;
      const broken = this.candidates.brokenRule(
        [...this.chosen, candidate],
        false,
      );
      if (broken) {
        this.note(
          "catalog-rule",
          `A candidate for "${region.id}" breaks the ${broken}.`,
        );
        continue;
      }
      for (const links of this.join(candidate, edges, [])) {
        yield;
        if (!links) continue;
        this.chosen.push(candidate);
        this.links.push(...links);
        if (yield* this.search()) return true;
        this.chosen.pop();
        this.links.splice(this.links.length - links.length);
      }
    }
    return false;
  }
  /** Every way to give each edge a free, socket-compatible slot at both ends. */
  private *join(
    candidate: Candidate,
    edges: readonly RegionConnection[],
    added: readonly CatalogLink[],
  ): Generator<readonly CatalogLink[] | null> {
    const edge = edges[0];
    if (!edge) {
      yield added;
      return;
    }
    const otherId = edge.from === candidate.region.id ? edge.to : edge.from;
    const other = this.chosen.find((c) => c.region.id === otherId)!;
    const used = [...this.links, ...added];
    for (const a of this.random.shuffle([...candidate.ports]))
      for (const b of this.random.shuffle([...other.ports])) {
        if (
          (a.socket ?? "passage") !== (b.socket ?? "passage") ||
          !portAvailable(candidate, a.id, used) ||
          !portAvailable(other, b.id, used)
        ) {
          yield null;
          continue;
        }
        const forward = edge.from === candidate.region.id;
        const link: CatalogLink = {
          ...edge,
          fromPort: forward ? a.id : b.id,
          toPort: forward ? b.id : a.id,
        };
        yield* this.join(candidate, edges.slice(1), [...added, link]);
      }
  }
}

/** Errors for a saved selection checked against the current definition. Throws for an invalid definition. */
export function validateCatalogSelection(
  definition: CatalogDefinition,
  selection: CatalogSelection,
): readonly string[] {
  const candidates = validateCatalogDefinition(definition, false);
  return selectionErrors(
    candidates,
    selection.start,
    selection.regions,
    selection.connections,
  ).errors;
}
