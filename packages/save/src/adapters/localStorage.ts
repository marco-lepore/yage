import type { SaveAdapter } from "../Save.js";

export interface LocalStorageAdapterOptions {
  /** Key namespace. Every key is prefixed with `${namespace}:`. Defaults to "yage". */
  namespace?: string;
}

/**
 * Browser localStorage-backed adapter. Throws helpfully on quota and
 * unsupported environments.
 */
export function localStorageAdapter(
  opts: LocalStorageAdapterOptions = {},
): SaveAdapter {
  const namespace = opts.namespace ?? "yage";
  const prefix = `${namespace}:`;

  const ls = (): Storage => {
    if (typeof window === "undefined" || !window.localStorage) {
      throw new Error(
        "localStorageAdapter: window.localStorage is not available in this environment.",
      );
    }
    return window.localStorage;
  };

  return {
    async read(key) {
      return ls().getItem(prefix + key);
    },
    async write(key, value) {
      try {
        ls().setItem(prefix + key, value);
      } catch (err) {
        if (
          err instanceof DOMException &&
          (err.name === "QuotaExceededError" ||
            err.name === "NS_ERROR_DOM_QUOTA_REACHED")
        ) {
          throw new Error(
            `localStorageAdapter: quota exceeded while writing "${prefix + key}". ` +
              `Consider deleting old slots or using a different adapter.`,
            { cause: err },
          );
        }
        throw err;
      }
    },
    async delete(key) {
      ls().removeItem(prefix + key);
    },
    async list(keyPrefix) {
      const storage = ls();
      const full = prefix + keyPrefix;
      const out: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k != null && k.startsWith(full)) {
          out.push(k.slice(prefix.length));
        }
      }
      return out;
    },
  };
}
