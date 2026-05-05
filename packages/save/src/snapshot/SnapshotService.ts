import type { Scene, Entity, Component, SnapshotResolver } from "@yagejs/core";
import {
  SceneManagerKey,
  SerializableRegistry,
  isSerializable,
  getSerializableType,
} from "@yagejs/core";
import type { EngineContext } from "@yagejs/core";
import type {
  SnapshotStorage,
  UntypedSlots,
  GameSnapshot,
  SceneSnapshotEntry,
  EntitySnapshotEntry,
  ComponentSnapshot,
  SnapshotContributor,
} from "./types.js";

/** Current snapshot format version. */
const SNAPSHOT_VERSION = 4;

/**
 * Component restoration priority. Components listed here are added first
 * (in order) to satisfy onAdd() dependencies.
 */
const COMPONENT_ORDER = [
  "Transform",
  "RigidBodyComponent",
  "ColliderComponent",
  "SpriteComponent",
  "GraphicsComponent",
  "AnimatedSpriteComponent",
  "AnimationController",
  "SoundComponent",
  "ParticleEmitterComponent",
  "TilemapComponent",
];

/** Orchestrates full game-state serialization and hydration. */
export class SnapshotService<TSlots extends UntypedSlots = UntypedSlots> {
  private readonly storage: SnapshotStorage;
  private readonly context: EngineContext;
  private readonly namespace: string;
  private readonly contributors = new Map<string, SnapshotContributor>();
  private _loading = false;

  constructor(
    storage: SnapshotStorage,
    context: EngineContext,
    namespace = "yage",
  ) {
    this.storage = storage;
    this.context = context;
    this.namespace = namespace;
  }

  // ---- Extension API ----

  /**
   * Register a plugin to contribute extra data to every snapshot under
   * `key`. The contributor's `serialize()` is invoked during `saveSnapshot`,
   * and its `restore(data)` runs after every scene + entity in the snapshot
   * has been hydrated. Re-registering an existing key replaces the previous
   * contributor.
   */
  registerSnapshotExtra(key: string, contributor: SnapshotContributor): void {
    this.contributors.set(key, contributor);
  }

  /** Remove a previously registered contributor. */
  unregisterSnapshotExtra(key: string): void {
    this.contributors.delete(key);
  }

  // ---- Snapshot API ----

  /** Save a snapshot of the current scene stack to the given slot. */
  saveSnapshot(slot: string): void {
    const snapshot = this.buildSnapshot();
    this.storage.save(
      this.key("snapshot", slot),
      JSON.stringify(snapshot),
    );
  }

  /** Load a snapshot from the given slot, rebuilding the scene stack. */
  async loadSnapshot(slot: string): Promise<void> {
    const snapshot = this.readSnapshot(slot);
    if (!snapshot) {
      throw new Error(`No save found in slot "${slot}".`);
    }
    await this.hydrateSnapshot(snapshot);
  }

  /** Export a previously saved snapshot from the given slot. */
  exportSnapshot(slot: string): GameSnapshot | null {
    return this.readSnapshot(slot);
  }

  /** Import a snapshot into the given slot and hydrate the scene stack. */
  async importSnapshot(slot: string, snapshot: GameSnapshot): Promise<void> {
    if (this._loading) {
      throw new Error("loadSnapshot already in progress.");
    }
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(
        `Save version mismatch: expected ${SNAPSHOT_VERSION}, got ${snapshot.version}.`,
      );
    }
    this.storage.save(
      this.key("snapshot", slot),
      JSON.stringify(snapshot),
    );
    await this.hydrateSnapshot(snapshot);
  }

  // ---- User Data API ----

  /** Save arbitrary structured data to a named slot. */
  saveData<K extends keyof TSlots & string>(slot: K, data: TSlots[K]): void {
    this.storage.save(this.key("data", slot), JSON.stringify(data));
  }

  /** Load structured data from a named slot. Returns null if not found. */
  loadData<K extends keyof TSlots & string>(slot: K): TSlots[K] | null {
    const raw = this.storage.load(this.key("data", slot));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as TSlots[K];
    } catch {
      return null;
    }
  }

  /** Read data from a slot for external use (cloud upload, file export). Alias for `loadData`. */
  exportData<K extends keyof TSlots & string>(slot: K): TSlots[K] | null {
    return this.loadData(slot);
  }

  /** Write externally-sourced data into a slot. Alias for `saveData` — no version check or hydration. */
  importData<K extends keyof TSlots & string>(slot: K, data: TSlots[K]): void {
    this.saveData(slot, data);
  }

  // ---- Snapshot management ----

  /** Check if a snapshot exists in the given slot. */
  hasSnapshot(slot: string): boolean {
    return this.storage.load(this.key("snapshot", slot)) !== null;
  }

  /** Delete a snapshot from the given slot. */
  deleteSnapshot(slot: string): void {
    this.storage.delete(this.key("snapshot", slot));
  }

  // ---- Data management ----

  /** Check if user data exists in the given slot. */
  hasData<K extends keyof TSlots & string>(slot: K): boolean {
    return this.storage.load(this.key("data", slot)) !== null;
  }

  /** Delete user data from the given slot. */
  deleteData<K extends keyof TSlots & string>(slot: K): void {
    this.storage.delete(this.key("data", slot));
  }

  // ---- Private helpers ----

  private key(prefix: string, slot: string): string {
    return `${this.namespace}:${prefix}:${slot}`;
  }

  private readSnapshot(slot: string): GameSnapshot | null {
    const raw = this.storage.load(this.key("snapshot", slot));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as GameSnapshot;
    } catch {
      return null;
    }
  }

  private buildSnapshot(): GameSnapshot {
    const sceneManager = this.context.resolve(SceneManagerKey);
    const scenes: SceneSnapshotEntry[] = [];

    for (const scene of sceneManager.all) {
      if (!isSerializable(scene)) continue;
      const type = getSerializableType(scene);
      if (!type) continue;

      const entities: EntitySnapshotEntry[] = [];
      for (const entity of scene.getEntities()) {
        if (!isSerializable(entity)) continue;
        entities.push(this.serializeEntity(entity));
      }

      const userData = scene.serialize?.();

      scenes.push({
        type,
        paused: scene.paused,
        entities,
        userData,
      });
    }

    const extras: Record<string, unknown> = {};
    let hasExtras = false;
    for (const [key, contributor] of this.contributors) {
      // Isolate each contributor — a single failing one (e.g. a third-party
      // plugin throwing during serialize) shouldn't poison the rest of the
      // snapshot. Log and continue.
      try {
        const data = contributor.serialize();
        if (data !== undefined) {
          extras[key] = data;
          hasExtras = true;
        }
      } catch (err) {
        console.error(
          `SnapshotService: contributor "${key}" serialize failed; ` +
            `omitting its extras from this snapshot.`,
          err,
        );
      }
    }

    return {
      version: SNAPSHOT_VERSION,
      timestamp: Date.now(),
      scenes,
      ...(hasExtras ? { extras } : {}),
    };
  }

  private async hydrateSnapshot(snapshot: GameSnapshot): Promise<void> {
    if (this._loading) {
      throw new Error("loadSnapshot already in progress.");
    }
    this._loading = true;
    try {
      if (snapshot.version !== SNAPSHOT_VERSION) {
        throw new Error(
          `Save version mismatch: expected ${SNAPSHOT_VERSION}, got ${snapshot.version}.`,
        );
      }

      const sceneManager = this.context.resolve(SceneManagerKey);
      await sceneManager.popAll();

      for (const entry of snapshot.scenes) {
        const SceneClass = SerializableRegistry.get(entry.type) as
          | (new () => Scene)
          | undefined;
        if (!SceneClass) {
          throw new Error(
            `Cannot load scene type "${entry.type}". ` +
              `Ensure the scene class is decorated with @serializable.`,
          );
        }

        const scene = new SceneClass();

        // Instance-patch onEnter: restore entities + call afterRestore instead
        scene.onEnter = () => {
          this.restoreSceneEntities(scene, entry);
        };

        await sceneManager.push(scene);

        if (entry.paused) {
          scene.paused = true;
        }
      }

      // Run snapshot contributors after every scene is pushed and entities
      // restored. By this point any layer/scene render trees the renderer
      // contributor needs to find by name are live, and component-scope
      // afterRestore hooks have run, so contributors see consistent state.
      //
      // Iterate every REGISTERED contributor — not just keys present in
      // `extras` — so contributors get a chance to clear stale baseline
      // state (e.g. a screen-scope vignette enabled after the save) when
      // the snapshot has no entry for them. Contributors must treat
      // `data === undefined` as "reset to empty".
      const extras = snapshot.extras ?? {};
      for (const [key, contributor] of this.contributors) {
        // Isolate each contributor — one bad restore (e.g. a third-party
        // plugin choking on a partially-compatible payload) shouldn't abort
        // the whole load and leave the engine in a half-restored state.
        try {
          await contributor.restore(extras[key]);
        } catch (err) {
          console.error(
            `SnapshotService: contributor "${key}" restore failed; continuing.`,
            err,
          );
        }
      }
      for (const key of Object.keys(extras)) {
        if (!this.contributors.has(key)) {
          console.warn(
            `SnapshotService: snapshot contains extras for "${key}" but no ` +
              `contributor is registered — skipping.`,
          );
        }
      }
    } finally {
      this._loading = false;
    }
  }

  private restoreSceneEntities(
    scene: Scene,
    entry: SceneSnapshotEntry,
  ): void {
    // Phase 1: Create all entities, add to scene, add components
    const idMap = new Map<number, Entity>();
    const entityEntries: Array<{
      entity: Entity;
      entry: EntitySnapshotEntry;
      restoredComponents: Array<{ component: Component; data: unknown }>;
    }> = [];

    for (const entityEntry of entry.entities) {
      const EntityClass = SerializableRegistry.get(entityEntry.type) as
        | (new () => Entity)
        | undefined;
      if (!EntityClass) {
        console.warn(
          `Entity type "${entityEntry.type}" not found in registry — skipping.`,
        );
        continue;
      }

      const entity = new EntityClass();
      scene._addExistingEntity(entity);
      const restoredComponents = this.restoreEntityComponents(
        entity,
        entityEntry.components,
      );

      idMap.set(entityEntry.id, entity);
      entityEntries.push({ entity, entry: entityEntry, restoredComponents });
    }

    // Phase 2: Rewire parent/child relationships
    for (const { entity, entry: entityEntry } of entityEntries) {
      if (entityEntry.parentId != null && entityEntry.childName != null) {
        const parent = idMap.get(entityEntry.parentId);
        if (parent) {
          parent.addChild(entityEntry.childName, entity);
        } else {
          console.warn(
            `Parent entity (saved id ${entityEntry.parentId}) not found for child "${entity.name}" — restoring as root entity.`,
          );
        }
      }
    }

    // Build resolver for afterRestore hooks
    const resolver: SnapshotResolver = {
      entity(savedId: number) {
        return idMap.get(savedId) ?? null;
      },
    };

    // Phase 3: afterRestore hooks (components, then entities, then scene)
    for (const { entity, entry: entityEntry, restoredComponents } of entityEntries) {
      for (const { component, data } of restoredComponents) {
        component.afterRestore?.(data, resolver);
      }

      entity.afterRestore?.(entityEntry.userData, resolver);
    }

    scene.afterRestore?.(entry.userData, resolver);
  }

  private serializeEntity(entity: Entity): EntitySnapshotEntry {
    const type = getSerializableType(entity);
    if (!type) throw new Error("Entity is not serializable");

    const components: ComponentSnapshot[] = [];
    for (const component of entity.getAll()) {
      if (typeof component.serialize !== "function") continue;
      const data = component.serialize();
      if (data == null) continue;
      const compType =
        getSerializableType(component) ?? component.constructor.name;
      components.push({ type: compType, data });
    }

    const userData = entity.serialize?.();

    const result: EntitySnapshotEntry = {
      id: entity.id,
      type,
      components,
      userData,
    };

    // Capture parent/child relationship
    if (entity.parent && isSerializable(entity.parent)) {
      result.parentId = entity.parent.id;
      // Find the name this entity is registered under
      for (const [name, child] of entity.parent.children) {
        if (child === entity) {
          result.childName = name;
          break;
        }
      }
    } else if (entity.parent) {
      console.warn(
        `Entity "${entity.name}" has non-serializable parent "${entity.parent.name}" — parent/child relationship will not be saved.`,
      );
    }

    return result;
  }

  private restoreEntityComponents(
    entity: Entity,
    snapshots: ComponentSnapshot[],
  ): Array<{ component: Component; data: unknown }> {
    const sorted = [...snapshots].sort((a, b) => {
      const ai = COMPONENT_ORDER.indexOf(a.type);
      const bi = COMPONENT_ORDER.indexOf(b.type);
      return (ai >= 0 ? ai : 999) - (bi >= 0 ? bi : 999);
    });

    const restored: Array<{ component: Component; data: unknown }> = [];

    for (const snap of sorted) {
      const CompClass = SerializableRegistry.get(snap.type) as
        | ({ fromSnapshot?(data: unknown): Component } & (new (
            ...args: unknown[]
          ) => Component))
        | undefined;

      if (!CompClass || typeof CompClass.fromSnapshot !== "function") {
        // Not in registry or no fromSnapshot — entity handles in afterRestore
        continue;
      }

      const component = CompClass.fromSnapshot(snap.data);
      entity.add(component);
      restored.push({ component, data: snap.data });
    }

    return restored;
  }
}
