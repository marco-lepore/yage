import type { ScenarioEntry } from "./ScenarioRegistry.js";

/** One scenario as the list shows it. */
export interface GroupedScenario {
  readonly entry: ScenarioEntry;
  /** The title without its group prefix, or the whole title when ungrouped. */
  readonly label: string;
}

export interface ScenarioGroup {
  /** The shared prefix, or `undefined` for titles that carry none. */
  readonly name: string | undefined;
  readonly entries: readonly GroupedScenario[];
}

/**
 * Splits a title at its first `/`, following the `"Combat / Slime takes a hit"`
 * convention. Only the first separator counts, so `"Combat / Ranged / Bow"`
 * groups under `Combat` and keeps the rest as its label. A title with no
 * separator, an empty prefix, or an empty remainder is ungrouped.
 */
function splitTitle(title: string): { group?: string; label: string } {
  const at = title.indexOf("/");
  if (at === -1) return { label: title.trim() };
  const group = title.slice(0, at).trim();
  const label = title.slice(at + 1).trim();
  if (group === "" || label === "") return { label: title.trim() };
  return { group, label };
}

/**
 * Buckets scenarios by the part of their title before the first `/`.
 *
 * Ungrouped entries come first, then each group in the order it first appears,
 * which is title order because the registry sorts by title.
 */
export function groupScenarios(
  entries: readonly ScenarioEntry[],
): readonly ScenarioGroup[] {
  const ungrouped: GroupedScenario[] = [];
  const groups = new Map<string, GroupedScenario[]>();

  for (const entry of entries) {
    const { group, label } = splitTitle(entry.title);
    const item: GroupedScenario = { entry, label };
    if (group === undefined) {
      ungrouped.push(item);
      continue;
    }
    const bucket = groups.get(group);
    if (bucket) bucket.push(item);
    else groups.set(group, [item]);
  }

  const out: ScenarioGroup[] = [];
  if (ungrouped.length > 0) out.push({ name: undefined, entries: ungrouped });
  for (const [name, items] of groups) out.push({ name, entries: items });
  return out;
}
