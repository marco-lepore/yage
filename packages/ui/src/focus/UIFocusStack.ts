import { ServiceKey } from "@yagejs/core";
import type { UIFocusInputSource, UIFocusScope } from "./UIFocusScope.js";

/** One registered scope and the last time it became shown. */
interface Entry {
  readonly scope: UIFocusScope;
  shown: boolean;
  /** Sequence number of the latest false-to-true shown transition. */
  seq: number;
}

/**
 * Every focus scope in one scene, and which of them reads input.
 *
 * A scope shows and hides with its own subtree, so this is not a push/pop
 * list: each frame it records which scopes are shown and gives input to the
 * innermost one. Hiding a dialog inside a menu hands the keys back to the
 * menu, on the row it had.
 */
export class UIFocusStack {
  private readonly entries: Entry[] = [];
  private _active: UIFocusScope | null = null;
  private _seq = 1;

  /** The scope reading input, or `null` while none is shown. */
  get active(): UIFocusScope | null {
    return this._active;
  }

  /** @internal */
  _register(scope: UIFocusScope): void {
    this.entries.push({ scope, shown: false, seq: 0 });
  }

  /** @internal */
  _unregister(scope: UIFocusScope): void {
    const index = this.entries.findIndex((entry) => entry.scope === scope);
    if (index === -1) return;
    this.entries.splice(index, 1);
    if (this._active !== scope) return;
    scope._releaseInput();
    this._active = null;
  }

  /**
   * Recompute which scopes are shown, stamping each one that just became
   * shown, and report whether any is. Runs for every scene each frame, driven
   * or not, so a menu shown under a pushed scene gets its stamp that frame.
   * @internal
   */
  _observe(): boolean {
    let anyShown = false;
    for (const entry of this.entries) {
      const shown = entry.scope._isShown();
      if (shown && !entry.shown) {
        this._seq += 1;
        entry.seq = this._seq;
      }
      entry.shown = shown;
      if (shown) anyShown = true;
    }
    return anyShown;
  }

  /**
   * Give input to the innermost scope shown and run its frame. A scope
   * holding a shown scope inside it stands aside. Among the rest, the one
   * shown most recently wins, and two shown in the same frame rank in
   * registration order.
   * @internal
   */
  _drive(input: UIFocusInputSource | null): void {
    let best: Entry | null = null;
    for (const entry of this.entries) {
      if (!entry.shown || this._holdsShownScope(entry)) continue;
      if (best === null || entry.seq > best.seq) best = entry;
    }
    const next = best === null ? null : best.scope;
    if (next !== this._active) {
      this._active?._releaseInput();
      this._active = next;
      next?._takeInput(input);
    }
    next?._tick(input);
  }

  /** Whether a shown scope sits inside this entry's subtree. */
  private _holdsShownScope(entry: Entry): boolean {
    return this.entries.some(
      (other) => other.shown && entry.scope._containsScope(other.scope),
    );
  }

  /** Take input away from whatever holds it, dropping its latch. @internal */
  _suspend(): void {
    if (this._active === null) return;
    this._active._releaseInput();
    this._active = null;
  }

  /** Whether any shown scope reads a device. @internal */
  _hasDeviceScope(): boolean {
    return this.entries.some(
      (entry) => entry.shown && entry.scope._pollsDevice,
    );
  }

  /** Forget every scope. Called when the owning scene exits. */
  destroy(): void {
    this._suspend();
    this.entries.length = 0;
  }
}

/** Per-scene key, registered by `UIPlugin`'s scene hooks. */
export const UIFocusStackKey = new ServiceKey<UIFocusStack>("uiFocusStack", {
  scope: "scene",
});
