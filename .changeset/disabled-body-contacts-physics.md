---
"@yagejs/physics": patch
---

A body switched off while it touches something no longer stops another body in mid-air. `@yagejs/physics` now depends on `@dimforge/rapier2d` 0.20.

- Fixed: destroying an entity whose body touched a wall or the ground no longer freezes another moving body. `destroy()` switches the body off at once and removes it at the end of the frame. Rapier 0.19 kept the switched-off body's contacts until then and applied them to another awake body, usually the newest one, whenever a physics step ran in between: the zero-duration step a spatial query runs, or the second fixed step of a slow frame. That body lost its speed toward the contact, so in the shooter example a bullet stopped in mid-air when the bullet before it hit a wall.
- Fixed: a pooled or deactivated entity (`setActive(false)`), or a disabled `RigidBodyComponent`, no longer does the same at every step while it is dormant. Earlier releases were affected too.
- Fixed: a collider switched off while its body is awake, with `collider.enabled = false` or a zero `Transform` scale, stops colliding. It kept blocking other bodies. A moving kinematic platform deactivated under a rider now drops the rider.
- Changed: a fast body is swept against static colliders at every step, so it stops at a thin wall or floor without `ccd: true`, and a body landing at speed stops at the surface instead of sinking into it for a few frames. `ccd: true` extends the sweep to kinematic and dynamic bodies.
- Changed: a resting body falls asleep after 0.5 s instead of 2 s.
- Changed: speed is capped at 400 m/s (`400 × pixelsPerMeter` px/s, 20,000 at the default 50) and rotation at 45° per physics step, about 47 rad/s at 60 steps per second.
- Changed: a plain box driven across `polyline` terrain catches on the junctions between segments more often. A box with `borderRadius` still crosses cleanly.
- Changed: the `contacts` list in the Inspector's physics snapshot no longer includes pairs of two static colliders, which never collide.
