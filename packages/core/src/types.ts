import type { Component } from "./Component.js";

/** Constructor type for components. */
export type ComponentClass<C extends Component = Component> = new (
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
  install?(context: import("./EngineContext.js").EngineContext): void | Promise<void>;
  /** Register systems with the scheduler. Called after install. */
  registerSystems?(scheduler: import("./SystemScheduler.js").SystemScheduler): void;
  /** Called after all plugins are installed and the engine has started. */
  onStart?(): void;
  /** Called when the engine is destroyed. */
  onDestroy?(): void;
}

/** An easing function mapping t in [0,1] to a value in [0,1]. */
export type EasingFunction = (t: number) => number;
