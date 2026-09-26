---
"@yagejs-addons/inventory": patch
"@yagejs-addons/virtual-controls": patch
"@yagejs/lighting": patch
---

The README quick starts put consequences in components instead of `onEnter` closures. The inventory quick start keeps the `Inventory` in a `Backpack` component on a `Player` entity subclass rather than at module level; virtual controls use a `TouchControls` entity subclass and a component that listens for button presses; the lighting README's `Torch` is an entity subclass, and its `RendererPlugin` sample passes the required config.
