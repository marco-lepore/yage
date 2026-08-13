---
"@yagejs/renderer": patch
---

An engine peer range names the one engine minor the package was built and tested against.

- The optional `@yagejs/save` peer range is `>=0.10.2 <0.11.0`. It admitted every save from 0.3.0 up to 1.0.0 before, which npm read as a promise that any of them would work. `RendererPlugin` and `RendererSnapshotContributor` are typed against `SnapshotContributor`, which a save below 0.4.0 does not export, and the rest of that window was never built or run.
- A game holding renderer and save on different minors now gets a version conflict from npm at install time. The previous range let that install succeed silently and resolve two copies of `@yagejs/core`, one under each package, each with its own service container and class identities.
- The peer stays optional, so a game that installs no save package is unaffected.
