/**
 * The development warning a focus-scope host in this package prints when it
 * finds no focus stack to register with.
 *
 * `@yagejs/ui-react`'s `UIRoot` prints the same sentence from its own copy,
 * because this helper is internal to `@yagejs/ui`. A test beside each copy
 * holds it to the exact sentence.
 */

import { devWarn } from "@yagejs/core";

/** How a warning names the tree an element hangs in. */
export function describeTree(label: string | undefined): string {
  return label === undefined ? "this UI tree" : `the "${label}" UI tree`;
}

/**
 * Warn that `host` built a focus scope with no stack behind it. `host` is the
 * subject of the sentence: the element and the tree it sits in.
 * @internal
 */
export function warnMissingFocusStack(host: string): void {
  devWarn(
    `${host} has no focus stack, so its focus scope reads no keyboard or ` +
      "gamepad input. UIPlugin registers one per scene as the scene is " +
      "entered.",
  );
}
