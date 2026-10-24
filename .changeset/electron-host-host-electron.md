---
"@yagejs/host-electron": patch
---

Run YAGE games in Electron with a host adapter and a locked-down shell.

- New package. The page side exports `ElectronHostPlugin`, a `Plugin` named `host` that reports the window's identity, activity, visibility and focus to `engine.host` and registers a `HostDisplay` whose fullscreen is the window's, whatever started it: the menu, the system button or the game.
- `electronSaveAdapter()` is a `SaveAdapter` that writes saves as files in the app's data directory. The write runs in the main process, so a renderer that crashes during a save does not stop the write.
- `isElectronHost()` from `@yagejs/host-electron/detect` says whether the page runs in such a shell. The entry imports nothing else, so a browser build can ask before it loads the rest.
- `startGame(options)` from `@yagejs/host-electron/main` is the one call a shell's main script makes. It serves the built web directory from `yage://game` under `DEFAULT_CONTENT_SECURITY_POLICY`, which forbids turning strings into code; grants the page what a browser tab grants without a prompt plus the permissions the shell declares; keeps the page where it is; serves the bridge and the save channels to the game page alone; takes the single-instance lock; and quits when the window closes.
- `startGame` registers the `yage` scheme before it returns and reports every failure, an invalid option included, by rejecting the promise it returns, so the shell's `catch` handles each one.
- `externalLinks` names the links `window.open` passes to the system browser or mail client. An `http` or `https` entry allows its origin and the paths at or below its own path, by whole segments, so `https://example.dev/docs` never allows `/docs-private`. A `mailto` entry allows that exact address with no query. `startGame` rejects an `http` or `https` entry with a user name, password, query or hash, a bare `mailto:`, and a `mailto` entry with a query.
- A packaged app started with Chromium's `--remote-debugging-port` or `--remote-debugging-pipe` switch does not load the game: `startGame` rejects and opens no window. Chromium may already have opened the port by then.
- `nodeFileStore(directory)` and `saveDirectory({ appId, profile })` from the same entry give main-process code the store and the path the saves live in. The directory follows the app's own identifier, so renaming the app leaves the saves where they are.
- `@yagejs/host-electron/preload` is the sandboxed preload script the shell loads. It exposes one frozen object with a fixed operation table at protocol 1; a shell and a game built from different protocols refuse each other with a message naming the fix.
- `electron` is a peer dependency at `^44.7.0`.
