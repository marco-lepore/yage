# Loot tables: research and design

Research checked on 20 October 2026. The package owns composing and explaining
reward rolls. The game owns item types, balance, granting rewards and saved progress.

## Public API comparison

| Source                                                                                                                                                                                                                                                                                                                       | Caller setup and extension                                                                                                                                                                                              | Lifecycle and observation                                                                                                                        | Fit for YAGE                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Unity Simple Loot Table](https://github.com/Kellojo/Unity-Simple-Loot-Table)                                                                                                                                                                                                                                                | A `LootTableBase<T>` asset holds guaranteed and weighted optional drops. Consumers call `GetGuaranteedAndOptionalDrops(count)` and instantiate the returned objects. Custom item types require asset/editor subclasses. | Unity owns asset lifetime and global randomness. `GetChanceFor` and simulation methods expose probabilities and console counts.                  | Keep game-owned reward types and quantities. Use plain objects, explicit randomness and structured explanations.                                  |
| [Godot Lootie](https://github.com/sempitern0/Lootie)                                                                                                                                                                                                                                                                         | A `LootieTable` node receives `LootTableData`; callers use `generate(times)`. Resources configure weights, rarity, chance, duplicates and always-drop items.                                                            | `_ready` prepares its RNG. Unique items are removed from the shared resource. Some selection helpers use Godot's global shuffle/pick operations. | Make uniqueness per pool invocation and consume only the injected RNG. Avoid shared asset mutation and probability-mode combinations.             |
| [Minecraft Bedrock schema](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/loottablereference/examples/loottablecomponents/loot_table?view=minecraft-bedrock-stable), [consumer examples](https://learn.microsoft.com/en-us/minecraft/creator/documents/createloottable?view=minecraft-bedrock-stable) | JSON tables contain independent pools, roll ranges, weighted item/table/empty entries, conditions and item functions. Game events trigger table evaluation.                                                             | The game supplies context and applies the result. The schema describes selection but does not return a per-roll explanation.                     | Use pools, explicit empty outcomes and nested references. Replace Minecraft-specific conditions/functions with typed game context and predicates. |

Actual source reviewed: Unity's
[`LootTableBase.cs`](https://github.com/Kellojo/Unity-Simple-Loot-Table/blob/b99f42947f2a1ed79fdf41e000a1cbf503e06839/Simple%20Loot%20Table/Scripts/LootTableBase.cs)
and Lootie's
[`loot_table.gd`](https://github.com/sempitern0/Lootie/blob/ab2b6065789b2a8bfbbfc0a5311b44fcbaefe6c3/addons/ninetailsrabbit.lootie/src/loot_table.gd).
The comparisons above concern those implementations, not all Unity/Godot libraries.

## Chosen scope

`LootTables<TItem, TContext, TTable>` accepts a catalog of plain definitions.
`roll(table, { random, context })` returns typed quantities and a trace. A game
can pass the scene's `RandomKey` or a separately seeded core generator. Every
random draw uses that object. There is no global generator or hidden seed.

Each pool draws one weighted entry per roll, with replacement by default.
`unique: true` removes the selected entry for that pool invocation, including
empty or nested entries. Uniqueness is entry identity, not item equality and
not cross-call depletion. Quantities and roll counts accept inclusive integer
ranges. An unconditional single-entry pool supplies a guaranteed outcome.
Conditions return `true`, `false` or a game-authored rejection reason. Weight
callbacks permit stat-dependent balance without a stats dependency.

Definitions are copied and frozen structurally, while item values remain opaque
references owned by the game. Construction validates the whole catalog,
including unused nested references and cycles. A preflight work bound prevents
an acyclic but exponentially expanding table from freezing a frame. Callback
and RNG failures are attributed through core's `ErrorBoundary` and stop the roll.
The RNG cannot be rolled back after a runtime callback failure.

`LootComponent` adds scene randomness, engine callback attribution, a compact
entity event and Inspector-readable last-roll data. Its headless model stays
public and replaceable. It has no updates, subscriptions, plugin, registry or
presenter. Sharing the stateless model between entities is safe.

Pity counters, permanent unique drops, chest depletion and reward claiming are
game state. The addon owns no durable state, so it has no snapshot/restore API.
The game saves granted inventory and chest progress in its controlled save root.
No generic condition language, rarity hierarchy or item-function pipeline is
needed: games use typed context and adapt the returned rewards themselves.

## Existing YAGE contracts

- Core `RandomService.float()` supplies the only required random capability.
- `ErrorBoundary.wrapCallback` names conditions, weights and RNG failures.
- Component getters feed the existing Inspector; entity events feed its log.
- `Inventory.add` already reports added/rejected quantities and refusal reasons.
  The example keeps rejected rewards available and retries through that method.
- Stats are available to the game through `Stats.get`; the roller accepts the
  resulting values as context and has no stats or inventory dependency.

The reusable work is definition validation, nested composition, scoped unique
draws, quantity ranges and selection explanations. That scope justifies an
addon beyond the historical weighted-choice recipe without adding a second
inventory transaction system.
