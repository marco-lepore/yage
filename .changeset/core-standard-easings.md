---
"@yagejs/core": patch
---

Publish the full standard easing table. Alongside `easeLinear`, `@yagejs/core`
now exports ten families — sine, quad, cubic, quart, quint, expo, circ, back,
elastic and bounce — each in ease-in, ease-out and ease-in-out form, so a game
no longer transcribes the curves by hand. Every function takes `t` in `[0,1]`
and returns `0` at `t = 0` and `1` at `t = 1`; the `back` and `elastic`
families deliberately leave `[0,1]` in between, so pair them with a target that
tolerates the overshoot.
