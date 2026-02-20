import type { Component } from "./Component.js";
import type { Entity } from "./Entity.js";
import type { Scene } from "./Scene.js";
import type { ComponentClass, PrefabOverrides } from "./types.js";

interface ComponentDef {
  cls: ComponentClass;
  args: unknown[];
}

/**
 * Declarative entity template with builder pattern.
 * Create a Prefab once, spawn many entities from it.
 */
export class Prefab {
  private _name: string;
  private _tags: string[] = [];
  private _components: ComponentDef[] = [];
  private _children: Prefab[] = [];

  constructor(name: string) {
    this._name = name;
  }

  /** Add tags to the prefab. */
  tag(...tags: string[]): this {
    this._tags.push(...tags);
    return this;
  }

  /** Add a component with constructor args. */
  with<C extends Component>(cls: ComponentClass<C>, ...args: unknown[]): this {
    this._components.push({ cls, args });
    return this;
  }

  /** Add a child prefab. */
  child(prefab: Prefab): this {
    this._children.push(prefab);
    return this;
  }

  /** Spawn an entity from this prefab in the given scene. */
  spawn(scene: Scene, overrides?: PrefabOverrides): Entity {
    const name = overrides?.name ?? this._name;
    const entity = scene.spawn(name);

    // Apply tags
    for (const t of this._tags) {
      entity.tags.add(t);
    }
    if (overrides?.tags) {
      for (const t of overrides.tags) {
        entity.tags.add(t);
      }
    }

    // Build override map for O(1) lookup
    const overrideMap = new Map<ComponentClass, unknown[]>();
    if (overrides?.components) {
      for (const entry of overrides.components) {
        overrideMap.set(entry.cls, entry.args);
      }
    }

    // Apply components — overrides replace matching component defs
    for (const def of this._components) {
      const args = overrideMap.get(def.cls) ?? def.args;
      const instance = new (def.cls as new (...a: unknown[]) => Component)(
        ...args,
      );
      entity.add(instance);
      overrideMap.delete(def.cls);
    }

    // Add any override components not in the original prefab
    for (const [cls, args] of overrideMap) {
      const instance = new (cls as new (...a: unknown[]) => Component)(...args);
      entity.add(instance);
    }

    // Spawn children
    for (const childPrefab of this._children) {
      childPrefab.spawn(scene);
    }

    return entity;
  }
}
