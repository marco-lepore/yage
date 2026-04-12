import type { Component } from "./Component.js";
import type { ComponentClass } from "./types.js";

// Forward declarations for event payloads
type EntityRef = { readonly id: number; readonly name: string };
type SceneRef = { readonly name: string };

/** Base type for event map definitions. */
export type EventMap = Record<string, unknown>;

/** Well-known engine events. */
export interface EngineEvents {
  "entity:created": { entity: EntityRef };
  "entity:destroyed": { entity: EntityRef };
  "component:added": { entity: EntityRef; component: Component };
  "component:removed": { entity: EntityRef; componentClass: ComponentClass };
  "scene:pushed": { scene: SceneRef };
  "scene:popped": { scene: SceneRef };
  "scene:replaced": { oldScene: SceneRef; newScene: SceneRef };
  "engine:started": undefined;
  "engine:stopped": undefined;
}

/** Typed publish/subscribe event bus. */
export class EventBus<E = EventMap> {
  private handlers = new Map<keyof E, Array<(data: never) => void>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof E>(event: K, handler: (data: E[K]) => void): () => void {
    let list = this.handlers.get(event);
    if (!list) {
      list = [];
      this.handlers.set(event, list);
    }
    list.push(handler as (data: never) => void);
    return () => {
      const arr = this.handlers.get(event);
      if (arr) {
        const idx = arr.indexOf(handler as (data: never) => void);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
  }

  /** Subscribe to an event, auto-unsubscribe after first emission. */
  once<K extends keyof E>(event: K, handler: (data: E[K]) => void): () => void {
    const unsub = this.on(event, (data) => {
      unsub();
      handler(data);
    });
    return unsub;
  }

  /** Emit an event. Handlers are called synchronously in registration order. */
  emit<K extends keyof E>(event: K, data: E[K]): void {
    const list = this.handlers.get(event);
    if (!list) return;
    // Iterate a copy so handlers can unsubscribe during emission
    const snapshot = [...list];
    for (const handler of snapshot) {
      handler(data as never);
    }
  }

  /** Remove all handlers for an event, or all handlers if no event specified. */
  clear(event?: keyof E): void {
    if (event !== undefined) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
