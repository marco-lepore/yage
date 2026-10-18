---
"create-yage": patch
---

Package YAGE games with Electron Forge and Capacitor.

- Both templates set the engine up in `src/boot.ts`, which exports a `boot(options)` every target's entry calls, and `src/main.web.ts` is the browser entry. A desktop or mobile entry passes its host adapter in `hostPlugins`, so each build carries only the host it runs on.
- `vite build --mode electron` and `--mode capacitor` swap the page's entry module and write `dist-electron/` and `dist-capacitor/`; any other mode builds the browser page into `dist/`. The Recommended template registers its service worker for the browser build alone, because an app ships its own files.
- The features `electron` and `capacitor` add the host adapter, the vendor build tools and the Capacitor plugins the app itself has to list, and print the `npx yage-pack init` step.
