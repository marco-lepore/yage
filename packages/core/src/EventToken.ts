/**
 * A phantom-typed token for entity events.
 * Similar to ServiceKey, but used for entity-level event pub/sub.
 */
export class EventToken<T = void> {
  constructor(
    /** Unique string identifier for this event. */
    public readonly name: string,
  ) {}

  /** Phantom field to preserve the generic type. */
  declare readonly _type: T;
}

/** Create a typed event token. */
export function defineEvent<T = void>(name: string): EventToken<T> {
  return new EventToken<T>(name);
}
