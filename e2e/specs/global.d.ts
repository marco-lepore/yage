import type { Inspector, Logger } from "@yagejs/core";

declare global {
  interface Window {
    __yage__?: {
      inspector: Inspector;
      logger: Logger;
      /** Resolves when the engine finished starting; rejects with the boot error. */
      ready: Promise<void>;
    };
  }
}

export {};
