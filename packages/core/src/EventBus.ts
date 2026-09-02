import type { Component } from "./Component.js";
import type { ComponentClass } from "./types.js";
import type { SceneTransitionKind } from "./SceneTransition.js";
import type { Scene } from "./Scene.js";
import type { ErrorBoundary } from "./ErrorBoundary.js";
import type { Entity } from "./Entity.js";

// Forward declaration for scene payloads
type SceneRef = { readonly name: string };

/** Base type for event map definitions. */
export type EventMap = Record<string, unknown>;

/** Well-known engine events. */
export interface EngineEvents {
  "entity:created": { entity: Entity };
  "entity:destroyed": { entity: Entity };
  "component:added": { entity: Entity; component: Component };
  "component:removed": { entity: Entity; componentClass: ComponentClass };
  "scene:pushed": { scene: SceneRef };
  "scene:popped": { scene: SceneRef };
  "scene:replaced": { oldScene: SceneRef; newScene: SceneRef };
  "scene:transition:started": {
    kind: SceneTransitionKind;
    fromScene: SceneRef | undefined;
    toScene: SceneRef | undefined;
  };
  "scene:transition:ended": {
    kind: SceneTransitionKind;
    fromScene: SceneRef | undefined;
    toScene: SceneRef | undefined;
  };
  // Full Scene (not SceneRef) — subscribers typically compare by identity
  // against a Scene reference and may cast to LoadingScene to call
  // continue()/progress. Widening here avoids forcing casts at every site.
  "scene:loading:progress": { scene: Scene; ratio: number };
  "scene:loading:done": { scene: Scene };
  "engine:started": undefined;
  "engine:stopped": undefined;
  // Viewport / device events. Emitted by RendererPlugin when the canvas
  // host element enters/exits fullscreen and when the device orientation
  // changes. `OrientationType` is the built-in DOM lib union.
  "screen:fullscreen": { active: boolean };
  "screen:orientation": { type: OrientationType };
}

/** Typed publish/subscribe event bus. */
export class EventBus<E = EventMap> {
  private handlers = new Map<keyof E, Array<(data: never) => void>>();
  private observers = new Set<(event: keyof E, data: E[keyof E]) => void>();
  private errorBoundary: ErrorBoundary | undefined;

  /**
   * Wire the error boundary so a throwing handler or `tap` observer is
   * reported instead of stopping every other listener. `EventBus` has no
   * `EngineContext` of its own (a no-arg constructor, usable standalone), so
   * `Engine` calls this once after both are constructed.
   * @internal
   */
  _setErrorBoundary(boundary: ErrorBoundary): void {
    this.errorBoundary = boundary;
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function bound to this
   * registration: the same function registered twice fires twice, and each
   * unsubscribe removes only its own entry, once.
   */
  on<K extends keyof E>(event: K, handler: (data: E[K]) => void): () => void {
    let list = this.handlers.get(event);
    if (!list) {
      list = [];
      this.handlers.set(event, list);
    }
    // One wrapper per registration: the same handler registered twice gets
    // two distinct entries, so each unsubscribe finds its own.
    const entry = (data: never): void => handler(data as E[K]);
    list.push(entry);
    // `clear()` drops the list from the map, so an unsubscribe held across it
    // touches the detached array, never a later registration.
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /** Subscribe to an event, auto-unsubscribe after first emission. */
  once<K extends keyof E>(event: K, handler: (data: E[K]) => void): () => void {
    // `fired` covers a re-entrant emit from an earlier handler: the wrapper is
    // still in that emit's snapshot after `unsub()` ran. Returns handler's
    // result (rather than discarding it) so a rejected thenable from an async
    // handler still reaches emit()'s wrapCallback.
    let fired = false;
    const unsub = this.on(event, (data) => {
      if (fired) return;
      fired = true;
      unsub();
      return handler(data);
    });
    return unsub;
  }

  /**
   * Emit an event. Handlers are called synchronously in registration order.
   */
  emit<K extends keyof E>(event: K, data: E[K]): void {
    const eventName = String(event);
    if (this.observers.size > 0) {
      const observers = [...this.observers];
      for (const observer of observers) {
        if (this.errorBoundary) {
          this.errorBoundary.wrapCallback(() => observer(event, data), {
            kind: "Event bus observer",
            event: eventName,
          });
        } else {
          observer(event, data);
        }
      }
    }

    const list = this.handlers.get(event);
    if (!list) return;
    // Iterate a copy so handlers can unsubscribe during emission
    const snapshot = [...list];
    for (const handler of snapshot) {
      if (this.errorBoundary) {
        this.errorBoundary.wrapCallback(() => handler(data as never), {
          kind: "Event bus handler",
          event: eventName,
        });
      } else {
        handler(data as never);
      }
    }
  }

  /**
   * Observe every emitted event. Observers run before the handlers of each
   * emit, inside the same error boundary as a handler: a throwing observer is
   * recorded, rethrown, and stops that emit's handlers. Used by tooling such
   * as the Inspector event log.
   */
  tap(observer: (event: keyof E, data: E[keyof E]) => void): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
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
