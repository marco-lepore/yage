# Runtime decision

The addon owns a small synchronous runtime. The main contract is that changing
priorities releases the previous action before a replacement starts, while callback
errors retain YAGE's attribution and propagation behavior.

## Existing runtime evaluation

Mistreevous 4.3.1 was evaluated from its published npm package and source. It is MIT
licensed, supports Node and browsers, and accepts host delta-time and random
functions. The published package was 81,345 bytes compressed and 492,324 bytes
unpacked; these are package sizes, not a measured browser bundle. Its package manifest
lists `lotto-draw` as a dependency. Adopting it would also require maintaining the
YAGE adapter against upstream lifecycle changes.
[Manifest](https://github.com/nikkorn/mistreevous/blob/master/package.json),
[options](https://github.com/nikkorn/mistreevous/blob/master/src/BehaviourTreeOptions.ts).

A small experiment instantiated an action returning RUNNING with an exit callback,
stepped it, then called the public `reset()`. The exit count remained zero. A second
tree threw a known Error from an action; the caught value was a different Error.
The source confirms that reset clears node state and action/step handlers replace
errors. Typed JSON definitions refer to action names and argument arrays, so the
compiler cannot check the game's action contract directly.
[Tree](https://github.com/nikkorn/mistreevous/blob/master/src/BehaviourTree.ts),
[action](https://github.com/nikkorn/mistreevous/blob/master/src/nodes/leaf/Action.ts),
[agent types](https://github.com/nikkorn/mistreevous/blob/master/src/Agent.ts).

Clock and random injection fit YAGE. Public cancellation, exception identity and
callback typing do not fit without additional lifecycle tracking or upstream
changes. The owned runtime avoids that second execution model. The tradeoff is that
YAGE must maintain and test tree semantics itself, and does not acquire Mistreevous's
text language, Promise support or broader node catalog.

## References and resulting choices

- LimboAI separates ordinary and dynamic selection and gives running actions explicit
  exits. YAGE exposes remembered progress by default and a `reactive` option. Its
  cancellation-before-entry rule also means a failing action probe can interrupt an
  old branch; a pure guard is the recommended eligibility check.
  [Task lifecycle](https://limboai.readthedocs.io/en/stable/classes/class_bttask.html),
  [dynamic selector](https://limboai.readthedocs.io/en/stable/classes/class_btdynamicselector.html).
- Opsive Behavior Designer Pro makes conditional interruption explicit. YAGE uses
  per-visit guards and reactive composites instead of a separate conditional-abort
  scheduler. Conditions are polled on the tree's selected clock.
  [Conditional aborts](https://opsive.com/support/documentation/behavior-designer-pro/conditional-aborts/).
- NodeCanvas makes subgraph inputs explicit and separates local state between
  instances. YAGE uses typed context references and per-activation action closures.
  Subtree configuration can be an ordinary typed function argument. A second
  blackboard would duplicate authoritative component state.
  [Subgraph variables](https://nodecanvas.paradoxnotion.com/documentation/?section=mapping-sub-graph-variables).
- BehaviorTree.CPP distinguishes action start, continuation and halt and demonstrates
  reactive sequences. YAGE uses create/enter/tick/exit with cancellation reasons,
  stable occurrence paths and bounded transition history. Existing Inspector getters
  and ErrorBoundary records provide access without a separate tool protocol.
  [Action lifecycle](https://behaviortree.dev/docs/tutorial-basics/tutorial_04_sequence/).

## Scope

The component owns per-entity behavior. Steering owns movement, pathfinding owns
route construction, process slots own externally running timing, and the core state
machine can control broad modes. No plugin or global service is required.

Execution is serial. Parallel actions, Promise cancellation, visual authoring and
saving a live tree are unsupported. Those features need contracts for shared resources,
external effects or durable execution identity beyond this runtime's scope.
