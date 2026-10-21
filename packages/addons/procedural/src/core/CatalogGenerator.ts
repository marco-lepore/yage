import { createRandomService } from "@yagejs/core";
import type { RandomService } from "@yagejs/core";
import { GenerationSearch } from "./GenerationSearch.js";
import {
  assignment,
  CatalogCandidates,
  portAvailable,
  validateCatalogDefinition,
  validateCatalogSelection,
} from "./catalog.js";
import type { CatalogChoice } from "./catalog.js";
import { fail, freezeCopy } from "./geometry.js";
import type {
  CatalogAssignment,
  CatalogDefinition,
  CatalogGenerationSnapshot,
  CatalogLink,
  CatalogSelection,
  GenerationOptions,
  RegionConnection,
} from "./types.js";

/** Selects entries, variants and connection slots without placing rooms. */
export class CatalogGenerator extends GenerationSearch<CatalogSelection> {
  readonly definition: CatalogDefinition;
  private readonly candidates: CatalogCandidates;
  private readonly random: RandomService;
  private readonly regions: CatalogAssignment[] = [];
  private readonly connections: CatalogLink[] = [];
  constructor(definition: CatalogDefinition, options: GenerationOptions) {
    super(options);
    this.definition = validateCatalogDefinition(definition);
    this.candidates = new CatalogCandidates(this.definition);
    this.random = createRandomService(this.seed);
  }
  private *join(
    choice: CatalogChoice,
    edges: readonly RegionConnection[],
    extra: CatalogLink[] = [],
  ): Generator<CatalogLink[] | null> {
    if (!edges.length) {
      yield extra;
      return;
    }
    const edge = edges[0]!;
    const other = this.candidates.find(
      this.regions.find(
        (r) => r.id === (edge.from === choice.id ? edge.to : edge.from),
      )!,
    )!;
    for (const a of this.random.shuffle([...choice.connections]))
      for (const b of this.random.shuffle([...other.connections])) {
        const links = [...this.connections, ...extra];
        if (
          (a.socket ?? "passage") !== (b.socket ?? "passage") ||
          !portAvailable(choice, a.id, links) ||
          !portAvailable(other, b.id, links)
        ) {
          yield null;
          continue;
        }
        const link = {
          id: edge.id,
          from: edge.from,
          to: edge.to,
          fromPort: edge.from === choice.id ? a.id : b.id,
          toPort: edge.from === choice.id ? b.id : a.id,
        };
        yield* this.join(choice, edges.slice(1), [...extra, link]);
      }
  }
  private *search(): Generator<void, boolean> {
    if (this.regions.length === this.definition.graph.regions.length)
      return this.candidates.accepts(this.regions, true);
    const graph = this.definition.graph;
    const edgesFor = (regionId: string): RegionConnection[] =>
      graph.connections.filter(
        (edge) =>
          (edge.from === regionId &&
            this.regions.some((r) => r.id === edge.to)) ||
          (edge.to === regionId &&
            this.regions.some((r) => r.id === edge.from)),
      );
    const region = this.regions.length
      ? graph.regions
          .filter(
            (r) =>
              !this.regions.some((value) => value.id === r.id) &&
              edgesFor(r.id).length,
          )
          .sort(
            (a, b) =>
              this.candidates.forRegion(a).length -
              this.candidates.forRegion(b).length,
          )[0]!
      : graph.regions.find((r) => r.id === graph.start)!;
    for (const choice of this.candidates.ordered(region, this.random)) {
      yield;
      const value = assignment(choice);
      if (!this.candidates.accepts([...this.regions, value])) continue;
      for (const links of this.join(choice, edgesFor(region.id))) {
        yield;
        if (!links) continue;
        this.regions.push(value);
        this.connections.push(...links);
        if (yield* this.search()) return true;
        this.regions.pop();
        this.connections.splice(this.connections.length - links.length);
        yield;
      }
    }
    return false;
  }
  protected *run(): Generator<void, CatalogSelection | null> {
    if (!(yield* this.search())) return null;
    return {
      generatorVersion: 1,
      definitionId: this.definition.id,
      definitionRevision: this.definition.revision,
      options: { seed: this.seed, maxSteps: this.maxSteps },
      regions: this.regions,
      connections: this.connections,
    };
  }
  override inspect() {
    return freezeCopy({
      ...super.inspect(),
      selectedRegions: this.regions,
      connections: this.connections,
    });
  }
  snapshot(): CatalogGenerationSnapshot {
    if (!this.result) fail("snapshot requires a completed catalog selection");
    return freezeCopy({
      version: 1,
      definition: this.definition,
      selection: this.result,
    });
  }
  static restore(snapshot: CatalogGenerationSnapshot): CatalogGenerator {
    if (snapshot.version !== 1)
      fail(`unsupported catalog snapshot version ${snapshot.version}`);
    const job = new CatalogGenerator(
      snapshot.definition,
      snapshot.selection.options,
    );
    const errors = validateCatalogSelection(job.definition, snapshot.selection);
    if (errors.length) fail(`invalid catalog snapshot: ${errors.join("; ")}`);
    job._result = freezeCopy(snapshot.selection);
    job._status = "succeeded";
    job.regions.push(...job.result!.regions);
    job.connections.push(...job.result!.connections);
    return job;
  }
}
