# @yagejs-addons/perception

2D sight and last-seen memory for one observer entity.

- `PerceptionSensor(options?: PerceptionSensorOptions)` extends `Component`.
- `PERCEPTIBLE_TAG = "perceptible"`: the tag the default candidate query reads.
- `PerceptionMemory<T>(memoryDuration = 3)`: the headless memory model.
- `perceptionRaycast(options?)` from `@yagejs-addons/perception/physics`: a
  physics line-of-sight check.
- Events on the observer: `PerceptionDetectedEvent`, `PerceptionLostEvent`,
  `PerceptionForgottenEvent`, each `{ sensor, observation }`.

Required peer: `@yagejs/core`. Optional peer: `@yagejs/physics`, only for the
`/physics` subpath. No plugin. Distances in world pixels, angles in radians,
times in scene seconds.

## Setup

```ts
import { Engine, Entity, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  PERCEPTIBLE_TAG,
  PerceptionDetectedEvent,
  PerceptionSensor,
} from "@yagejs-addons/perception";

class Guard extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new PerceptionSensor({ range: 300, fieldOfView: Math.PI }));
    this.on(PerceptionDetectedEvent, ({ observation }) => {
      const target = observation.target.current;
      if (target) console.log(target.name);
    });
  }
}
class Player extends Entity {
  setup() {
    this.tags.add(PERCEPTIBLE_TAG);
    this.add(new Transform({ position: new Vec2(100, 0) }));
  }
}
class GuardScene extends Scene {
  readonly name = "guards";
  onEnter() {
    this.spawn(Guard);
    this.spawn(Player, { key: "player" });
  }
}

const engine = new Engine();
await engine.start();
await engine.scenes.push(new GuardScene());
```

The observer requires a `Transform` (`onAdd` throws without one). The sensor
samples on each component update with `dt > 0`.

## Options

| Option                 | Default                                | Contract                                                              |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `range`                | 256                                    | Acquisition radius, finite, >= 0                                      |
| `loseRange`            | `range`                                | Radius while visible, finite, >= `range`                              |
| `fieldOfView`          | `2 * Math.PI`                          | Full angle, 0 to 2π, centered on `facing`                             |
| `memoryDuration`       | 3                                      | Seconds since the last sighting before forgetting, finite, >= 0       |
| `visibilityThreshold`  | 0.01                                   | In (0, 1]; a score equal to the threshold passes                      |
| `candidates(observer)` | active scene entities with the tag     | Iterable of entities; skips self, duplicates, inactive, other scenes  |
| `position(target)`     | target `Transform.worldPosition`       | Finite world point; a candidate without Transform throws when omitted |
| `facing(observer)`     | observer `Transform.worldRotation`     | Finite world angle the field of view is centered on                   |
| `eligible(context)`    | accepts all                            | `null` accepts; a nonempty string rejects with that reason            |
| `lineOfSight(context)` | `true` (sees through walls)            | `false` rejects with `occluded`                                       |
| `visibility(context)`  | 1                                      | Finite score in [0, 1]                                                |
| `autoUpdate`           | `true`                                 | `false` samples only on `sense()`                                     |
| `enabled`              | `true`                                 | Standard Component toggle                                             |
| `memory`               | `new PerceptionMemory(memoryDuration)` | A model instance; passing `memoryDuration` too throws                 |

`PerceptionContext`: `observer`, `target`, `origin` (observer world position),
`position` (sampled point), `distance`, `angle` (0 to π from `facing`).
Options are copied at construction; closures may read changing game state.
Option callbacks must only read state: `sense()` throws when a callback calls
`sense()` or changes the sensor's memory. Each callback runs through
`ErrorBoundary.wrapCallback` as `PerceptionSensor.<option>`; a throw stops the
sample and keeps the previous results.

Check order, first failure wins:

1. `eligible` → its string.
2. `range` (`loseRange` while visible) → `out-of-range`.
3. `fieldOfView` → `outside-field-of-view`. Boundaries are inclusive; a target
   at the origin has angle 0.
4. `lineOfSight` → `occluded`.
5. `visibility < visibilityThreshold` → `below-visibility-threshold`.

## Read

- `sensor.observationOf(entity)`: the observation of the entity's current
  life, visible or remembered, else `undefined`.
- `sensor.detected`: visible observations whose target is active.
- `sensor.observations`: all retained observations.
- `sensor.evaluations`: every candidate of the latest sample:
  `{ id, entityId, entityName, distance, angle, visibility, reason }`.
  `visibility` is 0 when an earlier check failed.
- `sensor.sampledAt`: scene time of the latest sample, clear or restore.
- `sensor.diagnostics`: JSON-safe observations for the Inspector, adding
  `entityId`, `alive`, `active` and `age`.
- `sensor.config`, `sensor.memory`, `sensor.autoUpdate`.

`PerceptionObservation<T>`: `id`, `target`, `visible`, `reason`,
`firstSeenAt`, `lastSeenAt`, `lostAt` (`null` while visible), `lastPosition`,
`visibility`. For the sensor, `target` is an `EntityHandle`; read
`.current`. `lastPosition` and `visibility` change only on a successful
sighting. A target never seen gets no observation. A target that stops being
a candidate gets the reason `unavailable` on the next sample. Observations are
frozen.

Events fire on the observer after memory is updated. Detected fires when a
target comes into sight. Lost fires when a visible target fails a check or
stops being a candidate (reason `unavailable`), and for each visible target on
`clear` or a disable.
Forgotten fires when an observation is dropped (expiry, `clear`, or a
disable). Loss and forgetting can fire in the same sample, in that order. A
continuously visible target emits nothing further. Events from a listener's
`clear()`, `sense()` or disable are queued and delivered after the current
batch. Listeners read current memory, which can be past their event: after a
clear, `observationOf` returns `undefined` during a pending detection. A
throwing listener stops the remaining events, queued ones included.

## Methods and lifecycle

- `sense()`: sample now. Does nothing while the sensor is disabled or its
  entity is inactive.
- `clear(reason = "cleared")`: drop every observation, emitting loss and
  forgetting.
- `snapshot(): PerceptionSnapshot` and `restore(snapshot)`: see Save.

Disable, host deactivation and component removal clear with reason
`disabled`. Memory times use `SceneTime.elapsed`: scene pause holds them,
entity time scale does not change them. Expiry is checked during samples:
an observation is forgotten when `now - lastSeenAt >= memoryDuration`. A
successful sample of an expired, lost observation emits forgotten, then
detected for a new observation with `firstSeenAt` set to the sample time.

## Physics occlusion

```ts
import { Entity, Transform } from "@yagejs/core";
import { PerceptionSensor } from "@yagejs-addons/perception";
import { perceptionRaycast } from "@yagejs-addons/perception/physics";

class Guard extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new PerceptionSensor({ lineOfSight: perceptionRaycast() }));
  }
}
```

Requires `PhysicsPlugin`. `perceptionRaycast(options?)` resolves the
observer scene's `PhysicsWorldKey` on each call and casts one ray from the
observer to the sampled point. Options: `filterGroups?: number`,
`sensors?: QuerySensorMode` (default `"exclude"`). The observer's own
colliders are skipped. No hit, or a first hit on the target entity, passes.
Any other entity blocks, including a child entity of the target. A target at
the origin passes without a ray.

## Save

`sensor.snapshot()` records observations of targets with an entity key, under
that key, as ages relative to capture time. Targets without a key are omitted.
`sensor.restore(snapshot)` resolves each key with `scene.findByKey`, skips
missing and inactive entities, the observer itself, and records with
`lastSeenAge >= memoryDuration`, rebases ages to the current scene time, and
replaces memory silently. Restored observations have `visible: false` and
reason `restored`. Invalid data throws before memory changes. Restoring throws
while the sensor is disabled or its entity is inactive. The addon registers no save slot; store the snapshot
in a game-owned save root.

```ts
import { Entity, Transform } from "@yagejs/core";
import { PerceptionSensor } from "@yagejs-addons/perception";
import type { PerceptionSnapshot } from "@yagejs-addons/perception";

class PersistentGuard extends Entity {
  private readonly sensor = new PerceptionSensor();

  setup() {
    this.add(new Transform());
    this.add(this.sensor);
  }

  captureMemory(): PerceptionSnapshot {
    return this.sensor.snapshot();
  }

  restoreMemory(saved: PerceptionSnapshot): void {
    this.sensor.restore(saved);
  }
}
```

`PerceptionSnapshot`: `{ version: 1, records: { id, firstSeenAge,
lastSeenAge, lostAge, lastPosition, visibility }[] }`.

## Headless memory

- `memory.update(now, samples)`: `samples` is the complete candidate set,
  each `PerceptionSample<T>`: `{ id, target, position, visibility, reason }`.
  `reason: null` is a success. An id missing from the set is rejected as
  `unavailable`. Returns `PerceptionTransition<T>[]`
  (`{ type: "detected" | "lost" | "forgotten", observation }`) and dispatches
  nothing. Validates every sample before changing state. A different `target`
  under a known id ends the old observation with reason `replaced`.
- `memory.clear(now, reason?)`: returns loss and forgetting transitions.
- `memory.snapshot(now = sampledAt)`.
- `memory.restore(snapshot, now, resolve: (id) => T | undefined)`: omits
  unresolved and expired records.
- `get(id)`, `observations`, `detected`, `sampledAt`, `memoryDuration`, and
  `version` (a counter that increments on every change).

`now` must be finite, >= 0, and not lower than the previous call, except on
`restore`. Direct model calls emit no sensor events.

## Limits

- One sample point per target. A target half behind a wall is hidden. Use
  `position` for another point or a custom `lineOfSight` with several rays.
- Gradual awareness, target ranking and hearing are game code. Read
  `observationOf(target)` each frame and accumulate in a game component.
- Walking to `lastPosition` is game code. A straight walk can cut a wall
  corner even when the sight ray was clear; route with `GridGraph` from
  `@yagejs/pathfinding`.
- Example: https://examples.yage.dev/perception.html shows occlusion, memory
  expiry, an ignored ally, a visibility threshold, gradual awareness and a
  search reaction.
