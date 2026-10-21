/**
 * The longest adapter key, in UTF-8 bytes. `fileAdapter` stores a key this
 * long in one file name, and `Save` refuses a longer key on every adapter, so
 * a store behaves the same in a web build and a packaged one.
 */
export const MAX_KEY_BYTES = 96;

const encoder = new TextEncoder();

/** The length of `key` in UTF-8 bytes. */
export function keyBytes(key: string): number {
  return encoder.encode(key).length;
}

/** Whether `key` is longer than {@link MAX_KEY_BYTES} in UTF-8. */
export function exceedsKeyBudget(key: string): boolean {
  return keyBytes(key) > MAX_KEY_BYTES;
}
