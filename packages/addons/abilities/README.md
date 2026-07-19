# @yagejs-addons/abilities

Phase-based abilities and a concrete hit contract for [YAGE](https://yage.dev).

**Status: in development — no published release yet.**

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

## The runtime in short

A def is either a plain timeline (one phase, no extra syntax) or a named
phase graph. Phases carry the timeline steps; transitions are declared per
phase in an `on:` map keyed by **intent** strings, with optional time-window
guards. The caster surface is five verbs:

```ts
abilities.send("attack");        // the one way in — for players AND AI
abilities.canSend("attack");     // dry-run: admitted without preempting?
abilities.release("charge");     // completes a hold; true when it did
abilities.cancel();              // stop the lane's run
abilities.force(STAGGER);        // reactions only — see below
```

A simple ability looks exactly like a timeline:

```ts
const DASH: AbilityDef = {
  id: "dash",
  cooldown: 1.1,
  timeline: [invulnerable({ from: 0.03, to: 0.24 }), /* … */],
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
    jab:   { timeline: [/* … */], duration: 0.45,
             on: { attack: { to: "cross", from: 0.25, until: 0.6 } } },
    cross: { timeline: [/* … */], duration: 0.5,
             on: { attack: { to: "hook", from: 0.25, until: 0.6 } } },
    hook:  { timeline: [/* … */], duration: 1.1 },
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
    charge: { hold: { max: 3 }, next: "kick",
              timeline: [anim({ at: 0, name: "charge" })] },
    kick:   { priority: 110,   // super armor for the payoff only
              timeline: [hitbox({ from: 0.1, to: 0.25, hit })] },
  },
};
abilities.send("charge");    // key down (past the game's hold threshold)
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
  preemption included" — pass `canSend(intent, lane, { interrupts: true })`.
- **Phase transitions are not ends.** One `AbilityStarted`/`AbilityEnded`
  pair per run; transitions emit `PhaseChanged`. Window steps close with
  `cancelled: false` on transitions and natural ends, `true` on
  cancel/interrupt.
- **Cooldown is checked and armed at cross-def entry only.** Transitions and
  linger continuations neither check nor re-arm it.
- **`force(def)` is for reactions** — stagger, knockdown, scripted
  interrupts the game imposes on an entity. It bypasses cooldown and can
  restart its own def in place. Input-driven actions go through `send`; a
  gesture is never a `force`.
- Windows end at `to: number | "end"` — `"end"` is the phase's boundary,
  elastic in a hold phase (a guard's `block({ from: 0, to: "end" })`).

## Input composition

The runtime buffers nothing — `send` admits or refuses. Buffering and
gesture logic live in the game's controller, built on `canSend` and the
input plugin's primitives. This is the whole recipe for buffered combo
taps:

```ts
if (
  abilities.canSend("attack") &&
  input.consumeBufferedPress("attack", BUFFER_WINDOW)
) {
  abilities.send("attack");
}
```

Hold gestures pair one `send` at the hold threshold with one `release` on
key-up (`input.isJustHeldFor` / `isJustReleased`). `release` returns false
when the hold is already gone (cancelled, or advanced past by a timer) —
that's the signal for late-delivery logic, e.g. sending an `entry:`-door
intent with the held time as payload. An `AbilityDriver` that owns this
gesture bookkeeping declaratively is planned; until then the raw verbs plus
the input plugin's buffers are the supported path.

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
  addon's job ends at `send`.

## Peer dependencies

`@yagejs/core` and `@yagejs/physics` are required. `@yagejs/renderer` is
optional — only presentation code needs it.
