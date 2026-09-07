/**
 * Prototype of the lazy `service()` / `sibling()` proxy targets. Anything but
 * `Object.prototype`, so the Inspector's plain-object check skips such a field
 * instead of resolving the service or sibling while reflecting.
 * @internal
 */
export const lazyRefPrototype: object = {};
