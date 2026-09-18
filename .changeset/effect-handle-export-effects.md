---
"@yagejs/effects": patch
---

The barrel exports the `EffectHandle` type.

Every preset returns a handle that extends it, so a field or a list holding handles from several presets has a name to declare:

```ts
import type { EffectHandle } from "@yagejs/effects";

const active: EffectHandle[] = [outline(...), bloom(...)].map((fx) =>
  sprite.fx.addEffect(fx),
);
```

The 24 per-preset handle types stay exported from the same barrel and narrow it.
