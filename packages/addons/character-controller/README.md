# @yagejs-addons/character-controller

Character movement for YAGE. The platformer controller provides running,
coyote time, buffered jumps, short hops, air jumps, dashes, wall jumps,
crouching, slides, slopes, small steps, and moving-platform support.

```ts
import { Entity, Transform } from "@yagejs/core";
import { createPlatformer } from "@yagejs-addons/character-controller/platformer";

class Player extends Entity {
  setup(): void {
    this.add(new Transform());
    createPlatformer(this, { tuning: { runSpeed: 220 } });
  }
}
```

Install `PhysicsPlugin` and `InputPlugin({ actions: platformerControls() })`
before spawning the player. Import `platformerControls` from
`@yagejs-addons/character-controller/input`. Add your own sprite or animation
on a visual child; the character's origin is at its feet.

Pass `input: null` to drive the returned `input` handle from AI or scripts.
Use `installPlatformer` to assemble the individual components around your own
physics body and movement producers.

Use `admissionPolicies.canStartMove` for stamina checks or move unlocks and
`admissionPolicies.landingCharges` to choose how landing restores air moves.
Read `admission.airCharges`, set selected counts with `setAirCharges`, or
restore tuned counts with `refillAirCharges()` for pickups and scripted effects.

- Root: engine-independent motion requests, arbitration, and request lifetimes.
- `/platformer`: dynamic physics controller, standard moves, probes, stance,
  moving surfaces, crush events, and assembly helpers.
- `/input`: keyboard, gamepad, mouse, and touch bindings and an action-map preset.

The platformer needs `@yagejs/core` and `@yagejs/physics`. Device control also
needs `@yagejs/input`. No entry imports a renderer. Controller types have their
own subpaths; platformer assumptions stay inside `/platformer`.

See the [usage guide](https://yage.dev/addons/character-controller/) or the
[LLM reference](docs/llms/character-controller.md) for defaults, customization,
component ordering, events, and terrain limitations.
