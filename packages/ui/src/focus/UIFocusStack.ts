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
 * A scope shows and hides with its own subtree, so the stack cannot be a
 * push/pop list: it records which scopes are shown each frame and gives input
 * to the innermost of them, or to the one shown most recently among the
 * scopes that hold none of the others. Showing a dialog inside a menu
 * therefore hands the keys over, and hiding it hands them back on the row the
 * menu had.
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
   * shown, and report whether any of them is.
   *
   * Runs for every scene each frame, driven or not, so a menu shown under a
   * pushed scene is recorded when it happens rather than staying invisible
   * behind a scope that was registered earlier.
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
   * Give input to the innermost scope shown and run its frame.
   *
   * A scope holding a shown scope inside it stands aside, so a confirm dialog
   * inside a menu is the one the player drives whichever order the tree put
   * the two scopes in the stack. Among scopes that hold none of the others,
   * the one shown most recently wins, and two shown in the same frame are
   * stamped in registration order.
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
