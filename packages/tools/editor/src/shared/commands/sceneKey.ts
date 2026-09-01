import type { LevelPlacement } from "@yagejs/level/document";

/**
 * The scene key a placement derives: its `key`, or its `id` when it has none.
 *
 * `instantiateLevel` builds every runtime key as `<namespace>/<this>`, so the
 * two fields share one space and a `key` can collide with another placement's
 * `id`. `readLevel` refuses a document where two placements derive one.
 */
export function derivedSceneKey(placement: LevelPlacement): string {
  return placement.key ?? placement.id;
}

/** The placement other than `exceptId` that already derives `key`, if any. */
export function sceneKeyHolder(
  entities: readonly LevelPlacement[],
  key: string,
  exceptId?: string,
): LevelPlacement | undefined {
  return entities.find(
    (placement) =>
      placement.id !== exceptId && derivedSceneKey(placement) === key,
  );
}
