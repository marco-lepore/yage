/**
 * Prototype of the lazy `service()` proxy targets. Anything but
 * `Object.prototype`, so the Inspector's plain-object check skips such a field
 * instead of resolving the service while reflecting. A `sibling()` proxy
 * targets its component class's prototype instead, which the same check skips.
 * @internal
 */
export const lazyRefPrototype: object = {};
