import type { System } from "./System.js";
import type { Component } from "./Component.js";
import type { Logger } from "./Logger.js";
import type { GameLoop } from "./GameLoop.js";
import { isThenable } from "./internal/thenable.js";

/**
 * What the engine does when developer code throws — a system or component's
 * own `update`, or a callback the engine invokes on the developer's behalf
 * (collision handler, event listener, process callback, ...).
 *
 * `"fatal"` reports the culprit with its stack, stops the game loop, and
 * rethrows so the failure reaches the host's error channel: a game running
 * with one part silently disabled is worse than one that stopped with
 * useful information. `"isolate"` disables/removes/mutes only the offender
 * and keeps the game running — a deliberate opt-in for a shipped build that
 * must not die in front of a player.
 */
export type ErrorPolicy = "fatal" | "isolate";

/**
 * How a throwing developer-supplied callback was handled after being
 * reported: the handler was unsubscribed (`removed`), left registered but
 * silenced against repeat failures (`muted`), its owning `Process` was
 * cancelled (`cancelled`), nothing further happens because the site has no
 * removal mechanism (`reported`), the throw continues up the call stack
 * unchanged (`propagated`, scene lifecycle hooks), or the game loop stopped
 * because the policy is `"fatal"` (`fatal` — nothing was unsubscribed, muted,
 * or cancelled, since the game is stopping regardless).
 */
export type CallbackOutcome =
  | "removed"
  | "muted"
  | "cancelled"
  | "reported"
  | "propagated"
  | "fatal";

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

/**
 * A recorded failure, readable via `Inspector.getErrors().callbackErrors`.
 * Covers developer callbacks under either policy, plus system/component
 * failures under `"fatal"` (under `"isolate"` those go to `disabledSystems`/
 * `disabledComponents` instead, since they're disabled rather than reported).
 */
export interface CallbackErrorRecord extends CallbackErrorInfo {
  outcome: CallbackOutcome;
  error: string;
}

/** Options for {@link ErrorBoundary.wrapCallback}. */
export interface WrapCallbackOptions {
  /**
   * Runs once when the callback throws (synchronously, or via a rejected
   * thenable) and the failure isn't suppressed by `muteKey`. Performs the
   * outcome's actual consequence — unsubscribe the handler, cancel a
   * process, and so on. `wrapCallback` itself never mutates call-site state.
   */
  onError?: () => void;
  /**
   * Dedupe key for "muted" sites (the global event bus): a throwing handler
   * stays registered and keeps running, but only its first failure per event
   * is logged and recorded. Keyed on the handler function plus the event
   * name, since the same function can be registered for more than one event.
   */
  muteKey?: { handler: object; event: string };
}

const MAX_CALLBACK_ERRORS = 200;

/**
 * Wraps system, component, and developer-callback execution so a throw is
 * attributed to whoever threw, not whoever it reached. Behavior is governed
 * by an {@link ErrorPolicy} fixed at construction: under `"fatal"` (the
 * engine default) every wrap method reports the culprit, stops the game
 * loop, and rethrows; under `"isolate"` it disables/removes/mutes the
 * offender and keeps the game running.
 */
export class ErrorBoundary {
  private logger: Logger;
  private policy: ErrorPolicy;
  private loop: GameLoop | undefined;
  private disabledSystems: Array<{ system: System; error: string }> = [];
  private disabledComponents: Array<{ component: Component; error: string }> = [];
  private callbackErrors: CallbackErrorRecord[] = [];
  private mutedCallbacks = new WeakMap<object, Set<string>>();
  /**
   * Errors already recorded, logged, and used to stop the loop under
   * `"fatal"`. A fatal error thrown from `wrapCallback` (or a nested
   * `wrapComponent`) is typically caught again by an outer
   * `wrapSystem`/`wrapComponent` as it keeps propagating — e.g. a collision
   * handler's throw reaching the `SystemScheduler` wrap around
   * `PhysicsSystem.update`. This keeps that second catch from recording or
   * logging the same failure again under a less specific message, or calling
   * `loop.stop()` a second time.
   */
  private fatalReported = new WeakSet<Error>();

  constructor(logger: Logger, policy: ErrorPolicy, loop?: GameLoop) {
    this.logger = logger;
    this.policy = policy;
    this.loop = loop;
  }

  /** Wrap a system update call. Under `"isolate"`, disables the system on throw. */
  wrapSystem(system: System, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      if (this.policy === "fatal") {
        this._raiseFatal(err, { kind: `System ${system.constructor.name}` });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      system.enabled = false;
      this.disabledSystems.push({ system, error: message });
      this.logger.error(
        "core",
        `System ${system.constructor.name} threw and was disabled`,
        { error: message },
      );
    }
  }

  /** Wrap a component lifecycle or update call. Under `"isolate"`, disables the component on throw. */
  wrapComponent(component: Component, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const entityName = component.entity?.name ?? "unknown";
      if (this.policy === "fatal") {
        this._raiseFatal(err, {
          kind: `Component ${component.constructor.name}`,
          entity: entityName,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      component.enabled = false;
      this.disabledComponents.push({ component, error: message });
      this.logger.error(
        "core",
        `Component ${component.constructor.name} on entity "${entityName}" threw and was disabled`,
        { error: message },
      );
    }
  }

  /**
   * Wrap a developer-supplied callback the engine invokes on its own — a
   * collision handler, an entity/scene/bus event listener, an input
   * listener, a process callback, an audio unlock callback. Catches a
   * synchronous throw and, since these callbacks are typed void-returning
   * but nothing stops a caller from passing an `async` function anyway, a
   * rejected thenable too.
   *
   * Under `"isolate"`, never disables a System or Component — `options.onError`
   * performs whatever the call site's outcome requires (unsubscribe, mute,
   * cancel), and the failure is recorded with the passed-in `outcome`. Under
   * `"fatal"`, `outcome` and `options.onError` are ignored — the callback's
   * owner isn't touched because the whole game is stopping — but the failure
   * is still recorded, with `outcome: "fatal"` in place of the passed-in one.
   */
  wrapCallback(
    fn: () => void,
    info: CallbackErrorInfo,
    outcome: CallbackOutcome,
    options?: WrapCallbackOptions,
  ): void {
    try {
      const result = fn() as unknown;
      if (isThenable(result)) {
        result.then(undefined, (err: unknown) => {
          if (this.policy === "fatal") {
            // Thrown from inside a .then rejection handler whose result is
            // never consumed — this rejects that promise, which surfaces as
            // a new unhandled rejection since nothing can rethrow into the
            // original (already-returned) call stack.
            this._raiseFatal(err, info);
            return;
          }
          this._reportCallback(err, info, outcome, options);
        });
      }
    } catch (err) {
      if (this.policy === "fatal") {
        this._raiseFatal(err, info);
        return;
      }
      this._reportCallback(err, info, outcome, options);
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
        result.then(undefined, (err: unknown) => {
          this.reportLifecycleError(err, info);
        });
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
    this._reportCallback(err, info, "propagated");
  }

  private _reportCallback(
    err: unknown,
    info: CallbackErrorInfo,
    outcome: CallbackOutcome,
    options?: WrapCallbackOptions,
  ): void {
    const muteKey = options?.muteKey;
    if (muteKey) {
      let muted = this.mutedCallbacks.get(muteKey.handler);
      if (muted?.has(muteKey.event)) return; // already reported once — stay silent
      if (!muted) {
        muted = new Set();
        this.mutedCallbacks.set(muteKey.handler, muted);
      }
      muted.add(muteKey.event);
    }

    const error = err instanceof Error ? err : new Error(String(err));
    this._record(info, outcome, error);

    this.logger.error("core", `${this._describe(info)} and was ${outcome}`, {
      error,
    });

    options?.onError?.();
  }

  /** Push a record, enforcing {@link MAX_CALLBACK_ERRORS}. Shared by isolate-policy reporting and `_raiseFatal`. */
  private _record(info: CallbackErrorInfo, outcome: CallbackOutcome, error: Error): void {
    this.callbackErrors.push({ ...info, outcome, error: error.message });
    if (this.callbackErrors.length > MAX_CALLBACK_ERRORS) {
      this.callbackErrors.shift();
    }
  }

  /** Human-readable "kind threw on entity X in scene Y for event Z" prefix, shared by isolate and fatal reporting. */
  private _describe(info: CallbackErrorInfo): string {
    let message = `${info.kind} threw`;
    if (info.entity !== undefined) message += ` on entity "${info.entity}"`;
    if (info.scene !== undefined) message += ` in scene "${info.scene}"`;
    if (info.event !== undefined) message += ` for event "${info.event}"`;
    return message;
  }

  /**
   * Report a `"fatal"`-policy error with its original stack, record it with
   * outcome `"fatal"`, stop the game loop, and rethrow. Idempotent per error
   * object — see {@link fatalReported} — so an error that keeps propagating
   * through nested wraps is recorded, logged, and stops the loop exactly once.
   */
  private _raiseFatal(err: unknown, info: CallbackErrorInfo): never {
    const error = err instanceof Error ? err : new Error(String(err));
    if (!this.fatalReported.has(error)) {
      this.fatalReported.add(error);
      this._record(info, "fatal", error);
      this.logger.error("core", `${this._describe(info)} and stopped the game loop`, {
        error,
      });
      this.loop?.stop();
    }
    throw error;
  }

  /** Get all disabled systems and components for inspection. */
  getDisabled(): {
    systems: ReadonlyArray<{ system: System; error: string }>;
    components: ReadonlyArray<{ component: Component; error: string }>;
  } {
    return {
      systems: this.disabledSystems,
      components: this.disabledComponents,
    };
  }

  /** Get recorded failures for inspection — developer callbacks under either policy, plus system/component failures under `"fatal"`. */
  getCallbackErrors(): readonly CallbackErrorRecord[] {
    return this.callbackErrors;
  }

  /** Clear recorded callback failures. Disabled systems/components are untouched. */
  clearCallbackErrors(): void {
    this.callbackErrors.length = 0;
  }
}
