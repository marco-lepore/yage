---
"@yagejs/host-capacitor": patch
---

Run YAGE games in Capacitor apps with a host adapter.

- New package. `CapacitorHostPlugin` is a `Plugin` named `host` that reports the app's identity, activity and visibility to `engine.host`, registers a `HostDisplay` whose orientation lock goes through the app, and delivers the Android Back button as the key `"BrowserBack"`. With no action bound to that key, a press moves the app to the background.
- Activity and visibility are mapped per system from the App plugin's `appStateChange`, `pause` and `resume` events. Focus comes from the page.
- The orientation lock resolves once the screen reads as the lock asked, or after 2000 ms when the system turns nothing. Fullscreen is reported unsupported in an Android web view, which leaves element fullscreen in the call that enters it; on iOS it stays with the page.
- `capacitorSaveAdapter({ profile })` is a `SaveAdapter` that writes saves as files in the app's private Library directory, one directory per build profile. A write that resolved is held when the app is killed; neither system's write reaches the storage hardware, so a power loss is not guaranteed.
- `isCapacitorHost()` from `@yagejs/host-capacitor/detect` says whether the page runs inside a Capacitor app. The entry imports nothing else, so a browser build can ask before it loads the rest.
- `@capacitor/core`, `@capacitor/app`, `@capacitor/filesystem` and `@capacitor/screen-orientation` are peer dependencies. The app lists them in its own `package.json`, because `npx cap sync` installs the native half of the plugins the app itself names.
