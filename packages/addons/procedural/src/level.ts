import { instantiateLevel } from "@yagejs/level";
import type { LevelInstance, PreparedLevel } from "@yagejs/level";
import type { Scene } from "@yagejs/core";
import type { RoomLayout, TileScale } from "./core/types.js";
import { assertPositive, fail } from "./core/internal.js";

export interface RoomLayoutLoadOptions extends TileScale {
  /** Prepared level content for each template id the layout uses. */
  readonly levels: Readonly<Record<string, PreparedLevel>>;
  /** Room `i` loads with namespace `<namespace>:<i>`, in layout order. */
  readonly namespace: string;
}

/** Thrown when one room fails to load. Rooms loaded before it stay in the scene and are the caller's to dispose. */
export class RoomLayoutLoadError extends Error {
  readonly instances: readonly LevelInstance[];
  constructor(
    readonly roomId: string,
    instances: readonly LevelInstance[],
    cause: unknown,
  ) {
    super(`instantiateRoomLayout: loading room "${roomId}" failed`, { cause });
    this.name = "RoomLayoutLoadError";
    this.instances = Object.freeze([...instances]);
  }
}

/**
 * Loads each room's prepared level at the room's position: its tile offset
 * times the tile size. Returns one instance per room, in layout order; the
 * game owns their lifetime. Walls, doors and locks stay game code.
 */
export function instantiateRoomLayout(
  scene: Scene,
  layout: RoomLayout,
  options: RoomLayoutLoadOptions,
): readonly LevelInstance[] {
  assertPositive("instantiateRoomLayout tileWidth", options.tileWidth);
  assertPositive("instantiateRoomLayout tileHeight", options.tileHeight);
  // Room namespaces append ":<index>", which would hide an empty one from
  // the level loader's own check.
  if (!options.namespace)
    fail("instantiateRoomLayout namespace must not be empty");
  // Missing or refused content is a predictable failure, so it throws
  // before any room loads.
  for (const room of layout.regions) {
    if (!Object.hasOwn(options.levels, room.templateId))
      fail(
        `instantiateRoomLayout has no prepared level for template "${room.templateId}"`,
      );
    const { diagnostics } = options.levels[room.templateId]!;
    if (diagnostics.length)
      fail(
        `instantiateRoomLayout: prepared level for template "${room.templateId}" has ${diagnostics.length} diagnostics`,
      );
  }
  const instances: LevelInstance[] = [];
  for (const [index, room] of layout.regions.entries()) {
    try {
      instances.push(
        instantiateLevel(scene, options.levels[room.templateId]!, {
          namespace: `${options.namespace}:${index}`,
          transform: {
            position: {
              x: room.x * options.tileWidth,
              y: room.y * options.tileHeight,
            },
          },
        }),
      );
    } catch (cause) {
      throw new RoomLayoutLoadError(room.id, instances, cause);
    }
  }
  return instances;
}
