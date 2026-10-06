---
"@yagejs-addons/character-controller": minor
---

Add configurable character controllers with a complete dynamic platformer setup.

- Provide running, buffered and variable-height jumps, air jumps, dashes, wall jumps, crouching, and slides with default tuning and replaceable input.
- Customize move eligibility and landing charge restoration with pure policies, and read, set, or refill air-move charges for pickups and other game effects.
- Clear buffered move presses on input reset, and respect contact filters and one-way drop-through when finding ground.
- Apply character collision groups, retain clearance across repeated steps and ramp crests, and exclude the character from its own ledge clearance queries.
- Expose shared motion arbitration, terrain assistance, contact and ledge probes, moving platforms, and crush events for custom movement and game effects.
- Separate the engine-independent motion model, platformer components, and input adapters into package entries so other controller types can share motion rules.
