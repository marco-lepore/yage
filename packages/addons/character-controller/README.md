# @yagejs-addons/character-controller

Character movement for YAGE. The platformer controller provides running,
coyote time, buffered jumps, short hops, air jumps, dashes, wall jumps,
crouching, slides, dropping through one-way platforms, slopes, small steps,
and moving-platform support.

```ts
import { Entity, Transform } from "@yagejs/core";
import { createPlatformer } from "@yagejs-addons/character-controller";

class Player extends Entity {
  setup(): void {
    this.add(new Transform());
    createPlatformer(this, { tuning: { runSpeed: 220 } });
  }
}
```

Install `PhysicsPlugin` and `InputPlugin({ actions: platformerControls() })`
before spawning the player. The character's origin is at its feet. Draw it
with a sprite or graphics on the same entity or on a child.

Pass `input: null` to drive the returned `input` component from AI or
scripts. Add your own `RigidBodyComponent` and box `ColliderComponent` before
`createPlatformer` to use your own body. Every component is also
constructible on its own, and each declares its update order.

Use `admissionPolicies.canStartMove` for stamina checks or move unlocks and
`admissionPolicies.landingCharges` to choose how landing restores air moves.
Read `admission.airCharges`, set selected counts with `setAirCharges`, or
restore tuned counts with `refillAirCharges()` for pickups and scripted
effects. Submit your own motion requests to `MotionReconciler` for glides,
knockback, or a ledge climb built on `LedgeProbe`.

Install `@yagejs/core`, `@yagejs/physics`, and `@yagejs/input` beside the
addon. A character created with `input: null` needs no `InputPlugin`. The
addon imports no renderer.

See the [usage guide](https://yage.dev/addons/character-controller/) or the
[LLM reference](docs/llms/character-controller.md) for defaults,
customization, update order, events, and terrain limits.
