import type { HasProperties, MapObject } from "./types.js";

/**
 * Get a single property value by name.
 * Returns `undefined` if the property is not found.
 */
export function getProperty<T = unknown>(
  obj: HasProperties,
  name: string,
): T | undefined {
  const prop = obj.properties?.find((p) => p.name === name);
  return prop?.value as T | undefined;
}

/**
 * Get a pseudo-array of property values.
 *
 * Tiled doesn't support array properties natively, so a common convention
 * is to use indexed names like `spawns[0]`, `spawns[1]`, etc.
 * This function collects them into a proper array, preserving index order.
 *
 * The indices must run from 0 without gaps. A gap means a property was
 * renamed or deleted in Tiled, which would otherwise hand back an array with
 * `undefined` holes typed as values, so it throws naming the missing index.
 */
export function getPropertyArray<T = unknown>(
  obj: HasProperties,
  name: string,
): T[] {
  const pattern = new RegExp(`^${escapeRegex(name)}\\[(\\d+)\\]$`);
  const byIndex = new Map<number, T>();

  if (!obj.properties) return [];

  for (const prop of obj.properties) {
    const match = prop.name.match(pattern);
    if (match) {
      byIndex.set(Number.parseInt(match[1]!, 10), prop.value as T);
    }
  }

  const values: T[] = [];
  for (let index = 0; index < byIndex.size; index++) {
    if (!byIndex.has(index)) {
      const highest = Math.max(...byIndex.keys());
      throw new Error(
        `getPropertyArray: "${name}[${index}]" is missing, but "${name}[${highest}]" is set. Indexed properties must run from 0 without gaps.`,
      );
    }
    values.push(byIndex.get(index)!);
  }

  return values;
}

/**
 * Resolve a property of `type: "object"` (an ID reference) to the actual MapObject.
 * Returns `undefined` if the property doesn't exist or the referenced object isn't found.
 */
export function resolveObjectRef(
  obj: HasProperties,
  propName: string,
  allObjects: MapObject[],
): MapObject | undefined {
  const id = getProperty<number>(obj, propName);
  if (id === undefined) return undefined;
  return allObjects.find((o) => o.id === id);
}

/**
 * Resolve a pseudo-array of object ID references to actual MapObjects.
 * Uses the `name[0]`, `name[1]` convention.
 */
export function resolveObjectRefArray(
  obj: HasProperties,
  propName: string,
  allObjects: MapObject[],
): MapObject[] {
  const ids = getPropertyArray<number>(obj, propName);
  return ids
    .map((id) => allObjects.find((o) => o.id === id))
    .filter((o): o is MapObject => o !== undefined);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
