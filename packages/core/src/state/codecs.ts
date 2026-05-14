/**
 * A codec converts a value between its in-memory representation `T` and a
 * JSON-safe encoded form `TEncoded` that adapters can stringify. `encode`
 * always returns the encoded form; `decode` takes `unknown` because the input
 * is whatever an adapter produced from storage (which may be corrupt or
 * legacy) and must be validated/coerced.
 *
 * `TEncoded` defaults to `T` so identity codecs (most callers) need only one
 * type parameter.
 */
export interface Codec<T, TEncoded = T> {
  encode(value: T): TEncoded;
  decode(raw: unknown): T;
}

/** Identity codec — pass-through for plain JSON-serializable values. */
export function jsonCodec<T>(): Codec<T, T> {
  return {
    encode: (value) => value,
    decode: (raw) => raw as T,
  };
}

/** Set ↔ array. */
export function setCodec<K>(): Codec<Set<K>, K[]> {
  return {
    encode: (value) => Array.from(value),
    decode: (raw) => {
      if (!Array.isArray(raw)) {
        throw new Error("setCodec.decode: expected an array");
      }
      return new Set(raw as K[]);
    },
  };
}

/** Map ↔ entries array. */
export function mapCodec<K, V>(): Codec<Map<K, V>, Array<[K, V]>> {
  return {
    encode: (value) => Array.from(value.entries()),
    decode: (raw) => {
      if (!Array.isArray(raw)) {
        throw new Error("mapCodec.decode: expected an array of entries");
      }
      return new Map(raw as Array<[K, V]>);
    },
  };
}

/** Date ↔ ISO string. */
export function dateCodec(): Codec<Date, string> {
  return {
    encode: (value) => value.toISOString(),
    decode: (raw) => {
      if (typeof raw !== "string") {
        throw new Error("dateCodec.decode: expected an ISO string");
      }
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`dateCodec.decode: invalid ISO string ${JSON.stringify(raw)}`);
      }
      return d;
    },
  };
}
