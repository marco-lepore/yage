# @yagejs-addons/perception

`PerceptionSensor(options?: PerceptionSensorOptions)` extends `Component`.
`PerceptionMemory<T>(memoryDuration = 3)` is independently usable headless state.
`perceptionGeometry(origin, rotation, target)` returns `{ distance, angle }`.

## Setup

```ts
import { Engine, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  PerceptionSensor,
  PerceptionDetectedEvent,
} from "@yagejs-addons/perception";

class Observer extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new PerceptionSensor({ range: 300, fieldOfView: Math.PI }));
    this.on(PerceptionDetectedEvent, ({ observation }) => {
      const target = observation.target.current;
      if (target) console.log(target.name);
    });
  }
}
class Target extends Entity {
  setup() {
    this.tags.add("perceptible");
    this.add(new Transform({ position: new Vec2(100, 0) }));
  }
}
class PerceptionScene extends Scene {
  readonly name = "perception";
  onEnter() {
    this.spawn(Observer);
    this.spawn(Target);
  }
}

const engine = new Engine();
await engine.start();
await engine.scenes.push(new PerceptionScene());
```

Required peer: `@yagejs/core`. Optional peer: `@yagejs/physics`, used through
`@yagejs-addons/perception/physics`. No perception plugin, renderer, input, lighting,
steering, or behavior-tree dependency.

## Options

| Option                 | Default                             | Contract                                                                                      |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `range`                | 256                                 | Acquisition radius in world pixels, finite and >= 0                                           |
| `loseRange`            | `range`                             | Retention radius while visible, finite and >= range                                           |
| `fieldOfView`          | `2 * Math.PI`                       | Full angle, radians, 0 through 2π; forward is observer Transform world rotation, +X at zero   |
| `memoryDuration`       | 3                                   | Finite seconds >= 0 since last successful observation; 0 forgets immediately on loss          |
| `visibilityThreshold`  | 0.01                                | In (0, 1]; visibility equal to the threshold passes                                           |
| `autoUpdate`           | true                                | Samples on each positive-dt component update; false requires `sense()`                        |
| `enabled`              | true                                | Standard Component lifecycle toggle                                                           |
| `candidates(observer)` | scene entities tagged `perceptible` | Iterable of entities; duplicates of the same entity are ignored                               |
| `identify(target)`     | runtime entity id + generation      | Unique nonempty string; use stable entity keys to persist observations                        |
| `position(target)`     | target Transform world position     | Finite world-pixel point; supplies a sample point for targets without Transform               |
| `eligible(context)`    | null                                | null accepts; a nonempty reason string rejects                                                |
| `lineOfSight(context)` | true                                | Boolean unobstructed result; omission sees through walls                                      |
| `visibility(context)`  | 1                                   | Finite score in [0, 1], for game-specific camouflage, lighting, etc.                          |
| `memory`               | new PerceptionMemory                | Optional model instance/subclass; its memoryDuration takes precedence; one owner per instance |

Policies receive `PerceptionContext`: observer, target, origin, position, distance,
angle. Angle is the absolute offset from forward. Configuration is copied and
frozen at construction. Policies can read changing game state through closures.
Policies are synchronous and should only read state. Exceptions propagate and are
attributed as `PerceptionSensor.<policy>` by ErrorBoundary. Candidate iterator
exceptions use the candidates attribution too.

The observer requires Transform. Candidates must be active, alive, in the same
scene, distinct from the observer, and have Transform or a position policy.
Range and FOV boundaries are inclusive; coincident points have angle zero.
Rejection order: eligibility, range, FOV, LOS, visibility threshold. Later
policies are skipped after rejection. Built-in reasons are `out-of-range`,
`outside-field-of-view`, `occluded`, and `below-visibility-threshold`.

## Read and react

- `sensor.detected`: last sampled visible observations whose entity life is still active.
- `sensor.observations`: all retained observations, including lost targets.
- `sensor.evaluations`: every evaluated candidate in the latest sample, including failures. Fields: id, entityId, entityName, distance, angle, visibility, reason. Visibility is 0 when rejected before that policy runs.
- `sensor.sampledAt`: latest memory operation's scene timestamp.
- `sensor.diagnostics`: JSON-compatible observations for Inspector, with id, entityId, visible, alive, active, reason, firstSeenAt, lastSeenAt, lostAt, age, lastPosition, visibility.
- `sensor.config`, `sensor.autoUpdate`, `sensor.memory`: readable configuration and model.

`PerceptionObservation<T>` has id, target, visible, reason, firstSeenAt,
lastSeenAt, lostAt, lastPosition and visibility. A sensor's target is an
`EntityHandle`. Always resolve `.current` before using it. The last position and
visibility update only on success. An unseen target never acquires a memory
record from rejection alone. Absent/inactive/destroyed targets become
`unavailable` on the next sample. Memory expires on sampling when
`now - lastSeenAt >= memoryDuration`; success at that sample refreshes it.

`PerceptionDetectedEvent`, `PerceptionLostEvent`, `PerceptionForgottenEvent`
carry `{ sensor, observation }` and fire on the observer. Loss and forgetting
can occur in the same sample, in that order. All facts are installed before
handlers run. A throwing handler stops dispatch. A handler that clears or
restores memory stops the superseded transition batch. No per-frame event fires
for a continuously detected target; read the observation when needed.

`clear(reason = "cleared")` empties state and emits loss/forgotten transitions.
Disable, host deactivation and component removal clear with reason `disabled`.
The engine suppresses events emitted by an already destroyed host. Re-enable
starts fresh next update. `sense()` does nothing while disabled. Recursive
sampling from a policy or handler throws.

Sampling uses `SceneTime.elapsed`. Scene pause/freeze holds memory time; no browser
clock runs. Entity-local time scaling affects updates, while memory age remains
scene-relative. A manual sensor retains its last sample until `sense()` is called;
its diagnostic age continues to reflect scene time. Read `sampledAt`, `alive`
and `active` alongside `visible`. Selection, ranking, hearing propagation,
awareness accumulation and game reactions belong to game code.

## Physics occlusion

```ts
import { Engine, Entity, Scene, Transform } from "@yagejs/core";
import type { PhysicsWorld } from "@yagejs/physics";
import { PhysicsPlugin, PhysicsWorldKey } from "@yagejs/physics";
import { PerceptionSensor } from "@yagejs-addons/perception";
import { perceptionRaycast } from "@yagejs-addons/perception/physics";

class Observer extends Entity {
  setup(world: PhysicsWorld) {
    this.add(new Transform());
    this.add(
      new PerceptionSensor({
        lineOfSight: perceptionRaycast(world),
      }),
    );
  }
}
class GuardScene extends Scene {
  readonly name = "guards";
  onEnter() {
    this.spawn(Observer, this.use(PhysicsWorldKey));
  }
}

const engine = new Engine();
engine.use(new PhysicsPlugin());
await engine.start();
await engine.scenes.push(new GuardScene());
```

Spawn targets and walls in `GuardScene.onEnter()` alongside the observer.
`perceptionRaycast(world, options?)`
returns a LOS policy. Options: `filterGroups?: number`,
`sensors?: QuerySensorMode` (default excludes sensor colliders). It excludes
all colliders on the observer. No hit or a first hit on the target passes.
A different entity blocks, including a child collider; choose collision groups
or a custom LOS policy for compound targets. Coincident points pass without a
raycast. One ray targets one point; partial visibility/multiple sample points
require a custom policy. Existing physics query refresh costs apply per ray.

## Headless memory and controlled persistence

`memory.update(now, samples)` accepts the complete set of `PerceptionSample<T>`
objects: `{ id, target, position, visibility, reason }`. null reason means
success; a nonempty string means failure. Missing ids are unavailable.
The method validates inputs before mutation and returns detected/lost/forgotten
transitions without dispatching callbacks. Keep target identity stable between
updates; replacing a target under the same id ends the old observation with
reason `replaced` and begins a new one. `get(id)`, `observations`, `detected`,
`sampledAt`, and the mutation counter `version` are readable. Observations and
positions are frozen. Arrays returned from memory getters are independent copies.
`clear(now, reason?)` returns transitions. Time must be finite, nonnegative and
monotonic until restore. Direct model mutations do not emit sensor events.

`memory.snapshot(now = sampledAt)` and `sensor.snapshot()` produce
`PerceptionSnapshot`: version 1 plus records containing id, firstSeenAge,
lastSeenAge, lostAge, lastPosition, visibility. No Entity, callback, or handle is
serialized. Age values refer to capture time. Configuration is supplied by the
new instance, not saved.

`memory.restore(snapshot, now, bindings)` accepts explicit `{ id, target }`
bindings. `sensor.restore(snapshot, resolve)` calls a supplied
`(id: string) => Entity | undefined` resolver. Missing, dormant and dead entities
are omitted. Returned entities must belong to the same scene and match the
configured identifier. Invalid data throws before memory is replaced.

Restore replaces state silently, rebases every saved age, and marks all restored
records lost with reason `restored`. A previously visible record gets lostAt at
restore time. Expired records are omitted. Fresh sensing must establish current
visibility. No acquisition/loss events fire during restore. Save the returned
data in an explicit game-owned Serializable root; the addon registers no save
root or slot.

```ts
import { Entity, Transform } from "@yagejs/core";
import { PerceptionSensor } from "@yagejs-addons/perception";
import type { PerceptionSnapshot } from "@yagejs-addons/perception";

class PersistentObserver extends Entity {
  private readonly sensor = new PerceptionSensor({
    identify: (target) => target.requireKey(),
  });

  setup() {
    this.add(new Transform());
    this.add(this.sensor);
  }

  captureMemory(): PerceptionSnapshot {
    return this.sensor.snapshot();
  }

  restoreMemory(saved: PerceptionSnapshot): void {
    this.sensor.restore(saved, (id) => this.scene.findByKey(id));
  }
}
```

Use `PersistentObserver` in the scene above and spawn targets with stable keys,
for example `this.spawn(Target, { key: "player" })`. Capture memory while the
observer is attached. Restore it after the scene has spawned the saved targets.

Spawn all saveable targets with stable keys. Default runtime identifiers are
appropriate for transient perception, not saving across reconstructed scenes.

Inspector: `inspector.getComponentData("Observer", "PerceptionSensor")` includes
config, evaluations, sampledAt and diagnostics. Use existing Inspector events
and ErrorBoundary callbackErrors for transitions and failures. No separate
inspection plugin is required. The [example](https://examples.yage.dev/perception.html)
demonstrates loss behind a physics wall, expiry, visibility policy and reactions.
