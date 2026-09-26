---
"@yagejs/ui-react": patch
---

Declare React 19 as the supported peer. The bundled `react-reconciler` requires React 19, so the advertised React 18 range never worked.
