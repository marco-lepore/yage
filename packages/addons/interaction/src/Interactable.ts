import { Component, LoggerKey, Transform, isDev } from "@yagejs/core";
import { interactableRegistryFor } from "./core/registry.js";
import type { InteractableOptions } from "./core/types.js";

/**
 * Marks any entity as something an `Interactor` can focus and interact with.
 * Self-registers into the scene's interactable registry on `onAdd` and
 * unregisters on `onDestroy` — no manual wiring beyond `entity.add()`.
 */
export class Interactable extends Component {
  private readonly transform = this.sibling(Transform);
  /** Registration order within the scene registry — the focus distance-tie
   *  breaker. Set by `onAdd`; `-1` before registration. */
  private _order = -1;

  constructor(private readonly opts: InteractableOptions) {
    super();
  }

  onAdd(): void {
    this._order = interactableRegistryFor(this.scene).register(this);

    // `radius` is the other half of the reach an interactor squares. A negative
    // one shrinks the reach, and once the total drops below zero the squaring
    // silently makes distant targets selectable.
    if (isDev() && this.radius < 0) {
      this.context.tryResolve(LoggerKey)?.warn(
        "interaction",
        `Interactable radius is ${this.radius}. Radius is a reach bonus in world px added to ` +
          `the interactor's range and cannot be negative: once the total reach goes below ` +
          `zero, the in-range test squares it and matches distant targets. Use 0 for no bonus.`,
      );
    }
  }

  onDestroy(): void {
    interactableRegistryFor(this.scene).unregister(this);
  }

  /** Registration order within the scene registry — the focus tie-break. */
  get order(): number {
    return this._order;
  }

  /** World position this interactable is focused/reached from. */
  get position(): { readonly x: number; readonly y: number } {
    return this.transform.worldPosition;
  }

  /** Own reach bonus, added to the interactor's range. Default 0. */
  get radius(): number {
    return this.opts.radius ?? 0;
  }

  /** Focus tie-break weight. Default 0. */
  get priority(): number {
    return this.opts.priority ?? 0;
  }

  /** Resolves the live-or-static enabled gate. Default true. Named as a
   *  method, not a property, to avoid colliding with the inherited
   *  `Component.enabled` field (the ComponentUpdateSystem run-gate — a
   *  distinct concept from this resolved, provider-driven focus gate). */
  isEnabled(): boolean {
    const enabled = this.opts.enabled;
    if (enabled === undefined) return true;
    return typeof enabled === "function" ? enabled() : enabled;
  }

  /** Resolves the live-or-static prompt text. `undefined` = no label. */
  get prompt(): string | undefined {
    const prompt = this.opts.prompt;
    if (prompt === undefined) return undefined;
    return typeof prompt === "function" ? prompt() : prompt;
  }

  /** Fires this interactable's interact handler. Called by the focusing `Interactor`. */
  interact(): void {
    this.opts.onInteract();
  }
}
