import type { Component } from "./Component.js";
import type { EngineContext } from "./EngineContext.js";
import type { SystemScheduler } from "./SystemScheduler.js";

/**
 * Constructor type for components. Abstract so a base class can be named as
 * a query filter or a `getAll` argument; nothing in the engine constructs
 * through this type.
 */
export type ComponentClass<C extends Component = Component> = abstract new (
  ...args: never[]
) => C;

/** Game loop phase identifiers. Systems run in one specific phase. */
export enum Phase {
  EarlyUpdate = "earlyUpdate",
  FixedUpdate = "fixedUpdate",
  Update = "update",
  LateUpdate = "lateUpdate",
  Render = "render",
  EndOfFrame = "endOfFrame",
}

/** Plugin interface for extending the engine. */
export interface Plugin {
  /** Unique plugin name. */
  readonly name: string;
  /** Semantic version string. */
  readonly version: string;
  /** Names of plugins this plugin depends on. */
  readonly dependencies?: readonly string[];
  /** Install services into the engine context. Called in topological order. */
  install?(context: EngineContext): void | Promise<void>;
  /** Register systems with the scheduler. Called after install. */
  registerSystems?(scheduler: SystemScheduler): void;
  /** Called after all plugins are installed and the engine has started. */
  onStart?(): void | Promise<void>;
  /** Called when the engine is destroyed. */
  onDestroy?(): void;
}

/**
 * An easing function mapping `t` in `[0,1]` to an eased value. The built-in
 * easings return `0` at `t = 0` and `1` at `t = 1`; the `back` and `elastic`
 * families leave `[0,1]` in between, by design. The result for `t` outside
 * `[0,1]` is not specified.
 */
export type EasingFunction = (t: number) => number;
