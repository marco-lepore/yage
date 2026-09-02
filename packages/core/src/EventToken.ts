import { devWarn, isDev } from "./internal/dev.js";

/**
 * A phantom-typed token for entity events.
 * Similar to ServiceKey, but used for entity-level event pub/sub.
 */
export class EventToken<T = void> {
  constructor(
    /** String identifier for this event. Dispatch is by name, not by token. */
    public readonly name: string,
  ) {}

  /** Phantom field to preserve the generic type. */
  declare readonly _type: T;
}

/** Names defined so far, for the dev-only duplicate warning. */
const definedNames = new Set<string>();

/**
 * Create a typed event token. Entity and scene events dispatch by the name
 * string, so two tokens with one name are one channel whose payload types
 * are not checked against each other; in dev builds a second definition of
 * a name warns.
 */
export function defineEvent<T = void>(name: string): EventToken<T> {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      `defineEvent: name must be a non-empty string, got ${JSON.stringify(name)}.`,
    );
  }
  if (isDev()) {
    if (definedNames.has(name)) {
      devWarn(
        `defineEvent("${name}"): a token with this name already exists. Events dispatch by name, so both tokens share one channel and their payload types are not checked against each other. Prefix the name with the owning module, e.g. "inventory:${name}".`,
      );
    } else {
      definedNames.add(name);
    }
  }
  return new EventToken<T>(name);
}
