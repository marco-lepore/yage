/**
 * Build the stable identity key for an entity sourced from a Tiled object.
 *
 * Format: `<prefix>#object:<id>`. The prefix is normally the map's asset path
 * (e.g. `/assets/dungeon/dungeon-map.json#object:42`); pass an explicit prefix
 * when distinguishing between multiple instances of the same map.
 *
 * Use this to thread Tiled object identity into `scene.spawn(Class, params, { key })`
 * so reactive stores (`createSet<string>`, `createMap<string, T>`) can key off
 * authored level content without each game inventing its own naming scheme.
 */
export function tiledObjectKey(prefix: string, objectId: number): string {
  return `${prefix}#object:${objectId}`;
}
