/**
 * True if `value` is a thenable — an object with a callable `.then`. Used to
 * detect an `async` function passed where a callback is typed void-returning
 * (nothing at the type level stops that), so its rejection can be caught
 * instead of silently escaping as an unhandled promise rejection.
 * @internal
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}
