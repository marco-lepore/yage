import type { System } from "./System.js";
import type { Component } from "./Component.js";
import type { Logger } from "./Logger.js";

/**
 * Wraps system and component execution. On error, disables the offending
 * system/component and logs the error. The game loop never crashes.
 */
export class ErrorBoundary {
  private logger: Logger;
  private disabledSystems: Array<{ system: System; error: string }> = [];
  private disabledComponents: Array<{ component: Component; error: string }> = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Wrap a system update call. On throw, disables the system. */
  wrapSystem(system: System, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      system.enabled = false;
      this.disabledSystems.push({ item: system, error: message });
      this.logger.error(
        "core",
        `System ${system.constructor.name} threw and was disabled`,
        { error: message },
      );
    }
  }

  /** Wrap a component lifecycle or update call. On throw, disables the component. */
  wrapComponent(component: Component, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      component.enabled = false;
      this.disabledComponents.push({ item: component, error: message });
      const entityName = component.entity?.name ?? "unknown";
      this.logger.error(
        "core",
        `Component ${component.constructor.name} on entity "${entityName}" threw and was disabled`,
        { error: message },
      );
    }
  }

  /** Get all disabled systems and components for inspection. */
  getDisabled(): {
    systems: ReadonlyArray<{ system: System; error: string }>;
    components: ReadonlyArray<{ component: Component; error: string }>;
  } {
    return {
      systems: this.disabledSystems.map((e) => ({
        system: e.item,
        error: e.error,
      })),
      components: this.disabledComponents.map((e) => ({
        component: e.item,
        error: e.error,
      })),
    };
  }
}
