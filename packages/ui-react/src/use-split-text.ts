import { useRef, useMemo, useEffect, useCallback, useState } from "react";
import type { RefCallback } from "react";
import type { Process } from "@yagejs/core";
import { ProcessSystemKey, makeSceneScopedQueue } from "@yagejs/core";
import type { UISplitText, TextSegments } from "@yagejs/ui";
import { useEngine, useScene } from "./hooks.js";

/** Handle to the processes a single `run()` call enqueued. */
export interface SplitRunHandle {
  /** Cancel just the processes this `run()` started. */
  cancel(): void;
}

/**
 * Imperative controls over a `<SplitText>`, returned alongside its ref. The
 * segment accessors read the live element each time, so they stay correct
 * across re-splits (a `text` change destroys and recreates `chars`).
 */
export interface SplitTextControls {
  /** Live per-glyph display objects, in reading order. */
  readonly chars: TextSegments["chars"];
  /** Live word-group containers. */
  readonly words: TextSegments["words"];
  /** Live line-group containers. */
  readonly lines: TextSegments["lines"];
  /** Live `chars` / `words` / `lines` as one object. */
  readonly segments: TextSegments;
  /** Re-split now (only needed under `autoSplit={false}`). */
  resplit(): void;
  /**
   * Enqueue one or more `Process`es on the scene's process queue (so they
   * pause with the scene and are torn down on unmount / re-split). Pair with
   * `Tween.stagger` to cascade tweens across `chars`. Returns a handle to
   * cancel just this batch.
   */
  run(processes: Process | Process[]): SplitRunHandle;
}

/**
 * Imperative access to a `<SplitText>` for programmatic animation. Returns a
 * `[ref, controls]` tuple: put `ref` on the element, then reach `chars` /
 * `words` / `lines` and `run` tweens whenever you like (an event handler, an
 * effect, a timeout) rather than binding up front.
 *
 * `run` schedules on a scene-scoped process queue, so animations pause with
 * the scene and are cancelled on unmount. In-flight processes are also
 * cancelled when the text re-splits, so a tween never writes to a destroyed
 * glyph.
 *
 * ```tsx
 * const [ref, split] = useSplitText();
 * const reveal = () =>
 *   split.run(
 *     Tween.stagger(
 *       split.chars,
 *       (char) => Tween.custom((v) => (char.alpha = v), 0, 1, 0.3),
 *       0.05,
 *     ),
 *   );
 * return <SplitText ref={ref} onPointerOver={reveal}>{label}</SplitText>;
 * ```
 */
export function useSplitText<T extends UISplitText = UISplitText>(): [
  RefCallback<T>,
  SplitTextControls,
] {
  const ref = useRef<T | null>(null);
  const [node, setNode] = useState<T | null>(null);
  const setRef = useCallback<RefCallback<T>>((next) => {
    ref.current = next;
    setNode(next);
  }, []);
  const engine = useEngine();
  const scene = useScene();

  const queue = useMemo(
    () => makeSceneScopedQueue(engine.resolve(ProcessSystemKey), scene),
    [engine, scene],
  );

  // A re-split destroys the old glyph objects, so cancel anything still
  // animating them; cancel everything on unmount too.
  useEffect(() => {
    if (!node) return;
    const off = node.onSplit(() => queue.cancelAll());
    return () => {
      off();
      queue.cancelAll();
    };
  }, [node, queue]);

  const controls = useMemo<SplitTextControls>(
    () => ({
      get chars() {
        return ref.current?.chars ?? [];
      },
      get words() {
        return ref.current?.words ?? [];
      },
      get lines() {
        return ref.current?.lines ?? [];
      },
      get segments(): TextSegments {
        return ref.current?.segments ?? { chars: [], words: [], lines: [] };
      },
      resplit() {
        ref.current?.resplit();
      },
      run(processes) {
        const batch = Array.isArray(processes) ? processes : [processes];
        for (const p of batch) queue.run(p);
        return {
          cancel() {
            for (const p of batch) p.cancel();
          },
        };
      },
    }),
    [queue],
  );

  return [setRef, controls];
}
