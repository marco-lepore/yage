import { Entity, Transform, Vec2 } from "@yagejs/core";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** The number the worker is asked to double. */
const QUESTION = 21;

/** What the workers case reports. */
export interface WorkersReading extends CaseReading {
  reply: number | null;
}

/** Starts a module worker, asks it one question and keeps the answer. */
export class WorkersProbe extends CaseProbe {
  private reply: number | null = null;

  onAdd(): void {
    const worker = new Worker(new URL("../worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener(
      "message",
      (event: MessageEvent<{ doubled: number }>) => {
        this.reply = event.data.doubled;
      },
    );
    worker.postMessage({ n: QUESTION });
    this.addCleanup(() => worker.terminate());
  }

  get settled(): boolean {
    return this.reply !== null;
  }

  reading(): WorkersReading {
    return { reply: this.reply };
  }
}

/** A worker started by the page, so a shell's worker support is exercised. */
export class WorkersCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(600, 300) }));
    this.add(new WorkersProbe());
  }
}
