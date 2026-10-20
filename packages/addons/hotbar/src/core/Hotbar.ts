import { ErrorBoundary, Logger } from "@yagejs/core";
import type { CallbackErrorInfo } from "@yagejs/core";
import type {
  HotbarActionResult,
  HotbarActivation,
  HotbarBinding,
  HotbarEvent,
  HotbarOptions,
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
  private readonly listeners = new Set<(event: HotbarEvent<TId>) => void>();
  private readonly standaloneBoundary: ErrorBoundary;
  private owner: object | undefined;
  private boundary: ErrorBoundary;
  private info: CallbackErrorInfo = { kind: "Hotbar" };
  private activating = false;

  constructor(options: HotbarOptions<TId>) {
    const count = options.slotCount ?? 8;
    if (!Number.isSafeInteger(count) || count < 1 || count > 1024) {
      throw new Error(
        `Hotbar.constructor: slotCount must be an integer from 1 to 1024, got ${count}`,
      );
    }
    this.bindings = Object.fromEntries(
      Object.entries<HotbarBinding>(options.bindings).map(([id, binding]) => {
        if (
          !id.trim() ||
          !binding.label.trim() ||
          typeof binding.activate !== "function"
        ) {
          throw new Error(
            `Hotbar.constructor: binding '${id}' requires a nonempty ID, label and activate function`,
          );
        }
        return [id, { ...binding }];
      }),
    ) as Record<TId, HotbarBinding>;
    this.slots = Array.from({ length: count }, () => null);
    this.selected = options.selected ?? 0;
    this.index(this.selected, "constructor");
    if ((options.slots?.length ?? 0) > count)
      throw new Error("Hotbar.constructor: assignments exceed slotCount");
    options.slots?.forEach((id, i) => {
      if (id !== null) this.binding(id);
      this.slots[i] = id;
    });
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
    return this.last ? { ...this.last, result: { ...this.last.result } } : null;
  }

  assign(slot: number, id: TId): void {
    this.index(slot, "assign");
    this.binding(id);
    if (this.slots[slot] === id) return;
    this.slots[slot] = id;
    this.changed();
  }

  clear(slot: number): void {
    this.index(slot, "clear");
    if (this.slots[slot] === null) return;
    this.slots[slot] = null;
    this.changed();
  }

  /** Exchange assignments, including an empty destination. Selection stays at its index. */
  swap(a: number, b: number): void {
    this.index(a, "swap");
    this.index(b, "swap");
    if (this.slots[a] === this.slots[b]) return;
    const before = this.slots[a]!;
    this.slots[a] = this.slots[b]!;
    this.slots[b] = before;
    this.changed();
  }

  select(slot: number): void {
    this.index(slot, "select");
    if (this.selected === slot) return;
    this.selected = slot;
    this.changed();
  }

  cycle(direction: -1 | 1): void {
    if (direction !== -1 && direction !== 1)
      throw new Error(
        `Hotbar.cycle: direction must be -1 or 1, got ${direction}`,
      );
    this.select((this.selected + direction + this.slotCount) % this.slotCount);
  }

  read(slot: number): HotbarSlot<TId> {
    this.index(slot, "read");
    const id = this.slots[slot]!;
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
      if (typeof value !== "object" || "then" in value)
        throw new Error(
          `Hotbar.read: '${id}' must return a synchronous state object`,
        );
      if (value.available !== undefined && typeof value.available !== "boolean")
        throw new Error(`Hotbar.read: '${id}' available must be a boolean`);
      if (
        value.reason !== undefined &&
        (typeof value.reason !== "string" || !value.reason.trim())
      )
        throw new Error(
          `Hotbar.read: '${id}' reason must be a nonempty string`,
        );
      if (value.count !== undefined)
        nonnegative(value.count, `read '${id}' count`);
      if (value.cooldown) {
        nonnegative(value.cooldown.remaining, `read '${id}' remaining`);
        nonnegative(value.cooldown.total, `read '${id}' total`);
        if (value.cooldown.remaining > value.cooldown.total)
          throw new Error(`Hotbar.read: '${id}' remaining exceeds total`);
      }
      return value;
    });
    const reason =
      state.available === false
        ? (state.reason ?? "unavailable")
        : (state.cooldown?.remaining ?? 0) > 0
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
      lastActivation: this.lastActivation,
    };
  }

  /** Rechecks availability; the owner can still reject the activation request. */
  activate(slot = this.selected): HotbarActionResult {
    this.index(slot, "activate");
    if (this.activating)
      throw new Error("Hotbar.activate: recursive activation is not supported");
    this.activating = true;
    let activation: HotbarActivation<TId>;
    try {
      const state = this.read(slot);
      const result: HotbarActionResult =
        state.available && state.bindingId !== null
          ? this.call(`activate '${state.bindingId}'`, () => {
              const value = this.binding(state.bindingId!).activate();
              if (
                !value ||
                typeof value.ok !== "boolean" ||
                (!value.ok &&
                  (typeof value.reason !== "string" || !value.reason.trim()))
              ) {
                throw new Error(
                  `Hotbar.activate: '${state.bindingId}' must return a synchronous { ok } result with a reason on rejection`,
                );
              }
              return value.ok
                ? { ok: true }
                : { ok: false, reason: value.reason };
            })
          : { ok: false, reason: state.reason ?? "unavailable" };
      activation = { slot, bindingId: state.bindingId, result };
      this.last = { ...activation, result: { ...activation.result } };
    } finally {
      // Only the reentrancy flag is released; no callbacks or gameplay steps run here.
      this.activating = false;
    }
    this.emit({ type: "activation", activation });
    return { ...activation.result };
  }

  snapshot(): HotbarSnapshot<TId> {
    return { version: 1, slots: [...this.slots], selected: this.selected };
  }

  restore(snapshot: HotbarSnapshot): void {
    if (
      snapshot.version !== 1 ||
      !Array.isArray(snapshot.slots) ||
      snapshot.slots.length !== this.slotCount
    )
      throw new Error(
        "Hotbar.restore: expected version 1 and matching slot count",
      );
    this.index(snapshot.selected, "restore");
    const slots = Array.from(snapshot.slots, (id) => {
      if (id !== null) this.binding(id as TId);
      return id as TId | null;
    });
    this.slots = slots;
    this.selected = snapshot.selected;
    this.last = null;
    this.changed();
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

  private binding(id: TId): HotbarBinding {
    if (!Object.hasOwn(this.bindings, id))
      throw new Error(`Hotbar: unknown binding '${id}'`);
    return this.bindings[id];
  }
  private index(slot: number, method: string): void {
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
      `Hotbar.${field}: expected a finite nonnegative number, got ${value}`,
    );
}
