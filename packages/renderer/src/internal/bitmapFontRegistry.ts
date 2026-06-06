/**
 * Ownership ledger for baked bitmap-font families, keyed by the base font name
 * a `BitmapText` resolves against. A single baked family can have more than one
 * owner:
 *
 *   - each `installBitmapFont(name)` call (owner key `install:<name>`), and
 *   - each `webFont(path, { bitmap })` load (owner key `web-font:<path>`).
 *
 * Pixi's `BitmapFont.uninstall` and our emphasis-variant registry are both
 * global and NOT reference-counted, so tearing a family down the instant one
 * owner releases it would destroy the atlas under every other owner. This
 * ledger ref-counts by base name (an owner *set*, so re-acquiring under the
 * same key is idempotent — re-installing a font is one owner, not two) and
 * hands back the full list of installed names to uninstall only once the last
 * owner has let go. Keeping the actual Pixi teardown in the caller keeps this
 * module free of a `pixi.js` import, mirroring `bitmapFontVariants`.
 *
 * @internal
 */
interface BakedFamily {
  /** Owner keys currently holding this family alive. */
  owners: Set<string>;
  /**
   * Every Pixi font name installed for this family (base + emphasis variants),
   * unioned across owners so a final release uninstalls them all — even atlases
   * a clobbered re-bake orphaned from the variant registry.
   */
  names: Set<string>;
}

const bakedFamilies = new Map<string, BakedFamily>();

/**
 * Record that `owner` holds the baked family `baseName`, installed as `names`
 * (base first, then any emphasis variants). Re-acquiring under the same owner
 * key only unions in any newly-baked names — it does not add a second
 * reference, so an idempotent re-install stays a single owner.
 *
 * @internal
 */
export function acquireBakedFamily(
  owner: string,
  baseName: string,
  names: readonly string[],
): void {
  let entry = bakedFamilies.get(baseName);
  if (!entry) {
    entry = { owners: new Set(), names: new Set() };
    bakedFamilies.set(baseName, entry);
  }
  entry.owners.add(owner);
  for (const name of names) entry.names.add(name);
}

/**
 * Release `owner`'s hold on the baked family `baseName`. Returns every Pixi
 * font name to uninstall (base + variants) when the last owner let go, so the
 * caller can `BitmapFont.uninstall` each and drop the variant registry; returns
 * `null` while other owners still hold the family (or when the family/owner is
 * unknown), meaning nothing should be torn down.
 *
 * @internal
 */
export function releaseBakedFamily(
  owner: string,
  baseName: string,
): string[] | null {
  const entry = bakedFamilies.get(baseName);
  if (!entry) return null;
  entry.owners.delete(owner);
  if (entry.owners.size > 0) return null;
  bakedFamilies.delete(baseName);
  return [...entry.names];
}

/** Drop the baked-family ledger — test isolation only. @internal */
export function clearBakedFamilies(): void {
  bakedFamilies.clear();
}
