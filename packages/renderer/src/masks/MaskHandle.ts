/**
 * Public handle returned by `setMask` / `attachMask`. Idempotent on
 * `remove()`. Mirrors the {@link EffectHandle} ergonomics so the two APIs
 * feel like siblings without sharing a stack abstraction (masks are
 * exclusive — one per container — so they don't compose like effects do).
 */
export interface MaskHandle {
  /**
   * Detach the mask from its target. Destroys the underlying mask node when
   * the factory owned it (rect/graphics) and leaves user-supplied nodes
   * (sprite) intact. Safe to call repeatedly.
   */
  remove(): void;

  /**
   * Toggle inverse-mask mode. Forwards to pixi v8
   * `Container.setMask({ mask, inverse })`.
   */
  setInverse(on: boolean): void;

  /** Current inverse state. */
  readonly inverse: boolean;

  /**
   * Re-run the original draw function on a `graphicsMask`. No-op for
   * `rectMask` / `spriteMask`. Call this whenever the data the draw closure
   * depends on changes (e.g. after a layout pass updates dimensions).
   */
  redraw(): void;

  /**
   * Serialize this mask's definition + state for save/load. Returns `null`
   * for masks that can't be reproduced from a snapshot — `spriteMask` (holds
   * a Sprite reference) and `graphicsMask` (holds a draw closure). Only
   * masks built from `defineMask`-registered factories return a snapshot.
   */
  serialize(): MaskSnapshot | null;
}

/**
 * Serialized state for a mask. Re-attached via `target.setMask` using the
 * registered `MaskDefinition` matching `name`.
 */
export interface MaskSnapshot {
  readonly name: string;
  readonly options: unknown;
  readonly inverse: boolean;
}
