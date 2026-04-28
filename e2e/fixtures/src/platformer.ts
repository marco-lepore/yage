type Globals = typeof globalThis & {
  __YAGE_START_FROZEN__?: boolean;
  __YAGE_DETERMINISTIC_SEED__?: number;
};
(globalThis as Globals).__YAGE_START_FROZEN__ = true;
(globalThis as Globals).__YAGE_DETERMINISTIC_SEED__ = 0x00c0ffee;

// Dynamic import — a static import would be hoisted above the assignments,
// so the example's `main()` would read the globals before they're set.
await import("../../../examples/src/platformer.ts");
