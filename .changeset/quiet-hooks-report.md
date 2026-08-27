---
"@yagejs/core": patch
---

Report two error paths that were invisible.

- `ErrorBoundary.wrapSystem` / `wrapComponent` now detect a rejected thenable,
  so an `async update()` — which compiles against the void-returning signature
  without a diagnostic — is recorded in
  `Inspector.getErrors().callbackErrors` and logged instead of failing
  silently.
- A throwing plugin `afterExit` hook is reported through the error boundary
  rather than written straight to `Logger`, so it lands on the same error
  surface as every other callback failure. The remaining plugins still tear
  their scene state down.
