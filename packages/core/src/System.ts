import type { EngineContext } from "./EngineContext.js";
import { Phase } from "./types.js";

// Re-export Phase so consumers can import from System.ts if desired
export { Phase };

/**
 * Base class for systems. Systems run in a specific game loop phase,
 * query for entities matching a component signature, and operate on them.
 *
 * Systems are primarily for engine plugins (physics, rendering, audio).
 * Game developers typically write Components instead.
 */
export abstract class System {
  /** The phase this system runs in. */
  abstract readonly phase: Phase;

  /** Execution priority within the phase. Lower = earlier. Default: 0. */
  readonly priority: number = 0;

  /** Whether this system is active. */
  enabled = true;

  /** Reference to the engine context, set on registration. */
  protected context!: EngineContext;

  /** Called once when the system is registered with the engine. */
  onRegister?(context: EngineContext): void;

  /** Called every frame (or every fixed step for FixedUpdate). */
  abstract update(dt: number): void;

  /** Called when the system is removed. */
  onUnregister?(): void;
}
