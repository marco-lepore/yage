# @yagejs-addons/stats

Headless numeric stats and formulas. Requires `@yagejs/core`; no plugin or
renderer. The game chooses stat names, damage rules, and consequences.

## Stats

```ts
import { Stats } from "@yagejs-addons/stats";

type Stat = "strength" | "attack" | "speed";
const stats = new Stats<Stat>({
  strength: { base: 10 },
  attack: {
    derived: {
      dependencies: ["strength"],
      evaluate: (get) => get("strength") * 2,
    },
  },
  speed: { base: 200, min: 0, max: 420 },
});
stats.setSource("weapon", [{ stat: "attack", operation: "flat", value: 30 }]);
stats.get("attack"); // 50
stats.setBase("strength", 20);
stats.get("attack"); // 70
```

`new Stats<K>(definitions: Record<K, StatDefinition<K>>, options?: StatsOptions)`.
Without an explicit union, keys are inferred from definitions.

- `StatDefinition`: `base?: number` (default 0) OR `derived?: DerivedStatFormula<K>`;
  optional finite `min`, `max`, and `round: "floor" | "ceil" | "round"`.
- `get(stat): number`, `getBase(stat): number`, `values(): Record<K, number>`.
  `getBase` includes contributing `baseAdd` modifiers, before percentages, flat
  bonuses, overrides, rounding and bounds. For derived stats, the formula result
  supplies the unmodified base.
- `setBase(stat, value)`, `setBases(Partial<Record<K, number>>)`: validate the
  complete batch before writes; derived stats reject base writes. These methods
  replace the stored base without changing source contributions.
- `setSource(source, modifiers)`: replace every effect/modifier owned by that
  source with one indefinite collection. Empty modifiers remove the source.
  This also cancels temporary and suppressed effects with that source. Use distinct
  names such as `weapon:stats` and `weapon:proc` when refreshing equipment must
  preserve its temporary effects; remove both names when unequipping should end both.
- `removeSource(source): number`: remove all collections belonging to the owner;
  returns the count removed, including suppressed effects.
- `explain(stat): StatBreakdown<K>`: detached `unmodifiedBase` (stored base or formula result),
  `baseAdd` (sum of contributions), `base` (their sum), other modifier totals, override,
  contributing modifiers and final value. `snapshot().sources` exposes ownership.
- `onChange(listener): unsubscribe`: synchronous, after base/source/effect
  mutations, refresh, restore or expiry. Countdown alone does not notify.
  Notifications describe input changes, including changes that leave values equal.
  A listener may read current values. A throwing listener stops fan-out; the
  mutation remains applied. Nested writes dispatch nested notifications.

## Math

`base = unmodifiedBase + sum(baseAdd)`.

`value = (base + base * sum(basePercent) + sum(flat)) * (1 + sum(percent)) * product(multiply)`.

Each `StatModifier<K>` is `{ stat, operation, value, priority? }`.

| Operation     | Value meaning                                            |
| ------------- | -------------------------------------------------------- |
| `baseAdd`     | Added to the base before base percentages                |
| `flat`        | Added amount                                             |
| `basePercent` | Fraction of base including baseAdd; 0.2 adds 20% of base |
| `percent`     | Fractions summed, then applied to base plus additions    |
| `multiply`    | Independent factor; 1.2 multiplies by 1.2                |
| `override`    | Replaces the entire result of the arithmetic above       |

Use `baseAdd` for regular equipment stats that percentage bonuses should scale.
Use `flat` for traits added after base percentages. Both belong to the same source
and follow its replacement, removal, stacking and lifetime rules. Snapshots keep
stored bases and modifier contributions separate, so restore never adds them twice.

Overrides use highest `priority` (default 0), then newest collection, then last
modifier within the collection. Apply rounding, then min/max bounds, after the
override. Negative values and factors are legal. All supplied numbers and stored
formula results must be finite; overflow during evaluation throws.

Definitions, modifiers and group policies are copied. Mutable equipment/config
is explicit: call `setSource` again when it changes. There is no polling or
subscription to external objects. Formula callbacks must be synchronous and pure.
They can read only declared dependencies through `get`, and cannot recursively
read or mutate their own Stats model. Unknown dependencies, undeclared reads and
cycles throw with names. String dependencies use effective values. Each dependency runs
once per evaluation; separate reads evaluate afresh. Use `values()` when reading
several stats together. There is no cross-read cache to become stale when a pure
formula closes over changed game configuration. External configuration changes do
not emit `onChange` or `StatsChangedEvent`. For event-driven consumers, represent
changing numeric inputs as stats and update them with `setBase` or `setBases`.

## Derived dependencies

`DerivedStatFormula<K>` has `dependencies: readonly StatDependency<K>[]` and
`evaluate: (get: StatReader<K>) => number`. `StatValue` is `"base" | "effective"`.

- `"attack"` or `{ stat: "attack", value: "effective" }` declares an effective
  value dependency, read with `get("attack")` or `get("attack", "effective")`.
- `{ stat: "attack", value: "base" }` declares a base dependency, read with
  `get("attack", "base")`. It includes `baseAdd` and excludes all other modifiers,
  rounding and bounds.
- Declare both dependencies to read both values. Declaring one does not authorize
  reading the other. Unknown stats, selectors and undeclared reads throw.
- Base and effective reads share one evaluation. Derived callbacks run once per
  evaluation, even when several formulas read both values. Cycles through either
  kind of dependency are rejected before any callback runs.
- `getBase` and declared base reads do not evaluate that stat's effective-value
  arithmetic. Any dependencies in its derived formula still run as declared.

```ts
import { Stats } from "@yagejs-addons/stats";

const stats = new Stats<"attack" | "aura">({
  attack: { base: 100 },
  aura: {
    derived: {
      dependencies: [{ stat: "attack", value: "base" }],
      evaluate: (get) => get("attack", "base") * 2,
    },
  },
});
stats.setSource("weapon", [
  { stat: "attack", operation: "baseAdd", value: 50 },
  { stat: "attack", operation: "basePercent", value: 1 },
]);
stats.values(); // { attack: 300, aura: 300 }
```

## Effects and stacking

```ts
import { Stats } from "@yagejs-addons/stats";

const stats = new Stats(
  { attack: { base: 100 } },
  {
    groups: {
      fury: { mode: "stack", limit: 3, overflow: "oldest" },
      aura: { mode: "highest" },
      stance: { mode: "latest" },
    },
  },
);
const effect = stats.addEffect({
  source: "ally:42",
  group: "aura",
  rank: 2,
  duration: 5,
  modifiers: [{ stat: "attack", operation: "basePercent", value: 0.2 }],
});
effect?.refresh(8);
stats.advance(1);
effect?.cancel();
```

`addEffect(StatEffect<K>): StatEffectHandle | null`. Options: `modifiers`, optional
`source`, `group`, `rank` (default 0), `duration` (positive finite seconds).
Omitted duration is indefinite. Ungrouped effects stack independently.

Groups are configured once in `StatsOptions.groups`:

- `stack`: all contribute. Optional positive integer `limit`. At capacity,
  `overflow: "reject"` (default) returns null; `"oldest"` removes the oldest.
  Each stack has its own duration; refresh affects only its handle.
- `highest`: highest explicit rank contributes, newest wins ties. Rank applies to
  the whole collection, not the size/sign of one modifier.
- `latest`: newest collection contributes.

Suppressed collections stay present and their timers continue. They can resume
when the winner disappears, provided they have not expired. Group names must be
configured; unknown names throw. Groups arbitrate across all source owners.

Handles expose `id`, `active` (present), `contributing`, `remaining` (seconds,
null if indefinite, 0 if removed), `cancel(): boolean`, and `refresh(seconds)`.
Cancellation is idempotent; refreshing a removed handle throws. Refresh changes
only the duration; it does not alter rank or recency. `effect(id)` reacquires a
handle or returns undefined.

`advance(dt)` consumes non-negative finite seconds and expires effects at zero.

## Entity clock and events

```ts yage-context="entity"
import { Stats, StatsComponent, StatsChangedEvent } from "@yagejs-addons/stats";

const model = new Stats({ speed: { base: 200 } });
entity.add(new StatsComponent({ model }));
entity.on(StatsChangedEvent, () => {
  const speed = model.get("speed");
  console.log(speed);
});
```

`StatsComponent({ model, clock?: "fixed" | "frame" })` defaults to fixed time.
Both choices receive scene/entity time scaling, including freeze and slow motion.
Paused scenes and disabled/inactive components do not advance effects. Modifiers
remain in the model while disabled. Choose one ticking owner for each model; do
not also call `advance` when a component owns its clock. For another clock, use
headless `advance` from the game component that owns that clock.

`component.model` exposes the full public model contract (`StatsModel<K>`), which
can be implemented by a custom model. The component forwards changes through the
void `StatsChangedEvent` while enabled. It does not clear the model on removal.
The game owns current HP, death, resource clamping, movement, and hit application.

## FormulaGraph

`new FormulaGraph<K, C = void>(nodes: Record<K, StatFormula<K, C>>, errorBoundary?)`.
Each node has `{ dependencies: readonly K[], evaluate: (get, context: C) => number }`.

- `evaluate(key, context): number`: evaluates the node and its dependencies.
- `values(context): Record<K, number>`: all named intermediate results.
- `keys: readonly K[]`; `errorBoundary: ErrorBoundary`.

The graph validates all dependencies and cycles at construction. Evaluation
checks declared reads and finite outputs. All declared dependencies run, including
ones skipped by a conditional branch. Shared dependencies run once per call.
The caller passes attacker/target snapshots, hit tags, coefficients and crit rolls
in `C`; the graph supplies no damage, reaction, random, or health policy. Use game
code to choose snapshot versus current values. See the human guide's damage example.

Stats derived values use this same graph. Callback failures are recorded, logged
and rethrown through `ErrorBoundary`. Headless instances create their own boundary
unless supplied one. An enabled StatsComponent uses the engine boundary and restores
the prior boundary on disable/removal. Share the engine boundary with independent
FormulaGraph instances when their errors should appear in the Inspector.

## Save state

`snapshot(): StatsSnapshot<K>` returns detached JSON-compatible data: version 1,
stored bases, the next effect id, and all active/suppressed sources with ids, ownership, remaining
seconds, rank, group and modifiers. Derived definitions, bounds, group policies,
callbacks, listeners and engine objects are not saved. Recreate definitions and
policies from game code, then call `restore(data: unknown): void`.

Restore validates the complete snapshot before replacing state, including stat and
group names, finite numbers, required bases, duplicate ids and stack limits. Saves
must match the current definition keys; migrate changed schemas in game save code.
Old handles become inactive on restore. Reacquire with `effect(savedId)`. Existing
listeners survive restore and receive one change notification.

Include the snapshot in an explicit `Serializable` root to use `@yagejs/save`.
The addon neither registers a root nor traverses entities.
