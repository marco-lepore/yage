import type { ScopedProcessQueue } from "@yagejs/core";
import type { Container } from "pixi.js";
import { EffectStack } from "./EffectStack.js";
import type { EffectStackSnapshot } from "./EffectStack.js";
import type { EffectFactory, EffectScope } from "./Effect.js";
import type { EffectDefinition } from "./defineEffect.js";
import type { EffectHandle } from "./EffectHandle.js";

/**
 * Per-attachment-site holder for an `EffectStack`. Every scope (component,
 * layer, scene, screen) carries its own `EffectsHost` exposed as `.fx`, so
 * the user-facing API for adding / finding / fading effects is identical
 * regardless of where the effect lives.
 *
 * The underlying `EffectStack` is built lazily on first `addEffect` (or
 * `restore`) so sites that never use effects pay zero cost.
 *
 * `getContainer` is a thunk because some sites (component scope) wire the
 * host at construction time but the underlying display object may itself be
 * created in the same constructor — the thunk removes "is this stable yet?"
 * thinking. `makeQueue` is optional because some test setups omit a
 * `ProcessSystem`; calling `addEffect` then throws a clear error.
 */
export class EffectsHost {
  private _stack: EffectStack | undefined;

  constructor(
    private readonly getContainer: () => Container,
    private readonly scope: EffectScope,
    private readonly makeQueue: (() => ScopedProcessQueue) | undefined,
  ) {}

  /**
   * Attach a visual effect. Returns a typed handle for fading, removal,
   * intensity, and any per-effect extras the factory exposes.
   */
  addEffect<H extends EffectHandle>(factory: EffectFactory<H>): H {
    return this._ensureStack().add(factory);
  }

  /**
   * Recover the handle for the first effect attached here whose underlying
   * definition is `definition`. Returns `null` if no match exists. Useful
   * after `save/load` to re-acquire a handle whose caller-side reference
   * went stale during restoration.
   */
  findEffect<H extends EffectHandle, O>(
    definition: EffectDefinition<H, O>,
  ): H | null {
    return (this._stack?.findHandle(definition.name) as H | undefined) ?? null;
  }

  /** Number of attached effects on this host. */
  get size(): number {
    return this._stack?.size ?? 0;
  }

  /** @internal — used by the renderer's snapshot contributor. */
  serialize(): EffectStackSnapshot | undefined {
    if (!this._stack || this._stack.size === 0) return undefined;
    const snap = this._stack.serialize();
    return snap.entries.length > 0 ? snap : undefined;
  }

  /** @internal — used by the renderer's snapshot contributor. */
  restore(snap: EffectStackSnapshot): void {
    this._ensureStack().restoreFrom(snap);
  }

  /**
   * @internal — torn down by the owning site (component/layer/scene/screen)
   * before its container is destroyed, so user-assigned external filters
   * survive the EffectStack teardown.
   */
  destroy(): void {
    this._stack?.destroy();
    this._stack = undefined;
  }

  private _ensureStack(): EffectStack {
    if (this._stack) return this._stack;
    if (!this.makeQueue) {
      throw new Error(
        `EffectsHost (${this.scope}-scope): no queue factory wired. ` +
          `This host was constructed outside a fully-wired renderer plugin.`,
      );
    }
    this._stack = new EffectStack(
      this.getContainer(),
      this.makeQueue(),
      this.scope,
    );
    return this._stack;
  }
}
