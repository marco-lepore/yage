/**
 * Minimal typed event emitter backing the model's `on()` — internal, so the
 * headless core stays dependency-free (the engine's `EventBus` lives in
 * `@yagejs/core`, which the core layer deliberately doesn't import).
 */
export class Emitter<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents, Set<(payload: never) => void>>();

  /** Subscribe; returns an idempotent unsubscribe. */
  on<K extends keyof TEvents>(event: K, fn: (payload: TEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as (payload: never) => void);
    return () => set.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Snapshot so a listener unsubscribing (or subscribing) mid-emit is safe.
    for (const fn of [...set]) (fn as (payload: TEvents[K]) => void)(payload);
  }
}
