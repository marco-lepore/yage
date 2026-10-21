import {
  assignment,
  CatalogCandidates,
  portAvailable,
  resolveRoomTemplate,
  spatialTemplate,
} from "./catalog.js";
import { createRandomService } from "@yagejs/core";
import type { RandomService } from "@yagejs/core";
import { GenerationSearch } from "./GenerationSearch.js";
import {
  compatible,
  contains,
  direction,
  fail,
  freezeCopy,
  openingPoint,
  openings,
  openingsOverlap,
  overlaps,
} from "./geometry.js";
import { resolveOptions, validateDefinition } from "./validate.js";
import { roomOpenings, validateRoomLayout } from "./layout.js";
import type {
  Region,
  RegionConnection,
  ResolvedRoomOptions,
  RoomConnection,
  CatalogDefinition,
  RoomGenerationInspection,
  RoomGenerationOptions,
  RoomGenerationSnapshot,
  RoomLayout,
  RoomOpening,
  RoomPlacement,
  RoomTemplate,
} from "./types.js";
interface Candidate {
  room: RoomPlacement;
  connections: RoomConnection[];
}

/** Embeds a region graph using catalog footprints and candidate boundary openings. */
export class RoomGenerator extends GenerationSearch<RoomLayout> {
  readonly definition: CatalogDefinition;
  readonly options: ResolvedRoomOptions;
  private readonly random: RandomService;
  private readonly catalog: CatalogCandidates;
  private readonly rooms: RoomPlacement[] = [];
  private readonly connections: RoomConnection[] = [];
  private readonly rejections: Record<string, number> = {};
  constructor(definition: CatalogDefinition, options: RoomGenerationOptions) {
    super(options);
    this.definition = validateDefinition(definition);
    this.options = resolveOptions(options);
    this.random = createRandomService(this.seed);
    this.catalog = new CatalogCandidates(this.definition);
  }
  override inspect(): RoomGenerationInspection {
    return freezeCopy({
      ...super.inspect(),
      validation: this.result?.validation ?? null,
      options: this.options,
      placedRooms: this.rooms,
      connections: this.connections,
      rejections: this.rejections,
    });
  }
  snapshot(): RoomGenerationSnapshot {
    if (!this.result)
      fail(
        "snapshot requires a completed layout; active searches cannot be resumed",
      );
    return freezeCopy({
      version: 4,
      definition: this.definition,
      layout: this.result,
    });
  }
  static restore(snapshot: RoomGenerationSnapshot): RoomGenerator {
    if (snapshot.version !== 4)
      fail(`unsupported snapshot version ${snapshot.version}`);
    const generator = new RoomGenerator(
      snapshot.definition,
      snapshot.layout.options,
    );
    const errors = validateRoomLayout(generator.definition, snapshot.layout);
    if (errors.length) fail(`invalid snapshot: ${errors.join("; ")}`);
    generator._result = freezeCopy(snapshot.layout);
    generator._status = "succeeded";
    generator.rooms.push(...generator.result!.rooms);
    generator.connections.push(...generator.result!.connections);
    generator.diagnostics.push(...generator.result!.diagnostics);
    return generator;
  }
  private reject(code: string, message: string): null {
    this.rejections[code] = (this.rejections[code] ?? 0) + 1;
    // Keep one current example per rejection category, rather than one per search operation.
    const index = this.diagnostics.findIndex((d) => d.code === code);
    if (index < 0) this.diagnostics.push({ code, message });
    else this.diagnostics[index] = { code, message };
    return null;
  }
  private template(room: RoomPlacement): RoomTemplate {
    return resolveRoomTemplate(this.definition, room);
  }
  private free(
    room: RoomPlacement,
    opening: RoomOpening,
    extra: RoomConnection[] = [],
  ): boolean {
    const choice = this.catalog.find(room)!;
    const links = [...this.connections, ...extra].map((edge) => ({
      ...edge,
      fromPort: edge.fromOpening.areaId,
      toPort: edge.toOpening.areaId,
    }));
    return (
      portAvailable(choice, opening.areaId, links) &&
      !roomOpenings(
        { connections: [...this.connections, ...extra] },
        room.id,
      ).some((used) => openingsOverlap(used, opening))
    );
  }
  private connection(
    edge: RegionConnection,
    a: RoomPlacement,
    opening: RoomOpening,
    b: RoomPlacement,
    other: RoomOpening,
  ): RoomConnection {
    return edge.from === a.id
      ? {
          id: edge.id,
          from: a.id,
          to: b.id,
          fromOpening: opening,
          toOpening: other,
        }
      : {
          id: edge.id,
          from: b.id,
          to: a.id,
          fromOpening: other,
          toOpening: opening,
        };
  }
  private *completeConnections(
    room: RoomPlacement,
    edges: RegionConnection[],
    extra: RoomConnection[] = [],
  ): Generator<RoomConnection[] | null> {
    if (!edges.length) {
      yield extra;
      return;
    }
    const edge = edges[0]!;
    const neighbour = this.rooms.find(
      (p) => p.id === (edge.from === room.id ? edge.to : edge.from),
    )!;
    for (const a of this.random.shuffle(openings(this.template(room))))
      for (const b of this.random.shuffle(openings(this.template(neighbour)))) {
        const p = openingPoint(this.template(room), a),
          q = openingPoint(this.template(neighbour), b),
          d = direction[a.side];
        if (
          !compatible(a, b) ||
          room.x + p.x + d.x !== neighbour.x + q.x ||
          room.y + p.y + d.y !== neighbour.y + q.y
        ) {
          yield this.reject(
            "alignment",
            `Connection "${edge.id}" needs aligned compatible openings.`,
          );
          continue;
        }
        if (!this.free(room, a, extra) || !this.free(neighbour, b, extra)) {
          yield this.reject(
            "opening-used",
            `Connection "${edge.id}" overlaps another opening.`,
          );
          continue;
        }
        yield* this.completeConnections(room, edges.slice(1), [
          ...extra,
          this.connection(edge, room, a, neighbour, b),
        ]);
      }
  }
  private *candidates(region: Region): Generator<Candidate | null> {
    const uses = (id: string): number =>
      this.rooms.filter((room) => room.templateId === id).length;
    const choices = this.catalog.ordered(region, this.random);
    if (this.options.preferUniqueTemplates)
      choices.sort(
        (a, b) =>
          Number(uses(a.templateId) > 0) - Number(uses(b.templateId) > 0),
      );
    const edges = this.definition.graph.connections.filter(
      (edge) =>
        (edge.from === region.id && this.rooms.some((r) => r.id === edge.to)) ||
        (edge.to === region.id && this.rooms.some((r) => r.id === edge.from)),
    );
    for (const choice of choices) {
      const template = spatialTemplate(choice)!;
      if (!this.catalog.accepts([...this.rooms, assignment(choice)])) {
        yield this.reject(
          "catalog-rule",
          `Selection for "${region.id}" violates catalog rules.`,
        );
        continue;
      }
      if (!this.rooms.length) {
        const room = {
          ...assignment(choice),
          ...this.options.origin,
          ...template.size,
        };
        yield this.fits(room) ? { room, connections: [] } : null;
        continue;
      }
      const anchor = edges[0]!;
      const neighbour = this.rooms.find(
        (r) => r.id === (anchor.from === region.id ? anchor.to : anchor.from),
      )!;
      const targetOpenings = openings(template);
      for (const from of this.random.shuffle(
        openings(this.template(neighbour)),
      )) {
        if (!this.free(neighbour, from)) {
          yield this.reject(
            "opening-used",
            `Room "${neighbour.id}" has an occupied opening.`,
          );
          continue;
        }
        const matches = targetOpenings.filter((to) => compatible(from, to));
        if (!matches.length) {
          yield this.reject(
            "socket",
            `Templates "${neighbour.templateId}" and "${template.id}" need opposite sides, equal widths and matching sockets.`,
          );
          continue;
        }
        for (const to of this.random.shuffle(matches)) {
          const a = openingPoint(this.template(neighbour), from),
            b = openingPoint(template, to),
            d = direction[from.side];
          const room = {
            ...assignment(choice),
            x: neighbour.x + a.x + d.x - b.x,
            y: neighbour.y + a.y + d.y - b.y,
            ...template.size,
          };
          if (!this.fits(room)) {
            yield null;
            continue;
          }
          const connection = this.connection(anchor, neighbour, from, room, to);
          for (const connections of this.completeConnections(
            room,
            edges.slice(1),
            [connection],
          ))
            yield connections ? { room, connections } : null;
        }
      }
    }
  }
  private fits(room: RoomPlacement): boolean {
    if (this.options.bounds && !contains(this.options.bounds, room)) {
      this.reject("bounds", `Room "${room.id}" exceeds bounds.`);
      return false;
    }
    if (this.rooms.some((placed) => overlaps(room, placed))) {
      this.reject("overlap", `Room "${room.id}" overlaps a placed footprint.`);
      return false;
    }
    return true;
  }
  private *search(): Generator<void, boolean> {
    if (this.rooms.length === this.definition.graph.regions.length)
      return this.catalog.accepts(this.rooms, true);
    const graph = this.definition.graph;
    const adjacent = (region: Region): number =>
      graph.connections.filter(
        (edge) =>
          (edge.from === region.id &&
            this.rooms.some((r) => r.id === edge.to)) ||
          (edge.to === region.id && this.rooms.some((r) => r.id === edge.from)),
      ).length;
    const region = !this.rooms.length
      ? graph.regions.find((r) => r.id === graph.start)!
      : graph.regions
          .filter(
            (r) => !this.rooms.some((p) => p.id === r.id) && adjacent(r) > 0,
          )
          .sort((a, b) => adjacent(b) - adjacent(a))[0]!;
    for (const candidate of this.candidates(region)) {
      if (!candidate) {
        yield;
        continue;
      }
      this.rooms.push(candidate.room);
      this.connections.push(...candidate.connections);
      yield;
      if (yield* this.search()) return true;
      this.rooms.pop();
      this.connections.splice(
        this.connections.length - candidate.connections.length,
      );
      yield;
    }
    return false;
  }
  protected *run(): Generator<void, RoomLayout | null> {
    if (!(yield* this.search())) return null;
    const layout: RoomLayout = {
      generatorVersion: 4,
      definitionId: this.definition.id,
      definitionRevision: this.definition.revision,
      options: this.options,
      rooms: this.rooms,
      connections: this.connections,
      diagnostics: this.diagnostics,
      validation: {
        requiredRegions: true,
        nonOverlapping: true,
        compatibleOpenings: true,
        progression: true,
        connectedWalkableCells: this.rooms.every(
          (room) => this.template(room).navigation,
        )
          ? true
          : null,
      },
    };
    const errors = validateRoomLayout(this.definition, layout);
    if (errors.length) fail(errors.join("; "));
    return layout;
  }
}
