---
"@yagejs/core": minor
---

The engine no longer creates an Inspector, so a production build that does not install one ships none of its code.

- Breaking: `engine.inspector` is removed. `DebugPlugin` installs the Inspector, and the new `InspectorPlugin` installs it without the debug overlay. Reach it with `engine.context.resolve(InspectorKey)`; `debug: true` still publishes it as `window.__yage__.inspector`.
- `installInspector(context)` is the installer both plugins use. It reuses an Inspector that is already installed and returns a remover that only removes an Inspector it created, so using `DebugPlugin` and `InspectorPlugin` together gives one Inspector.
- `window.__yage__.inspector` reads the installed Inspector and is `undefined` when there is none. With `debug: true` and no Inspector installed, `start()` warns once in dev builds.
- `createTestEngine(config?, plugins?)` installs `plugins` before starting. Pass `[new InspectorPlugin()]` for a test that reads the Inspector.
- Crash reporting without an Inspector: `engine.context.resolve(ErrorBoundaryKey).getCallbackErrors()` returns the list `Inspector.getErrors().callbackErrors` reads.
- A plugin that registers an Inspector extension or facet contributor should do it in `onStart`, when every plugin has installed.

In a small game's production bundle, leaving the Inspector out saves about 25 KB minified (7.4 KB gzip).
