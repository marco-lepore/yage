import { useRef, useEffect } from "react";
import type { RefObject } from "react";
import type { UISplitText, TextSegments } from "@yagejs/ui";

/** Optional teardown returned from a bind callback, run before the next rebind. */
export type SplitCleanup = () => void;

/**
 * Bind callback: receives the live segments after each (re)split, optionally
 * returning a cleanup — same contract as a `useEffect` effect.
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- optional-cleanup return, mirrors React's EffectCallback
export type SplitBind = (segments: TextSegments) => void | SplitCleanup;

/**
 * Bind animations to a `<SplitText>`'s segments across re-splits. Returns a
 * ref to put on the element; the optional `bind` callback runs once the
 * segments exist and again after every re-split (e.g. when the `text` prop
 * changes and the old `chars` are destroyed), so your animation always targets
 * the live glyphs. Return a cleanup from `bind` to tear down the previous
 * binding — same contract as `useEffect`.
 *
 * The hook is **animation-agnostic** — it owns only the segment lifecycle, not
 * how you animate. Drive `chars` / `words` / `lines` with the engine's `Tween`
 * / `Process`, GSAP, a manual ticker, or nothing at all.
 *
 * ```tsx
 * const ref = useSplitText<UISplitText>((seg) => {
 *   const stops = seg.chars.map((c, i) => {
 *     c.alpha = 0;
 *     return startTween(c, { alpha: 1 }, { delay: i * 0.05 });
 *   });
 *   return () => stops.forEach((s) => s.cancel());
 * });
 * return <SplitText ref={ref}>{label}</SplitText>;
 * ```
 *
 * For deferred / triggered animation, omit `bind` and read `ref.current` (its
 * `chars` / `segments`) in your event handler instead.
 */
export function useSplitText<T extends UISplitText = UISplitText>(
  bind?: SplitBind,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  // Keep the latest callback without re-subscribing every render.
  const bindRef = useRef(bind);
  bindRef.current = bind;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let cleanup: SplitCleanup | undefined;
    const run = (segments: TextSegments): void => {
      cleanup?.();
      const result = bindRef.current?.(segments);
      cleanup = typeof result === "function" ? result : undefined;
    };

    // Segments already exist (the node split at construction); bind now, then
    // rebind after every subsequent re-split.
    run(node.segments);
    const unsubscribe = node.onSplit(run);

    return () => {
      unsubscribe();
      cleanup?.();
    };
  }, []);

  return ref;
}
