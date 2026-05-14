/**
 * Cache key for a single-image tileset's subtexture inside `Assets.cache`.
 * Keyed on the tileset's image path (rather than the user-supplied display
 * name) so two tilesets that happen to share a name don't collide on the
 * same entries — both the loader (writer) and `parseTiledMap` (reader)
 * use this helper to stay in lock-step.
 */
export function subtextureCacheKey(
  image: string | undefined,
  localId: number,
): string {
  return `${image ?? ""}:${localId}`;
}
