# @yagejs-addons/loot

Roll typed rewards from weighted pools, nested tables, conditions and quantity
ranges. Supply a seeded random generator and read why each entry was selected or
excluded. Your game decides how to grant the rewards.

```ts
import { createRandomService } from "@yagejs/core";
import { LootTables } from "@yagejs-addons/loot";

const loot = new LootTables({
  chest: {
    pools: [
      {
        id: "reward",
        entries: [
          {
            id: "coin",
            kind: "item",
            item: "coin",
            quantity: { min: 2, max: 5 },
          },
          { id: "ruby", kind: "item", item: "ruby", weight: 0.2 },
        ],
      },
    ],
  },
});
const result = loot.roll("chest", { random: createRandomService(42) });
console.log(result.rewards, result.trace);
```

Install with `npm install @yagejs-addons/loot @yagejs/core`.
`LootComponent` optionally supplies scene randomness, entity events and
Inspector-readable results. The package has no renderer or inventory dependency.

- [Human guide](https://yage.dev/addons/loot/)
- [API and behavior reference](docs/llms/loot.md)
- [Runnable chest example](../../../examples/src/loot-addon/)
