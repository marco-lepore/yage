/**
 * `compact(obj)` returns a shallow copy with every `undefined`-valued key
 * removed. Internal helper for the factories: a {@link DialogueTheme} carries
 * optional fields (`bitmapFont`, `fontFamily`, `resolution`, ...) typed as
 * `T | undefined`, but the presenter configs declare them as `?: T` — and under
 * `exactOptionalPropertyTypes` you may not assign `undefined` to a `?:`-optional
 * property. Dropping the `undefined` keys lets a partially-filled theme satisfy
 * the stricter config types without per-field `if` ladders in each factory.
 */
export function compact<T extends object>(obj: T): {
  [K in keyof T]: Exclude<T[K], undefined>;
} {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}
