---
"@yagejs/input": patch
---

An action map can be readonly. `ActionMapInput` — `Readonly<Record<string, readonly string[]>>` — is the type of `InputConfig.actions`, `setActionMap(map)` and `loadBindings(map)`, so a catalog declared once and shared across scenes compiles as written:

```ts
const ACTIONS = { jump: ["Space", "KeyW"], fire: ["KeyJ"] } as const;
engine.use(new InputPlugin({ actions: ACTIONS }));
```

Each of the three copies every key list, so a later rebind leaves the caller's object alone. `exportBindings()` returns a fresh mutable `ActionMapDefinition`, ready to serialize.
