# @yagejs-addons/loot

`new LootTables<TItem, TContext = void, TTable extends string = string>(catalog)`
validates and copies a plain-object catalog. `roll(table, { random, context?, errorBoundary?, errorContext? })`
returns `LootResult<TItem>`. `context` is required when the context type excludes
`undefined`. The constructor infers table keys when no explicit generics are given;
with explicit item/context types, supply the third generic to restrict table names.

```ts
import { createRandomService } from "@yagejs/core";
import { LootTables } from "@yagejs-addons/loot";

const tables = new LootTables<"coin" | "ruby", { level: number }, "chest">({
  chest: {
    pools: [
      {
        id: "coins",
        entries: [
          {
            id: "coins",
            kind: "item",
            item: "coin",
            quantity: { min: 2, max: 5 },
          },
        ],
      },
      {
        id: "bonus",
        entries: [
          {
            id: "ruby",
            kind: "item",
            item: "ruby",
            weight: 1,
            when: ({ level }) => level >= 3 || "requires-level-3",
          },
          { id: "empty", kind: "empty", weight: 3 },
        ],
      },
    ],
  },
});
const result = tables.roll("chest", {
  random: createRandomService(42),
  context: { level: 1 },
});
console.log(result.rewards, result.trace, result.randomDraws);
```

## Definitions and defaults

- `LootTable<T, C, K>`: `{ pools: readonly LootPool<T, C, K>[] }`.
- Pool: `{ id, entries, rolls?: LootCount, unique?: boolean, when?: LootCondition<C> }`.
  Defaults: one roll, replacement allowed. Pool ids are unique within a table.
- Entry: `{ id, kind: "item", item: T, quantity?: LootCount }`,
  `{ id, kind: "table", table: K }`, or `{ id, kind: "empty" }`.
  All accept `weight?: number | ((context: C) => number)` and `when?`.
  Entry ids are unique within a pool. Default weight and item quantity: 1.
- `LootCount`: nonnegative safe integer or inclusive `{ min, max }` range.
  The inclusive range size must also be a safe integer. Zero rolls skip a pool;
  zero quantity consumes the selection and produces no reward.
- `LootCondition<C>` returns `true` to accept, `false` for `condition-failed`,
  or a nonempty string that explains refusal. Conditions and weights must be
  synchronous and pure. Pool conditions run before the roll-count draw. Entry
  conditions then weights run once per nonzero pool invocation, in entry order.
  A refused entry's weight callback does not run. Results apply to every draw
  in that invocation. Nested invocations evaluate their policies afresh.
- Weights are relative, finite and nonnegative; zero disables an entry. Any
  finite weights work, even when their sum exceeds `Number.MAX_VALUE`.
  Floating-point precision and the injected generator's resolution limit
  extremely small probabilities.
- Pools run in array order; nested tables expand immediately after selection.
  All tables, including unused references and zero-weight entries, are validated
  for malformed definitions, missing references and cycles at construction.
- `unique: true` draws without replacement by **entry id within one pool
  invocation**. It includes empty and table entries. It does not compare items,
  prevent duplicates across pools, or persist depletion across calls (see
  "Game-owned rules"). Exhaustion produces one `no-eligible` trace record and
  stops that pool's remaining draws.
- An empty pool or all-excluded/all-zero pool is valid: no rewards, no selection
  RNG call, and a `no-eligible` trace. A table with no pools returns empty arrays.
- A guaranteed outcome uses an unconditional single-entry pool with positive
  weight, rolls and quantity. Nested guarantees require the nested pool to run.

## Results and reproducibility

`LootResult<T>` has `table`, `rewards`, `trace`, and `randomDraws`.
Each reward has `{ item: T, quantity, source }`. Rewards are not merged; source
contains `{ table, pool, invocation, roll, entry }`. Invocation and draw indices
start at zero.

`LootTrace` is a union on `status`. Every record has `table`, `pool`,
`invocation`, `candidates` and an optional `parent` (the source of the table
selection that invoked a nested table):

- `selected`: `roll` (draw index), `entry`, and `kind`. `kind: "item"` adds
  `quantity`; `"table"` and `"empty"` have none.
- `no-eligible`: `roll`; every candidate is excluded and the pool stops.
- `condition`: `roll: null`, `reason`; the pool's condition refused it.
- `zero-rolls`: `roll: null`; the sampled roll count was zero.

Skipped pools have empty `candidates`. `LootCandidate` is a union on `status`:
`eligible`, `zero-weight`, `already-selected`, or `condition` with `reason`.
Each reports `entry`, effective `weight` and conditional `probability`. A
refused candidate reports weight and probability zero.

Result containers are frozen. Opaque item values retain their original identity
and remain game-owned. Definition containers are copied and frozen; editing the
input afterward has no effect. Construct a new model for changed definitions.

`LootRandom` is `Pick<RandomService, "float">`; `float()` must return a finite
value in `[0, 1)`. Every weighted selection consumes one value, even with one
candidate. Each nonconstant count range consumes one more. Fixed or equal-endpoint
counts consume none. Use the same seed, definitions, context and sequence of calls
for replay. Sharing a scene generator also shares its sequence with other systems.
Use a dedicated `createRandomService(seed)` when loot needs an independent stream.
Changing definitions or callback behavior can change how many values are consumed.

A failing condition, weight callback or random call is recorded on the roll's
`errorBoundary` with its definition path, logged, and rethrown. Without
`errorBoundary`, the failure is logged in development builds only, then rethrown.
Optional per-roll
`errorContext: { entity?, scene? }` adds host names to those records. Invalid callback
results fail the same way. Throws stop the operation; already
consumed RNG values and callback side effects are not rolled back. Pure callbacks
must not mutate the context, catalog or game state. A failed call returns no result.

## Entity integration and inspection

```ts yage-context="entity"
import {
  LootComponent,
  LootRolledEvent,
  LootTables,
} from "@yagejs-addons/loot";

const model = new LootTables({
  chest: {
    pools: [
      {
        id: "coins",
        entries: [{ id: "coins", kind: "item", item: "coin", quantity: 3 }],
      },
    ],
  },
});
const loot = entity.add(new LootComponent({ model }));
entity.on(LootRolledEvent, ({ table, rewards }) => console.log(table, rewards));
const result = loot.roll("chest");
console.log(result.rewards);
```

`new LootComponent({ model, random? })` uses `RandomKey` when `random` is
omitted. `LootComponentOptions<T, C, K>` types the options. `roll(table,
context?)` supplies the engine boundary and entity/scene error context, publishes
`lastRoll`, then emits `LootRolledEvent` with `{ table, rewards }`. The event
bubbles to the scene. One token serves every loot component, so `rewards` is
`readonly LootReward<unknown>[]`; compare or narrow item values in the listener.
A throwing event listener stops fan-out; the completed result remains
published. A model failure leaves the previous `lastRoll` unchanged. Custom models
implement `LootModel<T, C, K>` (`roll`). Their roll call is wrapped too.

`model` and `lastRoll` (initially null) are readable. The component must be
attached, enabled and on an active, live scene entity to roll. It has no update
loop, subscriptions or teardown work. Several components can share the standard
stateless model. `model.roll` works whatever the component's enabled state.
`entity.get(LootComponent)` returns `LootComponent<unknown, unknown, string>`: it
accepts any context and returns unknown items. Keep the reference `entity.add`
returns for the typed component.

With `debug: true` and `InspectorPlugin`/`DebugPlugin` installed, use
`inspector.getComponentData(entityName, "LootComponent")` to read `lastRoll`.
Plain-data items appear as written; class-instance items appear as
`{ _type: "ClassName" }`. The Inspector omits `lastRoll` when an item value is
not JSON-serializable (a cyclic object, a bigint).
`inspector.getErrors().callbackErrors` reports callback failures. Entity roll
events appear in the Inspector event log.

## Granting and saving

For inventory rewards, call `inventory.add(reward.item, reward.quantity)` when
items are inventory ids. Respect `{ added, rejected, reason }`; keep rejected
quantities for retry or world drops. Use inventory's `transfer` for movement
between inventories. Loot does not guarantee acceptance or implement claiming.
Games can instead spawn pickups, grant currency or adapt their own reward objects.

There is no durable loot state or snapshot/restore API. Pity, permanent uniqueness,
opened-chest state and reward claiming belong to game-owned state roots. Save
inventory's snapshot and pending/opened chest state together according to the
game's save policy. Results are not automatically JSON-safe when item values are
not JSON-safe. Core's seed alone does not capture a generator's current position.
For replayable independent chests, save a per-chest seed and its claimed state.

## Game-owned rules

Rules that depend on earlier rolls read game state through the context; the game
updates that state from each result:

- Once per player: `when: ({ found }) => !found.has("crown") || "already-found"`,
  then add the item to `found` when a reward contains it.
- Pity: `weight: ({ misses }) => 1 + misses`, then reset `misses` on a hit and
  increment it on a miss.
- One line per item in a HUD: sum `reward.quantity` by `reward.item`; the addon
  keeps rewards separate.

Runnable example: `examples/src/loot-addon/` (`/loot-addon.html`). An
`AdventurerEntity` holds `StatsComponent`, a two-slot backpack and a bank, plus
the found set and the pity counter it updates from `LootRolledEvent`. A
`ChestEntity` holds the `LootComponent` and the rewards the backpack refused.
The HUD shows each selection with its probability and each exclusion reason.
