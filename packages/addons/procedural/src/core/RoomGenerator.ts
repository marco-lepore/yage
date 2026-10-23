import { GenerationSearch, restartAfter } from "./GenerationSearch.js";
import {
  portAvailable,
  sameData,
  selectionErrors,
  validateCatalogDefinition,
} from "./catalog.js";
import type { Candidate, CatalogCandidates } from "./catalog.js";
import {
  aligned,
  compatible,
  contains,
  direction,
  openingPoint,
  openings,
  openingsOverlap,
  overlaps,
} from "./geometry.js";
import { assertInteger, freezeCopy } from "./internal.js";
import { roomOpenings } from "./layout.js";
import type {
  CatalogLink,
  RegionConnection,
  RoomConnection,
  RoomConnectionArea,
  RoomDefinition,
  RoomGenerationInspection,
  RoomGenerationOptions,
  RoomLayout,
  RoomOpening,
  RoomPlacement,
  TileBounds,
  TilePoint,
} from "./types.js";

interface Placed {
  readonly candidate: Candidate;
  readonly room: RoomPlacement;
}

function linksOf(connections: readonly RoomConnection[]): CatalogLink[] {
  return connections.map((c) => ({
    ...c,
    fromPort: c.fromOpening.areaId,
    toPort: c.toOpening.areaId,
  }));
}

/**
 * Places a footprint for every region of the supplied graph so that every
 * connection becomes a pair of aligned, compatible openings. Rooms never
 * overlap. A cycle the footprints cannot close makes the search fail.
 */
export class RoomGenerator extends GenerationSearch<RoomLayout> {
  readonly definition: RoomDefinition;
  readonly origin: TilePoint;
  readonly bounds: TileBounds | undefined;
  readonly preferUniqueTemplates: boolean;
  private readonly candidates: CatalogCandidates;
  private readonly allowed = new Map<Candidate, readonly RoomOpening[]>();
  private readonly placed: Placed[] = [];
  private readonly connections: RoomConnection[] = [];
  private readonly rejections: Record<string, number> = {};
  constructor(definition: RoomDefinition, options: RoomGenerationOptions) {
    super(options, restartAfter(definition.graph.regions.length));
    this.definition = freezeCopy(definition);
    this.candidates = validateCatalogDefinition(this.definition, true);
    this.origin = freezeCopy(options.origin ?? { x: 0, y: 0 });
    assertInteger("RoomGenerator origin.x", this.origin.x, -Infinity);
    assertInteger("RoomGenerator origin.y", this.origin.y, -Infinity);
    this.bounds = options.bounds && freezeCopy(options.bounds);
    if (this.bounds) {
      assertInteger("RoomGenerator bounds.x", this.bounds.x, -Infinity);
      assertInteger("RoomGenerator bounds.y", this.bounds.y, -Infinity);
      assertInteger("RoomGenerator bounds.width", this.bounds.width, 1);
      assertInteger("RoomGenerator bounds.height", this.bounds.height, 1);
    }
    this.preferUniqueTemplates = options.preferUniqueTemplates ?? true;
  }
  override inspect(): RoomGenerationInspection {
    return {
      ...super.inspect(),
      regions: this.placed.map((p) => p.room),
      connections: [...this.connections],
      rejections: { ...this.rejections },
    };
  }
  protected *run(): Generator<void, RoomLayout | null> {
    this.placed.length = 0;
    this.connections.length = 0;
    if (!(yield* this.search())) return null;
    const graph = this.definition.graph;
    // Results follow the graph's own order.
    return {
      start: graph.start,
      regions: graph.regions.map(
        (region) => this.placed.find((p) => p.room.id === region.id)!.room,
      ),
      connections: graph.connections.map(
        (edge) => this.connections.find((c) => c.id === edge.id)!,
      ),
    };
  }

  private openingsOf(candidate: Candidate): readonly RoomOpening[] {
    let result = this.allowed.get(candidate);
    if (!result) {
      result = openings(candidate.ports as readonly RoomConnectionArea[]);
      this.allowed.set(candidate, result);
    }
    return result;
  }
  private reject(code: string, message: string): null {
    this.rejections[code] = (this.rejections[code] ?? 0) + 1;
    this.note(code, message);
    return null;
  }
  /** Whether `placed` can use `opening` for one more connection. */
  private free(
    placed: Placed,
    opening: RoomOpening,
    added: readonly RoomConnection[],
  ): boolean {
    const used = [...this.connections, ...added];
    return (
      portAvailable(placed.candidate, opening.areaId, linksOf(used)) &&
      !used.some(
        (c) =>
          (c.from === placed.room.id &&
            openingsOverlap(c.fromOpening, opening)) ||
          (c.to === placed.room.id && openingsOverlap(c.toOpening, opening)),
      )
    );
  }
  private fits(room: RoomPlacement): boolean {
    if (this.bounds && !contains(this.bounds, room)) {
      this.reject("bounds", `Room "${room.id}" does not fit the bounds.`);
      return false;
    }
    if (this.placed.some((p) => overlaps(room, p.room))) {
      this.reject("overlap", `Room "${room.id}" overlaps a placed room.`);
      return false;
    }
    return true;
  }
  /** The connection with `aOpening` at room `aId`'s end. */
  private connect(
    edge: RegionConnection,
    aId: string,
    aOpening: RoomOpening,
    bOpening: RoomOpening,
  ): RoomConnection {
    return edge.from === aId
      ? { ...edge, fromOpening: aOpening, toOpening: bOpening }
      : { ...edge, fromOpening: bOpening, toOpening: aOpening };
  }
  /** Every way to realise the remaining edges with exactly aligned free openings. */
  private *completeConnections(
    room: Placed,
    edges: readonly RegionConnection[],
    added: readonly RoomConnection[],
  ): Generator<readonly RoomConnection[] | null> {
    const edge = edges[0];
    if (!edge) {
      yield added;
      return;
    }
    const otherId = edge.from === room.room.id ? edge.to : edge.from;
    const other = this.placed.find((p) => p.room.id === otherId)!;
    for (const a of this.random.shuffle([...this.openingsOf(room.candidate)]))
      for (const b of this.random.shuffle([
        ...this.openingsOf(other.candidate),
      ])) {
        if (!compatible(a, b) || !aligned(room.room, a, other.room, b)) {
          yield this.reject(
            "alignment",
            `Connection "${edge.id}" needs aligned, compatible openings.`,
          );
          continue;
        }
        if (!this.free(room, a, added) || !this.free(other, b, added)) {
          yield this.reject(
            "opening-used",
            `Connection "${edge.id}" needs an opening that is still free.`,
          );
          continue;
        }
        yield* this.completeConnections(room, edges.slice(1), [
          ...added,
          this.connect(edge, room.room.id, a, b),
        ]);
      }
  }
  private *placements(
    regionId: string,
    edges: readonly RegionConnection[],
  ): Generator<{
    placed: Placed;
    connections: readonly RoomConnection[];
  } | null> {
    const uses = (templateId: string): number =>
      this.placed.filter((p) => p.room.templateId === templateId).length;
    const choices = this.candidates.ordered(regionId, this.random);
    if (this.preferUniqueTemplates)
      choices.sort(
        (a, b) =>
          Number(uses(a.selected.templateId) > 0) -
          Number(uses(b.selected.templateId) > 0),
      );
    for (const candidate of choices) {
      const size = candidate.size!;
      const room = (x: number, y: number): Placed => ({
        candidate,
        room: {
          ...candidate.selected,
          x,
          y,
          ...size,
          ...(candidate.navigation ? { navigation: candidate.navigation } : {}),
        },
      });
      const broken = this.candidates.brokenRule(
        [...this.placed.map((p) => p.candidate), candidate],
        false,
      );
      if (broken) {
        yield this.reject(
          "catalog-rule",
          `A candidate for "${regionId}" breaks the ${broken}.`,
        );
        continue;
      }
      const anchor = edges[0];
      if (!anchor) {
        const placed = room(this.origin.x, this.origin.y);
        yield this.fits(placed.room) ? { placed, connections: [] } : null;
        continue;
      }
      const neighbourId = anchor.from === regionId ? anchor.to : anchor.from;
      const neighbour = this.placed.find((p) => p.room.id === neighbourId)!;
      const targets = this.openingsOf(candidate);
      for (const from of this.random.shuffle([
        ...this.openingsOf(neighbour.candidate),
      ])) {
        if (!this.free(neighbour, from, [])) {
          yield this.reject(
            "opening-used",
            `Room "${neighbourId}" has no free opening there.`,
          );
          continue;
        }
        const matching = targets.filter((to) => compatible(from, to));
        if (!matching.length) {
          yield this.reject(
            "socket",
            `Templates "${neighbour.room.templateId}" and "${candidate.selected.templateId}" need openings on opposite sides with equal widths and sockets.`,
          );
          continue;
        }
        for (const to of this.random.shuffle(matching)) {
          const a = openingPoint(neighbour.room, from),
            b = openingPoint(size, to),
            d = direction[from.side];
          const placed = room(
            neighbour.room.x + a.x + d.x - b.x,
            neighbour.room.y + a.y + d.y - b.y,
          );
          if (!this.fits(placed.room)) {
            yield null;
            continue;
          }
          const first = this.connect(anchor, neighbourId, from, to);
          for (const connections of this.completeConnections(
            placed,
            edges.slice(1),
            [first],
          ))
            yield connections ? { placed, connections } : null;
        }
      }
    }
  }
  private *search(): Generator<void, boolean> {
    const graph = this.definition.graph;
    if (this.placed.length === graph.regions.length) {
      const broken = this.candidates.brokenRule(
        this.placed.map((p) => p.candidate),
        true,
      );
      if (broken)
        this.reject(
          "catalog-rule",
          `The complete layout breaks the ${broken}.`,
        );
      return !broken;
    }
    const isPlaced = (id: string): boolean =>
      this.placed.some((p) => p.room.id === id);
    const edgesToPlaced = (regionId: string): RegionConnection[] =>
      graph.connections.filter(
        (edge) =>
          (edge.from === regionId && isPlaced(edge.to)) ||
          (edge.to === regionId && isPlaced(edge.from)),
      );
    // Start first, then the region with the most placed neighbours.
    const region = this.placed.length
      ? graph.regions
          .filter((r) => !isPlaced(r.id) && edgesToPlaced(r.id).length)
          .sort(
            (a, b) => edgesToPlaced(b.id).length - edgesToPlaced(a.id).length,
          )[0]!
      : graph.regions.find((r) => r.id === graph.start)!;
    for (const option of this.placements(region.id, edgesToPlaced(region.id))) {
      yield;
      if (!option) continue;
      this.placed.push(option.placed);
      this.connections.push(...option.connections);
      if (yield* this.search()) return true;
      this.placed.pop();
      this.connections.splice(
        this.connections.length - option.connections.length,
      );
    }
    return false;
  }
}

/**
 * Errors for a saved layout checked against the current definition: the
 * catalog checks plus footprints, overlaps and opening alignment. Throws for
 * an invalid definition.
 */
export function validateRoomLayout(
  definition: RoomDefinition,
  layout: RoomLayout,
): readonly string[] {
  const candidates = validateCatalogDefinition(definition, true);
  const { errors, chosen } = selectionErrors(
    candidates,
    layout.start,
    layout.regions,
    linksOf(layout.connections),
  );
  if (errors.length) return errors;
  for (const room of layout.regions) {
    const candidate = chosen.get(room.id)!;
    if (
      !Number.isSafeInteger(room.x) ||
      !Number.isSafeInteger(room.y) ||
      room.width !== candidate.size!.width ||
      room.height !== candidate.size!.height ||
      !sameData(room.navigation, candidate.navigation)
    )
      errors.push(`Room "${room.id}" does not match its template's footprint.`);
  }
  for (let i = 0; i < layout.regions.length; i++)
    for (let j = i + 1; j < layout.regions.length; j++)
      if (overlaps(layout.regions[i]!, layout.regions[j]!))
        errors.push(
          `Rooms "${layout.regions[i]!.id}" and "${layout.regions[j]!.id}" overlap.`,
        );
  if (errors.length) return errors;
  const byId = new Map(layout.regions.map((room) => [room.id, room]));
  const declared = (roomId: string, opening: RoomOpening): boolean =>
    openings(chosen.get(roomId)!.ports as readonly RoomConnectionArea[]).some(
      (allowed) => sameData(allowed, opening),
    );
  for (const edge of layout.connections) {
    if (
      !declared(edge.from, edge.fromOpening) ||
      !declared(edge.to, edge.toOpening) ||
      !compatible(edge.fromOpening, edge.toOpening) ||
      !aligned(
        byId.get(edge.from)!,
        edge.fromOpening,
        byId.get(edge.to)!,
        edge.toOpening,
      )
    )
      errors.push(
        `Connection "${edge.id}" has undeclared or misaligned openings.`,
      );
  }
  for (const room of layout.regions) {
    const used = roomOpenings(layout, room.id);
    if (
      used.some((a, i) => used.slice(i + 1).some((b) => openingsOverlap(a, b)))
    )
      errors.push(`Room "${room.id}" has overlapping openings.`);
  }
  return errors;
}
