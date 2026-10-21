import { instantiateLevel } from "@yagejs/level";
import type { LevelInstance, PreparedLevel } from "@yagejs/level";
import type { Scene } from "@yagejs/core";
import type { CatalogDefinition, RoomLayout, TileScale } from "./core/types.js";
import { validateRoomLayout } from "./core/layout.js";
import { fail } from "./core/geometry.js";
import { resolveTileScale } from "./scale.js";

/** Earlier successful loads remain owned by the caller when a later room throws. */
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
 * Instantiate prepared authored room content at generated offsets. Returns the
 * existing level handles; the game owns their lifetime and door/wall rendering.
 */
export function instantiateRoomLayout(
  scene: Scene,
  definition: CatalogDefinition,
  layout: RoomLayout,
  levels: Readonly<Record<string, PreparedLevel>>,
  namespace: string,
  scale: TileScale,
): readonly LevelInstance[] {
  const { tileWidth, tileHeight } = resolveTileScale(scale);
  const errors = validateRoomLayout(definition, layout);
  if (errors.length) fail(`invalid level layout: ${errors.join("; ")}`);
  if (!namespace || namespace.includes("/"))
    fail("instantiateRoomLayout namespace must be non-empty and contain no /");
  for (const [index, room] of layout.rooms.entries()) {
    if (!Object.hasOwn(levels, room.templateId))
      fail(`missing prepared level for template "${room.templateId}"`);
    const prepared = levels[room.templateId]!;
    if (prepared.diagnostics.length)
      fail(`prepared level for template "${room.templateId}" has diagnostics`);
    for (const { placement } of prepared.placements) {
      const key = `${namespace}:${index}/${placement.key ?? placement.id}`;
      if (scene.findByKey(key))
        fail(`instantiateRoomLayout: scene key "${key}" is already occupied`);
    }
  }
  const instances: LevelInstance[] = [];
  for (const [index, room] of layout.rooms.entries()) {
    try {
      instances.push(
        instantiateLevel(scene, levels[room.templateId]!, {
          namespace: `${namespace}:${index}`,
          transform: {
            position: { x: room.x * tileWidth, y: room.y * tileHeight },
          },
        }),
      );
    } catch (cause) {
      throw new RoomLayoutLoadError(room.id, instances, cause);
    }
  }
  return instances;
}
