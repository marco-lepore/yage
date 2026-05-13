---
"create-yage": minor
---

Scaffolder DX polish — `--features` flag and stricter defaults.

- New `--features <list>` CLI flag (e.g. `--features ui,save,effects`) layers optional `@yagejs/*` deps onto the chosen template. `ui` also adds React (`react`, `react-dom`, `@yagejs/ui-react`, `@types/react`) and turns on `jsx: react-jsx` in `tsconfig.json`.
- `templates/recommended/vite.config.ts` now ships `build.rollupOptions.output.keepNames: true` by default so dropping in `@yagejs/save` later Just Works without an extra config tweak.
- Both `templates/recommended/tsconfig.json` and `templates/minimal/tsconfig.json` now set `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` to match the engine's own strictness, so scaffolded projects get the same guarantees from day one.
