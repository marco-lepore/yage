# @yagejs-addons/perception

Give an entity 2D sight and last-seen memory. Read detected targets, explain rejected samples, and react through entity events.

```ts
import { Entity, Transform } from "@yagejs/core";
import { PerceptionSensor } from "@yagejs-addons/perception";

class Observer extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new PerceptionSensor({ range: 300, fieldOfView: Math.PI }));
  }
}
```

Targets need a `Transform` and the `perceptible` tag. No plugin is required. The default sensor sees through walls; use `perceptionRaycast` from `@yagejs-addons/perception/physics` for physics occlusion, or provide a custom `lineOfSight` policy.

The root requires `@yagejs/core`. Physics is an optional peer. All distances use world pixels, angles use radians, and durations use seconds.

See the [API reference](docs/llms/perception.md), [human guide](https://yage.dev/addons/perception/), and [runnable example](https://examples.yage.dev/perception.html).
