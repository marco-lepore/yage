---
"@yagejs/renderer": patch
---

`CameraShakeOptions.decay` is documented against the curve it actually produces.

- `decay` scales how far the shake fades across its duration, measured against elapsed progress rather than per frame. `0` (the default) holds full intensity until the shake ends, `1` fades linearly to zero over the duration, and values above `1` reach zero earlier — at `2` the camera stops moving halfway through.
- The reference entry described a `0..1` factor applied per frame in which `1` stopped the shake instantly. That matched neither the range nor the curve, so anything written against it is worth rechecking: `decay: 1` is a fade over the full duration, not an immediate stop.
