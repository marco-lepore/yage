/** Integer tile coordinates. Engine adapters convert tiles to world pixels. */
export interface TilePoint {
  readonly x: number;
  readonly y: number;
}
export interface TileSize {
  readonly width: number;
  readonly height: number;
}
export interface TileBounds extends TilePoint, TileSize {}
/** World-pixel size of one tile, used by the engine adapters. */
export interface TileScale {
  readonly tileWidth: number;
  readonly tileHeight: number;
}

export type GenerationStatus =
  | "running"
  | "succeeded"
  | "exhausted"
  | "budget-exceeded"
  | "cancelled";
export interface GenerationOptions {
  /** Unsigned 32-bit integer. The same inputs and seed give the same result. */
  readonly seed: number;
  /** Operation budget, default 20,000. */
  readonly maxSteps?: number;
}
export interface GenerationDiagnostic {
  readonly code: string;
  readonly message: string;
}
export interface GenerationInspection {
  readonly status: GenerationStatus;
  readonly seed: number;
  readonly steps: number;
  readonly diagnostics: readonly GenerationDiagnostic[];
}
/** What `GenerationController` drives. Every generator in this package implements it. */
export interface GenerationJob {
  readonly status: GenerationStatus;
  step(operations: number): GenerationStatus;
  inspect(): GenerationInspection;
  cancel(): void;
}

/** Keys are permanent, reusable capabilities. Entering a region collects its grants. */
export interface Region {
  readonly id: string;
  readonly kind: string;
  readonly grants?: readonly string[];
  /** Every listed key is needed to enter the region. */
  readonly requires?: readonly string[];
}
/** Undirected connection. Every listed key is needed to cross it. */
export interface RegionConnection {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly requires?: readonly string[];
}
export interface RegionGraph {
  readonly start: string;
  readonly regions: readonly Region[];
  readonly connections: readonly RegionConnection[];
}
export interface ProgressionOptions {
  /** Keys held before entering the start region. */
  readonly keys?: readonly string[];
  /** Collect the grants of every reached region, default true. Set false to test a fixed set of keys. */
  readonly collectKeys?: boolean;
}
export interface Progression {
  readonly reachable: readonly string[];
  readonly keys: readonly string[];
  readonly unreachable: readonly string[];
}

/**
 * Regions of one kind to create. The generator creates `min`, or a seeded
 * number in `[min, max]` when `max` is set. Named regions count toward the
 * total. An omitted `max` sets no upper limit.
 */
export interface RegionCount {
  readonly kind: string;
  readonly min: number;
  readonly max?: number;
}
export interface RegionRequirements {
  readonly start: Region;
  readonly required?: readonly Region[];
  readonly counts?: readonly RegionCount[];
  /** Regions of `fillKind` are added until the graph has this many regions. */
  readonly minRegions: number;
  readonly fillKind: string;
  /** Unordered pairs of region kinds that must not connect directly. */
  readonly forbiddenConnections?: readonly (readonly [string, string])[];
  /** Most neighbours of any one region, default 4. */
  readonly maxConnections?: number;
}

/** Serializable, game-owned data. Numbers must be finite. */
export type CatalogValue =
  | string
  | number
  | boolean
  | null
  | readonly CatalogValue[]
  | { readonly [key: string]: CatalogValue };
export type CatalogMetadata = Readonly<Record<string, CatalogValue>>;

/** A connection slot. Linked slots must have the same socket. */
export interface CatalogPort {
  readonly id: string;
  /** Default `"passage"`. */
  readonly socket?: string;
  /** Most links that may use this slot, default 1. */
  readonly capacity?: number;
}
export interface CatalogVariant {
  readonly id: string;
  /** Positive relative search preference, default 1. Hard rules take priority. */
  readonly weight?: number;
  /** Shallowly overrides the template metadata. */
  readonly metadata?: CatalogMetadata;
  /** Added to the template tags. */
  readonly tags?: readonly string[];
  /** Restricts the variant to these regions. */
  readonly regionIds?: readonly string[];
  /** Restricts the variant to these of the template's kinds. */
  readonly kinds?: readonly string[];
  /** Replaces the template's complete connection list. */
  readonly connections?: readonly CatalogPort[];
}
export interface CatalogTemplate {
  readonly id: string;
  /** Region kinds this template can represent. */
  readonly kinds: readonly string[];
  readonly connections: readonly CatalogPort[];
  readonly metadata?: CatalogMetadata;
  readonly tags?: readonly string[];
  readonly weight?: number;
  /** When supplied, exactly one variant is selected; the template itself is not a candidate. */
  readonly variants?: readonly CatalogVariant[];
}

export type RoomSide = "north" | "east" | "south" | "west";
/** Where on a room's boundary an opening may be placed. */
export interface RoomConnectionArea extends CatalogPort {
  readonly side: RoomSide;
  /**
   * Zero-based boundary column (north and south) or row (east and west) of
   * the opening's first tile: one fixed position, or an inclusive range.
   */
  readonly offset: number | { readonly min: number; readonly max: number };
  /** Opening width in tiles, default 1. */
  readonly width?: number;
}
export interface RoomVariant extends CatalogVariant {
  readonly connections?: readonly RoomConnectionArea[];
  readonly size?: TileSize;
  /** Replaces the mask; `null` removes an inherited mask. */
  readonly navigation?: readonly string[] | null;
}
/** A catalog template with a rectangular footprint, placed by translation only. */
export interface RoomTemplate extends CatalogTemplate {
  /** Footprint in tiles, walls included. */
  readonly size: TileSize;
  readonly connections: readonly RoomConnectionArea[];
  /**
   * Rows of `#` (blocked) and `.` (walkable) matching `size`. Omitted, the
   * room has walls on its boundary and an open floor inside.
   */
  readonly navigation?: readonly string[];
  readonly variants?: readonly RoomVariant[];
}

/** All specified fields must match; `tags` requires every listed tag. */
export interface CatalogSelector {
  readonly kind?: string;
  readonly templateId?: string;
  readonly variantId?: string;
  readonly tags?: readonly string[];
}
/** Number of selected regions matching `match`: at least `min` (default 0), at most `max` (default no limit). */
export interface CatalogCount {
  readonly match: CatalogSelector;
  readonly min?: number;
  readonly max?: number;
}
export interface CatalogRules {
  readonly counts?: readonly CatalogCount[];
  /** The named region selects only templates matching `match`. */
  readonly regions?: readonly {
    readonly regionId: string;
    readonly match: CatalogSelector;
  }[];
  /** No direct connection, in either direction, between matching selections. */
  readonly forbiddenConnections?: readonly {
    readonly from: CatalogSelector;
    readonly to: CatalogSelector;
  }[];
}
export interface CatalogDefinition {
  readonly graph: RegionGraph;
  readonly templates: readonly CatalogTemplate[];
  readonly rules?: CatalogRules;
}
export interface RoomDefinition extends CatalogDefinition {
  readonly templates: readonly RoomTemplate[];
}

/** A region of the supplied graph with the template and variant selected for it. */
export interface SelectedRegion extends Region {
  readonly templateId: string;
  readonly variantId: string | null;
  /** Template metadata merged with the variant's. */
  readonly metadata: CatalogMetadata;
  readonly tags: readonly string[];
}
/** A connection of the supplied graph with the slot used at each end. */
export interface CatalogLink extends RegionConnection {
  readonly fromPort: string;
  readonly toPort: string;
}
/** The supplied region graph, annotated with selections. */
export interface CatalogSelection extends RegionGraph {
  readonly regions: readonly SelectedRegion[];
  readonly connections: readonly CatalogLink[];
}

/** Exact opening selected from a room's connection area. */
export interface RoomOpening {
  readonly areaId: string;
  readonly side: RoomSide;
  readonly offset: number;
  readonly width: number;
  readonly socket: string;
}
export interface RoomPlacement extends SelectedRegion, TileBounds {
  /** The selected template's mask. Omitted when it has none. */
  readonly navigation?: readonly string[];
}
export interface RoomConnection extends RegionConnection {
  readonly fromOpening: RoomOpening;
  readonly toOpening: RoomOpening;
}
/** The supplied region graph, annotated with selections, positions and openings. */
export interface RoomLayout extends RegionGraph {
  readonly regions: readonly RoomPlacement[];
  readonly connections: readonly RoomConnection[];
}
export interface RoomGenerationOptions extends GenerationOptions {
  /** Top-left tile of the start room, default (0, 0). */
  readonly origin?: TilePoint;
  /** Every footprint must fit inside. */
  readonly bounds?: TileBounds;
  /** Try templates not yet placed first, default true. */
  readonly preferUniqueTemplates?: boolean;
}

export interface CatalogGenerationInspection extends GenerationInspection {
  readonly regions: readonly SelectedRegion[];
  readonly connections: readonly CatalogLink[];
}
export interface RoomGenerationInspection extends GenerationInspection {
  readonly regions: readonly RoomPlacement[];
  readonly connections: readonly RoomConnection[];
  /** Rejected candidates per category during the search so far. */
  readonly rejections: Readonly<Record<string, number>>;
}

/** Rows of `#` (blocked) and `.` (walkable) whose top-left tile is `origin`. */
export interface TileMap {
  readonly origin: TilePoint;
  readonly cells: readonly string[];
}
export interface CaveOptions extends GenerationOptions, TileSize {
  /** Top-left tile of the map, default (0, 0). */
  readonly origin?: TilePoint;
  /** Initial wall probability in [0, 1], default 0.45. */
  readonly wallProbability?: number;
  /** Cellular smoothing passes, default 4. */
  readonly iterations?: number;
}
