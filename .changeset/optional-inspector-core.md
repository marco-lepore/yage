---
"@yagejs/core": minor
---

The engine no longer creates an Inspector. `DebugPlugin` or the new `InspectorPlugin` installs one, so a production build that installs neither ships none of its code.

- Breaking: `engine.inspector` is removed. `DebugPlugin` installs the Inspector, and the new `InspectorPlugin` installs it without the debug overlay. Reach it with `engine.context.resolve(InspectorKey)`; `debug: true` still publishes it as `window.__yage__.inspector`.
- `installInspector(context)` is the installer both plugins use. It reuses an Inspector that is already installed and returns a remover that only removes an Inspector it created, so using `DebugPlugin` and `InspectorPlugin` together gives one Inspector.
- `window.__yage__.inspector` reads the installed Inspector and is `undefined` when there is none. With `debug: true` and no Inspector installed, `start()` warns once in dev builds.
- `window.__yage__` is published when `start()` begins, but `inspector` appears only when `DebugPlugin` or `InspectorPlugin` installs, which can be after other plugins have awaited their own setup. A test driver that polls it reads `window.__yage__?.inspector?.…` or awaits `window.__yage__.ready` first; `window.__yage__?.inspector.…` can throw during startup.
- The Inspector's scene event log now attaches and detaches through the installing plugin's scene hooks, which run after the hooks of plugins installed before it. Events those plugins emit from `beforeEnter` are no longer logged, and events they emit from `afterExit` now are.
- `ServiceKey` takes a `missingHint` option, appended to the error thrown when the key resolves nowhere. Resolving `InspectorKey` with no Inspector installed names `DebugPlugin` and `InspectorPlugin`.
- `createTestEngine(config?, plugins?)` installs `plugins` before starting. Pass `[new InspectorPlugin()]` for a test that reads the Inspector.
- Crash reporting without an Inspector: `engine.context.resolve(ErrorBoundaryKey).getCallbackErrors()` returns the list `Inspector.getErrors().callbackErrors` reads.
- A plugin that registers an Inspector extension or facet contributor should do it in `onStart`, when every plugin has installed.
