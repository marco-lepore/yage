import { ErrorBoundary, Logger } from "@yagejs/core";
import type { CallbackErrorInfo } from "@yagejs/core";
import type {
  HotbarActionResult,
  HotbarActivation,
  HotbarBinding,
  HotbarEvent,
  HotbarOptions,
  HotbarRestoreResult,
  HotbarSlot,
  HotbarSnapshot,
  HotbarState,
} from "./types.js";

/** Assignments and selection over actions whose state remains with their owner. */
export class Hotbar<TId extends string = string> {
  private readonly bindings: Readonly<Record<TId, HotbarBinding>>;
  private slots: (TId | null)[];
  private selected: number;
  private last: HotbarActivation<TId> | null = null;
  /** The releasable binding each slot last activated, until that slot is released. */
  private readonly held = new Map<
    number,
    { readonly id: TId; readonly release: () => void }
  >();
  /** Slots being activated: the earlier hold's `release()` and the binding's `activate()`. */
  private readonly activating = new Set<number>();
  private readonly listeners = new Set<(event: HotbarEvent<TId>) => void>();
  private readonly standaloneBoundary: ErrorBoundary;
  private owner: object | undefined;
  private boundary: ErrorBoundary;
  private info: CallbackErrorInfo = { kind: "Hotbar" };

  constructor(options: HotbarOptions<TId>) {
    const count = options.slotCount ?? 8;
    if (!Number.isSafeInteger(count) || count < 1)
      throw new Error(
        `Hotbar.constructor: slotCount must be a positive integer, got ${count}`,
      );
    this.bindings = { ...options.bindings };
    const initial = options.slots ?? [];
    if (initial.length > count)
      throw new Error(
        `Hotbar.constructor: ${initial.length} initial assignments exceed slotCount ${count}`,
      );
    for (const id of initial) if (id !== null) this.binding(id);
    this.slots = Array.from({ length: count }, (_, i) => initial[i] ?? null);
    this.selected = options.selected ?? 0;
    this.slotIndex(this.selected, "constructor");
    this.standaloneBoundary =
      options.errorBoundary ?? new ErrorBoundary(new Logger());
    this.boundary = this.standaloneBoundary;
  }

  get slotCount(): number {
    return this.slots.length;
  }
  get selection(): number {
    return this.selected;
  }
  get bindingIds(): readonly TId[] {
    return Object.keys(this.bindings) as TId[];
  }
  get lastActivation(): HotbarActivation<TId> | null {
    return this.last;
  }

  assign(slot: number, id: TId): void {
    this.slotIndex(slot, "assign");
    this.binding(id);
    if (this.slots[slot] === id) return;
    this.slots[slot] = id;
    this.changed();
  }

  clear(slot: number): void {
    this.slotIndex(slot, "clear");
    if (this.slots[slot] === null) return;
    this.slots[slot] = null;
    this.changed();
  }

  /** Exchange assignments, including an empty destination. Selection stays at its index. */
  swap(a: number, b: number): void {
    this.slotIndex(a, "swap");
    this.slotIndex(b, "swap");
    const first = this.assigned(a);
    const second = this.assigned(b);
    if (first === second) return;
    this.slots[a] = second;
    this.slots[b] = first;
    this.changed();
  }

  select(slot: number): void {
    this.slotIndex(slot, "select");
    if (this.selected === slot) return;
    this.selected = slot;
    this.changed();
  }

  /** Move the selection one slot, wrapping at either end. */
  cycle(direction: -1 | 1): void {
    this.select((this.selected + direction + this.slotCount) % this.slotCount);
  }

  read(slot: number): HotbarSlot<TId> {
    this.slotIndex(slot, "read");
    const id = this.assigned(slot);
    if (id === null)
      return {
        index: slot,
        bindingId: null,
        label: "Empty",
        available: false,
        reason: "empty",
        count: null,
        cooldown: null,
      };
    const binding = this.binding(id);
    const state = this.call(`read '${id}'`, () => {
      const value = binding.read?.() ?? {};
      if (value.count !== undefined) nonnegative(value.count, `'${id}' count`);
      if (value.cooldown) {
        nonnegative(value.cooldown.remaining, `'${id}' cooldown.remaining`);
        const ratio = value.cooldown.ratio;
        if (!(ratio >= 0 && ratio <= 1))
          throw new Error(
            `Hotbar.read: '${id}' cooldown.ratio must be from 0 to 1, got ${ratio}`,
          );
      }
      return value;
    });
    const cooling = (state.cooldown?.remaining ?? 0) > 0;
    const reason =
      state.available === false
        ? (state.reason ?? (cooling ? "cooldown" : "unavailable"))
        : cooling
          ? "cooldown"
          : null;
    return {
      index: slot,
      bindingId: id,
      label: binding.label,
      ...(binding.icon !== undefined && { icon: binding.icon }),
      available: reason === null,
      reason,
      count: state.count ?? null,
      cooldown: state.cooldown ? { ...state.cooldown } : null,
    };
  }

  inspect(): HotbarState<TId> {
    return {
      slots: this.slots.map((_, i) => this.read(i)),
      selected: this.selected,
      lastActivation: this.last,
    };
  }

  /** Rechecks availability; the owner can still reject the activation request. */
  activate(slot = this.selected): HotbarActionResult {
    this.slotIndex(slot, "activate");
    if (this.activating.has(slot))
      throw new Error(
        `Hotbar.activate: slot ${slot} was activated again while its activation was running`,
      );
    const state = this.read(slot);
    const id = state.bindingId;
    let result: HotbarActionResult;
    if (id === null || state.reason !== null) {
      result = { ok: false, reason: state.reason ?? "unavailable" };
    } else {
      const binding = this.binding(id);
      this.activating.add(slot);
      try {
        // A slot holds one action: the earlier hold ends before the new request.
        const earlier = this.held.get(slot);
        if (earlier) {
          this.held.delete(slot);
          this.call(`release '${earlier.id}'`, earlier.release);
        }
        result = this.call(`activate '${id}'`, () => {
          const value = binding.activate();
          if ("then" in value)
            throw new Error(
              `Hotbar.activate: '${id}' must return a synchronous result, got a Promise`,
            );
          return value.ok ? { ok: true } : { ok: false, reason: value.reason };
        });
      } finally {
        // Only the guard is reset; no callbacks or gameplay steps run here.
        this.activating.delete(slot);
      }
      if (result.ok && binding.release)
        this.held.set(slot, { id, release: binding.release });
    }
    this.last = { slot, bindingId: id, result };
    this.emit({ type: "activation", activation: this.last });
    return result;
  }

  /**
   * End the held action this slot activated. Calls the `release` of the
   * binding that was activated, even if the slot was reassigned since. No-op
   * when the slot holds nothing releasable. A slot holds one action at a
   * time: activating it again, once `read()` reports it available, ends the
   * earlier hold before the binding's `activate()` runs.
   */
  release(slot: number): void {
    this.slotIndex(slot, "release");
    const held = this.held.get(slot);
    if (!held) return;
    this.held.delete(slot);
    this.call(`release '${held.id}'`, held.release);
  }

  snapshot(): HotbarSnapshot<TId> {
    return { version: 1, slots: [...this.slots], selected: this.selected };
  }

  /**
   * Replace assignments and selection with a saved snapshot. Entries past the
   * slot count or naming a binding this bar does not declare are left empty
   * and returned in `dropped`. An out-of-range selection resets to slot 0.
   * Throws, before changing anything, for another version or for slots that
   * are not an array of binding IDs and nulls.
   */
  restore(snapshot: HotbarSnapshot): HotbarRestoreResult {
    if (snapshot.version !== 1)
      throw new Error(
        `Hotbar.restore: expected a version 1 snapshot, got version ${snapshot.version}`,
      );
    if (!Array.isArray(snapshot.slots))
      throw new Error(
        `Hotbar.restore: slots must be an array, got ${String(snapshot.slots)}`,
      );
    const dropped: { slot: number; bindingId: string }[] = [];
    const slots: (TId | null)[] = Array.from(
      { length: this.slotCount },
      () => null,
    );
    snapshot.slots.forEach((id, slot) => {
      if (id === null) return;
      if (typeof id !== "string")
        throw new Error(
          `Hotbar.restore: slot ${slot} must hold a binding ID or null, got ${String(id)}`,
        );
      if (slot < slots.length && Object.hasOwn(this.bindings, id))
        slots[slot] = id as TId;
      else dropped.push({ slot, bindingId: id });
    });
    const selected = snapshot.selected;
    this.slots = slots;
    this.selected =
      Number.isInteger(selected) && selected >= 0 && selected < slots.length
        ? selected
        : 0;
    this.last = null;
    this.changed();
    return { dropped };
  }

  on(listener: (event: HotbarEvent<TId>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** @internal A model has one mounted owner; standalone usage remains available after removal. */
  _attach(
    owner: object,
    boundary: ErrorBoundary,
    info: CallbackErrorInfo,
  ): () => void {
    if (this.owner)
      throw new Error(
        "HotbarController: model already has a mounted controller",
      );
    this.owner = owner;
    this.boundary = boundary;
    this.info = info;
    return () => {
      this.owner = undefined;
      this.boundary = this.standaloneBoundary;
      this.info = { kind: "Hotbar" };
    };
  }

  private assigned(slot: number): TId | null {
    return this.slots[slot] ?? null;
  }
  private binding(id: TId): HotbarBinding {
    if (!Object.hasOwn(this.bindings, id))
      throw new Error(`Hotbar: unknown binding '${id}'`);
    return this.bindings[id];
  }
  private slotIndex(slot: number, method: string): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCount)
      throw new Error(
        `Hotbar.${method}: slot must be an integer from 0 to ${this.slotCount - 1}, got ${slot}`,
      );
  }
  private call<T>(kind: string, fn: () => T): T {
    let value!: T;
    this.boundary.wrapCallback(
      () => {
        value = fn();
      },
      { ...this.info, kind: `Hotbar ${kind}` },
    );
    return value;
  }
  private changed(): void {
    this.emit({ type: "changed", snapshot: this.snapshot() });
  }
  private emit(event: HotbarEvent<TId>): void {
    for (const listener of [...this.listeners])
      this.call(`listener (${event.type})`, () => listener(event));
  }
}

function nonnegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(
      `Hotbar.read: ${field} must be finite and nonnegative, got ${value}`,
    );
}
