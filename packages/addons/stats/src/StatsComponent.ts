import { Component, ErrorBoundaryKey, defineEvent } from "@yagejs/core";
import type { ErrorBoundary, ProcessClock } from "@yagejs/core";
import type { Stats } from "./core/Stats.js";

/** Public model contract; custom models can implement the same operations. */
export type StatsModel<K extends string> = Pick<Stats<K>, keyof Stats<K>>;

/** The entity's stat inputs changed. Read StatsComponent.model for current values. */
export const StatsChangedEvent = defineEvent("stats:changed");

export interface StatsComponentOptions<K extends string> {
  readonly model: StatsModel<K>;
  /** Default: fixed. Both engine clocks include scene and entity time scaling. */
  readonly clock?: ProcessClock;
}

/** Optional entity owner. The headless model also works with an explicit advance(dt). */
export class StatsComponent<K extends string = string> extends Component {
  readonly model: StatsModel<K>;
  readonly clock: ProcessClock;
  private unsubscribe: (() => void) | undefined;
  private previousBoundary: ErrorBoundary | undefined;

  constructor(options: StatsComponentOptions<K>) {
    super();
    this.model = options.model;
    this.clock = options.clock ?? "fixed";
    if (this.clock !== "frame" && this.clock !== "fixed")
      throw new Error(`StatsComponent: unknown clock ${this.clock}`);
  }

  onEnable(): void {
    if (this.unsubscribe) return;
    this.previousBoundary = this.model.errorBoundary;
    this.model.errorBoundary = this.use(ErrorBoundaryKey);
    this.unsubscribe = this.model.onChange(() => {
      if (this.effectiveEnabled) this.entity.emit(StatsChangedEvent);
    });
  }

  onDisable(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.previousBoundary) this.model.errorBoundary = this.previousBoundary;
    this.previousBoundary = undefined;
  }

  onDestroy(): void {
    this.onDisable();
  }
  update(dt: number): void {
    if (this.clock === "frame") this.model.advance(dt);
  }
  fixedUpdate(dt: number): void {
    if (this.clock === "fixed") this.model.advance(dt);
  }
}
