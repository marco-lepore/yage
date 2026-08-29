import { Component } from "./Component.js";
import type { Process, ProcessClock } from "./Process.js";
import { tickProcessGuarded } from "./Process.js";
import { ProcessSlot } from "./ProcessSlot.js";
import type { ProcessSlotConfig } from "./ProcessSlot.js";
import { serializable } from "./Serializable.js";
import { ErrorBoundaryKey } from "./EngineContext.js";
import type { ErrorBoundary, CallbackErrorInfo } from "./ErrorBoundary.js";

/**
 * A component that holds a set of processes on an entity.
 *
 * Each process or slot is registered on one of two clocks (see
 * `ProcessClock`): `"frame"` processes are ticked by `ProcessSystem` every
 * rendered frame, `"fixed"` processes by `ProcessFixedUpdateSystem` once per
 * fixed step. The default is `"frame"`. Both clocks share pause gating and
 * time scaling; they differ only in which dt advances them.
 *
 * All processes are cancelled when the entity is destroyed.
 */
@serializable
export class ProcessComponent extends Component {
  private processes = new Set<Process>();
  private fixedProcesses = new Set<Process>();
  private slots = new Set<ProcessSlot>();
  private fixedSlots = new Set<ProcessSlot>();
  private errorBoundary: ErrorBoundary | undefined;

  /**
   * Resolve and cache the error boundary from the entity's scene context.
   * Unlike ColliderComponent, ProcessComponent works detached from any scene
   * (tweening a standalone entity is a supported, scene-free use case), so
   * this can't use `this.context`, which throws when the entity has no
   * scene — `tryScene` degrades to `null` instead. An entity can also gain a
   * scene after `onAdd` (`Entity.addChild` auto-adds a scene-less child to
   * its parent's scene), so this retries on every `_tick` until a boundary
   * is found, then caches it to avoid a repeated lookup per frame.
   */
  private _resolveBoundary(): void {
    if (this.errorBoundary) return;
    this.errorBoundary = this.entity.tryScene?.context?.tryResolve(ErrorBoundaryKey);
  }

  /**
   * Run a one-off process (tween, sequence, delay).
   * Optionally apply tags for cancel-by-tag, and pick the clock that
   * advances it (default `"frame"`; see `ProcessClock`). Re-running a
   * process that is already scheduled here is a no-op that keeps its
   * original clock.
   */
  run(
    process: Process,
    options?: { tags?: string[]; clock?: ProcessClock },
  ): Process {
    if (options?.tags?.length) {
      (process as { tags: readonly string[] }).tags = [
        ...process.tags,
        ...options.tags,
      ];
    }
    // Dedup across both pools, so a re-run with a different clock cannot
    // double-tick a live process.
    if (this.processes.has(process) || this.fixedProcesses.has(process)) {
      return process;
    }
    const pool =
      options?.clock === "fixed" ? this.fixedProcesses : this.processes;
    pool.add(process);
    return process;
  }

  /** Create a reusable, restartable process slot. `config.clock` picks the clock (default `"frame"`). */
  slot(config?: ProcessSlotConfig): ProcessSlot {
    const s = new ProcessSlot(config);
    const pool = config?.clock === "fixed" ? this.fixedSlots : this.slots;
    pool.add(s);
    return s;
  }

  /** Stop managing a slot, cancelling it first when active. */
  removeSlot(slot: ProcessSlot): boolean {
    if (!this.slots.delete(slot) && !this.fixedSlots.delete(slot)) {
      return false;
    }
    slot.cancel();
    return true;
  }

  /** Cancel all processes and slots on both clocks, or only those matching a tag. */
  cancel(tag?: string): void {
    // Slots first: cancelling one runs its `cleanup`, which is game code and
    // can schedule again. Draining the one-off sets afterwards catches
    // anything a cleanup queued; a slot it queued is picked up by the live
    // iteration below. The reverse order would let a cleanup's work outlive
    // the cancel. `Process.cancel` only settles a promise, so the one-off
    // pass runs no game code and needs nothing after it.
    for (const pool of [this.slots, this.fixedSlots]) {
      for (const s of pool) {
        if (tag === undefined || s.tags.includes(tag)) {
          s.cancel();
        }
      }
    }

    for (const pool of [this.processes, this.fixedProcesses]) {
      for (const p of pool) {
        if (tag === undefined || p.tags.includes(tag)) {
          p.cancel();
          pool.delete(p);
        }
      }
    }
  }

  /** Number of active (non-completed) processes and slots across both clocks. */
  get count(): number {
    let n = 0;
    for (const pool of [this.processes, this.fixedProcesses]) {
      for (const p of pool) {
        if (!p.completed) n++;
      }
    }
    for (const pool of [this.slots, this.fixedSlots]) {
      for (const s of pool) {
        if (!s.completed) n++;
      }
    }
    return n;
  }

  /**
   * Advance all processes and slots on `clock` by dt seconds and remove
   * completed one-offs, via the same `tickProcessGuarded` path
   * `ProcessSystem` uses for its pools.
   * @internal — called by ProcessSystem (`"frame"`) and
   * ProcessFixedUpdateSystem (`"fixed"`)
   */
  _tick(dt: number, scene?: string, clock: ProcessClock = "frame"): void {
    this._resolveBoundary();
    const entity = this.entity?.name;
    const processes = clock === "fixed" ? this.fixedProcesses : this.processes;
    const slots = clock === "fixed" ? this.fixedSlots : this.slots;
    for (const p of processes) {
      tickProcessGuarded(
        this.errorBoundary,
        () => p._update(dt),
        this._info("Process callback", entity, scene),
      );
      if (p.completed) {
        processes.delete(p);
      }
    }
    for (const s of slots) {
      tickProcessGuarded(
        this.errorBoundary,
        () => s._tick(dt),
        this._info("Process slot callback", entity, scene),
      );
    }
  }

  private _info(
    kind: string,
    entity: string | undefined,
    scene: string | undefined,
  ): CallbackErrorInfo {
    return {
      kind,
      ...(entity !== undefined ? { entity } : {}),
      ...(scene !== undefined ? { scene } : {}),
    };
  }

  /** Cancel all processes and slots on entity destroy. */
  override onDestroy(): void {
    this.cancel();
  }

  serialize(): null {
    return null;
  }
}
