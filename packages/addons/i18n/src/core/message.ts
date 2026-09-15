/** A value a `{name}` token can be replaced with. */
export type MessageValue = string | number | boolean | null;
export type MessageValues = Readonly<Record<string, MessageValue>>;

/**
 * A translatable piece of text: the catalog `key`, the authored `fallback`
 * shown when no catalog has the key, and optional interpolation `values`.
 * Plain frozen data; creating one translates nothing.
 */
export interface Message {
  readonly key: string;
  readonly fallback: string;
  readonly values?: MessageValues;
}

/** Turns a message into display text for the current locale. */
export type MessageResolver = (
  message: Message,
  values?: MessageValues,
) => string;

function isMessageValues(value: unknown): value is MessageValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry)),
  );
}

/**
 * Create a {@link Message}. Throws on an empty key, a non-string fallback, or
 * a value that is not a string, finite number, boolean, or `null`. The result
 * and its `values` are frozen.
 */
export function msg(
  key: string,
  fallback: string,
  values?: MessageValues,
): Message {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("msg: key must be a non-empty string.");
  }
  if (typeof fallback !== "string") {
    throw new Error(`msg: fallback for "${key}" must be a string.`);
  }
  if (values === undefined) return Object.freeze({ key, fallback });
  if (!isMessageValues(values)) {
    throw new Error(
      `msg: values for "${key}" must contain only strings, finite numbers, booleans, or null.`,
    );
  }
  return Object.freeze({ key, fallback, values: Object.freeze({ ...values }) });
}

/** Whether `value` has the shape of a {@link Message}. */
export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    candidate.key.length > 0 &&
    typeof candidate.fallback === "string" &&
    (candidate.values === undefined || isMessageValues(candidate.values))
  );
}

/** Matches an interpolation token `{name}` (word characters only). */
const TOKEN = /\{(\w+)\}/g;

/**
 * Replace each `{name}` token in `text` with `values[name]`. Unknown tokens
 * stay as written. Own properties only, so `{constructor}` is not a token.
 */
export function formatText(
  text: string,
  values?: Readonly<Record<string, unknown>>,
): string {
  if (!values) return text;
  return text.replace(TOKEN, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}

/**
 * The text a message shows with no localization service: its fallback with
 * `values` interpolated over `message.values`.
 */
export function formatFallback(
  message: Message,
  values?: MessageValues,
): string {
  return formatText(message.fallback, { ...message.values, ...values });
}
