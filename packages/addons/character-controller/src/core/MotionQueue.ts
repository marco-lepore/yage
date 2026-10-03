import { validateMotionIntent } from "./MotionIntent.js";
import type {
  DurableIntentHandle,
  MotionIntent,
  MotionIntentHandle,
} from "./MotionIntent.js";

interface HeldIntent {
  readonly intent: MotionIntent;
  resolved: boolean;
  ended: boolean;
}

/** Stores lifetimes only. MotionReconciler owns arbitration and the body write. */
export class MotionQueue {
  private readonly continuous: MotionIntent[] = [];
  private readonly held = new Set<HeldIntent>();

  submit(intent: MotionIntent): void {
    validateMotionIntent(intent);
    this.continuous.push({ ...intent });
  }

  submitOnce(intent: MotionIntent): MotionIntentHandle {
    const handle = this.submitDurable(intent);
    handle.end();
    return handle;
  }

  submitDurable(intent: MotionIntent): DurableIntentHandle {
    validateMotionIntent(intent);
    const held: HeldIntent = {
      intent: { ...intent },
      resolved: false,
      ended: false,
    };
    this.held.add(held);
    const entries = this.held;
    return {
      get active() {
        return entries.has(held);
      },
      end() {
        held.ended = true;
        if (held.resolved) entries.delete(held);
      },
      cancel() {
        entries.delete(held);
      },
    };
  }

  /** Frozen steering is stale; held and one-time requests retain their lifetime. */
  discardContinuous(): void {
    this.continuous.length = 0;
  }

  get intents(): readonly MotionIntent[] {
    return [
      ...Array.from(this.held, (entry) => entry.intent),
      ...this.continuous,
    ];
  }

  /** Call only after an advancing arbitration, including refusal of losing claims. */
  resolved(): void {
    this.discardContinuous();
    for (const entry of this.held) {
      entry.resolved = true;
      if (entry.ended) this.held.delete(entry);
    }
  }

  cancelAll(): void {
    this.discardContinuous();
    this.held.clear();
  }
}
