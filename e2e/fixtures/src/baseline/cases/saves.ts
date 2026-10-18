import { Entity, Transform, Vec2, createStore } from "@yagejs/core";
import { SaveServiceKey } from "@yagejs/save";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** The store id the case reads and writes. */
const DOCUMENT = "progress";

/** The slot the case keeps beside the document. */
const SLOT = "launch";

/** How many times this profile started the fixture. */
const progress = createStore((state) => ({
  launches: state.counter({ default: 0 }),
}));

/** What the saves case reports. */
export interface SavesReading extends CaseReading {
  launchesBefore: number | null;
  launchesAfter: number | null;
  slotBefore: number | null;
  slotAfter: number | null;
  failure: string | null;
}

/** What the slot carries so the listing can be read without loading it. */
interface LaunchMeta {
  launches: number;
}

/**
 * Reads the stored launch count, adds this launch and writes it back, as a
 * document and as a slot, so a relaunch on the same profile reads what the
 * previous run left.
 */
export class SavesProbe extends CaseProbe {
  private readonly save = this.service(SaveServiceKey);
  private launchesBefore: number | null = null;
  private launchesAfter: number | null = null;
  private slotBefore: number | null = null;
  private slotAfter: number | null = null;
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
      slotBefore: this.slotBefore,
      slotAfter: this.slotAfter,
      failure: this.failure,
    };
  }

  /** The launch count the stored slot reports, or `null` when it has none. */
  private async listedLaunches(): Promise<number | null> {
    const slots = await this.save.listSlots<LaunchMeta>(DOCUMENT);
    const listed = slots.find((slot) => slot.name === SLOT);
    return listed?.metadata?.launches ?? null;
  }

  private async record(): Promise<void> {
    try {
      await this.save.restore(DOCUMENT, progress);
      this.launchesBefore = progress.launches.value();
      this.slotBefore = await this.listedLaunches();
      progress.launches.increment(1);
      await this.save.persist(DOCUMENT, progress);
      this.launchesAfter = progress.launches.value();
      await this.save.saveSlot<unknown, LaunchMeta>(DOCUMENT, SLOT, progress, {
        metadata: { launches: this.launchesAfter },
      });
      this.slotAfter = await this.listedLaunches();
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
