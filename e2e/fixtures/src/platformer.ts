type Globals = typeof globalThis & {
  __YAGE_START_FROZEN__?: boolean;
  __YAGE_DETERMINISTIC_SEED__?: number;
};
(globalThis as Globals).__YAGE_START_FROZEN__ = true;
(globalThis as Globals).__YAGE_DETERMINISTIC_SEED__ = 0x00c0ffee;

import "../../../examples/src/platformer.ts";
