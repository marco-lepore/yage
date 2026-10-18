# @yagejs-addons/behavior-tree

Compose typed actions and conditions into behavior trees. Each entity owns its
execution state, running actions release their work on interruption, and the
existing YAGE Inspector reports active nodes and recent transitions.

```sh
npm install @yagejs-addons/behavior-tree @yagejs/core
```

The package exports a headless `BehaviorTree`, the `BehaviorTreeAgent` component,
and `behaviorNodes<C>()` helpers. It has no renderer dependency.

- [Guide](https://yage.dev/addons/behavior-tree/)
- [API and lifecycle reference](docs/llms/behavior-tree.md)
- [Runnable example](../../../examples/src/behavior-tree/main.ts)
- [Runtime design decision](DESIGN.md)

Execution state is temporary. Save durable game state on its existing owner and
restart the tree after loading. Actions are synchronous and poll work owned by the
game; Promise actions and visual editing are not part of the package.
