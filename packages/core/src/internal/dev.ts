/**
 * Dev-mode predicate. Returns `true` unless `process.env.NODE_ENV` is
 * `"production"`.
 *
 * The bare `process.env.NODE_ENV` token is read on purpose: bundlers (Vite,
 * esbuild, webpack) replace exactly that token with a string literal at build
 * time, so a production build folds the predicate to `false` in a browser as
 * well as in Node. A `typeof process` guard would defeat the fold, because
 * after replacement it would be the only reference to `process` left and a
 * browser has none. Loading the packages in a browser without a bundler is
 * not supported and throws a `ReferenceError` on the first call.
 *
 * @internal
 */
export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Emit a `console.warn` only in dev mode, prefixed with a stable tag.
 * Call sites should use this rather than reaching for `console.warn`
 * directly so the warning never fires in a production build. The message
 * string itself can remain in the bundle.
 *
 * @internal
 */
export function devWarn(message: string): void {
  if (!isDev()) return;
  console.warn(`[yage] ${message}`);
}
