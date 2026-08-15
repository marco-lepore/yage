---
"@yagejs/debug": patch
---

Add `drawVector` — a per-entity arrow for a vector read fresh every frame

`DebugRegistry.drawVector(entity, () => vector, options?)` draws an arrow on an
entity for a velocity, aim direction, knockback, or steering output, replacing
the hand-rolled `GraphicsComponent` that clears and redraws a line every update.
Options cover `scale`, `color`, `alpha`, `origin`, `minLength`, `width` and
`headSize`; shaft width and head size divide by the camera zoom so they keep a
constant on-screen size, while the arrow's length stays in world pixels.

The call returns a disposer, and a registration is dropped when the entity's
life ends — destroyed, or a pool member whose lease ended — so a provider
closure never outlives the entity it draws for and a per-lease registration
never accumulates. The provider is read only while the overlay is on and the
new `vectors` contributor's `arrows` flag is enabled, so a `drawVector` call in
a hot path costs nothing with debug off. Resolve the registry with
`tryResolve` rather than `use` in code that has to run without `DebugPlugin`
installed.

A hand-written `DebugRegistry` stub, such as one standing in for the registry in
a plugin's tests, needs a `drawVector` entry to satisfy the interface.
