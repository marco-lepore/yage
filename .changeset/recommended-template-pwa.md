---
"create-yage": minor
---

The `recommended` template's production build is now an installable Progressive Web App that runs offline after the first visit. `vite.config.ts` adds `vite-plugin-pwa`, which caches every file in the build, so assets added to `public/` need no registration. The template ships placeholder icons in `public/` and a `manifest` block to rename before shipping. A deploy reaches players the next time they launch the game. The dev server does not register a service worker.
