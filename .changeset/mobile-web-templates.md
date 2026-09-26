---
"create-yage": minor
---

Both templates now fit the game to the visible screen on phones. `index.html` adds `viewport-fit=cover`, sizes `#game` with `100dvh` after a `100vh` fallback, and pads it with `env(safe-area-inset-*)`, so the browser toolbars, the notch, the rounded corners, and the home indicator no longer cover the game.

The `recommended` template adds a Fullscreen button in the top-right corner, set up in `src/fullscreen.ts`. It toggles fullscreen through `RendererPlugin`, updates its label on `screen:fullscreen`, and stays hidden where it would do nothing: on iPhone, in an iframe that does not allow fullscreen, and in an installed app that already opens fullscreen. For the installed app, the manifest now sets `display: "standalone"` with `display_override: ["fullscreen"]`. iOS does not support `"fullscreen"` and opens the game standalone. Chrome, Edge, and Samsung Internet on Android still open it fullscreen. Firefox for Android does not read `display_override`, so it now opens the game standalone, with the status and navigation bars. `index.html` adds `apple-mobile-web-app-status-bar-style: black-translucent`, so on iOS the installed game draws under the status bar and the safe-area padding keeps it clear.
