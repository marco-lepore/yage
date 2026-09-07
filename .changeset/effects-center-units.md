---
"@yagejs/effects": minor
---

`bulgePinch` takes its center and radius in the effect host's local pixels.

The center was passed to the underlying filter unchanged, where it is
normalized against the rasterized filter region — the region moves with the
content, the camera and the letterbox bars, so no value a game computes from
its virtual size lands on the intended point. The preset now converts a
host-local point through the target's world transform every frame, the way
`zoomBlur`, `implosion` and `shockwave` already do, and scales `radius` by the
target's world scale.

Callers convert: a center of `{ x: 0.5, y: 0.5 }` on a 1280x720 host becomes
`{ x: 640, y: 360 }`, and `setCenter` takes the same coordinates. `center` is
now optional — omit it, or call the new `useHostCenter()`, to sit in the
middle of the filtered region. A radius keeps its number but is measured in
host pixels, so it no longer grows relative to the content on a smaller
window.

`bulgePinch` also rejects non-finite and out-of-range numbers at the call that
supplies them — options, `setIntensity` and every setter — naming the input
and the constraint.

`shockwave` takes a `direction`. The ring only ever expanded: `trigger()` set
the filter's clock to zero and counted up, and no caller-side value turned it
around. `direction: "in"` runs the same clock from `duration` down to zero, so
the ring starts `speed × duration` host-local pixels from the trigger point and
contracts onto it — a vortex or a charge-up, rather than a blast. With a
configured `radius` the inward ring stays hidden until it reaches that radius.
The default is `"out"`, so existing calls are unchanged. An unrecognised
direction throws when the effect is added to a host, naming the option and
the two accepted values.
