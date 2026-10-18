import { Entity, Transform, Vec2, createStore } from "@yagejs/core";
import { SaveServiceKey } from "@yagejs/save";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** The document id the case reads and writes. */
const DOCUMENT = "progress";

/** How many times this profile started the fixture. */
const progress = createStore((state) => ({
  launches: state.counter({ default: 0 }),
}));

/** What the saves case reports. */
export interface SavesReading extends CaseReading {
  launchesBefore: number | null;
  launchesAfter: number | null;
  failure: string | null;
}

/**
 * Reads the stored launch count, adds this launch and writes it back, so a
 * relaunch on the same profile reads what the previous run left.
 */
export class SavesProbe extends CaseProbe {
  private readonly save = this.service(SaveServiceKey);
  private launchesBefore: number | null = null;
  private launchesAfter: number | null = null;
  private failure: string | null = null;
  private done = false;

  onAdd(): void {
    void this.record();
  }

  get settled(): boolean {
    return this.done;
  }

  reading(): SavesReading {
    return {
      launchesBefore: this.launchesBefore,
      launchesAfter: this.launchesAfter,
      failure: this.failure,
    };
  }

  private async record(): Promise<void> {
    try {
      await this.save.restore(DOCUMENT, progress);
      this.launchesBefore = progress.launches.value();
      progress.launches.increment(1);
      await this.save.persist(DOCUMENT, progress);
      this.launchesAfter = progress.launches.value();
    } catch (error) {
      this.failure = (error as Error).message;
    }
    this.done = true;
  }
}

/** One stored document, read at boot and written back. */
export class SavesCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(40, 300) }));
    this.add(new SavesProbe());
  }
}
