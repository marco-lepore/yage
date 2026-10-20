# @yagejs-addons/loot

`new LootTables<TItem, TContext = void, TTable extends string = string>(catalog, options?)`
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
- Weights are relative, finite and nonnegative; zero disables an entry. Eligible
  weights are scaled before summing to avoid overflow. Floating-point precision
  and the injected generator's resolution limit extremely small probabilities.
- Pools run in array order; nested tables expand immediately after selection.
  All tables, including unused references and zero-weight entries, are validated
  for malformed definitions, missing references and cycles at construction.
  Nesting is limited to 64 tables.
- `unique: true` draws without replacement by **entry id within one pool
  invocation**. It includes empty and table entries. It does not compare items,
  prevent duplicates across pools, or persist depletion across calls. Exhaustion
  produces one `no-eligible` trace record and stops that pool's remaining draws.
- An empty pool or all-excluded/all-zero pool is valid: no rewards, no selection
  RNG call, and a `no-eligible` trace. A table with no pools returns empty arrays.
- A guaranteed outcome uses an unconditional single-entry pool with positive
  weight, rolls and quantity. Nested guarantees require the nested pool to run.

## Results and reproducibility

`LootResult<T>` has `table`, `rewards`, `trace`, and `randomDraws`.
Each reward has `{ item: T, quantity, source }`. Rewards are not merged; source
contains `{ table, pool, invocation, roll, entry }`. Invocation and draw indices
start at zero. A trace includes pool/table/invocation, draw index (`null` for a
skipped pool), status (`selected`, `no-eligible`, `condition`, `zero-rolls`),
selected entry/kind/quantity where applicable, and candidates. Nested trace
records include `parent`, the source of the table selection that invoked them.

Each candidate reports `entry`, effective `weight`, conditional `probability`,
`status` (`eligible`, `condition`, `zero-weight`, `already-selected`), and an
optional refusal `reason`. A refused candidate reports weight/probability zero.
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

Constructor option `maxWork` defaults to 100000 and must be a positive safe integer
below `Number.MAX_SAFE_INTEGER`. Before a roll, a conservative upper bound counts
pool/candidate visits, maximum roll counts and the most expensive nested branch.
Exceeding the bound throws before callbacks or randomness. Conditions and uniqueness
do not lower the bound. Reduce counts/nesting or explicitly raise the limit.

The model exposes `errorBoundary`, `maxWork` and `tableIds`. A constructor boundary
is optional; a roll boundary overrides it. Conditions, weight callbacks and random
calls use `ErrorBoundary.wrapCallback` with the definition path. Optional per-roll
`errorContext: { entity?, scene? }` adds host names to those records. Invalid callback
results also throw through that boundary. Throws stop the operation; already
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
const loot = entity.add(new LootComponent(model));
entity.on(LootRolledEvent, ({ table, rewardCount }) =>
  console.log(table, rewardCount),
);
const result = loot.roll("chest");
console.log(result.rewards);
```

`new LootComponent(model, random?)` uses `RandomKey` when random is omitted.
`roll(table, context?)` supplies the engine boundary and entity/scene error context,
publishes `lastRoll`, then emits
`LootRolledEvent` with `{ table, rewardCount }`. The count is reward stacks, not
item units. A throwing event listener stops fan-out; the completed result remains
published. A model failure leaves the previous `lastRoll` unchanged. Custom models
implement `LootModel<T, C, K>` (`tableIds`, `roll`). Their roll call is wrapped too.

`model`, `tableIds`, `lastRoll` and `diagnostics` are readable. `lastRoll` and
`diagnostics` initially equal null. `LootDiagnostics` derives `table`, `randomDraws`,
`trace`, and reward quantities/sources from the last result without item values.
The component must be attached, enabled and on an active, live scene entity to
roll. It has no update loop, subscriptions or teardown work. Several components
can share the standard stateless model without changing its error boundary.
Direct headless calls remain available independent of a component's enabled state.

With `debug: true` and `InspectorPlugin`/`DebugPlugin` installed, use
`inspector.getComponentData(entityName, "LootComponent")` to read `diagnostics`.
Inspector excludes `lastRoll`, so cyclic item objects, bigint values and custom
serialization cannot hide the selection explanation. Direct `lastRoll` reads
still include the original items. `inspector.getErrors().callbackErrors` reports
callback failures. Entity roll events use the existing Inspector event log.

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

Runnable example: `examples/src/loot-addon/` (`/loot-addon.html`). The example uses
Stats as context, the scene RNG, inventory acceptance and transfer, and displays
pending rewards and selection reasons in the canvas.
