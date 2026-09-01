/**
 * What a click leaves selected.
 *
 * One rule for both places a developer picks placements — a hierarchy row and
 * the viewport. Holding the modifier toggles the placement in or out and
 * leaves the rest; without it a click replaces the selection, and a click on
 * nothing empties it.
 *
 * A hierarchy row always names a placement, so it passes an id and never
 * `null`. The viewport passes what the hit test found.
 */
export function selectedAfter(
  selection: ReadonlySet<string>,
  hit: string | null,
  additive: boolean,
): readonly string[] {
  if (hit === null) return additive ? [...selection] : [];
  if (!additive) return [hit];
  const next = new Set(selection);
  if (!next.delete(hit)) next.add(hit);
  return [...next];
}
