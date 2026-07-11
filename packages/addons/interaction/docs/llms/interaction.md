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

Everything is headless: `Interactable`, `Interactor`, the two event tokens,
and the pure `selectFocus` function. The game renders the prompt from
`InteractionFocusChangedEvent`; there is no bundled presenter to opt into.

```ts
import {
  Interactable,
  Interactor,
  InteractionFocusChangedEvent,
  InteractedEvent,
} from "@yagejs-addons/interaction";
```

## 5-minute setup

```ts
// Mark any entity as interactable.
chest.add(new Interactable({ prompt: "Open", onInteract: () => chest.open() }));

// The player is the detector. Defaults: range 48px, action "interact",
// nearest-in-range focus, self-driven off @yagejs/input if present.
const interactor = player.add(new Interactor({ range: 70 }));

// Headless addon — the game draws the prompt. Fires only on a focus change.
player.on(InteractionFocusChangedEvent, ({ prompt }) => {
  promptLabel.text.text = prompt ?? "";
  promptLabel.text.visible = prompt !== null;
});
```

## `InteractableOptions`

```ts
interface InteractableOptions {
  onInteract: () => void;
  prompt?: string | (() => string);   // undefined = focusable, no label
  radius?: number;                    // own reach bonus, default 0
  priority?: number;                  // focus tie-break weight, default 0
  enabled?: boolean | (() => boolean); // default true
}
```

`prompt` and `enabled` accept a live provider, re-resolved every frame — no
extra setup needed for a lever's "Turn on"/"Turn off" or a busy-gated door.

## `InteractorOptions`

```ts
interface InteractorOptions {
  range?: number;         // world px, default 48
  action?: string | null; // default "interact"; null = no auto-input
  enabled?: boolean;       // default true
}
```

A candidate is in range when `distance(interactor, interactable) <= range +
interactable.radius`. Focus = highest `priority` in-range enabled candidate;
ties break by nearest, then by registration order (deterministic).

## `Interactor` API

- `focus: Interactable | null` — the current winner.
- `interact(): void` — fires the focus's `onInteract` + emits
  `InteractedEvent`. No focus → no-op. A custom controller or a test calls
  this directly instead of synthesizing input.
- `enabled: boolean` (inherited from `Component`, default true) — doubles as
  the tracking toggle. `false` emits a null-focus transition immediately (if
  a focus was held), halts tracking + input polling; `true` resumes next
  frame. Flip it to pause one interactor during a cutscene, or to switch
  tracking between several.

```ts
// Manual / headless drive — no @yagejs/input, or a test:
const interactor = player.add(new Interactor({ range: 70, action: null }));
if (input.isJustPressed("interact")) interactor.interact();
```

## Events (on the interactor's entity; bubble entity → scene)

- `InteractionFocusChangedEvent` — `{ interactable: Interactable | null,
  prompt: string | null }`. Fires ONLY on a transition: the focused
  interactable changes, or its resolved prompt text changes. Leaving all
  ranges emits `{ interactable: null, prompt: null }`.
- `InteractedEvent` — `{ interactable: Interactable }`. Fires on every
  interaction (auto-input edge or manual `interact()`).

## Cross-addon composition (no addon→addon dependency)

An interactable's `onInteract` is a plain closure — connect dialogue, inventory,
or anything else from it directly:

```ts
npc.add(new Interactable({ prompt: "Talk", onInteract: () => dialogue.play(script) }));
coin.add(new Interactable({
  prompt: "Pick up",
  onInteract: () => { inventory.add("coin"); coin.destroy(); },
}));
```

## Headless model (`selectFocus`)

```ts
function selectFocus<C extends InteractCandidate>(
  query: FocusQuery,
  candidates: Iterable<C>,
): C | null;

interface FocusQuery { position: Vec2Like; range: number; }
interface InteractCandidate { position: Vec2Like; radius: number; priority: number; order: number; }
```

Pure, no engine dependency — unit-test focus selection without a scene.

## Deferred to v1.x

Physics-sensor proximity source, facing-cone focus, multi-target focused set,
a bundled `./presenters` prompt view, snapshot/restore (focus is transient,
re-derived each frame — no `@yagejs/save` dependency).
