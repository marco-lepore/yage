---
"@yagejs/core": patch
---

Fix dev-mode warnings and the default `Logger` console sink running in production browser builds.

`isDev()` reads the bare `process.env.NODE_ENV` expression, which bundlers replace with a string literal at build time, so a Vite production build folds the predicate to `false`. No warning fires, and nothing behind an `isDev()` guard runs. Before this fix the check was guarded by `typeof process !== "undefined"`, and a browser bundle has no `process` global, so the check returned `true` and every `[yage]` warning fired in shipped games.

- `devWarn` no longer warns in production browser builds. The message strings and the `devWarn` calls stay in the bundle; each call returns before reaching `console.warn`.
- `Logger` no longer writes to the console by default in production browser builds. It writes to its ring buffer only unless `logger: { output }` is supplied, which is what the docs already describe.
- Precondition: the packages must go through a bundler (Vite, esbuild, webpack). Loading them in a browser without one throws `ReferenceError: process is not defined` on the first `isDev()` call.
