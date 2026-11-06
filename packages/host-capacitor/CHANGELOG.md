# @yagejs/host-capacitor

## 0.13.0

### Patch Changes

- [#419](https://github.com/marco-lepore/yage/pull/419) [`b8b51c5`](https://github.com/marco-lepore/yage/commit/b8b51c5de6e2b30e5df4a5ef6edaa114d18d9ec0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Experimental: run YAGE games in Capacitor apps with a host adapter. It has run in the iOS simulator only, not on Android or on a physical device.
  - New package. `CapacitorHostPlugin` is a `Plugin` named `host` that reports the app's identity, activity and visibility to `engine.host`, registers a `HostDisplay` whose orientation lock goes through the app, and delivers the Android Back button as the key `"BrowserBack"`. With no action bound to that key, a press moves the app to the background.
  - Activity and visibility are mapped per system from the App plugin's `appStateChange`, `pause` and `resume` events. Focus comes from the page.
  - The orientation lock resolves once the screen reads as the lock asked, or after 2000 ms when the system turns nothing. Fullscreen is reported unsupported in an Android web view, which leaves element fullscreen in the call that enters it; on iOS it stays with the page.
  - `capacitorSaveAdapter(options?)` is a `SaveAdapter` that writes saves as files in the app's private Library directory, one directory per build profile. Without a `profile`, a build where `Capacitor.DEBUG` is true saves under `development` and any other build under `release`. The iOS simulator sets `Capacitor.DEBUG` in every build. A write that resolved is held when the app is killed; neither system's write reaches the storage hardware, so the same write is not guaranteed to survive a power loss.
  - `isCapacitorHost()` from `@yagejs/host-capacitor/detect` says whether the page runs inside a Capacitor app. The entry imports nothing else, so a browser build can ask before it loads the rest.
  - `@capacitor/core`, `@capacitor/app`, `@capacitor/filesystem` and `@capacitor/screen-orientation` are peer dependencies. The app lists them in its own `package.json`, because `npx cap sync` installs the native half of the plugins the app itself names.

- Updated dependencies [[`f95a89a`](https://github.com/marco-lepore/yage/commit/f95a89adf82ca7d1785d101b615654996707d93d), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07)]:
  - @yagejs/save@0.13.0
  - @yagejs/core@0.13.0
