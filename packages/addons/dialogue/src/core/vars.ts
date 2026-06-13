/**
 * VarStore — the unified var/external lookup behind a running conversation.
 *
 * One namespace, two ownership classes (the partition is decided by the
 * script's *declarations*, not by the call kind):
 *
 *   • **Dialogue vars** (∈ `script.vars`) are mutable and conversation-local —
 *     `set` / `ctx.setVar` / `handle.setVar` write them.
 *   • **Externals** (∈ `script.external`) are read-only views into game state,
 *     bound by the host as a constant or a live getter (invoked at read time so
 *     `{gold}` / a choice gate reflects the latest value).
 *
 * Conditions, `{token}` interpolation, and choice gates all read through `read`
 * / `materialize`; writes funnel through the guarded `write`, so "you can't
 * mutate game state from a script" is enforced structurally, not by convention.
 */

import type { BindingValue, VarMap, VarValue } from "./types.js";

export class VarStore {
  /** Mutable dialogue vars (∈ declared `varNames`). */
  private readonly vars: VarMap;
  /** Read-only externals (∈ declared `externalNames`): constant or getter. */
  private readonly externals = new Map<string, BindingValue>();

  constructor(
    defaults: Readonly<VarMap>,
    private readonly varNames: ReadonlySet<string>,
    private readonly externalNames: ReadonlySet<string>,
    bindingState: Readonly<Record<string, BindingValue>>,
  ) {
    this.vars = { ...defaults };
    for (const [name, entry] of Object.entries(bindingState)) {
      if (this.externalNames.has(name)) {
        this.externals.set(name, entry);
      } else if (this.varNames.has(name)) {
        // A var binding is validated to be a constant: it overrides the default.
        this.vars[name] = entry as VarValue;
      }
      // Names in neither were rejected by validateBinding before we got here.
    }
  }

  /**
   * Unified read: a dialogue var's current value, or an external (the getter is
   * invoked now, so the read is live). Unknown names read `null`.
   */
  read(name: string): VarValue {
    if (this.varNames.has(name)) return this.vars[name] ?? null;
    const ext = this.externals.get(name);
    if (ext !== undefined) return typeof ext === "function" ? ext() : ext;
    return null;
  }

  /** Guarded write: only declared dialogue vars are writable. */
  write(name: string, value: VarValue): void {
    if (this.varNames.has(name)) {
      this.vars[name] = value;
      return;
    }
    if (this.externalNames.has(name)) {
      throw new Error(
        `dialogue: "${name}" is game state (an external, read-only to the script); ` +
          `mutate it via a command, not set/setVar.`,
      );
    }
    throw new Error(
      `dialogue: cannot set unknown var "${name}" (declare it in script.vars).`,
    );
  }

  /**
   * A plain merged snapshot (vars + externals, getters invoked) — the read view
   * conditions and `{token}` interpolation evaluate against. Materialized per
   * evaluation rather than proxied, so an earlier command's `set` shows up on a
   * later line and a getter is only ever called, never stored.
   */
  materialize(): VarMap {
    const out: VarMap = { ...this.vars };
    for (const [name, ext] of this.externals) {
      out[name] = typeof ext === "function" ? ext() : ext;
    }
    return out;
  }

  /**
   * The mutable dialogue vars only (externals excluded) — the `handle.getVars()`
   * / future save-cursor view.
   */
  getVars(): Readonly<VarMap> {
    return this.vars;
  }
}
