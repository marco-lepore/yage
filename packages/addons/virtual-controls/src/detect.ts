/**
 * Whether this device wants on-screen controls: its PRIMARY pointer is
 * coarse (a finger). Phones and tablets match; desktops — including
 * touch-screen laptops, whose primary pointer is still the mouse — don't.
 * SSR-safe (false without a `window`).
 *
 * This is the `visible: "auto"` policy of {@link VirtualControls}; call it
 * directly when the game wants its own blend (e.g. OR-ing a saved setting).
 */
export function prefersTouchControls(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch {
      // Fall through to the touch-points heuristic.
    }
  }
  return (globalThis.navigator?.maxTouchPoints ?? 0) > 0;
}
