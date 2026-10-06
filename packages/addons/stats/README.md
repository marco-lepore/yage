# @yagejs-addons/stats

Numeric stats, equipment modifiers, timed effects, and damage formulas for YAGE.
Stat names and gameplay consequences belong to your game.

```ts
import { Stats } from "@yagejs-addons/stats";

const stats = new Stats({ attack: { base: 100 }, speed: { base: 200 } });
stats.setSource("weapon", [{ stat: "attack", operation: "flat", value: 20 }]);
const haste = stats.addEffect({
  modifiers: [{ stat: "speed", operation: "multiply", value: 1.5 }],
  duration: 5,
});
stats.advance(1);
haste?.cancel();
```

`StatsComponent` advances a model using entity time. `FormulaGraph` evaluates
named, dependency-checked formulas against game-defined hit context.

See the [guide](https://yage.dev/addons/stats/) and the
[API reference](docs/llms/stats.md) for math order, stacking, derived stats,
formula examples, clocks, and save/restore.
