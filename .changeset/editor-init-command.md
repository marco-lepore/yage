---
"@yagejs-tools/editor": patch
---

Add `yage-editor init`, which sets a project up for the editor.

It writes `editor/config.ts`, `editor/harness.ts` and `src/levelProject.ts` under the project's Vite root, and adds an `"editor"` script to `package.json`. What the command can read off the project is prefilled: a plugin for each `@yagejs/*` package the project declares that has one (`save`, `level`, `pathfinding` and `effects` contribute none), level globs naming the directories that already hold `*.yage-level.json` files, `../src/layers.ts` when that module exists, and `public/**/*.png` when that directory exists. The placeable entity classes and `gamePage` are left for the developer, since neither can be read off a project.

The generated harness is a plain default-exported `{ engine, plugins }` object that imports neither this package nor `@yagejs-tools/lab`. A project that already has a scenario lab harness gets a one-line re-export of it rather than a second plugin list.

A file that is already there is kept and named in the output; `--force` rewrites it.
