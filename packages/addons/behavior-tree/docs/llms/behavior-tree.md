# @yagejs-addons/behavior-tree

Typed behavior trees with per-entity execution state, synchronous action lifecycle,
reactive decisions, and Inspector diagnostics. The root import is headless and
requires only `@yagejs/core`.

## API

```ts
import {
  BehaviorTree,
  BehaviorTreeAgent,
  behaviorNodes,
} from "@yagejs-addons/behavior-tree";
import type {
  BehaviorNode,
  BehaviorAction,
  BehaviorExit,
  BehaviorInspection,
} from "@yagejs-addons/behavior-tree";
import type { ProcessClock } from "@yagejs/core";

// Signature reference. C is the game's existing state owner or typed references.
interface Context {
  health: number;
}
const nodes = behaviorNodes<Context>();
const definition: BehaviorNode<Context> = nodes.wait("rest", 1);
const tree = new BehaviorTree(
  definition,
  { health: 100 },
  { historyLimit: 128 },
);
const agent = new BehaviorTreeAgent(tree, {
  clock: "fixed" satisfies ProcessClock,
});
const status = tree.tick(1 / 60); // "idle" | "running" | "success" | "failure"
const diagnostics: BehaviorInspection = tree.inspect();
tree.cancel();
```

| Builder                                          | Meaning                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `action(id, (context) => BehaviorAction)`        | Fresh action object and closure for every activation.                                                       |
| `condition(id, (context) => boolean)`            | Success for true, failure for false. Keep predicates free of side effects.                                  |
| `sequence(id, children, { reactive?: boolean })` | Visit in order until running/failure; success if all succeed. Empty succeeds.                               |
| `selector(id, children, { reactive?: boolean })` | Visit in order until running/success; failure if all fail. Empty fails.                                     |
| `guard(id, predicate, child)`                    | Check every visit; false cancels child with `guard-failed` and fails.                                       |
| `subtree(id, child)`                             | Named reuse of a definition; each occurrence gets its own execution state.                                  |
| `wait(id, seconds)`                              | Accumulate supplied dt, succeed at duration. Zero succeeds on first positive tick.                          |
| `randomWait(id, min, max)`                       | Sample a uniform duration once per activation, then wait. Equal bounds skip RNG.                            |
| `chance(id, probability, child)`                 | Roll once per activation; visit child if accepted, otherwise fail.                                          |
| `weightedSelector(id, choices, options?)`        | Relative `{ weight, child }` entries; keep running choice; retry untried children after failure by default. |
| `cooldown(id, seconds, child)`                   | Available initially; arm after child success; blocked visits fail without visiting child.                   |
| `timeout(id, seconds, child)`                    | Count supplied dt before child; cancel and fail at deadline. Zero never enters child.                       |
| `invert(id, child)`                              | Swap success/failure; preserve running.                                                                     |

The helpers return plain `BehaviorNode<C>` objects. IDs must be nonempty and
contain no `/`; sibling IDs must differ. Paths join IDs with `/`. Construction
copies topology and callback references, validates cycles and durations, and limits
a tree to 4096 occurrences and depth 128. Definition edits require a new runner.
Durations and dt must be finite and nonnegative. `historyLimit` is an integer from
0 to 10000; default 128. Zero disables transition history.

`BehaviorNumber<C> = number | ((context: C) => number)` is accepted for
probability, weights, random-wait bounds, and wait/timeout/cooldown durations.
Callbacks sample once per activation; blocked cooldowns do not sample a duration.
Numeric callbacks must be pure, synchronous, finite and nonnegative. Probabilities
must be in `[0, 1]`; random-wait bounds require `min <= max`. Static values validate
at construction; callback values validate before any child starts.

## Mounting and ownership

```ts
import { Component, Engine, Entity, Scene, advanceFrames } from "@yagejs/core";
import {
  BehaviorTree,
  BehaviorTreeAgent,
  behaviorNodes,
} from "@yagejs-addons/behavior-tree";

class WorkerState extends Component {
  deliveries = 0;
  deliver(): void {
    this.deliveries++;
  }
}
const bt = behaviorNodes<WorkerState>();
const delivery = bt.sequence("delivery", [
  bt.wait("prepare", 0.5),
  bt.action("deliver", (worker) => ({
    tick: () => {
      worker.deliver();
      return "success";
    },
  })),
]);
class Worker extends Entity {
  setup(): void {
    const state = this.add(new WorkerState());
    this.add(new BehaviorTreeAgent(new BehaviorTree(delivery, state)));
  }
}
class WorkScene extends Scene {
  readonly name = "work";
  onEnter(): void {
    this.spawn(Worker);
    this.spawn(Worker);
  }
}
const engine = new Engine();
await engine.start();
await engine.scenes.push(new WorkScene());
// Headless host: advance the engine explicitly. A renderer drives a live game.
advanceFrames(engine, 120);
await engine.destroy();
```

Pass references to components or narrow game-owned interfaces as `C`. Do not copy
health, targets, or inventory into a parallel blackboard. Factories can accept
ordinary typed configuration arguments to return reusable definitions. Allocate
mutable action-local state inside `create`, never in the shared definition's outer
closure. A subtree receives the same context as its parent. Structural typing lets
a subtree require fewer fields than its parent. No named-action registry exists.

Each entity needs a distinct `BehaviorTree` and `BehaviorTreeAgent`. Sharing the
runner between component owners throws. `agent.tree` exposes the model for manual
inspection or cancellation; a headless host uses `tree.tick(dt)` itself. Do not
also tick a runner which an enabled component drives. Custom hosts can supply an
`errorBoundary` option or call `bindOwner(token, boundary, { entity, scene }, random?)`.

## Context and live state

`C` is one arbitrary typed context held by reference. There is no required `state`
field, second context parameter, clone, freeze, subscription, or tick transaction.
Pass a mutable component for small trees, or a narrow interface with read-only
data, owner commands, and capabilities for reusable actions. `Readonly` restricts
TypeScript writes and is shallow; it does not freeze the underlying state.

For owners that replace snapshots, use `read: () => state.get()`. Call `read()`
inside each predicate or action tick. Reading once in the action factory captures
that snapshot for the whole activation. Writes are immediately visible to later
nodes in the same traversal. If an owner uses drafts, create and commit them inside
its command; never retain a draft across ticks. Exceptions do not roll back state,
events, movement, or other effects.

This complete headless example supplies live state, commands, a seeded source, and
an explicit clock. An engine-mounted tree receives the clock and RNG from its agent.

```ts
import { createRandomService, createRecord } from "@yagejs/core";
import { BehaviorTree, behaviorNodes } from "@yagejs-addons/behavior-tree";

class GuardModel {
  readonly state = createRecord({ default: { ammo: 3, shots: 0 } });
  shoot(): void {
    const current = this.state.get();
    this.state.set({ ammo: current.ammo - 1, shots: current.shots + 1 });
  }
  reload(): void {
    this.state.set({ ammo: 3 });
  }
}
const guard = new GuardModel();
const ctx = {
  read: () => guard.state.get(),
  shoot: () => guard.shoot(),
  reload: () => guard.reload(),
};
const bt = behaviorNodes<typeof ctx>();
const shoot = bt.action("shoot", (ctx) => ({
  tick: () => {
    ctx.shoot();
    return "success";
  },
}));
const definition = bt.sequence("turn", [
  bt.randomWait("reaction", 0.2, 0.5),
  bt.weightedSelector("tactic", [
    {
      weight: (ctx) => (ctx.read().ammo > 0 ? 3 : 0),
      child: bt.cooldown("shot-ready", 1, bt.chance("take-shot", 0.75, shoot)),
    },
    {
      weight: 1,
      child: bt.action("reload", (ctx) => ({
        tick: () => {
          ctx.reload();
          return "success";
        },
      })),
    },
  ]),
]);
const random = createRandomService(42);
const tree = new BehaviorTree(definition, ctx, {
  random: () => random.float(),
});
for (let frame = 0; frame < 120; frame++) tree.tick(1 / 60);
```

## Random decisions and cooldowns

`BehaviorTreeOptions.random?: () => number` must return a finite value in `[0, 1)`.
`BehaviorTreeAgent` defaults to the scene RNG; an explicit option takes precedence.
Headless hosts must supply a source before a draw is needed. Chance 0/1, equal
wait bounds, and empty/all-zero weighted choices consume no random number.

A chance decision and sampled wait duration persist while running. Weighted
selectors sample all weights once per activation, exclude zero weights, and retain
the chosen running child. Changed weights take effect next activation; use a guard
for immediate invalidation. Default `onFailure: "retry"` samples among untried
children after failure, at most once per child; `onFailure: "fail"` stops. Empty,
all-zero, or exhausted choices fail. Weights 3 and 1 mean 75%/25% initial choice.

Cooldown duration samples before child entry and arms only on success, never on
failure or cancellation. Blocked visits fail. Remaining time advances on every
positive tree tick, even when unvisited. It survives root restart and cancellation;
disable/pause freezes it. Zero adds no delay. Each occurrence and runner is independent.

A reaction wait delays subsequent work but selecting it interrupts previous work
immediately. To delay switching until a stimulus has persisted, measure that stimulus
on the game owner and expose eligibility through a guard.

## Progress and interruption

`running` means continue on a later tick, `success` means complete, and `failure`
means reject this branch. `idle` is inspection state only. A completed root starts
a fresh traversal on the next positive tick. There is no implicit loop within one
tick. Each visited child receives the same dt; durations do not distribute leftover
time across siblings. dt=0 invokes nothing and leaves diagnostics unchanged.

Sequences and selectors remember the running child's index by default. With
`reactive: true`, they begin at child zero every tick. Earlier conditions are checked
again and earlier completed actions can execute again. Use a reactive selector over
guarded, remembered sequences for priorities such as retreat versus combat.

Only one action or wait leaf owns running work. Before entering a different action
or wait leaf, the runtime cancels the previous branch with `branch-changed`. Cleanup
finishes before the new factory/entry runs. A higher-priority action that fails still
interrupts the old action when probed. Put a side-effect-free guard before that action
if ineligibility must leave the old action running. A false guard cancels its own
child with `guard-failed`. A timeout cancels with `timeout`. Trace records include the
causing node's path in `by`.

## Actions and cancellation

`BehaviorAction` has optional `enter(): void`, required `tick(dt): BehaviorStatus`,
and optional `exit(result: BehaviorExit): void`. The factory allocates local state;
start external work in `enter`. Entry runs once, then tick runs in the same traversal.
Subsequent visits call tick. Exit runs once on completion or cancellation. Its result
is `{ status: "success" | "failure" }` or
`{ status: "cancelled", reason, by }`. Reasons are `cancelled`, `disabled`,
`destroyed`, `branch-changed`, `guard-failed`, and `timeout`.

All callbacks are synchronous. Poll an existing process slot, animation or movement
request from tick. In exit, cancel the process or release the request the action owns.
The runtime cannot infer external resources. Promises are unsupported. Exceptions
never become failure results: the existing `ErrorBoundary` attributes factory,
entry, tick, exit, condition, numeric and random calls and rethrows the same Error. A throwing exit
prevents the next branch from starting. No automatic cleanup runs after a throw.
Fix the callback and cancel the tree before deliberately driving it again.

`tree.cancel(reason?)` exits running work and resets progress; the next tick starts
over. Cancellation from a callback takes effect when that callback returns and stops
the remaining traversal. Recursive tick calls throw. An action's exit is not retried
if it throws. Context changes made by game code are never rolled back.

## Engine time and lifecycle

The component defaults to `clock: "fixed"` and `updatePriority = -10`, before
ordinary steering siblings. `clock: "frame"` uses update instead. Both receive
scene- and entity-scaled seconds. Scene pause stops ticks without exiting actions;
zero time scale freezes tree execution. External work needs the same time owner.
Disabling the component, deactivating its entity or an ancestor, removal and destruction
cancel via `onDisable` with reason `disabled`. `onDestroy` also cancels any manually
started work with `destroyed`; an already idle tree does not exit twice. Re-enabling
starts from the root. For broad active/stunned/dead modes, let the existing
`Component.stateMachine()` enable or disable the tree.

Movement remains in `SteeringAgent`; exit can remove a steering behavior and call
`stop()`. Pathfinding produces a route that a steering action can follow. The tree
neither computes routes nor duplicates movement or state-machine state. Game-owned
random choices can use the scene's `RandomKey`, shared with mounted random nodes.

## Inspection and saving

With the usual Inspector installed, read
`inspector.getComponentData(id, "BehaviorTreeAgent")`. Obtain the id from
`inspector.snapshot().scenes[].entities` by the example entity key `guard-a`. `execution` contains
status, tick number, active paths, every node's kind/status, recent transitions and
last callback error. Every transition has tick, path, from, to, reason and by.
`inspector.getErrors().callbackErrors` contains the engine's callback attribution.
Inspect game components separately for health or target values. Diagnostics are plain
copies and exclude context, closures and resources. History is bounded and not a replay
log; rechecked terminal conditions can consume history entries each tick.

Each node also reports `durationSeconds`, `remainingSeconds`, `chancePassed`,
`selectedChild` (path), and `remainingWeights` (copied array). Unsampled or
inapplicable values are null, except cooldown remaining time starts at zero.
Failed choices become zero in `remainingWeights` when retrying.

The addon owns temporary execution state only. It has no save snapshot/restore API.
Persist health, targets and other durable state through the game's explicit save roots.
Cancel before restoring those roots, then restart from the root. Cancellation
preserves cooldowns; construct a fresh runner if loading should clear them. Active
actions, wait/cooldown progress and traces cannot be resumed from a save.

Runnable example: `examples/behavior-tree.html`, sources in
`examples/src/behavior-tree/`. Two guards share one definition, use steering and
process slots, and demonstrate interrupted attacks and independent progress, sampled
reaction waits, weighted tactics, probability gates, and heavy-attack cooldowns.
