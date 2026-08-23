/**
 * Small helpers shared between `Inspector.drive`'s context and
 * `@yagejs-tools/lab`'s ad-hoc `createDriveContext`, so the two build
 * `framesUsed` and `whileHolding` the same way instead of drifting.
 *
 * @internal
 */

/** Frames a drive has spent so far: `getFrame() - startFrame`. */
export function driveFramesUsed(getFrame: () => number, startFrame: number): number {
  return getFrame() - startFrame;
}

/** The default frames an ad-hoc drive may spend before it gives up. */
export const DEFAULT_DRIVE_MAX_FRAMES = 10_000;

interface DriveHoldInput {
  keyDown(code: string): void;
  keyUp(code: string): void;
  /** Key codes currently held, synthetic or real. */
  heldKeys(): readonly string[];
}

/**
 * Holds `codes` for the duration of `fn`, then restores what was held before
 * — including when `fn` throws. A code already down on entry is left alone on
 * both ends, so nesting composes: an inner call that repeats one of the outer
 * call's codes does not drop it when it returns.
 */
export async function driveWhileHolding(
  input: DriveHoldInput,
  codes: readonly string[],
  fn: () => Promise<void>,
): Promise<void> {
  const alreadyHeld = new Set(input.heldKeys());
  const pressed = [...new Set(codes)].filter((code) => !alreadyHeld.has(code));
  for (const code of pressed) input.keyDown(code);
  try {
    await fn();
  } finally {
    for (const code of pressed) input.keyUp(code);
  }
}
