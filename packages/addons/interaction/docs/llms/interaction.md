# @yagejs-addons/interaction

Proximity-based interaction ("walk up, see a prompt, press E") for YAGE
(`@yagejs-addons` scope, independently versioned, NOT in the engine `fixed`
group). Pure `@yagejs/core` — headless, single entry, no presenters.

## Install

```bash
npm install @yagejs-addons/interaction
# engine peers (single install, reused — not bundled):
npm install @yagejs/core @yagejs/input
```

`@yagejs/core` is a required peer; `@yagejs/input` is an **optional** peer —
present, `Interactor` handles the interact key automatically; absent, drive
`interactor.interact()` yourself. No runtime deps, no pixi, no `@yagejs/physics`.

## Single entry (no `./presenters`)

Everything is headless: `Interactable`, `Interactor`, the three event tokens,
the scene query `interactablesIn`, and the pure `selectInteractionFocus` /
`rankInteractables` functions. The game renders the prompt; there is no bundled
presenter to opt into.

```ts
import {
  Interactable,
  Interactor,
  InteractionFocusChangedEvent,
  InteractionInRangeChangedEvent,
  InteractionPerformedEvent,
  interactablesIn,
  rankInteractables,
  selectInteractionFocus,
} from "@yagejs-addons/interaction";
```

## Which API for what

Three scopes. Start at the top row — most games never leave it.

| Use case                       | Pull                                                                    | Push                             | Interact                                    |
| ------------------------------ | ----------------------------------------------------------------------- | -------------------------------- | ------------------------------------------- |
| Prompt + press E (the default) | `interactor.focus`                                                      | `InteractionFocusChangedEvent`   | `interactor.interact()`                     |
| Multi-target selection UI      | `interactor.inRange`                                                    | `InteractionInRangeChangedEvent` | `interactor.interact(chosen)`               |
| Scene-wide / custom query      | `interactablesIn(scene)`, `rankInteractables`, `selectInteractionFocus` | none — query on demand           | `interactable.interact()` (scripted bypass) |

`focus` is `inRange[0]` — the same snapshot, not a second source of truth. A
selection UI must listen to `InteractionInRangeChangedEvent`, not the focus
event: a _non-focused_ target entering or leaving range never changes the focus.

## 5-minute setup

```ts
import {
  Interactable,
  Interactor,
  InteractionFocusChangedEvent,
} from "@yagejs-addons/interaction";
import { Component, Entity, Transform } from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";

// Mark any entity as interactable. Both sides need a Transform.
class Chest extends Entity {
  setup() {
    this.add(new Transform());
    this.add(
      new Interactable({ prompt: "Open", onInteract: () => this.open() }),
    );
  }
  open() {
    // swap the sprite, drop the loot
  }
}

// The player is the detector. Defaults: range 48px, action "interact",
// nearest-in-range focus, self-driven off @yagejs/input if present.
class Player extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new Interactor({ range: 70 }));
  }
}

// Headless addon — the game draws the prompt. Fires only on a focus change,
// on the interactor's entity, and bubbles to the scene. A component on the HUD
// label listens (not a closure in onEnter), and writes through TextComponent.
class PromptLabel extends Component {
  private readonly text = this.sibling(TextComponent);

  onAdd(): void {
    this.listenScene(InteractionFocusChangedEvent, ({ prompt }) => {
      this.text.setText(prompt ?? "");
      this.text.visible = prompt !== null;
    });
  }
}
```

## `InteractableOptions`

```ts
import type { InteractableOptions as BaseInteractableOptions } from "@yagejs-addons/interaction";

interface InteractableOptions extends BaseInteractableOptions {
  onInteract: () => void;
  prompt?: string | (() => string); // undefined = focusable, no label
  radius?: number; // own reach bonus, default 0
  priority?: number; // focus tie-break weight, default 0
  enabled?: boolean | (() => boolean); // default true
}
```

`prompt` and `enabled` accept a live provider, re-resolved every frame — no
extra setup needed for a lever's "Turn on"/"Turn off" or a busy-gated door.

The `enabled` option is the game's own gate; the component's inherited
`enabled` flag and `entity.setActive(false)` are separate and stronger. A
disabled component or a dormant entity leaves the scene registry entirely, so
its interactable is not a candidate for any interactor and `interactablesIn()`
does not return it. Focus tie-break order is claimed once and survives the
round trip.

## `InteractorOptions`

```ts
import type { InteractorOptions as BaseInteractorOptions } from "@yagejs-addons/interaction";

interface InteractorOptions extends BaseInteractorOptions {
  range?: number; // world px, default 48
  action?: string | null; // default "interact"; null = no auto-input
  enabled?: boolean; // default true
}
```

A candidate is in range when `distance(interactor, interactable) <= range +
interactable.radius`. Focus = highest `priority` in-range enabled candidate;
ties break by nearest, then by registration order (deterministic).

`range` and `radius` must be non-negative. The reach test compares squared
distances, which would turn a negative total back into a positive one and match
distant targets; each component dev-warns once on add rather than guarding every
candidate. Use `range: 0` to reach only what the interactor overlaps.

The auto-input press fires on the `interact` action — a common gameplay action
name. Disabling an input group that holds `interact` to freeze the world while a
menu or panel is open also stops the interactor's own press: the proximity
prompt still shows, but pressing the button does nothing. A shared `interact`
press is one global state, so gating on group enablement can't stop the
interactor while other consumers keep it. Give the interactor a different
`action`, or pause it directly (`interactor.enabled = false`, which also clears
the prompt).

## `Interactor` API

Each `update()` builds ONE ranked snapshot from one geometry pass. `inRange` is
that snapshot and `focus` is its first element, so they cannot disagree — even
when a target moves between updates.

- `inRange: readonly Interactable[]` — every in-range, enabled interactable, best
  focus first. Rebuilt each `update()`; empty before the first and while
  disabled. Drive a selection UI or a per-target proximity icon from it.
- `focus: Interactable | null` — `inRange[0] ?? null`. The target `interact()`
  acts on by default.
- `interact(target?): void` — fires an interactable's `onInteract` + emits
  `InteractionPerformedEvent`. Targets `focus` by default; pass one from
  `inRange` to act on a chosen target. No-op unless the interactor is enabled
  AND the target is in the current `inRange` AND still live (host not destroyed,
  component not removed, `enabled` gate still true). To fire a target the
  interactor cannot reach — a scripted or remote trigger — call
  `interactable.interact()` directly; that skips every check here and emits no
  interactor event.
- `enabled: boolean` (inherited from `Component`, default true) — doubles as
  the tracking toggle. `false` empties the snapshot immediately (emitting the
  transitions) and halts tracking, input polling, and `interact()`; `true`
  resumes next frame. Flip it to pause one interactor during a cutscene, or to
  switch tracking between several. `entity.setActive(false)` does the same,
  and reactivating resumes — a pooled or dormant interactor focuses nothing.

```ts
import { Interactor } from "@yagejs-addons/interaction";
import type { Entity } from "@yagejs/core";

// Manual / headless drive — no @yagejs/input, or a test:
function addInteractor(player: Entity) {
  return player.add(new Interactor({ range: 70, action: null }));
}
// each frame, from your own input source:
function onFrame(
  interactor: Interactor,
  input: { isJustPressed(action: string): boolean },
) {
  if (input.isJustPressed("interact")) interactor.interact();
}
```

## Events (on the interactor's entity; bubble entity → scene)

State is assigned before any event emits: a handler reading `focus`/`inRange`
sees the new values, never the old.

- `InteractionFocusChangedEvent` — `{ interactable: Interactable | null,
prompt: string | null }`. Fires ONLY on a transition: the focused
  interactable changes, or its resolved prompt text changes. Leaving all
  ranges emits `{ interactable: null, prompt: null }`.
- `InteractionInRangeChangedEvent` — `{ inRange: readonly Interactable[] }`.
  Fires when the ranked set changes: a target enters or leaves, or two swap
  rank. The hook a selection UI needs — a **non-focused** target entering or
  leaving does not change the focus, so the focus event never reports it.
- `InteractionPerformedEvent` — `{ interactable: Interactable }`. Fires on every
  interaction (auto-input edge, `interact()`, or `interact(target)`).

## Cross-addon composition (no addon→addon dependency)

An interactable's `onInteract` is a plain closure — connect dialogue, inventory,
or anything else from it directly:

```ts
import { Interactable } from "@yagejs-addons/interaction";
import type {
  DialogueController,
  DialogueScript,
} from "@yagejs-addons/dialogue";
import type { Inventory } from "@yagejs-addons/inventory";
import type { Entity } from "@yagejs/core";

function connectAddons(
  npc: Entity,
  coin: Entity,
  dialogue: DialogueController,
  script: DialogueScript,
  inventory: Inventory<"coin">,
) {
  npc.add(
    new Interactable({
      prompt: "Talk",
      onInteract: () => dialogue.play(script),
    }),
  );
  coin.add(
    new Interactable({
      prompt: "Pick up",
      onInteract: () => {
        inventory.add("coin");
        coin.destroy();
      },
    }),
  );
}
```

## Multiple targets, selection UI, and highlighting

`focus` is the single default; `inRange` is the full ranked set behind it — for
overlapping loot the player chooses between, or a per-target proximity icon.
Drive it from `InteractionInRangeChangedEvent`, NOT the focus event: a
lower-ranked target entering or leaving leaves the focus untouched.

```ts
import {
  InteractionInRangeChangedEvent,
  type Interactable,
  type Interactor,
} from "@yagejs-addons/interaction";
import type { Entity } from "@yagejs/core";

interface Wheel {
  show(targets: readonly Interactable[]): void;
  hide(): void;
}

// Overlapping loot: show a wheel when 2+ are in range, interact the chosen one.
function showWheel(player: Entity, wheel: Wheel) {
  player.on(InteractionInRangeChangedEvent, ({ inRange }) => {
    if (inRange.length > 1)
      wheel.show(inRange); // ranked; inRange[0] is the focus
    else wheel.hide();
  });
}
function confirm(interactor: Interactor, chosen: Interactable) {
  interactor.interact(chosen); // must be in the current inRange
}
```

For a scene-wide reveal (an observation skill highlighting everything
interactable), enumerate by scene, independent of any interactor's range:

```ts
import { interactablesIn, rankInteractables } from "@yagejs-addons/interaction";
import type { Entity, Scene, Vec2Like } from "@yagejs/core";

function reveal(
  scene: Scene,
  playerPos: Vec2Like,
  outline: (entity: Entity) => void,
) {
  // interactablesIn drops destroyed hosts but keeps DISABLED ones — the game
  // decides whether an ungated target is still worth revealing.
  const live = interactablesIn(scene).filter((it) => it.isEnabled());

  for (const it of live) outline(it.entity); // it.entity is the host to highlight

  // rankInteractables is geometry only, so filter the enabled gate first:
  return rankInteractables({ position: playerPos, range: 200 }, live);
}
```

Each `Interactable` exposes read-only `position`, `radius`, `priority`,
`prompt`, `order`, `isEnabled()`, and `entity` — the per-target data a highlight
or icon reads.

## Headless model (`selectInteractionFocus`, `rankInteractables`)

```ts
import type { Vec2Like } from "@yagejs/core";
import type {
  FocusQuery as BaseFocusQuery,
  InteractCandidate as BaseInteractCandidate,
} from "@yagejs-addons/interaction";

declare function selectInteractionFocus<C extends InteractCandidate>(
  query: FocusQuery,
  candidates: Iterable<C>,
): C | null; // single winner, O(n), no sort and no array allocation

declare function rankInteractables<C extends InteractCandidate>(
  query: FocusQuery,
  candidates: Iterable<C>,
): C[]; // full in-range set best-first; rankInteractables(...)[0] === selectInteractionFocus(...)

interface FocusQuery extends BaseFocusQuery {
  position: Vec2Like;
  range: number;
}
interface InteractCandidate extends BaseInteractCandidate {
  position: Vec2Like;
  radius: number;
  priority: number;
  order: number;
}
```

Both pure, no engine dependency — unit-test selection without a scene. Both
encode the same policy (priority, then distance, then registration order), so a
custom detector gets it for nothing. Reach for `selectInteractionFocus` when only
the winner matters and a sorted array would be thrown away. Both are geometry
only: filter the `enabled` gate yourself.

## Deferred to v1.x

Physics-sensor proximity source, facing-cone focus, a bundled `./presenters`
prompt view, snapshot/restore (focus is transient, re-derived each frame — no
`@yagejs/save` dependency).
