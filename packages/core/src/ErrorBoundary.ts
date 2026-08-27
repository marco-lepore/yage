import type { System } from "./System.js";
import type { Component } from "./Component.js";
import type { Logger } from "./Logger.js";
import { isThenable } from "./internal/thenable.js";

/** Identifies what threw, for the log message and the error snapshot. */
export interface CallbackErrorInfo {
  /** Human label for the kind of callback, e.g. "Collision handler". */
  kind: string;
  /** Owning or emitting entity name, when known. */
  entity?: string;
  /** Scene name, when known. */
  scene?: string;
  /** Event, action, or token name, when known. */
  event?: string;
}

/** A recorded failure, readable via `Inspector.getErrors().callbackErrors`. */
export interface CallbackErrorRecord extends CallbackErrorInfo {
  error: string;
}

const MAX_CALLBACK_ERRORS = 200;

/**
 * Wraps system, component, and developer-callback execution so a throw is
 * attributed to whoever threw, not whoever it reached: the culprit is
 * recorded (readable via `Inspector.getErrors().callbackErrors`), logged
 * through `Logger`, and rethrown. Nothing is disabled, unsubscribed,
 * cancelled, or muted — `GameLoop.tick()` is the one place that decides an
 * error is terminal, stopping the loop when a throw escapes an entire frame.
 */
export class ErrorBoundary {
  private logger: Logger;
  private callbackErrors: CallbackErrorRecord[] = [];
  /**
   * Errors already recorded and logged. A throw from `wrapCallback` (or a
   * nested `wrapComponent`) is typically caught again by an outer
   * `wrapSystem`/`wrapComponent` as it keeps propagating — e.g. a collision
   * handler's throw reaching the `SystemScheduler` wrap around
   * `PhysicsSystem.update`. This keeps that second catch from recording or
   * logging the same failure again under a less specific message.
   */
  private reported = new WeakSet<Error>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Wrap a system update call. Attributes a throw to the system, logs it, and
   * rethrows. `update`/`fixedUpdate` are typed void-returning but an `async`
   * one compiles against that signature, so a rejected thenable is reported
   * the same way — rethrown from inside its `.then` rejection handler, which
   * appears as a new unhandled rejection since the original call stack has
   * already returned.
   */
  wrapSystem(system: System, fn: () => void): void {
    try {
      const result = fn() as unknown;
      if (isThenable(result)) {
        result.then(undefined, (err: unknown) =>
          this._raise(err, { kind: `System ${system.constructor.name}` }),
        );
      }
    } catch (err) {
      this._raise(err, { kind: `System ${system.constructor.name}` });
    }
  }

  /**
   * Wrap a component lifecycle or update call. Attributes a throw to the
   * component, logs it, and rethrows. An `async` update or hook is reported
   * the same way as in {@link wrapSystem}.
   */
  wrapComponent(component: Component, fn: () => void): void {
    try {
      const result = fn() as unknown;
      if (isThenable(result)) {
        result.then(undefined, (err: unknown) =>
          this._raise(err, this._componentInfo(component)),
        );
      }
    } catch (err) {
      this._raise(err, this._componentInfo(component));
    }
  }

  /**
   * Wrap a developer-supplied callback the engine invokes on its own — a
   * collision handler, an entity/scene/bus event listener, an input
   * listener, a process callback, an audio unlock callback. Catches a
   * synchronous throw and, since these callbacks are typed void-returning
   * but nothing stops a caller from passing an `async` function anyway, a
   * rejected thenable too. Both are recorded, logged, and rethrown — a
   * rejected thenable is rethrown from inside its `.then` rejection handler,
   * which surfaces as a new unhandled rejection since nothing can rethrow
   * into the original (already-returned) call stack.
   */
  wrapCallback(fn: () => void, info: CallbackErrorInfo): void {
    try {
      const result = fn() as unknown;
      if (isThenable(result)) {
        result.then(undefined, (err: unknown) => this._raise(err, info));
      }
    } catch (err) {
      this._raise(err, info);
    }
  }

  /**
   * Wrap a scene-lifecycle hook (`onEnter`, `onExit`, `onPause`, `onResume`).
   * Reports through `Logger` and the error snapshot, then rethrows so
   * propagation to the caller is unchanged — a scene half-built by a
   * throwing hook must not look like it mounted cleanly. An async hook's
   * rejection can only be reported, not rethrown: the call already returned
   * by the time the rejection settles.
   */
  wrapLifecycleHook(fn: () => void, info: CallbackErrorInfo): void {
    try {
      const result = fn() as unknown;
      if (isThenable(result)) {
        result.then(undefined, (err: unknown) => this.reportLifecycleError(err, info));
      }
    } catch (err) {
      this.reportLifecycleError(err, info);
      throw err;
    }
  }

  /**
   * Report an already-caught lifecycle error (a `beforeEnter` hook awaited
   * inside its own try/catch, for instance) without invoking anything.
   */
  reportLifecycleError(err: unknown, info: CallbackErrorInfo): void {
    this._report(err, info);
  }

  /** Identity of a component for a report. Built on the failure path only. */
  private _componentInfo(component: Component): CallbackErrorInfo {
    return {
      kind: `Component ${component.constructor.name}`,
      entity: component.entity?.name ?? "unknown",
    };
  }

  /** Record, log, and rethrow — the shared path for wrapSystem/wrapComponent/wrapCallback. */
  private _raise(err: unknown, info: CallbackErrorInfo): never {
    throw this._report(err, info);
  }

  /** Record and log an error once per error object, returning the normalized `Error`. */
  private _report(err: unknown, info: CallbackErrorInfo): Error {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this.reported.has(error)) return error;
    this.reported.add(error);
    this.callbackErrors.push({ ...info, error: error.message });
    if (this.callbackErrors.length > MAX_CALLBACK_ERRORS) {
      this.callbackErrors.shift();
    }
    this.logger.error("core", this._describe(info), { error });
    return error;
  }

  /** Human-readable "kind threw on entity X in scene Y for event Z" prefix. */
  private _describe(info: CallbackErrorInfo): string {
    let message = `${info.kind} threw`;
    if (info.entity !== undefined) message += ` on entity "${info.entity}"`;
    if (info.scene !== undefined) message += ` in scene "${info.scene}"`;
    if (info.event !== undefined) message += ` for event "${info.event}"`;
    return message;
  }

  /** Get recorded failures for inspection. */
  getCallbackErrors(): readonly CallbackErrorRecord[] {
    return this.callbackErrors;
  }

  /** Clear recorded callback failures. */
  clearCallbackErrors(): void {
    this.callbackErrors.length = 0;
  }
}
