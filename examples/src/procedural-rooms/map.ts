import { Component, Entity, RandomKey } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import type { LevelInstance } from "@yagejs/level";
import {
  CatalogGenerator,
  CaveGenerator,
  GenerationController,
  ProceduralGenerationFinishedEvent,
  RoomGenerator,
} from "@yagejs-addons/procedural";
import type {
  CatalogSelection,
  GenerationDiagnostic,
  GenerationStatus,
  RoomDefinition,
  RoomLayout,
  RoomPlacement,
  TileMap,
} from "@yagejs-addons/procedural";
import { instantiateRoomLayout } from "@yagejs-addons/procedural/level";
import { KeyCollected, MapChanged, TILE_SCALE } from "./constants.js";
import { prepareRoomContent } from "./content.js";
import { dungeonDefinition, dungeonGraph, IMPOSSIBLE_BOUNDS } from "./rooms.js";

export type MapMode =
  | "dungeon"
  | "catalog"
  | "cave"
  | "small-budget"
  | "impossible";

/** Input action that switches to each mode. */
const MODE_ACTIONS: readonly (readonly [string, MapMode])[] = [
  ["dungeon", "dungeon"],
  ["catalog", "catalog"],
  ["cave", "cave"],
  ["budget", "small-budget"],
  ["impossible", "impossible"],
];

// ---------------------------------------------------------------------------
// MapState — the current generation job and its result
// ---------------------------------------------------------------------------

/**
 * Starts one generation job per mode and seed, and keeps its result and the
 * run's progress: visited rooms and collected keys. The job runs inside a
 * `GenerationController` on this entity, a bounded number of operations per
 * frame, so a slow search never stalls the game. Emits `MapChanged` on this
 * entity when a job starts and when it ends.
 */
export class MapState extends Component {
  static override readonly inspectExclude = [
    "input",
    "content",
    "instances",
    "loads",
    "job",
    "definition",
    "layout",
    "selection",
    "cave",
    "keys",
    "visited",
    "hasKey",
  ];
  private readonly input = this.service(InputManagerKey);
  private readonly keys = new Set<string>();
  private readonly visited = new Set<string>();
  private readonly content = prepareRoomContent();
  private instances: readonly LevelInstance[] = [];
  private loads = 0;
  private job: RoomGenerator | CatalogGenerator | CaveGenerator | undefined;
  private _mode: MapMode = "dungeon";
  private _seed = 0;
  /** The dungeon's catalog, for the dungeon, catalog and failure modes. */
  definition: RoomDefinition | undefined;
  layout: RoomLayout | null = null;
  selection: CatalogSelection | null = null;
  cave: TileMap | null = null;

  /** Keys are permanent: once collected, they open every matching lock. */
  readonly hasKey = (key: string): boolean => this.keys.has(key);

  get mode(): MapMode {
    return this._mode;
  }
  get seed(): number {
    return this._seed;
  }
  get status(): GenerationStatus {
    return this.job?.status ?? "running";
  }
  get steps(): number {
    return this.job?.steps ?? 0;
  }
  get diagnostics(): readonly GenerationDiagnostic[] {
    return this.job?.inspect().diagnostics ?? [];
  }
  /** What the map holds now. Tests read it through the Inspector. */
  get summary(): {
    mode: MapMode;
    seed: number;
    status: GenerationStatus;
    regions: number;
    keys: readonly string[];
    visited: readonly string[];
    caveSize: { width: number; height: number } | null;
  } {
    return {
      mode: this._mode,
      seed: this._seed,
      status: this.status,
      keys: [...this.keys],
      visited: [...this.visited],
      regions:
        this.layout?.regions.length ?? this.selection?.regions.length ?? 0,
      caveSize: this.cave
        ? { width: this.cave.cells[0]!.length, height: this.cave.cells.length }
        : null,
    };
  }

  onAdd(): void {
    this._seed = this.use(RandomKey).int(0, 999_999);
    this.listen(this.entity, ProceduralGenerationFinishedEvent, () =>
      this.finish(),
    );
    this.addCleanup(() => this.unload());
    this.start("dungeon");
  }

  update(): void {
    for (const [action, mode] of MODE_ACTIONS)
      if (this.input.isJustPressed(action)) {
        this.start(mode);
        return;
      }
    if (this.input.isJustPressed("reseed")) {
      this._seed = (this._seed + 1) % 1_000_000;
      // A new seed shows the same kind of map; the failure demos return to the dungeon.
      this.start(
        this._mode === "catalog" || this._mode === "cave"
          ? this._mode
          : "dungeon",
      );
    }
  }

  /** Entering a room for the first time collects every key it grants. */
  enter(room: RoomPlacement): void {
    if (this.visited.has(room.id)) return;
    this.visited.add(room.id);
    for (const key of room.grants ?? [])
      if (!this.keys.has(key)) {
        this.keys.add(key);
        this.entity.emit(KeyCollected, { key });
      }
  }

  private start(mode: MapMode): void {
    this._mode = mode;
    this.keys.clear();
    this.visited.clear();
    this.entity.remove(GenerationController);
    this.unload();
    this.layout = null;
    this.selection = null;
    this.cave = null;
    this.definition = undefined;
    const seed = this._seed;
    if (mode === "cave") {
      this.job = new CaveGenerator({
        seed,
        width: 72,
        height: 42,
        maxSteps: 100_000,
      });
    } else {
      this.definition = dungeonDefinition(dungeonGraph(seed));
      this.job =
        mode === "catalog"
          ? new CatalogGenerator(this.definition, { seed })
          : new RoomGenerator(this.definition, {
              seed,
              // Too small for fifteen rooms: the search stops without an answer.
              maxSteps: mode === "small-budget" ? 10 : 200_000,
              ...(mode === "impossible" ? { bounds: IMPOSSIBLE_BOUNDS } : {}),
            });
    }
    this.entity.add(new GenerationController(this.job, 1000));
    this.entity.emit(MapChanged);
  }

  private finish(): void {
    const job = this.job!;
    if (job instanceof CaveGenerator) this.cave = job.result;
    else if (job instanceof CatalogGenerator) this.selection = job.result;
    else {
      this.layout = job.result;
      if (this.layout)
        this.instances = instantiateRoomLayout(this.scene, this.layout, {
          levelFor: (room) => this.content[room.templateId],
          namespace: `rooms-${++this.loads}`,
          ...TILE_SCALE,
        });
    }
    this.entity.emit(MapChanged);
  }

  private unload(): void {
    for (const instance of this.instances) instance.dispose();
    this.instances = [];
  }
}

/** Holds the generated map and the run's state. */
export class MapHost extends Entity {
  state!: MapState;
  setup(): void {
    this.state = this.add(new MapState());
  }
}
