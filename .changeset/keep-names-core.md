---
"@yagejs/core": minor
---

A game's production bundle can now leave out the engine classes it does not use. The packages were built with `keepNames`, which adds a name-setting block to every class that bundlers cannot remove, so every class stayed in the bundle. In a small game, leaving the Inspector out now saves about 25 KB minified (7.4 KB gzip).

- Breaking: a minified production build shows short names for engine classes unless the game keeps names with `build.rollupOptions.output.keepNames: true` in `vite.config.ts`. Without it, an error report names the failing system or component by its short name (`System q`), the Inspector lists short types and a lookup by class name finds nothing, and an entity spawned without a name gets a short name. The dev server does not minify. Both `create-yage` templates set the option.
- An `Entity` class can declare `static defaultName` to set the name its entities get when spawned without one, whatever the build does to class names. A subclass that does not declare its own is still named after its own class. `TimerEntity` declares one.
