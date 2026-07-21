# @yagejs-addons/abilities

Phase-based abilities and a concrete hit contract for [YAGE](https://yage.dev).

## Install

```bash
npm install @yagejs-addons/abilities @yagejs/core @yagejs/physics
# Add only when using the optional input entry:
npm install @yagejs/input
```

Register `PhysicsPlugin` before using hitboxes, projectiles, touch damage, or
the default knockback reaction. The addon has no plugin of its own.

## Scope

The addon covers two halves that games use together:

- **Ability runtime** — activatable actions authored as small state machines
  of timed **phases**: cooldowns, timed hit windows, combo stages, holds,
  cancel rules. An ability is any timed activatable action, not just an
  attack: a melee swing, a dash, a parry, a heal, a fire spell that lights a
  torch.
- **Hit contract** — the concrete pieces a hit needs end to end: hitbox
  spawning and shapes, projectiles, touch damage, a `Health` component, and
  hit reactions (knockback, hit-stun).

The hit contract also works outside combat: breakable crates, hazards,
bumpers — anything that receives a hit.

## Quick start

```ts
import { Entity, ProcessComponent, Transform, trait } from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import {
  Abilities,
  Facing,
  Health,
  Hittable,
  HitReceiver,
  Stagger,
  hitbox,
} from "@yagejs-addons/abilities";
import type { AbilityDef, Hit, HitResult } from "@yagejs-addons/abilities";

const SLASH: AbilityDef = {
  id: "slash",
  cooldown: 0.45,
  duration: 0.35,
  timeline: [
    hitbox({
      from: 0.08,
      to: 0.2,
      shape: { type: "capsule", halfHeight: 18, radius: 10, axis: "x" },
      offset: { x: 30, y: 0 },
      hit: { damage: 18, knockback: 260, stun: 0.3 },
    }),
  ],
};

@trait(Hittable)
class Fighter extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  setup(): void {
    this.add(new Transform());
    this.add(new ProcessComponent());
    this.add(new RigidBodyComponent({ type: "dynamic" }));
    this.add(new ColliderComponent({ shape: { type: "circle", radius: 12 } }));
    this.add(new Facing()); // default +x aim when a delivery step omits `aim`
    this.add(new Health({ max: 100 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "player", iframes: 0.15 }));
    this.add(new Abilities([SLASH]));
  }
}

const fighter = scene.spawn(Fighter);
fighter.get(Abilities).send("slash");
```

## The runtime in short

A def is either a plain timeline (one phase, no extra syntax) or a named
phase graph. Phases carry the timeline steps; transitions are declared per
phase in an `on:` map keyed by **intent** strings, with optional time-window
guards. The caster surface is five verbs:

```ts
abilities.send("attack"); // the one way in — for players AND AI
abilities.canSend("attack"); // dry-run: admitted without preempting?
abilities.release("charge"); // completes a hold; true when it did
abilities.cancel(); // stop the lane's run
abilities.force(STAGGER); // reactions only — see below
```

A simple ability looks exactly like a timeline:

```ts
const DASH: AbilityDef = {
  id: "dash",
  cooldown: 1.1,
  timeline: [invulnerable({ from: 0.03, to: 0.24 }) /* … */],
};
abilities.send("dash");
```

A combo is one def with stage phases — `send("attack")` enters when idle and
advances inside each stage's guard window; a window reaching past the stage's
end keeps working for that excess time after the run completes (linger):

```ts
const ATTACK: AbilityDef = {
  id: "attack",
  cooldown: 0.3,
  phases: {
    jab: {
      timeline: [
        /* … */
      ],
      duration: 0.45,
      on: { attack: { to: "cross", from: 0.25, until: 0.6 } },
    },
    cross: {
      timeline: [
        /* … */
      ],
      duration: 0.5,
      on: { attack: { to: "hook", from: 0.25, until: 0.6 } },
    },
    hook: {
      timeline: [
        /* … */
      ],
      duration: 1.1,
    },
  },
};
```

A charge is one def too — a `hold` phase completes on `release()` and flows
into the payoff through `next`. Per-phase `priority` scopes armor to the
phase that earns it:

```ts
const CHARGE: AbilityDef = {
  id: "charge",
  cooldown: 0.2,
  phases: {
    charge: {
      hold: { max: 3 },
      next: "kick",
      timeline: [anim({ at: 0, name: "charge" })],
    },
    kick: {
      priority: 110, // super armor for the payoff only
      timeline: [
        hitbox({
          from: 0.1,
          to: 0.25,
          shape: { type: "capsule", halfHeight: 18, radius: 10, axis: "x" },
          hit: { damage: 24, knockback: 320, stun: 0.35 },
        }),
      ],
    },
  },
};
abilities.send("charge"); // key down (past the game's hold threshold)
abilities.release("charge"); // key up → kick
```

Rules worth knowing:

- **Declared intents never fall through.** If the active phase declares the
  intent but its guard window doesn't cover the current time, `send` refuses
  with `"noMatch"` — a mistimed combo press doesn't restart the combo. An
  undeclared intent falls through to cross-def entry (`"busy"`,
  `"cooldown"`, or admission through a cancel window / higher priority).
- **`canSend` is politer than `send`, on purpose.** A busy lane admits a
  `send` through a strictly higher entry priority (the interrupt — the
  occupant is cancelled), and `canSend` deliberately answers false for that
  door: it exists to gate buffered/retried presses, which must wait for the
  occupant instead of preempting it. So `canSend` false does not always mean
  `send` would fail. For the full dry-run — "would a direct `send` succeed,
  preemption included" — pass
  `canSend(intent, { lane, interrupts: true })`.
- **Phase transitions are not ends.** One `AbilityStarted`/`AbilityEnded`
  pair per run; transitions emit `AbilityPhaseChanged`. Window steps close with
  `cancelled: false` on transitions and natural ends, `true` on
  cancel/interrupt.
- **Cooldown is checked and armed at cross-def entry only.** Transitions and
  linger continuations neither check nor re-arm it.
- **`force(def)` is for reactions** — stagger, knockdown, scripted
  interrupts the game imposes on an entity. It bypasses cooldown and can
  restart its own def in place. Input-driven actions go through `send`; a
  gesture is never a `force`.
- **The default hit reaction requires positive `stun`.** With a sibling
  `Abilities`, the receiver forces `staggerReaction`; without a runner, it
  falls back to a sibling `Stagger`. Knockback alone does not start a
  reaction.
- **Definition tags match cancel windows only.** Put `tags` on a definition
  and use `{ tag: "movement" }` in `cancels[].into`. The addon does not treat
  tags as state, resources, or a general rule graph.
- Windows end at `to: number | "end"` — `"end"` is the phase's boundary,
  elastic in a hold phase (a guard's `block({ from: 0, to: "end" })`).

## Replacing definitions

To install optional definitions without touching current state, use
`addDefinitions(defs)`. It validates the whole prospective set first, then
preserves active runs, cooldowns, linger, and existing definitions.

For an out-of-combat weapon or skill-loadout swap, replace the runner's whole
definition set without replacing the `Abilities` component:

```ts
abilities.replaceDefinitions(next.defs);
driverComponent.replace(next.input);
```

`replaceDefinitions()` recompiles and validates the complete prospective set
before changing live state. A validation error leaves the current runner
untouched. A successful replacement cancels active runs, clears linger and
cooldown state, and installs the new intent vocabulary before delivering the
resulting `AbilityEnded` events. Every new definition starts ready.

The game owns the loadout object and replaces its `AbilityDriver` separately.
Driver replacement discards recorded edges, buffered sends, and held-input
ownership. An action held across the swap must be released and pressed again.
Use namespaced definition ids and loadout-specific entry intents when several
loadouts may contain similarly named moves.

## Input composition

Use `AbilityDriverComponent` from the optional `/input` entry for a mounted
entity. It resolves `InputManagerKey`, updates its plain driver, and disposes
listeners and buffers with the component:

```ts
import { AbilityDriverComponent } from "@yagejs-addons/abilities/input";

this.add(
  new AbilityDriverComponent({
    defaults: { holdAt: 0.5 },
    bindings: {
      attack: {
        tap: { send: "attack", buffer: 0.5 },
        hold: { send: "charge", fromNeutral: true },
      },
      dash: { press: { send: "dash", buffer: 0.3 } },
    },
  }),
);
```

Use the plain `AbilityDriver(input, abilities, options)` when another object
owns lifecycle. Call its `update()` once from normal update, not
`fixedUpdate()`, and call `dispose()` when that owner is removed. Both forms
own edge capture, gesture classification, raw-time buffers, admission retries,
payload capture, hold release, and interrupted-hold resumption.

### Press, tap, and hold

- `press` sends when the action goes down.
- `tap` sends on release within `within`. It can use
  `defaults.tapWithin`, or the paired hold threshold when neither is set.
- `hold` sends once at `at`. It can use `defaults.holdAt`. A triggered hold
  suppresses the tap from the same press.
- Per-interaction thresholds override driver defaults.
- A binding uses the `"main"` lane unless it declares another `lane`.
- A successful `press` or `hold` send is paired with key-up. For a hold,
  omitting `hold.release` calls `abilities.release(hold.send)` automatically.

A charge that flows directly to its next phase needs no release config:

```ts
const CHARGE: AbilityDef = {
  id: "charge",
  phases: {
    charge: { hold: true, next: "kick", timeline: [] },
    kick: { timeline: [] },
  },
};

const bindings = {
  attack: { hold: { send: "charge", at: 0.5 } },
};
```

Use nested `hold.release` when release is a real intent. The active hold phase
can handle it through `on:`; an `entry:` door can deliver it after an
interruption:

```ts
const CHARGE: AbilityDef = {
  id: "charge",
  entry: { "attack-release": "kick" },
  phases: {
    charge: {
      hold: true,
      on: { "attack-release": "kick" },
      timeline: [],
    },
    kick: { timeline: [] },
  },
};

const bindings = {
  attack: {
    hold: {
      at: 0.5,
      send: "charge",
      resume: true,
      release: { send: "attack-release", buffer: 1.5 },
    },
  },
};
```

`resume: true` politely re-sends a cancelled hold while the action remains
pressed. It does not restart a hold that completed naturally or reached its
maximum duration.

### Buffers, data, and hooks

Every send interaction accepts the same optional `buffer`. The window starts at
that interaction's raw input edge: press-down, tap release, hold threshold, or
explicit release. Buffered sends retry through `canSend` without using priority
to interrupt an occupant.

`data` can be a fixed value or an edge-time resolver. The resolver receives the
action, gesture, lane, raw `heldFor`, and the activation owned by the press. The
captured result becomes `activation.payload`, even when a buffered send fires
later.

Gesture thresholds, buffers, and `heldFor` use raw input time. Ability phases
still use scaled scene time. A release resolver can compare `heldFor` with
`activation?.elapsedIn("charge")` when a mechanic needs both; the controller
does not scale either clock.

Use a binding's `gate(context)` for game-side admission such as stamina. Use
the driver's `beforeFire(context)` to sample boundary state immediately before
an admitted send. Neither hook needs to manage retries or release sequencing.

### Raw composition

Games that do not want the input adapter can call the runner directly. This is
also the path for AI:

```ts
if (abilities.canSend("attack") && input.consumeBufferedPress("attack", 0.12)) {
  abilities.send("attack");
}
```

Do not handle the same action through both a driver binding and raw input code.
Both consumers would receive the edge.

## Save boundary

`Health` is serializable and restores `{ hp, max }` without emitting health
events. Every other addon value is transient: cooldowns, active phases and
lanes, payloads, linger, forced reactions, input-driver state, receiver
i-frames, guards, invulnerability, stagger, facing, and time requests are not
resumed from a snapshot. Rebuild the definitions and input driver when loading
into a safe gameplay state.

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
- **AI** — deciding _when_ to activate an ability belongs to the game; the
  addon's job ends at `send`.

## Peer dependencies

`@yagejs/core` and `@yagejs/physics` are required. `@yagejs/input` is optional
and used only by the `/input` entry. The package has no renderer, Pixi, or
presenter dependency.
