---
"@yagejs-tools/editor": patch
---

Add `yage-editor validate`, which checks every level file against the project's entity declarations without a browser.

It reads the editor config, imports the project module through the project's own Vite config with Vite's SSR loader, builds the catalog, and runs `readLevel` and `validateLevel` over every file the level globs match. Nothing is rendered and no `setup()` runs.

Problems print grouped by file, each naming the placement, the parameter path, the diagnostic code and the message, followed by a count line. The command exits 1 on any catalog problem, structural error, import failure or diagnostic, and 0 when every level is clean — including when the globs match no file, which it says. A catalog problem is reported against the project module and stops the run, since there is no catalog to check a level against.

The `@yagejs/*` packages the project's modules import are transformed by Vite as well, rather than loaded by Node, so a module that imports `@yagejs/physics` (whose `@dimforge/rapier2d` Node cannot resolve) or `@yagejs/audio` is checked like any other. An import that reads `window` or `document` while it is evaluated fails, and the error says to move that import out of the entity modules or into the code that uses it.

`--config` names a config file other than `editor/config.ts`.
