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

| Builder                                          | Meaning                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `action(id, (context) => BehaviorAction)`        | Fresh action object and closure for every activation.                                 |
| `condition(id, (context) => boolean)`            | Success for true, failure for false. Keep predicates free of side effects.            |
| `sequence(id, children, { reactive?: boolean })` | Visit in order until running/failure; success if all succeed. Empty succeeds.         |
| `selector(id, children, { reactive?: boolean })` | Visit in order until running/success; failure if all fail. Empty fails.               |
| `guard(id, predicate, child)`                    | Check every visit; false cancels child with `guard-failed` and fails.                 |
| `subtree(id, child)`                             | Named reuse of a definition; each occurrence gets its own execution state.            |
| `wait(id, seconds)`                              | Accumulate supplied dt, succeed at duration. Zero succeeds on first positive tick.    |
| `timeout(id, seconds, child)`                    | Count supplied dt before child; cancel and fail at deadline. Zero never enters child. |
| `invert(id, child)`                              | Swap success/failure; preserve running.                                               |

The helpers return plain `BehaviorNode<C>` objects. IDs must be nonempty and
contain no `/`; sibling IDs must differ. Paths join IDs with `/`. Construction
copies topology and callback references, validates cycles and durations, and limits
a tree to 4096 occurrences and depth 128. Definition edits require a new runner.
Durations and dt must be finite and nonnegative. `historyLimit` is an integer from
0 to 10000; default 128. Zero disables transition history.

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
`errorBoundary` option or call `bindOwner(token, boundary, { entity, scene })`.

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
entry, tick, exit and condition calls and rethrows the same Error. A throwing exit
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
neither computes routes nor duplicates movement or state-machine state. Random choices
belong in game actions using the scene's `RandomKey`; the runtime has no random source.

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

The addon owns temporary execution state only. It has no save snapshot/restore API.
Persist health, targets and other durable state through the game's explicit save roots.
Cancel before restoring those roots, then restart from the root. Active actions,
wait progress and traces cannot be resumed from a save.

Runnable example: `examples/behavior-tree.html`, sources in
`examples/src/behavior-tree/`. Two guards share one definition, use steering and
process slots, and demonstrate interrupted attacks and independent progress.
