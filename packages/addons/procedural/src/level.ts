import { instantiateLevel, levelSceneKeys } from "@yagejs/level";
import type { LevelInstance, PreparedLevel } from "@yagejs/level";
import type { Scene } from "@yagejs/core";
import type { RoomLayout, RoomPlacement, TileScale } from "./core/types.js";
import { assertPositive, fail } from "./core/internal.js";

export interface RoomLayoutLoadOptions extends TileScale {
  /**
   * The prepared level for one room, chosen by its template, variant or
   * metadata. Called once per room before any room loads.
   */
  readonly levelFor: (room: RoomPlacement) => PreparedLevel | undefined;
  /** Room `i` loads with namespace `<namespace>:<i>`, in layout order. */
  readonly namespace: string;
}

/**
 * Thrown when a room fails while it loads: an entity's setup throws, a
 * parameter fails to decode, or an entity an earlier room spawned holds one
 * of its keys. Rooms loaded before it stay in the scene and are the caller's
 * to dispose.
 */
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
 *
 * Every room's level and scene keys are checked before the first room loads,
 * so missing or refused content and a taken scene key load nothing.
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
  const planned = layout.regions.map((room, index) => {
    const label = `room "${room.id}" (template "${room.templateId}"${
      room.variantId === null ? "" : `, variant "${room.variantId}"`
    })`;
    const level = options.levelFor(room);
    if (!level)
      fail(`instantiateRoomLayout has no prepared level for ${label}`);
    if (level.diagnostics.length)
      fail(
        `instantiateRoomLayout: the prepared level for ${label} has ${level.diagnostics.length} diagnostics`,
      );
    const namespace = `${options.namespace}:${index}`;
    for (const key of levelSceneKeys(level, namespace))
      if (scene.findByKey(key))
        fail(
          `instantiateRoomLayout: scene key "${key}" for ${label} is already taken`,
        );
    return { room, level, namespace };
  });
  const instances: LevelInstance[] = [];
  for (const { room, level, namespace } of planned) {
    try {
      instances.push(
        instantiateLevel(scene, level, {
          namespace,
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
