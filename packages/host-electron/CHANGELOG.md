# @yagejs/host-electron

## 0.13.0

### Patch Changes

- [#419](https://github.com/marco-lepore/yage/pull/419) [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Experimental: run YAGE games in Electron with a host adapter and a locked-down shell. It has run on macOS only, not on Windows or Linux.
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

- Updated dependencies [[`f95a89a`](https://github.com/marco-lepore/yage/commit/f95a89adf82ca7d1785d101b615654996707d93d), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/save@0.13.0
  - @yagejs/core@0.13.0
