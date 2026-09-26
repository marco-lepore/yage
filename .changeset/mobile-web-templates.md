---
"create-yage": minor
---

Both templates now fit the game to the visible screen on phones. `index.html` adds `viewport-fit=cover`, sizes `#game` with `100dvh` after a `100vh` fallback, and pads it with `env(safe-area-inset-*)`, so the browser toolbars, the notch, the rounded corners, and the home indicator no longer cover the game.

The `recommended` template adds a Fullscreen button in the top-right corner, set up in `src/fullscreen.ts`. It toggles fullscreen through `RendererPlugin`, updates its label on `screen:fullscreen`, and stays hidden where the browser cannot show the page fullscreen, such as on iPhone. For the installed app, the manifest now sets `display: "standalone"` with `display_override: ["fullscreen"]`: iOS does not support `"fullscreen"` and opens the game standalone, and Android still opens it fullscreen. `index.html` adds `apple-mobile-web-app-status-bar-style: black-translucent`, so on iOS the installed game draws under the status bar and the safe-area padding keeps it clear.
