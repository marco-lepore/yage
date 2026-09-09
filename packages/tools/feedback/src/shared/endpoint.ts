/** A route prefix consists of literal URL path segments, with a trailing slash. */
export function normalizeBasePath(value: string): string {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*\/?$/.test(value))
    throw new Error(
      "Feedback base path must contain only slash-separated letters, digits, underscores, or hyphens.",
    );
  return value.endsWith("/") ? value : value + "/";
}
