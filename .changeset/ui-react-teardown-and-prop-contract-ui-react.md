---
"@yagejs/ui-react": minor
---

Fixes three long-standing reconciler bugs and derives JSX prop types from `@yagejs/ui` instead of hand-copying them.

- Unmounting a React-managed UI element (a `{open && <Panel/>}` toggle, a list item diffed away, or the whole `<UIRoot>` tree torn down) now destroys it, freeing its Yoga node and Pixi resources. Previously only the imperative `@yagejs/ui` API did this — every React unmount leaked.
- `commitUpdate` now diffs old vs. new props and forwards removed keys as explicit `undefined`, so `bg={selected ? hl : undefined}` and conditional prop spreads (`{...(open ? { onClick } : {})}`) reset the prop instead of leaving the old value.
- `useQuery` releases its `QueryCache` registration on unmount (see the `@yagejs/core` changeset in this release) instead of leaking one live query per mount.
- JSX prop interfaces (`PanelProps`, `ButtonProps`, `TextProps`, `CheckboxProps`, `ScrollViewReactProps`, the `Pixi*ReactProps` types, and the rest) now extend their `@yagejs/ui` imperative counterparts instead of hand-copied fields, fixing drift where `consumeInput` compiled on the imperative API but not in JSX (`Checkbox`, `ScrollView`, the Pixi* wrappers). The dead `PanelProps.anchor` field is removed.
- `bg` is now a documented JSX-only shorthand for `background` on `Panel`, `Button`, and `ScrollView`, expanded through a shared alias table. Passing both `bg` and `background` on the same element resolves to `background` and dev-warns once per element type. `PixiProgressBar`/`PixiSlider`/`PixiInput`'s own `bg` (a required `@pixi/ui` view-slot prop) is untouched.
- A bare text/number JSX child (`<Panel>Score: {score}</Panel>`) now dev-warns once, since this reconciler has no host text node and previously dropped the content silently.
