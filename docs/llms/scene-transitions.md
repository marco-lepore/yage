# Scene Transitions

Animate the handoff between scenes during `push`, `pop`, and `replace`. Both scenes coexist on the stack for the transition's duration.

## Usage

```ts
import { crossFade, fade, flash } from "@yagejs/renderer";

// Push with a fade
await engine.scenes.push(nextScene, { transition: fade({ duration: 400 }) });

// Pop with a flash
await engine.scenes.pop({ transition: flash({ duration: 200, color: 0xff0000 }) });

// Replace with a cross-dissolve
await engine.scenes.replace(newScene, { transition: crossFade({ duration: 500 }) });

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
| `getSceneContainer(ctx, scene)` | Helper — resolves a scene's PIXI root container. Returns `undefined` if `scene` is undefined or its tree isn't materialized. |

For multi-step sequences (delayed fades, strobing flashes, etc.) write a
custom transition against the contract — it's usually simpler and more
correct than composing the built-ins, each of which manages its own
scene-visibility and would fight each other if chained.

## Lifecycle

### Push

1. New scene enters (`onEnter`)
2. `transition.begin()` fires
3. Per-frame `transition.tick(dt, ctx)` advances
4. `transition.end()` fires
5. Old scene receives `onPause` if applicable

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

Concurrent `push`/`pop`/`replace` calls queue via `_pendingChain`. Re-entrant calls from lifecycle hooks throw.

`clear()` cancels all in-flight and queued work via a generation counter.

## Events

- `scene:transition:started { kind }` — emitted when a transition begins
- `scene:transition:ended { kind }` — emitted when a transition completes

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
- `end` may fire mid-run when `scenes.clear()` cancels. Restore any persistent properties (visibility, alpha) to safe defaults there.

## Breaking Change

`SceneManager.pop()` returns `Promise<Scene | undefined>` (was synchronous). Update all call sites to `await` or `void`.
