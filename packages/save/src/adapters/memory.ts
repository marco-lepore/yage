import type { SaveAdapter } from "../Save.js";

/**
 * In-memory adapter — backed by a `Map<string, string>`. Useful for tests and
 * Node tooling. State lives on the instance; create a fresh adapter to reset.
 */
export function memoryAdapter(): SaveAdapter {
  const data = new Map<string, string>();
  return {
    async read(key) {
      return data.get(key) ?? null;
    },
    async write(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    async list(prefix) {
      const out: string[] = [];
      for (const k of data.keys()) {
        if (k.startsWith(prefix)) out.push(k);
      }
      return out;
    },
  };
}
