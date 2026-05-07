# Scene Transitions

Animate the handoff between scenes during `push`, `pop`, and `replace`. Both scenes coexist on the stack for the transition's duration.

## Usage

```ts
import {
  chessboard,
  crossFade,
  fade,
  flash,
  iris,
  irisReveal,
  slidePush,
} from "@yagejs/renderer";

// Push with a fade
await engine.scenes.push(nextScene, { transition: fade({ duration: 400 }) });

// Pop with a flash
await engine.scenes.pop({ transition: flash({ duration: 200, color: 0xff0000 }) });

// Replace with a cross-dissolve
await engine.scenes.replace(newScene, { transition: crossFade({ duration: 500 }) });

// Iris-out → swap → iris-in (Zelda-style)
await engine.scenes.replace(nextScene, { transition: iris({ duration: 700 }) });

// Checkerboard wipe with a custom grid
await engine.scenes.push(nextScene, { transition: chessboard({ rows: 4, cols: 6 }) });

// Both scenes slide together (incoming pushes the previous one off)
await engine.scenes.push(nextScene, { transition: slidePush({ direction: "left" }) });

// Per-scene default
class MenuScene extends Scene {
  readonly name = "menu";
  readonly defaultTransition = fade({ duration: 300 });
}
```

## Contract

```ts
interface SceneTransition {
  readonly duration: number;           // Total wall-clock ms
  begin?(ctx: SceneTransitionContext): void;
  tick(dt: number, ctx: SceneTransitionContext): void;
  end?(ctx: SceneTransitionContext): void;
}

interface SceneTransitionContext {
  readonly elapsed: number;            // Wall-clock ms since begin()
  readonly kind: "push" | "pop" | "replace";
  readonly engineContext: EngineContext;
  readonly fromScene: Scene | undefined;
  readonly toScene: Scene | undefined;
}
```

- `begin` — set up resources, paint start state
- `tick` — called each frame with frame `dt` in ms; `ctx.elapsed` is clamped to `duration`
- `end` — tear down; called before the old scene is removed from the stack

## Built-ins

Core ships the `SceneTransition` contract and orchestration but no concrete
transitions. All built-ins live in `@yagejs/renderer` (PIXI-based).

| Function | Description |
|---|---|
| `fade({ duration?, color? })` | Triangle alpha ramp: fade out → fade in. Scene swap happens under the fully-opaque mid-point. Default 300ms, black. |
| `flash({ duration?, color? })` | Overlay decays from alpha 1→0. Scene swap happens under the opaque peak at begin. Default 200ms, white. |
| `crossFade({ duration? })` | Cross-dissolve: outgoing alpha 1→0 while incoming alpha 0→1. Both visible throughout. Default 400ms. |
| `iris({ duration?, color?, center? })` | Circular cut-out shrinks to zero (closing iris) over the first half, then grows back (opening iris) to reveal the destination. Mask-based; redrawn each frame. Default 600ms, black, screen-center. |
| `irisReveal({ duration?, center?, easing? })` | One-way variant of `iris` — the destination scene's container is masked by an expanding circle so the new scene "blooms" over the previous one. No color overlay, no mid-point swap. Default 600ms, screen-center, linear. |
| `chessboard({ duration?, rows?, cols? })` | Reveals the destination through a staggered checkerboard mask painted onto the incoming scene's container. Even cells fade in over `[0, 0.5]`, odd cells over `[0.5, 1]`; the previous scene stays visible underneath until each cell covers it. Default 700ms, 6×10. |
| `slidePush({ duration?, direction?, reverseOnPop?, easing? })` | Both scenes translate in lockstep — the incoming scene pushes the outgoing one off the opposite edge. `direction` is the outgoing scene's exit direction (default `"left"`). `reverseOnPop` (default `true`) mirrors the motion on `pop`. Default 500ms, cubic ease-out. |
| `getSceneContainer(ctx, scene)` | Helper — resolves a scene's PIXI root container. Returns `undefined` if `scene` is undefined or its tree isn't materialized. |

For multi-step sequences (delayed fades, strobing flashes, etc.) write a
custom transition against the contract — it's usually simpler and more
correct than composing the built-ins, each of which manages its own
scene-visibility and would fight each other if chained.

## Lifecycle

### Push

1. New scene enters (`onEnter`)
2. Old scene receives `onPause` if applicable (fires before the transition begins)
3. `transition.begin()` fires
4. Per-frame `transition.tick(dt, ctx)` advances
5. `transition.end()` fires

### Pop

1. `transition.begin()` fires
2. Per-frame ticking
3. `transition.end()` fires
4. Top scene exits (`onExit`), revealed scene receives `onResume`

### Replace

1. New scene pushed (suppress event), `onEnter` fires
2. Transition runs with both scenes on the stack
3. `transition.end()` fires
4. Old scene removed (`onExit`), `scene:replaced` emitted

## Queueing

Concurrent `push`/`pop`/`replace`/`popAll` calls queue via `_pendingChain`. Re-entrant calls from lifecycle hooks throw.

`popAll()` is also queued — it waits for any in-flight transition and pending ops to finish before tearing the stack down. There is no mid-run cancellation.

## Events

- `scene:transition:started { kind, fromScene, toScene }` — emitted when a transition begins (`fromScene`/`toScene` may be `undefined`)
- `scene:transition:ended { kind, fromScene, toScene }` — emitted when a transition completes

## Checking State

```ts
engine.scenes.isTransitioning  // true during any active transition
scene.isTransitioning           // same, accessible from the scene
```

## Custom Transitions

Use `getSceneContainer(ctx, scene)` to reach a scene's PIXI root container
inside `begin`/`tick`/`end`. Manipulate `alpha`, `visible`, `position`,
`filters` directly.

```ts
import type { SceneTransition, SceneTransitionContext } from "@yagejs/core";
import type { Container } from "pixi.js";
import { getSceneContainer } from "@yagejs/renderer";

function slideIn(duration: number, width: number): SceneTransition {
  let toRoot: Container | undefined;
  return {
    duration,
    begin(ctx: SceneTransitionContext) {
      toRoot = getSceneContainer(ctx, ctx.toScene);
      if (toRoot) toRoot.x = width;
    },
    tick(_dt, ctx) {
      if (!toRoot) return;
      const t = Math.min(ctx.elapsed / duration, 1);
      toRoot.x = width * (1 - t);
    },
    end() {
      if (toRoot) toRoot.x = 0;
      toRoot = undefined;
    },
  };
}
```

Notes:
- `begin` fires synchronously when `SceneManager` starts the transition, before any frame is rendered — paint your start state here (hide incoming scene, offset it, etc.) to avoid a flash.
- `end` always fires at the end of the duration, never mid-run. Restore any persistent properties (visibility, alpha) on surviving scenes as a matter of hygiene.

## Composition with LoadingScene

`LoadingScene` (core) carries its own `transition` — the one used for the handoff to its target. That composes with any call-site transition passed to `push`/`replace`:

```ts
await engine.scenes.replace(new Boot(), {
  transition: fade({ duration: 400 }),    // mount Boot with this fade
});
// Boot.transition fires separately when Boot hands off to its target.
```

See `loading-scene.md` for the full Boot scene contract.

## Breaking Change

`SceneManager.pop()` returns `Promise<Scene | undefined>` (was synchronous). Update all call sites to `await` or `void`.
