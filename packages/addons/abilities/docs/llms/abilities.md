# @yagejs-addons/abilities

Phase-based abilities plus a concrete hit contract for YAGE. The root entry is
headless and requires `@yagejs/core` + `@yagejs/physics`. The optional
`@yagejs-addons/abilities/input` entry requires `@yagejs/input`. No renderer,
Pixi, presenter, plugin, or runtime dependency is bundled.

## Install and entries

```bash
npm install @yagejs-addons/abilities @yagejs/core @yagejs/physics
# Only for AbilityDriver:
npm install @yagejs/input
```

```ts
import {
  Abilities,
  Facing,
  hitbox,
  Health,
  HitReceiver,
} from "@yagejs-addons/abilities";
import {
  AbilityDriver,
  AbilityDriverComponent,
} from "@yagejs-addons/abilities/input";
```

Register `PhysicsPlugin` for hitboxes, projectiles, touch damage, and default
knockback. The addon itself has no plugin.

## Minimal setup

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
    this.add(new Facing()); // default +x aim when `aim` is omitted
    this.add(new Health({ max: 100 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "player", iframes: 0.15 }));
    this.add(new Abilities([SLASH]));
  }
}

fighter.get(Abilities).send("slash");
```

## Definition schema

```ts
type Scalar = number | ((ctx: StepContext) => number);
type AbilityMatcher = string | { readonly tag: string };

interface AbilityDefBase {
  id: string;
  tags?: readonly string[];
  lane?: string; // default "main"
  priority?: number; // default 0
  cooldown?: Scalar; // seconds, resolved once on entry
  cancels?: readonly CancelWindow[];
  entry?: Readonly<Record<string, string>>; // intent -> phase
}

interface TimelineAbilityDef extends AbilityDefBase {
  timeline: readonly AbilityStep[];
  duration?: number;
}

interface PhasedAbilityDef extends AbilityDefBase {
  phases: Readonly<Record<string, PhaseDef>>;
  start?: string; // default first own phase key
}

type AbilityDef = TimelineAbilityDef | PhasedAbilityDef;

interface PhaseDef {
  timeline: readonly AbilityStep[];
  duration?: number;
  hold?: boolean | { max?: number };
  priority?: number;
  cancels?: readonly CancelWindow[];
  on?: Readonly<Record<string, string | PhaseTransition>>;
  next?: string;
  after?: { at: number; to: string };
}

type PhaseTransition =
  | { to: string; from?: number; until?: number; for?: never }
  | { to: string; from?: number | "end"; for: number; until?: never };

interface CancelWindow {
  from: number;
  to?: number; // default phase end
  into?: readonly AbilityMatcher[]; // default any; strings match def ids
}
```

A `timeline` definition is one phase named `"main"`. A phased definition is
one run across named phases. `on` maps intents to transitions. A declared
intent outside its time guard returns `"noMatch"` and does not fall through to
definition entry. An undeclared intent may enter another definition.

`until` past the phase duration creates linger for the excess. For a window
that starts when a fixed phase finishes, prefer
`{ to, from: "end", for: seconds }`. `from: "end"` is invalid on a hold phase.
A matching intent during linger creates a new activation at the target phase
without a cooldown check or re-arm. These `on` ranges are transition windows.

`hold` binds the phase to the intent that entered it. `release(intent)` flows
to `next`, or completes the run when `next` is absent. `hold.max` caps the
phase. `after` advances on its own phase-local clock.

One activation occupies each lane. An idle lane admits entry. A busy lane
admits a strictly higher entry-phase priority or a matching `cancels` window.
`{ tag }` cancel matchers test `AbilityDef.tags`; string matchers test resolved
definition ids, not entry aliases.

## Timeline steps

```ts
interface PointStep<P extends object = object> {
  kind: string;
  at: number;
  params: P;
  hooks: { fire(params: P, ctx: StepContext): void };
}

interface WindowStep<P extends object = object> {
  kind: string;
  from: number;
  to: number | "end";
  every?: number;
  params: P;
  hooks: {
    enter?(params: P, ctx: StepContext): void;
    exit?(params: P, ctx: StepContext, cancelled: boolean): void;
    tick?(params: P, ctx: StepContext): void;
    onDisable?(params: P, ctx: StepContext): void;
    onEnable?(params: P, ctx: StepContext): void;
  };
}

interface StepContext {
  entity: Entity;
  def: AbilityDef;
  abilities: Abilities;
  activation: AbilityActivation;
  time: SceneTime;
}
```

`"end"` means the phase boundary. It is elastic in a hold phase. Point steps
fire once. Window `enter`/`exit` fire once; `tick` fires at `every` intervals
strictly before the end. Phase transitions and natural completion close
windows with `cancelled: false`; cancellation and interruption pass `true`.
When `Abilities` becomes ineffective, `onDisable` temporarily releases an open
window's live resources. `onEnable` restores them when the component becomes
effective again. These hooks do not close the window or reset its clock.

Custom step factory:

```ts
const lunge = defineStep<{ speed: number }>("lunge", {
  enter({ speed }, ctx) {
    const direction = ctx.entity.get(Facing).unit;
    ctx.entity.get(RigidBodyComponent).setVelocity(direction.scale(speed));
  },
  exit(_params, ctx) {
    ctx.entity.get(RigidBodyComponent).setVelocity(Vec2.ZERO);
  },
});

const step = lunge({ from: 0.1, to: 0.25, speed: 300 });
```

For a step with no params, write `defineStep<Record<never, never>>(...)` or omit
the type argument. `Record<string, never>` does NOT work: its `[string]: never`
index signature also covers the timing fields `defineStep` adds to the factory
argument (`at` for a point step; `from` / `to` / `every?` for a window step),
forcing them to `never` so the factory can't be called.

Built-in step factories:

- `anim({ at, name })`: starts the named renderer-free `KeyframeAnimator`
  animation. Sprite and renderer animation controllers remain game-owned.
- `hitbox<TData>({ from, to, every?, shape, offset?, aim?, team?, hit, tags?, layers?, mask?, follow? })`.
- `spawn<TClass, TData>({ at, entity, params, position?, aim?, team?, hit?, tags?, offset? })`.
- `guard<TData>({ from, to, outcome, policy, punish? })`.
- `parry({ from, to, punish? })`: always negates as `"parried"`.
- `block({ from, to, damageScale?, knockbackScale?, stunScale? })`: mutates data and continues as `"hit"`; scales default to 0.
- `invulnerable({ from, to })`.
- `slowmo({ from, to, scale, includeOwner?, key?, label? })`: cancellation-bound window.
- `slowmo({ at, for, scale, includeOwner?, key?, label? })`: raw-time request that may outlive the phase or cancellation.
- `staggerMotion({ from, to, direction, knockback })`.
- `staggerReaction({ direction, knockback, stun })`: returns the default forced reaction definition at priority 100.

Delivery steps omit `aim` to read sibling `Facing`; explicit `Aim` is a
`Vec2Like` or fire-time `(ctx) => Vec2Like`. `resolveAim` normalizes and throws
for missing/zero direction. `aimAt(getTarget, { face? })` builds a fire-time
target resolver.

## `Abilities` API

```ts
class Abilities extends Component {
  constructor(defs: readonly AbilityDef[]);
  addDefinitions(defs: readonly AbilityDef[]): void;
  replaceDefinitions(defs: readonly AbilityDef[]): void;

  send(intent: string, options?: { data?: unknown; lane?: string }): PlayResult;
  canSend(
    intent: string,
    options?: { lane?: string; interrupts?: boolean },
  ): boolean;
  release(intent: string): boolean;
  force(def: AbilityDef): PlayResult;
  cancel(lane?: string): void;
  cancelAll(): void;

  active(lane?: string): AbilityActivation | null;
  activeId(lane?: string): string | null;
  isActive(lane?: string): boolean;
  elapsed(lane?: string): number | null;
  cooldownRemaining(id: string): number;
  cooldownRatio(id: string): number;
}

type PlayRejection = "cooldown" | "busy" | "noMatch";
type PlayResult =
  | { readonly ok: true; readonly activation: AbilityActivation }
  | { readonly ok: false; readonly reason: PlayRejection };
```

Intent resolution: active phase `on` -> linger -> cross-definition entry.
Unknown intents throw. `data` becomes `activation.payload` on entry or
transition.

`canSend` excludes priority interruption by default so buffered sends wait.
`{ interrupts: true }` asks whether direct `send` would succeed including
priority preemption.

`force` is for imposed reactions. It skips cooldown check/arm and permits a
same-definition restart. Player/AI actions use `send`.

```ts
interface AbilityActivation {
  readonly def: AbilityDef;
  readonly lane: string;
  readonly entity: Entity;
  readonly phase: string;
  readonly phaseElapsed: number;
  readonly phaseDuration: number;
  readonly isHolding: boolean;
  isStepActive(kind: string): boolean;
  readonly elapsed: number;
  elapsedIn(phase: string): number;
  readonly payload: unknown;
  readonly state: "active" | "completed" | "cancelled";
  readonly forced: boolean;
}
```

Stable entity-event tokens:

- `AbilityStarted`: `{ activation }`.
- `AbilityPhaseChanged`: `{ activation, from, to }`.
- `AbilityEnded`: `{ activation, cancelled }`.

Events are deferred until the current runner entry settles. Listeners observe
settled lane state. One run has one start/end pair; phase changes do not end it.

Disabling `Abilities`, or deactivating its entity, pauses active phases, linger,
and cooldown clocks. It also releases the effects owned by open windows without
changing any sibling component's `enabled` value. `send`, `canSend`, `force`,
and `release` refuse new work while dormant. Enabling `Abilities` restores the
same activation, clocks, and open-window effects. Built-in hitbox, guard,
invulnerability, slow-motion, and stagger windows implement this lifecycle.

### Definition replacement

`addDefinitions(next)` validates the complete existing-plus-next set before
installing it. It preserves active runs, cooldowns, linger, and existing
definitions. Any collision leaves the runner untouched.

`replaceDefinitions(next)` eagerly compiles and validates `next`. A failure
leaves the runner untouched. Success cancels all lanes, clears linger and every
cooldown process, installs the new id/intent indexes, then delivers queued
`AbilityEnded` events. New definitions start ready.

The method does not reload `AbilityDriver`:

```ts
abilities.replaceDefinitions(loadout.defs);
driverComponent.replace(loadout.input);
```

Driver replacement discards edges, pending sends, and held-input ownership.
Held actions must be released and pressed again. No in-place driver reload,
tag-filtered partial replacement, or bulk process-tag removal is included.

## Optional input entry

```ts
type AbilityGesture = "press" | "tap" | "hold" | "release";
type AbilityData = unknown;

interface AbilitySend<TAction extends string, TIntent extends string> {
  send: TIntent;
  buffer?: number; // raw seconds from this interaction's edge
  data?:
    | AbilityData
    | ((ctx: AbilityGestureContext<TAction, TIntent>) => unknown);
}

interface AbilityTap<
  TAction extends string,
  TIntent extends string,
> extends AbilitySend<TAction, TIntent> {
  within?: number;
}

interface AbilityHold<
  TAction extends string,
  TIntent extends string,
> extends AbilitySend<TAction, TIntent> {
  at?: number;
  fromNeutral?: boolean;
  resume?: boolean;
  release?: AbilitySend<TAction, TIntent>;
}

interface AbilityBinding<TAction extends string, TIntent extends string> {
  lane?: string;
  press?: AbilitySend<TAction, TIntent>;
  tap?: AbilityTap<TAction, TIntent>;
  hold?: AbilityHold<TAction, TIntent>;
  gate?: (ctx: AbilityFireContext<TAction, TIntent>) => boolean;
}

interface AbilityDriverOptions<TAction extends string, TIntent extends string> {
  defaults?: { tapWithin?: number; holdAt?: number };
  bindings: Readonly<
    Partial<Record<TAction, AbilityBinding<TAction, TIntent>>>
  >;
  beforeFire?: (ctx: AbilityFireContext<TAction, TIntent>) => void;
}
```

```ts
const options = {
  defaults: { tapWithin: 0.22, holdAt: 0.5 },
  bindings: {
    attack: {
      tap: { send: "attack", buffer: 0.18 },
      hold: {
        send: "charge",
        fromNeutral: true,
        resume: true,
        release: { send: "charge-release", buffer: 0.4 },
      },
    },
    dash: { press: { send: "dash", buffer: 0.12 } },
  },
};

class Fighter extends Entity {
  setup(): void {
    this.add(new Abilities(defs));
    this.add(new AbilityDriverComponent(options));
  }
}
```

`AbilityDriverComponent` resolves `InputManagerKey`, calls the plain driver's
`update`, and disposes listeners, recorded edges, buffers, and holds when the
component becomes dormant or is removed. It binds again when the component or
entity becomes active. `replace(options)` swaps the owned driver without
replacing the component. Use `new AbilityDriver(input, abilities, options)`
only when another object owns those lifecycle calls; call its `update()` in
normal component update and `dispose()` on removal. Gesture timing,
buffer deadlines, and `heldFor` use `InputManager.getClockTime()` raw seconds.
Ability phases use scaled scene time.

`press` triggers on down. `tap` triggers on release within its threshold.
`hold` triggers at its threshold and suppresses tap. `fromNeutral` requires the
lane to be idle both on press and at the threshold. `resume` retries a cancelled
hold while the action remains held. Omit `hold.release` to call
`abilities.release(hold.send)` automatically; include it when release is a
separate intent.

Every interaction accepts one edge-relative `buffer`. Retry uses polite
`canSend`, so it never preempts by priority. Data resolves at the input edge
and is retained across retries. `gate` runs before each attempt;
`beforeFire` runs after admission and immediately before `send`.

## Hit types and receipt

```ts
interface StandardHitData {
  damage?: number;
  knockback?: number; // px/s
  stun?: number; // seconds
  hitstop?: number; // delivery carries; game applies
}

interface Hit<TData = StandardHitData> {
  readonly source: Entity;
  readonly direction: Vec2;
  readonly team?: string;
  readonly tags: readonly string[];
  readonly data: TData;
}

type HitResult = "hit" | "ignored" | "blocked" | "parried";
const Hittable: TraitToken<{ receiveHit(hit: Hit): HitResult }>;
```

`createHitDelivery({ source, team?, tags?, data? })` returns
`{ deliver(target, from): HitResult }`. It skips the source and non-`Hittable`
entities. Data is shallow-copied per victim so mutating stages do not leak
between contacts.

```ts
interface HitReceiverOptions<TData = StandardHitData> {
  team?: string;
  iframes?: number;
  filter?: (hit: Hit<TData>, receiver: HitReceiver<TData>) => boolean;
  steps?: readonly HitStage<TData, HitReceiver<TData>>[];
}

class HitReceiver<TData = StandardHitData> extends Component {
  team: string | undefined;
  readonly iframesRemaining: number;
  readonly isInvulnerable: boolean;
  receive(hit: Hit<TData>): HitResult;
}
```

Receipt order: filter -> i-frames -> guards -> ordered stages. The default
filter rejects a hit only when both teams exist and match. Default stages are
`damageStep` then `reactionStep`. `damageStep` calls sibling `Health` when
`damage` exists. `reactionStep` reacts only when `stun` is positive. With a
sibling `Abilities`, it prefers a forced `staggerReaction`; a sibling
`Stagger` is the direct fallback when no runner is present. Knockback without
positive stun does not start a reaction.

Events:

- `HitReceived`: `{ hit, guardOutcomes }` after a hit lands and stages run.
- `HitGuarded`: `{ hit, outcome }` for every engaged guard.
- `HitDealt`: attacker-side `{ result, data, target, ability? }` from
  `createReportingDelivery` and built-in reporting paths.
- `HealthDamaged`: `{ amount, hp }`.
- `HealthHealed`: `{ amount, hp }`.
- `HealthDied`: no payload; once when HP reaches 0.

```ts
class Health extends Component {
  hp: number;
  max: number;
  readonly isDead: boolean;
  takeDamage(amount: number): number; // actual applied amount
  heal(amount: number): number; // actual applied amount; dead cannot heal
}

class Stagger extends Component {
  readonly active: boolean;
  begin(options: {
    direction: Vec2Like;
    knockback: number;
    stun: number;
  }): void;
  end(): void;
}
```

Controllers must not write velocity while `Stagger.active`. Give every
game-specific movement window one shared kind, such as `"velocity"`, and let
the controller write idle velocity only when
`!abilities.active()?.isStepActive("velocity")` and Stagger is inactive.
Disabling `Stagger`, or deactivating its entity, writes zero velocity and keeps
the remaining stun. Enabling it restores the current knockback ramp.

## Deliveries

### Hitbox

```ts
interface HitboxParams<TData = StandardHitData> {
  shape: ColliderShape;
  offset?: Vec2Like;
  aim?: Aim;
  team?: string;
  hit: HitSpec<TData>; // TData | ((ctx: StepContext) => TData)
  tags?: readonly string[];
  layers?: number;
  mask?: number;
  follow?: boolean;
}
```

Window entry creates a detached sensor; exit destroys it. Without `every`, one
delivery reaches each target at most once per window. With `every`, contact
delivers immediately and current overlaps receive another delivery at each
interval; exit stops repeats and re-entry delivers immediately. `follow`
updates position from the caster but keeps spawn-time rotation/offset.
Layers/mask pass through to physics; omission uses Rapier's all-layers default.

### Spawn and projectile

```ts
interface AbilitySpawnContext<TParams = unknown> {
  readonly caster: Entity; // original caster through nested spawns
  readonly aim: Vec2; // unit, fire-time snapshot
  readonly position: Vec2;
  readonly params: TParams;
  readonly team?: string;
  readonly delivery?: HitDelivery;
  readonly activation?: AbilityActivation;
}

@trait(AbilitySpawned)
class Fireball extends Entity {
  abilitySpawnContext: AbilitySpawnContext<{ speed: number }> | undefined;
  setup(ctx: AbilitySpawnContext<{ speed: number }>): void {
    this.abilitySpawnContext = ctx;
    // Add components, presentation, movement, and lifetime.
  }
}

spawn({
  at: 0.2,
  entity: Fireball,
  params: { speed: 300 },
  position: (ctx) => muzzleWorldPosition(ctx.entity),
  hit: { damage: 12 },
});
```

Params infer from the selected class's
`setup(context: AbilitySpawnContext<TParams>)` signature. If
`AbilitySpawnParams<typeof EntityClass>` is `never`, fix that setup signature
and declare the `abilitySpawnContext` field. `position` is an absolute world
position or fire-time resolver; the facing-local `offset` is applied after
that base. The entity owns all behavior and lifetime. `hit` is optional; when
present, context receives a ready reporting delivery. `Projectile` is a
supplied dynamic sensor entity:

```ts
spawn({
  at: 0.2,
  entity: Projectile,
  params: {
    speed: 300,
    lifetime: 2,
    shape: { type: "circle", radius: 5 },
    groups: { layers, mask },
  },
  hit: { damage: 12, stun: 0.2 },
});
```

Projectile consumes on any result except `"ignored"`, or any non-sensor solid
contact. It passes through ignored sensor overlaps. `resolveAbilitySource` and
`resolveAbilityTeam` recover original-caster provenance inside nested spawned
attacks.

### Touch damage

```ts
new TouchDamage({
  hit: { damage: 5, knockback: 80, stun: 0.1 },
  team: "enemy", // omit to inherit sibling HitReceiver/team context
  tags: ["contact"],
  interval: 1, // seconds per target; default 1
});
```

Requires a sibling `ColliderComponent`. Uses collision callbacks for solids
and trigger callbacks for sensors. It creates no collider.

## Custom hit data

Raw generic path:

```ts
interface ElementHit extends StandardHitData {
  element: "fire" | "ice";
}

const receiver = new HitReceiver<ElementHit>({ steps });
const step = hitbox<ElementHit>({
  ...args,
  hit: { element: "fire", damage: 8 },
});
const delivery = createHitDelivery<ElementHit>({ source, data });
```

One-time type pinning:

```ts
const hits = createHitTools<ElementHit>({
  isData(data): data is ElementHit {
    return typeof data === "object" && data !== null && "element" in data;
  },
});

hits.hitbox(args);
hits.guard(args);
hits.spawn(args);
hits.delivery(options);
hits.reportingDelivery(options, provenance?);
hits.receiver(options?);
hits.stage(stage);
hits.isData(unknownData);
hits.isHit(unknownHit);
```

Use raw generics when only a few call sites need custom data. Use
`createHitTools` when one combat system should pin the same data type across
receivers, steps, deliveries, and boundary predicates. `HitReceived`,
`HitDealt`, and `Hittable` remain singleton boundaries: their public payloads
use the default vocabulary, so custom systems narrow with `hits.isData` or
`hits.isHit` before passing data to typed code. `createHitTools` does not mount
components, mint event tokens, define abilities, or wrap an input driver.

## Stats/resource integration

- Attack numbers: `HitSpec` fire-time builder.
- Defense: prepend a game-authored `HitStage` that mutates `hit.data`, then run
  `defaultHitSteps` or another consequence list.
- Max HP: assign `Health.max`, then clamp/heal `hp` according to game policy.
- Cooldown speed: `Scalar` function, resolved once per cross-definition entry.
- Costs: input binding `gate` checks; `beforeFire` spends after admission. AI
  checks/spends before `send`.

```ts
const def: AbilityDef = {
  id: "slash",
  cooldown: (ctx) => 0.8 / statsOf(ctx.entity).attackSpeed,
  timeline: [
    hitbox({
      from: 0.1,
      to: 0.2,
      shape: { type: "capsule", halfHeight: 18, radius: 10, axis: "x" },
      hit: (ctx) => ({ damage: statsOf(ctx.entity).attack, stun: 0.2 }),
    }),
  ],
};
```

The addon has no attribute, buff/debuff, resource, or cost model.

## Public export index

Root entry, runner:

- Values: `Abilities`, `AbilityStarted`, `AbilityPhaseChanged`, `AbilityEnded`,
  `defineStep`, `resolveScalar`.
- Definition and result types: `AbilityDef`, `TimelineAbilityDef`,
  `PhasedAbilityDef`, `PhaseDef`, `PhaseTransition`,
  `AbsolutePhaseTransition`, `RelativePhaseTransition`, `CancelWindow`,
  `AbilityMatcher`, `Scalar`, `PlayResult`, `PlayRejection`,
  `AbilitySendOptions`, `AbilityCanSendOptions`.
- Timeline and activation types: `AbilityActivation`, `AbilityStep`,
  `PointStep`, `PointStepHooks`, `WindowStep`, `WindowStepHooks`,
  `StepContext`.

Root entry, spawning and aim:

- Values: `AbilitySpawned`, `spawn`, `Projectile`, `Facing`, `resolveAim`,
  `aimAt`, `resolveAbilitySource`, `resolveAbilityTeam`.
- Types: `AbilitySpawnContext`, `AbilitySpawnedClass`,
  `AbilitySpawnedEntity`, `AbilitySpawnParams`, `SpawnParams`,
  `SpawnStepArgs`, `SpawnPosition`, `ProjectileConfig`, `Aim`, `Cardinal`.

Root entry, hit delivery and receipt:

- Values: `Hittable`, `createHitDelivery`, `createReportingDelivery`,
  `resolveHitSpec`, `shouldConsumeProjectile`, `resolveHit`, `HitReceiver`,
  `HitReceived`, `HitGuarded`, `HitDealt`, `createHitTools`.
- Envelope and delivery types: `Hit`, `HitResult`, `HitOutcomes`,
  `StandardHitData`, `HitSpec`, `HitDelivery`, `HitDeliveryOptions`,
  `DeliveryColliderGroups`, `HitStage`, `DeliveryProvenance`,
  `HitDealtPayload`.
- Receiver and typed-tool types: `HitReceiverOptions`, `HitFilter`,
  `HitReceivedPayload`, `GuardOutcome`, `GuardParams`, `GuardPolicy`,
  `CreateHitToolsOptions`, `HitDataPredicate`, `HitTools`.

Root entry, built-in components and steps:

- Values: `Health`, `HealthDamaged`, `HealthHealed`, `HealthDied`, `Stagger`,
  `damageStep`, `reactionStep`, `defaultHitSteps`, `hitbox`, `guard`, `parry`,
  `block`, `invulnerable`, `slowmo`, `anim`, `staggerMotion`,
  `staggerReaction`, `REACTION_PRIORITY`, `TouchDamage`.
- Types: `HealthSnapshot`, `HitboxParams`, `HitboxStepArgs`,
  `GuardStepArgs`, `SlowmoParams`, `SlowmoWindowArgs`, `TimedSlowmoArgs`,
  `TouchDamageOptions`.

Optional `/input` entry:

- Values: `AbilityDriver`, `AbilityDriverComponent`.
- Types: `AbilityGesture`, `AbilityData`, `AbilityDataResolver`,
  `AbilityGestureContext`, `AbilityFireContext`, `AbilitySend`, `AbilityTap`,
  `AbilityHold`, `AbilityBinding`, `AbilityDriverDefaults`,
  `AbilityDriverOptions`.

## Save boundary

`Health` is `@serializable({ type: "@yagejs-addons/abilities/Health" })` and
round-trips:

```ts
interface HealthSnapshot {
  hp: number;
  max: number;
}
```

Restore constructs `Health` without emitting health events. No other runtime
state is saved: cooldowns, activations/phases/lanes, payloads, linger, forced
reactions, driver edges/buffers/holds, receiver i-frames, guards,
invulnerability, stagger, facing, and scene-time requests are transient. A
game rebuilds definitions/input and resumes from a safe gameplay state after
snapshot load. There is no `SnapshotContributor` or `@yagejs/save` dependency.

## Death/corpse recipe

`HealthDied` is policy output, not a built-in death system. Removing a
component from its own listener is safe. For an immovable corpse on a dynamic
body:

```ts
entity.on(HealthDied, () => {
  body.setVelocity(Vec2.ZERO);
  body.setEnabledTranslations(false, false);
  entity.remove(EnemyController);
});
```

Corpses remain hittable unless `HitReceiverOptions.filter` rejects dead
targets. When wrapping the default team rule, accept when either team is
undefined or the two teams differ.

## Deferred or game-owned

No built-in presenters/damage numbers/health bars, generic stats/buffs,
resources, AI decisions, motion-ownership helper, input-driver reload,
tag-filtered loadout edits, hierarchical/stateful tags, bulk process removal,
or transient-combat snapshot restoration. The in-repo
`examples/abilities-addon.html` shows the intended composition, including
complete combo/power loadout replacement.
