/**
 * Dev-mode predicate. Returns `true` unless the bundler/runtime has marked
 * the build as production (`process.env.NODE_ENV === "production"`).
 *
 * Vite, esbuild, webpack, and tsup all replace `process.env.NODE_ENV` at
 * build time with a string literal when `NODE_ENV` is set, which lets the
 * `if (isDev())` guarded warning paths be tree-shaken out of minified
 * production bundles.
 *
 * @internal
 */
export function isDev(): boolean {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
    return false;
  }
  return true;
}

/**
 * Emit a `console.warn` only in dev mode, prefixed with a stable tag.
 * Call sites should use this rather than reaching for `console.warn`
 * directly so the warning path drops out of production bundles.
 *
 * @internal
 */
export function devWarn(message: string): void {
  if (!isDev()) return;
  console.warn(`[yage] ${message}`);
}
