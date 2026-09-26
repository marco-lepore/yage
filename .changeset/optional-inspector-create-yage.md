---
"create-yage": patch
---

The `minimal` template installs `InspectorPlugin`, so `window.__yage__.inspector` stays available in the browser console now that the engine no longer creates an Inspector by itself.
