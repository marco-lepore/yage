import { Component } from "./Component.js";
import type { Process } from "./Process.js";
import { tickProcessGuarded } from "./Process.js";
import { ProcessSlot } from "./ProcessSlot.js";
import type { ProcessSlotConfig } from "./ProcessSlot.js";
import { serializable } from "./Serializable.js";
import { ErrorBoundaryKey } from "./EngineContext.js";
import type { ErrorBoundary, CallbackErrorInfo } from "./ErrorBoundary.js";

/**
 * A component that holds a set of processes on an entity.
 * Processes are ticked automatically by ProcessSystem each frame.
 * All processes are cancelled when the entity is destroyed.
 */
@serializable
export class ProcessComponent extends Component {
  private processes = new Set<Process>();
  private slots = new Set<ProcessSlot>();
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
   * Optionally apply tags for cancel-by-tag.
   */
  run(process: Process, options?: { tags?: string[] }): Process {
    if (options?.tags?.length) {
      (process as { tags: readonly string[] }).tags = [
        ...process.tags,
        ...options.tags,
      ];
    }
    this.processes.add(process);
    return process;
  }

  /** Create a reusable, restartable process slot. */
  slot(config?: ProcessSlotConfig): ProcessSlot {
    const s = new ProcessSlot(config);
    this.slots.add(s);
    return s;
  }

  /** Stop managing a slot, cancelling it first when active. */
  removeSlot(slot: ProcessSlot): boolean {
    if (!this.slots.delete(slot)) return false;
    slot.cancel();
    return true;
  }

  /** Cancel all processes and slots, or only those matching a tag. */
  cancel(tag?: string): void {
    // Cancel one-off processes
    for (const p of this.processes) {
      if (tag === undefined || p.tags.includes(tag)) {
        p.cancel();
        this.processes.delete(p);
      }
    }

    // Cancel slots
    for (const s of this.slots) {
      if (tag === undefined || s.tags.includes(tag)) {
        s.cancel();
      }
    }
  }

  /** Number of active (non-completed) processes and slots. */
  get count(): number {
    let n = 0;
    for (const p of this.processes) {
      if (!p.completed) n++;
    }
    for (const s of this.slots) {
      if (!s.completed) n++;
    }
    return n;
  }

  /**
   * Advance all processes and slots by dt seconds and remove completed
   * one-offs, via the same `tickProcessGuarded` path `ProcessSystem` uses
   * for its pools.
   * @internal — called by ProcessSystem
   */
  _tick(dt: number, scene?: string): void {
    this._resolveBoundary();
    const entity = this.entity?.name;
    for (const p of this.processes) {
      tickProcessGuarded(
        this.errorBoundary,
        () => p._update(dt),
        this._info("Process callback", entity, scene),
      );
      if (p.completed) {
        this.processes.delete(p);
      }
    }
    for (const s of this.slots) {
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
