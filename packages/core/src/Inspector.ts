import { Transform } from "./Transform.js";
import type { Entity } from "./Entity.js";
import type { Component } from "./Component.js";
import type { SceneManager } from "./SceneManager.js";
import type { GameLoop } from "./GameLoop.js";
import {
  EngineContext,
  ErrorBoundaryKey,
  SystemSchedulerKey,
} from "./EngineContext.js";

/** Full engine state snapshot. */
export interface EngineSnapshot {
  frameCount: number;
  sceneStack: SceneSnapshot[];
  entityCount: number;
  systemCount: number;
  errors: ErrorSnapshot;
}

/** Snapshot of a single entity. */
export interface EntitySnapshot {
  id: number;
  name: string;
  tags: string[];
  components: string[];
  position?: { x: number; y: number };
}

/** Snapshot of a scene in the stack. */
export interface SceneSnapshot {
  name: string;
  entityCount: number;
  paused: boolean;
}

/** Snapshot of a registered system. */
export interface SystemSnapshot {
  name: string;
  phase: string;
  priority: number;
  enabled: boolean;
}

/** Snapshot of error boundary state. */
export interface ErrorSnapshot {
  disabledSystems: string[];
  disabledComponents: Array<{
    entity: string;
    component: string;
    error: string;
  }>;
}

/** Internal engine reference to avoid circular dependency with Engine class. */
interface EngineRef {
  readonly context: EngineContext;
  readonly scenes: SceneManager;
  readonly loop: GameLoop;
}

/**
 * Programmatic state queries for testing and debugging.
 * Exposed on `window.__yage__` in debug mode.
 */
export class Inspector {
  private engine: EngineRef;

  constructor(engine: EngineRef) {
    this.engine = engine;
  }

  /** Full state snapshot (serializable). */
  snapshot(): EngineSnapshot {
    return {
      frameCount: this.engine.loop.frameCount,
      sceneStack: this.getSceneStack(),
      entityCount: this.countEntities(),
      systemCount: this.getSystems().length,
      errors: this.getErrors(),
    };
  }

  /** Find entity by name in the active scene. */
  getEntityByName(name: string): EntitySnapshot | undefined {
    const entity = this.findActiveEntity(name);
    if (!entity) return undefined;
    return this.entityToSnapshot(entity);
  }

  /** Get entity position (from Transform component). */
  getEntityPosition(name: string): { x: number; y: number } | undefined {
    const entity = this.findActiveEntity(name);
    if (!entity) return undefined;
    const transform = this.getTransform(entity);
    if (!transform) return undefined;
    return { x: transform.position.x, y: transform.position.y };
  }

  /** Check if an entity has a component by class name string. */
  hasComponent(entityName: string, componentClass: string): boolean {
    return this.findComponentByName(entityName, componentClass) !== undefined;
  }

  /** Get component data (serializable subset) by class name string. */
  getComponentData(entityName: string, componentClass: string): unknown {
    const comp = this.findComponentByName(entityName, componentClass);
    if (!comp) return undefined;
    return this.serializeComponent(comp);
  }

  /** Get all entities in the active scene as snapshots. */
  getEntities(): EntitySnapshot[] {
    const scene = this.engine.scenes.active;
    if (!scene) return [];
    const result: EntitySnapshot[] = [];
    for (const entity of scene.getEntities()) {
      if (!entity.isDestroyed) {
        result.push(this.entityToSnapshot(entity));
      }
    }
    return result;
  }

  /** Get scene stack info. */
  getSceneStack(): SceneSnapshot[] {
    return this.engine.scenes.all.map((scene) => ({
      name: scene.name,
      entityCount: scene.getEntities().size,
      paused: scene.isPaused,
    }));
  }

  /** Get active system info. */
  getSystems(): SystemSnapshot[] {
    const scheduler = this.engine.context.tryResolve(SystemSchedulerKey);
    if (!scheduler) return [];
    return scheduler.getAllSystems().map((sys) => ({
      name: sys.constructor.name,
      phase: sys.phase,
      priority: sys.priority,
      enabled: sys.enabled,
    }));
  }

  /** Get disabled components/systems from error boundary. */
  getErrors(): ErrorSnapshot {
    const boundary = this.engine.context.tryResolve(ErrorBoundaryKey);
    if (!boundary) return { disabledSystems: [], disabledComponents: [] };
    const disabled = boundary.getDisabled();
    return {
      disabledSystems: disabled.systems.map(
        (s) => s.system.constructor.name,
      ),
      disabledComponents: disabled.components.map((c) => ({
        entity: c.component.entity?.name ?? "unknown",
        component: c.component.constructor.name,
        error: c.error,
      })),
    };
  }

  private findActiveEntity(name: string): Entity | undefined {
    return this.engine.scenes.active?.findEntity(name);
  }

  private findComponentByName(
    entityName: string,
    componentClass: string,
  ): Component | undefined {
    const entity = this.findActiveEntity(entityName);
    if (!entity) return undefined;
    for (const comp of entity.getAll()) {
      if (comp.constructor.name === componentClass) return comp;
    }
    return undefined;
  }

  private entityToSnapshot(entity: Entity): EntitySnapshot {
    const transform = this.getTransform(entity);
    const snapshot: EntitySnapshot = {
      id: entity.id,
      name: entity.name,
      tags: [...entity.tags],
      components: [...entity.getAll()].map((c) => c.constructor.name),
    };
    if (transform) {
      snapshot.position = {
        x: transform.position.x,
        y: transform.position.y,
      };
    }
    return snapshot;
  }

  private getTransform(entity: Entity): Transform | undefined {
    return entity.has(Transform) ? entity.get(Transform) : undefined;
  }

  private serializeComponent(comp: Component): unknown {
    const result: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(comp)) {
      if (key === "entity") continue;
      const value = (comp as unknown as Record<string, unknown>)[key];
      if (typeof value !== "function") {
        result[key] = value;
      }
    }
    return result;
  }

  private countEntities(): number {
    let count = 0;
    for (const scene of this.engine.scenes.all) {
      count += scene.getEntities().size;
    }
    return count;
  }
}
