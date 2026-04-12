import type { Inspector, Logger } from "@yagejs/core";

/** Mirrors IDebugClock from @yagejs/debug (kept inline to avoid ambient import issues). */
interface IDebugClock {
  readonly isManual: boolean;
  startAuto(): void;
  stopAuto(): void;
  step(dtMs?: number): void;
  stepFrames(count: number, dtMs?: number): void;
}

declare global {
  interface Window {
    __yage__?: {
      inspector: Inspector;
      logger: Logger;
      clock?: IDebugClock;
    };
  }
}

export {};
