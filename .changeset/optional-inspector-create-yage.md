---
"create-yage": patch
---

The `minimal` template installs `InspectorPlugin` under `npm run dev`, so `window.__yage__.inspector` stays available in the browser console now that the engine no longer creates an Inspector by itself. A production build does not install it. The template adds `src/vite-env.d.ts` for the `import.meta.env` types.
