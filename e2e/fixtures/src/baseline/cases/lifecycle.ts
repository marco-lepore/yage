import {
  Entity,
  HostKey,
  SceneManagerKey,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { HostLifecycle } from "@yagejs/core";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** What the lifecycle case reports. */
export interface LifecycleReading extends CaseReading {
  lifecycle: HostLifecycle;
  active: boolean;
  activeChanges: boolean[];
  pausedNow: boolean;
  /** Wall-clock milliseconds from the resume to the update that followed it. */
  firstFrameAfterResumeMs: number | null;
}

/**
 * Follows the host's activity: it turns automatic scene pausing on, records
 * every reported change, and measures the first frame after one.
 */
export class LifecycleProbe extends CaseProbe {
  private readonly host = this.service(HostKey);
  private readonly activeChanges: boolean[] = [];
  private firstFrameAfterResumeMs: number | null = null;
  /** When the host last reported the game active, or `null` once measured. */
  private resumedAt: number | null = null;

  onAdd(): void {
    this.use(SceneManagerKey).autoPause = true;
    this.listenBus("host:active", ({ active }) => {
      this.activeChanges.push(active);
      // The frame's own `dt` is capped at 100 ms, so how long the game stood
      // still is only visible in wall-clock time.
      if (active) this.resumedAt = performance.now();
    });
  }

  update(): void {
    const resumedAt = this.resumedAt;
    if (resumedAt === null) return;
    this.resumedAt = null;
    this.firstFrameAfterResumeMs = performance.now() - resumedAt;
  }

  get settled(): boolean {
    return true;
  }

  reading(): LifecycleReading {
    const host = this.host;
    return {
      lifecycle: { ...host.lifecycle },
      active: host.active,
      activeChanges: [...this.activeChanges],
      pausedNow: this.scene.isPaused,
      firstFrameAfterResumeMs: this.firstFrameAfterResumeMs,
    };
  }
}

/** The host's activity, visibility and focus, read as the engine sees them. */
export class LifecycleCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(40, 40) }));
    this.add(new LifecycleProbe());
  }
}
