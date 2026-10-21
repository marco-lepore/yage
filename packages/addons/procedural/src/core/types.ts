/** Integer tile coordinates. Engine adapters convert tiles to world pixels. */
export interface TilePoint {
  readonly x: number;
  readonly y: number;
}
export interface TileBounds extends TilePoint {
  readonly width: number;
  readonly height: number;
}
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
  readonly seed: number;
  readonly maxSteps?: number;
}
export interface GenerationDiagnostic {
  readonly code: string;
  readonly message: string;
}
export interface GenerationInspection {
  readonly status: GenerationStatus;
  readonly steps: number;
  readonly diagnostics: readonly GenerationDiagnostic[];
}
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
  readonly requires?: readonly string[];
}
/** Undirected connection. Every listed key is required to cross it. */
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
export interface RegionRequirements {
  readonly start: Region;
  readonly required?: readonly Region[];
  /** Counts include start and named required regions. Omitted max equals min. */
  readonly counts?: readonly {
    readonly kind: string;
    readonly min: number;
    readonly max?: number;
  }[];
  readonly minRegions: number;
  readonly fillKind: string;
  /** Unordered pairs of region kinds that must not connect directly. */
  readonly forbiddenConnections?: readonly (readonly [string, string])[];
  /** Default 4. Bounds the degree of the generated tree. */
  readonly maxConnections?: number;
}
export type RoomSide = "north" | "east" | "south" | "west";
export interface CatalogPort {
  readonly id: string;
  readonly socket?: string;
  /** Maximum links using this connection, default 1. */
  readonly capacity?: number;
}
export interface RoomConnectionArea extends CatalogPort {
  readonly id: string;
  readonly side: RoomSide;
  /** Inclusive range of opening start positions, or one fixed position. */
  readonly offset: number | { readonly min: number; readonly max: number };
  readonly width?: number;
  readonly socket?: string;
}
/** Exact opening selected from a catalog connection area. */
export interface RoomOpening {
  readonly areaId: string;
  readonly side: RoomSide;
  readonly offset: number;
  readonly width: number;
  readonly socket: string;
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
export interface CatalogVariant {
  readonly id: string;
  /** Positive relative search preference, default 1. Hard constraints take priority. */
  readonly weight?: number;
  /** Shallowly overrides the entry metadata. */
  readonly metadata?: CatalogMetadata;
  /** Added to the entry tags. */
  readonly tags?: readonly string[];
  readonly regionIds?: readonly string[];
  readonly kinds?: readonly string[];
  /** Replaces the entry's complete connection list. */
  readonly connections?: readonly (CatalogPort | RoomConnectionArea)[];
  readonly size?: { readonly width: number; readonly height: number };
  /** Replaces the mask; null explicitly removes an inherited mask. */
  readonly navigation?: readonly string[] | null;
}
export interface CatalogEntry {
  readonly id: string;
  readonly kinds: readonly string[];
  readonly connections: readonly (CatalogPort | RoomConnectionArea)[];
  readonly metadata?: CatalogMetadata;
  readonly tags?: readonly string[];
  readonly weight?: number;
  /** When supplied, exactly one variant is selected; the base is not a candidate. */
  readonly variants?: readonly CatalogVariant[];
  readonly size?: { readonly width: number; readonly height: number };
  readonly navigation?: readonly string[];
}
/** Spatial specialization of a catalog entry. */
export interface RoomTemplate extends CatalogEntry {
  readonly size: { readonly width: number; readonly height: number };
  readonly connections: readonly RoomConnectionArea[];
}
/** All specified fields must match; tags requires every listed tag. */
export interface CatalogSelector {
  readonly kind?: string;
  readonly templateId?: string;
  readonly variantId?: string;
  readonly tags?: readonly string[];
}
export interface CatalogRules {
  readonly counts?: readonly {
    readonly match: CatalogSelector;
    readonly min: number;
    readonly max?: number;
  }[];
  readonly regions?: readonly {
    readonly regionId: string;
    readonly match: CatalogSelector;
  }[];
  readonly forbiddenConnections?: readonly {
    readonly from: CatalogSelector;
    readonly to: CatalogSelector;
  }[];
}
export interface CatalogDefinition {
  readonly id: string;
  readonly revision: string;
  readonly templates: readonly CatalogEntry[];
  readonly graph: RegionGraph;
  readonly maxUses?: Readonly<Record<string, number>>;
  readonly rules?: CatalogRules;
}
export interface RoomDefinition extends CatalogDefinition {
  readonly templates: readonly RoomTemplate[];
}
export interface CatalogAssignment {
  readonly id: string;
  readonly templateId: string;
  readonly variantId: string | null;
  readonly metadata: CatalogMetadata;
  readonly tags: readonly string[];
}
export interface ResolvedCatalogEntry extends CatalogAssignment {
  readonly connections: readonly (CatalogPort | RoomConnectionArea)[];
  readonly size?: { readonly width: number; readonly height: number };
  readonly navigation?: readonly string[];
}
export interface CatalogLink {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly fromPort: string;
  readonly toPort: string;
}
export interface CatalogSelection {
  readonly generatorVersion: 1;
  readonly definitionId: string;
  readonly definitionRevision: string;
  readonly options: { readonly seed: number; readonly maxSteps: number };
  readonly regions: readonly CatalogAssignment[];
  readonly connections: readonly CatalogLink[];
}
export interface CatalogGenerationSnapshot {
  readonly version: 1;
  readonly definition: CatalogDefinition;
  readonly selection: CatalogSelection;
}
export interface RoomGenerationOptions extends GenerationOptions {
  readonly origin?: TilePoint;
  readonly bounds?: TileBounds;
  readonly preferUniqueTemplates?: boolean;
}
export interface ResolvedRoomOptions {
  readonly seed: number;
  readonly maxSteps: number;
  readonly origin: TilePoint;
  readonly bounds?: TileBounds;
  readonly preferUniqueTemplates: boolean;
}
export interface RoomPlacement extends TileBounds, CatalogAssignment {}
export interface RoomConnection {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly fromOpening: RoomOpening;
  readonly toOpening: RoomOpening;
}
export interface RoomLayout {
  readonly generatorVersion: 4;
  readonly definitionId: string;
  readonly definitionRevision: string;
  readonly options: ResolvedRoomOptions;
  readonly rooms: readonly RoomPlacement[];
  readonly connections: readonly RoomConnection[];
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly validation: {
    readonly requiredRegions: true;
    readonly nonOverlapping: true;
    readonly compatibleOpenings: true;
    readonly progression: true;
    /** null when at least one placed template has no navigation mask. All keys are assumed held. */
    readonly connectedWalkableCells: true | null;
  };
}
export interface RoomGenerationInspection extends GenerationInspection {
  readonly validation: RoomLayout["validation"] | null;
  readonly options: ResolvedRoomOptions;
  readonly placedRooms: readonly RoomPlacement[];
  readonly connections: readonly RoomConnection[];
  readonly rejections: Readonly<Record<string, number>>;
}
export interface RoomGenerationSnapshot {
  readonly version: 4;
  readonly definition: CatalogDefinition;
  readonly layout: RoomLayout;
}
export interface TileMap {
  readonly origin: TilePoint;
  readonly cells: readonly string[];
}
export interface CaveOptions extends GenerationOptions {
  readonly width: number;
  readonly height: number;
  /** Initial wall probability in [0, 1], default 0.45. */
  readonly wallProbability?: number;
  /** Cellular smoothing passes, default 4. */
  readonly iterations?: number;
}
