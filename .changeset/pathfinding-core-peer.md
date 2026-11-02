---
"@yagejs/pathfinding": patch
---

Declare `@yagejs/core` as a peer dependency instead of a dependency, as `@yagejs/effects` and the addons do. A project that installs pathfinding alongside a different core build (a workspace where only one package uses pathfinding, or a prerelease build of the engine) no longer gets a second copy of core, which would break `instanceof` checks and service keys, or fail to install when that core version is not on the registry.
