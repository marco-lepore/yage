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
  cancellation-before-entry rule also means that a higher-priority action that fails
  at once still interrupts an old branch; a pure guard is the recommended eligibility
  check.
  [Task lifecycle](https://limboai.readthedocs.io/en/stable/classes/class_bttask.html),
  [dynamic selector](https://limboai.readthedocs.io/en/stable/classes/class_btdynamicselector.html).
- Opsive Behavior Designer Pro makes conditional interruption explicit. YAGE uses
  per-visit guards and reactive composites instead of a separate conditional-abort
  scheduler. Conditions are polled on the tree's selected clock.
  [Conditional aborts](https://opsive.com/support/documentation/behavior-designer-pro/conditional-aborts/).
- NodeCanvas makes subgraph inputs explicit and separates local state between
  instances. YAGE uses typed context references and per-activation action closures.
  Subtree configuration is expressed through ordinary typed function arguments.
  [Subgraph variables](https://nodecanvas.paradoxnotion.com/documentation/?section=mapping-sub-graph-variables).
- BehaviorTree.CPP distinguishes action start, continuation and halt and demonstrates
  reactive sequences. YAGE uses create/enter/tick/exit with cancellation reasons,
  stable occurrence paths and bounded transition history. Existing Inspector getters
  and ErrorBoundary records provide access without a separate tool protocol.
  [Action lifecycle](https://behaviortree.dev/docs/tutorial-basics/tutorial_04_sequence/).

## State access and runtime context

Other libraries expose several state models rather than one universal blackboard
contract. LimboAI passes an agent and a mutable per-instance blackboard. BehaviorTree.CPP
uses input/output ports and recommends reading inputs inside ticks so updates are
visible. Mistreevous resolves properties and getters on its agent. These provide
live data access without requiring a draft transaction around tree execution.
Blackboards do not necessarily duplicate state: LimboAI can link variables so
different scopes share the same value in memory without copying or polling.
[LimboAI blackboards](https://limboai.readthedocs.io/en/stable/behavior-trees/using-blackboard.html),
[task context](https://limboai.readthedocs.io/en/stable/classes/class_bttask.html),
[BehaviorTree.CPP ports](https://www.behaviortree.dev/docs/tutorial-basics/tutorial_02_basic_ports/),
[ports versus blackboards](https://www.behaviortree.dev/docs/guides/ports_vs_blackboard/),
[Mistreevous agents](https://github.com/nikkorn/mistreevous/blob/master/README.md).

YAGE keeps its single generic context because its trees are authored in TypeScript
and components already own game state and rules. A small tree can receive its
component directly. Larger trees can receive a read-only data view or live `read()` function,
owner commands, and references to capabilities such as steering. This expresses
read/write access in TypeScript without a separate state copy or named port registry.
Replacement snapshots must be read on each tick, not captured in an action factory.
The addon does not own, freeze, clone, or observe the game state.

The tradeoff is runtime visibility into data access. TypeScript interfaces are
erased after compilation, so the Inspector cannot infer which state fields a
callback reads or writes. BehaviorTree.CPP's explicit ports describe that data flow
for tools and allow remapping through XML. YAGE's context expresses those connections
in TypeScript; it provides no port schema for visual authoring or runtime remapping.

A mandatory draft would imply a transaction boundary that cannot include movement,
events, audio, or arbitrary action effects. Owner commands may use their own drafts,
but the runner neither retains them nor promises rollback. Changes remain visible
to later nodes in the same traversal. Engine clock, RNG, and error attribution belong
to the runner and its host; they are not replicated into game state.

## Probability and timing

Chance, weighted selection, and sampled waits are tree nodes. LimboAI likewise
provides probability gates, probability selectors with configurable failure behavior,
and random waits. YAGE samples each activation once, retains a running selection,
and retries weighted alternatives without replacement by default. Callers can opt
to fail immediately after the selected child fails.
[Probability](https://limboai.readthedocs.io/en/stable/classes/class_btprobability.html),
[selector](https://limboai.readthedocs.io/en/stable/classes/class_btprobabilityselector.html),
[random wait](https://limboai.readthedocs.io/en/stable/classes/class_btrandomwait.html).

Numeric inputs accept constants or typed context callbacks. Mounted runners use
the scene RNG unless explicitly overridden; headless callers inject one. No browser
timer or ambient random source controls tree execution. Cooldowns arm after child
success and advance on every tree tick, including while other branches run. They
survive branch/root resets and cancellation, so interruption cannot bypass a cooldown.
Pause and disable freeze them. Because cooldowns are the only progress that outlasts
a cancel, they are the runner's save state: `snapshot()` and `restore()` exchange them
as plain JSON keyed by node path. Game-wide cooldowns shared between entities remain
game-owned data.

## Parallel branches

Entering an action or wait cancels running work outside that leaf's path before the
new leaf starts. A `parallel` node limits that rule to its own children: entering a
leaf inside one child cancels running work only within that child, so sibling children
keep their actions. Once the parallel's result is decided, it cancels its remaining
running children. A sequence also keeps its later running children while an earlier
child is entered again, as a reactive sequence does on every tick. The sequence
halts them itself when that earlier child fails or is still running. BehaviorTree.CPP and LimboAI offer the same success and failure
policies through thresholds; YAGE exposes the two common ones, all and any. The runtime
does not arbitrate resources between children; the game decides which child drives a
shared resource such as one steering agent.

## Scope

The component owns per-entity behavior. Steering owns movement, pathfinding owns
route construction, process slots own externally running timing, and the core state
machine can control broad modes. No plugin or global service is required.

Callbacks are synchronous. A Promise cannot be cancelled with the tree, so actions poll
work that the game owns, such as process slots. A running action is a closure over live
game objects and cannot be serialized; after a load the tree restarts from the root and
reads the restored game state. Visual authoring is not part of the package.
