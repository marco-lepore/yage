import type { Inspector, Logger } from "@yagejs/core";

declare global {
  interface Window {
    __yage__?: {
      /**
       * Installed by DebugPlugin during `start()`, after this global is
       * published, so it is undefined until then. Specs read it after
       * `waitForInspector` (which awaits `ready`); a wait predicate that can
       * run earlier reads it as `__yage__?.inspector?.`.
       */
      inspector: Inspector;
      logger: Logger;
      /** Resolves when the engine finished starting; rejects with the boot error. */
      ready: Promise<void>;
    };
  }
}

export {};
