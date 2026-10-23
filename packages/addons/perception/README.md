# @yagejs-addons/perception

Give an entity 2D sight and last-seen memory. Read which targets it sees, why it missed the others, and where it last saw each target it lost. React through entity events.

```ts
import { Entity, Transform } from "@yagejs/core";
import { PERCEPTIBLE_TAG, PerceptionSensor } from "@yagejs-addons/perception";

class Guard extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new PerceptionSensor({ range: 300, fieldOfView: Math.PI }));
  }
}

class Player extends Entity {
  setup() {
    this.tags.add(PERCEPTIBLE_TAG);
    this.add(new Transform());
  }
}
```

Targets need a `Transform` and the `PERCEPTIBLE_TAG` tag. No plugin is required. The default sensor sees through walls; pass `lineOfSight: perceptionRaycast()` from `@yagejs-addons/perception/physics` for physics occlusion, or write your own check.

The root requires `@yagejs/core`. Physics is an optional peer. Distances use world pixels, angles use radians, and durations use seconds.

See the [API reference](docs/llms/perception.md), [human guide](https://yage.dev/addons/perception/), and [runnable example](https://examples.yage.dev/perception.html).
