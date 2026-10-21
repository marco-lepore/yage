# @yagejs-addons/behavior-tree

Compose typed actions and conditions into behavior trees. One definition serves
many entities, each entity keeps its own progress, running actions release their
work when they are interrupted, and the existing YAGE Inspector reports active
nodes and recent transitions.

```sh
npm install @yagejs-addons/behavior-tree @yagejs/core
```

The package exports the `BehaviorTreeAgent` component, a headless
`BehaviorTree` runner, and the `behaviorNodes<C>()` helpers. It has no renderer
dependency. Trees combine sequences, selectors, parallel branches, guards,
waits, timeouts, repeats, retries, probability gates, weighted choices, and
cooldowns. Mounted trees use the scene clock and random generator; a headless
host supplies both. Pass one typed context with live state reads and owner
commands; no separate blackboard is required.

- [Guide](https://yage.dev/addons/behavior-tree/)
- [API and lifecycle reference](docs/llms/behavior-tree.md)
- [Runnable example](../../../examples/src/behavior-tree/behavior.ts)
- [Runtime design decision](DESIGN.md)

Actions are synchronous and poll work owned by the game. `snapshot()` and
`restore()` save cooldowns. A running action cannot be saved, so a loaded tree
starts again from the root and reads the restored game state.
