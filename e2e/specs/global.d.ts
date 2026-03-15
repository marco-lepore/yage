import type { Inspector, Logger } from "@yage/core";

declare global {
  interface Window {
    __yage__?: {
      inspector: Inspector;
      logger: Logger;
    };
  }
}

export {};
