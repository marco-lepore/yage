import type { ScenarioEntry } from "./ScenarioRegistry.js";

/** One scenario as the list shows it. */
export interface ScenarioLeaf {
  readonly kind: "scenario";
  readonly entry: ScenarioEntry;
  readonly label: string;
}

/** One level of nesting. Holds scenarios, deeper groups, or both. */
export interface ScenarioGroup {
  readonly kind: "group";
  readonly name: string;
  readonly children: readonly ScenarioNode[];
}

export type ScenarioNode = ScenarioGroup | ScenarioLeaf;

interface MutableGroup {
  readonly kind: "group";
  readonly name: string;
  readonly children: ScenarioNode[];
}

/**
 * Nests scenarios by the group path the registry gave each one.
 *
 * A group appears where its first member does, and the entries arrive sorted
 * by title, so the tree comes out in path order without a second sort.
 */
export function buildScenarioTree(
  entries: readonly ScenarioEntry[],
): readonly ScenarioNode[] {
  const roots: ScenarioNode[] = [];
  // Keyed by the full path so two groups of the same name under different
  // parents stay apart.
  const groups = new Map<string, MutableGroup>();

  for (const entry of entries) {
    let siblings = roots;
    let path = "";
    for (const name of entry.groups) {
      path = path === "" ? name : `${path}/${name}`;
      let group = groups.get(path);
      if (!group) {
        group = { kind: "group", name, children: [] };
        groups.set(path, group);
        siblings.push(group);
      }
      siblings = group.children;
    }
    siblings.push({ kind: "scenario", entry, label: entry.label });
  }

  return roots;
}
