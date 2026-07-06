# @yagejs-addons/abilities

Timeline abilities and a concrete hit contract for [YAGE](https://yage.dev).

**Status: in development — no published release yet.**

## Scope

The addon covers two halves that games use together:

- **Ability runtime** — activatable actions driven by data timelines:
  cooldowns, timed hit windows, cancel rules. An ability is any timed
  activatable action, not just an attack: a melee swing, a dash, a parry, a
  heal, a fire spell that lights a torch.
- **Hit contract** — the concrete pieces a hit needs end to end: hitbox
  spawning and shapes, projectiles, touch damage, a `Health` component, and
  hit reactions (knockback, hit-stun).

The hit contract also works outside combat: breakable crates, hazards,
bumpers — anything that receives a hit.

## Out of scope

The name overlaps with Unreal's Gameplay Ability System; the scope does not.
This addon excludes:

- **Generic attribute/stat systems** — health ships as one concrete
  component, not an attribute framework.
- **Buff/debuff/modifier engines.**
- **Tag-based rule graphs** — gating and costs go through plain policy
  functions instead.
- **Resource systems** (mana, stamina) — these stay game-side and reach the
  addon through its policy hooks.
- **AI** — deciding *when* to activate an ability belongs to the game; the
  addon's job ends at activation.

## Peer dependencies

`@yagejs/core` and `@yagejs/physics` are required. `@yagejs/renderer` is
optional — only presentation code needs it.
