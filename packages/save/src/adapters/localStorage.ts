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
    if (typeof window === "undefined") {
      throw new Error(
        "localStorageAdapter: window is not available in this environment.",
      );
    }
    // Safari with cookies blocked, private-mode iframes, and some embedded
    // contexts throw `SecurityError` on the property access itself — not
    // just on get/set. Catch eagerly and rethrow with a normalized message
    // so callers don't have to handle raw DOMExceptions.
    try {
      const storage = window.localStorage;
      if (!storage) {
        throw new Error(
          "localStorageAdapter: window.localStorage is not available in this environment.",
        );
      }
      return storage;
    } catch (err) {
      throw new Error(
        "localStorageAdapter: window.localStorage is not available in this environment.",
        { cause: err },
      );
    }
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
