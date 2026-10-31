# @yagejs-addons/placement

Let players place furniture, attach modular pieces, customize areas and save
layouts. The headless model validates footprints, clearance, surfaces, sockets
and permissions before publishing an edit. Moving or duplicating a parent
includes its attached objects. Failed edits and cancelled previews preserve the
committed layout.

Use your existing YAGE level catalog for entity types and parameter schemas.
The package provides a model, an input-independent session, an entity controller,
default or replaceable controls, and optional canvas views. Rules decide whether an edit is allowed;
commit events let the game spend materials or apply other consequences.

- [Guide and complete setup](https://yage.dev/addons/placement/)
- [Top-down Room Planner](https://examples.yage.dev/placement.html)
- [Side-view Workshop](https://examples.yage.dev/placement-side.html)
- [Isometric Room](https://examples.yage.dev/placement-iso.html)
- [Agent API reference](docs/llms/placement.md)

Install `@yagejs-addons/placement`, `@yagejs/core`, `@yagejs/level` and
`@yagejs/input`. Add `@yagejs/renderer` for `/presenters`. Root imports remain
headless. The controller accepts default controls, a custom binding, or
`input: null` for host control.

The package has no physics simulation. Areas are axis-aligned rectangles;
footprints are unions of rectangles with arbitrary rotation. Games own save
roots, inventory, upgrade progression and live entity presentation.
