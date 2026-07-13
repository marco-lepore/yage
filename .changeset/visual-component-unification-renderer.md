---
"@yagejs/renderer": minor
---

Unify the five visual components' options, delete the raw-texture escape
hatches, and stop leaking raw `pixi.js` types from public signatures.

- `SpriteComponent`, `AnimatedSpriteComponent`, `GraphicsComponent`,
  `TextComponent`, and `SplitTextComponent` all accept the same
  `visible?`, `tint?: ColorValue`, `alpha?: number`, and
  `interactive?: { eventMode?, consumeOnInteraction? }` options, with
  matching `visible`/`tint`/`alpha` runtime accessors — `GraphicsComponent`
  previously had none of these, and `SplitTextComponent` previously had no
  effects/mask support (`fx`, `setMask`, `clearMask`) at all; both now
  match the other three.
- **Breaking:** `AnimatedSpriteComponentOptions.textures` and
  `AnimationDef.frames` are removed — `source` (a `FrameSource`) is now
  required on both `AnimatedSpriteComponent` and `AnimationController`, so
  every controller/sprite is always fully serializable (no more
  `serialize(): null` + warn path for raw frames). The AnimatedSprite
  tuple anchor form (`[x, y]`) is also removed — use `{ x, y }`.
- **Breaking:** `RendererConfig.pixi` is now `Partial<ApplicationOptions>`
  instead of `Record<string, unknown>` — a misspelled Pixi Application
  option now fails typecheck instead of being silently dropped.
- **Breaking:** no exported field, parameter, or return type in
  `@yagejs/renderer` uses a raw `pixi.js` type anymore — every one goes
  through this package's own alias layer (`DisplayContainer`,
  `DisplaySprite`, `DisplayAnimatedSprite`, `DisplaySplitText`,
  `DisplaySplitBitmapText`, `GraphicsContext`, `NineSliceSprite`, `Filter`,
  `ParticleContainer`, `Application`, `ApplicationOptions`, ...). The
  aliases are transparent type equalities, so this is type-only — no
  runtime behavior changes, and every escape hatch (`.sprite`, `.graphics`,
  `RendererPlugin.application`, ...) still returns the real Pixi object.
